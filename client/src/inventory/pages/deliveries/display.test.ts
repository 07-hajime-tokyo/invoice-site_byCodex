import { describe, expect, it } from "vitest";
import {
  calcDaysSince,
  daysBadgeClass,
  formatPrice,
  getInventoryDisplayCategory,
  getInventoryLabelIds,
  getManagementNo,
  normalizeInventoryCategoryName,
} from "./display";
import type { InventoryItem } from "./types";

/** 出庫画面の表示ロジックの整理前基準（現行出力の固定） */

const baseInv: InventoryItem = {
  id: 1,
  title: "テスト商品",
  quantity: "2",
  unit: "個",
};

describe("normalizeInventoryCategoryName / getInventoryDisplayCategory", () => {
  it("Vita1000系の表記ゆれを1カテゴリへ寄せる", () => {
    expect(normalizeInventoryCategoryName("PS Vita 1000", null)).toBe("Vita1000");
    expect(normalizeInventoryCategoryName("pch-1100", null)).toBe("Vita1000");
    expect(normalizeInventoryCategoryName(null, "PSVITA　1000 本体")).toBe("Vita1000");
    expect(normalizeInventoryCategoryName("vita_1100", null)).toBe("Vita1000");
  });
  it("それ以外はカテゴリ名を維持し空なら未分類", () => {
    expect(normalizeInventoryCategoryName("ゲーム機", "スイッチ")).toBe("ゲーム機");
    expect(normalizeInventoryCategoryName("  ", null)).toBe("未分類");
    expect(normalizeInventoryCategoryName(undefined, undefined)).toBe("未分類");
  });
  it("categories配列の先頭を優先する", () => {
    expect(
      getInventoryDisplayCategory({ ...baseInv, category: "B", categories: ["A"] }),
    ).toBe("A");
    expect(getInventoryDisplayCategory({ ...baseInv, category: "B" })).toBe("B");
  });
});

describe("calcDaysSince / daysBadgeClass", () => {
  it("経過日数を切り捨てで返し不正値はnull", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000 - 60 * 1000);
    expect(calcDaysSince(threeDaysAgo.toISOString())).toBe(3);
    expect(calcDaysSince(null)).toBeNull();
    expect(calcDaysSince(undefined)).toBeNull();
    expect(calcDaysSince("not-a-date")).toBeNull();
  });
  it("経過日数の区分ごとに同じ色クラスを返す", () => {
    expect(daysBadgeClass(0)).toBe("bg-green-100 text-green-800 border-green-200");
    expect(daysBadgeClass(14)).toBe("bg-green-100 text-green-800 border-green-200");
    expect(daysBadgeClass(15)).toBe("bg-yellow-100 text-yellow-800 border-yellow-200");
    expect(daysBadgeClass(30)).toBe("bg-yellow-100 text-yellow-800 border-yellow-200");
    expect(daysBadgeClass(31)).toBe("bg-orange-100 text-orange-800 border-orange-200");
    expect(daysBadgeClass(60)).toBe("bg-orange-100 text-orange-800 border-orange-200");
    expect(daysBadgeClass(61)).toBe("bg-red-100 text-red-800 border-red-200");
  });
});

describe("formatPrice", () => {
  it("円表記へ整形し無効値はハイフン", () => {
    expect(formatPrice(1500)).toBe("¥1,500");
    expect(formatPrice(0)).toBe("¥0");
    expect(formatPrice(null)).toBe("-");
    expect(formatPrice(undefined)).toBe("-");
    expect(formatPrice(Number.NaN)).toBe("-");
    expect(formatPrice(Number.POSITIVE_INFINITY)).toBe("-");
  });
});

describe("getManagementNo", () => {
  it("カンマ・スペース区切りの先頭を管理番号として返す", () => {
    expect(getManagementNo("379-1, 2026-01-05, 架空商店")).toBe("379-1");
    expect(getManagementNo("379-1 メモ")).toBe("379-1");
    expect(getManagementNo("在庫123")).toBe("在庫123");
    expect(getManagementNo("ebayX")).toBe("ebayX");
    expect(getManagementNo("E123")).toBe("E123");
    expect(getManagementNo("シャフト1")).toBe("シャフト1");
  });
  it("対象外の接頭辞や空は空文字", () => {
    expect(getManagementNo(undefined)).toBe("");
    expect(getManagementNo("")).toBe("");
    expect(getManagementNo("メモのみ")).toBe("");
  });
});

describe("getInventoryLabelIds", () => {
  it("itemLabelsからlabelIdだけを抽出し空値を除く", () => {
    expect(
      getInventoryLabelIds({
        ...baseInv,
        itemLabels: [
          { labelId: "AAAAA" },
          { labelId: "" },
          { labelId: "BBBBB", status: "stocked" },
        ],
      }),
    ).toEqual(["AAAAA", "BBBBB"]);
    expect(getInventoryLabelIds(baseInv)).toEqual([]);
  });
});
