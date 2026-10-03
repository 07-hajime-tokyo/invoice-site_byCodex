import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";
import { checkReceiptAckStale, ingestReceiptAckCrawlResult } from "../../server/inventory/receiptAck";

/**
 * 入庫履歴（purchaseHistory）・受取連絡（receiptAck）の整理前基準。
 * 画面の責務分割・receiptAck.ts の整理の前後で、同じ入力に対する
 * 応答・DB保存値が変わらないことを固定する。
 *
 * 前提:
 * - このテストランナーは RECEIPT_ACK_START_DATE 未設定で起動する。
 *   有効経路はテスト内で process.env を設定・復元して検証する（外部接続なし）。
 * - isZaicoEnabled() は常に false のため purchaseHistory.cancel は
 *   ローカルDB経路のみを通る。Zaico ON 経路は実外部接続が必要なため対象外。
 */

let db: Awaited<ReturnType<typeof connectTestDatabase>>;
let api: Awaited<ReturnType<typeof startTestApi>>;

beforeAll(async () => {
  db = await connectTestDatabase();
  api = await startTestApi();
});

beforeEach(async () => {
  await resetFixtures(db);
  delete process.env.RECEIPT_ACK_START_DATE;
});

afterAll(async () => {
  delete process.env.RECEIPT_ACK_START_DATE;
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

async function withStartDate<T>(startDate: string, fn: () => Promise<T>): Promise<T> {
  process.env.RECEIPT_ACK_START_DATE = startDate;
  try {
    return await fn();
  } finally {
    delete process.env.RECEIPT_ACK_START_DATE;
  }
}

async function insertHistory(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO purchase_histories SET ?", {
    id,
    zaicoId: 990000 + (id % 1000),
    kanriNo: `PH-${id}`,
    title: `【テスト】履歴${id}`,
    category: "ゲーム機",
    supplier: "架空仕入先",
    quantity: "1",
    unitPrice: "1000",
    purchaseDate: "2026-09-20",
    inventoryId: null,
    cancelled: 0,
    operatorName: "テスト担当",
    createdAt: "2026-09-20 12:00:00",
    ...patch,
  });
}

async function insertLocalPurchase(id: number, patch: Record<string, unknown> = {}) {
  await db.query("INSERT INTO local_purchases SET ?", {
    id,
    status: "purchased",
    itemsJson: JSON.stringify([]),
    title: `【テスト】発注${id}`,
    quantity: 1,
    managementNo: `TEST-LP-${id}`,
    receivedDate: "2026-09-10",
    classSource: "manual",
    createdAt: "2026-09-10",
    updatedAt: "2026-09-10",
    ...patch,
  });
}

async function receiptAckRow(id: number) {
  const found = await rows(
    "SELECT receiptAckStatus, receiptAckSource, receiptAckNote, receiptAckAt FROM local_purchases WHERE id = ?",
    [id],
  );
  return found[0];
}

describe("purchaseHistory.list", () => {
  it("作成日時の降順で返し inventory_extras / purchase_extras を結合し limit で切る", async () => {
    await insertHistory(950001, { zaicoId: 990001, inventoryId: 980001, createdAt: "2026-09-20 12:00:00" });
    await insertHistory(950002, { zaicoId: 990002, createdAt: "2026-09-21 12:00:00" });
    await insertHistory(950003, { zaicoId: 990003, createdAt: "2026-09-22 12:00:00" });
    await db.query("INSERT INTO inventory_extras SET ?", {
      zaicoInventoryId: 980001,
      supplierUrl: "https://example.test/supplier",
      supplierName: "駿河屋テスト店",
    });
    await db.query("INSERT INTO purchase_extras SET ?", {
      zaicoId: 990001,
      trackingNumber: "TRACK-950001",
      carrier: "yamato",
    });

    const list = await api.client.inventory.purchaseHistory.list.query({ limit: 200 });
    expect(list.map(row => row.id)).toEqual([950003, 950002, 950001]);

    const first = list.find(row => row.id === 950001)!;
    expect(first).toMatchObject({
      zaicoId: 990001,
      kanriNo: "PH-950001",
      title: "【テスト】履歴950001",
      category: "ゲーム機",
      supplier: "架空仕入先",
      quantity: "1",
      unitPrice: "1000",
      purchaseDate: "2026-09-20",
      inventoryId: 980001,
      cancelled: 0,
      operatorName: "テスト担当",
      supplierUrl: "https://example.test/supplier",
      supplierName: "駿河屋テスト店",
      trackingNumber: "TRACK-950001",
      carrier: "yamato",
      receiptAckPurchaseId: null,
      receiptAckStatus: null,
      receiptAckSource: null,
      receiptAckAt: null,
      receiptAckNote: null,
    });

    const limited = await api.client.inventory.purchaseHistory.list.query({ limit: 2 });
    expect(limited.map(row => row.id)).toEqual([950003, 950002]);
  });

  it("管理番号が一致する発注データから受取連絡・仕入先情報を補完する", async () => {
    await db.query(
      "UPDATE local_purchases SET status='purchased', receivedDate='2026-09-05', supplierUrl='https://jp.mercari.com/item/m12345', receiptAckStatus='pending', receiptAckSource='crawl', receiptAckNote='awaiting_review' WHERE id=910005",
    );
    await insertHistory(950005, { kanriNo: "TEST-E", supplier: null, createdAt: "2026-09-21 09:00:00" });

    const list = await api.client.inventory.purchaseHistory.list.query({ limit: 200 });
    const row = list.find(item => item.id === 950005)!;
    expect(row).toMatchObject({
      kanriNo: "TEST-E",
      supplier: "架空仕入先",
      supplierUrl: "https://jp.mercari.com/item/m12345",
      supplierName: "架空仕入先",
      receiptAckPurchaseId: 910005,
      receiptAckStatus: "pending",
      receiptAckSource: "crawl",
      receiptAckNote: "awaiting_review",
    });
  });

  it("同じ管理番号の行は1行に集約し、有効な行を優先して数量は大きい方を残す", async () => {
    await insertHistory(950010, {
      kanriNo: "PH-DUP",
      zaicoId: 990010,
      cancelled: 1,
      quantity: "2",
      unitPrice: "100",
      createdAt: "2026-09-10 12:00:00",
    });
    await insertHistory(950011, {
      kanriNo: "PH-DUP",
      zaicoId: 990011,
      cancelled: 0,
      quantity: "1",
      unitPrice: null,
      createdAt: "2026-09-11 12:00:00",
    });

    const list = await api.client.inventory.purchaseHistory.list.query({ limit: 200 });
    const merged = list.filter(row => row.kanriNo === "PH-DUP");
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 950011,
      cancelled: 0,
      quantity: "2",
      unitPrice: "100",
    });
  });

  it("入庫済みラベルから履歴のない個体を負IDで復元し、発注データを補完する", async () => {
    await db.query("INSERT INTO inventory_item_labels SET ?", {
      id: 970001,
      labelId: "TESTLB1",
      localInventoryId: 910001,
      legacyManagementNo: "OLD-A",
      title: "【テスト】ラベル復元A",
      status: "received",
      receivedAt: "2026-09-22 09:00:00",
      createdAt: "2026-09-22 09:00:00",
    });

    const list = await api.client.inventory.purchaseHistory.list.query({ limit: 200 });
    const recovered = list.find(row => row.kanriNo === "OLD-A")!;
    expect(recovered).toBeDefined();
    expect(recovered.id).toBeLessThan(0);
    // 復元行自体は数量"1"だが、在庫ID経由で一致した発注データの数量(2)で補完される（既存挙動）
    expect(recovered).toMatchObject({
      zaicoId: 910001,
      title: "【テスト】ラベル復元A",
      quantity: "2",
      cancelled: 0,
      supplierName: "架空仕入先",
      receiptAckPurchaseId: 910001,
    });
  });
});

describe("purchaseHistory.cancel（ローカルDB経路）", () => {
  it("発注をorderedに戻し、在庫数を減算し、履歴を取り消し済みにする", async () => {
    await db.query("UPDATE local_purchases SET status='purchased' WHERE id=910005");
    await db.query("UPDATE local_inventories SET quantity=5 WHERE id=910005");
    await insertHistory(950020, { zaicoId: 910005, inventoryId: 910005 });

    const result = await api.client.inventory.purchaseHistory.cancel.mutate({
      id: 950020,
      purchaseId: 910005,
      operatorKey: "default",
      kanriNo: "TEST-E",
      title: "【テスト】入庫済みE",
      purchaseItems: [{ inventory_id: 910005, quantity: "2", unit_price: "500.00" }],
    });
    expect(result).toEqual({ success: true });

    const purchase = await rows("SELECT status FROM local_purchases WHERE id=910005");
    expect(purchase[0].status).toBe("ordered");
    const inventory = await rows("SELECT quantity FROM local_inventories WHERE id=910005");
    expect(inventory[0].quantity).toBe(3);
    const history = await rows("SELECT cancelled FROM purchase_histories WHERE id=950020");
    expect(history[0].cancelled).toBe(1);
  });

  it("在庫数は0未満にしない。対応する発注が見つからなくても履歴は取り消す", async () => {
    await db.query("UPDATE local_inventories SET quantity=1 WHERE id=910003");
    await insertHistory(950021, { zaicoId: 999999, inventoryId: 910003 });

    const result = await api.client.inventory.purchaseHistory.cancel.mutate({
      id: 950021,
      purchaseId: 999999,
      purchaseItems: [{ inventory_id: 910003, quantity: "5", unit_price: "400.00" }],
    });
    expect(result).toEqual({ success: true });

    const inventory = await rows("SELECT quantity FROM local_inventories WHERE id=910003");
    expect(inventory[0].quantity).toBe(0);
    const history = await rows("SELECT cancelled FROM purchase_histories WHERE id=950021");
    expect(history[0].cancelled).toBe(1);
  });

  it("既存挙動: 同じ取り消しを2回実行すると在庫はもう一度減算される（冪等ではない）", async () => {
    await db.query("UPDATE local_purchases SET status='purchased' WHERE id=910005");
    await db.query("UPDATE local_inventories SET quantity=5 WHERE id=910005");
    await insertHistory(950022, { zaicoId: 910005, inventoryId: 910005 });

    const input = {
      id: 950022,
      purchaseId: 910005,
      purchaseItems: [{ inventory_id: 910005, quantity: "2", unit_price: "500.00" }],
    };
    await api.client.inventory.purchaseHistory.cancel.mutate(input);
    await api.client.inventory.purchaseHistory.cancel.mutate(input);

    const purchase = await rows("SELECT status FROM local_purchases WHERE id=910005");
    expect(purchase[0].status).toBe("ordered");
    const inventory = await rows("SELECT quantity FROM local_inventories WHERE id=910005");
    expect(inventory[0].quantity).toBe(1);
    const history = await rows("SELECT cancelled FROM purchase_histories WHERE id=950022");
    expect(history[0].cancelled).toBe(1);
  });
});

describe("receiptAck.summary", () => {
  it("RECEIPT_ACK_START_DATE 未設定時は無効として全件0を返す", async () => {
    const summary = await api.client.inventory.receiptAck.summary.query();
    expect(summary).toEqual({
      enabled: false,
      startDate: null,
      pending: 0,
      unknown: 0,
      unavailable: 0,
    });
  });

  it("有効時は開始日以降の入庫済み発注から pending / unknown / unavailable を数える", async () => {
    await db.query(
      "UPDATE local_purchases SET status='purchased', receivedDate=purchaseDate WHERE id IN (910001,910002,910003,910004,910005)",
    );
    await db.query("UPDATE local_purchases SET receiptAckStatus='pending' WHERE id=910001");
    await db.query("UPDATE local_purchases SET receiptAckStatus='unknown' WHERE id=910002");
    await db.query("UPDATE local_purchases SET receiptAckStatus='unavailable' WHERE id=910003");
    await db.query("UPDATE local_purchases SET receiptAckStatus='done', receiptAckSource='crawl' WHERE id=910004");
    await db.query("UPDATE local_purchases SET receiptAckStatus='done', receiptAckSource='manual' WHERE id=910005");
    // 開始日より前の入庫は数えない
    await db.query("UPDATE local_purchases SET status='purchased', receivedDate='2025-12-31', receiptAckStatus='pending' WHERE id=910007");

    const summary = await withStartDate("2026-01-01", () => api.client.inventory.receiptAck.summary.query());
    expect(summary).toEqual({
      enabled: true,
      startDate: "2026-01-01",
      pending: 1,
      unknown: 1,
      unavailable: 1,
    });
  });
});

describe("receiptAck.markDone", () => {
  it("手動の受取連絡済みとして保存し、担当者マスタを補充する", async () => {
    await db.query(
      "UPDATE local_purchases SET status='purchased', receivedDate='2026-09-05', receiptAckStatus='pending', receiptAckSource='crawl' WHERE id=910005",
    );

    const result = await api.client.inventory.receiptAck.markDone.mutate({ purchaseId: 910005 });
    expect(result).toEqual({ ok: true, purchaseId: 910005, tasksCreated: 0 });

    const saved = await receiptAckRow(910005);
    expect(saved.receiptAckStatus).toBe("done");
    expect(saved.receiptAckSource).toBe("manual");
    expect(saved.receiptAckNote).toBe("手動で受取連絡済みにしました");
    expect(saved.receiptAckAt).not.toBeNull();

    const assignees = await rows("SELECT name FROM action_item_assignees ORDER BY name");
    expect(assignees.map(row => row.name)).toEqual(["荷受担当", "野田さん"]);
  });

  it("有効時は未実施タスクを同期し、全件済みになるとタスクを閉じる", async () => {
    await db.query(
      "UPDATE local_purchases SET status='purchased', receivedDate='2026-09-05', receiptAckStatus='pending' WHERE id=910005",
    );

    await withStartDate("2026-01-01", async () => {
      // 1件目のmarkDoneで未実施が0件になるので、既に開いていたタスクは閉じる
      await db.query("INSERT INTO action_items SET ?", {
        id: 960001,
        title: "受取連絡が未実施です",
        assignee: "荷受担当",
        detail: "既存タスク",
        status: "open",
        source: "receipt-ack",
        sourceKey: "receipt-ack-pending",
        createdBy: "receipt-ack",
      });
      await api.client.inventory.receiptAck.markDone.mutate({ purchaseId: 910005 });
    });

    const task = await rows("SELECT status, completedAt FROM action_items WHERE id=960001");
    expect(task[0].status).toBe("done");
    expect(task[0].completedAt).not.toBeNull();
  });

  it("存在しない発注IDはエラーにする", async () => {
    await expect(
      api.client.inventory.receiptAck.markDone.mutate({ purchaseId: 888888 }),
    ).rejects.toThrow("発注データが見つかりません");
  });
});

describe("ingestReceiptAckCrawlResult（サービス直呼び・DB完結）", () => {
  const mainPayload = {
    crawledAt: "2026-09-23T10:00:00.000Z",
    sites: [
      {
        site: "mercari",
        ok: true,
        items: [{ itemId: "m111", status: "completed" }],
      },
      {
        site: "yahuoku",
        ok: true,
        items: [{ itemId: "a444", status: "shipped" }],
      },
    ],
  };

  async function seedIngestRows() {
    await insertLocalPurchase(920001, { supplierUrl: "https://jp.mercari.com/item/m111" });
    await insertLocalPurchase(920002, { supplierUrl: "https://jp.mercari.com/item/m222" });
    await insertLocalPurchase(920003, { supplierUrl: "https://page.auctions.yahoo.co.jp/jp/auction/b333" });
    await insertLocalPurchase(920004, { supplierUrl: "https://paypayfleamarket.yahoo.co.jp/item/z987" });
    await insertLocalPurchase(920005, { supplierUrl: null });
    await insertLocalPurchase(920006, { supplierUrl: "https://www.amazon.co.jp/dp/B000TEST" });
    await insertLocalPurchase(920007, {
      supplierUrl: "https://page.auctions.yahoo.co.jp/jp/auction/a444",
      receiptAckStatus: "done",
      receiptAckSource: "manual",
      receiptAckNote: "手動で受取連絡済みにしました",
    });
  }

  it("サイト別の判定・手動済み取消・件数・未実施タスクを保存する", async () => {
    await seedIngestRows();

    const result = await withStartDate("2026-01-01", () => ingestReceiptAckCrawlResult(mainPayload));
    expect(result).toEqual({
      ok: true,
      matched: 5,
      updated: 7,
      pending: 1,
      unknown: 3,
      unavailable: 0,
      revoked: 1,
      tasksCreated: 1,
    });

    const expected: Array<[number, string, string | null]> = [
      [920001, "done", "completed"],
      [920002, "done", "未完了一覧に無いため完了扱い"],
      [920003, "unknown", "落札一覧に見つかりません"],
      [920004, "unknown", "巡回結果に対象サイトがありません"],
      [920005, "unknown", "仕入先URLなし、または取引URLを判定できません"],
      [920006, "not_required", "対象外の仕入先URL"],
      [920007, "pending", "手動済み取消: shipped"],
    ];
    for (const [id, status, note] of expected) {
      const saved = await receiptAckRow(id);
      expect({ id, status: saved.receiptAckStatus, source: saved.receiptAckSource, note: saved.receiptAckNote }).toEqual({
        id,
        status,
        source: "crawl",
        note,
      });
      expect(saved.receiptAckAt).not.toBeNull();
    }

    const setting = await rows("SELECT value FROM system_settings WHERE `key`='receiptAckLastCrawledAt'");
    expect(setting).toHaveLength(1);

    const pendingTask = await rows(
      "SELECT title, assignee, detail, status FROM action_items WHERE sourceKey='receipt-ack-pending'",
    );
    expect(pendingTask).toHaveLength(1);
    expect(pendingTask[0].status).toBe("open");
    expect(pendingTask[0].title).toBe("受取連絡が未実施です");
    expect(pendingTask[0].assignee).toBe("荷受担当");
    expect(pendingTask[0].detail).toContain("入庫済みですが受取連絡がまだです。（1件）");
    expect(pendingTask[0].detail).toContain("手動で済にした後、巡回で未実施に戻った商品が 1 件あります。");
    expect(pendingTask[0].detail).toContain("- [手動済み取消] 商品ID: a444");
    expect(pendingTask[0].detail).toContain("旧管理番号: TEST-LP-920007");
  });

  it("既存挙動: 同じ巡回結果を再取り込みすると手動済み取消の注記は通常の注記に戻る", async () => {
    await seedIngestRows();
    await withStartDate("2026-01-01", () => ingestReceiptAckCrawlResult(mainPayload));
    const second = await withStartDate("2026-01-01", () => ingestReceiptAckCrawlResult(mainPayload));

    expect(second).toEqual({
      ok: true,
      matched: 3,
      updated: 1,
      pending: 1,
      unknown: 3,
      unavailable: 0,
      revoked: 0,
      tasksCreated: 0,
    });
    const saved = await receiptAckRow(920007);
    expect(saved.receiptAckNote).toBe("shipped");
  });

  it("巡回失敗サイトは unavailable とし、失敗タスクに影響件数を残す", async () => {
    await insertLocalPurchase(930001, { supplierUrl: "https://page.auctions.yahoo.co.jp/jp/auction/c555" });

    const result = await withStartDate("2026-01-01", () =>
      ingestReceiptAckCrawlResult({
        crawledAt: "2026-09-23T10:00:00.000Z",
        sites: [
          { site: "mercari", ok: true, items: [] },
          { site: "yahuoku", ok: false, error: "login_required", items: [] },
        ],
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      matched: 1,
      updated: 1,
      unavailable: 1,
      tasksCreated: 1,
    });

    const saved = await receiptAckRow(930001);
    expect(saved.receiptAckStatus).toBe("unavailable");
    expect(saved.receiptAckNote).toBe("login_required");

    const failedTask = await rows(
      "SELECT assignee, detail, status FROM action_items WHERE sourceKey='receipt-ack-crawl-failed'",
    );
    expect(failedTask).toHaveLength(1);
    expect(failedTask[0].status).toBe("open");
    expect(failedTask[0].assignee).toBe("野田さん");
    expect(failedTask[0].detail).toContain("- yahuoku: 1件 / login_required");
  });

  it("RECEIPT_ACK_START_DATE 未設定時は何も更新せず disabled を返す", async () => {
    await insertLocalPurchase(930002, { supplierUrl: "https://jp.mercari.com/item/m111" });

    const result = await ingestReceiptAckCrawlResult(mainPayload);
    expect(result).toEqual({
      ok: true,
      disabled: true,
      matched: 0,
      updated: 0,
      pending: 0,
      unknown: 0,
      unavailable: 0,
      revoked: 0,
      tasksCreated: 0,
    });

    const saved = await receiptAckRow(930002);
    expect(saved.receiptAckStatus).toBeNull();
    const setting = await rows("SELECT value FROM system_settings WHERE `key`='receiptAckLastCrawledAt'");
    expect(setting).toHaveLength(0);
  });
});

describe("checkReceiptAckStale（サービス直呼び・DB完結）", () => {
  it("無効時は stale=false でタスクを作らない", async () => {
    const result = await checkReceiptAckStale();
    expect(result).toEqual({
      ok: true,
      enabled: false,
      startDate: null,
      staleHours: 36,
      lastCrawledAt: null,
      stale: false,
      tasksCreated: 0,
    });
    const tasks = await rows("SELECT id FROM action_items WHERE sourceKey='receipt-ack-stale'");
    expect(tasks).toHaveLength(0);
  });

  it("有効で巡回結果が一度も届いていなければ途絶タスクを開く", async () => {
    const result = await withStartDate("2026-01-01", () => checkReceiptAckStale());
    expect(result).toEqual({
      ok: true,
      enabled: true,
      startDate: "2026-01-01",
      staleHours: 36,
      lastCrawledAt: null,
      stale: true,
      tasksCreated: 1,
    });

    const tasks = await rows(
      "SELECT assignee, detail, status FROM action_items WHERE sourceKey='receipt-ack-stale'",
    );
    expect(tasks).toHaveLength(1);
    expect(tasks[0].status).toBe("open");
    expect(tasks[0].assignee).toBe("野田さん");
    expect(tasks[0].detail).toContain("受取連絡の巡回結果が 36 時間以上届いていません。");
    expect(tasks[0].detail).toContain("まだ一度も巡回結果が届いていません。");
  });
});
