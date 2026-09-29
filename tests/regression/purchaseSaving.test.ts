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
const tracking = () =>
  rows(
    "SELECT trackingNumber,carrier,note,status,stage FROM local_purchases WHERE id=910001"
  );
const audits = () =>
  rows(
    "SELECT detailsJson FROM work_logs WHERE sourceType='purchase-tracking-audit' ORDER BY id"
  );
describe("入庫一覧の編集と追跡番号の保存契約", () => {
  it("追跡番号の変更・解除を監査記録に残し、未指定項目と対象外を保持する", async () => {
    const before = await rows(
      "SELECT * FROM local_purchases WHERE id<>910001 ORDER BY id"
    );
    await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 910001,
      trackingNumber: " TEST-SAVE ",
      carrier: " yamato ",
      note: " 保持メモ ",
    });
    expect((await tracking())[0]).toEqual({
      trackingNumber: "TEST-SAVE",
      carrier: "yamato",
      note: "保持メモ",
      status: "shipped",
      stage: "shipped",
    });
    const first = await audits();
    expect(first).toHaveLength(1);
    const details = JSON.parse(first[0].detailsJson);
    expect(details).toMatchObject({
      action: "purchase_tracking_update",
      target: { purchaseId: 910001, managementNo: "TEST-A" },
      before: { trackingNumber: null, status: "ordered" },
      after: { trackingNumber: "TEST-SAVE", status: "shipped" },
    });
    expect(details.changedFields).toContain("trackingNumber");
    await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 910001,
      trackingNumber: "TEST-SAVE",
      carrier: "yamato",
      note: "保持メモ",
    });
    expect(await audits()).toEqual(first);
    await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 910001,
      note: "別メモ",
    });
    expect((await tracking())[0]).toMatchObject({
      trackingNumber: "TEST-SAVE",
      carrier: "yamato",
      note: "別メモ",
      status: "shipped",
    });
    await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 910001,
      trackingNumber: null,
    });
    expect((await tracking())[0]).toEqual({
      trackingNumber: null,
      carrier: null,
      note: "別メモ",
      status: "ordered",
      stage: "ordered",
    });
    expect(
      (await audits()).map(
        row => JSON.parse(row.detailsJson).after.trackingNumber
      )
    ).toEqual(["TEST-SAVE", "TEST-SAVE", null]);
    expect(
      await rows("SELECT * FROM local_purchases WHERE id<>910001 ORDER BY id")
    ).toEqual(before);
  });
  it("直接一致する発注IDを補助条件より優先し、直接一致がなければ管理番号で探す", async () => {
    await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 910001,
      trackingNumber: "DIRECT",
      inventoryId: 910002,
      managementNo: "TEST-B",
    });
    expect((await tracking())[0].trackingNumber).toBe("DIRECT");
    expect(
      (
        await rows("SELECT trackingNumber FROM local_purchases WHERE id=910002")
      )[0].trackingNumber
    ).toBe("TEST-TRACK-B");
    const result = await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 999991,
      trackingNumber: "FALLBACK",
      managementNo: " test-a ,日付",
    });
    expect(result.localUpdatedCount).toBe(1);
    expect((await tracking())[0].trackingNumber).toBe("FALLBACK");
  });
  it("商品ラベルIDでも照合し、監査には正規化したIDを残す", async () => {
    await db.query("INSERT INTO inventory_item_labels SET ?", {
      labelId: "TRACKAA",
      purchaseId: 910001,
      localInventoryId: 910001,
      legacyManagementNo: "TEST-A",
      title: "架空",
    });
    await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 999991,
      trackingNumber: "BY-LABEL",
      labelId: " trackaa ",
    });
    expect((await tracking())[0].trackingNumber).toBe("BY-LABEL");
    expect(JSON.parse((await audits())[0].detailsJson).target.labelIds).toEqual(
      ["TRACKAA"]
    );
  });
  it("入庫済みの状態・工程を追跡番号では戻さず、未知IDの非空追跡番号は拒否する", async () => {
    await db.query(
      "UPDATE local_purchases SET status='purchased',stage='registered' WHERE id=910001"
    );
    await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 910001,
      trackingNumber: "KEEP-PURCHASED",
    });
    await api.client.inventory.purchaseExtra.upsert.mutate({
      zaicoId: 910001,
      trackingNumber: "",
    });
    expect((await tracking())[0]).toMatchObject({
      trackingNumber: null,
      status: "purchased",
      stage: "registered",
    });
    await expect(
      api.client.inventory.purchaseExtra.upsert.mutate({
        zaicoId: 999991,
        trackingNumber: "UNKNOWN",
      })
    ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
    expect(
      await api.client.inventory.purchaseExtra.upsert.mutate({
        zaicoId: 999991,
        note: "NO-TARGET",
      })
    ).toMatchObject({ localUpdatedCount: 0 });
  });
  it("一括保存は一致件数を返し、一部未一致でも既存どおり成功する", async () => {
    const result = await api.client.inventory.purchaseExtra.upsertBulk.mutate({
      zaicoIds: [910001, 910002, 999991],
      trackingNumber: "BULK-SAVE",
    });
    expect(result).toEqual({ success: true, count: 3, localUpdatedCount: 2 });
    expect(
      await rows(
        "SELECT trackingNumber FROM local_purchases WHERE id IN (910001,910002) ORDER BY id"
      )
    ).toEqual([
      { trackingNumber: "BULK-SAVE" },
      { trackingNumber: "BULK-SAVE" },
    ]);
    expect(await audits()).toHaveLength(2);
  });
  it("ローカル編集は先頭明細を更新し、他明細・追跡情報と復元用スナップショットを保持する", async () => {
    await db.query(
      "UPDATE local_purchases SET trackingNumber='KEEP',note='KEEP-NOTE' WHERE id=910001"
    );
    const beforeB = await rows(
      "SELECT * FROM local_inventories WHERE id=910002"
    );
    await api.client.inventory.zaico.updatePurchaseData.mutate({
      purchaseId: 910001,
      memo: "IGNORED",
      purchaseItems: [
        {
          inventoryId: 910001,
          title: " 編集名 ",
          quantity: 2.6,
          unitPrice: 999.25,
          etc: "EDIT-A,2026-09-01,架空",
          category: " 編集分類 ",
        },
        { inventoryId: 910002, title: "変更しない", quantity: 10 },
      ],
    });
    const edited = (
      await rows(
        "SELECT title,quantity,unitPrice,managementNo,trackingNumber,note,itemsJson FROM local_purchases WHERE id=910001"
      )
    )[0];
    expect(edited).toMatchObject({
      title: "編集名",
      quantity: 3,
      managementNo: "EDIT-A",
      trackingNumber: "KEEP",
      note: "KEEP-NOTE",
    });
    expect(Number(edited.unitPrice)).toBe(999.25);
    expect(JSON.parse(edited.itemsJson)[0]).toMatchObject({
      title: "編集名",
      quantity: "3",
      etc: "EDIT-A,2026-09-01,架空",
    });
    expect(
      await rows("SELECT * FROM local_inventories WHERE id=910002")
    ).toEqual(beforeB);
    const snapshots = await rows(
      "SELECT memo FROM inventory_memos WHERE changeType='restore_snapshot'"
    );
    expect(snapshots.length).toBeGreaterThan(0);
    expect(
      snapshots.some(row => row.memo.includes("【テスト】携帯ゲーム機A"))
    ).toBe(true);
  });
  it("壊れた明細JSONでも本体は編集し、未知IDの編集は既存どおり成功を返す", async () => {
    await db.query(
      "UPDATE local_purchases SET itemsJson='broken' WHERE id=910001"
    );
    await api.client.inventory.zaico.updatePurchaseData.mutate({
      purchaseId: 910001,
      purchaseItems: [{ inventoryId: 910001, title: "壊れたJSONの編集" }],
    });
    expect(
      (
        await rows(
          "SELECT title,itemsJson FROM local_purchases WHERE id=910001"
        )
      )[0]
    ).toEqual({ title: "壊れたJSONの編集", itemsJson: "broken" });
    expect(
      await api.client.inventory.zaico.updatePurchaseData.mutate({
        purchaseId: 999991,
      })
    ).toEqual({ success: true });
  });
});
