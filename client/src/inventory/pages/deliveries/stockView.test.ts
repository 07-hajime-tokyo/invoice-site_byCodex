import { describe, expect, it } from "vitest";
import {
  calcCategoryTotals,
  extractPrefixFromManagementNo,
  lookupSellingPrice,
  type SellingPriceCsvRow,
} from "./stockView";
import type { InventoryItem } from "./types";

const baseInv: InventoryItem = {
  id: 1,
  title: "PSP 2000 シルバー",
  quantity: "2",
  unit: "個",
  etc: "371_ルカ_PSP2000, 2026-01-05",
};

describe("calcCategoryTotals", () => {
  it("在庫数1以上かつ単価ありの在庫をカテゴリ別に金額集計する", () => {
    const totals = calcCategoryTotals([
      { ...baseInv, category: "PSP2000", purchase_unit_price: 1000 },
      { ...baseInv, id: 2, title: "PSP 3000 グリーン", quantity: "0", category: "PSP3000", purchase_unit_price: 800 },
      { ...baseInv, id: 3, title: "ゲームボーイ", quantity: "1", etc: undefined, unit_price: 500 },
      { ...baseInv, id: 4, title: "数量未設定", quantity: undefined as unknown as string, category: "PSP2000", purchase_unit_price: 300 },
      { ...baseInv, id: 5, title: "値段なし", quantity: "3", category: "PSP3000" },
    ]);
    expect(totals.get("PSP2000")).toBe(2000);
    expect(totals.get("未分類")).toBe(500);
    expect(totals.get("PSP3000")).toBeUndefined();
    expect(totals.size).toBe(2);
  });
  it("purchase_unit_priceがunit_priceより優先される", () => {
    const totals = calcCategoryTotals([
      { ...baseInv, category: "PSP2000", purchase_unit_price: 1200, unit_price: 999 },
    ]);
    expect(totals.get("PSP2000")).toBe(2400);
  });
  it("inventories未取得は空Map", () => {
    expect(calcCategoryTotals(undefined).size).toBe(0);
  });
});

describe("extractPrefixFromManagementNo", () => {
  it("管理番号の先頭数字を返す", () => {
    expect(extractPrefixFromManagementNo("371_ルカ_New3DS_8/10, 2026-01-05")).toBe("371");
    expect(extractPrefixFromManagementNo("379-1, 2026-01-05, 架空商店")).toBe("379");
  });
  it("数字始まりでない管理番号・管理番号なしはundefined", () => {
    expect(extractPrefixFromManagementNo("E0618_01")).toBeUndefined();
    expect(extractPrefixFromManagementNo("メモのみ")).toBeUndefined();
    expect(extractPrefixFromManagementNo(undefined)).toBeUndefined();
  });
});

describe("lookupSellingPrice", () => {
  const csvRows: SellingPriceCsvRow[] = [
    { invoiceNo: "371", productName: "PSP 2000", sellingPrice: 60, currency: "EUR" },
    { invoiceNo: "371", productName: "New 3DS LL", sellingPrice: 80, currency: "EUR" },
    { invoiceNo: "372", productName: "", sellingPrice: null, currency: "" },
    { invoiceNo: "372", productName: "GameBoy", sellingPrice: 40, currency: "USD" },
    { invoiceNo: "373", productName: "SegaSaturn", sellingPrice: null, currency: "EUR" },
  ];

  it("管理番号prefixのインボイス内で商品名部分一致した行の価格を返す", () => {
    expect(lookupSellingPrice(csvRows, baseInv)).toEqual({ sellingPrice: 60, currency: "EUR" });
  });
  it("管理番号prefixはinvoiceNoOverrideより優先される", () => {
    expect(lookupSellingPrice(csvRows, baseInv, "372")).toEqual({ sellingPrice: 60, currency: "EUR" });
  });
  it("部分一致なしなら同インボイス先頭のsellingPrice付き行へフォールバック", () => {
    expect(
      lookupSellingPrice(csvRows, { ...baseInv, title: "Wii U" }),
    ).toEqual({ sellingPrice: 60, currency: "EUR" });
  });
  it("管理番号なしはinvoiceNoOverrideで照合（空productName行はスキップ）", () => {
    expect(
      lookupSellingPrice(csvRows, { ...baseInv, title: "GameBoy Advance SP", etc: undefined }, "372"),
    ).toEqual({ sellingPrice: 40, currency: "USD" });
  });
  it("照合もフォールバックも不発ならnull", () => {
    expect(lookupSellingPrice(csvRows, { ...baseInv, etc: "999_該当なし" })).toEqual({ sellingPrice: null, currency: "" });
    expect(lookupSellingPrice(csvRows, { ...baseInv, title: "メガドライブ", etc: "373_サターン" })).toEqual({ sellingPrice: null, currency: "" });
    expect(lookupSellingPrice(csvRows, { ...baseInv, etc: undefined })).toEqual({ sellingPrice: null, currency: "" });
    expect(lookupSellingPrice([], baseInv)).toEqual({ sellingPrice: null, currency: "" });
    expect(lookupSellingPrice(undefined, baseInv)).toEqual({ sellingPrice: null, currency: "" });
  });
});
