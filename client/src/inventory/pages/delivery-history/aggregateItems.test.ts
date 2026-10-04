import { describe, expect, it } from "vitest";
import { aggregateItemsByCsvProducts } from "./aggregateItems";

/** 出庫履歴画面のCSV発注照合集計の整理前基準（現行出力の固定） */

describe("aggregateItemsByCsvProducts", () => {
  it("csvProductsが空なら機種名でまとめる", () => {
    const result = aggregateItemsByCsvProducts(
      [],
      [
        { inventoryId: 1, title: "PSP3000 ブラック", quantity: 2 },
        { inventoryId: 2, title: "PSP3000 ホワイト", quantity: 1 },
        { inventoryId: 3, title: "Vita2000 ピンク", quantity: 3 },
      ],
    );
    expect(result).toEqual([
      { csvName: "PSP3000", csvQty: 0, deliveredQty: 3 },
      { csvName: "Vita2000", csvQty: 0, deliveredQty: 3 },
    ]);
  });

  it("csvProductsがある場合はsuggestCsvProductで割り当て、未一致は別行で追加する", () => {
    const csvProducts = [{ name: "Vita2000 ブラック", qty: 5 }];
    const result = aggregateItemsByCsvProducts(csvProducts, [
      { inventoryId: 1, title: "Vita2000 ブラック", quantity: 2 },
      { inventoryId: 2, title: "ぬいぐるみ", quantity: 1 },
    ]);
    expect(result).toEqual([
      { csvName: "Vita2000 ブラック", csvQty: 5, deliveredQty: 2 },
      { csvName: "ぬいぐるみ", csvQty: 0, deliveredQty: 1 },
    ]);
  });
});
