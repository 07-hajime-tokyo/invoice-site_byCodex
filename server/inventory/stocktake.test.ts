import { beforeEach, describe, expect, it, vi } from "vitest";
import { localInventories, inventoryItemLabels } from "../../drizzle/schema";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { TrpcContext } from "../_core/context";
import { fixture } from "../../shared/stocktake.fixture";
import { emptyStocktakeState } from "../../shared/stocktake";

const mock = vi.hoisted(() => ({ db: {} as any }));
vi.mock("./db", () => ({ getDb: async () => mock.db }));
import { stocktakeRouter } from "./stocktake";
const sessionId = "5cbab522-75f3-40c0-85e0-e30eb719186d";
const context = {
  req: {},
  res: {},
  user: { id: 1, name: "棚卸担当", email: "test@example.com" },
} as TrpcContext;
let stored: any;
let queries: string[];
beforeEach(() => {
  queries = [];
  stored = {
    id: sessionId,
    basis_date: "2026-09-30",
    status: "open",
    snapshot_json: JSON.stringify(fixture),
    state_json: JSON.stringify(emptyStocktakeState()),
    revision: 0,
    created_by: "担当者",
    created_at: new Date(),
    completed_at: null,
  };
  mock.db.execute = async (statement: any) => {
    const query = new MySqlDialect().sqlToQuery(statement);
    queries.push(query.sql);
    if (query.sql.startsWith("UPDATE inventory_stocktakes")) {
      [stored.state_json, stored.status, stored.completed_at] = query.params;
      stored.revision++;
    }
    if (query.sql.startsWith("INSERT")) {
      const p = query.params;
      stored = {
        ...stored,
        id: p[0],
        basis_date: p[1],
        snapshot_json: p[2],
        state_json: p[3],
        created_by: p[4],
      };
    }
    return query.sql.startsWith("SELECT")
      ? [query.params[0] === stored.id ? [{ ...stored }] : [], []]
      : [[], []];
  };
  mock.db.select = () => ({
    from: async (table: unknown) =>
      table === localInventories
        ? fixture.rows.map(r => ({ ...r, etc: r.managementNo, isDeleted: 0 }))
        : table === inventoryItemLabels
          ? fixture.labels.map(l => ({
              ...l,
              assignedInvoiceNo: l.invoiceNo,
              legacyManagementNo: null,
              boxId: l.boxCode ? 1 : null,
            }))
          : fixture.boxes.map(b => ({ ...b, id: 1, discardedAt: null })),
  });
  mock.db.transaction = async (fn: any) => fn(mock.db);
});
describe("stocktake storage boundary", () => {
  it("freezes stock and price at start and retries the same start without recreating it", async () => {
    const caller = stocktakeRouter.createCaller(context);
    const input = {
      id: "d706bbad-e5f8-4182-a1af-5a24791f180c",
      basisDate: "2026-09-30",
      noMovementConfirmed: true as const,
    };
    const first = await caller.start(input);
    expect(first.snapshot.rows[0]).toMatchObject({
      quantity: 2,
      unitPrice: 100.25,
      labelIds: ["AAAAAAA", "BBBBBBB"],
    });
    mock.db.select = () => {
      throw Error("must not recapture");
    };
    expect((await caller.start(input)).snapshot).toEqual(first.snapshot);
    expect(queries.filter(q => q.startsWith("INSERT"))).toHaveLength(1);
  });
  it("requires authentication", async () => {
    await expect(
      stocktakeRouter
        .createCaller({ ...context, user: null })
        .get({ id: sessionId })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
  it("persists scans, resumes them, and makes retry idempotent under a row lock", async () => {
    const caller = stocktakeRouter.createCaller(context);
    await caller.record({
      id: sessionId,
      action: { type: "scan", code: "AAAAAAA" },
    });
    await caller.record({
      id: sessionId,
      action: { type: "scan", code: "AAAAAAA" },
    });
    expect((await caller.get({ id: sessionId })).state.scans).toHaveLength(1);
    expect(stored.revision).toBe(1);
    expect(queries.some(q => q.includes("FOR UPDATE"))).toBe(true);
    expect(
      queries
        .filter(
          q => /UPDATE|INSERT|DELETE/.test(q) && !q.includes("FOR UPDATE")
        )
        .every(q => q.includes("inventory_stocktakes"))
    ).toBe(true);
  });
  it("refuses manual counts beyond unlabeled capacity", async () => {
    await expect(
      stocktakeRouter.createCaller(context).record({
        id: sessionId,
        action: { type: "manual", inventoryId: 1, quantity: 1 },
      })
    ).rejects.toThrow("対象数量");
  });
  it("requires a discrepancy memo, saves completion, then rejects further scans", async () => {
    const caller = stocktakeRouter.createCaller(context);
    await expect(
      caller.record({ id: sessionId, action: { type: "finish", notes: "" } })
    ).rejects.toThrow("理由");
    const result = await caller.record({
      id: sessionId,
      action: { type: "finish", notes: "別保管分は未確認" },
    });
    expect(result.status).toBe("completed");
    expect(result.state.notes).toBe("別保管分は未確認");
    await expect(
      caller.record({
        id: sessionId,
        action: { type: "scan", code: "BBBBBBB" },
      })
    ).rejects.toThrow("確定済み");
  });
});
