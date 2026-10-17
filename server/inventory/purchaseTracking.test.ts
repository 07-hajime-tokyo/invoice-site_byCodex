import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { localPurchases, purchaseExtras } from "../../drizzle/schema";
import type { TrpcContext } from "../_core/context";
import * as db from "./db";
import { inventoryRouter } from "./routers";
import { recordWorkLog } from "./workLogs";

vi.mock("./db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./db")>(),
  getDb: vi.fn(async () => null),
  getSystemSetting: vi.fn(async () => "1"),
  isZaicoEnabled: vi.fn(async () => false),
  getLocalPurchases: vi.fn(async () => []),
}));
vi.mock("./workLogs", async (importOriginal) => ({
  ...await importOriginal<typeof import("./workLogs")>(),
  recordWorkLog: vi.fn(async () => undefined),
}));

const caller = inventoryRouter.createCaller({
  user: { id: 1, name: "Test", email: "test@example.com", role: "admin" },
  req: { headers: {} }, res: {},
} as TrpcContext);
const purchase = {
  id: 101, zaicoId: 201, localInventoryId: 301,
  status: "shipped", stage: "shipped", title: "New 3DS LL",
  shipDate: "2026-10-16", trackingNumber: "DA6617278187", carrier: "amazon",
  managementNo: "stock1016_3", itemsJson: "[]", itemLabels: [], note: "Keep this note",
};
const updates: Array<{ table: unknown; values: Record<string, unknown>; condition: SQL }> = [];

describe("purchase tracking cancellation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updates.length = 0;
    vi.mocked(db.getLocalPurchases).mockResolvedValue([purchase] as Awaited<ReturnType<typeof db.getLocalPurchases>>);
    vi.mocked(db.getDb).mockResolvedValue({
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: async (condition: SQL) => { updates.push({ table, values, condition }); },
        }),
      }),
    } as NonNullable<Awaited<ReturnType<typeof db.getDb>>>);
  });

  it.each([null, "", "   "])("clears %s tracking and returns an unreceived purchase to ordered", async (trackingNumber) => {
    const result = await caller.purchaseExtra.upsert({ zaicoId: 101, trackingNumber });
    expect(result).toEqual({ success: true, localUpdatedCount: 1 });
    expect(updates.find((update) => update.table === localPurchases)?.values).toEqual({
      trackingNumber: null, shipDate: null, carrier: null,
      status: "ordered", stage: "ordered",
      stageUpdatedBy: "tracking-registration", stageUpdatedAt: expect.any(Date),
    });
    const extraUpdate = updates.find((update) => update.table === purchaseExtras)!;
    expect(extraUpdate.values).toEqual({ trackingNumber: null, shipDate: null, carrier: null });
    expect(new MySqlDialect().sqlToQuery(extraUpdate.condition).params).toEqual([101, 201, 301]);
    expect(recordWorkLog).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: "purchase:101",
      detailsJson: expect.any(String),
    }));
    const audit = JSON.parse(vi.mocked(recordWorkLog).mock.calls[0][0].detailsJson!);
    expect(audit.after).toMatchObject({
      trackingNumber: null, shipDate: null, carrier: null,
      status: "ordered", stage: "ordered", note: "Keep this note",
    });
  });

  it("ignores the displayed shipping date and carrier when cancelling", async () => {
    await caller.purchaseExtra.upsert({
      zaicoId: 101, trackingNumber: "", shipDate: "2026-10-16", carrier: "amazon",
    });
    expect(updates.find((update) => update.table === localPurchases)?.values).toMatchObject({
      trackingNumber: null, shipDate: null, carrier: null, status: "ordered",
    });
  });

  it("preserves the receipt status when clearing tracking on a received purchase", async () => {
    vi.mocked(db.getLocalPurchases).mockResolvedValue([{
      ...purchase, status: "purchased", stage: "stocked",
    }] as Awaited<ReturnType<typeof db.getLocalPurchases>>);
    await caller.purchaseExtra.upsert({ zaicoId: 101, trackingNumber: null });
    const update = updates.find((entry) => entry.table === localPurchases)!.values;
    expect(update).toMatchObject({ trackingNumber: null, shipDate: null, carrier: null });
    expect(update).not.toHaveProperty("status");
    expect(update).not.toHaveProperty("stage");
  });

  it("still saves nonempty tracking as supplier shipped", async () => {
    await caller.purchaseExtra.upsert({
      zaicoId: 101, trackingNumber: " NEW123 ", shipDate: "2026-10-17", carrier: "yamato",
    });
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toMatchObject({
      trackingNumber: "NEW123", shipDate: "2026-10-17", carrier: "yamato",
      status: "shipped", stage: "shipped",
    });
  });

  it("does not cancel tracking when only editing a note", async () => {
    await caller.purchaseExtra.upsert({ zaicoId: 101, note: "New note" });
    expect(updates).toHaveLength(1);
    expect(updates[0].values).toEqual({
      note: "New note", stageUpdatedBy: "tracking-registration", stageUpdatedAt: expect.any(Date),
    });
  });

  it("does not report cancellation success if the purchase is missing", async () => {
    vi.mocked(db.getLocalPurchases).mockResolvedValue([]);
    await expect(caller.purchaseExtra.upsert({ zaicoId: 101, trackingNumber: null }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(updates).toHaveLength(0);
  });
});
