import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RowDataPacket } from "mysql2/promise";
import { connectTestDatabase, resetFixtures } from "./support/database";
import { startTestApi } from "./support/api";

/**
 * 会話履歴・ナレッジ・AI（whatsappHistory / whatsappChats / knowledgeBase）の整理前基準。
 * ルーター抽出の前後で、DBで完結する手続きの保存値・応答と、
 * 外部サービス未設定時のエラー文言（ネットワークに出る前に落ちる契約）が変わらないことを固定する。
 * Forge / Gemini / S3 へは一切アクセスしない（テスト環境に該当envが無いことが前提）。
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

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

/** WhatsApp書き出し（iOS形式）を組み立てる。sentAt はUTC壁時計として解釈される。 */
function exportLine(date: Date, sender: string, body: string): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getUTCFullYear()}/${p(date.getUTCMonth() + 1)}/${p(date.getUTCDate())}, ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
  return `[${stamp}] ${sender}: ${body}`;
}

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

async function insertKnowledge(values: Record<string, unknown> = {}): Promise<number> {
  const [result] = await db.query("INSERT INTO chat_knowledge SET ?", {
    sourceType: "chat_text",
    sourceLabel: "【テスト】_chat.txt",
    content: "=== テスト知識 ===\nInvoice - 0372.pdf を送付した記録。",
    ...values,
  });
  return (result as { insertId: number }).insertId;
}

describe("インボイス番号履歴（whatsappHistory）", () => {
  it("PDFファイル名と_chat.txtから番号を抽出し、履歴へ保存して次番号を返す", async () => {
    const result = await api.client.whatsappHistory.extractNumbers.mutate({
      files: [
        { name: "Invoice - 0372.pdf", base64: b64("dummy"), mimeType: "application/pdf" },
        { name: "invoice0523.pdf", base64: b64("dummy"), mimeType: "application/pdf" }, // 厳密形式でないため対象外
        {
          name: "_chat.txt",
          base64: b64(
            "attached: Invoice - 0280.pdf\nattached: Invoice - 2026.pdf\nattached: Invoice - 0372.pdf",
          ),
          mimeType: "text/plain",
        },
      ],
    });

    // 0372はファイル名が先勝ち、2026は年とみなして除外、重複は番号で一意化
    expect(result.extracted).toEqual([
      { number: 372, source: "filename", rawValue: "Invoice - 0372.pdf" },
      { number: 280, source: "chat_text", rawValue: "Invoice - 0280.pdf" },
    ]);
    expect(result).toMatchObject({ maxNumber: 372, nextNumber: 373, nextFormatted: "0373" });

    const saved = await rows(
      "SELECT number, source, rawValue FROM invoice_number_history ORDER BY number",
    );
    expect(saved).toEqual([
      { number: 280, source: "chat_text", rawValue: "Invoice - 0280.pdf" },
      { number: 372, source: "filename", rawValue: "Invoice - 0372.pdf" },
    ]);

    // 抽出ゼロでも保存済み履歴から次番号を計算する
    const empty = await api.client.whatsappHistory.extractNumbers.mutate({
      files: [{ name: "memo.txt", base64: b64("番号なし"), mimeType: "text/plain" }],
    });
    expect(empty).toMatchObject({ extracted: [], maxNumber: 372, nextFormatted: "0373" });
  });

  it("getNextNumberは履歴と未削除インボイスの最大値から次番号を返す", async () => {
    await db.query("INSERT INTO invoice_number_history SET ?", {
      number: 100,
      source: "chat_text",
      rawValue: "Invoice - 0100.pdf",
    });
    await db.query("INSERT INTO invoices SET ?", { invoiceNumber: "0372" });
    await db.query("INSERT INTO invoices SET ?", {
      invoiceNumber: "0999",
      deletedAt: "2026-09-01 00:00:00", // ソフトデリート済みは対象外
    });

    const result = await api.client.whatsappHistory.getNextNumber.query();
    expect(result).toEqual({ maxNumber: 372, nextNumber: 373, nextFormatted: "0373" });
  });

  it("チャットテキスト履歴の保存→一覧→削除を保持する（S3なしで完結）", async () => {
    const created = await api.client.whatsappHistory.saveHistory.mutate({
      label: "ルカ 2026-09",
      type: "chat_text",
      fileName: "_chat.txt",
      textContent: "Invoice - 0372.pdf\ni paid",
    });
    expect(created.id).toBeGreaterThan(0);

    const saved = await rows("SELECT * FROM whatsapp_chat_history WHERE id = ?", [created.id]);
    expect(saved[0]).toMatchObject({
      label: "ルカ 2026-09",
      type: "chat_text",
      fileName: "_chat.txt",
      imageUrl: null,
      imageKey: null,
      textContent: "Invoice - 0372.pdf\ni paid",
      mimeType: null,
    });

    const listed = await api.client.whatsappHistory.listHistory.query();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: created.id, label: "ルカ 2026-09" });

    await api.client.whatsappHistory.deleteHistory.mutate({ id: created.id });
    expect(await api.client.whatsappHistory.listHistory.query()).toEqual([]);
  });

  it("listHistoryは新しい順に返す", async () => {
    await db.query("INSERT INTO whatsapp_chat_history SET ?", {
      label: "古い", type: "chat_text", textContent: "old", createdAt: "2026-09-01 10:00:00",
    });
    await db.query("INSERT INTO whatsapp_chat_history SET ?", {
      label: "新しい", type: "chat_text", textContent: "new", createdAt: "2026-09-20 10:00:00",
    });
    const listed = await api.client.whatsappHistory.listHistory.query();
    expect(listed.map((h) => h.label)).toEqual(["新しい", "古い"]);
  });

  it("analyzeHistoryItemは存在チェックの後、Forge未設定なら種別を問わずエラーになる（既存挙動の固定）", async () => {
    await expect(
      api.client.whatsappHistory.analyzeHistoryItem.mutate({ id: 999999 }),
    ).rejects.toThrow(/履歴が見つかりません/);

    const created = await api.client.whatsappHistory.saveHistory.mutate({
      label: "テキスト解析", type: "chat_text", textContent: "Invoice - 0372.pdf\ni paid",
    });
    // chat_text は正規表現のみで解析できるが、envチェックが分岐より先にある
    await expect(
      api.client.whatsappHistory.analyzeHistoryItem.mutate({ id: created.id }),
    ).rejects.toThrow(/Forge API not configured/);
  });
});

describe("WhatsApp会話履歴（whatsappChats）", () => {
  it("取り込み→一覧→重複再取り込み→期間指定の往復を保持する", async () => {
    const oldDate = daysAgo(120);
    const newDate = daysAgo(2);
    const rawText = [
      exportLine(oldDate, "Simon", "Hello, do you have 3DS LL?"),
      exportLine(oldDate, "村上", "在庫ありますよ"),
      exportLine(newDate, "Simon", "I paid invoice 0372"),
    ].join("\n");

    const imported = await api.client.whatsappChats.importChat.mutate({
      name: "Simon", rawText, ownerNames: ["村上"],
    });
    expect(imported).toMatchObject({
      parsed: 3, imported: 3, skippedDuplicates: 0, skippedOutOfRange: 0,
    });

    const conversations = await api.client.whatsappChats.listConversations.query();
    expect(conversations).toHaveLength(1);
    expect(conversations[0]).toMatchObject({
      name: "Simon",
      isGroup: false,
      messageCount: 3,
      untranslatedCount: 2, // 日本語の1件は translationSkipped=true
    });
    expect(conversations[0].firstMessageAt).not.toBeNull();
    expect(conversations[0].lastMessageAt).not.toBeNull();

    // 同じ内容の再取り込みは dedupeKey で全て弾かれる
    const again = await api.client.whatsappChats.importChat.mutate({
      name: "Simon", rawText, ownerNames: ["村上"],
    });
    expect(again).toMatchObject({
      conversationId: imported.conversationId,
      parsed: 3, imported: 0, skippedDuplicates: 3, skippedOutOfRange: 0,
    });

    // since より古いメッセージは取り込み対象外として数える
    const ranged = await api.client.whatsappChats.importChat.mutate({
      name: "Simon", rawText, since: daysAgo(30).toISOString(),
    });
    expect(ranged).toMatchObject({
      parsed: 3, imported: 0, skippedDuplicates: 1, skippedOutOfRange: 2,
    });

    const stored = await rows(
      "SELECT sender, isOutgoing, translationSkipped FROM whatsapp_messages WHERE conversationId = ? ORDER BY sentAt, id",
      [imported.conversationId],
    );
    expect(stored).toEqual([
      { sender: "Simon", isOutgoing: 0, translationSkipped: 0 },
      { sender: "村上", isOutgoing: 1, translationSkipped: 1 },
      { sender: "Simon", isOutgoing: 0, translationSkipped: 0 },
    ]);
  });

  it("読み取れないテキストはエラーにする", async () => {
    await expect(
      api.client.whatsappChats.importChat.mutate({ name: "X", rawText: "ただのメモ\n形式なし" }),
    ).rejects.toThrow(/読み取れませんでした/);
  });

  it("getMessagesはキーワード指定で全期間から探す", async () => {
    const imported = await api.client.whatsappChats.importChat.mutate({
      name: "Luca",
      rawText: [
        exportLine(daysAgo(200), "Luca", "old order: PS Vita x3"),
        exportLine(daysAgo(1), "Luca", "new order: 2DS LL x5"),
      ].join("\n"),
    });

    const found = await api.client.whatsappChats.getMessages.query({
      conversationId: imported.conversationId, keyword: "PS Vita",
    });
    expect(found.messages).toHaveLength(1);
    expect(found.messages[0].body).toBe("old order: PS Vita x3");
    expect(found).toMatchObject({ totalCount: 2, hasMore: false, searchedAll: true });
  });

  it("getMessagesは期間内が少なければ最低件数まで遡って返す", async () => {
    // 全メッセージが2週間窓の外 → 期間では0件だが、最低件数フォールバックで全件返る
    const lines = [0, 1, 2].map((i) =>
      exportLine(daysAgo(100 + i), "Luca", `old message ${i}`),
    );
    const imported = await api.client.whatsappChats.importChat.mutate({
      name: "Luca", rawText: lines.join("\n"),
    });

    const result = await api.client.whatsappChats.getMessages.query({
      conversationId: imported.conversationId,
    });
    // daysAgo(100+i) なので i=2 が最古。フォールバックでも古い順で返る
    expect(result.messages.map((m) => m.body)).toEqual([
      "old message 2", "old message 1", "old message 0",
    ]);
    expect(result).toMatchObject({ totalCount: 3, hasMore: false, searchedAll: false });
  });

  it("translateは未翻訳0件ならGeminiを呼ばずに完了し、残があればenv未設定エラーになる", async () => {
    const imported = await api.client.whatsappChats.importChat.mutate({
      name: "日本語のみ", rawText: exportLine(daysAgo(1), "村上", "了解です、明日発送します"),
    });
    const result = await api.client.whatsappChats.translate.mutate({
      conversationId: imported.conversationId,
    });
    expect(result).toEqual({ translated: 0, remaining: 0, failedChunks: 0 });

    const english = await api.client.whatsappChats.importChat.mutate({
      name: "English", rawText: exportLine(daysAgo(1), "Luca", "please send invoice"),
    });
    await expect(
      api.client.whatsappChats.translate.mutate({ conversationId: english.conversationId }),
    ).rejects.toThrow(/GEMINI_API_KEY が未設定です/);
  });

  it("deleteConversationは会話とメッセージをまとめて消す", async () => {
    const imported = await api.client.whatsappChats.importChat.mutate({
      name: "Simon", rawText: exportLine(daysAgo(1), "Simon", "hello"),
    });
    const result = await api.client.whatsappChats.deleteConversation.mutate({
      conversationId: imported.conversationId,
    });
    expect(result).toEqual({ ok: true });
    expect(await rows("SELECT id FROM whatsapp_conversations")).toEqual([]);
    expect(await rows("SELECT id FROM whatsapp_messages")).toEqual([]);
  });
});

describe("知識ベース（knowledgeBase）", () => {
  it("一覧はcontentを含まない列だけを新しい順で返し、削除で消える", async () => {
    const oldId = await insertKnowledge({
      sourceLabel: "古い.txt", createdAt: "2026-09-01 10:00:00",
    });
    const newId = await insertKnowledge({
      sourceType: "screenshot",
      sourceLabel: "新しい.png",
      dateRange: "2026/09/20",
      imageUrl: "https://example.com/dummy.png",
      createdAt: "2026-09-20 10:00:00",
    });

    const listed = await api.client.knowledgeBase.list.query();
    expect(listed.map((k) => k.id)).toEqual([newId, oldId]);
    expect(listed[0]).toMatchObject({
      sourceType: "screenshot",
      sourceLabel: "新しい.png",
      dateRange: "2026/09/20",
      imageUrl: "https://example.com/dummy.png",
    });
    expect(listed[0]).not.toHaveProperty("content");

    await api.client.knowledgeBase.delete.mutate({ id: newId });
    expect((await api.client.knowledgeBase.list.query()).map((k) => k.id)).toEqual([oldId]);
  });

  it("uploadとchatとextractFromKnowledgeはForge未設定なら即エラーになる", async () => {
    await expect(
      api.client.knowledgeBase.upload.mutate({
        files: [{ name: "_chat.txt", base64: b64("hello"), mimeType: "text/plain" }],
      }),
    ).rejects.toThrow(/Forge API not configured/);
    await expect(
      api.client.knowledgeBase.chat.mutate({ message: "こんにちは", history: [] }),
    ).rejects.toThrow(/Forge API not configured/);
    await expect(
      api.client.knowledgeBase.extractFromKnowledge.mutate({ mode: "invoice_items" }),
    ).rejects.toThrow(/Forge API not configured/);
  });

  it("チャット会話の作成→一覧→削除（メッセージ連鎖削除）を保持する", async () => {
    const created = await api.client.knowledgeBase.createConversation.mutate({});
    expect(created.title).toBe("新しいチャット");
    const titled = await api.client.knowledgeBase.createConversation.mutate({ title: "0372の件" });
    expect(titled.title).toBe("0372の件");

    const listed = await api.client.knowledgeBase.listConversations.query();
    expect(listed.map((c) => c.id).sort()).toEqual([created.id, titled.id].sort());

    await db.query("INSERT INTO ai_chat_messages SET ?", {
      conversationId: created.id, role: "user", content: "質問です",
    });
    await api.client.knowledgeBase.deleteConversation.mutate({ id: created.id });
    expect(await rows("SELECT id FROM chat_conversations WHERE id = ?", [created.id])).toEqual([]);
    expect(await rows("SELECT id FROM ai_chat_messages WHERE conversationId = ?", [created.id])).toEqual([]);
  });

  it("チャット履歴の取得と消去はconversationId指定の有無で対象が変わる", async () => {
    const conv = await api.client.knowledgeBase.createConversation.mutate({});
    await db.query("INSERT INTO ai_chat_messages SET ?", {
      conversationId: conv.id, role: "user", content: "会話内1", createdAt: "2026-09-10 10:00:00",
    });
    await db.query("INSERT INTO ai_chat_messages SET ?", {
      conversationId: conv.id, role: "assistant", content: "会話内2", createdAt: "2026-09-10 10:01:00",
    });
    await db.query("INSERT INTO ai_chat_messages SET ?", {
      conversationId: null, role: "user", content: "会話外", createdAt: "2026-09-10 10:02:00",
    });

    const scoped = await api.client.knowledgeBase.getChatHistory.query({ conversationId: conv.id });
    expect(scoped.map((m) => m.content)).toEqual(["会話内1", "会話内2"]);

    const all = await api.client.knowledgeBase.getChatHistory.query();
    expect(all.map((m) => m.content)).toEqual(["会話内1", "会話内2", "会話外"]);

    await api.client.knowledgeBase.clearChatHistory.mutate({ conversationId: conv.id });
    expect((await api.client.knowledgeBase.getChatHistory.query()).map((m) => m.content)).toEqual(["会話外"]);

    await api.client.knowledgeBase.clearChatHistory.mutate();
    expect(await api.client.knowledgeBase.getChatHistory.query()).toEqual([]);
  });

  it("状態検知と最新番号は知識ベースが空なら案内文を返し、非空ならenv未設定エラーになる", async () => {
    expect(await api.client.knowledgeBase.detectStatusFromKnowledge.mutate()).toEqual({
      sent: [], paid: [], message: "知識ベースが空です。先にファイルをアップロードしてください。",
    });
    expect(await api.client.knowledgeBase.getLatestInvoiceNumber.mutate()).toEqual({
      invoiceNumber: null, nextNumber: null,
      message: "知識ベースが空です。先にファイルをアップロードしてください。",
    });

    await insertKnowledge();
    await expect(api.client.knowledgeBase.detectStatusFromKnowledge.mutate()).rejects.toThrow(
      /AI API not configured/,
    );
    await expect(api.client.knowledgeBase.getLatestInvoiceNumber.mutate()).rejects.toThrow(
      /AI API not configured/,
    );
  });
});
