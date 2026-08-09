/**
 * WhatsApp会話履歴 — 取り込みテキストの解析と、Geminiによる日本語訳。
 *
 * 対応する入力フォーマット（どれも1行目がヘッダ、続く行は本文の折り返し）:
 *   1. `[13:32, 2026/7/25] Simon traut: 本文`   … WhatsApp Webのコピー / data-pre-plain-text
 *   2. `[2026/07/25, 13:32:05] Simon traut: 本文` … iOSのチャット書き出し
 *   3. `2026/07/25, 13:32 - Simon traut: 本文`  … Androidのチャット書き出し
 */
import { createHash } from "node:crypto";

export type ParsedMessage = {
  sender: string;
  sentAt: Date;
  body: string;
};

/** 送信者名がこれに一致したら自分（村上さん側）の発言として扱う */
const DEFAULT_OWNER_NAMES = ["自分", "you", "murakami", "村上", "hajime", "tokyo media koueki"];

/** 本文として取り込まない、WhatsAppが挿入するシステム行 */
const SYSTEM_LINE_PATTERNS = [
  /^‎?(messages and calls are end-to-end encrypted|メッセージと通話はエンドツーエンド暗号化)/i,
  /^‎?(this message was deleted|このメッセージは削除されました)/i,
  /^‎?(missed voice call|missed video call|不在着信)/i,
  /がユーザーネームを@.+に設定しました$/,
  /^‎?<(メディアなし|attached|添付ファイル)/i,
];

type HeaderMatch = { sentAt: Date; sender: string; rest: string };

function buildDate(y: number, mo: number, d: number, h: number, mi: number, s: number): Date | null {
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * `2026/7/25` `2026-07-25` `25/07/2026` を年月日に分解する。
 * 先頭が4桁なら y/m/d、末尾が4桁なら d/m/y（WhatsAppの欧州ロケール）とみなす。
 */
function parseDatePart(raw: string): { y: number; mo: number; d: number } | null {
  const nums = raw.split(/[/.\-]/).map((n) => parseInt(n, 10));
  if (nums.length !== 3 || nums.some((n) => Number.isNaN(n))) return null;
  if (raw.split(/[/.\-]/)[0].length === 4) return { y: nums[0], mo: nums[1], d: nums[2] };
  const y = nums[2] < 100 ? 2000 + nums[2] : nums[2];
  return { y, mo: nums[1], d: nums[0] };
}

function parseTimePart(raw: string): { h: number; mi: number; s: number } | null {
  const ampm = raw.match(/(AM|PM|午前|午後)/i)?.[1]?.toLowerCase();
  const nums = raw.replace(/(AM|PM|午前|午後)/i, "").trim().split(":").map((n) => parseInt(n, 10));
  if (nums.length < 2 || nums.some((n) => Number.isNaN(n))) return null;
  let h = nums[0];
  if (ampm === "pm" || ampm === "午後") h = h === 12 ? 12 : h + 12;
  if (ampm === "am" || ampm === "午前") h = h === 12 ? 0 : h;
  return { h, mi: nums[1], s: nums[2] ?? 0 };
}

/** ヘッダ行なら日時・送信者・本文の先頭を返す。そうでなければ null。 */
function matchHeader(line: string): HeaderMatch | null {
  // 不可視の方向制御文字を落としてから判定する（WhatsAppの書き出しに混ざる）
  const clean = line.replace(/[‎‏‪-‮]/g, "");

  // 形式1・2: 角括弧
  const bracket = clean.match(/^\[([^\]]+)\]\s*([^:]{1,120}?):\s?([\s\S]*)$/);
  // 形式3: ハイフン区切り
  const dash = clean.match(/^([\d]{1,4}[/.\-][\d]{1,2}[/.\-][\d]{1,4},\s*[\d]{1,2}:[\d]{2}(?::[\d]{2})?(?:\s*(?:AM|PM))?)\s+-\s+([^:]{1,120}?):\s?([\s\S]*)$/i);
  const m = bracket ?? dash;
  if (!m) return null;

  const [, stamp, sender, rest] = m;
  const parts = stamp.split(",").map((p) => p.trim());
  if (parts.length !== 2) return null;

  // 「/」を含むほうが日付。形式1は [時刻, 日付]、形式2/3は [日付, 時刻]。
  const dateRaw = parts.find((p) => /[/.\-]/.test(p) && /\d{1,4}[/.\-]\d{1,2}/.test(p));
  const timeRaw = parts.find((p) => p !== dateRaw);
  if (!dateRaw || !timeRaw) return null;

  const date = parseDatePart(dateRaw);
  const time = parseTimePart(timeRaw);
  if (!date || !time) return null;

  const sentAt = buildDate(date.y, date.mo, date.d, time.h, time.mi, time.s);
  if (!sentAt) return null;

  return { sentAt, sender: sender.trim().replace(/^~\s*/, ""), rest };
}

function isSystemLine(body: string): boolean {
  return SYSTEM_LINE_PATTERNS.some((re) => re.test(body.trim()));
}

/**
 * 取り込みテキストをメッセージ配列に分解する。
 * ヘッダに一致しない行は直前のメッセージの本文として連結する。
 */
export function parseWhatsAppExport(raw: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  let current: ParsedMessage | null = null;

  for (const line of raw.split(/\r?\n/)) {
    const header = matchHeader(line);
    if (header) {
      if (current) messages.push(current);
      current = { sender: header.sender, sentAt: header.sentAt, body: header.rest };
      continue;
    }
    if (current) current.body += `\n${line}`;
  }
  if (current) messages.push(current);

  return messages
    .map((m) => ({ ...m, body: m.body.replace(/[‎‏‪-‮]/g, "").trim() }))
    .filter((m) => m.body.length > 0 && !isSystemLine(m.body));
}

export function isOwnerSender(sender: string, ownerNames: string[] = []): boolean {
  const needle = sender.trim().toLowerCase();
  return [...DEFAULT_OWNER_NAMES, ...ownerNames.map((n) => n.toLowerCase())].some(
    (owner) => needle === owner || needle.includes(owner),
  );
}

export function makeDedupeKey(conversationName: string, sentAt: Date, body: string): string {
  return createHash("sha256")
    .update(`${conversationName}|${sentAt.toISOString()}|${body}`)
    .digest("hex")
    .slice(0, 32);
}

/** 日本語（かな・漢字）が主なら翻訳不要とみなす */
export function looksJapanese(text: string): boolean {
  const jp = text.match(/[぀-ヿ一-龯]/g)?.length ?? 0;
  const letters = text.match(/[A-Za-z぀-ヿ一-龯]/g)?.length ?? 0;
  if (letters === 0) return true; // 記号・数字だけなら訳す意味がない
  return jp / letters >= 0.5;
}

// ─── 翻訳 ─────────────────────────────────────────────────────────────────────

const TRANSLATION_PROMPT = `あなたは中古ゲーム機の輸出業者の通訳です。
海外バイヤーとのWhatsAppのやり取りを日本語に訳してください。

守ること:
- 入力はJSON配列。各要素は {"i": 通し番号, "t": 原文}。
- 出力も同じ長さのJSON配列で、各要素は {"i": 同じ通し番号, "ja": 日本語訳}。
- 意訳しすぎない。金額・数量・型番・日付・追跡番号・インボイス番号は原文のまま正確に残す。
- 商品名（3DS LL, New 2DS XL, PS Vita 1000 など）は英語表記のまま残す。
- 崩れた英語やタイプミスは、意味を補って自然な日本語にする。
- 元が日本語の要素は、そのまま返す。
- 前置きや説明は書かない。JSON配列だけを返す。`;

type TranslationInput = { id: number; text: string };

async function translateChunk(items: TranslationInput[], apiKey: string, model: string): Promise<Map<number, string>> {
  const payload = items.map((item, index) => ({ i: index, t: item.text }));
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${TRANSLATION_PROMPT}\n\n${JSON.stringify(payload)}` }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: { i: { type: "INTEGER" }, ja: { type: "STRING" } },
            required: ["i", "ja"],
          },
        },
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API error: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
  }

  const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "[]";
  const parsed = JSON.parse(text) as Array<{ i: number; ja: string }>;

  const out = new Map<number, string>();
  for (const row of parsed) {
    const source = items[row.i];
    if (source && typeof row.ja === "string" && row.ja.trim()) out.set(source.id, row.ja.trim());
  }
  return out;
}

/**
 * まとめて日本語訳する。1回のリクエストが大きくなりすぎないよう分割して投げる。
 * 失敗したチャンクは黙って飛ばす（部分的にでも訳が入るほうが使える）。
 */
export async function translateMessages(
  items: TranslationInput[],
  options: { chunkSize?: number } = {},
): Promise<{ translations: Map<number, string>; failedChunks: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が未設定です。翻訳を使うには環境変数を設定してください。");
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const chunkSize = options.chunkSize ?? 25;

  const translations = new Map<number, string>();
  let failedChunks = 0;

  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    try {
      const result = await translateChunk(chunk, apiKey, model);
      for (const [id, ja] of result) translations.set(id, ja);
    } catch (error) {
      failedChunks += 1;
      console.warn("[WhatsApp] translation chunk failed:", error instanceof Error ? error.message : error);
    }
  }

  return { translations, failedChunks };
}
