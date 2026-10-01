import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

/**
 * 取引データ（trade）・発送記録（shipment）ルーターの整理前基準。
 * routers.ts の trade / shipment ブロックを tradeRouter.ts / shipmentRouter.ts へ
 * 移す前後で、同じ入力に対する応答・DB保存値（保存順含む）が変わらないことを固定する。
 * 専用DBでは GOOGLE_SERVICE_ACCOUNT_JSON 未設定のため、
 * シート同期なし（DB完結）経路のみを検証する。外部レートAPIは network-guard で遮断され、
 * recalcShippingCosts のUSDレート取得は失敗時スキップ（関税0）として決定的になる。
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

async function insertTrade(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO trade_records SET ?", {
    id,
    month: "4",
    partner: "ルカ",
    no: 500,
    paymentDate: "2026-04-01",
    productName: "【テスト】ゲーム機X",
    quantity: "3",
    unitPrice: "100",
    currency: "ユーロ",
    unitPriceJPY: "16000",
    status: "",
    procurement: "",
    shippingFromTokyo: "",
    totalSales: "48000",
    procurementTotal: "30000",
    refund: "0",
    shippingCost: "1650",
    customsDuty: "0",
    profitWithRefund: "16350",
    cumulativeProfit: "0",
    ...patch,
  });
}

async function insertShipment(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO shipments SET ?", {
    id,
    shippingDate: "2026-06-01",
    trackingNumber: null,
    shippingCost: "3000",
    notes: null,
    ...patch,
  });
}

async function insertShipmentItem(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO shipment_items SET ?", {
    id,
    shipmentId: 940001,
    invoiceNo: 500,
    tradeRecordId: null,
    quantity: 1,
    ...patch,
  });
}

describe("trade.listFromDb: 整理前の一覧・フィルタ・ステータス導出", () => {
  it("No昇順で返し、summaryは完了行のみ利益集計・全行で売上/数量/相手数を集計する", async () => {
    await insertTrade(910101, { no: 500, partner: "ルカ", profitWithRefund: "16350" });
    await insertTrade(910102, {
      no: 381,
      partner: "サミー",
      currency: "ドル",
      paymentDate: "2026-05-10",
      status: "complete",
      totalSales: "20000",
      procurementTotal: "10000",
      shippingCost: "0",
      profitWithRefund: "20000",
      quantity: "2",
    });
    await insertTrade(910103, {
      no: 380,
      partner: "デボン",
      paymentDate: "2024-03-01",
      status: "途中",
      totalSales: "10000",
      profitWithRefund: "5000",
      quantity: "1",
    });
    const res = await api.client.trade.listFromDb.query({});
    expect(res.rows.map(r => r.no)).toEqual([380, 381, 500]);
    expect(res.totalCount).toBe(3);
    // 完了状態の行（complete）のみが利益に入る
    expect(res.summary.totalProfit).toBe(20000);
    expect(res.summary.totalSales).toBe(78000);
    expect(res.summary.totalQty).toBe(6);
    expect(res.summary.partners).toBe(3);
    // No<=399 の未完了ステータスはそのまま保持される
    expect(res.rows.find(r => r.no === 380)?.status).toBe("途中");
    // No>399 で発送記録が無い未完了行はステータス据え置き
    expect(res.rows.find(r => r.no === 500)?.status).toBe("");
  });

  it("スペース除去検索・年フィルタ・incompleteOnly・statusフィルタが機能する", async () => {
    await insertTrade(910111, { no: 500, productName: "New 3DS LL ホワイト" });
    await insertTrade(910112, {
      no: 399,
      paymentDate: "2024-02-01",
      status: "complete",
      productName: "【テスト】別商品",
    });
    const bySearch = await api.client.trade.listFromDb.query({ search: "New3DSLL" });
    expect(bySearch.rows.map(r => r.id)).toEqual([910111]);
    const byYear = await api.client.trade.listFromDb.query({ year: "2026" });
    expect(byYear.rows.map(r => r.id)).toEqual([910111]);
    const incompleteOnly = await api.client.trade.listFromDb.query({ incompleteOnly: true });
    expect(incompleteOnly.rows.map(r => r.id)).toEqual([910111]);
    const byStatus = await api.client.trade.listFromDb.query({ status: "complete" });
    expect(byStatus.rows.map(r => r.id)).toEqual([910112]);
  });

  it("2025年支払行は表示上completeへ丸め、DBの保存値は変えない", async () => {
    await insertTrade(910121, { no: 502, paymentDate: "2025-03-01", status: "" });
    const res = await api.client.trade.listFromDb.query({});
    expect(res.rows[0].status).toBe("complete");
    const stored = await rows("SELECT status FROM trade_records WHERE id=910121");
    expect(stored[0].status).toBe("");
  });

  it("手動完了メモ（invoice_memos）はNo<=399の行をcompleteとして表示する", async () => {
    await insertTrade(910131, { no: 390, status: "" });
    await db.query("INSERT INTO invoice_memos SET ?", {
      invoice_key: "390",
      color_key: "__manual_complete__",
      memo: "1",
    });
    const res = await api.client.trade.listFromDb.query({});
    expect(res.rows[0].status).toBe("complete");
    const stored = await rows("SELECT status FROM trade_records WHERE id=910131");
    expect(stored[0].status).toBe("");
  });

  it("No>399は発送明細の実績から残数ステータスを導出する", async () => {
    await insertTrade(910141, { no: 620, quantity: "3", status: "" });
    await insertShipment(940001, { shippingDate: "2026-06-01" });
    await insertShipmentItem(950001, {
      shipmentId: 940001,
      invoiceNo: 620,
      tradeRecordId: 910141,
      quantity: 1,
    });
    const res = await api.client.trade.listFromDb.query({});
    expect(res.rows[0].status).toBe("残2");
  });

  // main側の仕様変更（FedEx登録を発送登録として数える）に追従
  it("FedEx登録のみ（発送明細なし）のcomplete行はFedEx数量を発送登録として数えcompleteのまま表示する", async () => {
    await insertTrade(910151, { no: 630, quantity: "2", status: "complete" });
    await db.query("INSERT INTO fedex_shipments SET ?", {
      id: 960001,
      deliveryNo: "630_1",
      sheetName: "独発送管理",
      shippingDate: "6/1",
      trackingNumber: "TRK-FX1",
      itemsJson: JSON.stringify([
        { productNameJa: "【テスト】ゲーム機X", productNameEn: "Test Console X", quantity: 2 },
      ]),
      spreadsheetStatus: "success",
    });
    const res = await api.client.trade.listFromDb.query({});
    expect(res.rows[0].status).toBe("complete");
  });
});

describe("trade: 更新・削除・フィルタ候補の整理前基準", () => {
  it("updateInDbは指定フィールドのみ文字列化して更新する", async () => {
    await insertTrade(910201, {});
    const res = await api.client.trade.updateInDb.mutate({
      id: 910201,
      partner: "サミー",
      quantity: 5,
      unitPrice: 123.45,
    });
    expect(res).toEqual({ success: true });
    const stored = await rows(
      "SELECT partner, quantity, unitPrice, month, status FROM trade_records WHERE id=910201"
    );
    expect(stored[0].partner).toBe("サミー");
    expect(Number(stored[0].quantity)).toBe(5);
    expect(Number(stored[0].unitPrice)).toBe(123.45);
    expect(stored[0].month).toBe("4");
    expect(stored[0].status).toBe("");
  });

  it("deleteFromDbは対象行のみ削除する", async () => {
    await insertTrade(910211, { no: 500 });
    await insertTrade(910212, { no: 501 });
    const res = await api.client.trade.deleteFromDb.mutate({ id: 910211 });
    expect(res).toEqual({ success: true });
    const stored = await rows("SELECT id FROM trade_records ORDER BY id");
    expect(stored.map(r => r.id)).toEqual([910212]);
  });

  it("bulkUpdatePaymentDateは存在するIDだけを更新し件数を返す", async () => {
    await insertTrade(910221, { paymentDate: "2026-04-01" });
    await insertTrade(910222, { no: 501, paymentDate: "2026-04-02" });
    const res = await api.client.trade.bulkUpdatePaymentDate.mutate({
      ids: [910221, 910222, 999999],
      paymentDate: "2026-07-15",
    });
    expect(res).toEqual({ success: true, updatedCount: 2, requestedCount: 3 });
    const stored = await rows(
      "SELECT paymentDate FROM trade_records ORDER BY id"
    );
    expect(stored.map(r => r.paymentDate)).toEqual(["2026-07-15", "2026-07-15"]);
  });

  it("getFilterOptionsは年・月・相手・通貨・状況のユニーク値を整列して返す", async () => {
    await insertTrade(910231, { no: 500, month: "4", partner: "ルカ", currency: "ユーロ", status: "途中", paymentDate: "2026-04-01" });
    await insertTrade(910232, { no: 501, month: "12", partner: "サミー", currency: "ドル", status: "complete", paymentDate: "2024-12-01" });
    const res = await api.client.trade.getFilterOptions.query();
    expect(res).toEqual({
      years: ["2024", "2026"],
      months: ["4", "12"],
      partners: ["サミー", "ルカ"],
      currencies: ["ドル", "ユーロ"],
      statuses: ["complete", "途中"],
    });
  });

  it("getSheetTabsはサービスアカウント未設定時にconfigured:falseを返す", async () => {
    const res = await api.client.trade.getSheetTabs.query();
    expect(res).toEqual({
      configured: false,
      spreadsheetId: "133cDct4krrsJDeXpO9l0fIrd3-ZYDc39u6-JpQvcxv4",
      tabs: [],
    });
  });
});

describe("trade.updateRecord / addRecord: シート同期なし（DB完結）経路", () => {
  it("updateRecordは数量・単価・通貨変更時に円価格/売上/利益を再計算し、通貨は取引相手から推定する", async () => {
    await insertTrade(910301, { no: 700, quantity: "3", unitPrice: "100", currency: "ユーロ" });
    const res = await api.client.trade.updateRecord.mutate({
      id: 910301,
      invoiceNo: "700",
      month: 5,
      partner: "ルカ",
      paymentDate: "2026-05-02",
      productName: "【テスト】ゲーム機X",
      quantity: 4,
      unitPrice: 110,
      currency: "ドル", // 入力はドルだが相手がルカなのでユーロで保存される
      status: "途中",
      eurRate: 160,
      usdRate: 150,
      procurementTotal: 31000,
      refund: 500,
      shippingCost: 2200,
    });
    expect(res).toEqual({ success: true, updatedRow: null, sheetSync: "skipped" });
    const stored = await rows("SELECT * FROM trade_records WHERE id=910301");
    expect(stored[0].currency).toBe("ユーロ");
    expect(stored[0].month).toBe("5");
    expect(stored[0].paymentDate).toBe("2026-05-02");
    expect(stored[0].status).toBe("途中");
    expect(Number(stored[0].unitPriceJPY)).toBe(17600); // 110 × 160
    expect(Number(stored[0].totalSales)).toBe(70400); // 4 × 17600
    expect(Number(stored[0].procurementTotal)).toBe(31000);
    expect(Number(stored[0].refund)).toBe(500);
    expect(Number(stored[0].shippingCost)).toBe(2200);
    expect(Number(stored[0].customsDuty)).toBe(0); // 入力なし→既存値維持
    expect(Number(stored[0].profitWithRefund)).toBe(37700); // 70400-31000+500-2200-0
  });

  it("updateRecordは数量・単価・通貨が変わらない場合は既存売上を使って利益のみ再計算する", async () => {
    await insertTrade(910311, {
      no: 701,
      quantity: "3",
      unitPrice: "100",
      currency: "ユーロ",
      unitPriceJPY: "16000",
      totalSales: "48000",
    });
    await api.client.trade.updateRecord.mutate({
      id: 910311,
      invoiceNo: "701",
      month: 4,
      partner: "ルカ",
      paymentDate: "2026-04-01",
      productName: "【テスト】ゲーム機X",
      quantity: 3,
      unitPrice: 100,
      currency: "ユーロ",
      status: "",
      eurRate: 170, // レートが変わっても数量・単価・通貨が同じなら再計算しない
      usdRate: 150,
      procurementTotal: 29000,
      refund: 1000,
      shippingCost: 1650,
    });
    const stored = await rows("SELECT * FROM trade_records WHERE id=910311");
    expect(Number(stored[0].unitPriceJPY)).toBe(16000);
    expect(Number(stored[0].totalSales)).toBe(48000);
    expect(Number(stored[0].profitWithRefund)).toBe(18350); // 48000-29000+1000-1650-0
  });

  it("addRecordは選択レートで円価格・売上・利益を計算して挿入し、通貨は相手から推定する", async () => {
    const res = await api.client.trade.addRecord.mutate({
      month: 6,
      partner: "サミー",
      invoiceNo: "702",
      paymentDate: "",
      productName: "【テスト】新規商品",
      quantity: 2,
      unitPrice: 50,
      currency: "ユーロ", // 入力はユーロだが相手がサミーなのでドルで保存される
      status: "",
      eurRate: 160,
      usdRate: 150,
      shippingCost: 1100,
    });
    expect(res).toEqual({ success: true, sheetSync: "skipped" });
    const stored = await rows("SELECT * FROM trade_records WHERE no=702");
    expect(stored).toHaveLength(1);
    expect(stored[0].month).toBe("6");
    expect(stored[0].partner).toBe("サミー");
    expect(stored[0].currency).toBe("ドル");
    expect(stored[0].paymentDate).toBeNull();
    expect(Number(stored[0].unitPriceJPY)).toBe(7500); // 50 × 150（ドルレート）
    expect(Number(stored[0].totalSales)).toBe(15000);
    expect(Number(stored[0].procurementTotal)).toBe(0);
    expect(Number(stored[0].refund)).toBe(0);
    expect(Number(stored[0].shippingCost)).toBe(1100);
    expect(Number(stored[0].profitWithRefund)).toBe(13900); // 15000-1100
    expect(Number(stored[0].cumulativeProfit)).toBe(0);
  });
});

describe("shipment: 整理前の一覧・集計・作成・更新・削除", () => {
  it("listは発送日降順で明細と商品名を付けて返す", async () => {
    await insertTrade(910401, { no: 810, productName: "【テスト】ゲーム機X" });
    await insertShipment(940011, { shippingDate: "2026-06-01" });
    await insertShipment(940012, { shippingDate: "2026-06-05" });
    await insertShipmentItem(950011, {
      shipmentId: 940011,
      invoiceNo: 810,
      tradeRecordId: 910401,
      quantity: 2,
    });
    const res = await api.client.shipment.list.query();
    expect(res.map(s => s.id)).toEqual([940012, 940011]);
    expect(res[1].items).toHaveLength(1);
    expect(res[1].items[0].productName).toBe("【テスト】ゲーム機X");
    expect(res[0].items).toEqual([]);
  });

  it("invoiceSummaryは行別内訳・未割当数・残数を返す", async () => {
    await insertTrade(910411, { no: 820, quantity: "2", productName: "【テスト】商品A" });
    await insertTrade(910412, { no: 820, quantity: "3", productName: "【テスト】商品B" });
    await insertShipment(940021, {});
    await insertShipmentItem(950021, {
      shipmentId: 940021,
      invoiceNo: 820,
      tradeRecordId: 910411,
      quantity: 2,
    });
    await insertShipmentItem(950022, {
      shipmentId: 940021,
      invoiceNo: 820,
      tradeRecordId: null,
      quantity: 1,
    });
    const res = await api.client.shipment.invoiceSummary.query({ invoiceNo: 820 });
    expect(res).toEqual({
      invoiceNo: 820,
      orderedQty: 5,
      shippedQty: 2,
      remainingQty: 3,
      isComplete: false,
      unassignedShippedQty: 1,
      items: [
        {
          tradeRecordId: 910411,
          productName: "【テスト】商品A",
          orderedQty: 2,
          shippedQty: 2,
          remainingQty: 0,
        },
        {
          tradeRecordId: 910412,
          productName: "【テスト】商品B",
          orderedQty: 3,
          shippedQty: 0,
          remainingQty: 3,
        },
      ],
    });
  });

  it("byInvoiceは追跡番号（正規化一致）で同梱グループ化し按分基準数と送料を返す", async () => {
    await insertTrade(910421, { no: 830, quantity: "2" });
    await insertTrade(910422, { no: 831, quantity: "1" });
    await insertShipment(940031, {
      shippingDate: "2026-06-02",
      trackingNumber: "TRK 123-45",
      shippingCost: "3000",
    });
    await insertShipment(940032, {
      shippingDate: "2026-06-01",
      trackingNumber: "TRK12345",
      shippingCost: "0",
    });
    await insertShipmentItem(950031, {
      shipmentId: 940031,
      invoiceNo: 830,
      tradeRecordId: 910421,
      quantity: 2,
    });
    await insertShipmentItem(950032, {
      shipmentId: 940032,
      invoiceNo: 831,
      tradeRecordId: 910422,
      quantity: 1,
    });
    const res = await api.client.shipment.byInvoice.query({ invoiceNo: 830 });
    expect(res).toHaveLength(1);
    expect(res[0].id).toBe(940031);
    // 追跡番号が同一視されるため同梱扱い: 総数3・送料は最大値3000
    expect(res[0].allocationTotalQty).toBe(3);
    expect(res[0].allocationShippingCost).toBe(3000);
    expect(res[0].items.map(i => i.id)).toEqual([950031]);
  });

  it("createは取引行との紐づけを検証し、発送完了時に実送料を按分して利益を再計算する", async () => {
    await insertTrade(910431, {
      no: 840,
      quantity: "2",
      totalSales: "32000",
      procurementTotal: "20000",
      refund: "0",
      shippingCost: "1100",
      profitWithRefund: "10900",
    });
    // 紐づけ不一致はエラー
    await expect(
      api.client.shipment.create.mutate({
        shippingDate: "2026-06-01",
        shippingCost: 3000,
        items: [{ invoiceNo: 841, tradeRecordId: 910431, quantity: 1 }],
      })
    ).rejects.toThrow("出庫明細の商品行がNo.841に紐づいていません。");
    expect(await rows("SELECT id FROM shipments")).toHaveLength(0);

    const res = await api.client.shipment.create.mutate({
      shippingDate: "2026-06-01",
      trackingNumber: "TRK-C1",
      shippingCost: 3000,
      notes: "テスト便",
      items: [{ invoiceNo: 840, tradeRecordId: 910431, quantity: 2 }],
    });
    const shipmentId = res.shipmentId;
    const storedShipment = await rows("SELECT * FROM shipments WHERE id=?", [shipmentId]);
    expect(storedShipment[0].trackingNumber).toBe("TRK-C1");
    expect(Number(storedShipment[0].shippingCost)).toBe(3000);
    expect(storedShipment[0].notes).toBe("テスト便");
    const storedItems = await rows(
      "SELECT invoiceNo, tradeRecordId, quantity FROM shipment_items WHERE shipmentId=?",
      [shipmentId]
    );
    expect(storedItems).toHaveLength(1);
    expect(storedItems[0]).toMatchObject({ invoiceNo: 840, tradeRecordId: 910431, quantity: 2 });
    // 発送完了 → 実送料3000を適用し利益再計算（ユーロ取引のため関税なし）
    const trade = await rows("SELECT shippingCost, customsDuty, profitWithRefund FROM trade_records WHERE id=910431");
    expect(Number(trade[0].shippingCost)).toBe(3000);
    expect(Number(trade[0].customsDuty)).toBe(0);
    expect(Number(trade[0].profitWithRefund)).toBe(9000); // 32000-20000+0-3000-0
  });

  it("発送数が注文数未満の間は仮送料（550円×注文数）を維持する", async () => {
    await insertTrade(910441, {
      no: 850,
      quantity: "2",
      totalSales: "32000",
      procurementTotal: "20000",
      shippingCost: "1100",
      profitWithRefund: "10900",
    });
    await api.client.shipment.create.mutate({
      shippingDate: "2026-06-01",
      shippingCost: 3000,
      items: [{ invoiceNo: 850, tradeRecordId: 910441, quantity: 1 }],
    });
    const trade = await rows("SELECT shippingCost, profitWithRefund FROM trade_records WHERE id=910441");
    expect(Number(trade[0].shippingCost)).toBe(1100); // 550 × 2
    expect(Number(trade[0].profitWithRefund)).toBe(10900);
  });

  it("updateは送料変更を按分へ反映し、deleteは仮送料へ戻す", async () => {
    await insertTrade(910451, {
      no: 860,
      quantity: "2",
      totalSales: "32000",
      procurementTotal: "20000",
      shippingCost: "1100",
      profitWithRefund: "10900",
    });
    const created = await api.client.shipment.create.mutate({
      shippingDate: "2026-06-01",
      shippingCost: 3000,
      items: [{ invoiceNo: 860, tradeRecordId: 910451, quantity: 2 }],
    });

    const updated = await api.client.shipment.update.mutate({
      id: created.shipmentId,
      shippingDate: "2026-06-02",
      trackingNumber: "TRK-U1",
      shippingCost: 5000,
      notes: "更新後",
    });
    expect(updated).toEqual({ ok: true });
    const afterUpdate = await rows("SELECT shippingCost, profitWithRefund FROM trade_records WHERE id=910451");
    expect(Number(afterUpdate[0].shippingCost)).toBe(5000);
    expect(Number(afterUpdate[0].profitWithRefund)).toBe(7000); // 32000-20000-5000

    const deleted = await api.client.shipment.delete.mutate({ id: created.shipmentId });
    expect(deleted).toEqual({ ok: true });
    expect(await rows("SELECT id FROM shipments")).toHaveLength(0);
    expect(await rows("SELECT id FROM shipment_items")).toHaveLength(0);
    const afterDelete = await rows("SELECT shippingCost, profitWithRefund FROM trade_records WHERE id=910451");
    expect(Number(afterDelete[0].shippingCost)).toBe(1100); // 仮送料へ戻る
    expect(Number(afterDelete[0].profitWithRefund)).toBe(10900);
  });
});
