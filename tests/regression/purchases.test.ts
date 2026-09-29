import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;
const sortedIds = (page: { items: { id: number }[] }) =>
  page.items.map(item => item.id).sort();

beforeAll(async () => {
  db = await connectTestDatabase();
  api = await startTestApi();
  // Complete runtime schema setup before fixture resets begin.
  await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
});
beforeEach(async () => {
  await resetFixtures(db);
});
afterAll(async () => {
  try {
    if (api) await api.stop();
  } finally {
    if (db) await db.end();
  }
});

describe("入庫一覧: 整理前のHTTP/API/DBの振る舞い", () => {
  it("通常一覧は未完了4件、境界日前・入庫済み・完了済みを除く", async () => {
    const result =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
    expect(sortedIds(result)).toEqual([910001, 910002, 910003, 910007]);
    expect(result).toMatchObject({
      totalCount: 4,
      allCount: 4,
      page: 1,
      pageSize: 20,
      totalPages: 1,
      tabCounts: {
        unclassified: 1,
        ebay: 1,
        oregon: 0,
        direct: 1,
        domestic: 1,
      },
    });
  });

  it("小数単価×数量とカテゴリ合計は保存値から算出される", async () => {
    const result =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
    expect(result.grandTotal).toBe(6700.5);
    expect(result.categoryTotals).toEqual([
      { category: "周辺機器", total: 3600, count: 2 },
      { category: "ゲーム機", total: 3000.5, count: 1 },
      { category: "その他", total: 100, count: 1 },
    ]);
  });

  it("分類・カテゴリ・発送ステータスで対象が絞られる", async () => {
    const list = api.client.inventory.zaico.getPurchasesWithCategoryPage;
    expect(
      sortedIds(await list.query({ inboundClass: "unclassified" }))
    ).toEqual([910001]);
    expect(sortedIds(await list.query({ inboundClass: "direct" }))).toEqual([
      910003,
    ]);
    expect(sortedIds(await list.query({ category: "周辺機器" }))).toEqual([
      910002, 910003,
    ]);
    expect(sortedIds(await list.query({ status: "shipped" }))).toEqual([
      910002,
    ]);
    expect(sortedIds(await list.query({ status: "ordered" }))).toEqual([
      910001, 910003, 910007,
    ]);
  });

  it("完了表示を有効にすると完了行が末尾に増え、入庫済みは増えない", async () => {
    const result =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        showCompleted: true,
      });
    expect(sortedIds(result)).toEqual([910001, 910002, 910003, 910004, 910007]);
    expect(result.items.at(-1)?.id).toBe(910004);
    expect(result.totalCount).toBe(5);
    expect(result.grandTotal).toBe(7500.5);
    expect(result.tabCounts.ebay).toBe(1);
  });

  it("商品名・管理番号・追跡番号の検索と前後空白の除去", async () => {
    const list = api.client.inventory.zaico.getPurchasesWithCategoryPage;
    expect(sortedIds(await list.query({ search: " 携帯ゲーム機A " }))).toEqual([
      910001,
    ]);
    expect(sortedIds(await list.query({ search: "test-c" }))).toEqual([910003]);
    expect(sortedIds(await list.query({ search: "test-track-b" }))).toEqual([
      910002,
    ]);
  });

  it("現行仕様: 検索時は分類などの絞り込みを越えて入庫済みもAPIに返す", async () => {
    const result =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "TEST-E",
        inboundClass: "unclassified",
        category: "その他",
        status: "shipped",
      });
    expect(sortedIds(result)).toEqual([910005]);
    expect(result.items[0].status).toBe("purchased");
    // Summary remains based on the unfiltered active rows in the current API.
    expect(result.allCount).toBe(4);
    expect(result.grandTotal).toBe(6700.5);
  });

  it("日付の下限は検索時も維持される", async () => {
    const list = api.client.inventory.zaico.getPurchasesWithCategoryPage;
    expect(sortedIds(await list.query({ search: "TEST-F" }))).toEqual([]);
    expect(sortedIds(await list.query({ search: "TEST-G" }))).toEqual([910007]);
  });

  it("ページを分けても重複せず、範囲外ページは末尾に補正する", async () => {
    const list = api.client.inventory.zaico.getPurchasesWithCategoryPage;
    const first = await list.query({ page: 1, pageSize: 2 });
    const second = await list.query({ page: 2, pageSize: 2 });
    expect(first).toMatchObject({ page: 1, totalPages: 2, totalCount: 4 });
    expect(second).toMatchObject({ page: 2, totalPages: 2, totalCount: 4 });
    expect([...first.items, ...second.items].map(row => row.id).sort()).toEqual(
      [910001, 910002, 910003, 910007]
    );
    expect(await list.query({ page: 99, pageSize: 2 })).toEqual(second);
  });

  it("該当なしでもページ情報・全体合計を維持する", async () => {
    const result =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "存在しないテスト商品",
      });
    expect(result).toMatchObject({
      items: [],
      totalCount: 0,
      totalPages: 1,
      page: 1,
      allCount: 4,
      grandTotal: 6700.5,
    });
  });

  it("無効な入力はHTTP経由で拒否される", async () => {
    await expect(
      api.client.inventory.zaico.getPurchasesWithCategoryPage.query({ page: 0 })
    ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
    await expect(
      api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        pageSize: 101,
      })
    ).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
  });

  it("追跡番号の保存・再読込・解除で発送状態が切り替わる", async () => {
    const extra = api.client.inventory.purchaseExtra;
    expect(
      await extra.upsert.mutate({
        zaicoId: 910001,
        trackingNumber: "TEST-NEW-001",
        note: "架空の配送メモ",
      })
    ).toMatchObject({ success: true, localUpdatedCount: 1 });
    const [saved] = await db.query<RowDataPacket[]>(
      "SELECT status, trackingNumber, note FROM local_purchases WHERE id=910001"
    );
    expect(saved[0]).toMatchObject({
      status: "shipped",
      trackingNumber: "TEST-NEW-001",
      note: "架空の配送メモ",
    });
    const page =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "TEST-NEW-001",
      });
    expect(page.items[0]).toMatchObject({
      id: 910001,
      status: "shipped",
      extra: { trackingNumber: "TEST-NEW-001" },
    });
    await extra.upsert.mutate({ zaicoId: 910001, trackingNumber: null });
    const [cleared] = await db.query<RowDataPacket[]>(
      "SELECT status, trackingNumber, note FROM local_purchases WHERE id=910001"
    );
    expect(cleared[0]).toMatchObject({
      status: "ordered",
      trackingNumber: null,
      note: "架空の配送メモ",
    });
  });

  it("商品編集は発注・在庫・明細に反映され、再読込後の合計も一致する", async () => {
    await api.client.inventory.zaico.updatePurchaseData.mutate({
      purchaseId: 910001,
      purchaseItems: [
        {
          inventoryId: 910001,
          title: "【テスト】編集後ゲーム機A",
          unitPrice: 1600.5,
          quantity: 3,
        },
      ],
    });
    const [purchases] = await db.query<RowDataPacket[]>(
      "SELECT title, quantity, unitPrice, itemsJson FROM local_purchases WHERE id=910001"
    );
    const [inventories] = await db.query<RowDataPacket[]>(
      "SELECT title, quantity, unitPrice FROM local_inventories WHERE id=910001"
    );
    expect(purchases[0]).toMatchObject({
      title: "【テスト】編集後ゲーム機A",
      quantity: 3,
      unitPrice: "1600.50",
    });
    expect(JSON.parse(purchases[0].itemsJson)[0]).toMatchObject({
      title: "【テスト】編集後ゲーム機A",
      quantity: "3",
      unit_price: "1600.5",
    });
    expect(inventories[0]).toMatchObject({
      title: "【テスト】編集後ゲーム機A",
      quantity: 0,
      unitPrice: "1600.50",
    });
    const result =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "編集後ゲーム機A",
      });
    expect(sortedIds(result)).toEqual([910001]);
    expect(result.grandTotal).toBe(8501.5);
  });
});
