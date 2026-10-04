import { beforeEach, describe, expect, it, vi } from "vitest";
import { getInventory, updateInventory, updatePurchase } from "../zaico";
import {
  isZaicoEnabled,
  getInventoryExtraByZaicoId,
  upsertInventoryExtra,
} from "../db";
import { savePurchaseEdit } from "./saveEdit";
import { savePurchaseSupplier } from "./saveSupplier";
vi.mock("../zaico", () => ({
  getInventory: vi.fn(),
  updateInventory: vi.fn(),
  updatePurchase: vi.fn(),
}));
vi.mock("../db", () => ({
  isZaicoEnabled: vi.fn(),
  getInventoryExtraByZaicoId: vi.fn(),
  upsertInventoryExtra: vi.fn(),
}));
const deps = { recordSnapshot: vi.fn(), getOperatorName: () => "TEST" };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(isZaicoEnabled).mockResolvedValue(true);
  vi.mocked(upsertInventoryExtra).mockResolvedValue(undefined);
});
describe("現在無効の外部保存経路の固定値契約", () => {
  it("明細IDがなければ発注更新前に拒否する", async () => {
    await expect(
      savePurchaseEdit(
        { purchaseId: 1, purchaseItems: [{ inventoryId: 10, title: "架空" }] },
        deps
      )
    ).rejects.toThrow("発注明細IDが必要");
    expect(updatePurchase).not.toHaveBeenCalled();
  });
  it("発注を先に更新し、在庫の名称・カテゴリを別途反映する", async () => {
    vi.mocked(getInventory).mockResolvedValue({
      id: 10,
      title: "旧名",
      quantity: "5",
      unit: "個",
      place: "架空倉庫",
    } as Awaited<ReturnType<typeof getInventory>>);
    await savePurchaseEdit(
      {
        purchaseId: 1,
        customerName: "架空",
        purchaseItems: [
          {
            id: 2,
            inventoryId: 10,
            title: "新名",
            quantity: 3,
            unitPrice: 100.25,
            category: " 部品 ",
            etc: "TEST",
          },
        ],
      },
      deps
    );
    expect(updatePurchase).toHaveBeenCalledWith(
      1,
      {
        customer_name: "架空",
        purchase_items: [
          {
            id: 2,
            inventory_id: 10,
            quantity: 3,
            unit_price: 100.25,
            etc: "TEST",
          },
        ],
      },
      undefined
    );
    expect(updateInventory).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        title: "新名",
        quantity: "5",
        category: "部品",
        etc: "TEST",
        purchase_unit_price: 100.25,
      }),
      undefined
    );
    expect(vi.mocked(updatePurchase).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getInventory).mock.invocationCallOrder[0]
    );
    expect(deps.recordSnapshot).not.toHaveBeenCalled();
  });
  it("在庫同期だけの失敗は既存どおり成功を返し、発注更新失敗は返す", async () => {
    vi.mocked(getInventory).mockRejectedValue(new Error("synthetic inventory"));
    await expect(
      savePurchaseEdit(
        {
          purchaseId: 1,
          purchaseItems: [{ id: 2, inventoryId: 10, title: "新名" }],
        },
        deps
      )
    ).resolves.toEqual({ success: true });
    vi.mocked(updatePurchase).mockRejectedValue(
      new Error("synthetic purchase")
    );
    await expect(savePurchaseEdit({ purchaseId: 1 }, deps)).rejects.toThrow(
      "synthetic purchase"
    );
  });
  it("仕入先URLを補完し、空入力では外部追加情報の既存URLを保持する", async () => {
    vi.mocked(getInventoryExtraByZaicoId).mockResolvedValue({
      supplierUrl: "https://supplier.invalid/old",
    } as NonNullable<Awaited<ReturnType<typeof getInventoryExtraByZaicoId>>>);
    await savePurchaseSupplier({
      inventoryId: 10,
      supplierName: "架空",
      supplierUrl: " example.invalid/new ",
    });
    expect(upsertInventoryExtra).toHaveBeenLastCalledWith({
      zaicoInventoryId: 10,
      supplierName: "架空",
      supplierUrl: "https://example.invalid/new",
    });
    await savePurchaseSupplier({
      inventoryId: 10,
      supplierName: null,
      supplierUrl: "",
    });
    expect(upsertInventoryExtra).toHaveBeenLastCalledWith({
      zaicoInventoryId: 10,
      supplierName: null,
      supplierUrl: "https://supplier.invalid/old",
    });
  });
});
