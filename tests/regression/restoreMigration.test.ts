import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

/**
 * 削除・復元・移行（deletedItems / restoreManagement / migration）の整理前基準。
 * ルーター抽出の前後で同じ入力に対する保存値・応答が変わらないことを固定する。
 */

let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;

beforeAll(async () => {
  db = await connectTestDatabase();
  api = await startTestApi();
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

async function rows(sql: string, params: unknown[] = []) {
  const [result] = await db.query<RowDataPacket[]>(sql, params);
  return result;
}

const FULL_RESTORE_MARKER = "__FULL_RESTORE_SNAPSHOT_V1__:";

async function insertDeletedRecord(
  id: number,
  patch: Record<string, unknown> = {},
  snapshot: Record<string, unknown> = {},
) {
  await db.query("INSERT INTO deleted_inventories SET ?", {
    id,
    zaicoId: 940000 + id,
    title: "【テスト】削除記録",
    category: "テスト",
    place: "棚D",
    quantity: "2",
    unit: "個",
    unitPrice: "1000",
    etc: "TEST-DEL",
    snapshotJson: JSON.stringify({
      title: "【テスト】削除記録",
      quantity: "2",
      unit: "個",
      category: "テスト",
      place: "棚D",
      etc: "TEST-DEL",
      unit_price: 1000,
      ...snapshot,
    }),
    deletedBy: "テスト担当",
    createdAt: "2026-09-10 12:00:00",
    ...patch,
  });
}

async function insertMemo(values: Record<string, unknown>): Promise<number> {
  const [result] = await db.query("INSERT INTO inventory_memos SET ?", {
    title: "【テスト】メモ",
    changeType: "updated",
    createdAt: "2026-09-11 12:00:00",
    ...values,
  });
  return (result as { insertId: number }).insertId;
}

describe("削除済み商品（deletedItems）", () => {
  it("削除の記録→一覧→復元→記録削除の往復を保持する", async () => {
    await api.client.inventory.deletedItems.deleteAndRecord.mutate({
      zaicoId: 910001,
      title: "【テスト】携帯ゲーム機A",
      category: "ゲーム機",
      place: "棚A",
      quantity: "2",
      unit: "個",
      unitPrice: "1500.25",
      etc: "TEST-A",
      snapshotJson: JSON.stringify({
        title: "【テスト】携帯ゲーム機A",
        quantity: "2",
        unit: "個",
        category: "ゲーム機",
        place: "棚A",
        etc: "TEST-A",
        unit_price: 1500.25,
      }),
      deletedBy: "テスト担当",
    });

    // 元の在庫は論理削除される（行は残る）
    expect(
      await rows("SELECT isDeleted FROM local_inventories WHERE id=910001"),
    ).toEqual([{ isDeleted: 1 }]);

    const recorded = await rows("SELECT * FROM deleted_inventories");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({
      zaicoId: 910001,
      title: "【テスト】携帯ゲーム機A",
      category: "ゲーム機",
      place: "棚A",
      quantity: "2",
      unit: "個",
      unitPrice: "1500.25",
      etc: "TEST-A",
      deletedBy: "テスト担当",
    });

    const list = await api.client.inventory.deletedItems.list.query();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ zaicoId: 910001, title: "【テスト】携帯ゲーム機A" });

    const result = await api.client.inventory.deletedItems.restore.mutate({ id: recorded[0].id });
    expect(result).toEqual({ success: true });

    // 復元はスナップショットから新しい行を upsert（zaicoId を引き継ぐ）し、
    // 仕入先情報は null で作り直す（既存仕様）
    const restored = await rows("SELECT * FROM local_inventories WHERE zaicoId=910001");
    expect(restored).toHaveLength(1);
    expect(restored[0]).toMatchObject({
      title: "【テスト】携帯ゲーム機A",
      quantity: 2,
      unit: "個",
      category: "ゲーム機",
      place: "棚A",
      etc: "TEST-A",
      unitPrice: "1500.25",
      supplierName: null,
      supplierUrl: null,
      isDeleted: 0,
    });
    // 元の論理削除行はそのまま残る（既存仕様）
    expect(
      await rows("SELECT isDeleted FROM local_inventories WHERE id=910001"),
    ).toEqual([{ isDeleted: 1 }]);
    expect(await rows("SELECT * FROM deleted_inventories")).toHaveLength(0);
  });

  it("permanentDelete は削除記録だけを消し在庫へ影響しない", async () => {
    await insertDeletedRecord(930001);
    const before = await rows("SELECT id, isDeleted FROM local_inventories ORDER BY id");

    await api.client.inventory.deletedItems.permanentDelete.mutate({ id: 930001 });

    expect(await rows("SELECT * FROM deleted_inventories")).toHaveLength(0);
    expect(await rows("SELECT id, isDeleted FROM local_inventories ORDER BY id")).toEqual(before);
  });

  it("負の在庫数は deletedItems.restore ではそのまま、restoreDeleted では0へ切り上げる", async () => {
    await insertDeletedRecord(930001, { zaicoId: 941001 }, {
      quantity: "-3",
      supplierName: "架空仕入先X",
      supplier_url: "https://example.invalid/x",
    });
    await insertDeletedRecord(930002, { zaicoId: 941002 }, {
      quantity: "-3",
      supplierName: "架空仕入先X",
      supplierUrl: "https://example.invalid/x",
    });

    await api.client.inventory.deletedItems.restore.mutate({ id: 930001 });
    await api.client.inventory.restoreManagement.restoreDeleted.mutate({ id: 930002 });

    // deletedItems.restore: 丸めのみ（負数のまま）・仕入先は null
    expect(
      await rows("SELECT quantity, supplierName, supplierUrl FROM local_inventories WHERE zaicoId=941001"),
    ).toEqual([{ quantity: -3, supplierName: null, supplierUrl: null }]);
    // restoreManagement.restoreDeleted: 0 に切り上げ・スナップショットの仕入先を復元
    expect(
      await rows("SELECT quantity, supplierName, supplierUrl, ebayOrderStatus FROM local_inventories WHERE zaicoId=941002"),
    ).toEqual([
      {
        quantity: 0,
        supplierName: "架空仕入先X",
        supplierUrl: "https://example.invalid/x",
        ebayOrderStatus: "normal",
      },
    ]);
    expect(await rows("SELECT * FROM deleted_inventories")).toHaveLength(0);
  });
});

describe("復元管理（restoreManagement）", () => {
  it("search は在庫・削除済み・完全復元・変更履歴の4系列を返す", async () => {
    await insertDeletedRecord(930001);
    const snapshotMemoId = await insertMemo({
      zaicoInventoryId: 910002,
      title: "【テスト】ワイヤレスパッドB",
      changeType: "restore_snapshot",
      quantityDelta: 0,
      memo: `${FULL_RESTORE_MARKER}${JSON.stringify({
        version: 1,
        capturedAt: "2026-09-11T00:00:00.000Z",
        source: "テスト保存元",
        reason: "編集前保存",
        inventory: {
          id: 910002,
          title: "【テスト】ワイヤレスパッドB",
          quantity: 1,
          unit: "個",
          etc: "TEST-B",
          itemLabels: [{ labelId: "RSTAA", localInventoryId: 910002, title: "【テスト】ワイヤレスパッドB", status: "stocked" }],
        },
        purchases: [
          { id: 910002, title: "【テスト】ワイヤレスパッドB", managementNo: "TEST-B", quantity: 1, status: "shipped" },
        ],
      })}`,
    });
    const historyMemoId = await insertMemo({
      zaicoInventoryId: 910001,
      title: "【テスト】携帯ゲーム機A",
      memo: "商品名: 【テスト】旧商品名 → 【テスト】携帯ゲーム機A / 在庫数: 5 → 0",
    });

    const all = await api.client.inventory.restoreManagement.search.query({ query: "", limit: 100 });
    expect(all.inventories.length).toBe(7);
    expect(all.inventories.find((row) => row.id === 910001)).toMatchObject({
      title: "【テスト】携帯ゲーム機A",
      managementNo: "TEST-A",
      isDeleted: false,
      supplierName: "架空仕入先",
    });
    expect(all.deletedItems).toHaveLength(1);
    expect(all.deletedItems[0]).toMatchObject({ id: 930001, managementNo: "TEST-DEL" });
    expect(all.fullSnapshots).toHaveLength(1);
    expect(all.fullSnapshots[0]).toMatchObject({
      id: snapshotMemoId,
      title: "【テスト】ワイヤレスパッドB",
      managementNo: "TEST-B",
      source: "テスト保存元",
      reason: "編集前保存",
      inventoryLocalId: 910002,
      hasInventory: true,
      purchaseCount: 1,
      labelCount: 1,
      canRestore: true,
    });
    const history = all.histories.find((row) => row.id === historyMemoId);
    expect(history).toMatchObject({
      inventoryLocalId: 910001,
      title: "【テスト】携帯ゲーム機A",
      managementNo: "TEST-A",
      canRestore: true,
    });
    expect(history?.fields).toEqual([
      {
        field: "title",
        label: "商品名",
        restoreValue: "【テスト】旧商品名",
        currentValue: "【テスト】携帯ゲーム機A",
      },
      { field: "quantity", label: "在庫数", restoreValue: "5", currentValue: "0" },
    ]);

    // ラベルIDはスナップショットの haystack だけに一致する
    const filtered = await api.client.inventory.restoreManagement.search.query({ query: "rstaa", limit: 100 });
    expect(filtered.inventories).toHaveLength(0);
    expect(filtered.deletedItems).toHaveLength(0);
    expect(filtered.fullSnapshots).toHaveLength(1);
    expect(filtered.histories).toHaveLength(0);
  });

  it("restoreFullSnapshot は在庫・発注・商品IDをスナップショット時点へ戻し再実行しても安定する", async () => {
    // 上書き後の状態を作る
    await db.query(
      "UPDATE local_inventories SET title='【テスト】上書き後', quantity=9, etc='CHANGED' WHERE id=910002",
    );
    await db.query(
      "UPDATE local_purchases SET trackingNumber='CHANGED-TRACK', status='ordered' WHERE id=910002",
    );

    const purchaseItemsJson = JSON.stringify([
      {
        id: 910002,
        inventory_id: 910002,
        title: "【テスト】ワイヤレスパッドB",
        quantity: "1",
        unit_price: "2400.00",
        etc: "TEST-B",
        status: "shipped",
      },
    ]);
    const memoId = await insertMemo({
      zaicoInventoryId: 910002,
      title: "【テスト】ワイヤレスパッドB",
      changeType: "restore_snapshot",
      quantityDelta: 0,
      memo: `${FULL_RESTORE_MARKER}${JSON.stringify({
        version: 1,
        capturedAt: "2026-09-11T00:00:00.000Z",
        source: "テスト保存元",
        reason: "編集前保存",
        inventory: {
          id: 910002,
          zaicoId: null,
          title: "【テスト】ワイヤレスパッドB",
          category: "周辺機器",
          place: null,
          quantity: 0,
          unit: "個",
          unitPrice: "2400.00",
          etc: "TEST-B",
          supplierName: "架空仕入先",
          isDeleted: 0,
          itemLabels: [
            {
              labelId: "RSTBB",
              purchaseId: 910002,
              localInventoryId: 910002,
              legacyManagementNo: "TEST-B",
              title: "【テスト】ワイヤレスパッドB",
              status: "stocked",
            },
          ],
        },
        purchases: [
          {
            id: 910002,
            zaicoId: null,
            purchaseNum: "TEST-910002",
            status: "shipped",
            itemsJson: purchaseItemsJson,
            localInventoryId: 910002,
            title: "【テスト】ワイヤレスパッドB",
            quantity: 1,
            unitPrice: "2400.00",
            managementNo: "TEST-B",
            purchaseDate: "2026-09-02",
            trackingNumber: "TEST-TRACK-B",
            inboundClass: "ebay",
            classSource: "manual",
            stage: "received",
          },
        ],
      })}`,
    });

    const result = await api.client.inventory.restoreManagement.restoreFullSnapshot.mutate({ memoId });
    expect(result).toMatchObject({
      success: true,
      restoredInventoryId: 910002,
      purchaseCount: 1,
      labelCount: 1,
    });

    expect(
      await rows(
        "SELECT title, quantity, etc, unit, unitPrice, supplierName, isDeleted FROM local_inventories WHERE id=910002",
      ),
    ).toEqual([
      {
        title: "【テスト】ワイヤレスパッドB",
        quantity: 0,
        etc: "TEST-B",
        unit: "個",
        unitPrice: "2400.00",
        supplierName: "架空仕入先",
        isDeleted: 0,
      },
    ]);
    expect(
      await rows(
        "SELECT status, trackingNumber, managementNo, quantity, stage FROM local_purchases WHERE id=910002",
      ),
    ).toEqual([
      {
        status: "shipped",
        trackingNumber: "TEST-TRACK-B",
        managementNo: "TEST-B",
        quantity: 1,
        stage: "received",
      },
    ]);
    expect(
      await rows(
        "SELECT purchaseId, localInventoryId, legacyManagementNo, status FROM inventory_item_labels WHERE labelId='RSTBB'",
      ),
    ).toEqual([
      { purchaseId: 910002, localInventoryId: 910002, legacyManagementNo: "TEST-B", status: "stocked" },
    ]);
    const changeMemos = await rows(
      "SELECT changeType, memo FROM inventory_memos WHERE zaicoInventoryId=910002 AND changeType='updated'",
    );
    expect(changeMemos).toHaveLength(1);
    expect(String(changeMemos[0].memo)).toContain(`完全復元スナップショット #${memoId} を復元`);

    // 再実行しても同じ状態のまま（行の重複なし）
    await api.client.inventory.restoreManagement.restoreFullSnapshot.mutate({ memoId });
    expect(await rows("SELECT id FROM local_purchases WHERE id=910002")).toHaveLength(1);
    expect(await rows("SELECT id FROM inventory_item_labels WHERE labelId='RSTBB'")).toHaveLength(1);
    expect(
      await rows("SELECT title, quantity FROM local_inventories WHERE id=910002"),
    ).toEqual([{ title: "【テスト】ワイヤレスパッドB", quantity: 0 }]);
  });

  it("restoreFromHistory は変更前の値へ戻しラベルと履歴を残す", async () => {
    const memoId = await insertMemo({
      zaicoInventoryId: 910003,
      title: "【テスト】収納ケースC",
      memo: "商品名: 【テスト】旧ケースC → 【テスト】収納ケースC / 在庫数: 4 → 0 / 仕入先: 旧仕入先 → 架空仕入先",
    });

    await api.client.inventory.restoreManagement.restoreFromHistory.mutate({
      localInventoryId: 910003,
      memoId,
    });

    expect(
      await rows("SELECT title, quantity, supplierName FROM local_inventories WHERE id=910003"),
    ).toEqual([
      { title: "【テスト】旧ケースC", quantity: 4, supplierName: "旧仕入先" },
    ]);
    // 在庫数4に合わせて stocked のラベルが作られる
    expect(
      await rows(
        "SELECT id FROM inventory_item_labels WHERE localInventoryId=910003 AND status='stocked'",
      ),
    ).toHaveLength(4);
    const changeMemos = await rows(
      "SELECT memo, quantityBefore, quantityAfter FROM inventory_memos WHERE zaicoInventoryId=910003 AND changeType='updated' AND id<>?",
      [memoId],
    );
    expect(changeMemos).toHaveLength(1);
    expect(String(changeMemos[0].memo)).toContain(`変更履歴 #${memoId} の変更前に復元`);
    expect(changeMemos[0]).toMatchObject({ quantityBefore: 0, quantityAfter: 4 });
  });

  it("restoreFromHistory は復元できる変更前データがない履歴を拒否する", async () => {
    const memoId = await insertMemo({
      zaicoInventoryId: 910003,
      memo: "自由記述のメモのみ",
    });
    await expect(
      api.client.inventory.restoreManagement.restoreFromHistory.mutate({
        localInventoryId: 910003,
        memoId,
      }),
    ).rejects.toThrow("この履歴には復元できる変更前データがありません");
  });
});

describe("Zaico移行（migration）", () => {
  it("Zaico連携は常に無効のまま、インポートAPIは無効メッセージを返す", async () => {
    expect(await api.client.inventory.migration.getZaicoEnabled.query()).toEqual({ enabled: false });

    expect(
      await api.client.inventory.migration.setZaicoEnabled.mutate({ enabled: true }),
    ).toEqual({ success: true, enabled: false });
    expect(
      await rows("SELECT value FROM system_settings WHERE `key`='zaico_enabled'"),
    ).toEqual([{ value: "false" }]);
    expect(await api.client.inventory.migration.getZaicoEnabled.query()).toEqual({ enabled: false });

    const before = await rows("SELECT id FROM local_inventories ORDER BY id");
    expect(await api.client.inventory.migration.importFromZaico.mutate()).toEqual({
      inventories: 0,
      purchases: 0,
      errors: ["Zaico API integration is disabled. Use CSV import or create records in this site."],
    });
    expect(await rows("SELECT id FROM local_inventories ORDER BY id")).toEqual(before);
  });

  it("getImportStats は削除済みを除く在庫件数と発注件数を返す", async () => {
    await db.query("UPDATE local_inventories SET isDeleted=1 WHERE id=910007");
    expect(await api.client.inventory.migration.getImportStats.query()).toEqual({
      inventories: 6,
      purchases: 7,
    });
  });

  it("importZaicoCsv は備考3パーツの分解と zaicoId 単位の upsert を保持する", async () => {
    const csvText = [
      "在庫ID,物品名,カテゴリ,保管場所,数量,単位,備考,仕入単価",
      '880001,【テスト】CSV商品X,ゲーム機,棚X,3,個,"CSV-X, 2026-01-05 10:00:00, 架空商店",1200',
      ",【テスト】CSV商品Y,,,2,,CSV-Y備考,",
    ].join("\n");

    const first = await api.client.inventory.migration.importZaicoCsv.mutate({ csvText });
    expect(first).toEqual({ total: 2, inserted: 2, updated: 0, errors: [] });

    expect(
      await rows(
        "SELECT title, category, place, quantity, unit, unitPrice, etc, supplierName, isDeleted FROM local_inventories WHERE zaicoId=880001",
      ),
    ).toEqual([
      {
        title: "【テスト】CSV商品X",
        category: "ゲーム機",
        place: "棚X",
        quantity: 3,
        unit: "個",
        unitPrice: "1200.00",
        etc: "CSV-X",
        supplierName: "架空商店",
        isDeleted: 0,
      },
    ]);
    // 備考が3パーツ未満なら全文を etc に保持し仕入先は付けない
    expect(
      await rows(
        "SELECT quantity, unit, etc, supplierName FROM local_inventories WHERE title='【テスト】CSV商品Y'",
      ),
    ).toEqual([{ quantity: 2, unit: "個", etc: "CSV-Y備考", supplierName: null }]);

    // 再インポート: zaicoId あり→更新 / なし→新規挿入（既存仕様）
    const second = await api.client.inventory.migration.importZaicoCsv.mutate({
      csvText: csvText.replace(",3,個,", ",5,個,"),
    });
    expect(second).toEqual({ total: 2, inserted: 1, updated: 1, errors: [] });
    expect(
      await rows("SELECT quantity FROM local_inventories WHERE zaicoId=880001"),
    ).toEqual([{ quantity: 5 }]);
    expect(
      await rows("SELECT id FROM local_inventories WHERE title='【テスト】CSV商品Y'"),
    ).toHaveLength(2);
  });

  it("importZaicoCsv は必須列の欠落とデータなしを拒否する", async () => {
    await expect(
      api.client.inventory.migration.importZaicoCsv.mutate({ csvText: "ヘッダーのみ" }),
    ).rejects.toThrow("データがありません");
    await expect(
      api.client.inventory.migration.importZaicoCsv.mutate({
        csvText: "カテゴリ,保管場所\nゲーム機,棚X",
      }),
    ).rejects.toThrow("必須列（在庫ID、物品名）が見つかりません");
  });
});
