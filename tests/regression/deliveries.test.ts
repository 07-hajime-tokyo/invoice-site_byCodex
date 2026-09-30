import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

/**
 * 出庫履歴（deliveryHistory）ルーターの整理前基準。
 * ルーター抽出・画面整理の前後で同じ入力に対する保存値・応答が変わらないことを固定する。
 * Zaico連携は専用DBでは常に無効・GAS_WEBHOOK_URL未設定のため、ローカルDB経路のみを検証する。
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

type HistoryPatch = Record<string, unknown>;

async function insertHistory(id: number, patch: HistoryPatch = {}) {
  await db.query("INSERT INTO delivery_histories SET ?", {
    id,
    deliveryNo: "379_1",
    zaicoDeliveryId: null,
    itemsJson: JSON.stringify([
      { inventoryId: 910001, title: "【テスト】携帯ゲーム機A", quantity: 2 },
      { inventoryId: 910002, title: "【テスト】ワイヤレスパッドB", quantity: 1 },
    ]),
    status: "success",
    errorMessage: null,
    deletedInventoryIdsJson: null,
    cancelledItemsJson: null,
    createdAt: "2026-09-20 12:00:00",
    ...patch,
  });
}

async function insertFedexShipment(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO fedex_shipments SET ?", {
    id,
    deliveryNo: "379_1",
    sheetName: "独発送管理",
    shippingDate: "9/20",
    trackingNumber: "TEST-FEDEX-1",
    itemsJson: JSON.stringify([
      { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 2 },
    ]),
    spreadsheetStatus: "pending",
    historyId: null,
    createdAt: "2026-09-20 12:00:00",
    ...patch,
  });
}

describe("出庫履歴（deliveryHistory.list / listByInvoicePrefix）", () => {
  it("list はJSON列を配列に展開し作成日時の降順で返す", async () => {
    await insertHistory(920001, {
      deliveryNo: "379_1",
      createdAt: "2026-09-20 12:00:00",
      deletedInventoryIdsJson: JSON.stringify([910002]),
      cancelledItemsJson: JSON.stringify([
        { inventoryId: 910001, quantity: 1, cancelledAt: "2026-09-21T00:00:00.000Z" },
      ]),
    });
    await insertHistory(920002, {
      deliveryNo: "380_1",
      createdAt: "2026-09-22 12:00:00",
      itemsJson: JSON.stringify([
        { inventoryId: 910003, title: "【テスト】収納ケースC", quantity: 3 },
      ]),
    });

    const list = await api.client.inventory.deliveryHistory.list.query({ limit: 100 });
    expect(list.map((h) => h.id)).toEqual([920002, 920001]);
    expect(list[0]).toMatchObject({
      deliveryNo: "380_1",
      zaicoDeliveryId: null,
      status: "success",
      errorMessage: null,
      items: [{ inventoryId: 910003, title: "【テスト】収納ケースC", quantity: 3 }],
      deletedInventoryIds: [],
      cancelledItems: [],
    });
    expect(list[1]).toMatchObject({
      deliveryNo: "379_1",
      items: [
        { inventoryId: 910001, title: "【テスト】携帯ゲーム機A", quantity: 2 },
        { inventoryId: 910002, title: "【テスト】ワイヤレスパッドB", quantity: 1 },
      ],
      deletedInventoryIds: [910002],
      cancelledItems: [
        { inventoryId: 910001, quantity: 1, cancelledAt: "2026-09-21T00:00:00.000Z" },
      ],
    });
    // 生JSON列も応答に残る（既存仕様）
    expect(typeof list[0].itemsJson).toBe("string");

    const limited = await api.client.inventory.deliveryHistory.list.query({ limit: 1 });
    expect(limited.map((h) => h.id)).toEqual([920002]);
  });

  it("listByInvoicePrefix はインボイスNo接頭辞で絞り込む", async () => {
    await insertHistory(920001, { deliveryNo: "379_1", createdAt: "2026-09-20 12:00:00" });
    await insertHistory(920002, { deliveryNo: "379_2", createdAt: "2026-09-21 12:00:00" });
    await insertHistory(920003, { deliveryNo: "380_1", createdAt: "2026-09-22 12:00:00" });

    const result = await api.client.inventory.deliveryHistory.listByInvoicePrefix.query({
      invoiceNo: "379",
    });
    expect(result.map((h) => [h.id, h.deliveryNo])).toEqual([
      [920002, "379_2"],
      [920001, "379_1"],
    ]);
    expect(result[0].items).toEqual([
      { inventoryId: 910001, title: "【テスト】携帯ゲーム機A", quantity: 2 },
      { inventoryId: 910002, title: "【テスト】ワイヤレスパッドB", quantity: 1 },
    ]);
  });
});

describe("出庫履歴の編集（markDeleted / updateDeliveryNo / bulkUpdateDeliveryNo）", () => {
  it("markDeleted は削除済みIDリストをそのまま保存する", async () => {
    await insertHistory(920001);
    expect(
      await api.client.inventory.deliveryHistory.markDeleted.mutate({
        historyId: 920001,
        deletedIds: [910001, 910002],
      }),
    ).toEqual({ ok: true });
    expect(
      await rows("SELECT deletedInventoryIdsJson FROM delivery_histories WHERE id=920001"),
    ).toEqual([{ deletedInventoryIdsJson: "[910001,910002]" }]);
  });

  it("updateDeliveryNo はDBの出庫Noのみ更新する（Zaico無効）", async () => {
    await insertHistory(920001);
    expect(
      await api.client.inventory.deliveryHistory.updateDeliveryNo.mutate({
        historyId: 920001,
        zaicoDeliveryId: null,
        deliveryNo: "381_9",
      }),
    ).toEqual({ ok: true });
    expect(await rows("SELECT deliveryNo FROM delivery_histories WHERE id=920001")).toEqual([
      { deliveryNo: "381_9" },
    ]);
  });

  it("bulkUpdateDeliveryNo は複数履歴をまとめて変更する", async () => {
    await insertHistory(920001, { deliveryNo: "379_1" });
    await insertHistory(920002, { deliveryNo: "379_2", createdAt: "2026-09-21 12:00:00" });
    expect(
      await api.client.inventory.deliveryHistory.bulkUpdateDeliveryNo.mutate({
        historyIds: [920001, 920002],
        deliveryNo: "382_1",
      }),
    ).toEqual({ ok: true, updatedCount: 2 });
    expect(
      await rows("SELECT id, deliveryNo FROM delivery_histories ORDER BY id"),
    ).toEqual([
      { id: 920001, deliveryNo: "382_1" },
      { id: 920002, deliveryNo: "382_1" },
    ]);
  });
});

describe("商品単位の出庫No変更（moveItemsToDeliveryNo）", () => {
  it("一部商品の移動は元履歴を残し新しい出庫Noの履歴を新規作成する", async () => {
    await insertHistory(920001);
    await insertFedexShipment(930001, { historyId: 920001 });

    const result = await api.client.inventory.deliveryHistory.moveItemsToDeliveryNo.mutate({
      historyId: 920001,
      inventoryIds: [910002],
      newDeliveryNo: "383_1",
    });
    expect(result).toEqual({
      ok: true,
      movedCount: 1,
      remainingCount: 1,
      merged: false,
      gasResults: [],
    });

    expect(
      await rows("SELECT itemsJson FROM delivery_histories WHERE id=920001"),
    ).toEqual([
      {
        itemsJson: JSON.stringify([
          { inventoryId: 910001, title: "【テスト】携帯ゲーム機A", quantity: 2 },
        ]),
      },
    ]);
    const created = await rows(
      "SELECT deliveryNo, zaicoDeliveryId, itemsJson, status, errorMessage, deletedInventoryIdsJson, cancelledItemsJson FROM delivery_histories WHERE deliveryNo='383_1'",
    );
    expect(created).toEqual([
      {
        deliveryNo: "383_1",
        zaicoDeliveryId: null,
        itemsJson: JSON.stringify([
          { inventoryId: 910002, title: "【テスト】ワイヤレスパッドB", quantity: 1 },
        ]),
        status: "success",
        errorMessage: null,
        deletedInventoryIdsJson: null,
        cancelledItemsJson: null,
      },
    ]);

    // 追跡番号（fedex_shipments）は移動先historyId・出庫Noへ引き継がれる
    const newHistoryId = (
      await rows("SELECT id FROM delivery_histories WHERE deliveryNo='383_1'")
    )[0].id;
    expect(
      await rows("SELECT historyId, deliveryNo FROM fedex_shipments WHERE id=930001"),
    ).toEqual([{ historyId: newHistoryId, deliveryNo: "383_1" }]);
  });

  it("移動先に既存履歴があれば数量を加算してマージする", async () => {
    await insertHistory(920001);
    await insertHistory(920002, {
      deliveryNo: "384_1",
      createdAt: "2026-09-21 12:00:00",
      itemsJson: JSON.stringify([
        { inventoryId: 910001, title: "【テスト】携帯ゲーム機A", quantity: 5 },
      ]),
    });

    const result = await api.client.inventory.deliveryHistory.moveItemsToDeliveryNo.mutate({
      historyId: 920001,
      inventoryIds: [910001, 910002],
      newDeliveryNo: "384_1",
    });
    expect(result).toEqual({
      ok: true,
      movedCount: 2,
      remainingCount: 0,
      merged: true,
      gasResults: [],
    });

    // 元履歴は商品が0件になり削除される
    expect(await rows("SELECT id FROM delivery_histories WHERE id=920001")).toHaveLength(0);
    expect(
      await rows("SELECT itemsJson FROM delivery_histories WHERE id=920002"),
    ).toEqual([
      {
        itemsJson: JSON.stringify([
          { inventoryId: 910001, title: "【テスト】携帯ゲーム機A", quantity: 7 },
          { inventoryId: 910002, title: "【テスト】ワイヤレスパッドB", quantity: 1 },
        ]),
      },
    ]);
  });

  it("対象商品が見つからない場合は失敗する", async () => {
    await insertHistory(920001);
    await expect(
      api.client.inventory.deliveryHistory.moveItemsToDeliveryNo.mutate({
        historyId: 920001,
        inventoryIds: [999999],
        newDeliveryNo: "385_1",
      }),
    ).rejects.toThrow("対象商品が見つかりません");
  });
});

describe("出庫取り消し（cancelItem / cancelItems）", () => {
  it("cancelItem はローカル在庫数を戻し取り消し済みリストへ追記する", async () => {
    await insertHistory(920001);

    const result = await api.client.inventory.deliveryHistory.cancelItem.mutate({
      historyId: 920001,
      inventoryId: 910001,
      quantity: 2,
    });
    expect(result).toEqual({ success: true, newQuantity: 2 });

    expect(await rows("SELECT quantity FROM local_inventories WHERE id=910001")).toEqual([
      { quantity: 2 },
    ]);
    const stored = await rows(
      "SELECT cancelledItemsJson FROM delivery_histories WHERE id=920001",
    );
    const cancelled = JSON.parse(String(stored[0].cancelledItemsJson));
    expect(cancelled).toHaveLength(1);
    expect(cancelled[0]).toMatchObject({ inventoryId: 910001, quantity: 2 });
    expect(typeof cancelled[0].cancelledAt).toBe("string");

    // 同じ商品の再取り消しは拒否される
    await expect(
      api.client.inventory.deliveryHistory.cancelItem.mutate({
        historyId: 920001,
        inventoryId: 910001,
        quantity: 2,
      }),
    ).rejects.toThrow("この商品は既に取り消し済みです");
  });

  it("cancelItem は存在しない履歴を拒否する", async () => {
    await expect(
      api.client.inventory.deliveryHistory.cancelItem.mutate({
        historyId: 999999,
        inventoryId: 910001,
        quantity: 1,
      }),
    ).rejects.toThrow("出庫履歴が見つかりません");
  });

  it("cancelItems は複数商品を一括取り消しし取り消し済みは除外する", async () => {
    await insertHistory(920001, {
      cancelledItemsJson: JSON.stringify([
        { inventoryId: 910001, quantity: 2, cancelledAt: "2026-09-21T00:00:00.000Z" },
      ]),
    });

    const result = await api.client.inventory.deliveryHistory.cancelItems.mutate({
      historyId: 920001,
      items: [
        { inventoryId: 910001, quantity: 2 },
        { inventoryId: 910002, quantity: 1 },
      ],
    });
    expect(result).toEqual({
      success: true,
      successCount: 1,
      failCount: 0,
      results: [{ inventoryId: 910002, success: true }],
    });

    // 取り消し済みの910001はスキップされ、910002のみ在庫が戻る
    expect(
      await rows("SELECT id, quantity FROM local_inventories WHERE id IN (910001, 910002) ORDER BY id"),
    ).toEqual([
      { id: 910001, quantity: 0 },
      { id: 910002, quantity: 1 },
    ]);
    const stored = await rows(
      "SELECT cancelledItemsJson FROM delivery_histories WHERE id=920001",
    );
    const cancelled = JSON.parse(String(stored[0].cancelledItemsJson));
    expect(cancelled.map((c: { inventoryId: number }) => c.inventoryId)).toEqual([
      910001, 910002,
    ]);
  });

  it("cancelItems は全て取り消し済みの場合を拒否する", async () => {
    await insertHistory(920001, {
      cancelledItemsJson: JSON.stringify([
        { inventoryId: 910001, quantity: 2, cancelledAt: "2026-09-21T00:00:00.000Z" },
        { inventoryId: 910002, quantity: 1, cancelledAt: "2026-09-21T00:00:00.000Z" },
      ]),
    });
    await expect(
      api.client.inventory.deliveryHistory.cancelItems.mutate({
        historyId: 920001,
        items: [{ inventoryId: 910001, quantity: 2 }],
      }),
    ).rejects.toThrow("選択した商品はすべて既に取り消し済みです");
  });
});

describe("出庫履歴グループ削除（deleteGroup）", () => {
  it("ローカル在庫を削除記録へ移し履歴行は残して削除済みIDを記録する", async () => {
    await insertHistory(920001);

    const result = await api.client.inventory.deliveryHistory.deleteGroup.mutate({
      historyId: 920001,
      inventoryIds: [910001, 910002],
    });
    expect(result).toEqual({
      ok: true,
      successCount: 2,
      failCount: 0,
      results: [
        { inventoryId: 910001, success: true },
        { inventoryId: 910002, success: true },
      ],
    });

    // 在庫は論理削除され、削除記録が作られる
    expect(
      await rows("SELECT id, isDeleted FROM local_inventories WHERE id IN (910001, 910002) ORDER BY id"),
    ).toEqual([
      { id: 910001, isDeleted: 1 },
      { id: 910002, isDeleted: 1 },
    ]);
    const recorded = await rows(
      "SELECT zaicoId, title FROM deleted_inventories ORDER BY zaicoId",
    );
    expect(recorded).toEqual([
      { zaicoId: 910001, title: "【テスト】携帯ゲーム機A" },
      { zaicoId: 910002, title: "【テスト】ワイヤレスパッドB" },
    ]);

    // 履歴行は残り、deletedInventoryIdsに全商品が記録される
    expect(
      await rows("SELECT deletedInventoryIdsJson FROM delivery_histories WHERE id=920001"),
    ).toEqual([{ deletedInventoryIdsJson: "[910001,910002]" }]);
  });

  it("既存の削除済みIDへ重複なく追記する", async () => {
    await insertHistory(920001, {
      deletedInventoryIdsJson: JSON.stringify([910001]),
    });
    await api.client.inventory.deliveryHistory.deleteGroup.mutate({
      historyId: 920001,
      inventoryIds: [910001, 910002],
    });
    expect(
      await rows("SELECT deletedInventoryIdsJson FROM delivery_histories WHERE id=920001"),
    ).toEqual([{ deletedInventoryIdsJson: "[910001,910002]" }]);
  });
});
