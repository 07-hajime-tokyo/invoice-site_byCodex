import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

/**
 * eBay・ヤフオク出品領域（inventory.zaico ルーター）の整理前基準。
 * zaicoルーターの zaicoRouter.ts への抽出前後で、同じ入力に対する
 * 応答・DB保存値が変わらないことを固定する。
 *
 * 前提:
 * - isZaicoEnabled() は常に false のため、全手続きはローカルDB経路のみを通る。
 *   Zaico連携ON経路は実外部接続が必要なため対象外。
 * - createDelivery の GAS Webhook 経路は GAS_WEBHOOK_URL 未設定の
 *   契約（fedexResult.success=false）で固定する。
 */

let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;

const savedEnv: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "INVENTORY_OPERATOR_DEFAULT_NAME",
  "INVENTORY_OPERATOR_DEFAULT_EMAIL",
  "INVENTORY_OPERATOR_A_NAME",
  "INVENTORY_OPERATOR_B_NAME",
  "GAS_WEBHOOK_URL",
] as const;

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  db = await connectTestDatabase();
  api = await startTestApi();
  // Complete runtime schema setup before fixture resets begin.
  await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
});

beforeEach(async () => {
  await resetFixtures(db);
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  try {
    if (api) await api.stop();
  } finally {
    if (db) await db.end();
  }
});

async function rows(sql: string, params: unknown[] = []) {
  const [result] = await db.query<RowDataPacket[]>(sql, params);
  return result;
}

async function insertLocalInventory(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO local_inventories SET ?", {
    id,
    title: `【テスト】追加在庫${id}`,
    quantity: 1,
    etc: `TEST-X-${id}`,
    createdAt: "2026-09-10",
    updatedAt: "2026-09-10",
    ...patch,
  });
}

describe("zaico.getOperators", () => {
  it("演算子用環境変数が未設定ならデフォルト担当者のみを返す", async () => {
    const operators = await api.client.inventory.zaico.getOperators.query();
    expect(operators).toEqual([{ key: "default", name: "担当者", email: "" }]);
  });
});

describe("zaico.getInventories", () => {
  it("ローカルDBの在庫を整形して返し、在庫0でもラベルを1枚確保する", async () => {
    const inventories = await api.client.inventory.zaico.getInventories.query();
    expect(inventories).toHaveLength(7);
    const inv = inventories.find((row) => row.id === 910001)!;
    expect(inv).toMatchObject({
      id: 910001,
      title: "【テスト】携帯ゲーム機A",
      quantity: "0",
      unit: "個",
      unit_price: 1500.25,
      purchase_unit_price: 1500.25,
      category: "ゲーム機",
      categories: ["ゲーム機"],
      etc: "TEST-A",
      last_purchase_date: null,
      supplierName: "架空仕入先",
      ebayListingUrl: null,
      ebayOrderUrl: null,
      ebayOrderStatus: "normal",
    });
    expect(inv.itemLabels).toHaveLength(1);
    expect(inv.itemLabels[0]).toMatchObject({
      status: "ordered",
      legacyManagementNo: "TEST-A",
      localInventoryId: 910001,
    });
  });
});

describe("zaico.getInventoryById", () => {
  it("ローカルDB由来のフラグ付きで在庫詳細を返す", async () => {
    const inv = await api.client.inventory.zaico.getInventoryById.query({ inventoryId: 910001 });
    expect(inv).toMatchObject({
      id: 910001,
      title: "【テスト】携帯ゲーム機A",
      quantity: "0",
      unit: "個",
      category: "ゲーム機",
      etc: "TEST-A",
      unit_price: 1500.25,
      purchase_unit_price: 1500.25,
      ebayListingUrl: null,
      ebayOrderUrl: null,
      ebayOrderStatus: "normal",
      optional_attributes: [],
      _fromLocalDb: true,
    });
  });

  it("存在しないIDは null を返す", async () => {
    const inv = await api.client.inventory.zaico.getInventoryById.query({ inventoryId: 888888 });
    expect(inv).toBeNull();
  });
});

describe("zaico.getCategories / addCategory / deleteCategory", () => {
  it("在庫・発注から導出したカテゴリ一覧を返す", async () => {
    const list = await api.client.inventory.zaico.getCategories.query();
    expect(list).toEqual(expect.arrayContaining(["ゲーム機", "周辺機器", "その他"]));
  });

  it("addCategory は保存カテゴリを追加した一覧を返し、空文字・予約語は拒否する", async () => {
    const list = await api.client.inventory.zaico.addCategory.mutate({ name: "追加カテゴリ" });
    expect(list).toContain("追加カテゴリ");
    await expect(
      api.client.inventory.zaico.addCategory.mutate({ name: "  " }),
    ).rejects.toThrowError(/カテゴリ名を入力してください/);
    await expect(
      api.client.inventory.zaico.addCategory.mutate({ name: "すべて" }),
    ).rejects.toThrowError(/カテゴリ名を入力してください/);
  });

  it("deleteCategory は置換カテゴリを在庫・発注に反映する", async () => {
    const list = await api.client.inventory.zaico.deleteCategory.mutate({
      name: "周辺機器",
      replacement: "ゲーム機",
    });
    expect(list).not.toContain("周辺機器");
    const invs = await rows(
      "SELECT id, category FROM local_inventories WHERE id IN (910002, 910003) ORDER BY id",
    );
    expect(invs.map((r) => r.category)).toEqual(["ゲーム機", "ゲーム機"]);
    const purchases = await rows(
      "SELECT id, category FROM local_purchases WHERE id IN (910002, 910003) ORDER BY id",
    );
    expect(purchases.map((r) => r.category)).toEqual(["ゲーム機", "ゲーム機"]);
  });

  it("deleteCategory は予約語を拒否する", async () => {
    await expect(
      api.client.inventory.zaico.deleteCategory.mutate({ name: "すべて" }),
    ).rejects.toThrowError(/削除できないカテゴリです/);
  });
});

describe("zaico.createInventory", () => {
  it("有在庫eBay管理番号の商品はeBay URL・Order状態を保存する", async () => {
    const result = await api.client.inventory.zaico.createInventory.mutate({
      title: "【テスト】新規eBay商品",
      quantity: "3",
      category: "ゲーム機",
      etc: "E0925_テスト_1/1",
      purchase_unit_price: 1234.5,
      supplierName: "架空仕入先2",
      ebayListingUrl: "www.ebay.com/itm/999",
      ebayOrderUrl: "ebay.com/ord/1",
      ebayOrderStatus: "cancelled",
    });
    // 既存挙動: upsertLocalInventory は drizzle/mysql2 の戻り値配列から insertId を
    // 取り出せず常に 0 を返すため、data_id は 0 になる（記録済みの既存不整合）。
    expect(result).toEqual({
      code: 200,
      status: "ok",
      message: "商品を登録しました（ローカルDB）",
      data_id: 0,
    });
    const [saved] = await rows(
      "SELECT * FROM local_inventories WHERE title = ?",
      ["【テスト】新規eBay商品"],
    );
    expect(saved).toMatchObject({
      title: "【テスト】新規eBay商品",
      quantity: 3,
      unitPrice: "1234.50",
      category: "ゲーム機",
      etc: "E0925_テスト_1/1",
      supplierName: "架空仕入先2",
      ebayListingUrl: "https://www.ebay.com/itm/999",
      ebayOrderUrl: "https://ebay.com/ord/1",
      ebayOrderStatus: "cancelled",
      isDeleted: 0,
    });
    // 既存挙動: createdId=0 のためラベルは作成されない。
    const labels = await rows(
      "SELECT status FROM inventory_item_labels WHERE localInventoryId = ?",
      [saved.id],
    );
    expect(labels).toHaveLength(0);
    // 既存挙動: 作業メモは inventoryId=0 で記録される。
    const changes = await rows(
      "SELECT changeType, title FROM inventory_memos WHERE zaicoInventoryId = 0",
    );
    expect(changes).toEqual([{ changeType: "created", title: "【テスト】新規eBay商品" }]);
  });

  it("eBay管理番号でない商品は出品URLを保存せず Order状態を normal に固定する", async () => {
    const result = await api.client.inventory.zaico.createInventory.mutate({
      title: "【テスト】通常商品",
      quantity: "1",
      etc: "TEST-X",
      ebayListingUrl: "www.example.com/item/1",
      ebayOrderStatus: "cancelled",
    });
    expect(result.data_id).toBe(0);
    const [saved] = await rows(
      "SELECT * FROM local_inventories WHERE title = ?",
      ["【テスト】通常商品"],
    );
    expect(saved).toMatchObject({
      ebayListingUrl: null,
      ebayOrderStatus: "normal",
    });
  });
});

describe("zaico.updateInventory", () => {
  it("在庫を更新し、紐づく発注行と itemsJson を同期する", async () => {
    const result = await api.client.inventory.zaico.updateInventory.mutate({
      inventoryId: 910001,
      title: "【テスト】携帯ゲーム機A改",
      quantity: "4",
      category: "改装",
      etc: "TEST-A",
      purchase_unit_price: 2000,
    });
    expect(result).toMatchObject({
      code: 200,
      status: "ok",
      message: "商品を更新しました（ローカルDB）",
    });
    const [inv] = await rows("SELECT * FROM local_inventories WHERE id = 910001");
    expect(inv).toMatchObject({
      title: "【テスト】携帯ゲーム機A改",
      quantity: 4,
      category: "改装",
      unitPrice: "2000.00",
      etc: "TEST-A",
    });
    const [purchase] = await rows("SELECT * FROM local_purchases WHERE id = 910001");
    expect(purchase).toMatchObject({
      title: "【テスト】携帯ゲーム機A改",
      category: "改装",
      unitPrice: "2000.00",
      managementNo: "TEST-A",
      supplierName: "架空仕入先",
    });
    const items = JSON.parse(String(purchase.itemsJson));
    expect(items[0]).toMatchObject({
      title: "【テスト】携帯ゲーム機A改",
      unit_price: 2000,
      etc: "TEST-A",
      managementNo: "TEST-A",
    });
    const changes = await rows(
      "SELECT changeType FROM inventory_memos WHERE zaicoInventoryId = 910001",
    );
    expect(changes.map((r) => r.changeType)).toContain("updated");
  });
});

describe("zaico.deleteInventory", () => {
  it("論理削除・削除スナップショット保存・安全な連動削除を行う", async () => {
    const result = await api.client.inventory.zaico.deleteInventory.mutate({
      inventoryId: 910001,
      alsoDeletePurchaseIds: [910001, 910002],
    });
    expect(result).toMatchObject({
      code: 200,
      status: "ok",
      message: "在庫を削除しました（ローカルDB）",
    });
    const [inv] = await rows("SELECT isDeleted FROM local_inventories WHERE id = 910001");
    expect(inv.isDeleted).toBe(1);
    const deleted = await rows("SELECT zaicoId, title FROM deleted_inventories WHERE zaicoId = 910001");
    expect(deleted).toHaveLength(1);
    expect(deleted[0].title).toBe("【テスト】携帯ゲーム機A");
    // 管理番号が一致する 910001 のみ削除され、910002 は残る
    const remaining = await rows(
      "SELECT id FROM local_purchases WHERE id IN (910001, 910002) ORDER BY id",
    );
    expect(remaining.map((r) => r.id)).toEqual([910002]);
    const changes = await rows(
      "SELECT changeType FROM inventory_memos WHERE zaicoInventoryId = 910001",
    );
    expect(changes.map((r) => r.changeType)).toContain("deleted");
  });
});

describe("zaico.upsertInventoryExtra", () => {
  it("在庫補足情報を保存し、空文字URLは null に正規化する", async () => {
    const result = await api.client.inventory.zaico.upsertInventoryExtra.mutate({
      zaicoInventoryId: 910001,
      supplierUrl: "https://example.com/supplier",
      supplierName: "補足仕入先",
    });
    expect(result).toEqual({ success: true });
    const [extra] = await rows(
      "SELECT supplierUrl, supplierName FROM inventory_extras WHERE zaicoInventoryId = 910001",
    );
    expect(extra).toMatchObject({
      supplierUrl: "https://example.com/supplier",
      supplierName: "補足仕入先",
    });
    await api.client.inventory.zaico.upsertInventoryExtra.mutate({
      zaicoInventoryId: 910001,
      supplierUrl: "",
      supplierName: "補足仕入先2",
    });
    const [updated] = await rows(
      "SELECT supplierUrl, supplierName FROM inventory_extras WHERE zaicoInventoryId = 910001",
    );
    expect(updated).toMatchObject({ supplierUrl: null, supplierName: "補足仕入先2" });
  });
});

describe("zaico.deletePurchaseOnly", () => {
  it("発注データのみ削除し在庫は残す", async () => {
    const result = await api.client.inventory.zaico.deletePurchaseOnly.mutate({
      purchaseId: 910003,
    });
    expect(result).toEqual({ success: true });
    expect(await rows("SELECT id FROM local_purchases WHERE id = 910003")).toHaveLength(0);
    expect(await rows("SELECT id FROM local_inventories WHERE id = 910003")).toHaveLength(1);
  });
});

describe("zaico.getPurchasesByInventoryId", () => {
  it("etc先頭の管理番号で紐づく発注データを返す", async () => {
    const purchases = await api.client.inventory.zaico.getPurchasesByInventoryId.query({
      inventoryId: 910001,
    });
    expect(purchases).toHaveLength(1);
    expect(purchases[0]).toMatchObject({ id: 910001, num: "TEST-910001" });
    expect(purchases[0].purchase_items[0]).toMatchObject({
      inventory_id: 910001,
      title: "【テスト】携帯ゲーム機A",
    });
  });

  it("存在しない在庫IDは空配列を返す", async () => {
    const purchases = await api.client.inventory.zaico.getPurchasesByInventoryId.query({
      inventoryId: 888888,
    });
    expect(purchases).toEqual([]);
  });
});

describe("zaico.completePurchase", () => {
  it("発注を purchased に更新し在庫数を加算・入庫履歴と作業ログを保存する", async () => {
    const result = await api.client.inventory.zaico.completePurchase.mutate({
      purchaseId: 910001,
      purchaseDate: "2026-09-21",
      purchaseItems: [{ inventory_id: 910001, quantity: "2", unit_price: "1500.25" }],
      historyData: {
        kanriNo: "TEST-A",
        title: "【テスト】携帯ゲーム機A",
        category: "ゲーム機",
        supplier: "架空仕入先",
        unitPrice: "1500.25",
        inventoryId: 910001,
      },
      operatorName: "テスト担当",
    });
    expect(result).toEqual({ code: 200, status: "ok", message: "入庫処理完了（ローカルDB）" });
    const [purchase] = await rows(
      "SELECT status, receivedDate FROM local_purchases WHERE id = 910001",
    );
    expect(purchase).toMatchObject({ status: "purchased", receivedDate: "2026-09-21" });
    const [inv] = await rows("SELECT quantity FROM local_inventories WHERE id = 910001");
    expect(inv.quantity).toBe(2);
    const histories = await rows(
      "SELECT zaicoId, kanriNo, title, quantity, unitPrice, purchaseDate, inventoryId, cancelled, operatorName FROM purchase_histories WHERE zaicoId = 910001",
    );
    expect(histories).toHaveLength(1);
    expect(histories[0]).toMatchObject({
      kanriNo: "TEST-A",
      title: "【テスト】携帯ゲーム機A",
      quantity: "2",
      purchaseDate: "2026-09-21",
      inventoryId: 910001,
      cancelled: 0,
      operatorName: "テスト担当",
    });
    const logs = await rows(
      "SELECT category, workerName, quantity FROM work_logs WHERE sourceType = 'purchase' AND sourceId = '910001'",
    );
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ category: "入庫登録", workerName: "テスト担当", quantity: 2 });
  });
});

describe("zaico shaft sales", () => {
  it("upsertShaftSale は管理番号で新規作成・更新を切り替える", async () => {
    const created = await api.client.inventory.zaico.upsertShaftSale.mutate({
      managementNo: "シャフト-930001",
      title: "【テスト】シャフト売上",
      quantity: 1,
      saleAmount: 5000,
      soldAt: "2026-09-25",
    });
    expect(created.success).toBe(true);
    expect(created.sale).not.toBeNull();
    const createdId = created.sale!.id;

    const updated = await api.client.inventory.zaico.upsertShaftSale.mutate({
      managementNo: "シャフト-930001",
      title: "【テスト】シャフト売上改",
      quantity: 2,
      saleAmount: 6000,
      soldAt: "2026-09-26",
    });
    expect(updated.sale!.id).toBe(createdId);

    const sales = await api.client.inventory.zaico.getShaftSales.query();
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({
      id: createdId,
      managementNo: "シャフト-930001",
      title: "【テスト】シャフト売上改",
      quantity: 2,
      soldAt: "2026-09-26",
    });
    expect(Number(sales[0].saleAmount)).toBe(6000);
  });

  it("updateShaftSaleDate / updateShaftSaleProfit は対象行を更新し、未存在は NOT_FOUND", async () => {
    const created = await api.client.inventory.zaico.upsertShaftSale.mutate({
      managementNo: "シャフト-930002",
      title: "【テスト】シャフト売上2",
      quantity: 1,
      saleAmount: 1000,
      soldAt: "2026-09-25",
    });
    const id = created.sale!.id;
    const dated = await api.client.inventory.zaico.updateShaftSaleDate.mutate({
      id,
      soldAt: "2026-09-30",
    });
    expect(dated.sale!.soldAt).toBe("2026-09-30");
    const profited = await api.client.inventory.zaico.updateShaftSaleProfit.mutate({
      id,
      profitAmount: 250,
    });
    expect(Number(profited.sale!.profitAmount)).toBe(250);
    const cleared = await api.client.inventory.zaico.updateShaftSaleProfit.mutate({
      id,
      profitAmount: null,
    });
    expect(cleared.sale!.profitAmount).toBeNull();
    await expect(
      api.client.inventory.zaico.updateShaftSaleDate.mutate({ id: 999999, soldAt: "2026-09-30" }),
    ).rejects.toThrowError(/シャフト売上が見つかりません/);
  });
});

describe("zaico.updateEbayListingUrl / updateEbayOrderUrl / updateEbayOrderStatus", () => {
  it("有在庫eBay商品の出品URLを正規化して保存する", async () => {
    await insertLocalInventory(930001, { etc: "E0925_テスト_1/1" });
    const result = await api.client.inventory.zaico.updateEbayListingUrl.mutate({
      inventoryId: 930001,
      ebayListingUrl: "www.ebay.com/itm/1",
    });
    expect(result).toEqual({ success: true, ebayListingUrl: "https://www.ebay.com/itm/1" });
    const [inv] = await rows("SELECT ebayListingUrl FROM local_inventories WHERE id = 930001");
    expect(inv.ebayListingUrl).toBe("https://www.ebay.com/itm/1");
  });

  it("有在庫でない商品・未存在の商品はエラーにする", async () => {
    await expect(
      api.client.inventory.zaico.updateEbayListingUrl.mutate({
        inventoryId: 910001,
        ebayListingUrl: "www.ebay.com/itm/1",
      }),
    ).rejects.toThrowError(/有在庫のeBay商品だけ出品ページを登録できます/);
    await expect(
      api.client.inventory.zaico.updateEbayListingUrl.mutate({
        inventoryId: 888888,
        ebayListingUrl: "www.ebay.com/itm/1",
      }),
    ).rejects.toThrowError(/Inventory not found/);
  });

  it("OrderページURL・Order状態はeBay管理番号の商品だけ更新できる", async () => {
    await insertLocalInventory(930002, { etc: "E0925_テスト_1/1" });
    const urlResult = await api.client.inventory.zaico.updateEbayOrderUrl.mutate({
      inventoryId: 930002,
      ebayOrderUrl: "ebay.com/ord/2",
    });
    expect(urlResult).toEqual({ success: true, ebayOrderUrl: "https://ebay.com/ord/2" });
    const statusResult = await api.client.inventory.zaico.updateEbayOrderStatus.mutate({
      inventoryId: 930002,
      ebayOrderStatus: "cancelled",
    });
    expect(statusResult).toEqual({ success: true, ebayOrderStatus: "cancelled" });
    const [inv] = await rows(
      "SELECT ebayOrderUrl, ebayOrderStatus FROM local_inventories WHERE id = 930002",
    );
    expect(inv).toMatchObject({
      ebayOrderUrl: "https://ebay.com/ord/2",
      ebayOrderStatus: "cancelled",
    });
    await expect(
      api.client.inventory.zaico.updateEbayOrderUrl.mutate({
        inventoryId: 910001,
        ebayOrderUrl: "ebay.com/ord/2",
      }),
    ).rejects.toThrowError(/eBay管理番号の商品だけOrderページを登録できます/);
    await expect(
      api.client.inventory.zaico.updateEbayOrderStatus.mutate({
        inventoryId: 910001,
        ebayOrderStatus: "cancelled",
      }),
    ).rejects.toThrowError(/eBay管理番号の商品だけOrder状態を登録できます/);
  });
});

describe("zaico.updateCategoryOnly", () => {
  it("在庫カテゴリと紐づく発注行・itemsJson を同期更新する", async () => {
    const result = await api.client.inventory.zaico.updateCategoryOnly.mutate({
      inventoryId: 910001,
      category: "限定カテゴリ",
    });
    expect(result).toEqual({ success: true });
    const [inv] = await rows("SELECT category FROM local_inventories WHERE id = 910001");
    expect(inv.category).toBe("限定カテゴリ");
    const [purchase] = await rows("SELECT category, itemsJson FROM local_purchases WHERE id = 910001");
    expect(purchase.category).toBe("限定カテゴリ");
    const items = JSON.parse(String(purchase.itemsJson));
    expect(items[0].category).toBe("限定カテゴリ");
  });
});

describe("zaico inbound config / class / stage", () => {
  it("getInboundConfig は未設定時にデフォルトの直取相手名を返す", async () => {
    const config = await api.client.inventory.zaico.getInboundConfig.query();
    expect(config.directPartnerNames).toEqual(["サミー", "ルカ", "サイモン", "マキシム", "ネレ"]);
  });

  it("setDirectPartnerNames はトリム・重複除去して保存し、取得時はデフォルトと合成する", async () => {
    const result = await api.client.inventory.zaico.setDirectPartnerNames.mutate({
      names: [" テスト相手 ", "テスト相手", ""],
    });
    expect(result).toEqual({ success: true, directPartnerNames: ["テスト相手"] });
    const config = await api.client.inventory.zaico.getInboundConfig.query();
    expect(config.directPartnerNames).toEqual([
      "サミー",
      "ルカ",
      "サイモン",
      "マキシム",
      "ネレ",
      "テスト相手",
    ]);
  });

  it("setInboundClass は manual 分類を保存し、null で auto に戻す", async () => {
    const result = await api.client.inventory.zaico.setInboundClass.mutate({
      purchaseId: 910001,
      inboundClass: "oregon",
    });
    expect(result).toEqual({ success: true });
    const [manual] = await rows(
      "SELECT inboundClass, classSource FROM local_purchases WHERE id = 910001",
    );
    expect(manual).toMatchObject({ inboundClass: "oregon", classSource: "manual" });

    await api.client.inventory.zaico.setInboundClass.mutate({
      purchaseId: 910001,
      inboundClass: null,
    });
    const [auto] = await rows(
      "SELECT inboundClass, classSource FROM local_purchases WHERE id = 910001",
    );
    expect(auto).toMatchObject({ inboundClass: null, classSource: "auto" });

    await expect(
      api.client.inventory.zaico.setInboundClass.mutate({ purchaseId: 888888, inboundClass: "ebay" }),
    ).rejects.toThrowError(/発注が見つかりません/);
  });

  it("advanceStage は次工程へ進め、登録工程で status=purchased を連動する", async () => {
    const result = await api.client.inventory.zaico.advanceStage.mutate({
      purchaseId: 910003,
      operatorName: "テスト担当",
    });
    expect(result).toEqual({ success: true, stage: "registered" });
    const [purchase] = await rows(
      "SELECT stage, status, receivedDate, stageUpdatedBy FROM local_purchases WHERE id = 910003",
    );
    expect(purchase).toMatchObject({
      stage: "registered",
      status: "purchased",
      receivedDate: new Date().toISOString().slice(0, 10),
      stageUpdatedBy: "テスト担当",
    });
  });

  it("advanceStage は未仕訳・工程ズレ・最終工程を拒否する", async () => {
    await expect(
      api.client.inventory.zaico.advanceStage.mutate({ purchaseId: 910001 }),
    ).rejects.toThrowError(/先に分類を確定してください/);
    await expect(
      api.client.inventory.zaico.advanceStage.mutate({
        purchaseId: 910002,
        expectedStage: "registered",
      }),
    ).rejects.toThrowError(/工程が更新されています/);
    await expect(
      api.client.inventory.zaico.advanceStage.mutate({ purchaseId: 910004 }),
    ).rejects.toThrowError(/すでに最終工程です/);
  });

  it("separateShaft はeBay/オレゴン行から国内分類の新規行を作る", async () => {
    const result = await api.client.inventory.zaico.separateShaft.mutate({
      purchaseId: 910002,
      operatorName: "テスト担当",
    });
    expect(result.success).toBe(true);
    const [row] = await rows("SELECT * FROM local_purchases WHERE id = ?", [result.newPurchaseId]);
    expect(row).toMatchObject({
      purchaseNum: "TEST-B-S",
      status: "ordered",
      title: "【テスト】ワイヤレスパッドB（シャフト）",
      category: "周辺機器",
      quantity: 1,
      managementNo: "TEST-B-S",
      purchaseDate: "2026-09-02",
      supplierName: "架空仕入先",
      inboundClass: "domestic",
      classSource: "manual",
      stage: "registered",
      stageUpdatedBy: "テスト担当",
      shaftParentPurchaseId: 910002,
    });
    await expect(
      api.client.inventory.zaico.separateShaft.mutate({ purchaseId: 910003 }),
    ).rejects.toThrowError(/シャフト分離はeBay\/オレゴンの行でのみ実行できます/);
  });
});

describe("zaico.getNextPurchaseNum", () => {
  it("数値でない発注Noは無視し、最大値+1 を返す", async () => {
    const initial = await api.client.inventory.zaico.getNextPurchaseNum.query();
    expect(initial).toEqual({ nextNum: 1 });
    await db.query("UPDATE local_purchases SET purchaseNum = '123' WHERE id = 910005");
    const next = await api.client.inventory.zaico.getNextPurchaseNum.query();
    expect(next).toEqual({ nextNum: 124 });
  });
});

describe("zaico.createDelivery", () => {
  it("ローカルDB経路で在庫を減算し、出庫履歴と作業ログを保存する", async () => {
    await db.query("UPDATE local_inventories SET quantity = 5 WHERE id = 910001");
    const result = await api.client.inventory.zaico.createDelivery.mutate({
      deliveryNo: "TEST-OUT-1",
      deliveryDate: "2026-09-26",
      items: [{ inventoryId: 910001, title: "【テスト】携帯ゲーム機A", quantity: 2 }],
    });
    expect(result.success).toBe(true);
    expect(result.zaicoDeliveryId).toBeUndefined();
    expect(result.fedexResult).toBeNull();
    const [inv] = await rows("SELECT quantity FROM local_inventories WHERE id = 910001");
    expect(inv.quantity).toBe(3);
    const histories = await rows(
      "SELECT deliveryNo, zaicoDeliveryId, status, itemsJson FROM delivery_histories WHERE deliveryNo = 'TEST-OUT-1'",
    );
    expect(histories).toHaveLength(1);
    expect(histories[0]).toMatchObject({ zaicoDeliveryId: null, status: "success" });
    const items = JSON.parse(String(histories[0].itemsJson));
    expect(items[0]).toMatchObject({
      inventoryId: 910001,
      title: "【テスト】携帯ゲーム機A",
      quantity: 2,
      managementNo: "TEST-A",
    });
    const logs = await rows(
      "SELECT category FROM work_logs WHERE sourceType = 'delivery' AND sourceId = 'TEST-OUT-1'",
    );
    expect(logs).toHaveLength(1);
    expect(logs[0].category).toBe("出庫登録");
  });

  it("追跡番号あり・GAS_WEBHOOK_URL未設定時は発送記録をerrorで保存し fedexResult.success=false を返す", async () => {
    await db.query("UPDATE local_inventories SET quantity = 5 WHERE id = 910001");
    const result = await api.client.inventory.zaico.createDelivery.mutate({
      deliveryNo: "TEST-OUT-2",
      deliveryDate: "2026-09-26",
      items: [{ inventoryId: 910001, title: "【テスト】携帯ゲーム機A", quantity: 1 }],
      trackingNumber: "TEST-TRACK-OUT",
      sheetName: "独発送管理",
      invoiceNo: "999",
      operatorName: "テスト担当",
    });
    expect(result.success).toBe(true);
    expect(result.fedexResult).toEqual({ success: false, message: "GAS_WEBHOOK_URLが未設定です" });
    const shipments = await rows(
      "SELECT deliveryNo, sheetName, trackingNumber, spreadsheetStatus, operatorName FROM fedex_shipments WHERE deliveryNo = 'TEST-OUT-2'",
    );
    expect(shipments).toHaveLength(1);
    expect(shipments[0]).toMatchObject({
      sheetName: "独発送管理",
      trackingNumber: "TEST-TRACK-OUT",
      spreadsheetStatus: "error",
      operatorName: "テスト担当",
    });
    const fedexLogs = await rows(
      "SELECT category FROM work_logs WHERE sourceType = 'fedex' AND sourceId = 'TEST-OUT-2:TEST-TRACK-OUT'",
    );
    expect(fedexLogs).toHaveLength(1);
    expect(fedexLogs[0].category).toBe("FedEx発送登録");
  });
});
