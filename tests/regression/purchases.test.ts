import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  it("在庫の仕入先・出品URL・数量の変更を次の一覧取得に反映する", async () => {
    await db.query(
      "UPDATE local_purchases SET supplierName=NULL, supplierUrl=NULL WHERE id=910001"
    );
    for (const quantity of [0, 7]) {
      const supplierName = `更新した架空仕入先${quantity}`;
      const supplierUrl = `https://supplier.invalid/${quantity}`;
      const ebayListingUrl = `https://listing.invalid/${quantity}`;
      await db.query(
        "UPDATE local_inventories SET supplierName=?, supplierUrl=?, ebayListingUrl=?, quantity=? WHERE id=910001",
        [supplierName, supplierUrl, ebayListingUrl, quantity]
      );
      const page =
        await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
          search: "TEST-A",
        });
      const all =
        await api.client.inventory.zaico.getPurchasesWithCategory.query();
      for (const row of [page.items[0], all.find(row => row.id === 910001)!]) {
        expect(row).toMatchObject({
          csvSupplierName: supplierName,
          csvSupplierUrl: supplierUrl,
        });
        expect(row.purchase_items[0]).toMatchObject({
          ebayListingUrl,
          currentInventoryQuantity: quantity,
        });
      }
    }
  });

  it("通常の在庫一覧から除かれた削除済み在庫も発注IDで再取得する", async () => {
    await db.query(
      "UPDATE local_purchases SET supplierName=NULL, supplierUrl=NULL WHERE id=910001"
    );
    await db.query(
      "UPDATE local_inventories SET isDeleted=1, supplierName='削除済み在庫の仕入先', supplierUrl='https://supplier.invalid/deleted', ebayListingUrl='https://listing.invalid/deleted' WHERE id=910001"
    );
    const page =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "TEST-A",
      });
    const all =
      await api.client.inventory.zaico.getPurchasesWithCategory.query();
    for (const row of [page.items[0], all.find(row => row.id === 910001)!]) {
      expect(row).toMatchObject({
        csvSupplierName: "削除済み在庫の仕入先",
        csvSupplierUrl: "https://supplier.invalid/deleted",
      });
      expect(row.purchase_items[0]).toMatchObject({
        ebayListingUrl: "https://listing.invalid/deleted",
        currentInventoryQuantity: 0,
      });
    }
  });

  it("発注・在庫が空のときは両方の一覧が空で返る", async () => {
    await db.query("DELETE FROM local_purchases");
    await db.query("DELETE FROM local_inventories");
    const page =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
    const all =
      await api.client.inventory.zaico.getPurchasesWithCategory.query();
    expect(page.items).toEqual([]);
    expect(page.totalCount).toBe(0);
    expect(all).toEqual([]);
  });

  it("取得・復旧・ラベル・仕入先再取得の計測順序を保つ", async () => {
    const info = vi.spyOn(console, "info");
    try {
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
      await api.client.inventory.zaico.getPurchasesWithCategory.query();
      const page = info.mock.calls.find(
        ([label]) => label === "[perf] purchasesWithCategoryPage"
      )?.[1];
      const all = info.mock.calls.find(
        ([label]) => label === "[perf] purchasesWithCategory"
      )?.[1];
      const preparation = [
        "parallelFetch",
        "restoreMissingFromOrphanLabels",
        "ensureShaftPurchases",
        "reconcileLabelQuantities",
        "resolveInboundInfoMap",
      ];
      const projection = [
        "collectInventoryIds",
        "getInventoryItemLabelsByInventoryIds",
        "prepareSupplierMap",
        "supplierMapQuery",
        "mapRows",
        "attachItemInventoryInfo",
      ];
      expect(page.steps.map((step: { name: string }) => step.name)).toEqual([
        ...preparation,
        ...projection,
        "buildPageResponse",
      ]);
      expect(all.steps.map((step: { name: string }) => step.name)).toEqual([
        ...preparation,
        "buildPurchasedZaicoIds",
        ...projection,
      ]);
      expect(page).not.toHaveProperty("purchaseHistoriesMs");
      expect(all.purchaseHistoriesMs).toBeGreaterThanOrEqual(0);
    } finally {
      info.mockRestore();
    }
  });

  it("有効な入庫履歴は全件取得側だけの状態判定に使う", async () => {
    await db.query("INSERT INTO purchase_histories SET ?", {
      zaicoId: 910001,
      kanriNo: "TEST-A",
      title: "【テスト】携帯ゲーム機A",
      quantity: "2",
      purchaseDate: "2026-09-01",
      inventoryId: 910001,
      cancelled: 0,
    });
    const page =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "TEST-A",
      });
    const all =
      await api.client.inventory.zaico.getPurchasesWithCategory.query();
    expect(page.items[0].status).toBe("ordered");
    expect(all.find(row => row.id === 910001)?.status).toBe("purchased");
    await db.query(
      "UPDATE purchase_histories SET cancelled=1 WHERE zaicoId=910001"
    );
    const cancelled =
      await api.client.inventory.zaico.getPurchasesWithCategory.query();
    expect(cancelled.find(row => row.id === 910001)?.status).toBe("ordered");
  });

  it("全件取得では7件と作成日時を保持し、ページ取得とは項目を分ける", async () => {
    const all =
      await api.client.inventory.zaico.getPurchasesWithCategory.query();
    expect(all.map(row => row.id).sort()).toEqual([
      910001, 910002, 910003, 910004, 910005, 910006, 910007,
    ]);
    const first = all.find(row => row.id === 910001)!;
    if (!("createdAt" in first))
      throw new Error("Expected the local DB response");
    expect(first.createdAt).toBeInstanceOf(Date);
    expect(first.created_at).toBe((first.createdAt as Date).toISOString());
    const page =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "TEST-A",
      });
    expect(page.items[0]).not.toHaveProperty("createdAt");
    const { createdAt, created_at, ...common } = first;
    expect(page.items[0]).toEqual(common);
  });

  it("保存済み追加情報は空欄を補い、発注行にある値は上書きしない", async () => {
    await db.query(
      "UPDATE local_purchases SET note='発注側のメモ', trackingNumber=' ', carrier=NULL WHERE id=910001"
    );
    await db.query("INSERT INTO purchase_extras SET ?", {
      zaicoId: 910001,
      trackingNumber: "EXTRA-TRACK",
      carrier: "yamato",
      note: "追加側のメモ",
    });
    const page =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "EXTRA-TRACK",
      });
    expect(page.items[0]).toMatchObject({
      id: 910001,
      status: "shipped",
      extra: {
        trackingNumber: "EXTRA-TRACK",
        carrier: "yamato",
        note: "発注側のメモ",
      },
    });
    const all =
      await api.client.inventory.zaico.getPurchasesWithCategory.query();
    expect(all.find(row => row.id === 910001)?.extra).toEqual(
      page.items[0].extra
    );
  });

  it("壊れた明細JSONは発注行から復元して在庫情報を付ける", async () => {
    await db.query(
      "UPDATE local_purchases SET itemsJson='{broken', supplierName=NULL, supplierUrl=NULL WHERE id=910001"
    );
    await db.query(
      "UPDATE local_inventories SET supplierName='在庫側仕入先', supplierUrl='https://supplier.invalid/item', ebayListingUrl='https://listing.invalid/item' WHERE id=910001"
    );
    const page =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "TEST-A",
      });
    expect(page.items[0]).toMatchObject({
      csvSupplierName: "在庫側仕入先",
      csvSupplierUrl: "https://supplier.invalid/item",
    });
    expect(page.items[0].purchase_items).toHaveLength(1);
    expect(page.items[0].purchase_items[0]).toMatchObject({
      title: "【テスト】携帯ゲーム機A",
      quantity: "2",
      unit_price: "1500.25",
      category: "ゲーム機",
      inventory_id: 910001,
      currentInventoryQuantity: 0,
      ebayListingUrl: "https://listing.invalid/item",
    });
    const all =
      await api.client.inventory.zaico.getPurchasesWithCategory.query();
    expect(all.find(row => row.id === 910001)?.purchase_items).toEqual(
      page.items[0].purchase_items
    );
  });

  it("JSONが空配列・オブジェクトの場合は復元せず空明細のまま返す", async () => {
    for (const itemsJson of ["[]", "{}", "null"]) {
      await db.query("UPDATE local_purchases SET itemsJson=? WHERE id=910001", [
        itemsJson,
      ]);
      const page =
        await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
          search: "TEST-910001",
        });
      expect(page.items[0].purchase_items).toEqual([]);
      const all =
        await api.client.inventory.zaico.getPurchasesWithCategory.query();
      expect(all.find(row => row.id === 910001)?.purchase_items).toEqual([]);
    }
  });

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
