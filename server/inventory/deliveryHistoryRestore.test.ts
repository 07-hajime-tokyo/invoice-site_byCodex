import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "./db";
import { restoreDeliveryItemsForInventory } from "./deliveryHistoryRestore";

vi.mock("./db", () => ({ getDb: vi.fn() }));

function databaseWithHistories(histories: Array<{ id: number; deletedInventoryIdsJson: string | null }>) {
  const writes: Array<{ deletedInventoryIdsJson: string | null }> = [];
  const update = vi.fn(() => ({
    set: (value: { deletedInventoryIdsJson: string | null }) => ({
      where: vi.fn(async () => { writes.push(value); }),
    }),
  }));
  const lock = vi.fn(async () => histories);
  const tx = {
    select: () => ({ from: () => ({ where: () => ({ for: lock }) }) }),
    update,
  };
  const db = { transaction: vi.fn(async (run: (transaction: typeof tx) => Promise<number>) => run(tx)) };
  vi.mocked(getDb).mockResolvedValue(db as unknown as NonNullable<Awaited<ReturnType<typeof getDb>>>);
  return { writes, update, lock };
}

describe("restoring deleted delivery items", () => {
  beforeEach(() => vi.clearAllMocks());

  it("旧Zaico IDとローカルIDの削除表示だけを全履歴から解除する", async () => {
    const histories = Array.from({ length: 600 }, (_, id) => ({ id, deletedInventoryIdsJson: "[99]" }));
    histories[0].deletedInventoryIdsJson = "[12,99]";
    histories[599].deletedInventoryIdsJson = '["34",99]';
    const { writes, lock } = databaseWithHistories(histories);

    await expect(restoreDeliveryItemsForInventory([12, 34])).resolves.toBe(2);
    expect(lock).toHaveBeenCalledWith("update");
    expect(writes).toEqual([
      { deletedInventoryIdsJson: "[99]" },
      { deletedInventoryIdsJson: "[99]" },
    ]);
  });

  it("最後の削除表示を解除しても出庫明細や取消情報は書き換えない", async () => {
    const { writes } = databaseWithHistories([{ id: 1, deletedInventoryIdsJson: "[12]" }]);
    await expect(restoreDeliveryItemsForInventory([12])).resolves.toBe(1);
    expect(writes).toEqual([{ deletedInventoryIdsJson: null }]);
  });

  it("別商品と壊れた過去データは更新しない", async () => {
    const { update } = databaseWithHistories([
      { id: 1, deletedInventoryIdsJson: "[99]" },
      { id: 2, deletedInventoryIdsJson: "broken" },
      { id: 3, deletedInventoryIdsJson: '{"id":12}' },
      { id: 4, deletedInventoryIdsJson: null },
    ]);
    await expect(restoreDeliveryItemsForInventory([12])).resolves.toBe(0);
    expect(update).not.toHaveBeenCalled();
  });

  it("対象の在庫IDが無いときはDBを呼び出さない", async () => {
    await expect(restoreDeliveryItemsForInventory([null, undefined, 0, -1, NaN])).resolves.toBe(0);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("DBに接続できない場合は復元成功として扱わない", async () => {
    vi.mocked(getDb).mockResolvedValue(null);
    await expect(restoreDeliveryItemsForInventory([12])).rejects.toThrow("Database not available");
  });
});
