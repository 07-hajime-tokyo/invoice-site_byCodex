import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inventoryItemLabels, localInventories } from "../../drizzle/schema";
import { ensureInventoryItemLabelsForInventory } from "./db";

const mock = vi.hoisted(() => ({ db: {} as Record<string, unknown> }));
vi.mock("../_core/database", async importOriginal => ({
  ...await importOriginal<typeof import("../_core/database")>(),
  createDrizzleDatabase: () => mock.db,
  shouldRunRuntimeSchemaCheck: () => false,
}));

let inventory: { id: number; quantity: number; isDeleted: number };
let labels: Array<{ id: number; labelId: string; status: string }>;
const lockReads: unknown[] = [];

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "mysql://unused");
  inventory = { id: 10, quantity: 1, isDeleted: 0 };
  labels = [{ id: 20, labelId: "TESTABC", status: "stocked" }];
  lockReads.length = 0;
  let tail = Promise.resolve();
  mock.db.transaction = <T>(fn: (tx: unknown) => Promise<T>) => {
    const result = tail.then(() => fn(mock.db));
    tail = result.then(() => undefined, () => undefined);
    return result;
  };
  mock.db.select = () => ({
    from(table: unknown) {
      const query = {
        where: () => query,
        limit: () => query,
        orderBy: () => query,
        for: () => { lockReads.push(table); return query; },
        then(resolve: (rows: unknown[]) => unknown) {
          return resolve(table === localInventories ? [inventory] : labels.map(label => ({ ...label })));
        },
      };
      return query;
    },
  });
  mock.db.update = () => ({ set: () => ({ where: async () => [{ affectedRows: 1 }] }) });
  mock.db.insert = (table: unknown) => ({
    values: async (label: Omit<(typeof labels)[number], "id">) => {
      expect(table).toBe(inventoryItemLabels);
      const id = 20 + labels.length;
      labels.push({ ...label, id });
      return [{ insertId: id }];
    },
  });
});
afterEach(() => vi.unstubAllEnvs());

const ensure = (quantity: number) => ensureInventoryItemLabelsForInventory({
  localInventoryId: 10, quantity, title: "Test", status: "stocked",
});

describe("inventory label backfill", () => {
  it("uses the locked stock count instead of a stale caller count and keeps stocked labels", async () => {
    await ensure(2);
    expect(labels.map(label => label.labelId)).toEqual(["TESTABC"]);
    expect(lockReads[0]).toBe(localInventories);
  });

  it("fills the same missing slot only once when two readers request backfill", async () => {
    inventory.quantity = 2;
    await Promise.all([ensure(2), ensure(2)]);
    expect(labels).toHaveLength(2);
    expect(labels.every(label => label.status === "stocked")).toBe(true);
  });
});
