import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";
import { ADMIN_EMAILS } from "../../shared/const";
import * as db from "./db";
import { restoreDeliveryItemsForInventory } from "./deliveryHistoryRestore";
import { inventoryRouter } from "./routers";

vi.mock("./db", async (importOriginal) => ({
  ...await importOriginal<typeof import("./db")>(),
  getDb: vi.fn(async () => null),
  getSystemSetting: vi.fn(async () => "1"),
  getDeletedInventories: vi.fn(async () => []),
  getLocalInventoryById: vi.fn(),
  getLocalInventoryByZaicoIdOrId: vi.fn(),
  getLocalPurchases: vi.fn(async () => []),
  getInventoryMemos: vi.fn(async () => []),
  getAllInventoryMemos: vi.fn(async () => []),
  updateLocalInventory: vi.fn(async () => undefined),
  upsertLocalInventory: vi.fn(async () => 12),
  removeDeletedInventory: vi.fn(async () => undefined),
  ensureInventoryItemLabelsForInventory: vi.fn(async () => []),
}));
vi.mock("./changeLog", async (importOriginal) => ({
  ...await importOriginal<typeof import("./changeLog")>(),
  recordInventoryChange: vi.fn(async () => undefined),
}));
vi.mock("./deliveryHistoryRestore", () => ({ restoreDeliveryItemsForInventory: vi.fn(async () => 1) }));

const inventory = {
  id: 12, zaicoId: null, title: "2DS Pink", quantity: 0, unit: "piece",
  etc: "423_test_2DS_1/15", category: "2DS", isDeleted: 1,
};
const caller = inventoryRouter.createCaller({
  user: { id: 1, name: "Test", email: ADMIN_EMAILS[0], role: "admin" },
  req: { headers: {} }, res: {},
} as TrpcContext);

describe("restore management delivery history integration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("削除済み商品を元のローカルIDに戻して出庫履歴の削除表示を解除する", async () => {
    vi.mocked(db.getDeletedInventories).mockResolvedValue([{
      id: 5, zaicoId: 12, title: inventory.title, snapshotJson: JSON.stringify(inventory),
    }] as Awaited<ReturnType<typeof db.getDeletedInventories>>);
    vi.mocked(db.getLocalInventoryByZaicoIdOrId).mockResolvedValue(inventory as Awaited<ReturnType<typeof db.getLocalInventoryByZaicoIdOrId>>);

    await caller.restoreManagement.restoreDeleted({ id: 5 });
    expect(db.upsertLocalInventory).toHaveBeenCalledWith(expect.objectContaining({ id: 12, zaicoId: null, isDeleted: 0 }));
    expect(restoreDeliveryItemsForInventory).toHaveBeenCalledWith([12, 12, null]);
    expect(db.removeDeletedInventory).toHaveBeenCalledWith(5);
  });

  it("削除後に保存された完全復元データでも商品と出庫履歴を復元する", async () => {
    vi.mocked(db.getDb)
      .mockResolvedValueOnce({} as NonNullable<Awaited<ReturnType<typeof db.getDb>>>)
      .mockResolvedValueOnce({} as NonNullable<Awaited<ReturnType<typeof db.getDb>>>);
    vi.mocked(db.getLocalInventoryById).mockResolvedValue(inventory as Awaited<ReturnType<typeof db.getLocalInventoryById>>);
    vi.mocked(db.getAllInventoryMemos).mockResolvedValue([{
      id: 6, zaicoInventoryId: 12,
      memo: "__FULL_RESTORE_SNAPSHOT_V1__:" + JSON.stringify({
        version: 1, capturedAt: "2026-10-16", source: "ui", reason: "test", inventory, purchases: [], labels: [],
      }),
    }] as Awaited<ReturnType<typeof db.getAllInventoryMemos>>);

    await caller.restoreManagement.restoreFullSnapshot({ memoId: 6 });
    expect(db.updateLocalInventory).toHaveBeenCalledWith(12, expect.objectContaining({ isDeleted: 0 }));
    expect(restoreDeliveryItemsForInventory).toHaveBeenCalledWith([12, 12, null]);
  });

  it("変更履歴からの復元でも旧Zaico IDを含めて削除表示を解除する", async () => {
    vi.mocked(db.getLocalInventoryById).mockResolvedValue({ ...inventory, zaicoId: 34 } as Awaited<ReturnType<typeof db.getLocalInventoryById>>);
    vi.mocked(db.getInventoryMemos).mockResolvedValue([{
      id: 7, memo: "商品名: 2DS Pink → wrong title",
    }] as Awaited<ReturnType<typeof db.getInventoryMemos>>);

    await caller.restoreManagement.restoreFromHistory({ localInventoryId: 12, memoId: 7 });
    expect(db.updateLocalInventory).toHaveBeenCalledWith(12, expect.objectContaining({ isDeleted: 0, title: "2DS Pink" }));
    expect(restoreDeliveryItemsForInventory).toHaveBeenCalledWith([12, 34]);
  });
});
