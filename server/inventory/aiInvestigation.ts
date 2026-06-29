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
  return Number(new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
  }).format(new Date()));
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
  const ymd = text.match(/(20\d{2})[\/.\-年](\d{1,2})[\/.\-月](\d{1,2})/);
  if (ymd) return toIsoDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));

  const md = text.match(/(?:^|[^\d])(\d{1,2})[\/.月](\d{1,2})(?:日)?/);
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
  const matches = Array.from(text.matchAll(/(?:(20\d{2})[\/.\-年])?(\d{1,2})[\/.月](\d{1,2})(?:日)?/g));
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

function extractIdentifiers(question: string) {
  const invoiceNos = uniq([
    ...Array.from(question.matchAll(/(?:No\.?|NO\.?|番号|インボイス|invoice)\s*[:：#]?\s*(\d{3,4})/gi)).map((m) => m[1]),
    ...Array.from(question.matchAll(/\b(\d{3,4})\b/g)).map((m) => m[1]),
  ]).filter(Boolean);

  const trackingNumbers = uniq(
    Array.from(question.matchAll(/\b\d{10,22}\b/g)).map((m) => m[0]),
  );

  const ebayOrderIds = uniq([
    ...Array.from(question.matchAll(/\b\d{2}-\d{5}-\d{5}\b/g)).map((m) => m[0]),
    ...Array.from(question.matchAll(/(?:orderid|orderId|order_id)=([^&\s]+)/g)).map((m) => decodeURIComponent(m[1] ?? "")),
  ]).filter(Boolean);

  const managementTerms = uniq(
    Array.from(question.matchAll(/[A-Za-z0-9ァ-ヶー一-龥]+[_-][A-Za-z0-9ァ-ヶー一-龥_\/&-]+/g))
      .map((m) => m[0])
      .filter((value) => value.length >= 4),
  );

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
    item.productName ??
    item.productNameJa ??
    item.productNameEn ??
    "",
  );
}

function getItemQuantity(item: Record<string, unknown>) {
  return parseNumber(item.quantity ?? item.qty ?? item.stockQty ?? 1) || 1;
}

function getItemManagementNo(item: Record<string, unknown>) {
  return String(item.etc ?? item.managementNo ?? item.kanriNo ?? "").split(",")[0]?.trim() ?? "";
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
  const ebayNotes = input.ebayOrders.length
    ? input.ebayOrders.map((order) => `- ${order.orderId}: ${order.ok ? `${order.status?.orderFulfillmentStatus ?? "-"} / cancel=${order.status?.cancelState ?? "-"}` : order.error}`).join("\n")
    : "- eBay注文IDが見つからない、または対象データにOrderページがありません。";
  const scopeLine = input.dateRange ? `対象期間: ${input.dateRange.label}\n\n` : "";
  const fedexResult = comparisonRows.length === 0
    ? "対象条件に合う出庫履歴が見つかりませんでした。出庫日または検索条件を確認してください。"
    : missingRows.length === 0
      ? "直取対象の出庫履歴にはFedEx追跡番号が付いています。"
    : missingRows.map((row) => `- ${row.deliveryNo}: 出庫${row.deliveryQuantity} / FedEx登録${row.fedexQuantity} / 不足${row.missingQuantity} / 状態:${row.status}（${row.sampleProducts ?? ""}）`).join("\n");

  return `## 結論\n${scopeLine}${fedexResult}\n\n## 数量サマリー\n| 項目 | 数量 |\n|---|---:|\n| 取引データ注文数 | ${orderQty} |\n| 入庫管理 発注数 | ${purchaseQty} |\n| サイト在庫数 | ${stockQty} |\n| 出庫履歴数 | ${deliveryQty} |\n| FedEx発送登録数 | ${fedexQty} |\n\n## eBay確認\n${ebayNotes}\n\n## 次に見るところ\n- 「追跡番号なし」または「一部不足」の出庫Noがあれば、出庫履歴からFedEx発送登録を追加してください。\n- 判定対象は直取のみです。管理番号が ebay / E始まり / シャフト / 在庫 のものは除外しています。\n- 出庫履歴に削除済みの商品がある場合、その分は照合から除外しています。\n- eBay確認は注文状態の参考情報で、FedEx発送登録漏れの判定はサイト内FedEx発送登録データを使っています。`;
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

async function collectInvestigationContext(question: string, includeEbay: boolean) {
  const db = await getDb();
  if (!db) throw new Error("DB not available");

  const identifiers = extractIdentifiers(question);
  const dateRange = extractDateRange(question);
  const hasDateFilter = Boolean(dateRange);
  const hasSpecificTarget = identifiers.invoiceNos.length > 0 ||
    identifiers.trackingNumbers.length > 0 ||
    identifiers.ebayOrderIds.length > 0 ||
    identifiers.managementTerms.length > 0;
  const fedexLeakQuestion = isFedexLeakQuestion(question);
  const matcher = buildMatchers(question, identifiers);
  const [tradeRows, purchaseRows, inventoryRows, deliveryRows, fedexRows] = await Promise.all([
    db.select().from(tradeRecords).orderBy(desc(tradeRecords.updatedAt)),
    db.select().from(localPurchases).orderBy(desc(localPurchases.updatedAt)),
    db.select().from(localInventories).orderBy(desc(localInventories.updatedAt)),
    db.select().from(deliveryHistories).orderBy(desc(deliveryHistories.createdAt)),
    db.select().from(fedexShipments).orderBy(desc(fedexShipments.createdAt)),
  ]);

  const invoiceSet = new Set(identifiers.invoiceNos);
  const filterOrRecent = <T>(rows: T[], predicate: (row: T) => boolean, recentCount = 30) => {
    const matched = rows.filter(predicate);
    if (matched.length > 0 || hasSpecificTarget || hasDateFilter) return matched.slice(0, 120);
    if (fedexLeakQuestion) return rows.slice(0, 200);
    return rows.slice(0, recentCount);
  };

  const tradeEvidence = filterOrRecent(tradeRows, (row) => {
    const no = row.no == null ? "" : String(row.no);
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
    return identifiers.invoiceNos.some((no) => String(row.managementNo ?? "").startsWith(no) || String(row.purchaseNum ?? "").startsWith(no)) ||
      isDateInRange(row.purchaseDate ?? row.receivedDate ?? row.updatedAt, dateRange) ||
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
  }));

  const inventoryEvidence = fedexLeakQuestion ? [] : filterOrRecent(inventoryRows, (row) => {
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
    return invoiceSet.has(invoiceNo) ||
      isDateInRange(getDeliveryHistoryDate(history), dateRange) ||
      matcher.matches(history.deliveryNo) ||
      matcher.matches(history.itemsJson);
  })) {
    const cancelled = parseJsonArray(row.cancelledItemsJson);
    const deletedIds = new Set(parseJsonList(row.deletedInventoryIdsJson).map((item) => {
      if (item && typeof item === "object") {
        const obj = item as Record<string, unknown>;
        return String(obj.inventoryId ?? obj.id ?? obj.zaicoId ?? "");
      }
      return String(item ?? "");
    }).filter(Boolean));
    const cancelledKeys = new Set(cancelled.map((item) => `${item.inventoryId ?? item.id ?? item.zaicoId ?? ""}:${getItemTitle(item)}`));
    for (const item of parseJsonArray(row.itemsJson)) {
      const inventoryId = String(item.inventoryId ?? item.inventory_id ?? item.id ?? item.zaicoId ?? "");
      const title = getItemTitle(item);
      const managementNo = getItemManagementNo(item);
      const deleted = deletedIds.has(inventoryId) || cancelledKeys.has(`${inventoryId}:${title}`) || Boolean(item.deleted);
      const directTradeTarget = isDirectTradeFedexTarget(row.deliveryNo, managementNo);
      deliveryEvidence.push({
        historyId: row.id,
        deliveryNo: row.deliveryNo,
        status: row.status,
        title,
        quantity: getItemQuantity(item),
        managementNo,
        inventoryId: inventoryId || null,
        deleted,
        directTradeTarget,
        fedexExcluded: !directTradeTarget,
        deliveryDate: getDeliveryHistoryDate(row) ?? "",
        createdAt: row.createdAt ? String(row.createdAt) : "",
      });
    }
  }

  const selectedHistoryIds = new Set(
    deliveryEvidence
      .map((row) => Number(row.historyId))
      .filter((value) => Number.isFinite(value)),
  );
  const selectedDeliveryNos = new Set(
    deliveryEvidence
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

  const fedexComparisonEvidence = summarizeFedexRegistration(deliveryEvidence, fedexEvidence);

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
        { title: "出庫履歴", rows: deliveryEvidence },
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

  const answer = await generateAiReport({ question, identifiers, dateRange, evidence, ebayOrders });
  return { identifiers: { ...identifiers, dateRange }, evidence, ebayOrders, answer };
}

export const aiInvestigationRouter = router({
  investigate: protectedProcedure
    .input(z.object({
      question: z.string().min(2).max(2000),
      includeEbay: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      return collectInvestigationContext(input.question, input.includeEbay);
    }),
});
