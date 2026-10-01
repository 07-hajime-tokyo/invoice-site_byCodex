import { describe, expect, it } from "vitest";
import {
  csvProductGroupKey,
  findCsvProductByTitleAndManagement,
  findDeliveryCsvProduct,
  suggestCsvProductNameWithFallback,
} from "./csvProductMatching";
import type { DeliveryItem, SummaryItem } from "./types";

/** 発注管理画面の取引データ商品照合の整理前基準（現行出力の固定） */

function makeItem(csvProducts: Array<{ name: string; qty: number }>): SummaryItem {
  return {
    key: "369",
    partner: "ルカ",
    csvOrderQty: csvProducts.reduce((sum, p) => sum + p.qty, 0),
    csvStatus: "",
    manualComplete: false,
    csvProducts: csvProducts.map((p) => ({ ...p, status: "", paymentDate: "" })),
    orderedCount: 0,
    purchasedCount: 0,
    deliveredCount: 0,
    stockCount: 0,
    purchaseItems: [],
    inventoryItems: [],
    deliveryItems: [],
  };
}

function makeDelivery(partial: Partial<DeliveryItem>): DeliveryItem {
  return {
    deliveryNo: "100",
    title: "",
    quantity: 1,
    deliveredAt: "2026-01-15T00:00:00.000Z",
    managementNo: "",
    ...partial,
  };
}

describe("csvProductGroupKey", () => {
  it("機種とカラーを結合したグループキーを返す", () => {
    expect(csvProductGroupKey("PS Vita 2000 アクアブルー")).toBe("Vita2000 アクアブルー");
    expect(csvProductGroupKey("New 3DS ランダムカラー")).toBe("New3DS ランダムカラー");
    expect(csvProductGroupKey("コズミックレッド")).toBe("コズミックレッド");
    expect(csvProductGroupKey("PSP")).toBe("PSP");
  });
});

describe("suggestCsvProductNameWithFallback", () => {
  const candidates = [
    { name: "PS Vita 2000 アクアブルー", qty: 5 },
    { name: "PS Vita 2000 ブラック", qty: 5 },
    { name: "New 3DS ランダムカラー", qty: 3 },
  ];
  it("suggestCsvProduct の結果があればそれを返す", () => {
    expect(
      suggestCsvProductNameWithFallback("PSVita 2000 本体 アクアブルー", "", candidates),
    ).toBe("PS Vita 2000 アクアブルー");
  });
  it("提案がなく同機種候補が1件のみならフォールバックする", () => {
    expect(
      suggestCsvProductNameWithFallback("New 3DS 本体のみ", "", candidates),
    ).toBe("New 3DS ランダムカラー");
  });
  it("同機種候補が複数または機種不明なら null", () => {
    expect(suggestCsvProductNameWithFallback("まったく関係ない商品", "", candidates)).toBe(null);
  });
});

describe("findDeliveryCsvProduct", () => {
  const item = makeItem([
    { name: "PS Vita 2000 アクアブルー", qty: 5 },
    { name: "New 3DS ランダムカラー", qty: 3 },
  ]);
  it("保存済み csvProductName の完全一致を優先する", () => {
    const delivery = makeDelivery({ title: "別名", csvProductName: "New 3DS ランダムカラー" });
    expect(findDeliveryCsvProduct(item, delivery)?.name).toBe("New 3DS ランダムカラー");
  });
  it("タイトルからの提案で照合する", () => {
    const delivery = makeDelivery({ title: "PSVita 2000 アクアブルー 本体" });
    expect(findDeliveryCsvProduct(item, delivery)?.name).toBe("PS Vita 2000 アクアブルー");
  });
  it("照合できなければ null", () => {
    const delivery = makeDelivery({ title: "該当なし商品" });
    expect(findDeliveryCsvProduct(item, delivery)).toBe(null);
  });
});

describe("findCsvProductByTitleAndManagement", () => {
  const item = makeItem([
    { name: "PS Vita 2000 アクアブルー", qty: 5 },
    { name: "New 3DS ランダムカラー", qty: 3 },
  ]);
  it("タイトルと管理番号から取引データ商品を解決する", () => {
    expect(
      findCsvProductByTitleAndManagement(item, "PSVita 2000 アクアブルー 本体", "369_ルカ")?.name,
    ).toBe("PS Vita 2000 アクアブルー");
  });
  it("解決できなければ null", () => {
    expect(findCsvProductByTitleAndManagement(item, "該当なし商品", "")).toBe(null);
  });
});
