import { describe, expect, it } from "vitest";
import { aggregateDeliveryItems } from "./aggregateDeliveries";
import type { DeliveryItem, SummaryItem } from "./types";

/** 発注管理画面の出庫履歴集約の整理前基準（現行出力の固定） */

function makeItem(deliveryItems: DeliveryItem[]): SummaryItem {
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
    deliveryItems,
  };
}

function d(partial: Partial<DeliveryItem>): DeliveryItem {
  return {
    deliveryNo: "100",
    title: "Vita 2000 ブラック",
    quantity: 1,
    deliveredAt: "2026-01-15T00:00:00.000Z",
    managementNo: "369_ルカ",
    ...partial,
  };
}

describe("aggregateDeliveryItems", () => {
  it("同一商品名をまとめて数量を合算する", () => {
    const result = aggregateDeliveryItems(
      makeItem([
        d({ quantity: 2 }),
        d({ quantity: 3, deliveryNo: "100" }),
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(5);
    expect(result[0].deliveryNo).toBe("100");
    expect(result[0].items).toHaveLength(2);
  });

  it("出庫Noが異なる場合は「複数」とする", () => {
    const result = aggregateDeliveryItems(
      makeItem([
        d({ quantity: 1, deliveryNo: "100" }),
        d({ quantity: 1, deliveryNo: "200" }),
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].deliveryNo).toBe("複数");
  });

  it("括弧書き違いのタイトルを正規化してまとめる", () => {
    const result = aggregateDeliveryItems(
      makeItem([
        d({ title: "Vita 2000 ブラック（369_ルカ）", quantity: 1 }),
        d({ title: "Vita 2000 ブラック", quantity: 2 }),
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(3);
  });

  it("別商品は別グループとしてタイトル順に並ぶ", () => {
    const result = aggregateDeliveryItems(
      makeItem([
        d({ title: "ブルー商品", quantity: 1 }),
        d({ title: "アカ商品", quantity: 2 }),
      ]),
    );
    expect(result.map((g) => g.title)).toEqual(["アカ商品", "ブルー商品"]);
  });

  it("日付が同一なら deliveredDateKey が入り、異なれば空になる", () => {
    const same = aggregateDeliveryItems(
      makeItem([
        d({ deliveredAt: "2026-01-15T00:00:00.000Z" }),
        d({ deliveredAt: "2026-01-15T05:00:00.000Z" }),
      ]),
    );
    expect(same[0].deliveredDateKey).toBe("2026-01-15");
    const diff = aggregateDeliveryItems(
      makeItem([
        d({ deliveredAt: "2026-01-15T00:00:00.000Z" }),
        d({ deliveredAt: "2026-01-16T00:00:00.000Z" }),
      ]),
    );
    expect(diff[0].deliveredDateKey).toBe("");
  });
});
