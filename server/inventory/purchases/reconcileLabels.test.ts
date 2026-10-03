import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensureInventoryItemLabels,
  getLocalPurchases,
  type LocalPurchaseWithLabels,
} from "../db";
import { reconcileLocalPurchaseLabelQuantities } from "./reconcileLabels";

vi.mock("../db", () => ({
  ensureInventoryItemLabels: vi.fn(),
  getLocalPurchases: vi.fn(),
}));

const purchase = (patch: Partial<LocalPurchaseWithLabels> = {}) =>
  ({
    id: 1,
    localInventoryId: 10,
    managementNo: "TEST",
    itemsJson: "[]",
    quantity: 1,
    title: "架空",
    status: "ordered",
    itemLabels: ["AA", "BB", "CC"].map(labelId => ({
      labelId,
      status: "ordered",
      localInventoryId: 10,
      legacyManagementNo: "TEST",
    })),
    ...patch,
  }) as LocalPurchaseWithLabels;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(ensureInventoryItemLabels).mockResolvedValue([]);
  vi.mocked(getLocalPurchases).mockResolvedValue([]);
});

describe("一覧取得時の余剰ラベル調整", () => {
  it("数量が足りるかラベルが不足するだけなら書き込まず、元の一覧を返す", async () => {
    const rows = [purchase({ quantity: 3 }), purchase({ id: 2, quantity: 10 })];
    expect(await reconcileLocalPurchaseLabelQuantities(rows)).toBe(rows);
    expect(ensureInventoryItemLabels).not.toHaveBeenCalled();
    expect(getLocalPurchases).not.toHaveBeenCalled();
  });
  it("余剰があると既存DB関数に削除判断を任せ、一度だけ再読取する", async () => {
    const rows = [purchase({ status: "purchased", quantity: 2 })];
    const original = structuredClone(rows);
    const refreshed = [purchase({ itemLabels: [] })];
    vi.mocked(getLocalPurchases).mockResolvedValue(refreshed);
    expect(await reconcileLocalPurchaseLabelQuantities(rows)).toBe(refreshed);
    expect(vi.mocked(ensureInventoryItemLabels).mock.calls).toEqual([
      [
        {
          purchaseId: 1,
          localInventoryId: 10,
          legacyManagementNo: "TEST",
          title: "架空",
          quantity: 2,
          status: "received",
          sourceKey: "management:TEST",
        },
      ],
    ]);
    expect(getLocalPurchases).toHaveBeenCalledTimes(1);
    expect(rows).toEqual(original);
  });
  it.each([0, -2, 1.9, Number.NaN])(
    "数量%jを切り捨て・最低1で扱う",
    async quantity => {
      await reconcileLocalPurchaseLabelQuantities([purchase({ quantity })]);
      expect(ensureInventoryItemLabels).toHaveBeenCalledWith(
        expect.objectContaining({ quantity: 1, status: "ordered" })
      );
    }
  );
  it("在庫と管理番号の異なるラベルを余剰と判定しない", async () => {
    const row = purchase();
    row.itemLabels![1].legacyManagementNo = "OTHER";
    row.itemLabels![2].localInventoryId = 20;
    expect(await reconcileLocalPurchaseLabelQuantities([row])).toEqual([row]);
    expect(ensureInventoryItemLabels).not.toHaveBeenCalled();
  });
  it("明細の番号・在庫・数量・商品名を優先し、行の値を変更しない", async () => {
    const row = purchase({
      quantity: 100,
      itemsJson: JSON.stringify([
        {
          inventoryId: 10,
          managementNo: "TEST",
          quantity: 2,
          title: " 明細名 ",
        },
      ]),
    });
    await reconcileLocalPurchaseLabelQuantities([row]);
    expect(ensureInventoryItemLabels).toHaveBeenCalledWith(
      expect.objectContaining({
        localInventoryId: 10,
        quantity: 2,
        title: "明細名",
      })
    );
    expect(row.quantity).toBe(100);
  });
  it("管理番号・在庫・商品名が無い場合の既存の保存値を保持する", async () => {
    const row = purchase({
      localInventoryId: null,
      managementNo: null,
      title: "",
      itemLabels: [
        { labelId: "AA" },
        { labelId: "BB" },
      ] as LocalPurchaseWithLabels["itemLabels"],
    });
    await reconcileLocalPurchaseLabelQuantities([row]);
    expect(ensureInventoryItemLabels).toHaveBeenCalledWith({
      purchaseId: 1,
      localInventoryId: null,
      legacyManagementNo: null,
      title: "商品",
      quantity: 1,
      status: "ordered",
      sourceKey: null,
    });
  });
  it("更新を逐次実行し、すべて成功してから再読取する", async () => {
    const events: string[] = [];
    vi.mocked(ensureInventoryItemLabels).mockImplementation(async input => {
      events.push(`start:${input.purchaseId}`);
      await Promise.resolve();
      events.push(`end:${input.purchaseId}`);
      return [];
    });
    vi.mocked(getLocalPurchases).mockImplementation(async () => {
      events.push("read");
      return [];
    });
    await reconcileLocalPurchaseLabelQuantities([
      purchase(),
      purchase({ id: 2 }),
    ]);
    expect(events).toEqual(["start:1", "end:1", "start:2", "end:2", "read"]);
  });
  it("保存に失敗したら後続の更新・再読取を行わずエラーを返す", async () => {
    const failure = new Error("synthetic write");
    vi.mocked(ensureInventoryItemLabels).mockRejectedValue(failure);
    await expect(
      reconcileLocalPurchaseLabelQuantities([purchase(), purchase({ id: 2 })])
    ).rejects.toBe(failure);
    expect(ensureInventoryItemLabels).toHaveBeenCalledTimes(1);
    expect(getLocalPurchases).not.toHaveBeenCalled();
  });
});
