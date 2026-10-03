import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocalPurchases,
  upsertLocalPurchase,
  type LocalPurchaseWithLabels,
  type LocalInventoryWithLabels,
} from "../db";
import { ensureShaftPurchases } from "./shaftBackfill";
import { getInventoryManagementNo } from "../managementNo";

vi.mock("../db", () => ({
  getLocalPurchases: vi.fn(),
  upsertLocalPurchase: vi.fn(),
}));
const inventory = (patch: Partial<LocalInventoryWithLabels> = {}) =>
  ({
    id: 10,
    title: "架空シャフト",
    etc: "シャフト_TEST,2026-09-01",
    quantity: 2,
    category: "部品",
    unitPrice: "100.25",
    supplierName: "架空仕入先",
    supplierUrl: "https://supplier.invalid",
    isDeleted: 0,
    ...patch,
  }) as LocalInventoryWithLabels;
const purchase = (patch: Partial<LocalPurchaseWithLabels> = {}) =>
  ({
    id: 1,
    managementNo: "TEST",
    itemsJson: "[]",
    ...patch,
  }) as LocalPurchaseWithLabels;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(upsertLocalPurchase).mockResolvedValue(undefined);
  vi.mocked(getLocalPurchases).mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());

describe("シャフト在庫から不足発注を補完", () => {
  it("削除済み・通常在庫・管理番号なしは補完せず元の一覧を返す", async () => {
    const rows = [purchase()];
    expect(
      await ensureShaftPurchases(rows, [
        inventory({ isDeleted: 1 }),
        inventory({ etc: "E0901_TEST" }),
        inventory({ etc: "" }),
      ])
    ).toBe(rows);
    expect(upsertLocalPurchase).not.toHaveBeenCalled();
    expect(getLocalPurchases).not.toHaveBeenCalled();
  });
  it("発注行または明細etcに同じ番号があると補完しない", async () => {
    const rows = [
      purchase({ managementNo: " シャフト_TEST " }),
      purchase({ id: 2, itemsJson: '[null,{"etc":" シャフト_OTHER ,日付"}]' }),
    ];
    expect(
      await ensureShaftPurchases(rows, [
        inventory(),
        inventory({ id: 20, etc: "シャフト_OTHER" }),
      ])
    ).toBe(rows);
    expect(upsertLocalPurchase).not.toHaveBeenCalled();
  });
  it("不足発注を在庫情報から作り、一度再取得して返す", async () => {
    const rows = [purchase()];
    const inventories = [inventory()];
    const original = structuredClone({ rows, inventories });
    const refreshed = [purchase({ id: 2 })];
    vi.mocked(getLocalPurchases).mockResolvedValue(refreshed);
    expect(await ensureShaftPurchases(rows, inventories)).toBe(refreshed);
    const saved = vi.mocked(upsertLocalPurchase).mock.calls[0][0];
    expect(saved).toMatchObject({
      zaicoId: null,
      purchaseNum: "シャフト_TEST",
      status: "ordered",
      localInventoryId: 10,
      title: "架空シャフト",
      quantity: 2,
      unitPrice: "100.25",
      category: "部品",
      managementNo: "シャフト_TEST",
      purchaseDate: "2026-09-01",
      receivedDate: null,
      supplierName: "架空仕入先",
      supplierUrl: "https://supplier.invalid",
    });
    expect(JSON.parse(saved.itemsJson)).toEqual([
      {
        id: 0,
        inventory_id: 10,
        title: "架空シャフト",
        quantity: "2",
        unit_price: "100.25",
        etc: "シャフト_TEST",
        status: "ordered",
        category: "部品",
      },
    ]);
    expect(saved).not.toHaveProperty("inboundClass");
    expect(getLocalPurchases).toHaveBeenCalledTimes(1);
    expect({ rows, inventories }).toEqual(original);
  });
  it.each([
    [0, 1],
    [-2, 1],
    [2.8, 2.8],
  ])("数量%sを既存どおり%sで保存する", async (quantity, expected) => {
    await ensureShaftPurchases(
      [],
      [inventory({ quantity, etc: "シャフト_TEST" })]
    );
    expect(upsertLocalPurchase).toHaveBeenCalledWith(
      expect.objectContaining({ quantity: expected, purchaseDate: null })
    );
  });
  it("不正JSONを無視し、明細managementNoだけでは補完済みとしない", async () => {
    await ensureShaftPurchases(
      [
        purchase({ itemsJson: "bad json" }),
        purchase({ id: 2, itemsJson: '[{"managementNo":"シャフト_TEST"}]' }),
      ],
      [inventory()]
    );
    expect(upsertLocalPurchase).toHaveBeenCalledTimes(1);
  });
  it("一件の保存失敗を記録して次を処理し、成功分があれば再取得する", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(upsertLocalPurchase).mockRejectedValueOnce(
      new Error("synthetic")
    );
    await ensureShaftPurchases(
      [],
      [inventory(), inventory({ id: 20, etc: "シャフト_OTHER" })]
    );
    expect(upsertLocalPurchase).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "[inventory] failed to backfill shaft purchase",
      { inventoryId: 10, managementNo: "シャフト_TEST", error: "synthetic" }
    );
    expect(getLocalPurchases).toHaveBeenCalledTimes(1);
  });
  it("すべての保存が失敗した場合は元の一覧を返す", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(upsertLocalPurchase).mockRejectedValue("synthetic");
    const rows = [purchase()];
    expect(await ensureShaftPurchases(rows, [inventory()])).toBe(rows);
    expect(getLocalPurchases).not.toHaveBeenCalled();
  });
  it("同じ管理番号の在庫が複数ある場合も既存どおり各在庫を保存する", async () => {
    await ensureShaftPurchases([], [inventory(), inventory({ id: 20 })]);
    expect(
      vi
        .mocked(upsertLocalPurchase)
        .mock.calls.map(([row]) => row.localInventoryId)
    ).toEqual([10, 20]);
    expect(getLocalPurchases).toHaveBeenCalledTimes(1);
  });
  it("管理番号内の空白を保持し、空入力は空文字にする", () => {
    expect(getInventoryManagementNo(" シャフト TEST , 日付 ")).toBe(
      "シャフト TEST"
    );
    expect(getInventoryManagementNo(null)).toBe("");
    expect(getInventoryManagementNo(undefined)).toBe("");
    expect(getInventoryManagementNo(",日付")).toBe("");
  });
});
