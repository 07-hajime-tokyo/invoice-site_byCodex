import { describe, expect, it } from "vitest";
import { buildColorSummary } from "./colorSummary";
import type { SummaryItem } from "./types";

/** 発注管理画面のカラー別集計の整理前基準（現行出力の固定） */

function makeItem(partial: Partial<SummaryItem>): SummaryItem {
  return {
    key: "369",
    partner: "ルカ",
    csvOrderQty: 0,
    csvStatus: "",
    manualComplete: false,
    csvProducts: [],
    orderedCount: 0,
    purchasedCount: 0,
    deliveredCount: 0,
    stockCount: 0,
    purchaseItems: [],
    inventoryItems: [],
    deliveryItems: [],
    ...partial,
  };
}

describe("buildColorSummary", () => {
  it("取引データ商品がなければ空配列", () => {
    expect(buildColorSummary(makeItem({}))).toEqual([]);
  });

  it("機種+カラーでグループ化し発注数を集計する", () => {
    const item = makeItem({
      csvProducts: [
        { name: "PS Vita 2000 アクアブルー", qty: 3, status: "", paymentDate: "" },
        { name: "PS Vita 2000 ブラック", qty: 2, status: "", paymentDate: "" },
        { name: "PS Vita 2000 アクアブルー", qty: 1, status: "", paymentDate: "" },
      ],
    });
    const result = buildColorSummary(item);
    expect(result.map((cs) => cs.colorName)).toEqual([
      "Vita2000 アクアブルー",
      "Vita2000 ブラック",
    ]);
    expect(result[0].csvQty).toBe(4);
    expect(result[1].csvQty).toBe(2);
  });

  it("発注・在庫・出庫をカラー照合して集計する", () => {
    const item = makeItem({
      csvProducts: [
        { name: "PS Vita 2000 アクアブルー", qty: 3, status: "", paymentDate: "" },
        { name: "PS Vita 2000 ブラック", qty: 2, status: "", paymentDate: "" },
      ],
      purchaseItems: [
        { purchaseId: 1, num: "P1", title: "PS Vita 2000 アクアブルー 本体", quantity: 2, status: "purchased", managementNo: "" },
        { purchaseId: 2, num: "P2", title: "PS Vita 2000 ブラック 本体", quantity: 1, status: "ordered", managementNo: "" },
      ],
      inventoryItems: [
        { inventoryId: 10, title: "PS Vita 2000 ブラック", quantity: 4, managementNo: "", etc: "" },
      ],
      deliveryItems: [
        { deliveryNo: "100", title: "PS Vita 2000 アクアブルー", quantity: 1, deliveredAt: "2026-01-15T00:00:00.000Z", managementNo: "" },
      ],
    });
    const result = buildColorSummary(item);
    const aqua = result.find((cs) => cs.colorName === "Vita2000 アクアブルー")!;
    const black = result.find((cs) => cs.colorName === "Vita2000 ブラック")!;
    expect(aqua.zaicoCount).toBe(2);
    expect(aqua.purchasedCount).toBe(2);
    expect(aqua.deliveredCount).toBe(1);
    expect(black.zaicoCount).toBe(1);
    expect(black.purchasedCount).toBe(0);
    expect(black.stockCount).toBe(4);
  });

  it("ランダムカラーは機種一致のみで集計する", () => {
    const item = makeItem({
      csvProducts: [
        { name: "New 3DS ランダムカラー", qty: 5, status: "", paymentDate: "" },
      ],
      purchaseItems: [
        { purchaseId: 1, num: "P1", title: "New 3DS 本体 ホワイト", quantity: 2, status: "ordered", managementNo: "" },
      ],
      inventoryItems: [
        { inventoryId: 10, title: "New 3DS ブラック", quantity: 1, managementNo: "", etc: "" },
      ],
    });
    const result = buildColorSummary(item);
    expect(result).toHaveLength(1);
    expect(result[0].zaicoCount).toBe(2);
    expect(result[0].stockCount).toBe(1);
  });

  it("スプシ発送管理ソース時は sheetShipmentItems を出庫数に使う", () => {
    const item = makeItem({
      csvProducts: [
        { name: "PS Vita 2000 アクアブルー", qty: 3, status: "", paymentDate: "" },
      ],
      shipmentProgressSource: "sheet",
      deliveryItems: [
        { deliveryNo: "100", title: "PS Vita 2000 アクアブルー", quantity: 9, deliveredAt: "2026-01-15T00:00:00.000Z", managementNo: "" },
      ],
      sheetShipmentItems: [
        { deliveryNo: "S1", title: "PS Vita 2000 アクアブルー", quantity: 2, deliveredAt: "2026-01-15T00:00:00.000Z", managementNo: "" },
      ],
    });
    const result = buildColorSummary(item);
    expect(result[0].deliveredCount).toBe(2);
  });

  it("限定版マーカーは限定版同士のみ照合する", () => {
    const item = makeItem({
      csvProducts: [
        { name: "New 3DS LL 限定版モデル", qty: 1, status: "", paymentDate: "" },
        { name: "New 3DS LL ブラック", qty: 1, status: "", paymentDate: "" },
      ],
      inventoryItems: [
        { inventoryId: 10, title: "New 3DS LL 限定版モデル 本体", quantity: 1, managementNo: "", etc: "" },
      ],
    });
    const result = buildColorSummary(item);
    const limited = result.find((cs) => cs.colorName.includes("限定版"))!;
    expect(limited.stockCount).toBe(1);
  });
});
