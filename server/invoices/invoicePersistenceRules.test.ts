import { execFileSync } from "node:child_process";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import * as orm from "drizzle-orm";
import { invoices, invoiceItems } from "../../drizzle/schema";
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  splitInvoiceSchema,
} from "./invoiceInput";
import {
  createInvoice,
  updateInvoice,
  createSplitInvoices,
  cloneInvoice,
} from "./invoiceWrites";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: dbMock.getDb }));

// Read the actual pre-refactor schemas and callbacks; no duplicated fixture implementation.
const source = execFileSync(
  "git",
  ["show", "2d23089:server/invoices/invoicesRouter.ts"],
  { encoding: "utf8" }
);
const ast = ts.createSourceFile(
  "legacy.ts",
  source,
  ts.ScriptTarget.Latest,
  true
);
const declaration = ast.statements.find(ts.isVariableStatement)!;
const properties = (
  declaration.declarationList.declarations[0].initializer as ts.CallExpression
).arguments[0] as ts.ObjectLiteralExpression;
function legacy(name: string) {
  const property = properties.properties.find(
    p => p.name?.getText(ast) === name
  ) as ts.PropertyAssignment;
  const call = property.initializer as ts.CallExpression;
  const inputCall = (call.expression as ts.PropertyAccessExpression)
    .expression as ts.CallExpression;
  const evaluate = (text: string, deps: Record<string, unknown>) => {
    const code = ts.transpile(`const value = ${text};`, {
      target: ts.ScriptTarget.ES2020,
    });
    return new Function(...Object.keys(deps), `${code};return value;`)(
      ...Object.values(deps)
    );
  };
  return {
    schema: evaluate(inputCall.arguments[0].getText(ast), {
      z,
    }) as z.ZodTypeAny,
    run: evaluate(call.arguments[0].getText(ast), {
      ...orm,
      getDb: dbMock.getDb,
      invoices,
      invoiceItems,
      TRPCError,
    }) as (opts: any) => Promise<unknown>,
  };
}
const original = Object.fromEntries(
  ["create", "update", "createSplit", "clone"].map(name => [name, legacy(name)])
);
const schemas = {
  create: createInvoiceSchema,
  update: updateInvoiceSchema,
  createSplit: splitInvoiceSchema,
};
const handlers = {
  create: createInvoice,
  update: updateInvoice,
  createSplit: createSplitInvoices,
  clone: cloneInvoice,
};

async function record(
  run: (opts: any) => Promise<unknown>,
  input: unknown,
  selections: unknown[][] = [],
  unavailableAt = -1
) {
  const trace: unknown[] = [];
  let id = 71,
    calls = 0;
  const queue = [...selections];
  const db = new Proxy(
    {},
    {
      get: (_, operation: string) =>
        operation === "then"
          ? undefined
          : (...args: any[]) => {
              trace.push([
                operation,
                operation === "select"
                  ? Object.keys(args[0] ?? {})
                  : orm.getTableName(args[0]),
              ]);
              const chain: any = new Proxy(
                {},
                {
                  get: (_, method: string) => {
                    if (method === "then")
                      return (resolve: Function, reject: Function) => {
                        trace.push(["execute", operation]);
                        return Promise.resolve(
                          operation === "select"
                            ? (queue.shift() ?? [])
                            : operation === "insert"
                              ? [{ insertId: id++ }]
                              : []
                        ).then(resolve as any, reject as any);
                      };
                    return (...values: any[]) => {
                      trace.push([
                        method,
                        method === "values" || method === "set"
                          ? values[0]
                          : method === "from"
                            ? orm.getTableName(values[0])
                            : null,
                      ]);
                      return chain;
                    };
                  },
                }
              );
              return chain;
            },
    }
  );
  dbMock.getDb.mockImplementation(async () => {
    trace.push(["getDb"]);
    return calls++ === unavailableAt ? null : db;
  });
  try {
    return { result: await run({ input }), trace };
  } catch (error: any) {
    return { error: { message: error.message, code: error.code }, trace };
  }
}

const item = { description: "Item", quantity: 2.5, unitPrice: 12.34 };
const base = { invoiceNumber: " 7 ", items: [item] };
function forMode(name: keyof typeof schemas, values: any) {
  return name === "createSplit"
    ? {
        baseInvoiceNumber: "7",
        exchangeRate: 1,
        splits: [{ invoiceNumber: values.invoiceNumber, items: values.items }],
        ...values,
      }
    : name === "update"
      ? { id: 12, ...values }
      : values;
}

describe("invoice persistence input and row contracts", () => {
  it("matches legacy defaults, unknown-key stripping and ordered validation errors", () => {
    const cases = [
      base,
      {
        ...base,
        clientId: null,
        notes: "",
        accentColor: "",
        status: "paid",
        extra: "strip",
      },
      {
        ...base,
        invoiceNumber: "",
        items: [{ description: "", quantity: -1, unitPrice: -2, tax: -3 }],
      },
      {
        ...base,
        currency: null,
        showAmounts: null,
        notes: null,
        status: "other",
      },
      { ...base, items: [] },
      { ...base, items: [{ ...item, tax: null, quantity: NaN }] },
      {},
    ];
    for (const [name, schema] of Object.entries(schemas)) {
      for (const data of cases) {
        const input = forMode(name as keyof typeof schemas, data);
        const old = original[name].schema.safeParse(input),
          actual = schema.safeParse(input);
        expect(actual.success ? actual.data : actual.error.issues).toEqual(
          old.success ? old.data : old.error.issues
        );
      }
    }
    for (const exchangeRate of [0, -1, null]) {
      const input = { ...forMode("createSplit", base), exchangeRate };
      expect(splitInvoiceSchema.safeParse(input)).toEqual(
        original.createSplit.schema.safeParse(input)
      );
    }
  });

  it("matches create/update/split saved values, operation order and empty-item behavior", async () => {
    for (const name of ["create", "update", "createSplit"] as const) {
      for (const values of [
        base,
        {
          ...base,
          clientId: 0,
          clientSnapshot: { name: "buyer" },
          invoiceDate: "",
          dueDate: "",
          notes: "",
          rawChat: "",
          accentColor: "",
          currency: "",
          showAmounts: true,
          items: [
            item,
            {
              ...item,
              variant: "",
              quantity: 0,
              unitPrice: 0,
              currency: "",
              sortOrder: 0,
              tax: 0,
            },
          ],
        },
        { ...base, items: [] },
      ]) {
        const input = schemas[name].parse(forMode(name, values));
        expect(await record(handlers[name] as any, input)).toEqual(
          await record(original[name].run, input)
        );
      }
    }
    const input = splitInvoiceSchema.parse({
      ...forMode("createSplit", base),
      splits: [" 7 ", "X-008", "   ", "12345"].map(invoiceNumber => ({
        invoiceNumber,
        items: [item],
      })),
    });
    const result = await record(createSplitInvoices, input);
    expect(result).toEqual(await record(original.createSplit.run, input));
    expect(
      result.trace
        .filter(
          (event: any) => event[0] === "values" && !Array.isArray(event[1])
        )
        .map((event: any) => event[1].invoiceNumber)
    ).toEqual(["0007", "X-008", "", "12345"]);
  });

  it("keeps duplicate rejection exclusive to create and preserves unavailable-DB errors", async () => {
    for (const name of ["create", "update", "createSplit"] as const) {
      const input = schemas[name].parse(forMode(name, base));
      for (const unavailable of [0, 1])
        expect(
          await record(handlers[name] as any, input, [], unavailable)
        ).toEqual(await record(original[name].run, input, [], unavailable));
      const result = await record(handlers[name] as any, input, [[{ id: 8 }]]);
      expect(result).toEqual(
        await record(original[name].run, input, [[{ id: 8 }]])
      );
      expect(result.error?.code).toBe(
        name === "create" ? "CONFLICT" : undefined
      );
    }
  });

  it("keeps clone numbering and stored decimal/null handling separate", async () => {
    const selections = [
      [
        {
          invoiceNumber: "X-901",
          clientId: null,
          clientSnapshot: null,
          invoiceDate: "",
          dueDate: null,
          currency: "JPY",
          showAmounts: false,
          notes: null,
          rawChat: "",
          accentColor: null,
        },
      ],
      [
        {
          description: "Stored",
          variant: null,
          quantity: "2.50",
          unitPrice: "3.40",
          currency: null,
          sortOrder: null,
          tax: null,
        },
      ],
      [{ invoiceNumber: "INV-20260930-001" }, { invoiceNumber: "X-0901" }],
    ];
    const result = await record(cloneInvoice, { id: 4 }, selections);
    expect(result).toEqual(
      await record(original.clone.run, { id: 4 }, selections)
    );
    expect(result.result).toEqual({ id: 71, invoiceNumber: "202610" });
  });
});
