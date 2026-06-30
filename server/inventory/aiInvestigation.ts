import { z } from "zod";
import { desc } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  deliveryHistories,
  fedexShipments,
  localInventories,
  localPurchases,
  tradeRecords,
} from "../../drizzle/schema";
import { getDb } from "./db";

type EvidenceRow = Record<string, string | number | boolean | null>;

type EvidenceSection = {
  title: string;
  rows: EvidenceRow[];
};

type InvestigationDateRange = {
  startDate: string | null;
  endDate: string | null;
  label: string;
};

type InvestigationConversationTurn = {
  question: string;
  answer?: string | null;
};

type EbayOrderSummary = {
  orderId: string;
  ok: boolean;
  status?: {
    orderFulfillmentStatus?: string | null;
    orderPaymentStatus?: string | null;
    cancelState?: string | null;
    refundStatus?: string | null;
  };
  buyer?: string | null;
  items?: Array<{
    title: string;
    quantity: number;
    lineItemFulfillmentStatus?: string | null;
  }>;
  error?: string;
};

function uniq<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function compactText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s　・･_\-ー,、。()（）[\]【】]/g, "");
}

function parseJsonArray(value: string | null | undefined): Array<Record<string, unknown>> {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function parseJsonList(value: string | null | undefined): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseNumber(value: unknown) {
  const num = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(num) ? num : 0;
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function toIsoDate(year: number, month: number, day: number) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function currentJstYear() {
  const formatted = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date());
  const year = formatted.match(/20\d{2}/)?.[0];
  return year ? Number(year) : new Date().getFullYear();
}

function normalizeDateValue(value: unknown): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  }

  const text = String(value).normalize("NFKC").trim();
  const ymd = text.match(/(20\d{2})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/);
  if (ymd) return toIsoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const md = text.match(/(?:^|[^\d])(\d{1,2})[\/月](\d{1,2})(?:日)?/);
  if (md) return toIsoDate(currentJstYear(), Number(md[1]), Number(md[2]));

  return null;
}

function dateFromDeliveryNo(deliveryNo: unknown): string | null {
  const text = String(deliveryNo ?? "").normalize("NFKC");
  const match = text.match(/20\d{6}/);
  if (!match) return null;
  const raw = match[0];
  return toIsoDate(Number(raw.slice(0, 4)), Number(raw.slice(4, 6)), Number(raw.slice(6, 8)));
}

function getDeliveryHistoryDate(row: { deliveryNo?: string | null; createdAt?: unknown }) {
  return dateFromDeliveryNo(row.deliveryNo) ?? normalizeDateValue(row.createdAt);
}

function extractDateRange(question: string): InvestigationDateRange | null {
  const text = question.normalize("NFKC");
  const matches = Array.from(text.matchAll(/(?:(20\d{2})[\/\-年])?(\d{1,2})[\/月](\d{1,2})(?:日)?/g));
  if (matches.length === 0) return null;

  const toDate = (match: RegExpMatchArray) => {
    const year = match[1] ? Number(match[1]) : currentJstYear();
    return toIsoDate(year, Number(match[2]), Number(match[3]));
  };

  const firstDate = toDate(matches[0]);
  if (!firstDate) return null;
  const secondDate = matches[1] ? toDate(matches[1]) : null;
  const hasAfterWord = /以降|以後|から|〜|～|~/.test(text);
  const hasUntilWord = /以前|まで/.test(text);

  if (secondDate) {
    const startDate = firstDate <= secondDate ? firstDate : secondDate;
    const endDate = firstDate <= secondDate ? secondDate : firstDate;
    return { startDate, endDate, label: `${startDate}〜${endDate}` };
  }
  if (hasUntilWord && !hasAfterWord) {
    return { startDate: null, endDate: firstDate, label: `${firstDate}以前` };
  }
  if (hasAfterWord) {
    return { startDate: firstDate, endDate: null, label: `${firstDate}以降` };
  }
  return { startDate: firstDate, endDate: firstDate, label: firstDate };
}

function isDateInRange(value: unknown, range: InvestigationDateRange | null) {
  if (!range) return false;
  const date = normalizeDateValue(value);
  if (!date) return false;
  if (range.startDate && date < range.startDate) return false;
  if (range.endDate && date > range.endDate) return false;
  return true;
}

function normalizeManagementTerm(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/(?:で)?(?:調べて|確認して|見て|検索して|教えて).*$/g, "")
    .replace(/[でをはがにの]$/g, "")
    .trim();
}

function extractIdentifiers(question: string) {
  const rawManagementTerms = Array.from(question.matchAll(/[A-Za-z0-9ァ-ヶー一-龥]+[_-][A-Za-z0-9ァ-ヶー一-龥_\/&-]+/g))
    .map((m) => m[0]);
  const managementTerms = uniq(
    rawManagementTerms
      .map(normalizeManagementTerm)
      .filter((value) => value.length >= 4),
  );
  const questionWithoutManagementTerms = rawManagementTerms.reduce(
    (text, term) => text.replaceAll(term, " "),
    question,
  );

  const invoiceNos = uniq([
    ...Array.from(questionWithoutManagementTerms.matchAll(/(?:No\.?|NO\.?|番号|インボイス|invoice)\s*[:：#]?\s*(\d{3,4})/gi)).map((m) => m[1]),
    ...Array.from(questionWithoutManagementTerms.matchAll(/\b(\d{3,4})\b/g)).map((m) => m[1]),
  ]).filter((value) => Boolean(value) && !/^20\d{2}$/.test(value));

  const trackingNumbers = uniq(
    Array.from(question.matchAll(/\b\d{10,22}\b/g)).map((m) => m[0]),
  );

  const ebayOrderIds = uniq([
    ...Array.from(question.matchAll(/\b\d{2}-\d{5}-\d{5}\b/g)).map((m) => m[0]),
    ...Array.from(question.matchAll(/(?:orderid|orderId|order_id)=([^&\s]+)/g)).map((m) => decodeURIComponent(m[1] ?? "")),
  ]).filter(Boolean);

  const productTerms = uniq(
    question
      .split(/[\s　,、。:：\n\r]+/)
      .map((value) => value.trim())
      .filter((value) => value.length >= 3 && !/^\d+$/.test(value))
      .slice(0, 12),
  );

  return { invoiceNos, trackingNumbers, ebayOrderIds, managementTerms, productTerms };
}

function invoiceNoFromDeliveryNo(deliveryNo: string | null | undefined) {
  return String(deliveryNo ?? "").match(/^(\d+)/)?.[1] ?? "";
}

function getItemTitle(item: Record<string, unknown>) {
  return String(
    item.title ??
    item.name ??
    item.itemName ??
    item.item_name ??
    item.productName ??
    item.product_name ??
    item.productNameJa ??
    item.product_name_ja ??
    item.nameJa ??
    item.productNameEn ??
    item.product_name_en ??
    item.nameEn ??
    "",
  );
}

function getItemQuantity(item: Record<string, unknown>) {
  return parseNumber(item.quantity ?? item.qty ?? item.stockQty ?? 1) || 1;
}

function getItemManagementNo(item: Record<string, unknown>) {
  return String(item.etc ?? item.managementNo ?? item.kanriNo ?? "").split(",")[0]?.trim() ?? "";
}

function getItemInventoryId(item: Record<string, unknown>) {
  return String(item.inventoryId ?? item.inventory_id ?? item.id ?? item.zaicoId ?? "");
}

function isFedexExcludedManagementNo(managementNo: string) {
  const raw = managementNo.normalize("NFKC").trim();
  if (!raw) return false;
  return /^(ebay|e\d|在庫|シャフト|shaft)/i.test(raw) || /ebay/i.test(raw);
}

function isDirectTradeFedexTarget(deliveryNo: unknown, managementNo: string) {
  const raw = managementNo.normalize("NFKC").trim();
  if (isFedexExcludedManagementNo(raw)) return false;
  if (/^\d{3,4}(?:$|[_-])/.test(raw)) return true;
  // 管理番号が空でも、直取の出庫Noは数字始まりで登録されるため対象に残す。
  return !raw && /^\d{3,4}(?:$|[_-])/.test(String(deliveryNo ?? ""));
}

function matchesNeedle(value: unknown, needles: string[], compactNeedles: string[]) {
  const raw = String(value ?? "");
  if (!raw) return false;
  if (needles.some((needle) => raw.toLowerCase().includes(needle.toLowerCase()))) return true;
  const compact = compactText(raw);
  return compactNeedles.some((needle) => needle && compact.includes(needle));
}

function buildMatchers(question: string, identifiers: ReturnType<typeof extractIdentifiers>) {
  const needles = uniq([
    ...identifiers.invoiceNos,
    ...identifiers.trackingNumbers,
    ...identifiers.ebayOrderIds,
    ...identifiers.managementTerms,
    ...identifiers.productTerms,
  ]).filter(Boolean);
  const compactNeedles = needles.map(compactText).filter(Boolean);
  const hasTarget = needles.length > 0;
  return {
    hasTarget,
    needles,
    compactNeedles,
    matches(value: unknown) {
      return matchesNeedle(value, needles, compactNeedles);
    },
    questionCompact: compactText(question),
  };
}

const PRODUCT_STOP_WORDS = new Set([
  "現状",
  "現在",
  "今",
  "いま",
  "何個",
  "何台",
  "何件",
  "いくつ",
  "発注",
  "発注済み",
  "在庫",
  "仕入",
  "仕入れ",
  "注文",
  "商品",
  "状況",
  "対象",
  "調査",
  "調査対象",
  "条件",
  "知りたいこと",
  "出庫",
  "出庫履歴",
  "履歴",
  "だけ",
  "のみ",
  "です",
  "ですが",
  "ですか",
  "ますか",
  "ありますか",
  "あります",
  "ある",
  "ない",
  "教えて",
  "確認",
  "表示",
  "表示して",
  "一覧",
  "リスト",
  "にした",
  "した",
  "登録",
  "登録した",
  "を",
  "に",
  "は",
  "が",
  "で",
  "の",
  "も",
  "と",
  "してください",
]);

function normalizeProductSearchText(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(?:degrees?|deg\.?|°|度)/g, "")
    .replace(/[^0-9a-zぁ-んァ-ヶ一-龠々ー.]+/gi, "");
}

function productTokenVariants(token: string) {
  const normalized = normalizeProductSearchText(token);
  const variants = [normalized];
  const aliasMap: Record<string, string[]> = {
    "テーラーメイド": ["taylormade", "tailormade"],
    "taylormade": ["テーラーメイド"],
    "tailormade": ["テーラーメイド", "taylormade"],
    "キャロウェイ": ["callaway"],
    "callaway": ["キャロウェイ"],
    "タイトリスト": ["titleist"],
    "titleist": ["タイトリスト"],
    "ピン": ["ping"],
    "ping": ["ピン"],
    "ダンロップ": ["dunlop"],
    "dunlop": ["ダンロップ"],
    "スリクソン": ["srixon"],
    "srixon": ["スリクソン"],
  };
  return uniq([...variants, ...(aliasMap[normalized] ?? [])])
    .map(normalizeProductSearchText)
    .filter(Boolean);
}

function stripProductTokenNoise(value: string) {
  return value
    .replace(/(?:がありますか|ありますか|あります|ありません|ですけど|ですが|ですか|です|ますか|ください)$/g, "")
    .replace(/[はをがにやの]$/g, "");
}

function cleanupProductCandidateText(value: string, identifiers: ReturnType<typeof extractIdentifiers>) {
  let candidate = value;
  for (const id of [
    ...identifiers.invoiceNos,
    ...identifiers.trackingNumbers,
    ...identifiers.ebayOrderIds,
    ...identifiers.managementTerms,
  ]) {
    candidate = candidate.replaceAll(id, " ");
  }

  return candidate
    .replace(/20\d{2}[\/.\-年]\d{1,2}[\/.\-月]\d{1,2}(?:日)?/g, " ")
    .replace(/(?:^|[^\d])\d{1,2}[\/月]\d{1,2}(?:日)?/g, " ")
    .replace(/(?:調査対象|知りたいこと|商品名|対象商品|検索語|条件)\s*[:：]/g, " ")
    .replace(/(?:現状|現在|今|いま|何個|何台|何件|いくつ|発注済みにした|発注済み登録|発注済み|発注|入庫済みにした|入庫済み|在庫|仕入れ?|注文|商品|状況|出庫履歴|出庫|履歴|表示して|表示|一覧|リスト|登録した|登録|にした|した|ありますか|あります|ありません|ある|ない|教えて|確認|してください|ですけど|ですが|ですか|です|ますか|ください)/g, " ")
    .replace(/[？?]/g, " ")
    .trim();
}

function extractProductCandidateText(question: string, identifiers: ReturnType<typeof extractIdentifiers>) {
  const text = question.normalize("NFKC");
  const explicitProduct = text.match(/(?:^|[\n\r])\s*(?:商品名|対象商品|型番|検索語)\s*[:：]\s*([^\n\r]+)/i)?.[1];
  if (explicitProduct) return cleanupProductCandidateText(explicitProduct, identifiers);

  const quotedProduct = text.match(/[「『"]([^」』"\n\r]{2,80})[」』"](?:の商品|について|に関して|だけ|のみ|を|は|が)?/)?.[1];
  let candidate = quotedProduct ?? text;
  const targetMatch = candidate.match(/^(.+?)(?:で|について|に関して|の|は|が)(?:現状|現在|今|いま|何個|何台|いくつ|発注|在庫|出庫|出庫履歴|あります|ある|ない|状況)/);
  candidate = targetMatch?.[1] ?? candidate;
  candidate = candidate.split(/(?:なんですが|なのですが|ですが|ですけど|だけど|について|に関して|を対象に|の商品だけ|の商品のみ)/)[0] ?? candidate;
  candidate = candidate.split(/[\n\r]/)[0] ?? candidate;
  return cleanupProductCandidateText(candidate, identifiers);
}

function buildProductQuery(question: string, identifiers: ReturnType<typeof extractIdentifiers>) {
  const candidate = extractProductCandidateText(question, identifiers);
  const tokens = uniq(
    candidate
      .split(/[\s　,、。・･_\/()（）[\]【】]+/)
      .map((token) => token.trim())
      .map((token) => token.replace(/[-ー]+$/g, ""))
      .map(stripProductTokenNoise)
      .map(normalizeProductSearchText)
      .filter((token) => token.length >= 2 && !PRODUCT_STOP_WORDS.has(token) && !/^\d{4}$/.test(token)),
  ).slice(0, 8);
  const alphaNumericModelTokens = tokens.filter((token) => /[a-z]/i.test(token) && /\d/.test(token));
  const numericSpecTokens = new Set(tokens.filter((token) => /^\d+(?:\.\d+)?$/.test(token)));
  const nonSpecTokens = tokens.filter((token) => !numericSpecTokens.has(token));
  const requiredTokens = (alphaNumericModelTokens.length > 0
    ? uniq([...nonSpecTokens, ...alphaNumericModelTokens])
    : tokens
  ).slice(0, 5);
  const brandOrNameTokens = nonSpecTokens.filter((token) => !alphaNumericModelTokens.includes(token));
  const modelTokens = alphaNumericModelTokens;
  const specTokens = Array.from(numericSpecTokens);
  const compactQuestion = compactText(question);
  const hasProductIntent = /在庫|発注|仕入|注文|商品|型番|何個|何台|何件|あります|ある|現状|現在|状況|出庫|出庫履歴|履歴/.test(question.normalize("NFKC"));
  const hasFocus = hasProductIntent && requiredTokens.length > 0 && !compactQuestion.includes("fedex");
  const tokenMatches = (haystack: string, haystackNoDots: string, token: string) =>
    productTokenVariants(token).some((variant) => {
      if (haystack.includes(variant)) return true;
      if (variant.includes(".")) return haystackNoDots.includes(variant.replace(/\./g, ""));
      return false;
    });

  return {
    label: candidate || requiredTokens.join(" "),
    tokens,
    requiredTokens,
    modelTokens,
    brandOrNameTokens,
    specTokens,
    hasFocus,
    matches(...values: unknown[]) {
      if (!hasFocus) return false;
      const haystack = normalizeProductSearchText(values.filter((value) => value != null).join(" "));
      const haystackNoDots = haystack.replace(/\./g, "");
      const strictMatch = requiredTokens.every((token) => tokenMatches(haystack, haystackNoDots, token));
      if (strictMatch) return true;

      // 型番がある商品は、ブランド表記ゆれやロフト角の有無で落ちやすい。
      // 例: 「テーラーメイド M4 9.5°」と「TaylorMade M4 9.5」
      if (modelTokens.length > 0) {
        const modelMatch = modelTokens.some((token) => tokenMatches(haystack, haystackNoDots, token));
        const specMatch = specTokens.some((token) => tokenMatches(haystack, haystackNoDots, token));
        const brandMatch = brandOrNameTokens.length === 0 ||
          brandOrNameTokens.some((token) => tokenMatches(haystack, haystackNoDots, token));
        return modelMatch && (brandMatch || specMatch || (brandOrNameTokens.length === 0 && specTokens.length === 0));
      }

      return false;
    },
  };
}

function hasExplicitInvestigationTarget(question: string) {
  const text = question.normalize("NFKC");
  return /(?:No\.?|NO\.?|invoice|orderid|orderId|order_id|商品名|対象商品|型番|管理番号|管理No|出庫No|出庫番号|追跡番号)\s*[:：#]?/i.test(text) ||
    /\b\d{2}-\d{5}-\d{5}\b/.test(text) ||
    /\b\d{10,22}\b/.test(text) ||
    /[A-Za-z0-9ァ-ヶー一-龥]+[_-][A-Za-z0-9ァ-ヶー一-龥_\/&-]+/.test(text);
}

function isLikelyFollowUpQuestion(question: string) {
  const text = question.normalize("NFKC").trim();
  if (!text) return false;
  return /^(それ|これ|この|さっき|先ほど|前回|では|じゃあ|あと|追加で|もう一度|出庫履歴にも|発注にも|在庫にも|管理番号)/.test(text) ||
    /(もなかった|もない|でも調べて|で調べて|も確認|再確認|もう一回|詳しく|なぜ|なんで|どういうこと)/.test(text);
}

function buildContextualQuestion(question: string, conversationContext: InvestigationConversationTurn[] = []) {
  const trimmed = question.trim();
  if (isFedexLeakQuestion(trimmed)) return trimmed;
  const previous = conversationContext.find((turn) => turn.question.trim().length > 0);
  if (!previous) return trimmed;
  if (hasExplicitInvestigationTarget(trimmed)) return trimmed;
  if (!isLikelyFollowUpQuestion(trimmed)) return trimmed;

  const previousAnswer = String(previous.answer ?? "").trim().slice(0, 1200);
  return [
    `前回の質問: ${previous.question.trim()}`,
    previousAnswer ? `前回の結論: ${previousAnswer}` : "",
    `今回の追加質問: ${trimmed}`,
  ].filter(Boolean).join("\n");
}

function extractEbayOrderId(value: string | null | undefined) {
  const text = String(value ?? "");
  if (!text) return null;
  const direct = text.match(/\b\d{2}-\d{5}-\d{5}\b/)?.[0];
  if (direct) return direct;
  try {
    const url = new URL(text);
    for (const key of ["orderid", "orderId", "order_id"]) {
      const param = url.searchParams.get(key);
      if (param) return param;
    }
  } catch {
    const param = text.match(/(?:orderid|orderId|order_id)=([^&\s]+)/)?.[1];
    if (param) return decodeURIComponent(param);
  }
  return null;
}

function getEbayEndpointBase() {
  return process.env.EBAY_ENV?.toLowerCase() === "sandbox"
    ? "https://api.sandbox.ebay.com"
    : "https://api.ebay.com";
}

async function getEbayAccessToken() {
  const staticToken = process.env.EBAY_ACCESS_TOKEN?.trim();
  if (staticToken) return { token: staticToken };

  const clientId = (process.env.EBAY_CLIENT_ID || process.env.EBAY_APP_ID)?.trim();
  const clientSecret = (process.env.EBAY_CLIENT_SECRET || process.env.EBAY_CERT_ID)?.trim();
  const refreshToken = process.env.EBAY_REFRESH_TOKEN?.trim();
  if (!clientId || !clientSecret || !refreshToken) {
    return {
      error: "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET / EBAY_REFRESH_TOKEN が未設定です",
    };
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: process.env.EBAY_SCOPES?.trim() || "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  });

  const res = await fetch(`${getEbayEndpointBase()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { error: `eBay OAuth error: ${res.status}${detail ? ` ${detail.slice(0, 180)}` : ""}` };
  }
  const data = await res.json() as { access_token?: string };
  if (!data.access_token) return { error: "eBay OAuth response に access_token がありません" };
  return { token: data.access_token };
}

async function fetchEbayOrders(orderIds: string[]): Promise<EbayOrderSummary[]> {
  const uniqueOrderIds = uniq(orderIds).slice(0, 8);
  if (uniqueOrderIds.length === 0) return [];
  const auth = await getEbayAccessToken();
  if (!auth.token) {
    return uniqueOrderIds.map((orderId) => ({ orderId, ok: false, error: auth.error ?? "eBay API未設定" }));
  }

  const results: EbayOrderSummary[] = [];
  for (const orderId of uniqueOrderIds) {
    try {
      const res = await fetch(`${getEbayEndpointBase()}/sell/fulfillment/v1/order/${encodeURIComponent(orderId)}`, {
        headers: {
          Authorization: `Bearer ${auth.token}`,
          Accept: "application/json",
        },
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        results.push({ orderId, ok: false, error: `eBay getOrder error: ${res.status}${detail ? ` ${detail.slice(0, 180)}` : ""}` });
        continue;
      }
      const order = await res.json() as Record<string, unknown>;
      const lineItems = Array.isArray(order.lineItems) ? order.lineItems as Array<Record<string, unknown>> : [];
      const buyer = order.buyer && typeof order.buyer === "object"
        ? String((order.buyer as Record<string, unknown>).username ?? "")
        : null;
      const cancelStatus = order.cancelStatus && typeof order.cancelStatus === "object"
        ? order.cancelStatus as Record<string, unknown>
        : null;
      const paymentSummary = order.paymentSummary && typeof order.paymentSummary === "object"
        ? order.paymentSummary as Record<string, unknown>
        : null;
      results.push({
        orderId,
        ok: true,
        status: {
          orderFulfillmentStatus: String(order.orderFulfillmentStatus ?? "") || null,
          orderPaymentStatus: String(paymentSummary?.paymentStatus ?? order.orderPaymentStatus ?? "") || null,
          cancelState: String(cancelStatus?.cancelState ?? "") || null,
          refundStatus: String(order.refundStatus ?? "") || null,
        },
        buyer,
        items: lineItems.map((item) => ({
          title: String(item.title ?? item.legacyItemId ?? ""),
          quantity: parseNumber(item.quantity),
          lineItemFulfillmentStatus: String(item.lineItemFulfillmentStatus ?? "") || null,
        })),
      });
    } catch (error) {
      results.push({ orderId, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

function rowsTotal(rows: EvidenceRow[], key = "quantity") {
  return rows.reduce((sum, row) => sum + parseNumber(row[key]), 0);
}

function formatEbayOrderStatus(value: string | null | undefined) {
  const status = String(value ?? "").trim();
  if (!status) return "-";
  const labels: Record<string, string> = {
    FULFILLED: "発送済み",
    IN_PROGRESS: "処理中",
    NOT_STARTED: "未発送",
    PAID: "支払い済み",
    PENDING: "保留",
    NOT_PAID: "未払い",
    NONE: "なし",
    NONE_REQUESTED: "キャンセル申請なし",
    NOT_CANCELED: "キャンセルなし",
    CANCELED: "キャンセル済み",
    CANCELLED: "キャンセル済み",
    CANCEL_REQUESTED: "キャンセル申請中",
    CANCEL_REJECTED: "キャンセル却下",
    REFUNDED: "返金済み",
    PARTIALLY_REFUNDED: "一部返金",
  };
  return labels[status] ? `${labels[status]} (${status})` : status;
}

function formatEbayOrderNotes(orders: EbayOrderSummary[]) {
  if (orders.length === 0) {
    return "- OrderページURLまたはOrder IDが見つからないため、eBay APIは照会できませんでした。";
  }
  return orders.map((order) => {
    if (!order.ok) return `- ${order.orderId}: ${order.error}`;
    const itemText = order.items?.length
      ? ` / 商品: ${order.items.map((item) => `${item.title} x${item.quantity}`).join("、")}`
      : "";
    return [
      `- ${order.orderId}:`,
      `発送=${formatEbayOrderStatus(order.status?.orderFulfillmentStatus)}`,
      `支払い=${formatEbayOrderStatus(order.status?.orderPaymentStatus)}`,
      `キャンセル=${formatEbayOrderStatus(order.status?.cancelState)}`,
      `返金=${formatEbayOrderStatus(order.status?.refundStatus)}`,
      itemText,
    ].join(" ");
  }).join("\n");
}

function summarizeFedexRegistration(deliveryRows: EvidenceRow[], fedexRows: EvidenceRow[]) {
  const deliveryByKey = new Map<string, {
    deliveryNo: string;
    quantity: number;
    titles: Set<string>;
    managementNos: Set<string>;
    date: string;
  }>();
  const fedexByKey = new Map<string, { quantity: number; trackingNumbers: Set<string>; date: string }>();

  for (const row of deliveryRows) {
    if (row.deleted === true) continue;
    if (row.directTradeTarget !== true) continue;
    const deliveryNo = String(row.deliveryNo ?? "").trim();
    if (!deliveryNo) continue;
    const historyId = String(row.historyId ?? "").trim();
    const key = historyId ? `history:${historyId}` : `delivery:${deliveryNo}`;
    const existing = deliveryByKey.get(key) ?? {
      deliveryNo,
      quantity: 0,
      titles: new Set<string>(),
      managementNos: new Set<string>(),
      date: "",
    };
    existing.quantity += parseNumber(row.quantity);
    const title = String(row.title ?? "").trim();
    if (title) existing.titles.add(title);
    const managementNo = String(row.managementNo ?? "").trim();
    if (managementNo) existing.managementNos.add(managementNo);
    existing.date ||= normalizeDateValue(row.deliveryDate ?? row.createdAt) ?? "";
    deliveryByKey.set(key, existing);
  }

  for (const row of fedexRows) {
    const deliveryNo = String(row.deliveryNo ?? "").trim();
    if (!deliveryNo) continue;
    const historyId = String(row.historyId ?? "").trim();
    const key = historyId ? `history:${historyId}` : `delivery:${deliveryNo}`;
    const existing = fedexByKey.get(key) ?? { quantity: 0, trackingNumbers: new Set<string>(), date: "" };
    existing.quantity += parseNumber(row.quantity);
    const trackingNumber = String(row.trackingNumber ?? "").trim();
    if (trackingNumber) existing.trackingNumbers.add(trackingNumber);
    existing.date ||= normalizeDateValue(row.shippingDate ?? row.createdAt) ?? "";
    fedexByKey.set(key, existing);
  }

  return Array.from(deliveryByKey.entries()).map(([key, delivery]) => {
    const fedex = fedexByKey.get(key);
    const fedexQty = fedex?.quantity ?? 0;
    const trackingNumbers = fedex ? Array.from(fedex.trackingNumbers).join(", ") : "";
    const missingQuantity = Math.max(0, delivery.quantity - fedexQty);
    return {
      deliveryNo: delivery.deliveryNo,
      deliveryDate: delivery.date,
      deliveryQuantity: delivery.quantity,
      fedexQuantity: fedexQty,
      missingQuantity,
      trackingNumbers,
      status: trackingNumbers && missingQuantity === 0 ? "登録済み" : fedexQty > 0 ? "一部不足" : "追跡番号なし",
      sampleProducts: Array.from(delivery.titles).slice(0, 3).join(" / "),
      managementNos: Array.from(delivery.managementNos).slice(0, 5).join(" / "),
    };
  }).sort((a, b) => {
    if (a.status === b.status) return a.deliveryNo.localeCompare(b.deliveryNo);
    if (a.status === "追跡番号なし") return -1;
    if (b.status === "追跡番号なし") return 1;
    if (a.status === "一部不足") return -1;
    if (b.status === "一部不足") return 1;
    return 0;
  });
}

function makeFallbackReport(input: {
  question: string;
  dateRange: InvestigationDateRange | null;
  evidence: EvidenceSection[];
  ebayOrders: EbayOrderSummary[];
}) {
  const orderQty = rowsTotal(input.evidence.find((s) => s.title === "取引データ")?.rows ?? [], "quantity");
  const purchaseQty = rowsTotal(input.evidence.find((s) => s.title === "入庫管理 発注")?.rows ?? [], "quantity");
  const stockQty = rowsTotal(input.evidence.find((s) => s.title === "在庫一覧")?.rows ?? [], "quantity");
  const deliveryQty = rowsTotal(input.evidence.find((s) => s.title === "出庫履歴")?.rows ?? [], "quantity");
  const fedexQty = rowsTotal(input.evidence.find((s) => s.title === "FedEx発送登録")?.rows ?? [], "quantity");
  const comparisonRows = input.evidence.find((s) => s.title === "FedEx発送登録照合")?.rows ?? [];
  const missingRows = comparisonRows.filter((row) => parseNumber(row.missingQuantity) > 0 || row.status !== "登録済み");
  const ebayNotes = formatEbayOrderNotes(input.ebayOrders);
  const scopeLine = input.dateRange ? `対象期間: ${input.dateRange.label}\n\n` : "";
  const fedexResult = comparisonRows.length === 0
    ? "対象条件に合う出庫履歴が見つかりませんでした。出庫日または検索条件を確認してください。"
    : missingRows.length === 0
      ? "直取対象の出庫履歴にはFedEx追跡番号が付いています。"
    : missingRows.map((row) => `- ${row.deliveryNo}: 出庫${row.deliveryQuantity} / FedEx登録${row.fedexQuantity} / 不足${row.missingQuantity} / 状態:${row.status}（${row.sampleProducts ?? ""}）`).join("\n");

  return `## 結論\n${scopeLine}${fedexResult}\n\n## 数量サマリー\n| 項目 | 数量 |\n|---|---:|\n| 取引データ注文数 | ${orderQty} |\n| 入庫管理 発注数 | ${purchaseQty} |\n| サイト在庫数 | ${stockQty} |\n| 出庫履歴数 | ${deliveryQty} |\n| FedEx発送登録数 | ${fedexQty} |\n\n## eBay確認\n${ebayNotes}\n\n## 次に見るところ\n- 「追跡番号なし」または「一部不足」の出庫Noがあれば、出庫履歴からFedEx発送登録を追加してください。\n- 判定対象は直取のみです。管理番号が ebay / E始まり / シャフト / 在庫 のものは除外しています。\n- 出庫履歴に削除済みの商品がある場合、その分は照合から除外しています。\n- eBay確認は注文状態の参考情報で、FedEx発送登録漏れの判定はサイト内FedEx発送登録データを使っています。`;
}

function isInventoryStatusQuestion(question: string) {
  const text = question.normalize("NFKC");
  return /在庫|発注|仕入|注文|何個|何台|何件|あります|ある|現状|現在|状況|出庫|出庫履歴|履歴/.test(text);
}

function getPurchaseStatusIntent(question: string): "ordered" | "purchased" | "shipped" | null {
  const text = question.normalize("NFKC");
  if (/入庫済み|入庫した|入庫登録/.test(text)) return "purchased";
  if (/発送済み|発送した/.test(text)) return "shipped";
  if (/発注済み|発注した|発注登録|発注にした/.test(text)) return "ordered";
  return null;
}

function isPurchaseActionDateQuestion(question: string) {
  return /にした|登録した|登録|作成|追加|変更/.test(question.normalize("NFKC"));
}

function purchaseStatusMatches(row: { status?: string | null; trackingNumber?: string | null }, status: "ordered" | "purchased" | "shipped" | null) {
  if (!status) return true;
  if (status === "purchased") return row.status === "purchased";
  if (status === "shipped") return row.status !== "purchased" && Boolean(row.trackingNumber);
  return row.status !== "purchased" && !row.trackingNumber;
}

function purchaseDateMatches(
  row: { purchaseDate?: unknown; receivedDate?: unknown; createdAt?: unknown; updatedAt?: unknown },
  range: InvestigationDateRange | null,
  actionDateMode: boolean,
) {
  if (!range) return true;
  if (actionDateMode) return isDateInRange(row.createdAt, range) || isDateInRange(row.updatedAt, range);
  return isDateInRange(row.purchaseDate, range) || isDateInRange(row.receivedDate, range) ||
    isDateInRange(row.createdAt, range) || isDateInRange(row.updatedAt, range);
}

function makePurchaseListReport(input: {
  question: string;
  dateRange: InvestigationDateRange | null;
  statusIntent: "ordered" | "purchased" | "shipped" | null;
  evidence: EvidenceSection[];
}) {
  const purchaseRows = input.evidence.find((section) => section.title === "入庫管理 発注")?.rows ?? [];
  const label = input.statusIntent === "purchased"
    ? "入庫済み"
    : input.statusIntent === "shipped"
      ? "発送済み"
      : input.statusIntent === "ordered"
        ? "発注済み"
        : "入庫管理";
  const qty = rowsTotal(purchaseRows, "quantity");
  const period = input.dateRange ? `対象日: ${input.dateRange.label}\n` : "";
  const sample = purchaseRows.slice(0, 12)
    .map((row) => `- ${row.managementNo || row.purchaseNum || row.id}: ${row.title} ×${row.quantity}`)
    .join("\n");

  if (purchaseRows.length === 0) {
    return `## 結論
${period}${label}の条件に合う商品は見つかりませんでした。

## 現在の状況
| 項目 | 数量 |
|---|---:|
| 該当件数 | 0 |
| 該当数量 | 0 |

## 詳細
- 「商品名」ではなく、日付・ステータス条件として検索しました。
- 下の根拠データも0件です。`;
  }

  return `## 結論
${period}${label}の条件に合う商品が ${purchaseRows.length}件、合計 ${qty}個 見つかりました。

## 現在の状況
| 項目 | 数量 |
|---|---:|
| 該当件数 | ${purchaseRows.length} |
| 該当数量 | ${qty} |

## 該当商品
${sample}${purchaseRows.length > 12 ? `\n- ほか ${purchaseRows.length - 12}件` : ""}

## 詳細
- 「発注済みにした商品」は商品名検索ではなく、入庫管理のステータスと日付で検索しています。
- 下の「入庫管理 発注」の根拠データで詳細を確認できます。`;
}

function makeProductStatusReport(input: {
  question: string;
  productLabel: string;
  evidence: EvidenceSection[];
  ebayOrders: EbayOrderSummary[];
}) {
  const tradeRows = input.evidence.find((section) => section.title === "取引データ")?.rows ?? [];
  const purchaseRows = input.evidence.find((section) => section.title === "入庫管理 発注")?.rows ?? [];
  const inventoryRows = input.evidence.find((section) => section.title === "在庫一覧")?.rows ?? [];
  const deliveryRows = input.evidence.find((section) => section.title === "出庫履歴")?.rows ?? [];
  const orderedRows = purchaseRows.filter((row) => String(row.status ?? "") !== "purchased");
  const purchasedRows = purchaseRows.filter((row) => String(row.status ?? "") === "purchased");
  const activeStockRows = inventoryRows.filter((row) => {
    const isDeleted = row.isDeleted === 1 || row.isDeleted === true;
    return !isDeleted && parseNumber(row.quantity) > 0;
  });
  const activeDeliveryRows = deliveryRows.filter((row) => row.deleted !== true);
  const deletedDeliveryRows = deliveryRows.filter((row) => row.deleted === true);

  const tradeQty = rowsTotal(tradeRows, "quantity");
  const orderedQty = rowsTotal(orderedRows, "quantity");
  const purchasedQty = rowsTotal(purchasedRows, "quantity");
  const stockQty = rowsTotal(activeStockRows, "quantity");
  const deliveryQty = rowsTotal(activeDeliveryRows, "quantity");
  const deletedDeliveryQty = rowsTotal(deletedDeliveryRows, "quantity");
  const totalDeliveryQty = deliveryQty + deletedDeliveryQty;
  const productLabel = input.productLabel || "対象商品";

  const conclusionLines = [
    stockQty > 0
      ? `現時点で「${productLabel}」の在庫は ${stockQty} 個あります。`
      : `現時点で「${productLabel}」の在庫はありません。`,
    orderedQty > 0
      ? `入庫管理の発注済みは ${orderedQty} 個あります。`
      : "入庫管理の発注済みデータも見つかりませんでした。",
  ];
  if (tradeQty > 0) conclusionLines.push(`取引データ上の注文数は ${tradeQty} 個です。`);
  if (deliveryQty > 0) conclusionLines.push(`過去の出庫履歴には ${deliveryQty} 個分の記録があります。`);
  if (deliveryQty === 0 && deletedDeliveryQty > 0) {
    conclusionLines.push(`出庫履歴には削除済みとして ${deletedDeliveryQty} 個分の記録があります。`);
  } else if (deletedDeliveryQty > 0) {
    conclusionLines.push(`別途、削除済みの出庫履歴が ${deletedDeliveryQty} 個分あります。`);
  }
  if (purchasedQty > 0) conclusionLines.push(`入庫済み扱いの発注データは ${purchasedQty} 個分あります。`);

  const sampleManagementNos = uniq([
    ...orderedRows,
    ...activeStockRows,
    ...deliveryRows,
  ].map((row) => String(row.managementNo ?? row.deliveryNo ?? "").trim()).filter(Boolean)).slice(0, 8);
  const ebayNotes = formatEbayOrderNotes(input.ebayOrders);

  return `## 結論
${conclusionLines.join("\n")}

## eBay確認
${ebayNotes}

## 現在の状況
| 項目 | 数量 |
|---|---:|
| 在庫一覧の現在庫 | ${stockQty} |
| 入庫管理の発注済み | ${orderedQty} |
| 入庫済み扱いの発注 | ${purchasedQty} |
| 取引データの注文数 | ${tradeQty} |
| 出庫済み（有効） | ${deliveryQty} |
| 出庫履歴（削除済み） | ${deletedDeliveryQty} |
| 出庫履歴合計 | ${totalDeliveryQty} |

## 詳細
### 原因候補
- 在庫一覧は、削除済みではなく数量が1以上のデータだけを現在庫として数えています。
- 入庫管理の発注済みは、status が purchased ではない発注データだけを数えています。
- 出庫済み（有効）は、出庫履歴の削除済み商品を除外して数えています。
- 削除済みとして残っている出庫履歴は、現在の有効な出庫数とは別に表示しています。
- 該当管理番号・出庫No: ${sampleManagementNos.length ? sampleManagementNos.join(" / ") : "該当なし"}

### 次にするべき行動
- 下の根拠データで、入庫管理 発注・在庫一覧・出庫履歴の該当行を確認してください。
- 管理番号または出庫Noをクリックすると該当ページに移動できます。`;
}

function isFedexLeakQuestion(question: string) {
  const compact = compactText(question);
  return compact.includes("fedex") && (
    compact.includes("漏れ") ||
    compact.includes("未登録") ||
    compact.includes("追跡番号") ||
    compact.includes("発送登録")
  );
}

async function generateAiReport(input: {
  question: string;
  identifiers: ReturnType<typeof extractIdentifiers>;
  dateRange: InvestigationDateRange | null;
  evidence: EvidenceSection[];
  ebayOrders: EbayOrderSummary[];
}) {
  const context = JSON.stringify({
    question: input.question,
    identifiers: input.identifiers,
    dateRange: input.dateRange,
    evidence: input.evidence.map((section) => ({
      title: section.title,
      rows: section.rows.slice(0, 80),
      omitted: Math.max(0, section.rows.length - 80),
    })),
    ebayOrders: input.ebayOrders,
  }, null, 2);

  const prompt = `あなたは在庫・発送・eBay注文の調査担当です。
以下のユーザー質問と根拠データだけを使って、原因候補と次にするべき行動を日本語で簡潔に出してください。

必ず守ること:
- 推測だけで断定しない。
- 根拠データにある数字を優先する。
- eBay APIの結果がある場合は、キャンセル/返品/発送状態を明示する。
- FedEx発送登録漏れは、FedEx公式APIではなくサイト内のFedEx発送登録データで判定する。
- 「FedEx発送登録照合」セクションがある場合は、status / missingQuantity / deliveryNo を最優先で結論に使う。
- FedEx発送登録漏れの判定対象は直取のみ。管理番号が ebay / E始まり / シャフト / 在庫 のものは対象外。
- 出庫履歴に追跡番号が付いていない直取の出庫Noは「追跡番号なし」として漏れ扱いにする。
- 足りない情報がある場合は「確認が必要」と書く。
- 出力はMarkdown。

ユーザー質問:
${input.question}

根拠データ(JSON):
${context}`;

  if (isFedexLeakQuestion(input.question)) {
    return makeFallbackReport(input);
  }

  const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
  const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
  if (forgeUrl && forgeKey) {
    const res = await fetch(`${forgeUrl.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${forgeKey}`,
      },
      body: JSON.stringify({
        model: process.env.AI_INVESTIGATION_MODEL || "gpt-4o",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 1200,
      }),
    });
    if (!res.ok) {
      return `${makeFallbackReport(input)}\n\n---\n\nAI API error: ${res.status}`;
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() || makeFallbackReport(input);
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return makeFallbackReport(input);
  const geminiModel = process.env.AI_INVESTIGATION_GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": geminiKey,
    },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1200,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
  });
  if (!res.ok) {
    return `${makeFallbackReport(input)}\n\n---\n\nGemini API error: ${res.status}`;
  }
  const data = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() || makeFallbackReport(input);
}

async function collectInvestigationContext(
  question: string,
  includeEbay: boolean,
  conversationContext: InvestigationConversationTurn[] = [],
) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const investigationQuestion = buildContextualQuestion(question, conversationContext);
  const identifiers = extractIdentifiers(investigationQuestion);
  const dateRange = extractDateRange(investigationQuestion);
  const fedexLeakQuestion = isFedexLeakQuestion(investigationQuestion);
  const purchaseStatusIntent = getPurchaseStatusIntent(investigationQuestion);
  const purchaseActionDateMode = isPurchaseActionDateQuestion(investigationQuestion);
  const productQuery = buildProductQuery(investigationQuestion, identifiers);
  const hasProductTarget = productQuery.hasFocus && !fedexLeakQuestion;
  const hasDateFilter = Boolean(dateRange);
  const hasSpecificTarget = identifiers.invoiceNos.length > 0 ||
    identifiers.trackingNumbers.length > 0 ||
    identifiers.ebayOrderIds.length > 0 ||
    identifiers.managementTerms.length > 0 ||
    hasProductTarget;
  const matcher = buildMatchers(investigationQuestion, identifiers);
  const managementNeedles = identifiers.managementTerms.filter(Boolean);
  const managementCompactNeedles = managementNeedles.map(compactText).filter(Boolean);
  const hasManagementTerms = managementNeedles.length > 0;
  const matchesManagementTarget = (...values: unknown[]) =>
    !hasManagementTerms || values.some((value) => matchesNeedle(value, managementNeedles, managementCompactNeedles));
  const [tradeRows, purchaseRows, inventoryRows, deliveryRows, fedexRows] = await Promise.all([
    db.select().from(tradeRecords).orderBy(desc(tradeRecords.updatedAt)),
    db.select().from(localPurchases).orderBy(desc(localPurchases.updatedAt)),
    db.select().from(localInventories).orderBy(desc(localInventories.updatedAt)),
    db.select().from(deliveryHistories).orderBy(desc(deliveryHistories.createdAt)),
    db.select().from(fedexShipments).orderBy(desc(fedexShipments.createdAt)),
  ]);

  const invoiceSet = new Set(identifiers.invoiceNos);
  const matchesDeliveryTarget = (history: typeof deliveryRows[number]) => {
    const invoiceNo = invoiceNoFromDeliveryNo(history.deliveryNo);
    return invoiceSet.has(invoiceNo) ||
      matcher.matches(history.deliveryNo) ||
      matcher.matches(history.itemsJson);
  };
  const filterOrRecent = <T>(rows: T[], predicate: (row: T) => boolean, recentCount = 30) => {
    const matched = rows.filter(predicate);
    if (matched.length > 0 || hasSpecificTarget || hasDateFilter) return matched.slice(0, 120);
    if (fedexLeakQuestion) return rows.slice(0, 200);
    return rows.slice(0, recentCount);
  };

  const tradeEvidence = filterOrRecent(tradeRows, (row) => {
    const no = row.no == null ? "" : String(row.no);
    if (hasProductTarget) {
      const invoiceMatches = invoiceSet.size === 0 || invoiceSet.has(no);
      const dateMatches = !dateRange || isDateInRange(row.paymentDate ?? row.updatedAt, dateRange);
      return invoiceMatches && dateMatches && productQuery.matches(row.productName) &&
        matchesManagementTarget(row.productName, row.no);
    }
    return invoiceSet.has(no) ||
      isDateInRange(row.paymentDate ?? row.updatedAt, dateRange) ||
      matcher.matches(row.productName) ||
      matcher.matches(row.partner) ||
      matcher.matches(row.paymentDate);
  }).map((row) => ({
    id: row.id,
    no: row.no,
    partner: row.partner ?? "",
    productName: row.productName ?? "",
    quantity: parseNumber(row.quantity),
    unitPrice: parseNumber(row.unitPrice),
    currency: row.currency ?? "",
    status: row.status ?? "",
    paymentDate: row.paymentDate ?? "",
  }));

  const purchaseEvidence = fedexLeakQuestion ? [] : filterOrRecent(purchaseRows, (row) => {
    if (purchaseStatusIntent && !hasProductTarget) {
      return purchaseStatusMatches(row, purchaseStatusIntent) &&
        purchaseDateMatches(row, dateRange, purchaseActionDateMode) &&
        matchesManagementTarget(row.managementNo, row.purchaseNum, row.itemsJson, row.title);
    }
    if (hasProductTarget) {
      const invoiceMatches = identifiers.invoiceNos.length === 0 ||
        identifiers.invoiceNos.some((no) => String(row.managementNo ?? "").startsWith(no) || String(row.purchaseNum ?? "").startsWith(no));
      const dateMatches = purchaseDateMatches(row, dateRange, purchaseActionDateMode);
      const managementMatches = matchesManagementTarget(row.managementNo, row.purchaseNum, row.itemsJson, row.title);
      const productMatches = productQuery.matches(row.title, row.itemsJson, row.managementNo, row.purchaseNum);
      return invoiceMatches && dateMatches && managementMatches && productMatches;
    }
    return identifiers.invoiceNos.some((no) => String(row.managementNo ?? "").startsWith(no) || String(row.purchaseNum ?? "").startsWith(no)) ||
      purchaseDateMatches(row, dateRange, purchaseActionDateMode) ||
      matcher.matches(row.managementNo) ||
      matcher.matches(row.title) ||
      matcher.matches(row.itemsJson) ||
      matcher.matches(row.trackingNumber) ||
      matcher.matches(row.supplierName);
  }).map((row) => ({
    id: row.id,
    purchaseNum: row.purchaseNum ?? "",
    status: row.status,
    managementNo: row.managementNo ?? "",
    title: row.title ?? "",
    quantity: row.quantity,
    unitPrice: row.unitPrice == null ? null : parseNumber(row.unitPrice),
    purchaseDate: row.purchaseDate ?? "",
    receivedDate: row.receivedDate ?? "",
    trackingNumber: row.trackingNumber ?? "",
    supplierName: row.supplierName ?? "",
    createdAt: row.createdAt ? String(row.createdAt) : "",
    updatedAt: row.updatedAt ? String(row.updatedAt) : "",
  }));

  const inventoryEvidence = fedexLeakQuestion ? [] : filterOrRecent(inventoryRows, (row) => {
    if (hasProductTarget) {
      const invoiceMatches = identifiers.invoiceNos.length === 0 ||
        identifiers.invoiceNos.some((no) => String(row.etc ?? "").startsWith(no));
      const dateMatches = !dateRange || isDateInRange(row.updatedAt, dateRange);
      const managementMatches = matchesManagementTarget(row.etc, row.title);
      const productMatches = productQuery.matches(row.title, row.etc);
      return invoiceMatches && dateMatches && managementMatches && productMatches;
    }
    return identifiers.invoiceNos.some((no) => String(row.etc ?? "").startsWith(no)) ||
      isDateInRange(row.updatedAt, dateRange) ||
      matcher.matches(row.etc) ||
      matcher.matches(row.title) ||
      matcher.matches(row.supplierName) ||
      matcher.matches(row.ebayOrderUrl) ||
      matcher.matches(row.ebayListingUrl);
  }).map((row) => ({
    id: row.id,
    zaicoId: row.zaicoId ?? null,
    managementNo: String(row.etc ?? "").split(",")[0]?.trim() ?? "",
    title: row.title,
    quantity: row.quantity,
    unitPrice: row.unitPrice == null ? null : parseNumber(row.unitPrice),
    supplierName: row.supplierName ?? "",
    ebayListingUrl: row.ebayListingUrl ?? "",
    ebayOrderUrl: row.ebayOrderUrl ?? "",
    ebayOrderStatus: row.ebayOrderStatus ?? "normal",
    isDeleted: row.isDeleted,
  }));

  const deliveryEvidence: EvidenceRow[] = [];
  for (const row of filterOrRecent(deliveryRows, (history) => {
    const invoiceNo = invoiceNoFromDeliveryNo(history.deliveryNo);
    const dateMatches = isDateInRange(getDeliveryHistoryDate(history), dateRange);
    const deliveryItems = parseJsonArray(history.itemsJson);
    const productMatches = hasProductTarget
      ? productQuery.matches(history.itemsJson) ||
        deliveryItems.some((item) => productQuery.matches(getItemTitle(item), getItemManagementNo(item), JSON.stringify(item)))
      : false;
    const managementMatches = matchesManagementTarget(
      history.deliveryNo,
      history.itemsJson,
      ...deliveryItems.flatMap((item) => [getItemTitle(item), getItemManagementNo(item)]),
    );
    if (fedexLeakQuestion && hasDateFilter) {
      return dateMatches && (!hasSpecificTarget || matchesDeliveryTarget(history));
    }
    if (hasProductTarget) {
      const invoiceMatches = invoiceSet.size === 0 || invoiceSet.has(invoiceNo);
      const dateOk = !dateRange || dateMatches;
      return invoiceMatches && dateOk && managementMatches && productMatches;
    }
    return invoiceSet.has(invoiceNo) ||
      dateMatches ||
      matcher.matches(history.deliveryNo) ||
      matcher.matches(history.itemsJson);
  })) {
    const cancelled = parseJsonArray(row.cancelledItemsJson);
    const cancelledQtyByInventoryId = new Map<string, number>();
    for (const item of cancelled) {
      const inventoryId = getItemInventoryId(item);
      if (!inventoryId) continue;
      cancelledQtyByInventoryId.set(inventoryId, (cancelledQtyByInventoryId.get(inventoryId) ?? 0) + getItemQuantity(item));
    }
    const deletedIds = new Set(parseJsonList(row.deletedInventoryIdsJson).map((item) => {
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        return String(obj.inventoryId ?? obj.id ?? obj.zaicoId ?? "");
      }
      return String(item ?? "");
    }).filter(Boolean));
    for (const item of parseJsonArray(row.itemsJson)) {
      const inventoryId = getItemInventoryId(item);
      const title = getItemTitle(item);
      const managementNo = getItemManagementNo(item);
      const managementMatches = matchesManagementTarget(row.deliveryNo, title, managementNo);
      if (!managementMatches) continue;
      const productMatches = productQuery.matches(title, managementNo, JSON.stringify(item));
      if (hasProductTarget && !productMatches) continue;
      const itemQuantity = getItemQuantity(item);
      const cancelledQuantity = inventoryId
        ? Math.min(itemQuantity, cancelledQtyByInventoryId.get(inventoryId) ?? 0)
        : 0;
      const itemDeleted = deletedIds.has(inventoryId) || Boolean(item.deleted);
      const directTradeTarget = isDirectTradeFedexTarget(row.deliveryNo, managementNo);
      const pushEvidence = (quantity: number, deleted: boolean) => deliveryEvidence.push({
        historyId: row.id,
        deliveryNo: row.deliveryNo,
        status: row.status,
        title,
        quantity,
        managementNo,
        inventoryId: inventoryId || null,
        deleted,
        directTradeTarget,
        fedexExcluded: !directTradeTarget,
        deliveryDate: getDeliveryHistoryDate(row) ?? "",
        createdAt: row.createdAt ? String(row.createdAt) : "",
      });

      if (itemDeleted) {
        pushEvidence(itemQuantity, true);
        continue;
      }

      const activeQuantity = Math.max(0, itemQuantity - cancelledQuantity);
      if (activeQuantity > 0) pushEvidence(activeQuantity, false);
      if (cancelledQuantity > 0) pushEvidence(cancelledQuantity, true);
    }
  }
  const scopedDeliveryEvidence = fedexLeakQuestion
    ? deliveryEvidence.filter((row) => row.directTradeTarget === true)
    : deliveryEvidence;

  const selectedHistoryIds = new Set(
    scopedDeliveryEvidence
      .map((row) => Number(row.historyId))
      .filter((value) => Number.isFinite(value)),
  );
  const selectedDeliveryNos = new Set(
    scopedDeliveryEvidence
      .map((row) => String(row.deliveryNo ?? "").trim())
      .filter(Boolean),
  );
  const fedexEvidence: EvidenceRow[] = [];
  for (const row of filterOrRecent(fedexRows, (shipment) => {
    const invoiceNo = invoiceNoFromDeliveryNo(shipment.deliveryNo);
    const deliveryNo = String(shipment.deliveryNo ?? "").trim();
    const historyId = Number(shipment.historyId);
    const selectedDelivery = (Number.isFinite(historyId) && selectedHistoryIds.has(historyId)) ||
      selectedDeliveryNos.has(deliveryNo);
    if (fedexLeakQuestion) return selectedDelivery;
    if (hasProductTarget) {
      return selectedDelivery || productQuery.matches(shipment.itemsJson);
    }
    return invoiceSet.has(invoiceNo) ||
      selectedDelivery ||
      isDateInRange(shipment.shippingDate, dateRange) ||
      isDateInRange(getDeliveryHistoryDate(shipment), dateRange) ||
      matcher.matches(shipment.deliveryNo) ||
      matcher.matches(shipment.trackingNumber) ||
      matcher.matches(shipment.itemsJson) ||
      matcher.matches(shipment.sheetName);
  })) {
    const items = parseJsonArray(row.itemsJson);
    if (items.length === 0) {
      fedexEvidence.push({
        id: row.id,
        historyId: row.historyId ?? null,
        deliveryNo: row.deliveryNo,
        sheetName: row.sheetName,
        shippingDate: row.shippingDate,
        trackingNumber: row.trackingNumber,
        quantity: 0,
        spreadsheetStatus: row.spreadsheetStatus,
        spreadsheetError: row.spreadsheetError ?? "",
        createdAt: row.createdAt ? String(row.createdAt) : "",
      });
      continue;
    }
    for (const item of items) {
      if (hasProductTarget && !productQuery.matches(getItemTitle(item))) continue;
      if (!matchesManagementTarget(row.deliveryNo, getItemTitle(item), getItemManagementNo(item))) continue;
      fedexEvidence.push({
        id: row.id,
        historyId: row.historyId ?? null,
        deliveryNo: row.deliveryNo,
        sheetName: row.sheetName,
        shippingDate: row.shippingDate,
        trackingNumber: row.trackingNumber,
        title: getItemTitle(item),
        quantity: getItemQuantity(item),
        spreadsheetStatus: row.spreadsheetStatus,
        spreadsheetError: row.spreadsheetError ?? "",
        createdAt: row.createdAt ? String(row.createdAt) : "",
      });
    }
  }

  const fedexComparisonEvidence = summarizeFedexRegistration(scopedDeliveryEvidence, fedexEvidence);

  const orderIdsFromInventory = fedexLeakQuestion ? [] : inventoryEvidence
    .map((row) => extractEbayOrderId(String(row.ebayOrderUrl ?? "")))
    .filter((value): value is string => Boolean(value));
  const ebayOrderIds = uniq([...identifiers.ebayOrderIds, ...orderIdsFromInventory]);
  const ebayOrders = includeEbay && !fedexLeakQuestion ? await fetchEbayOrders(ebayOrderIds) : [];

  const scopeEvidence = dateRange
    ? [{ title: "調査条件", rows: [{ dateRange: dateRange.label, startDate: dateRange.startDate, endDate: dateRange.endDate }] }]
    : [];
  const evidence: EvidenceSection[] = fedexLeakQuestion
    ? [
        ...scopeEvidence,
        { title: "出庫履歴", rows: scopedDeliveryEvidence },
        { title: "FedEx発送登録", rows: fedexEvidence },
        { title: "FedEx発送登録照合", rows: fedexComparisonEvidence },
      ]
    : [
        ...scopeEvidence,
        { title: "取引データ", rows: tradeEvidence },
        { title: "入庫管理 発注", rows: purchaseEvidence },
        { title: "在庫一覧", rows: inventoryEvidence },
        { title: "出庫履歴", rows: deliveryEvidence },
        { title: "FedEx発送登録", rows: fedexEvidence },
        { title: "FedEx発送登録照合", rows: fedexComparisonEvidence },
      ];

  const answer = purchaseStatusIntent && !hasProductTarget
    ? makePurchaseListReport({ question: investigationQuestion, dateRange, statusIntent: purchaseStatusIntent, evidence })
    : hasProductTarget && isInventoryStatusQuestion(investigationQuestion)
      ? makeProductStatusReport({ question: investigationQuestion, productLabel: productQuery.label, evidence, ebayOrders })
      : await generateAiReport({ question: investigationQuestion, identifiers, dateRange, evidence, ebayOrders });
  return { identifiers: { ...identifiers, dateRange }, evidence, ebayOrders, answer };
}

export const aiInvestigationRouter = router({
  investigate: protectedProcedure
    .input(z.object({
      question: z.string().min(2).max(2000),
      includeEbay: z.boolean().default(true),
      conversationContext: z.array(z.object({
        question: z.string().min(1).max(2000),
        answer: z.string().max(6000).optional(),
      })).max(5).default([]),
    }))
    .mutation(async ({ input }) => {
      return collectInvestigationContext(input.question, input.includeEbay, input.conversationContext);
    }),
});
