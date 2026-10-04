import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTRPCProxyClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import type { RowDataPacket } from "mysql2/promise";
import type { AppRouter } from "../../server/routers";
import { connectTestDatabase, resetFixtures } from "./support/database";

/**
 * 注文・パートナー領域（partner / invoiceMemo / inventoryMemo ルーター）の整理前基準。
 * routers.ts の各ブロックを partnerRouter.ts / invoiceMemoRouter.ts / inventoryMemoRouter.ts へ
 * 移す前後で、同じ入力に対する応答・DB保存値（保存順含む）が変わらないことを固定する。
 * partner_session クッキーは実装と同じ形式（JSON を encodeURIComponent した値）を
 * ヘッダーに直接付与して検証する。シート同期・通知（notifyOwner）は専用DBでは
 * 未設定のため失敗→無視経路として決定的になる。
 */

let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let server: ReturnType<typeof createServer>;
let port = 0;

function makeClient(cookie?: string) {
  return createTRPCProxyClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://127.0.0.1:${port}/api/trpc`,
        transformer: superjson,
        headers: () => (cookie ? { cookie } : {}),
      }),
    ],
  });
}

let admin: ReturnType<typeof makeClient>;

beforeAll(async () => {
  db = await connectTestDatabase();
  const { createApiApp } = await import("../../server/_core/apiApp");
  server = createServer(await createApiApp());
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  port = (server.address() as AddressInfo).port;
  admin = makeClient();
});

beforeEach(async () => {
  await resetFixtures(db);
});

afterAll(async () => {
  try {
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close(error => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      });
    }
  } finally {
    if (db) await db.end();
  }
});

async function rows(sql: string, params: unknown[] = []) {
  const [result] = await db.query<RowDataPacket[]>(sql, params);
  return result;
}

function partnerCookie(partnerCode: string, token: string) {
  return `partner_session=${encodeURIComponent(JSON.stringify({ partnerCode, token }))}`;
}

async function insertPortal(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO partner_portals SET ?", {
    id,
    partnerCode: "luca",
    partnerName: "Luca",
    sheetName: "独発送管理",
    password: "pw-luca",
    sessionToken: null,
    sessionExpiresAt: null,
    isActive: 1,
    createdAt: "2026-04-01 00:00:00",
    updatedAt: "2026-04-01 00:00:00",
    ...patch,
  });
}

async function loginLuca() {
  const res = await makeClient().inventory.partner.login.mutate({
    partnerCode: "luca",
    password: "pw-luca",
  });
  const portal = await rows(
    "SELECT sessionToken, sessionExpiresAt FROM partner_portals WHERE partnerCode = 'luca'",
  );
  return {
    res,
    token: String(portal[0].sessionToken),
    cookie: partnerCookie("luca", String(portal[0].sessionToken)),
  };
}

async function insertFedexShipment(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO fedex_shipments SET ?", {
    id,
    deliveryNo: `D-${id}`,
    sheetName: "独発送管理",
    shippingDate: "4/10",
    trackingNumber: `TRK-${id}`,
    itemsJson: JSON.stringify([
      { productNameJa: "【テスト】ゲーム機X", productNameEn: "Test Console X", quantity: 2 },
    ]),
    spreadsheetStatus: "success",
    spreadsheetError: null,
    operatorName: "テスト作業者",
    historyId: null,
    createdAt: "2026-04-10 10:00:00",
    updatedAt: "2026-04-10 10:00:00",
    ...patch,
  });
}

async function insertManualShipment(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO manual_shipments SET ?", {
    id,
    invoiceNo: "500",
    sheetName: "独発送管理",
    shippingDate: "4/12",
    trackingNumber: `MTRK-${id}`,
    itemsJson: JSON.stringify([
      { productNameJa: "【テスト】ゲーム機Y", productNameEn: "Test Console Y", quantity: 1 },
    ]),
    operatorName: "手動作業者",
    createdAt: "2026-04-12 10:00:00",
    ...patch,
  });
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

async function insertMessage(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO partner_messages SET ?", {
    id,
    partnerCode: "luca",
    partnerName: "Luca",
    fedexShipmentId: null,
    message: `メッセージ${id}`,
    isRead: 0,
    replyText: null,
    repliedAt: null,
    isDeleted: 0,
    isDeletedByPartner: 0,
    isReadByPartner: 0,
    createdAt: "2026-04-01 00:00:00",
    ...patch,
  });
}

async function insertThread(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO partner_message_threads SET ?", {
    id,
    parentMessageId: 970001,
    senderType: "partner",
    senderName: "Luca",
    content: `スレッド${id}`,
    isReadByPartner: 0,
    isReadByAdmin: 0,
    createdAt: "2026-04-01 00:00:00",
    ...patch,
  });
}

describe("partner.login / checkSession / logout: セッション契約", () => {
  it("正しいパスワードでトークンを発行し、応答に取引先名を返す", async () => {
    await insertPortal(930001);
    const { res, token } = await loginLuca();
    expect(res).toEqual({ success: true, partnerCode: "luca", partnerName: "Luca" });
    expect(token.length).toBeGreaterThan(10);
    const portal = await rows("SELECT sessionToken, sessionExpiresAt FROM partner_portals WHERE partnerCode = 'luca'");
    expect(portal[0].sessionToken).toBe(token);
    expect(portal[0].sessionExpiresAt).not.toBeNull();
  });

  it("パスワード不一致はUNAUTHORIZED、未登録・無効はNOT_FOUNDで拒否する", async () => {
    await insertPortal(930001);
    await insertPortal(930002, { partnerCode: "off", partnerName: "Off", isActive: 0 });
    await expect(
      makeClient().inventory.partner.login.mutate({ partnerCode: "luca", password: "wrong" }),
    ).rejects.toThrow(/Invalid password/);
    await expect(
      makeClient().inventory.partner.login.mutate({ partnerCode: "nobody", password: "pw" }),
    ).rejects.toThrow(/Partner not found/);
    await expect(
      makeClient().inventory.partner.login.mutate({ partnerCode: "off", password: "pw-luca" }),
    ).rejects.toThrow(/Partner not found/);
  });

  it("checkSessionはクッキー無し・トークン不一致・期限切れをfalse、正当なセッションをtrueで返す", async () => {
    await insertPortal(930001);
    const anon = { authenticated: false, partnerCode: null, partnerName: null };
    expect(await makeClient().inventory.partner.checkSession.query()).toEqual(anon);
    const { cookie } = await loginLuca();
    expect(await makeClient(cookie).inventory.partner.checkSession.query()).toEqual({
      authenticated: true,
      partnerCode: "luca",
      partnerName: "Luca",
    });
    expect(
      await makeClient(partnerCookie("luca", "bad-token")).inventory.partner.checkSession.query(),
    ).toEqual(anon);
    await db.query(
      "UPDATE partner_portals SET sessionExpiresAt = '2020-01-01 00:00:00' WHERE partnerCode = 'luca'",
    );
    expect(await makeClient(cookie).inventory.partner.checkSession.query()).toEqual(anon);
  });

  it("logoutはセッショントークンをDBから消去する", async () => {
    await insertPortal(930001);
    const { cookie } = await loginLuca();
    const res = await makeClient(cookie).inventory.partner.logout.mutate();
    expect(res).toEqual({ success: true });
    const portal = await rows("SELECT sessionToken FROM partner_portals WHERE partnerCode = 'luca'");
    expect(portal[0].sessionToken).toBeNull();
  });
});

describe("partner.getShipments: シート別フィルタ・手動発送統合・CSV情報", () => {
  it("自シートのFedEx+手動発送を統合し、チェック状態と取引先のCSV情報を返す", async () => {
    await insertPortal(930001);
    await insertFedexShipment(950001);
    await insertFedexShipment(950002, { sheetName: "サミー発送管理" });
    await insertManualShipment(960001);
    await insertManualShipment(960002, { sheetName: "サミー発送管理", invoiceNo: "501" });
    await db.query("INSERT INTO shipment_checks SET ?", {
      id: 955001,
      fedexShipmentId: 950001,
      itemIndex: 0,
      isChecked: 1,
      partnerCode: "luca",
    });
    await insertTrade(910001, { no: 500, partner: "ルカ" });
    await insertTrade(910002, { no: 501, partner: "サミー" });
    const { cookie } = await loginLuca();
    const res = await makeClient(cookie).inventory.partner.getShipments.query();

    const ids = res.shipments.map((s: { id: number }) => s.id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([-960001, 950001]);
    const manual = res.shipments.find((s: { id: number }) => s.id === -960001) as Record<string, unknown>;
    expect(manual.isManual).toBe(true);
    expect(manual.manualId).toBe(960001);
    expect(manual.deliveryNo).toBe("500");
    expect(manual.spreadsheetStatus).toBe("success");
    expect(res.checks).toEqual({ "950001_0": true });
    expect(Object.keys(res.csvData)).toEqual(["500"]);
    expect(res.csvData["500"].paymentDate).toBe("2026-04-01");
    expect(res.csvData["500"].products).toEqual([{ name: "【テスト】ゲーム機X", qty: 3 }]);
  });

  it("セッション無し・トークン不一致はUNAUTHORIZEDで拒否する", async () => {
    await insertPortal(930001);
    await expect(makeClient().inventory.partner.getShipments.query()).rejects.toThrow(/UNAUTHORIZED/);
    await expect(
      makeClient(partnerCookie("luca", "bad")).inventory.partner.getShipments.query(),
    ).rejects.toThrow(/UNAUTHORIZED/);
  });
});

describe("partner.updateCheck: 受取確認チェックのupsert", () => {
  it("初回は行を作成し、2回目は同一行を更新する", async () => {
    await insertPortal(930001);
    const { cookie } = await loginLuca();
    const client = makeClient(cookie);
    expect(
      await client.inventory.partner.updateCheck.mutate({
        fedexShipmentId: 950001,
        itemIndex: 2,
        isChecked: true,
      }),
    ).toEqual({ success: true });
    const first = await rows("SELECT * FROM shipment_checks");
    expect(first).toHaveLength(1);
    expect(first[0].partnerCode).toBe("luca");
    expect(first[0].isChecked).toBe(1);
    await client.inventory.partner.updateCheck.mutate({
      fedexShipmentId: 950001,
      itemIndex: 2,
      isChecked: false,
    });
    const second = await rows("SELECT * FROM shipment_checks");
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].isChecked).toBe(0);
  });
});

describe("partner メッセージ: 取引先側の送信・取得・削除・既読", () => {
  it("sendMessageは取引先名と発送ID付きで保存し、通知失敗は無視する", async () => {
    await insertPortal(930001);
    const { cookie } = await loginLuca();
    const client = makeClient(cookie);
    expect(
      await client.inventory.partner.sendMessage.mutate({
        message: "不足があります",
        fedexShipmentId: 950001,
      }),
    ).toEqual({ success: true });
    expect(await client.inventory.partner.sendMessage.mutate({ message: "2通目" })).toEqual({
      success: true,
    });
    const saved = await rows("SELECT * FROM partner_messages ORDER BY id");
    expect(saved).toHaveLength(2);
    expect(saved[0].partnerCode).toBe("luca");
    expect(saved[0].partnerName).toBe("Luca");
    expect(saved[0].fedexShipmentId).toBe(950001);
    expect(saved[0].message).toBe("不足があります");
    expect(saved[0].isRead).toBe(0);
    expect(saved[1].fedexShipmentId).toBeNull();
  });

  it("getMyMessagesは自分の未削除メッセージのみを新しい順に返す", async () => {
    await insertPortal(930001);
    await insertMessage(970001, { createdAt: "2026-04-01 10:00:00" });
    await insertMessage(970002, { createdAt: "2026-04-02 10:00:00" });
    await insertMessage(970003, { isDeletedByPartner: 1, createdAt: "2026-04-03 10:00:00" });
    await insertMessage(970004, { partnerCode: "sammy", partnerName: "Sammy" });
    const { cookie } = await loginLuca();
    const mine = await makeClient(cookie).inventory.partner.getMyMessages.query();
    expect(mine.map((m: { id: number }) => m.id)).toEqual([970002, 970001]);
  });

  it("deleteMyMessageは自分のメッセージのみ取引先側削除フラグを立てる", async () => {
    await insertPortal(930001);
    await insertMessage(970001);
    await insertMessage(970002, { partnerCode: "sammy", partnerName: "Sammy" });
    const { cookie } = await loginLuca();
    const client = makeClient(cookie);
    expect(await client.inventory.partner.deleteMyMessage.mutate({ id: 970001 })).toEqual({
      success: true,
    });
    // 他取引先のメッセージIDを指定してもsuccessを返すが行は変化しない（既存挙動）
    expect(await client.inventory.partner.deleteMyMessage.mutate({ id: 970002 })).toEqual({
      success: true,
    });
    const saved = await rows("SELECT id, isDeletedByPartner FROM partner_messages ORDER BY id");
    expect(saved.map(r => [r.id, r.isDeletedByPartner])).toEqual([
      [970001, 1],
      [970002, 0],
    ]);
  });

  it("markMessagesReadは自分のメッセージとadmin返信スレッドを既読にする", async () => {
    await insertPortal(930001);
    await insertMessage(970001);
    await insertMessage(970002, { partnerCode: "sammy", partnerName: "Sammy" });
    await insertThread(980001, { senderType: "admin", senderName: "管理者" });
    await insertThread(980002, { senderType: "partner" });
    const { cookie } = await loginLuca();
    expect(await makeClient(cookie).inventory.partner.markMessagesRead.mutate()).toEqual({
      success: true,
    });
    const messages = await rows("SELECT id, isReadByPartner FROM partner_messages ORDER BY id");
    expect(messages.map(r => [r.id, r.isReadByPartner])).toEqual([
      [970001, 1],
      [970002, 0],
    ]);
    const threads = await rows("SELECT id, isReadByPartner FROM partner_message_threads ORDER BY id");
    expect(threads.map(r => [r.id, r.isReadByPartner])).toEqual([
      [980001, 1],
      [980002, 0],
    ]);
  });

  it("addThreadReplyはポータルの取引先名でpartner種別スレッドを追加する", async () => {
    await insertPortal(930001);
    await insertMessage(970001);
    const { cookie } = await loginLuca();
    expect(
      await makeClient(cookie).inventory.partner.addThreadReply.mutate({
        parentMessageId: 970001,
        content: "追伸です",
      }),
    ).toEqual({ success: true });
    const threads = await rows("SELECT * FROM partner_message_threads");
    expect(threads).toHaveLength(1);
    expect(threads[0].parentMessageId).toBe(970001);
    expect(threads[0].senderType).toBe("partner");
    expect(threads[0].senderName).toBe("Luca");
    expect(threads[0].content).toBe("追伸です");
    expect(threads[0].isReadByAdmin).toBe(0);
  });

  it("getThreadsは親メッセージIDの一括指定で作成日時昇順に返し、空指定は空配列を返す", async () => {
    await insertMessage(970001);
    await insertMessage(970002);
    await insertThread(980001, { parentMessageId: 970001, createdAt: "2026-04-02 10:00:00" });
    await insertThread(980002, { parentMessageId: 970001, createdAt: "2026-04-01 10:00:00" });
    await insertThread(980003, { parentMessageId: 970002 });
    const res = await admin.inventory.partner.getThreads.query({
      parentMessageIds: [970001],
    });
    expect(res.map((t: { id: number }) => t.id)).toEqual([980002, 980001]);
    expect(
      await admin.inventory.partner.getThreads.query({ parentMessageIds: [] }),
    ).toEqual([]);
  });
});

describe("partner 管理者側: ポータルCRUD・メッセージ運用・手動発送", () => {
  it("createPortal→listPortals→updatePortal→deletePortalの契約を維持する", async () => {
    const created = await admin.inventory.partner.createPortal.mutate({
      partnerCode: "sammy",
      partnerName: "Sammy",
      sheetName: "サミー発送管理",
      password: "pw-sammy",
    });
    expect(created.id).toBeGreaterThan(0);
    await insertPortal(930001);
    const portals = await admin.inventory.partner.listPortals.query();
    expect(portals.map((p: { id: number }) => p.id)).toEqual([created.id, 930001].sort((a, b) => a - b));
    const sammy = portals.find((p: { partnerCode: string }) => p.partnerCode === "sammy")!;
    expect(sammy.isActive).toBe(1);
    await admin.inventory.partner.updatePortal.mutate({
      id: created.id,
      password: "pw-new",
      isActive: 0,
    });
    const updated = await rows("SELECT password, isActive FROM partner_portals WHERE id = ?", [created.id]);
    expect(updated[0].password).toBe("pw-new");
    expect(updated[0].isActive).toBe(0);
    await admin.inventory.partner.deletePortal.mutate({ id: created.id });
    expect(await rows("SELECT id FROM partner_portals WHERE id = ?", [created.id])).toHaveLength(0);
  });

  it("listMessages・markMessageRead・replyMessage・deleteMessageの保存値を維持する", async () => {
    await insertMessage(970001, { createdAt: "2026-04-01 10:00:00" });
    await insertMessage(970002, { createdAt: "2026-04-02 10:00:00" });
    const list = await admin.inventory.partner.listMessages.query();
    expect(list.map((m: { id: number }) => m.id)).toEqual([970002, 970001]);
    await admin.inventory.partner.markMessageRead.mutate({ id: 970001 });
    expect((await rows("SELECT isRead FROM partner_messages WHERE id = 970001"))[0].isRead).toBe(1);
    await admin.inventory.partner.replyMessage.mutate({ id: 970002, replyText: "確認しました" });
    const replied = await rows("SELECT replyText, repliedAt, isRead FROM partner_messages WHERE id = 970002");
    expect(replied[0].replyText).toBe("確認しました");
    expect(replied[0].repliedAt).not.toBeNull();
    expect(replied[0].isRead).toBe(1);
    await admin.inventory.partner.deleteMessage.mutate({ id: 970001 });
    const deleted = await rows("SELECT isDeleted FROM partner_messages WHERE id = 970001");
    expect(deleted[0].isDeleted).toBe(1);
    // 管理者向け一覧はisDeleted=1の行も返し続ける（既存挙動）
    const after = await admin.inventory.partner.listMessages.query();
    expect(after.map((m: { id: number }) => m.id)).toEqual([970002, 970001]);
  });

  it("addAdminThreadReplyとmarkThreadReadByAdminはadmin側の送信・既読契約を維持する", async () => {
    await insertMessage(970001);
    await insertThread(980001, { senderType: "partner" });
    await insertThread(980002, { senderType: "admin", senderName: "管理者" });
    expect(
      await admin.inventory.partner.addAdminThreadReply.mutate({
        parentMessageId: 970001,
        content: "対応します",
      }),
    ).toEqual({ success: true });
    const added = await rows(
      "SELECT senderType, senderName, content FROM partner_message_threads WHERE content = '対応します'",
    );
    expect(added[0].senderType).toBe("admin");
    expect(added[0].senderName).toBe("Local Developer");
    await admin.inventory.partner.markThreadReadByAdmin.mutate({ parentMessageId: 970001 });
    const threads = await rows(
      "SELECT id, senderType, isReadByAdmin FROM partner_message_threads WHERE id IN (980001, 980002) ORDER BY id",
    );
    expect(threads.map(r => [r.senderType, r.isReadByAdmin])).toEqual([
      ["partner", 1],
      ["admin", 0],
    ]);
  });

  it("addManualShipmentは発送データと作業ログを保存し、list/deleteと往復できる", async () => {
    const created = await admin.inventory.partner.addManualShipment.mutate({
      invoiceNo: "502",
      sheetName: "独発送管理",
      shippingDate: "4/15",
      trackingNumber: "MTRK-NEW",
      items: [
        { productNameJa: "【テスト】ゲーム機X", productNameEn: "Test Console X", quantity: 2 },
        { productNameJa: "【テスト】ゲーム機Y", productNameEn: "Test Console Y", quantity: 1 },
      ],
    });
    expect(created.id).toBeGreaterThan(0);
    const saved = await rows("SELECT * FROM manual_shipments WHERE id = ?", [created.id]);
    expect(saved[0].invoiceNo).toBe("502");
    expect(saved[0].operatorName).toBe("Local Developer");
    expect(JSON.parse(String(saved[0].itemsJson))).toEqual([
      { productNameJa: "【テスト】ゲーム機X", productNameEn: "Test Console X", quantity: 2 },
      { productNameJa: "【テスト】ゲーム機Y", productNameEn: "Test Console Y", quantity: 1 },
    ]);
    const logs = await rows("SELECT * FROM work_logs WHERE sourceType = 'manual-shipment'");
    expect(logs).toHaveLength(1);
    expect(logs[0].workerName).toBe("Local Developer");
    expect(logs[0].category).toBe("FedEx発送登録");
    expect(logs[0].quantity).toBe(3);
    expect(logs[0].sourceId).toBe("502:MTRK-NEW");
    expect(logs[0].memo).toBe("インボイスNo: 502 / 追跡番号: MTRK-NEW");
    const list = await admin.inventory.partner.listManualShipments.query();
    expect(list.map((m: { id: number }) => m.id)).toEqual([created.id]);
    await admin.inventory.partner.deleteManualShipment.mutate({ id: created.id });
    expect(await rows("SELECT id FROM manual_shipments")).toHaveLength(0);
  });

  it("getAdminShipmentsは全シートの発送と手動発送を統合し、complete状態をCSVに反映する", async () => {
    await insertFedexShipment(950001);
    await insertFedexShipment(950002, { sheetName: "サミー発送管理" });
    await insertManualShipment(960001, { invoiceNo: "501" });
    await insertTrade(910001, { no: 500, partner: "ルカ", status: "complete" });
    await insertTrade(910002, { no: 501, partner: "サミー" });
    const res = await admin.inventory.partner.getAdminShipments.query();
    const ids = res.shipments.map((s: { id: number }) => s.id).sort((a: number, b: number) => a - b);
    expect(ids).toEqual([-960001, 950001, 950002]);
    expect(res.csvData["500"].partner).toBe("ルカ");
    expect((res.csvData["500"] as { isComplete?: boolean }).isComplete).toBe(true);
    expect(res.csvData["501"].partner).toBe("サミー");
    expect((res.csvData["501"] as { isComplete?: boolean }).isComplete).toBeUndefined();
  });
});

describe("invoiceMemo: upsert・list・手動完了フラグ", () => {
  it("upsertは同一キーを更新し、list/listAllで保存値を返す", async () => {
    expect(
      await admin.inventory.invoiceMemo.upsert.mutate({
        invoiceKey: "371",
        colorKey: "New3DS ランダムカラー",
        memo: "白2青1",
      }),
    ).toEqual({ success: true });
    await admin.inventory.invoiceMemo.upsert.mutate({
      invoiceKey: "371",
      colorKey: "New3DS ランダムカラー",
      memo: "白1青2",
    });
    await admin.inventory.invoiceMemo.upsert.mutate({
      invoiceKey: "372",
      colorKey: "PSP",
      memo: "黒のみ",
    });
    const saved = await rows("SELECT invoice_key, color_key, memo FROM invoice_memos ORDER BY id");
    expect(saved.map(r => [r.invoice_key, r.color_key, r.memo])).toEqual([
      ["371", "New3DS ランダムカラー", "白1青2"],
      ["372", "PSP", "黒のみ"],
    ]);
    expect(await admin.inventory.invoiceMemo.list.query({ invoiceKey: "371" })).toEqual([
      { colorKey: "New3DS ランダムカラー", memo: "白1青2" },
    ]);
    expect(await admin.inventory.invoiceMemo.listAll.query()).toEqual([
      { invoiceKey: "371", colorKey: "New3DS ランダムカラー", memo: "白1青2" },
      { invoiceKey: "372", colorKey: "PSP", memo: "黒のみ" },
    ]);
  });

  it("setManualCompleteは__manual_complete__キーで1/0を保存する", async () => {
    await admin.inventory.invoiceMemo.setManualComplete.mutate({ invoiceKey: "371", completed: true });
    let saved = await rows("SELECT color_key, memo FROM invoice_memos WHERE invoice_key = '371'");
    expect(saved).toHaveLength(1);
    expect(saved[0].color_key).toBe("__manual_complete__");
    expect(saved[0].memo).toBe("1");
    await admin.inventory.invoiceMemo.setManualComplete.mutate({ invoiceKey: "371", completed: false });
    saved = await rows("SELECT memo FROM invoice_memos WHERE invoice_key = '371'");
    expect(saved).toHaveLength(1);
    expect(saved[0].memo).toBe("0");
  });
});

describe("inventoryMemo: create・list・listAll", () => {
  it("createは未指定項目をnullで保存し、listは在庫別に新しい順で返す", async () => {
    expect(
      await admin.inventory.inventoryMemo.create.mutate({
        zaicoInventoryId: 12345,
        title: "【テスト】ゲーム機X",
        changeType: "decrease",
        quantityBefore: 5,
        quantityAfter: 3,
        quantityDelta: -2,
        memo: "出庫2台",
        operatorName: "テスト作業者",
      }),
    ).toEqual({ success: true });
    expect(
      await admin.inventory.inventoryMemo.create.mutate({
        zaicoInventoryId: 12345,
        changeType: "set",
      }),
    ).toEqual({ success: true });
    await admin.inventory.inventoryMemo.create.mutate({
      zaicoInventoryId: 99999,
      changeType: "increase",
    });
    const saved = await rows("SELECT * FROM inventory_memos ORDER BY id");
    expect(saved).toHaveLength(3);
    expect(saved[0].zaicoInventoryId).toBe(12345);
    expect(saved[0].changeType).toBe("decrease");
    expect(saved[0].quantityDelta).toBe(-2);
    expect(saved[0].memo).toBe("出庫2台");
    expect(saved[0].operatorName).toBe("テスト作業者");
    expect(saved[1].title).toBeNull();
    expect(saved[1].quantityBefore).toBeNull();
    expect(saved[1].memo).toBeNull();
    expect(saved[1].operatorName).toBeNull();

    // createdAtを明示的にずらして並び順（新しい順）を固定する
    await db.query("UPDATE inventory_memos SET createdAt = '2026-04-01 10:00:00' WHERE id = ?", [saved[0].id]);
    await db.query("UPDATE inventory_memos SET createdAt = '2026-04-02 10:00:00' WHERE id = ?", [saved[1].id]);
    await db.query("UPDATE inventory_memos SET createdAt = '2026-04-03 10:00:00' WHERE id = ?", [saved[2].id]);
    const listed = await admin.inventory.inventoryMemo.list.query({ zaicoInventoryId: 12345 });
    expect(listed.map((m: { id: number }) => m.id)).toEqual([saved[1].id, saved[0].id]);
    const limited = await admin.inventory.inventoryMemo.list.query({ zaicoInventoryId: 12345, limit: 1 });
    expect(limited.map((m: { id: number }) => m.id)).toEqual([saved[1].id]);
    const all = await admin.inventory.inventoryMemo.listAll.query({ limit: 2 });
    expect(all.map((m: { id: number }) => m.id)).toEqual([saved[2].id, saved[1].id]);
  });
});
