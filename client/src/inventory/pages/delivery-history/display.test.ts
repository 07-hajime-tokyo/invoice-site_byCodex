import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateShort,
  formatPrice,
  getActiveHistoryItems,
  getManagementNo,
  getSupplierSite,
  parseCancelledItems,
} from "./display";

/** 出庫履歴画面の表示ロジックの整理前基準（現行出力の固定） */

describe("getManagementNo", () => {
  it("カンマ区切りの先頭を管理番号として返す（数字・在庫・ebay・デボン系）", () => {
    expect(getManagementNo("379-1, 2026-01-05, 架空商店")).toBe("379-1");
    expect(getManagementNo("在庫123")).toBe("在庫123");
    expect(getManagementNo("ebayX")).toBe("ebayX");
    // Deliveries側と異なりスペース分割せず、デボン/devonは位置を問わず一致する
    expect(getManagementNo("379-1 メモ")).toBe("379-1 メモ");
    expect(getManagementNo("メモ devon")).toBe("メモ devon");
  });
  it("対象外の接頭辞や空は空文字", () => {
    expect(getManagementNo(undefined)).toBe("");
    expect(getManagementNo("")).toBe("");
    expect(getManagementNo("メモのみ")).toBe("");
  });
});

describe("getSupplierSite", () => {
  it("etcの3番目の要素を返す", () => {
    expect(getSupplierSite("379-1, 2026-01-05, 架空商店")).toBe("架空商店");
    expect(getSupplierSite("379-1, 2026-01-05")).toBe("");
    expect(getSupplierSite(undefined)).toBe("");
  });
});

describe("formatPrice / formatDate / formatDateShort", () => {
  it("円表記へ整形しnull/undefinedはハイフン（NaNはそのまま整形される現行仕様）", () => {
    expect(formatPrice(1500)).toBe("¥1,500");
    expect(formatPrice(0)).toBe("¥0");
    expect(formatPrice(null)).toBe("-");
    expect(formatPrice(undefined)).toBe("-");
    expect(formatPrice(Number.NaN)).toBe("¥NaN");
  });
  it("日時をja-JP表記へ整形する", () => {
    expect(formatDate(new Date(2026, 3, 8, 12, 34))).toBe("2026/04/08 12:34");
  });
  it("日付文字列の先頭10文字を返す", () => {
    expect(formatDateShort("2026-04-08T12:34:00Z")).toBe("2026-04-08");
  });
});

describe("parseCancelledItems / getActiveHistoryItems", () => {
  it("JSONをパースし、不正・空は空配列", () => {
    expect(parseCancelledItems(null)).toEqual([]);
    expect(parseCancelledItems("not-json")).toEqual([]);
    expect(
      parseCancelledItems('[{"inventoryId":1,"quantity":2,"cancelledAt":"2026-01-01"}]'),
    ).toEqual([{ inventoryId: 1, quantity: 2, cancelledAt: "2026-01-01" }]);
  });
  it("取消済みinventoryIdを除いた商品を返す", () => {
    const history = {
      items: [
        { inventoryId: 1, title: "A", quantity: 2 },
        { inventoryId: 2, title: "B", quantity: 1 },
      ],
      cancelledItemsJson: '[{"inventoryId":1,"quantity":2,"cancelledAt":"2026-01-01"}]',
    };
    expect(getActiveHistoryItems(history)).toEqual([{ inventoryId: 2, title: "B", quantity: 1 }]);
    expect(getActiveHistoryItems({ items: null })).toEqual([]);
  });
});
