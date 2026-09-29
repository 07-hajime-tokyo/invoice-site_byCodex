import { describe, expect, it } from "vitest";
import { buildPurchasePageResponse, type PurchasePageRow } from "./page";

describe("入庫一覧の集計・検索・ページ分割", () => {
  it("カテゴリ件数は明細数ではなく発注行単位で数える", () => {
    const page = buildPurchasePageResponse([
      {
        status: "ordered",
        purchase_items: [
          { category: "ゲーム機", unit_price: "100.25", quantity: "2" },
          { category: "ゲーム機", unit_price: "0", quantity: "3" },
          { category: "周辺機器", unit_price: "50", quantity: "1" },
          { category: "", unit_price: null, quantity: "1" },
        ],
      },
      {
        status: "ordered",
        purchase_items: [
          { category: "周辺機器", unit_price: "50", quantity: "1" },
        ],
      },
    ]);
    expect(page.categoryTotals).toEqual([
      { category: "ゲーム機", total: 200.5, count: 1 },
      { category: "周辺機器", total: 100, count: 2 },
      { category: "未分類", total: 0, count: 1 },
    ]);
    expect(page.grandTotal).toBe(300.5);
  });

  it("同額カテゴリは日本語の名前順、空の一覧でも1ページを返す", () => {
    const rows = ["B", "A"].map(category => ({
      status: "ordered",
      purchase_items: [{ category, unit_price: "10", quantity: "1" }],
    }));
    expect(
      buildPurchasePageResponse(rows).categoryTotals.map(row => row.category)
    ).toEqual(["A", "B"]);
    expect(buildPurchasePageResponse([])).toMatchObject({
      items: [],
      page: 1,
      totalPages: 1,
      grandTotal: 0,
      allCount: 0,
      totalCount: 0,
    });
  });

  it("完了行を末尾へ移し、各群内の順序と追加情報を保持する", () => {
    const rows = [
      { id: 1, inboundClass: "ebay", stage: "packed" },
      { id: 2, inboundClass: "direct", stage: "registered" },
      { id: 3, inboundClass: "domestic", stage: "shipped" },
      { id: 4, inboundClass: null, stage: "received" },
    ].map(row => ({
      ...row,
      status: "ordered",
      purchase_items: [],
      extraField: "保持",
    })) as (PurchasePageRow & { id: number; extraField: string })[];
    const original = structuredClone(rows);
    const page = buildPurchasePageResponse(rows, { showCompleted: true });
    expect(page.items.map(row => row.id)).toEqual([2, 4, 1, 3]);
    expect(page.items.every(row => row.extraField === "保持")).toBe(true);
    expect(page.tabCounts).toEqual({
      unclassified: 1,
      ebay: 0,
      oregon: 0,
      direct: 1,
      domestic: 0,
    });
    expect(rows).toEqual(original);
  });

  it("ラベルID・仕入先名を検索でき、合計は検索結果で再計算しない", () => {
    const rows = [
      {
        status: "ordered",
        csvSupplierName: "架空SUPPLIER",
        purchase_items: [
          {
            title: "テスト",
            unit_price: "100",
            quantity: "2",
            itemLabels: [{ labelId: "LABEL-ABC" }],
          },
        ],
      },
    ];
    expect(
      buildPurchasePageResponse(rows, { search: " label-abc " }).totalCount
    ).toBe(1);
    expect(
      buildPurchasePageResponse(rows, { search: "supplier" }).totalCount
    ).toBe(1);
    expect(
      buildPurchasePageResponse(rows, { search: "missing" })
    ).toMatchObject({ totalCount: 0, grandTotal: 200, allCount: 1 });
  });

  it("検索は入庫済み・完了済みも対象だが、対象日前の行は返さない", () => {
    const rows: PurchasePageRow[] = [
      {
        status: "purchased",
        inboundClass: "ebay",
        stage: "packed",
        num: "MATCH",
        purchaseDate: "2026-06-20",
        purchase_items: [],
      },
      {
        status: "ordered",
        num: "MATCH",
        purchaseDate: "2026-06-19",
        purchase_items: [],
      },
    ];
    const page = buildPurchasePageResponse(rows, {
      search: "MATCH",
      inboundClass: "unclassified",
      category: "その他",
      status: "shipped",
    });
    expect(page.items).toEqual([rows[0]]);
    expect(page).toMatchObject({ totalCount: 1, allCount: 0 });
  });

  it("ページを分割し、上限ページ・最大ページサイズを適用する", () => {
    const rows = Array.from({ length: 101 }, (_, id) => ({
      id,
      status: "ordered",
      purchase_items: [],
    }));
    const page = buildPurchasePageResponse(rows, { page: 50, pageSize: 500 });
    expect(page).toMatchObject({
      page: 2,
      pageSize: 100,
      totalPages: 2,
      totalCount: 101,
    });
    expect(page.items.map(row => row.id)).toEqual([100]);
  });
});
