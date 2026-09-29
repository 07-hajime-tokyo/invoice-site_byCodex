import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";
let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;
beforeAll(async () => {
  db = await connectTestDatabase();
  api = await startTestApi();
  await api.client.inventory.zaico.getPurchases.query();
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
async function rows(sql: string) {
  const [result] = await db.query<RowDataPacket[]>(sql);
  return result;
}
async function orphan(
  managementNo: string,
  labelId: string,
  patch: Record<string, unknown> = {}
) {
  await db.query("INSERT IGNORE INTO local_inventories SET ?", {
    id: 920001,
    title: "【テスト】復旧用在庫",
    etc: managementNo,
    quantity: 0,
    category: "テスト",
    unitPrice: "120.25",
    createdAt: "2026-09-01",
    updatedAt: "2026-09-02",
  });
  await db.query("INSERT INTO inventory_item_labels SET ?", {
    labelId,
    localInventoryId: 920001,
    legacyManagementNo: managementNo,
    title: "【テスト】復旧用商品",
    status: "ordered",
    createdAt: "2026-09-01",
    ...patch,
  });
}
async function recoveryRow(
  id: number,
  managementNo: string,
  patch: Record<string, unknown> = {}
) {
  await db.query("INSERT INTO local_purchases SET ?", {
    id,
    title: "【テスト】復旧行",
    itemsJson: "[]",
    managementNo,
    localInventoryId: 920001,
    quantity: 3,
    status: "ordered",
    classSource: "manual",
    purchaseDate: "2026-09-01",
    ...patch,
  });
}
describe("孤立ラベルの限定復旧", () => {
  it("許可対象だけを復旧しラベルを紐付け、再実行と対象外の発注を保持する", async () => {
    const before = await rows("SELECT * FROM local_purchases ORDER BY id");
    await orphan("在庫0807_4", "RECAA");
    await orphan("在庫0807_4", "RECAB");
    await orphan("NOT_ALLOWED", "RECAC", { purchaseId: 999991 });
    await api.client.inventory.zaico.getPurchases.query();
    const created = await rows(
      "SELECT * FROM local_purchases WHERE managementNo='在庫0807_4'"
    );
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      quantity: 2,
      status: "ordered",
      stageUpdatedBy: "system-repair",
      title: "【テスト】復旧用商品",
      purchaseDate: "2026-09-01",
    });
    const labels = await rows(
      "SELECT purchaseId FROM inventory_item_labels WHERE labelId IN ('RECAA','RECAB') ORDER BY labelId"
    );
    expect(labels).toEqual([
      { purchaseId: created[0].id },
      { purchaseId: created[0].id },
    ]);
    await api.client.inventory.zaico.getPurchases.query();
    expect(
      await rows(
        "SELECT * FROM local_purchases WHERE managementNo='在庫0807_4'"
      )
    ).toEqual(created);
    expect(
      await rows(
        "SELECT * FROM local_purchases WHERE id BETWEEN 910001 AND 910007 ORDER BY id"
      )
    ).toEqual(before);
    expect(
      await rows(
        "SELECT purchaseId FROM inventory_item_labels WHERE labelId='RECAC'"
      )
    ).toEqual([{ purchaseId: 999991 }]);
  });
  it("削除済み在庫・既存発注につながるラベル・既存明細の管理番号からは復旧しない", async () => {
    await orphan("在庫0807_4", "RECAA", { purchaseId: 910001 });
    await orphan("在庫0807_5&6", "RECAB");
    await db.query("UPDATE local_purchases SET itemsJson=? WHERE id=910002", [
      JSON.stringify([{ managementNo: "在庫0807_5&6", inventory_id: 910002 }]),
    ]);
    const before = await rows("SELECT * FROM local_purchases ORDER BY id");
    await api.client.inventory.zaico.getPurchases.query();
    expect(await rows("SELECT * FROM local_purchases ORDER BY id")).toEqual(
      before
    );
    await db.query(
      "UPDATE inventory_item_labels SET purchaseId=NULL WHERE labelId='RECAA'"
    );
    await db.query("UPDATE local_inventories SET isDeleted=1 WHERE id=920001");
    await api.client.inventory.zaico.getPurchases.query();
    expect(await rows("SELECT * FROM local_purchases ORDER BY id")).toEqual(
      before
    );
  });
  it("許可外のsystem-repair行だけを削除し、ラベルを残して発注との紐付けを解除する", async () => {
    await recoveryRow(920010, "NOT_ALLOWED", {
      stageUpdatedBy: "system-repair",
    });
    await recoveryRow(920011, "NOT_ALLOWED_MANUAL", { stageUpdatedBy: "TEST" });
    await orphan("NOT_ALLOWED", "RECAA", { purchaseId: 920010 });
    await orphan("NOT_ALLOWED", "RECAB", {
      purchaseId: 920010,
      status: "received",
    });
    const other = await rows(
      "SELECT * FROM local_purchases WHERE id<>920010 ORDER BY id"
    );
    await api.client.inventory.zaico.getPurchases.query();
    expect(await rows("SELECT * FROM local_purchases ORDER BY id")).toEqual(
      other
    );
    expect(
      await rows(
        "SELECT labelId,purchaseId,status FROM inventory_item_labels WHERE labelId IN ('RECAA','RECAB') ORDER BY labelId"
      )
    ).toEqual([
      { labelId: "RECAA", purchaseId: null, status: "stocked" },
      { labelId: "RECAB", purchaseId: null, status: "received" },
    ]);
  });
  it("指定復旧番号の重複は最小IDを残し、ラベルを残す発注へ付け替える", async () => {
    await recoveryRow(920010, "402_マキシム_1/2");
    await recoveryRow(920011, "402_マキシム_1/2");
    await orphan("402_マキシム_1/2", "RECAA", { purchaseId: 920011 });
    await api.client.inventory.zaico.getPurchases.query();
    expect(
      await rows(
        "SELECT id FROM local_purchases WHERE managementNo='402_マキシム_1/2'"
      )
    ).toEqual([{ id: 920010 }]);
    expect(
      await rows(
        "SELECT purchaseId FROM inventory_item_labels WHERE labelId='RECAA'"
      )
    ).toEqual([{ purchaseId: 920010 }]);
  });
  it("復旧例外の追跡情報を保持し、指定ラベルを優先して数量1へ整える", async () => {
    await recoveryRow(920010, "402_マキシム_2/2", {
      status: "purchased",
      trackingNumber: " TEST-RECOVERY ",
      carrier: " yamato ",
      note: " 保存メモ ",
      shipDate: "2026-09-02",
      stageUpdatedBy: "TEST",
    });
    await orphan("402_マキシム_2/2", "NRFZKRM", {
      purchaseId: 920010,
      status: "received",
    });
    await orphan("402_マキシム_2/2", "RECAB", {
      purchaseId: 920010,
      createdAt: "2026-09-20",
    });
    await api.client.inventory.zaico.getPurchases.query();
    const first = await rows("SELECT * FROM local_purchases WHERE id=920010");
    expect(first[0]).toMatchObject({
      status: "shipped",
      stage: "shipped",
      quantity: 1,
      trackingNumber: "TEST-RECOVERY",
      carrier: "yamato",
      note: "保存メモ",
      receivedDate: null,
      stageUpdatedBy: "TEST",
    });
    expect(
      await rows(
        "SELECT labelId,status,purchaseId FROM inventory_item_labels WHERE legacyManagementNo='402_マキシム_2/2'"
      )
    ).toEqual([{ labelId: "NRFZKRM", status: "ordered", purchaseId: 920010 }]);
    await api.client.inventory.zaico.getPurchases.query();
    expect(await rows("SELECT * FROM local_purchases WHERE id=920010")).toEqual(
      first
    );
    await db.query(
      "UPDATE local_purchases SET trackingNumber=NULL WHERE id=920010"
    );
    await api.client.inventory.zaico.getPurchases.query();
    expect(
      (
        await rows(
          "SELECT status,stage,stageUpdatedBy FROM local_purchases WHERE id=920010"
        )
      )[0]
    ).toEqual({
      status: "ordered",
      stage: "ordered",
      stageUpdatedBy: "system-repair",
    });
  });
});
