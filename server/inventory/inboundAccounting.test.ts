import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { inventoryItemLabels, localInventories, localPurchases, purchaseHistories, workLogs } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import { assertInboundQuantity } from "./inboundAccounting";
import { inboundDeskRouter } from "./inboundDesk";
import { inventoryRouter } from "./routers";

const mock = vi.hoisted(() => ({ getDb: vi.fn(), recordWorkLog: vi.fn(), getInventory: vi.fn() }));
vi.mock("./db", async importOriginal => ({
  ...await importOriginal<typeof import("./db")>(),
  getDb: mock.getDb,
  getLocalInventoryByZaicoIdOrId: mock.getInventory,
  getLocalPurchases: async () => [{ id: 30, localInventoryId: 10, quantity: 1 }],
  isZaicoEnabled: async () => false,
  ensureInventoryItemLabels: async () => [],
  updateLocalPurchaseStatus: vi.fn(),
}));
vi.mock("./workLogs", async importOriginal => ({
  ...await importOriginal<typeof import("./workLogs")>(),
  recordWorkLog: mock.recordWorkLog,
}));

const context = {
  req: {}, res: {}, user: { id: 1, name: "Test", email: "test@example.com" },
} as TrpcContext;
const caller = inboundDeskRouter.createCaller(context);
const purchaseCaller = inventoryRouter.createCaller(context);
const labelId = "TESTABC";
const inspect = () => caller.inspect({ labelId, outcome: "stocked", operatorName: "Second operator" });

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
            if (table === purchaseHistories) return resolve(histories);
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
            if (!/ \+ (1|\?)$/.test(statement.sql)) throw new Error("Expected atomic increment");
            inventory.quantity++;
          } else if (table !== localPurchases) throw new Error("Unexpected update");
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
  mock.getInventory.mockImplementation(async () => ({ ...inventory }));
  mock.recordWorkLog.mockImplementation(async (row, options) => {
    if (row.sourceType !== "inbound-receipt") expect(options.executor).toBe(db);
    logs.unshift(row);
  });
  const complete = () => purchaseCaller.zaico.completePurchase({
    purchaseId: 30,
    purchaseItems: [{ inventory_id: 10, quantity: "1", unit_price: "32800" }],
    purchaseDate: "2026-11-08",
    operatorName: "First operator",
  });
  return { state: () => ({ inventory, label, histories, logs }), locks, complete };
}

beforeEach(() => vi.resetAllMocks());

describe("receipt and inspection storage boundary", () => {
  it("still rejects an ordered label in the inspection screen", async () => {
    const f = fixture("ordered");
    await expect(inspect()).rejects.toThrow("検品待ちではありません");
    expect(f.state()).toMatchObject({ inventory: { quantity: 0 }, histories: [], logs: [] });
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

  it("rejects inspection after another operator used the purchase completion path", async () => {
    const f = fixture("received");
    await f.complete();
    await expect(inspect()).rejects.toThrow("入庫済みの数量");
    expect(f.state()).toMatchObject({
      inventory: { quantity: 1 },
      label: { status: "received" },
      histories: [{ quantity: "1", operatorName: "First operator" }],
    });
    expect(f.state().logs.map(log => log.sourceType)).toEqual(["purchase"]);
  });

  it("rejects purchase completion after inspection", async () => {
    const f = fixture("received");
    await inspect();
    await expect(f.complete()).rejects.toThrow("入庫済みの数量");
    expect(f.state().inventory.quantity).toBe(1);
    expect(f.state().histories).toHaveLength(1);
  });

  it("records a label scan once and allows inspection without adding stock again", async () => {
    const f = fixture("ordered");
    const scan = () => purchaseCaller.orderManagement.receivePurchaseLabel({ labelId });
    expect(await scan()).toMatchObject({ alreadyReceived: false, inventoryQuantity: 1 });
    expect(await scan()).toMatchObject({ alreadyReceived: true, inventoryQuantity: 1 });
    expect(await inspect()).toMatchObject({ inventoryCountChanged: false });
    expect(f.state().histories).toHaveLength(1);
    expect(f.state().logs.map(log => log.sourceType)).toEqual(["inbound-inspection", "purchase-label"]);
  });

  it("allows only one of simultaneous cross-route attempts", async () => {
    const f = fixture("received");
    const results = await Promise.allSettled([f.complete(), inspect()]);
    expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(f.state().inventory.quantity).toBe(1);
    expect(f.state().histories).toHaveLength(1);
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

describe("inbound quantity", () => {
  it("allows separate units of a multi-unit order but not excess receipts", () => {
    expect(() => assertInboundQuantity(1, 1, 2)).not.toThrow();
    expect(() => assertInboundQuantity(2, 1, 2)).toThrow("入庫済みの数量");
  });

  it("blocks an unidentified second receipt conservatively", () => {
    expect(() => assertInboundQuantity(1, 1)).toThrow("入庫済みの数量");
  });
});
