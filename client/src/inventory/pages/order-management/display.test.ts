import { describe, expect, it } from "vitest";
import {
  cleanDeliveryProductTitle,
  deliveryDateKey,
  deliveryDateLabel,
  isOrderStockShort,
  orderStockCoverage,
  progressColor,
  sameValueOrLabel,
} from "./display";
import type { ColorSummary } from "./types";

/** 発注管理画面の表示系純粋関数の整理前基準（現行出力の固定） */

function cs(partial: Partial<ColorSummary>): ColorSummary {
  return {
    colorName: "ブラック",
    csvQty: 0,
    zaicoCount: 0,
    purchasedCount: 0,
    stockCount: 0,
    deliveredCount: 0,
    ...partial,
  };
}

describe("progressColor", () => {
  it("進捗率に応じたクラス名を返す", () => {
    expect(progressColor(100)).toBe("bg-green-500");
    expect(progressColor(70)).toBe("bg-blue-500");
    expect(progressColor(40)).toBe("bg-yellow-500");
    expect(progressColor(39)).toBe("bg-red-500");
    expect(progressColor(0)).toBe("bg-red-500");
  });
});

describe("orderStockCoverage / isOrderStockShort", () => {
  it("発注+在庫+出庫の合計を発注数で頭打ちする", () => {
    expect(orderStockCoverage(cs({ csvQty: 10, zaicoCount: 3, stockCount: 2, deliveredCount: 1 }))).toBe(6);
    expect(orderStockCoverage(cs({ csvQty: 5, zaicoCount: 4, stockCount: 4 }))).toBe(5);
  });
  it("充足していなければ不足と判定する", () => {
    expect(isOrderStockShort(cs({ csvQty: 10, zaicoCount: 3 }))).toBe(true);
    expect(isOrderStockShort(cs({ csvQty: 5, zaicoCount: 5 }))).toBe(false);
  });
});

describe("cleanDeliveryProductTitle", () => {
  it("括弧書きを除去する", () => {
    expect(cleanDeliveryProductTitle("Vita 2000 ブラック（369_ルカ）付き")).toBe("Vita 2000 ブラック付き");
    expect(cleanDeliveryProductTitle("  タイトル  ")).toBe("タイトル");
  });
});

describe("deliveryDateKey / deliveryDateLabel", () => {
  it("有効な日付は YYYY-MM-DD キーと ja-JP 表示を返す", () => {
    expect(deliveryDateKey("2026-01-15T00:00:00.000Z")).toBe("2026-01-15");
    expect(deliveryDateLabel("2026-01-15T00:00:00.000Z")).toBe(
      new Date("2026-01-15T00:00:00.000Z").toLocaleDateString("ja-JP"),
    );
  });
  it("無効な日付は入力をそのまま返す", () => {
    expect(deliveryDateKey("不明")).toBe("不明");
    expect(deliveryDateLabel("不明")).toBe("不明");
  });
});

describe("sameValueOrLabel", () => {
  it("一意なら値を、複数ならラベルを返す", () => {
    expect(sameValueOrLabel(["123", "123"], "複数")).toBe("123");
    expect(sameValueOrLabel(["123", "456"], "複数")).toBe("複数");
    expect(sameValueOrLabel(["", "123"], "複数")).toBe("123");
    expect(sameValueOrLabel([], "複数")).toBe("複数");
  });
});
