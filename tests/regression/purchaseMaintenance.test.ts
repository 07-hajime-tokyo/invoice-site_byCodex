import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;
beforeAll(async () => {
  db = await connectTestDatabase();
  api = await startTestApi();
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

describe("一覧読取中の分類保存とラベル調整", () => {
  it("シャフト在庫の不足発注だけを補完し、再読取で増殖させない", async () => {
    await db.query("INSERT INTO local_inventories SET ?", {
      id: 920001,
      title: "【テスト】補完シャフト",
      etc: "シャフト_TEST_NEW,2026-09-01",
      category: "テスト部品",
      quantity: 2,
      unitPrice: "500.25",
      supplierName: "架空補完先",
      supplierUrl: "https://supplier.invalid/shaft",
    });
    await db.query("INSERT INTO local_inventories SET ?", {
      id: 920002,
      title: "【テスト】通常在庫",
      etc: "TEST_NO_PURCHASE,2026-09-01",
      quantity: 2,
    });
    await db.query("INSERT INTO local_inventories SET ?", {
      id: 920003,
      title: "【テスト】削除済みシャフト",
      etc: "シャフト_TEST_DELETED,2026-09-01",
      quantity: 2,
      isDeleted: true,
    });
    const [othersBefore] = await db.query<RowDataPacket[]>(
      "SELECT * FROM local_purchases ORDER BY id"
    );
    const first =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "シャフト_TEST_NEW",
      });
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({
      csvSupplierName: "架空補完先",
      purchase_items: [{ title: "【テスト】補完シャフト", quantity: "2" }],
    });
    const [created] = await db.query<RowDataPacket[]>(
      "SELECT * FROM local_purchases WHERE localInventoryId=920001"
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      managementNo: "シャフト_TEST_NEW",
      purchaseDate: "2026-09-01",
      status: "ordered",
      quantity: 2,
      supplierUrl: "https://supplier.invalid/shaft",
    });
    expect(Number(created[0].unitPrice)).toBe(500.25);
    const second =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
        search: "シャフト_TEST_NEW",
      });
    expect(second).toEqual(first);
    const [all] = await db.query<RowDataPacket[]>(
      "SELECT * FROM local_purchases ORDER BY id"
    );
    expect(all).toHaveLength(8);
    expect(all.filter(row => row.localInventoryId !== 920001)).toEqual(
      othersBefore
    );
  });

  it("別の発注明細にあるシャフト管理番号も補完済みとして扱う", async () => {
    await db.query("INSERT INTO local_inventories SET ?", {
      id: 920001,
      title: "【テスト】明細内シャフト",
      etc: "シャフト_TEST_EXISTS,2026-09-01",
      quantity: 2,
    });
    const itemsJson = JSON.stringify([
      {
        inventory_id: 920001,
        title: "【テスト】明細内シャフト",
        etc: " シャフト_TEST_EXISTS ,日付",
        quantity: "2",
      },
    ]);
    await db.query("UPDATE local_purchases SET itemsJson=? WHERE id=910001", [
      itemsJson,
    ]);
    const [before] = await db.query<RowDataPacket[]>(
      "SELECT * FROM local_purchases ORDER BY id"
    );
    await api.client.inventory.zaico.getPurchasesWithCategory.query();
    const [after] = await db.query<RowDataPacket[]>(
      "SELECT * FROM local_purchases ORDER BY id"
    );
    expect(after).toEqual(before);
  });

  it("自動分類だけを更新し、手動分類・工程・他の発注を保持する", async () => {
    await db.query(
      "UPDATE local_purchases SET classSource='auto', stage='registered', stageUpdatedBy='TEST', shaftParentPurchaseId=42 WHERE id=910001"
    );
    await db.query(
      "UPDATE local_inventories SET place='Oregon倉庫' WHERE id IN (910001,910002)"
    );
    const [othersBefore] = await db.query<RowDataPacket[]>(
      "SELECT * FROM local_purchases WHERE id<>910001 ORDER BY id"
    );
    const first =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
    expect(first.items.find(row => row.id === 910001)).toMatchObject({
      inboundClass: "oregon",
      classSource: "auto",
      stage: "registered",
      stageUpdatedBy: "TEST",
      shaftParentPurchaseId: 42,
    });
    expect(first.items.find(row => row.id === 910002)).toMatchObject({
      inboundClass: "ebay",
    });
    const [stored] = await db.query<RowDataPacket[]>(
      "SELECT inboundClass,classSource,stage,stageUpdatedBy,shaftParentPurchaseId FROM local_purchases WHERE id=910001"
    );
    expect(stored[0]).toEqual({
      inboundClass: "oregon",
      classSource: "auto",
      stage: "registered",
      stageUpdatedBy: "TEST",
      shaftParentPurchaseId: 42,
    });
    const second =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
    expect(second).toEqual(first);
    const [othersAfter] = await db.query<RowDataPacket[]>(
      "SELECT * FROM local_purchases WHERE id<>910001 ORDER BY id"
    );
    expect(othersAfter).toEqual(othersBefore);
  });

  it("設定した相手名を自動分類で使い、eBayとの矛盾は未仕訳へ戻す", async () => {
    await db.query("INSERT INTO system_settings SET ?", {
      key: "inbound_direct_partner_names",
      value: " 架空の直取先、架空の直取先\n",
    });
    await db.query(
      "UPDATE local_purchases SET classSource='auto', managementNo='999_架空の直取先_商品' WHERE id=910001"
    );
    const direct =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
    expect(direct.items.find(row => row.id === 910001)).toMatchObject({
      inboundClass: "direct",
    });
    await db.query(
      "UPDATE local_inventories SET ebayOrderUrl='https://ebay.invalid/order' WHERE id=910001"
    );
    const conflict =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
    expect(conflict.items.find(row => row.id === 910001)).toMatchObject({
      inboundClass: null,
    });
    const [stored] = await db.query<RowDataPacket[]>(
      "SELECT inboundClass,classSource FROM local_purchases WHERE id=910001"
    );
    expect(stored[0]).toEqual({ inboundClass: null, classSource: "auto" });
  });

  it("管理番号がnullなら在庫備考を使い、空文字なら在庫備考で補わない", async () => {
    await db.query(
      "UPDATE local_purchases SET classSource='auto', managementNo=NULL WHERE id=910001"
    );
    await db.query(
      "UPDATE local_inventories SET etc='E9999_架空,20260901' WHERE id=910001"
    );
    const fallback =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
    expect(fallback.items.find(row => row.id === 910001)).toMatchObject({
      inboundClass: "ebay",
    });
    await db.query(
      "UPDATE local_purchases SET managementNo='' WHERE id=910001"
    );
    const blank =
      await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({});
    expect(blank.items.find(row => row.id === 910001)).toMatchObject({
      inboundClass: null,
    });
  });

  it("余分なラベルを数量に合わせ、発送済み・受領済みと無関係な発注を保持する", async () => {
    for (const [labelId, status, purchaseId, managementNo] of [
      ["MAINTAA", "ordered", 910001, "TEST-A"],
      ["MAINTAB", "received", 910001, "TEST-A"],
      ["MAINTAC", "shipped", 910001, "TEST-A"],
      ["MAINTAD", "ordered", 910002, "TEST-B"],
    ] as const) {
      await db.query("INSERT INTO inventory_item_labels SET ?", {
        labelId,
        status,
        purchaseId,
        localInventoryId: purchaseId,
        legacyManagementNo: managementNo,
        title: "架空の商品",
      });
    }
    const [otherBefore] = await db.query<RowDataPacket[]>(
      "SELECT * FROM inventory_item_labels WHERE purchaseId=910002"
    );
    await api.client.inventory.zaico.getPurchasesWithCategoryPage.query({
      search: "TEST-A",
    });
    const [first] = await db.query<RowDataPacket[]>(
      "SELECT labelId,status FROM inventory_item_labels WHERE purchaseId=910001 ORDER BY labelId"
    );
    expect(first).toEqual([
      { labelId: "MAINTAB", status: "received" },
      { labelId: "MAINTAC", status: "shipped" },
    ]);
    await api.client.inventory.zaico.getPurchasesWithCategory.query();
    const [second] = await db.query<RowDataPacket[]>(
      "SELECT labelId,status FROM inventory_item_labels WHERE purchaseId=910001 ORDER BY labelId"
    );
    const [otherAfter] = await db.query<RowDataPacket[]>(
      "SELECT * FROM inventory_item_labels WHERE purchaseId=910002"
    );
    expect(second).toEqual(first);
    expect(otherAfter).toEqual(otherBefore);
  });
});
