import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { inventoryItemLabels, localInventories, localPurchases, purchaseHistories, workLogs } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { activeReceiptLabelIds, resolveInspectionStock } from "./inboundAccounting";
import { inboundDeskRouter } from "./inboundDesk";

const mock = vi.hoisted(() => ({ getDb: vi.fn(), recordWorkLog: vi.fn() }));
vi.mock("./db", async importOriginal => ({
  ...await importOriginal<typeof import("./db")>(),
  getDb: mock.getDb,
  updateLocalPurchaseStatus: vi.fn(),
}));
vi.mock("./workLogs", async importOriginal => ({
  ...await importOriginal<typeof import("./workLogs")>(),
  recordWorkLog: mock.recordWorkLog,
}));

const caller = inboundDeskRouter.createCaller({
  req: {}, res: {}, user: { id: 1, name: "Test", email: "test@example.com" },
} as TrpcContext);
const labelId = "TESTABC";
const inspect = () => caller.inspect({ labelId, outcome: "stocked" });

function fixture(status: string, initialQuantity = 0) {
  let inventory = { id: 10, quantity: initialQuantity, isDeleted: 0, title: "Test" };
  let label = { id: 20, localInventoryId: 10, purchaseId: 30, labelId, status, title: "Test" };
  let logs: Array<{ sourceType: string; sourceId: string; detailsJson?: string }> = [];
  let histories: unknown[] = [];
  const locks: unknown[] = [];
  let tail = Promise.resolve();
  const db = {
    select: () => ({
      from(table: unknown) {
        let params: unknown[] = [];
        const query = {
          where(condition: SQL) {
            params = new MySqlDialect().sqlToQuery(condition).params;
            return query;
          },
          limit: () => query,
          orderBy: () => query,
          for: () => { locks.push(table); return query; },
          then(resolve: (rows: unknown[]) => unknown) {
            if (table === inventoryItemLabels) return resolve([{ ...label }]);
            if (table === localInventories) return resolve([{ ...inventory }]);
            if (table === localPurchases) return resolve([{ id: 30, quantity: 1 }]);
            if (table === workLogs) return resolve(logs.filter(log => params.includes(log.sourceType)));
            throw new Error("Unexpected select");
          },
        };
        return query;
      },
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (table === inventoryItemLabels) label = { ...label, ...values };
          else if (table === localInventories) {
            const statement = new MySqlDialect().sqlToQuery(values.quantity as SQL);
            if (!statement.sql.endsWith(" + 1")) throw new Error("Expected atomic increment");
            inventory.quantity++;
          } else throw new Error("Unexpected update");
          return [{ affectedRows: 1 }];
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (values: unknown) => {
        if (table !== purchaseHistories) throw new Error("Unexpected insert");
        histories.push(values);
        return [{ insertId: 40 }];
      },
    }),
    transaction<T>(fn: (tx: unknown) => Promise<T>): Promise<T> {
      const result = tail.then(async () => {
        const before = structuredClone({ label, inventory, histories, logs });
        try { return await fn(db); }
        catch (error) {
          ({ label, inventory, histories, logs } = before);
          throw error;
        }
      });
      tail = result.then(() => undefined, () => undefined);
      return result;
    },
  };
  mock.getDb.mockResolvedValue(db);
  mock.recordWorkLog.mockImplementation(async (row, options) => {
    expect(options.executor).toBe(db);
    logs.unshift(row);
  });
  return { state: () => ({ inventory, label, histories, logs }), locks };
}

beforeEach(() => vi.resetAllMocks());

describe("receipt and inspection storage boundary", () => {
  it.each(["ordered", "received"])("rejects %s without an actual receipt", async status => {
    const f = fixture(status);
    await expect(inspect()).rejects.toThrow("先に荷受け");
    expect(f.state()).toMatchObject({ inventory: { quantity: 0 }, label: { status }, histories: [], logs: [] });
  });

  it("receives without counting stock, then stocks the same label exactly once", async () => {
    const f = fixture("ordered");
    expect((await caller.receive({ labelIds: [labelId] })).received).toEqual([labelId]);
    expect(f.state().inventory.quantity).toBe(0);
    expect((await caller.receive({ labelIds: [labelId] })).alreadyReceived).toEqual([labelId]);
    const results = await Promise.allSettled([inspect(), inspect()]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(f.state()).toMatchObject({
      inventory: { quantity: 1 },
      label: { labelId, status: "stocked", inspectionQuantityDelta: 1 },
      histories: [{ quantity: "1", inventoryId: 10 }],
    });
    expect(f.state().logs.map(log => log.sourceType)).toEqual(["inbound-inspection", "inbound-receipt"]);
    expect(f.locks).toContain(localInventories);
  });

  it("records a missing receipt without counting legacy stock twice", async () => {
    const f = fixture("received", 1);
    await caller.receive({ labelIds: [labelId] });
    expect((await inspect()).inventoryCountChanged).toBe(false);
    expect(f.state()).toMatchObject({
      inventory: { quantity: 1 },
      label: { status: "stocked", inspectionQuantityDelta: 0 },
      histories: [],
    });
  });

  it("excludes unconfirmed receipts and uncounted stock from backlog closing", async () => {
    const f = fixture("received");
    const receivedBefore = "2100-01-01";
    expect(await caller.closeInspectionBacklog({ receivedBefore })).toMatchObject({ count: 0 });
    await caller.receive({ labelIds: [labelId] });
    expect(await caller.closeInspectionBacklog({ receivedBefore })).toMatchObject({ count: 0 });
    expect(f.state()).toMatchObject({ inventory: { quantity: 0 }, label: { status: "received" } });
  });

  it("rolls back stock, label, and history when inspection logging fails", async () => {
    const f = fixture("ordered");
    await caller.receive({ labelIds: [labelId] });
    mock.recordWorkLog.mockRejectedValueOnce(new Error("log failure"));
    await expect(inspect()).rejects.toThrow("log failure");
    expect(f.state()).toMatchObject({ inventory: { quantity: 0 }, label: { status: "received" }, histories: [] });
    await expect(inspect()).resolves.toMatchObject({ inventoryCountChanged: true });
    expect(f.state().inventory.quantity).toBe(1);
  });
});

describe("inbound accounting", () => {
  it("honors the most recent receipt or cancellation for each exact ID", () => {
    expect(activeReceiptLabelIds([
      { sourceType: "inbound-receipt-undo", sourceId: labelId },
      { sourceType: "inbound-receipt", sourceId: `${labelId}, OTHERAB` },
    ])).toEqual(new Set(["OTHERAB"]));
  });
  it("does not consume the unit represented by a different stocked or counted label", () => {
    expect(resolveInspectionStock(1, labelId, [{ labelId: "OTHERAB", status: "stocked" }], new Set())).toBe("uncounted");
    expect(resolveInspectionStock(1, labelId, [{ labelId: "OTHERAB", status: "received" }], new Set(["OTHERAB"]))).toBe("uncounted");
    expect(resolveInspectionStock(0, labelId, [], new Set([labelId]))).toBe("conflict");
  });
});
