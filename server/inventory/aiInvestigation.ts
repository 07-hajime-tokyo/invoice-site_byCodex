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

function makeFallbackReport(input: {
  question: string;
  evidence: EvidenceSection[];
  ebayOrders: EbayOrderSummary[];
}) {
  const orderQty = rowsTotal(input.evidence.find((s) => s.title === "取引データ")?.rows ?? [], "quantity");
  const purchaseQty = rowsTotal(input.evidence.find((s) => s.title === "入庫管理 発注")?.rows ?? [], "quantity");
  const stockQty = rowsTotal(input.evidence.find((s) => s.title === "在庫一覧")?.rows ?? [], "quantity");
  const deliveryQty = rowsTotal(input.evidence.find((s) => s.title === "出庫履歴")?.rows ?? [], "quantity");
  const fedexQty = rowsTotal(input.evidence.find((s) => s.title === "FedEx発送登録")?.rows ?? [], "quantity");
  const ebayNotes = input.ebayOrders.length
    ? input.ebayOrders.map((order) => `- ${order.orderId}: ${order.ok ? `${order.status?.orderFulfillmentStatus ?? "-"} / cancel=${order.status?.cancelState ?? "-"}` : order.error}`).join("\n")
    : "- eBay注文IDが見つからない、または対象データにOrderページがありません。";

  return `## 結論\nAI APIが未設定のため、DBとeBay APIの取得結果から自動サマリーを作成しました。\n\n## 数量サマリー\n| 項目 | 数量 |\n|---|---:|\n| 取引データ注文数 | ${orderQty} |\n| 入庫管理 発注数 | ${purchaseQty} |\n| サイト在庫数 | ${stockQty} |\n| 出庫履歴数 | ${deliveryQty} |\n| FedEx発送登録数 | ${fedexQty} |\n\n## eBay確認\n${ebayNotes}\n\n## 次に見るところ\n- 出庫履歴数とFedEx発送登録数が違う場合、FedEx発送登録漏れの可能性があります。\n- 取引データ注文数と出庫履歴数が違う場合、未出庫または表記ゆれ集計漏れの可能性があります。\n- サイト在庫数と手元在庫が違う場合、削除済み/取消済み/入庫漏れを確認してください。`;
}

async function generateAiReport(input: {
  question: string;
  identifiers: ReturnType<typeof extractIdentifiers>;
  evidence: EvidenceSection[];
  ebayOrders: EbayOrderSummary[];
}) {
  const context = JSON.stringify({
    question: input.question,
    identifiers: input.identifiers,
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
- 足りない情報がある場合は「確認が必要」と書く。
- 出力はMarkdown。

ユーザー質問:
${input.question}

根拠データ(JSON):
${context}`;

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
    if (matched.length > 0 || matcher.hasTarget) return matched.slice(0, 120);
    return rows.slice(0, recentCount);
  };

  const tradeEvidence = filterOrRecent(tradeRows, (row) => {
    const no = row.no == null ? "" : String(row.no);
    return invoiceSet.has(no) ||
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

  const purchaseEvidence = filterOrRecent(purchaseRows, (row) => {
    return identifiers.invoiceNos.some((no) => String(row.managementNo ?? "").startsWith(no) || String(row.purchaseNum ?? "").startsWith(no)) ||
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

  const inventoryEvidence = filterOrRecent(inventoryRows, (row) => {
    return identifiers.invoiceNos.some((no) => String(row.etc ?? "").startsWith(no)) ||
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
      const deleted = deletedIds.has(inventoryId) || cancelledKeys.has(`${inventoryId}:${title}`) || Boolean(item.deleted);
      deliveryEvidence.push({
        historyId: row.id,
        deliveryNo: row.deliveryNo,
        status: row.status,
        title,
        quantity: getItemQuantity(item),
        managementNo: getItemManagementNo(item),
        inventoryId: inventoryId || null,
        deleted,
        createdAt: row.createdAt ? String(row.createdAt) : "",
      });
    }
  }

  const fedexEvidence: EvidenceRow[] = [];
  for (const row of filterOrRecent(fedexRows, (shipment) => {
    const invoiceNo = invoiceNoFromDeliveryNo(shipment.deliveryNo);
    return invoiceSet.has(invoiceNo) ||
      matcher.matches(shipment.deliveryNo) ||
      matcher.matches(shipment.trackingNumber) ||
      matcher.matches(shipment.itemsJson) ||
      matcher.matches(shipment.sheetName);
  })) {
    const items = parseJsonArray(row.itemsJson);
    if (items.length === 0) {
      fedexEvidence.push({
        id: row.id,
        deliveryNo: row.deliveryNo,
        sheetName: row.sheetName,
        shippingDate: row.shippingDate,
        trackingNumber: row.trackingNumber,
        quantity: 0,
        spreadsheetStatus: row.spreadsheetStatus,
        spreadsheetError: row.spreadsheetError ?? "",
      });
      continue;
    }
    for (const item of items) {
      fedexEvidence.push({
        id: row.id,
        deliveryNo: row.deliveryNo,
        sheetName: row.sheetName,
        shippingDate: row.shippingDate,
        trackingNumber: row.trackingNumber,
        title: getItemTitle(item),
        quantity: getItemQuantity(item),
        spreadsheetStatus: row.spreadsheetStatus,
        spreadsheetError: row.spreadsheetError ?? "",
      });
    }
  }

  const orderIdsFromInventory = inventoryEvidence
    .map((row) => extractEbayOrderId(String(row.ebayOrderUrl ?? "")))
    .filter((value): value is string => Boolean(value));
  const ebayOrderIds = uniq([...identifiers.ebayOrderIds, ...orderIdsFromInventory]);
  const ebayOrders = includeEbay ? await fetchEbayOrders(ebayOrderIds) : [];

  const evidence: EvidenceSection[] = [
    { title: "取引データ", rows: tradeEvidence },
    { title: "入庫管理 発注", rows: purchaseEvidence },
    { title: "在庫一覧", rows: inventoryEvidence },
    { title: "出庫履歴", rows: deliveryEvidence },
    { title: "FedEx発送登録", rows: fedexEvidence },
  ];

  const answer = await generateAiReport({ question, identifiers, evidence, ebayOrders });
  return { identifiers, evidence, ebayOrders, answer };
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
