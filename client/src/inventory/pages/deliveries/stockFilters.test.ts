import { describe, expect, it } from "vitest";
import { buildCategoryOptions, filterAndSortInventories } from "./stockFilters";
import type { InventoryItem } from "./types";

const items: InventoryItem[] = [
  {
    id: 1,
    title: "PSP 2000 シルバー",
    quantity: "2",
    unit: "個",
    category: "PSP2000",
    place: "棚A",
    etc: "371_ルカ_PSP2000, 2026-01-05",
    purchase_unit_price: 1000,
    updated_at: "2026-01-03T00:00:00Z",
  },
  {
    id: 2,
    title: "PSP 3000 グリーン",
    quantity: "0",
    unit: "個",
    category: "PSP3000",
    updated_at: "2026-01-05T00:00:00Z",
  },
  {
    id: 3,
    title: "ゲームボーイ",
    quantity: "1",
    unit: "個",
    unit_price: 500,
    created_at: "2026-01-04T00:00:00Z",
    itemLabels: [{ labelId: "ABCDEFG" }],
  },
  {
    id: 4,
    title: "数量未設定",
    quantity: undefined as unknown as string,
    unit: "個",
    category: "PSP2000",
  },
];

const ids = (list: InventoryItem[]) => list.map((inv) => inv.id);

describe("buildCategoryOptions", () => {
  it("管理カテゴリと在庫カテゴリを正規化して重複なく集計しja順で返す", () => {
    expect(buildCategoryOptions(items, ["すべて", "未分類", "レトロ", "Vita 1000"])).toEqual([
      "PSP2000",
      "PSP3000",
      "Vita1000",
      "レトロ",
    ]);
  });
  it("quantityがnull/undefinedの在庫は集計せず、入力なしは空配列", () => {
    expect(buildCategoryOptions([items[3]], undefined)).toEqual([]);
    expect(buildCategoryOptions(undefined, undefined)).toEqual([]);
  });
});

describe("filterAndSortInventories", () => {
  it("在庫0と数量未設定を除外し更新日（なければ登録日）降順で返す", () => {
    expect(ids(filterAndSortInventories(items, "", "すべて", true))).toEqual([3, 1]);
  });
  it("hideZeroStock=falseなら在庫0も表示する", () => {
    expect(ids(filterAndSortInventories(items, "", "すべて", false))).toEqual([2, 3, 1]);
  });
  it("inventories未取得は空配列", () => {
    expect(filterAndSortInventories(undefined, "psp", "すべて", true)).toEqual([]);
  });
  it("検索はスペース除去の部分一致（商品名・管理番号）", () => {
    expect(ids(filterAndSortInventories(items, "psp2000", "すべて", true))).toEqual([1]);
    expect(ids(filterAndSortInventories(items, "PSP 2000", "すべて", true))).toEqual([1]);
    expect(ids(filterAndSortInventories(items, "371", "すべて", true))).toEqual([1]);
  });
  it("保管場所・個体ラベルIDでも検索できる", () => {
    expect(ids(filterAndSortInventories(items, "棚a", "すべて", true))).toEqual([1]);
    expect(ids(filterAndSortInventories(items, "abcdefg", "すべて", true))).toEqual([3]);
  });
  it("カテゴリフィルタは表示カテゴリ（未分類含む）で絞る", () => {
    expect(ids(filterAndSortInventories(items, "", "未分類", true))).toEqual([3]);
    expect(ids(filterAndSortInventories(items, "", "PSP3000", true))).toEqual([]);
    expect(ids(filterAndSortInventories(items, "", "PSP3000", false))).toEqual([2]);
  });
});
