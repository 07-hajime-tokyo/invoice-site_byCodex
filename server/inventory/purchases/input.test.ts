import { describe, expect, it } from "vitest";
import { purchasePageInputSchema } from "./input";

describe("入庫一覧の入力検証", () => {
  it("入力省略・nullの絞り込み・全分類を受け入れる", () => {
    expect(purchasePageInputSchema.parse(undefined)).toBeUndefined();
    expect(
      purchasePageInputSchema.parse({
        status: null,
        category: null,
        search: null,
        inboundClass: null,
      })
    ).toEqual({
      status: null,
      category: null,
      search: null,
      inboundClass: null,
    });
    for (const inboundClass of [
      "ebay",
      "oregon",
      "direct",
      "domestic",
      "unclassified",
    ]) {
      expect(purchasePageInputSchema.safeParse({ inboundClass }).success).toBe(
        true
      );
    }
  });

  it("範囲外・小数ページ・無効な分類・長すぎる検索を拒否する", () => {
    for (const input of [
      { page: 0 },
      { page: 1.5 },
      { pageSize: 101 },
      { status: "purchased" },
      { inboundClass: "other" },
      { search: "a".repeat(201) },
    ]) {
      expect(purchasePageInputSchema.safeParse(input).success).toBe(false);
    }
  });
});
