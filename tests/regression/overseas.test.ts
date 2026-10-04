import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

/**
 * 海外発送（fedex）ルーターの整理前基準。
 * routers.ts の fedex ブロックを fedexRouter.ts へ移す前後で、
 * 同じ入力に対する応答・DB保存値（保存順含む）が変わらないことを固定する。
 * 専用DBでは GAS_WEBHOOK_URL 未設定のため、GAS未設定経路（DB完結）のみを検証する。
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

async function insertHistory(id: number, patch: Record<string, unknown> = {}) {
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

function parseItems(itemsJson: unknown): unknown {
  return JSON.parse(String(itemsJson));
}

describe("海外発送（fedex.getByDeliveryNo / getAll）", () => {
  it("getByDeliveryNo は出庫履歴と合計数量が一致する記録のみ明細を履歴で置き換える（DBは書き換えない）", async () => {
    await insertHistory(920001, { deliveryNo: "379_1" }); // 合計3
    // 合計3で一致 → 履歴明細で置き換え
    await insertFedexShipment(930001, {
      trackingNumber: "TRK-A1",
      itemsJson: JSON.stringify([
        { productNameJa: "手入力の名前", productNameEn: "Manual Name", quantity: 3 },
      ]),
      createdAt: "2026-09-21 12:00:00",
    });
    // 合計5で不一致 → そのまま
    await insertFedexShipment(930002, {
      trackingNumber: "TRK-A2",
      itemsJson: JSON.stringify([
        { productNameJa: "手入力の名前", productNameEn: "Manual Name", quantity: 5 },
      ]),
      createdAt: "2026-09-20 12:00:00",
    });

    const list = await api.client.inventory.fedex.getByDeliveryNo.query({ deliveryNo: "379_1" });
    expect(list.map((r) => r.id)).toEqual([930001, 930002]);
    expect(parseItems(list[0].itemsJson)).toEqual([
      { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "【テスト】携帯ゲーム機A", quantity: 2, managementNo: null },
      { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "【テスト】ワイヤレスパッドB", quantity: 1, managementNo: null },
    ]);
    expect(parseItems(list[1].itemsJson)).toEqual([
      { productNameJa: "手入力の名前", productNameEn: "Manual Name", quantity: 5 },
    ]);

    // 置き換えは応答のみで、DBの保存値は変わらない
    const stored = await rows("SELECT itemsJson FROM fedex_shipments WHERE id = ?", [930001]);
    expect(parseItems(stored[0].itemsJson)).toEqual([
      { productNameJa: "手入力の名前", productNameEn: "Manual Name", quantity: 3 },
    ]);
  });

  it("getByDeliveryNo は historyId 指定の記録をそのIDの履歴で置き換える", async () => {
    await insertHistory(920001, { deliveryNo: "379_1" });
    await insertFedexShipment(930001, {
      deliveryNo: "381_1", // 出庫Noは別でも historyId が優先される
      trackingNumber: "TRK-A3",
      historyId: 920001,
      itemsJson: JSON.stringify([
        { productNameJa: "手入力の名前", productNameEn: "Manual Name", quantity: 3 },
      ]),
    });

    const list = await api.client.inventory.fedex.getByDeliveryNo.query({ deliveryNo: "381_1" });
    expect(list).toHaveLength(1);
    expect(parseItems(list[0].itemsJson)).toEqual([
      { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "【テスト】携帯ゲーム機A", quantity: 2, managementNo: null },
      { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "【テスト】ワイヤレスパッドB", quantity: 1, managementNo: null },
    ]);
  });

  it("getAll は作成日時の降順で全件返す", async () => {
    await insertFedexShipment(930001, { trackingNumber: "TRK-B1", createdAt: "2026-09-20 12:00:00" });
    await insertFedexShipment(930002, { trackingNumber: "TRK-B2", deliveryNo: "380_1", createdAt: "2026-09-22 12:00:00" });

    const list = await api.client.inventory.fedex.getAll.query();
    expect(list.map((r) => r.id)).toEqual([930002, 930001]);
    expect(list[0]).toMatchObject({
      deliveryNo: "380_1",
      sheetName: "独発送管理",
      shippingDate: "9/20",
      trackingNumber: "TRK-B2",
      spreadsheetStatus: "pending",
      historyId: null,
    });
  });
});

describe("海外発送（fedex.getTodayTrackingNumbers）", () => {
  it("当日（UTC日付）分のみ・追跡番号の重複を除いて返す", async () => {
    // サーバー（drizzle）はDBの生値をUTCとして解釈するため、UTC当日の日付文字列で挿入する
    const todayUtc = new Date().toISOString().slice(0, 10);
    await insertFedexShipment(930001, {
      trackingNumber: "TRK-TODAY-1",
      sheetName: "独発送管理",
      createdAt: `${todayUtc} 00:00:10`,
    });
    await insertFedexShipment(930002, {
      trackingNumber: "TRK-TODAY-1", // 重複
      sheetName: "独発送管理",
      createdAt: `${todayUtc} 00:00:20`,
    });
    await insertFedexShipment(930003, {
      trackingNumber: "TRK-TODAY-2",
      sheetName: "サミー発送管理",
      createdAt: `${todayUtc} 00:00:30`,
    });
    await insertFedexShipment(930004, {
      trackingNumber: "TRK-OLD",
      createdAt: "2026-09-20 12:00:00",
    });

    const list = await api.client.inventory.fedex.getTodayTrackingNumbers.query();
    expect(list).toEqual([
      { trackingNumber: "TRK-TODAY-2", sheetName: "サミー発送管理" },
      { trackingNumber: "TRK-TODAY-1", sheetName: "独発送管理" },
    ]);
  });
});

describe("海外発送（fedex.create GAS未設定）", () => {
  it("通常登録: 同名明細を合算して保存し、GAS未設定エラーと作業ログを記録する", async () => {
    const res = await api.client.inventory.fedex.create.mutate({
      deliveryNo: "379_1",
      sheetName: "独発送管理",
      shippingDate: "9/30",
      trackingNumber: "TRK-C1",
      items: [
        { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 2 },
        { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 1 },
        { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "Test Pad B", quantity: 1 },
      ],
      operatorName: "テスト担当",
    });
    expect(res.success).toBe(false);
    expect(res.message).toBe("GAS_WEBHOOK_URL が未設定です。管理者に連絡してください。");
    expect(typeof res.id).toBe("number");

    const stored = await rows("SELECT * FROM fedex_shipments WHERE id = ?", [res.id]);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      deliveryNo: "379_1",
      sheetName: "独発送管理",
      shippingDate: "9/30",
      trackingNumber: "TRK-C1",
      spreadsheetStatus: "error",
      spreadsheetError: "GAS_WEBHOOK_URL が未設定です",
      operatorName: "テスト担当",
      historyId: null,
    });
    expect(parseItems(stored[0].itemsJson)).toEqual([
      { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 3 },
      { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "Test Pad B", quantity: 1 },
    ]);

    const logs = await rows("SELECT * FROM work_logs WHERE category = 'FedEx発送登録'");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      workerName: "テスト担当",
      category: "FedEx発送登録",
      status: "done",
      quantity: 4,
      memo: "出庫No: 379_1 / 追跡番号: TRK-C1",
      sourceType: "fedex",
      sourceId: "379_1:TRK-C1",
      createdBy: "テスト担当",
    });
  });

  it("operatorName 未指定時はログインユーザー名で記録する", async () => {
    const res = await api.client.inventory.fedex.create.mutate({
      deliveryNo: "379_1",
      sheetName: "独発送管理",
      shippingDate: "9/30",
      trackingNumber: "TRK-C1B",
      items: [
        { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 1 },
      ],
    });
    const stored = await rows("SELECT operatorName FROM fedex_shipments WHERE id = ?", [res.id]);
    expect(stored[0].operatorName).toBe("Local Developer");
    const logs = await rows("SELECT workerName, createdBy FROM work_logs WHERE category = 'FedEx発送登録'");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ workerName: "Local Developer", createdBy: "Local Developer" });
  });

  it("同一追跡番号・同一出庫Noの既存記録はDB上で合算し、2件目以降を削除する", async () => {
    await insertFedexShipment(930001, {
      trackingNumber: "TRK-C2",
      itemsJson: JSON.stringify([
        { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 2 },
      ]),
      createdAt: "2026-09-21 12:00:00",
    });
    await insertFedexShipment(930002, {
      trackingNumber: "TRK-C2",
      itemsJson: JSON.stringify([
        { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "Test Pad B", quantity: 1 },
      ]),
      createdAt: "2026-09-20 12:00:00",
    });

    const res = await api.client.inventory.fedex.create.mutate({
      deliveryNo: "379_1",
      sheetName: "独発送管理",
      shippingDate: "9/30",
      trackingNumber: "TRK-C2",
      items: [
        { productNameJa: "【テスト】収納ケースC", productNameEn: "Test Case C", quantity: 1 },
      ],
      operatorName: "テスト担当",
    });
    expect(res).toMatchObject({
      id: 930001,
      success: false,
      message: "DB合算済み。スプシ更新失敗: GAS_WEBHOOK_URLが未設定",
    });

    const remain = await rows("SELECT * FROM fedex_shipments WHERE trackingNumber = 'TRK-C2' ORDER BY id");
    expect(remain.map((r) => r.id)).toEqual([930001]);
    expect(remain[0]).toMatchObject({
      deliveryNo: "379_1",
      sheetName: "独発送管理",
      shippingDate: "9/30",
      spreadsheetStatus: "error",
      spreadsheetError: "GAS_WEBHOOK_URLが未設定",
      historyId: null,
    });
    expect(parseItems(remain[0].itemsJson)).toEqual([
      { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 2 },
      { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "Test Pad B", quantity: 1 },
      { productNameJa: "【テスト】収納ケースC", productNameEn: "Test Case C", quantity: 1 },
    ]);

    // 作業ログは新規追加分の数量のみ
    const logs = await rows("SELECT quantity FROM work_logs WHERE category = 'FedEx発送登録'");
    expect(logs).toHaveLength(1);
    expect(logs[0].quantity).toBe(1);
  });

  it("historyId 指定時は出庫履歴の明細を保存する", async () => {
    await insertHistory(920001, { deliveryNo: "379_1" });
    const res = await api.client.inventory.fedex.create.mutate({
      deliveryNo: "379_1",
      sheetName: "独発送管理",
      shippingDate: "9/30",
      trackingNumber: "TRK-C3",
      historyId: 920001,
      items: [],
      operatorName: "テスト担当",
    });
    expect(res.success).toBe(false);

    const stored = await rows("SELECT historyId, itemsJson FROM fedex_shipments WHERE id = ?", [res.id]);
    expect(stored[0].historyId).toBe(920001);
    expect(parseItems(stored[0].itemsJson)).toEqual([
      { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "【テスト】携帯ゲーム機A", quantity: 2, managementNo: null },
      { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "【テスト】ワイヤレスパッドB", quantity: 1, managementNo: null },
    ]);
  });
});

describe("海外発送（fedex.delete / deleteWithGas）", () => {
  it("delete はDBから削除する", async () => {
    await insertFedexShipment(930001);
    const res = await api.client.inventory.fedex.delete.mutate({ id: 930001 });
    expect(res).toEqual({ success: true });
    expect(await rows("SELECT id FROM fedex_shipments WHERE id = ?", [930001])).toHaveLength(0);
  });

  it("deleteWithGas はGAS未設定でもDBから削除し文言を返す", async () => {
    await insertFedexShipment(930001);
    const res = await api.client.inventory.fedex.deleteWithGas.mutate({ id: 930001 });
    expect(res).toEqual({
      success: true,
      message: "DBから削除しました（GAS_WEBHOOK_URLが未設定のためスプシは未反映）",
    });
    expect(await rows("SELECT id FROM fedex_shipments WHERE id = ?", [930001])).toHaveLength(0);
  });

  it("deleteWithGas は対象が見つからなくても成功を返す", async () => {
    const res = await api.client.inventory.fedex.deleteWithGas.mutate({ id: 999999 });
    expect(res).toEqual({ success: true, message: "発送記録を削除しました" });
  });
});

describe("海外発送（fedex.updateWithGas GAS未設定）", () => {
  it("GAS未設定時はステータスのみエラー更新し、本文（追跡番号・発送日・明細）は変更しない", async () => {
    await insertFedexShipment(930001, { trackingNumber: "TRK-U1" });
    const res = await api.client.inventory.fedex.updateWithGas.mutate({
      id: 930001,
      trackingNumber: "TRK-U2",
      shippingDate: "9/25",
      items: [
        { productNameJa: "【テスト】収納ケースC", productNameEn: "Test Case C", quantity: 1 },
      ],
    });
    expect(res).toEqual({
      success: false,
      message: "GAS_WEBHOOK_URL が未設定です。管理者に連絡してください。",
    });

    const stored = await rows("SELECT * FROM fedex_shipments WHERE id = ?", [930001]);
    expect(stored[0]).toMatchObject({
      trackingNumber: "TRK-U1",
      shippingDate: "9/20",
      spreadsheetStatus: "error",
      spreadsheetError: "GAS_WEBHOOK_URLが未設定",
    });
    expect(parseItems(stored[0].itemsJson)).toEqual([
      { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 2 },
    ]);
  });

  it("対象が見つからない場合は失敗を返す", async () => {
    const res = await api.client.inventory.fedex.updateWithGas.mutate({
      id: 999999,
      trackingNumber: "TRK-U9",
      shippingDate: "9/25",
      items: [],
    });
    expect(res).toEqual({ success: false, message: "発送記録が見つかりません" });
  });
});

describe("海外発送（fedex.createBatch GAS未設定）", () => {
  it("出庫Noから取引先シートを自動判別し、各件のGAS未設定結果と集計文言を返す", async () => {
    const res = await api.client.inventory.fedex.createBatch.mutate({
      shippingDate: "9/30",
      shipments: [
        {
          deliveryNo: "379_luca20260423",
          trackingNumber: "TRK-B1",
          items: [
            { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 2 },
          ],
        },
        {
          deliveryNo: "380_samee20260423",
          trackingNumber: "TRK-B2",
          items: [
            { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "Test Pad B", quantity: 1 },
          ],
        },
      ],
      operatorName: "テスト担当",
    });

    expect(res.success).toBe(false);
    expect(res.message).toBe("0/2件成功（一部失敗あり）");
    expect(res.results).toHaveLength(2);
    expect(res.results[0]).toMatchObject({
      deliveryNo: "379_luca20260423",
      sheetName: "独発送管理",
      trackingNumber: "TRK-B1",
      success: false,
      message: "GAS_WEBHOOK_URL が未設定です",
    });
    expect(res.results[1]).toMatchObject({
      deliveryNo: "380_samee20260423",
      sheetName: "サミー発送管理",
      trackingNumber: "TRK-B2",
      success: false,
      message: "GAS_WEBHOOK_URL が未設定です",
    });

    const stored = await rows("SELECT * FROM fedex_shipments ORDER BY id");
    expect(stored).toHaveLength(2);
    expect(stored[0]).toMatchObject({
      deliveryNo: "379_luca20260423",
      sheetName: "独発送管理",
      shippingDate: "9/30",
      trackingNumber: "TRK-B1",
      spreadsheetStatus: "error",
      spreadsheetError: "GAS_WEBHOOK_URL が未設定です",
      operatorName: "テスト担当",
    });
    expect(stored[1]).toMatchObject({
      deliveryNo: "380_samee20260423",
      sheetName: "サミー発送管理",
      trackingNumber: "TRK-B2",
    });

    const logs = await rows("SELECT sourceId FROM work_logs WHERE category = 'FedEx発送登録' ORDER BY id");
    expect(logs.map((l) => l.sourceId)).toEqual([
      "379_luca20260423:TRK-B1",
      "380_samee20260423:TRK-B2",
    ]);
  });

  it("バッチでも同一追跡番号・同一出庫Noは既存記録に合算する", async () => {
    await insertFedexShipment(930001, {
      trackingNumber: "TRK-B3",
      itemsJson: JSON.stringify([
        { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 2 },
      ]),
    });
    const res = await api.client.inventory.fedex.createBatch.mutate({
      shippingDate: "9/30",
      shipments: [
        {
          deliveryNo: "379_1",
          sheetName: "独発送管理",
          trackingNumber: "TRK-B3",
          items: [
            { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "Test Pad B", quantity: 1 },
          ],
        },
      ],
      operatorName: "テスト担当",
    });
    expect(res.success).toBe(false);
    expect(res.message).toBe("0/1件成功（一部失敗あり）");
    expect(res.results[0]).toMatchObject({
      id: 930001,
      success: false,
      message: "DB合算済み。スプシ失敗: GAS_WEBHOOK_URLが未設定",
    });

    const stored = await rows("SELECT * FROM fedex_shipments WHERE trackingNumber = 'TRK-B3'");
    expect(stored.map((r) => r.id)).toEqual([930001]);
    expect(stored[0]).toMatchObject({
      shippingDate: "9/30",
      spreadsheetStatus: "error",
      spreadsheetError: "GAS_WEBHOOK_URLが未設定",
    });
    expect(parseItems(stored[0].itemsJson)).toEqual([
      { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 2 },
      { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "Test Pad B", quantity: 1 },
    ]);
  });
});

describe("海外発送（fedex.mergeByTracking）", () => {
  it("記録が無い場合・1件のみの場合は合算しない", async () => {
    const none = await api.client.inventory.fedex.mergeByTracking.mutate({
      trackingNumber: "TRK-M0",
      sheetName: "独発送管理",
      shippingDate: "9/30",
    });
    expect(none).toEqual({ success: false, message: "記録が見つかりません" });

    await insertFedexShipment(930001, { trackingNumber: "TRK-M1" });
    const single = await api.client.inventory.fedex.mergeByTracking.mutate({
      trackingNumber: "TRK-M1",
      sheetName: "独発送管理",
      shippingDate: "9/30",
    });
    expect(single).toEqual({ success: false, message: "合算対象が1件のみです（複数件必要）" });
  });

  it("同一追跡番号の複数記録を最新1件へ合算し、残りを削除する（出庫Noは不問）", async () => {
    await insertFedexShipment(930001, {
      trackingNumber: "TRK-M2",
      itemsJson: JSON.stringify([
        { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 2 },
      ]),
      createdAt: "2026-09-21 12:00:00",
    });
    await insertFedexShipment(930002, {
      deliveryNo: "999_9",
      trackingNumber: "TRK-M2",
      itemsJson: JSON.stringify([
        { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 1 },
        { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "Test Pad B", quantity: 1 },
      ]),
      createdAt: "2026-09-20 12:00:00",
    });

    const res = await api.client.inventory.fedex.mergeByTracking.mutate({
      trackingNumber: "TRK-M2",
      sheetName: "サミー発送管理",
      shippingDate: "9/30",
    });
    expect(res).toEqual({ success: true, message: "DBで2件を合算しました（GAS未設定）" });

    const stored = await rows("SELECT * FROM fedex_shipments WHERE trackingNumber = 'TRK-M2'");
    expect(stored.map((r) => r.id)).toEqual([930001]);
    expect(stored[0]).toMatchObject({
      sheetName: "サミー発送管理",
      shippingDate: "9/30",
      spreadsheetStatus: "pending",
    });
    expect(parseItems(stored[0].itemsJson)).toEqual([
      { productNameJa: "【テスト】携帯ゲーム機A", productNameEn: "Test Handheld A", quantity: 3 },
      { productNameJa: "【テスト】ワイヤレスパッドB", productNameEn: "Test Pad B", quantity: 1 },
    ]);
  });
});
