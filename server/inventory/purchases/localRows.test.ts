import { describe, expect, it } from "vitest";
import {
  attachPurchaseInventoryInfo,
  buildLocalPurchaseRow,
  createPurchaseInventoryMap,
} from "./localRows";
import type { PurchaseExtraView } from "./storedExtra";

function purchase() {
  return {
    id: 10,
    zaicoId: null as number | null,
    localInventoryId: 30,
    purchaseNum: "TEST-NUM",
    purchaseDate: "2026-09-01",
    status: "ordered",
    shipDate: null,
    trackingNumber: null as string | null,
    carrier: null,
    note: null,
    supplierName: null as string | null,
    supplierUrl: null,
    itemsJson: JSON.stringify([
      {
        inventoryId: 30,
        title: "明細の商品",
        quantity: "2",
        unit_price: "10.5",
        etc: " ",
        category: "明細カテゴリ",
        status: "ordered",
        custom: "保持",
      },
    ]),
    managementNo: "TEST-MANAGEMENT",
    category: "発注カテゴリ",
    title: "復元用商品名",
    quantity: 3,
    unitPrice: "12.00",
  };
}

function context() {
  return {
    extrasById: new Map<number, PurchaseExtraView>(),
    inventoryById: createPurchaseInventoryMap([
      {
        id: 30,
        supplierName: "在庫仕入先",
        supplierUrl: "https://supplier.invalid",
        ebayListingUrl: "https://listing.invalid",
        quantity: 0,
      },
    ]),
    getDisplayStatus: (row: ReturnType<typeof purchase>) => row.status,
    getItemLabels: (
      _row: ReturnType<typeof purchase>,
      _item: Record<string, unknown>
    ) => [{ labelId: "LABEL-1", status: "ordered" }],
  };
}

describe("ローカル発注の一覧行への変換", () => {
  it("発注・明細・在庫の従来の優先順位を保ち、入力を変更しない", () => {
    const source = purchase();
    const original = structuredClone(source);
    const ctx = context();
    const row = buildLocalPurchaseRow(source, ctx);
    attachPurchaseInventoryInfo([row], ctx.inventoryById);
    expect(row).toMatchObject({
      id: 10,
      num: "TEST-NUM",
      csvSupplierName: "在庫仕入先",
      csvSupplierUrl: "https://supplier.invalid",
      inboundClass: null,
      classSource: "auto",
      stage: "received",
    });
    expect(row.purchase_items[0]).toMatchObject({
      inventory_id: 30,
      title: "明細の商品",
      quantity: "2",
      unit_price: "10.5",
      category: "発注カテゴリ",
      etc: "TEST-MANAGEMENT",
      custom: "保持",
      currentInventoryQuantity: 0,
      ebayListingUrl: "https://listing.invalid",
      itemLabels: [{ labelId: "LABEL-1", status: "ordered" }],
    });
    expect(source).toEqual(original);
  });

  it("外部ID・手動分類・工程を保持し、仕入先の空文字は置換しない", () => {
    const source = { ...purchase(), zaicoId: 20, supplierName: "" };
    const row = buildLocalPurchaseRow(source, {
      ...context(),
      inbound: {
        inboundClass: "direct",
        classSource: "manual",
        stage: "registered",
        stageUpdatedBy: "架空担当者",
        shaftParentPurchaseId: 5,
      },
    });
    expect(row).toMatchObject({
      id: 20,
      csvSupplierName: "",
      inboundClass: "direct",
      classSource: "manual",
      stage: "registered",
      stageUpdatedBy: "架空担当者",
      shaftParentPurchaseId: 5,
    });
  });

  it("状態・ラベルの判定には追加情報を補完した行と元の明細を渡す", () => {
    const ctx = context();
    ctx.extrasById.set(10, { zaicoId: 10, trackingNumber: "EXTRA-TRACK" });
    const row = buildLocalPurchaseRow(purchase(), {
      ...ctx,
      getDisplayStatus: source =>
        source.trackingNumber ? "shipped" : "ordered",
      getItemLabels: (source, item) => [
        {
          labelId: `${source.trackingNumber}:${item.inventoryId}`,
          status: "ordered",
        },
      ],
    });
    expect(row.status).toBe("shipped");
    expect(row.purchase_items[0]).toMatchObject({
      status: "shipped",
      itemLabels: [{ labelId: "EXTRA-TRACK:30" }],
    });
  });

  it("発送済み・入庫済みだけ明細の状態を上書きする", () => {
    for (const status of ["ordered", "shipped", "purchased"]) {
      const row = buildLocalPurchaseRow(
        { ...purchase(), itemsJson: '[{"status":"item-original"}]' },
        { ...context(), getDisplayStatus: () => status }
      );
      expect(row.purchase_items[0].status).toBe(
        status === "ordered" ? "item-original" : status
      );
    }
  });

  it("壊れたJSONやnullを含む配列は発注行から明細を復元する", () => {
    for (const itemsJson of ["{broken", "[null]"]) {
      const row = buildLocalPurchaseRow(
        { ...purchase(), itemsJson },
        context()
      );
      expect(row.purchase_items).toHaveLength(1);
      expect(row.purchase_items[0]).toMatchObject({
        id: 10,
        title: "復元用商品名",
        quantity: "3",
        unit_price: "12.00",
        inventory_id: 30,
        etc: "TEST-MANAGEMENT",
      });
    }
  });

  it("有効なJSONでも配列でなければ空明細とし、空配列もそのままにする", () => {
    for (const itemsJson of ["[]", "{}", "null", '"text"']) {
      expect(
        buildLocalPurchaseRow({ ...purchase(), itemsJson }, context())
          .purchase_items
      ).toEqual([]);
    }
  });

  it("在庫IDを数値化し、参照先がない場合は在庫情報をnullにする", () => {
    const ctx = context();
    const row = buildLocalPurchaseRow(
      { ...purchase(), itemsJson: '[{"inventory_id":"not-a-number"}]' },
      ctx
    );
    attachPurchaseInventoryInfo([row], ctx.inventoryById);
    expect(row.purchase_items[0]).toMatchObject({
      inventory_id: null,
      currentInventoryQuantity: null,
      ebayListingUrl: null,
    });
    const mapped = createPurchaseInventoryMap([
      {
        id: 30,
        supplierName: "古い値",
        supplierUrl: null,
        ebayListingUrl: null,
        quantity: 1,
      },
      {
        id: 30,
        supplierName: "新しい値",
        supplierUrl: null,
        ebayListingUrl: null,
        quantity: 0,
      },
    ]);
    expect(mapped.get(30)).toMatchObject({
      supplierName: "新しい値",
      quantity: 0,
    });
  });
});
