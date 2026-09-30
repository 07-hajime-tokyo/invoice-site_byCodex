import { describe, expect, it } from "vitest";
import { buildGroupDeliveredSummary } from "./deliveredSummary";

/** 出庫履歴画面のサマリー精密照合の整理前基準（現行出力の固定） */

describe("buildGroupDeliveredSummary", () => {
  it("csvProductsが空なら空配列", () => {
    expect(buildGroupDeliveredSummary([], [{ title: "Vita2000 ブラック", quantity: 2 }])).toEqual([]);
  });

  it("色明示はキーワード一致、ランダムカラーは同機種の受け皿になる", () => {
    const csvProducts = [
      { name: "Vita2000 ブラック", qty: 5 },
      { name: "Vita2000 ランダムカラー", qty: 3 },
    ];
    const items = [
      { title: "PS Vita 2000 ブラック", quantity: 2 },
      { title: "Vita2000 ピンク", quantity: 1 },
      { title: "Switch ネオン", quantity: 4 },
    ];
    expect(buildGroupDeliveredSummary(csvProducts, items)).toEqual([
      { name: "Vita2000 ブラック", deliveredQty: 2 },
      { name: "Vita2000 ランダムカラー", deliveredQty: 1 },
    ]);
  });

  it("同一キーのcsvProductは数量を合算し最後の商品名を使う", () => {
    const csvProducts = [
      { name: "PSP3000 黒", qty: 2 },
      { name: "PSP3000 ブラック", qty: 3 },
    ];
    const items = [{ title: "PSP3000 ブラック", quantity: 4 }];
    const result = buildGroupDeliveredSummary(csvProducts, items);
    expect(result.length).toBe(2);
    expect(result.reduce((s, r) => s + r.deliveredQty, 0)).toBe(4);
  });
});
