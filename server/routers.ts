import { invoiceClientsRouter } from "./invoices/invoiceClientsRouter";
import { invoicesRouter } from "./invoices/invoicesRouter";
import { invoiceSettingsRouter } from "./invoices/invoiceSettingsRouter";
import { systemRouter } from "./_core/systemRouter";
import { router } from "./_core/trpc";
import { authGateRouter } from "./authGateRouter";
import { authRouter } from "./authRouter";
import { quoteProxyRouter } from "./quoteProxyRouter";
import { inventoryRouter } from "./inventory/routers";
import { whatsappHistoryRouter } from "./whatsappHistoryRouter";
import { whatsappChatsRouter } from "./whatsappChatsRouter";
import { knowledgeBaseRouter } from "./knowledgeBaseRouter";
import { tradeRouter } from "./tradeRouter";
import { shipmentRouter } from "./shipmentRouter";

/** WhatsApp会話履歴：既定で表示する期間（日） */
const WHATSAPP_RECENT_DAYS = 14;
/** WhatsApp会話履歴：「過去の会話を確認」1回ぶんの遡り幅（月） */
const WHATSAPP_EXPAND_MONTHS = 3;
/** WhatsApp会話履歴：期間内が少なくても、最低これだけは遡って出す */
const WHATSAPP_MIN_MESSAGES = 20;

const SPREADSHEET_ID = "1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw";
const SHEET_NAME = "全体";
const TRADE_VIEW_SPREADSHEET_ID = "133cDct4krrsJDeXpO9l0fIrd3-ZYDc39u6-JpQvcxv4";
const TRADE_VIEW_DEFAULT_SHEET_NAME = "独発送管理";
const TRADE_VIEW_SHEET_NAME_KEYWORD = "発送管理";
const TRADE_SHEET_WRITE_BACK_ENABLED = false;

// 不可視文字（ゼロ幅スペース、WORD JOINERなど）を除去するヘルパー
function sanitizeText(str: string | null | undefined): string | null {
  if (str == null) return null;
  return str.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').trim() || null;
}

const quoteProxyProcedure = publicProcedure.use(({ ctx, next }) => {
  const expected = process.env.INVOICE_SITE_PROXY_KEY;
  const provided = ctx.req.header("x-invoice-site-proxy-key");
  const allowLocalWithoutKey =
    process.env.NODE_ENV === "development" && process.env.LOCAL_AUTH_BYPASS !== "false";

  if (!expected && allowLocalWithoutKey) return next();
  if (!expected || provided !== expected) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invoice proxy key is invalid" });
  }

  return next();
});

type InvoiceImageAnalysisResult = {
  items: Array<{ description: string; subText?: string; quantity: number; unitPrice: number; currency: string }>;
  detectedSender: string | null;
  invoiceNumbers: number[];
  totalAmount?: number | null;
  currency?: string | null;
  rawOrderText?: string | null;
};

function getInvoiceImageExtractionPrompt() {
  return `You are an expert OCR and invoice extraction assistant for WhatsApp order screenshots.
Read the visible chat screenshot carefully, including small text in message bubbles.

Goal:
Extract the buyer's order into invoice line items.

Return a JSON object with this EXACT format:
{
  "items": [
    { "description": "product name", "subText": "color or variant", "quantity": 10, "unitPrice": 25.00, "currency": "EUR" }
  ],
  "detectedSender": "name or phone number of the buyer (not the seller/Murakami)",
  "invoiceNumbers": [372, 373],
  "totalAmount": 250.00,
  "currency": "EUR",
  "rawOrderText": "the exact buyer message text used for the order"
}

Extraction rules:
- Identify the BUYER's actual order request. Prioritize messages with words like "invoice", "order", "take", "buy", "pcs", "pieces", "units", "please", or a quantity.
- Do NOT extract every product mentioned in the chat. Extract only products the buyer is asking to purchase or invoice.
- If the buyer asks "how much is X?" and later says a quantity like "10 pcs", treat X as the ordered product.
- If a seller message contains a price list or a price reply, use it only to fill unitPrice for the matching ordered product.
- If quantity is visible separately from the product name, combine nearby buyer messages when they refer to the same product.
- items.description: FULL product name, expanded from abbreviations/slang:
  * Do NOT add "New" unless the visible text explicitly says "New" or uses an "N" abbreviation such as "N3DSXL" or "N3DSLL".
  * "3dsxl" or "3ds xl" -> "3DS XL"
  * "N3dsxl" or "New 3DS XL" -> "New 3DS XL"
  * "3dsll" or "3ds ll" -> "3DS LL"
  * "N3dsll" or "New 3DS LL" -> "New 3DS LL"
  * "N2dsll" or "n2dsll" -> "New 2DS LL"
  * "N3ds" -> "New 3DS"
  * "PSVita" -> "PS Vita"
  * "PSPGO" or "PSPGo" -> "PSP Go"
  * "WiiU" -> "Wii U"
  * Other abbreviations: expand to full official product name
- items.subText: color, variant, or condition mentioned in the conversation for this item.
  * Look in the ENTIRE conversation for color/variant info, not just the order line.
  * Examples: "turquoise", "black", "white", "random color", "coral pink", "like new"
  * Leave empty string "" if no color/variant info found.
- items.quantity: number of units ordered
- items.unitPrice: unit price if visible (e.g. "€25 each", "25 EUR/pc", "160 euros per"). Set to 0 if not shown.
- items.currency: currency code (EUR, USD, GBP, JPY). Default EUR.
- detectedSender: the BUYER's WhatsApp display name shown on the buyer's message bubble. Strip leading "~". Include phone only if the name is unreadable. The seller is typically "Murakami" or "村上" - exclude them.
- invoiceNumbers: any invoice numbers like "Invoice - 0372.pdf" -> [372]
- totalAmount: total order amount if visible (e.g. "Total: €500" -> 500)
- currency: overall currency of the transaction
- rawOrderText: exact visible buyer message(s) used to determine product, quantity, and price.
- If you are uncertain, still return the most likely item instead of returning an empty items array.
- Use empty string "" for unknown text fields and 0 for unknown numeric fields.

Return ONLY valid JSON, no markdown, no explanation.`;
}

function cleanDetectedSender(value: unknown) {
  const text = String(value ?? "")
    .replace(/^~\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function normalizeExtractedProductName(description: string, rawOrderText: string | null | undefined) {
  const raw = String(rawOrderText ?? "").toLowerCase().replace(/\s+/g, "");
  if (!raw) return description;
  const mentionsPlain3dsXl = raw.includes("3dsxl");
  const mentionsNew3dsXl = raw.includes("new3dsxl") || raw.includes("n3dsxl");
  if (mentionsPlain3dsXl && !mentionsNew3dsXl && /^new\s+3ds\s+xl$/i.test(description.trim())) {
    return "3DS XL";
  }
  const mentionsPlain3dsLl = raw.includes("3dsll");
  const mentionsNew3dsLl = raw.includes("new3dsll") || raw.includes("n3dsll");
  if (mentionsPlain3dsLl && !mentionsNew3dsLl && /^new\s+3ds\s+ll$/i.test(description.trim())) {
    return "3DS LL";
  }
  return description;
}

function parseInvoiceImageAnalysisText(text: string): InvoiceImageAnalysisResult {
  const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const jsonText = clean.startsWith("{")
    ? clean
    : clean.slice(Math.max(0, clean.indexOf("{")), clean.lastIndexOf("}") + 1);
  try {
    const parsed = JSON.parse(jsonText || clean) as Partial<InvoiceImageAnalysisResult>;
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const rawOrderText = parsed.rawOrderText ? String(parsed.rawOrderText).trim() : null;
    const items = rawItems
      .map((item) => ({
        description: normalizeExtractedProductName(String(item.description ?? "").trim(), rawOrderText),
        subText: String(item.subText ?? "").trim(),
        quantity: Number(item.quantity ?? 0),
        unitPrice: Number(item.unitPrice ?? 0),
        currency: String(item.currency ?? parsed.currency ?? "EUR").trim().toUpperCase() || "EUR",
      }))
      .filter((item) => item.description.length > 0);
    return {
      items,
      detectedSender: cleanDetectedSender(parsed.detectedSender),
      invoiceNumbers: Array.isArray(parsed.invoiceNumbers)
        ? parsed.invoiceNumbers.map((n) => Number(n)).filter(Number.isFinite)
        : [],
      totalAmount: parsed.totalAmount == null ? null : Number(parsed.totalAmount),
      currency: parsed.currency ? String(parsed.currency).trim().toUpperCase() : null,
      rawOrderText,
    };
  } catch {
    return { items: [], detectedSender: null, invoiceNumbers: [] };
  }
}

const invoiceImageResponseSchema = {
  type: "OBJECT",
  properties: {
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          description: { type: "STRING" },
          subText: { type: "STRING" },
          quantity: { type: "NUMBER" },
          unitPrice: { type: "NUMBER" },
          currency: { type: "STRING" },
        },
        required: ["description", "subText", "quantity", "unitPrice", "currency"],
      },
    },
    detectedSender: { type: "STRING" },
    invoiceNumbers: {
      type: "ARRAY",
      items: { type: "INTEGER" },
    },
    totalAmount: { type: "NUMBER" },
    currency: { type: "STRING" },
    rawOrderText: { type: "STRING" },
  },
  required: ["items", "detectedSender", "invoiceNumbers", "currency", "rawOrderText"],
};

async function analyzeInvoiceImageWithGemini(input: { base64: string; mimeType: string }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{
        parts: [
          {
            inline_data: {
              mime_type: input.mimeType,
              data: input.base64,
            },
          },
          { text: getInvoiceImageExtractionPrompt() },
        ],
      }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: invoiceImageResponseSchema,
        temperature: 0.1,
        maxOutputTokens: 512,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Gemini API error: ${res.status}${detail ? ` ${detail.slice(0, 200)}` : ""}`);
  }
  const data = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
  return parseInvoiceImageAnalysisText(text);
}

// Fix private_key spaces that may be stripped by secret storage
function fixServiceAccountJson(jsonStr: string) {
  const credentials = JSON.parse(jsonStr);
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key
      .replace(/-----BEGINPRIVATEKEY-----/g, "-----BEGIN PRIVATE KEY-----")
      .replace(/-----ENDPRIVATEKEY-----/g, "-----END PRIVATE KEY-----")
      .replace(/-----BEGINRSAPRIVATEKEY-----/g, "-----BEGIN RSA PRIVATE KEY-----")
      .replace(/-----ENDRSAPRIVATEKEY-----/g, "-----END RSA PRIVATE KEY-----")
      .replace(/\\n/g, "\n");
  }
  return credentials;
}

function getServiceAccountCredentials() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  return fixServiceAccountJson(serviceAccountJson);
}

function getSheetsAccessError(error: unknown, spreadsheetId = SPREADSHEET_ID) {
  const message = error instanceof Error ? error.message : String(error);
  const status = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  const credentials = (() => {
    try {
      return getServiceAccountCredentials() as { client_email?: string; project_id?: string };
    } catch {
      return null;
    }
  })();
  const serviceAccountEmail = credentials?.client_email ?? "不明";
  const projectId = credentials?.project_id ?? "不明";

  if (status === "403" || message.toLowerCase().includes("permission")) {
    return new Error(
      `Google Sheetsの権限がありません。スプシID ${spreadsheetId} を ` +
      `${serviceAccountEmail} に編集者権限で共有してください。` +
      `Vercelのサービスアカウント project_id: ${projectId}。詳細: ${message}`
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function getSheetsClient() {
  const credentials = getServiceAccountCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function canSyncTradeSheet() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

function normalizeTradeCurrency(value: string | null | undefined) {
  const text = String(value ?? "").trim().toLowerCase();
  if (
    text.includes("usd") ||
    text.includes("ドル") ||
    text.includes("dollar") ||
    text.includes("$") ||
    text.includes("繝峨Ν")
  ) {
    return "USD";
  }
  return "EUR";
}

function inferTradeCurrencyForPartner(partner: string | null | undefined, fallback: string | null | undefined) {
  const text = String(partner ?? "").trim().toLowerCase();
  if (
    text.includes("ルカ") ||
    text.includes("luca") ||
    text.includes("サイモン") ||
    text.includes("simon") ||
    text.includes("hennes kamusien") ||
    text.includes("マキシム") ||
    text.includes("maxim") ||
    text.includes("ネレ") ||
    text.includes("nele")
  ) {
    return "ユーロ" as const;
  }
  if (text.includes("サミー") || text.includes("samee") || text.includes("デボン") || text.includes("devon")) {
    return "ドル" as const;
  }
  return normalizeTradeCurrency(fallback) === "USD" ? "ドル" as const : "ユーロ" as const;
}

function selectTradeRate(currency: string | null | undefined, eurRate: number | null | undefined, usdRate: number | null | undefined) {
  const rate = normalizeTradeCurrency(currency) === "EUR" ? eurRate : usdRate;
  return typeof rate === "number" && Number.isFinite(rate) ? rate : null;
}

type TradeDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
let knownEuroRateRepairPromise: Promise<void> | null = null;

function normalizeRateDate(value: string | null | undefined) {
  const text = String(value ?? "").trim();
  const match = text.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return "";
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

async function fetchJpyRateByDate(date: string, currency: "EUR" | "USD") {
  const endpoint = date
    ? `https://api.frankfurter.dev/v1/${date}?base=${currency}&symbols=JPY`
    : `https://api.frankfurter.dev/v1/latest?base=${currency}&symbols=JPY`;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`Failed to fetch ${currency}/JPY rate: ${res.status}`);
  const data = await res.json() as { rates?: { JPY?: number } };
  const rate = data.rates?.JPY;
  if (!rate || !Number.isFinite(rate)) throw new Error(`No JPY rate for ${currency} ${date || "latest"}`);
  return rate;
}

async function repairKnownEuroRateRows(db: TradeDb) {
  if (!knownEuroRateRepairPromise) {
    knownEuroRateRepairPromise = (async () => {
      const rows = await db.select().from(tradeRecords).where(
        or(
          eq(tradeRecords.no, 385),
          eq(tradeRecords.no, 386),
          eq(tradeRecords.no, 387),
          like(tradeRecords.partner, "%サイモン%"),
          like(tradeRecords.partner, "%simon%"),
          like(tradeRecords.partner, "%マキシム%"),
          like(tradeRecords.partner, "%maxim%"),
          like(tradeRecords.partner, "%ネレ%"),
          like(tradeRecords.partner, "%nele%"),
        ),
      );
      const targets = rows.filter((row) => normalizeTradeCurrency(inferTradeCurrencyForPartner(row.partner, row.currency)) === "EUR");
      await Promise.all(targets.map(async (row) => {
        const unitPrice = Number(row.unitPrice ?? 0);
        const quantity = Number(row.quantity ?? 0);
        if (!unitPrice || !quantity) return;
        const rateDate = normalizeRateDate(row.paymentDate);
        const eurRate = await fetchJpyRateByDate(rateDate, "EUR");
        const unitPriceJPY = Math.round(unitPrice * eurRate * 10000) / 10000;
        const totalSales = Math.round(quantity * unitPriceJPY * 10000) / 10000;
        const procurementTotal = Number(row.procurementTotal ?? 0);
        const refund = Number(row.refund ?? 0);
        const shippingCost = Number(row.shippingCost ?? 0);
        const customsDuty = Number(row.customsDuty ?? 0);
        const profitWithRefund = Math.round((totalSales - procurementTotal + refund - shippingCost - customsDuty) * 10000) / 10000;
        const currentUnitPriceJPY = Number(row.unitPriceJPY ?? 0);
        if (Math.abs(currentUnitPriceJPY - unitPriceJPY) < 0.5) return;
        await db.update(tradeRecords)
          .set({
            currency: "ユーロ",
            unitPriceJPY: String(unitPriceJPY),
            totalSales: String(totalSales),
            profitWithRefund: String(profitWithRefund),
          })
          .where(eq(tradeRecords.id, row.id));
      }));
    })().catch((error) => {
      knownEuroRateRepairPromise = null;
      console.warn("[Trade] Failed to repair known EUR rate rows", error);
    });
  }
  await knownEuroRateRepairPromise;
}

function shouldRepairDisplayedEuroRate(row: TradeRow) {
  const partner = String(row.partner ?? "").trim().toLowerCase();
  const invoiceNo = Number(row.no ?? 0);
  return normalizeTradeCurrency(inferTradeCurrencyForPartner(row.partner, row.currency)) === "EUR"
    && (
      invoiceNo === 385
      || invoiceNo === 386
      || invoiceNo === 387
      || partner.includes("サイモン")
      || partner.includes("simon")
      || partner.includes("hennes kamusien")
      || partner.includes("マキシム")
      || partner.includes("maxim")
      || partner.includes("ネレ")
      || partner.includes("nele")
    );
}

async function applyDisplayedEuroRateRepairs<T extends TradeRow>(db: TradeDb, rows: T[]): Promise<T[]> {
  const targets = rows.filter(shouldRepairDisplayedEuroRate);
  if (targets.length === 0) return rows;

  const repairedById = new Map<number, T>();
  await Promise.all(targets.map(async (row) => {
    const unitPrice = Number(row.unitPrice ?? 0);
    const quantity = Number(row.quantity ?? 0);
    const id = Number(row.id ?? 0);
    if (!unitPrice || !quantity || !id) return;

    const rateDate = normalizeRateDate(row.paymentDate);
    const eurRate = await fetchJpyRateByDate(rateDate, "EUR");
    const unitPriceJPY = Math.round(unitPrice * eurRate * 10000) / 10000;
    const totalSales = Math.round(quantity * unitPriceJPY * 10000) / 10000;
    const procurementTotal = Number(row.procurementTotal ?? 0);
    const refund = Number(row.refund ?? 0);
    const shippingCost = Number(row.shippingCost ?? 0);
    const customsDuty = Number(row.customsDuty ?? 0);
    const profitWithRefund = Math.round((totalSales - procurementTotal + refund - shippingCost - customsDuty) * 10000) / 10000;
    const repaired = {
      ...row,
      currency: "ユーロ",
      unitPriceJPY: String(unitPriceJPY),
      totalSales: String(totalSales),
      profitWithRefund: String(profitWithRefund),
    } as T;
    repairedById.set(id, repaired);

    const currentUnitPriceJPY = Number(row.unitPriceJPY ?? 0);
    if (Math.abs(currentUnitPriceJPY - unitPriceJPY) < 0.5 && normalizeTradeCurrency(row.currency) === "EUR") return;
    await db.update(tradeRecords)
      .set({
        currency: "ユーロ",
        unitPriceJPY: String(unitPriceJPY),
        totalSales: String(totalSales),
        profitWithRefund: String(profitWithRefund),
      })
      .where(eq(tradeRecords.id, id));
  })).catch((error) => {
    console.warn("[Trade] Failed to apply displayed EUR rate repairs", error);
  });

  if (repairedById.size === 0) return rows;
  return rows.map((row) => repairedById.get(Number(row.id ?? 0)) ?? row);
}

function changedNumber(a: unknown, b: number) {
  return Math.abs(Number(a ?? 0) - b) > 0.0001;
}

function spreadsheetColumnName(index: number) {
  let n = index;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function quoteSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function isTradeViewSheet(sheet: { title: string; hidden?: boolean }) {
  return Boolean(sheet.title) && !sheet.hidden && sheet.title.includes(TRADE_VIEW_SHEET_NAME_KEYWORD);
}

type SheetShipmentProgress = {
  invoiceNo: string;
  productNameJa: string;
  productNameEn: string;
  orderedQty: number;
  shippedQty: number;
};

let tradeShipmentProgressCache: {
  expiresAt: number;
  data: Map<string, SheetShipmentProgress[]>;
} | null = null;

function parseSheetQuantity(value: unknown) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;
  const number = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function normalizeSheetProductKey(value: unknown) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

async function getSheetShipmentProgressByInvoice() {
  if (!canSyncTradeSheet()) return new Map<string, SheetShipmentProgress[]>();
  const now = Date.now();
  if (tradeShipmentProgressCache && tradeShipmentProgressCache.expiresAt > now) {
    return tradeShipmentProgressCache.data;
  }

  const sheets = getSheetsClient();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: TRADE_VIEW_SPREADSHEET_ID,
    fields: "sheets.properties(title,index,hidden)",
  }).catch((error) => {
    throw getSheetsAccessError(error, TRADE_VIEW_SPREADSHEET_ID);
  });
  const tabs = (metadata.data.sheets ?? [])
    .map((sheet) => ({
      title: sheet.properties?.title ?? "",
      index: sheet.properties?.index ?? 0,
      hidden: sheet.properties?.hidden ?? false,
    }))
    .filter(isTradeViewSheet)
    .sort((a, b) => a.index - b.index);

  if (tabs.length === 0) return new Map<string, SheetShipmentProgress[]>();

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: TRADE_VIEW_SPREADSHEET_ID,
    ranges: tabs.map((tab) => `${quoteSheetName(tab.title)}!B:G`),
    valueRenderOption: "FORMATTED_VALUE",
  }).catch((error) => {
    throw getSheetsAccessError(error, TRADE_VIEW_SPREADSHEET_ID);
  });

  const progressByInvoice = new Map<string, SheetShipmentProgress[]>();
  for (const valueRange of response.data.valueRanges ?? []) {
    let currentInvoiceNo = "";
    for (const row of valueRange.values ?? []) {
      const rawInvoiceNo = String(row[0] ?? "").trim();
      if (/^\d+$/.test(rawInvoiceNo)) {
        currentInvoiceNo = rawInvoiceNo;
      } else if (rawInvoiceNo) {
        currentInvoiceNo = "";
      }
      const invoiceNo = currentInvoiceNo;
      if (!invoiceNo) continue;
      const orderedQty = parseSheetQuantity(row[4]);
      const shippedQty = parseSheetQuantity(row[5]);
      if (orderedQty <= 0 && shippedQty <= 0) continue;
      const entries = progressByInvoice.get(invoiceNo) ?? [];
      entries.push({
        invoiceNo,
        productNameJa: String(row[2] ?? "").trim(),
        productNameEn: String(row[3] ?? "").trim(),
        orderedQty,
        shippedQty,
      });
      progressByInvoice.set(invoiceNo, entries);
    }
  }

  tradeShipmentProgressCache = {
    expiresAt: now + 20_000,
    data: progressByInvoice,
  };
  return progressByInvoice;
}

function summarizeSheetShipmentProgress(entries: SheetShipmentProgress[], fallbackOrderedQty: number) {
  const orderedQty = entries.reduce((sum, entry) => sum + entry.orderedQty, 0) || fallbackOrderedQty;
  const shippedQty = entries.reduce((sum, entry) => sum + entry.shippedQty, 0);
  return { orderedQty, shippedQty };
}

function getSheetShipmentStatus(
  row: { no: number | null; productName: string | null; quantity: string | null },
  entries: SheetShipmentProgress[] | undefined,
  occurrenceIndex: number,
) {
  if (!entries?.length) return null;
  const productKey = normalizeSheetProductKey(row.productName);
  const matchedByProduct = productKey
    ? entries.find((entry) => {
        const jaKey = normalizeSheetProductKey(entry.productNameJa);
        const enKey = normalizeSheetProductKey(entry.productNameEn);
        const jaLooseKey = normalizeLooseText(entry.productNameJa);
        const enLooseKey = normalizeLooseText(entry.productNameEn);
        const productLooseKey = normalizeLooseText(String(row.productName ?? ""));
        return jaKey === productKey ||
          enKey === productKey ||
          jaKey.includes(productKey) ||
          enKey.includes(productKey) ||
          jaLooseKey === productLooseKey ||
          enLooseKey === productLooseKey;
      }) ??
      (() => {
        const productName = String(row.productName ?? "").trim();
        if (!productName) return undefined;
        const suggestion = suggestCsvProduct(
          productName,
          productName,
          entries.map((entry) => ({
            name: entry.productNameJa || entry.productNameEn,
            qty: entry.orderedQty,
          })),
        );
        if (!suggestion) return undefined;
        const suggestionKey = normalizeLooseText(suggestion.name);
        return entries.find((entry) =>
          normalizeLooseText(entry.productNameJa) === suggestionKey ||
          normalizeLooseText(entry.productNameEn) === suggestionKey
        );
      })()
    : undefined;
  const fallback = entries[occurrenceIndex];
  const selected = matchedByProduct ?? fallback;
  const fallbackOrderedQty = parseSheetQuantity(row.quantity);
  const progress = selected
    ? {
        orderedQty: selected.orderedQty || fallbackOrderedQty,
        shippedQty: selected.shippedQty,
      }
    : summarizeSheetShipmentProgress(entries, fallbackOrderedQty);
  if (progress.orderedQty <= 0) return null;
  const remaining = Math.max(0, Math.round((progress.orderedQty - progress.shippedQty) * 100) / 100);
  return remaining <= 0 ? "complete" : `残${Number.isInteger(remaining) ? remaining : remaining.toFixed(2)}`;
}

function applySheetShipmentStatuses<T extends { no: number | null; productName: string | null; quantity: string | null; status: string | null }>(
  rows: T[],
  progressByInvoice: Map<string, SheetShipmentProgress[]>,
) {
  if (progressByInvoice.size === 0) return rows;
  const invoiceOccurrences = new Map<string, number>();
  return rows.map((row) => {
    if (row.no == null) return row;
    const invoiceNo = String(row.no);
    const occurrenceIndex = invoiceOccurrences.get(invoiceNo) ?? 0;
    invoiceOccurrences.set(invoiceNo, occurrenceIndex + 1);
    const status = getSheetShipmentStatus(row, progressByInvoice.get(invoiceNo), occurrenceIndex);
    return status ? { ...row, status } : row;
  });
}

function applyClosedTradeYearStatuses<T extends { paymentDate?: string | null; status: string | null }>(rows: T[]) {
  return rows.map((row) => (isClosedTradeYear(row.paymentDate) ? { ...row, status: "complete" } : row));
}

function applyManualCompleteTradeStatuses<T extends { no: number | null; status: string | null }>(
  rows: T[],
  manualCompleteSet: Set<string>,
) {
  if (manualCompleteSet.size === 0) return rows;
  return rows.map((row) => {
    if (row.no == null || !manualCompleteSet.has(String(row.no))) return row;
    return { ...row, status: "complete" };
  });
}

async function assertTradeSheetExists(sheetName: string, spreadsheetId = SPREADSHEET_ID) {
  const sheets = getSheetsClient();
  const metadata = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(title,gridProperties(rowCount,columnCount))",
  }).catch((error) => {
    throw getSheetsAccessError(error, spreadsheetId);
  });
  const sheet = metadata.data.sheets?.find((s) => s.properties?.title === sheetName);
  if (!sheet?.properties) throw new Error(`シート「${sheetName}」が見つかりません`);
  return { sheets, sheet: sheet.properties };
}

// ─── WhatsApp chat parser ────────────────────────────────────────────────────
// Strategy:
//   1. Find the "order message" — the message that contains "invoice me" or
//      a block of lines starting with a number (qty-first format).
//   2. Extract only qty-first lines from that message block.
//   3. For price-list lines ("* Product: 95 Euros"), capture unit prices
//      and match them to order items by fuzzy name.
function parseWhatsAppChat(chatText: string): Array<{
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
}> {
  // Split into message blocks by timestamp
  // Each block starts with a line matching [HH:MM, YYYY/M/D]
  const timestampRe = /^\[\d{1,2}:\d{2},\s*\d{4}\/\d{1,2}\/\d{1,2}\]/;

  const blocks: string[][] = [];
  let current: string[] = [];
  for (const rawLine of chatText.split("\n")) {
    if (timestampRe.test(rawLine.trim())) {
      if (current.length) blocks.push(current);
      current = [rawLine];
    } else {
      current.push(rawLine);
    }
  }
  if (current.length) blocks.push(current);

  // Build a price map from ALL blocks (price-list lines)
  const priceMap = new Map<string, { price: number; currency: string }>();
  const priceLineRe = /^\*?\s*(.+?):\s*([\d,]+(?:\.\d+)?)\s*(Euros?|EUR|USD|Dollars?|\$|€)?$/i;
  for (const block of blocks) {
    for (const rawLine of block) {
      const line = rawLine.trim();
      const m = line.match(priceLineRe);
      if (m) {
        const desc = m[1].trim().replace(/^\*\s*/, "").toLowerCase();
        const price = parseFloat(m[2].replace(/,/g, ""));
        const currRaw = (m[3] ?? "").toLowerCase();
        const currency = currRaw.startsWith("usd") || currRaw.startsWith("dollar") || currRaw === "$" ? "USD" : "EUR";
        priceMap.set(desc, { price, currency });
      }
    }
  }

  // Find the order block: contains "invoice me" or has multiple qty-first lines
  const qtyFirstRe = /^(\d+)\s+(.+)$/;
  const skipWords = new Set(["please", "also", "could", "hey", "hi", "below", "once", "if", "we", "i", "is", "are", "the", "and", "for", "with", "can", "that", "this", "from", "to", "be", "psp"]);

  let orderBlock: string[] | null = null;
  for (const block of blocks) {
    const text = block.join(" ").toLowerCase();
    if (text.includes("invoice me") || text.includes("please invoice")) {
      orderBlock = block;
      break;
    }
  }
  // Fallback: find block with most qty-first lines
  if (!orderBlock) {
    let best = 0;
    for (const block of blocks) {
      let count = 0;
      for (const line of block) {
        const m = line.trim().match(qtyFirstRe);
        if (m && !skipWords.has((m[2].split(/\s+/)[0] ?? "").toLowerCase())) count++;
      }
      if (count > best) { best = count; orderBlock = block; }
    }
  }

  if (!orderBlock) return [];

  const items: Array<{ description: string; quantity: number; unitPrice: number; currency: string }> = [];

  for (const rawLine of orderBlock) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip timestamp header line
    if (timestampRe.test(line)) continue;

    const m = line.match(qtyFirstRe);
    if (!m) continue;
    const qty = parseInt(m[1], 10);
    const desc = m[2].trim();
    if (desc.length < 2) continue;
    const firstWord = (desc.split(/\s+/)[0] ?? "").toLowerCase();
    if (skipWords.has(firstWord)) continue;

    // Try to find unit price from price map by fuzzy match
    let unitPrice = 0;
    let currency = "EUR";
    const descLower = desc.toLowerCase();
    for (const [key, val] of Array.from(priceMap.entries())) {
      // Simple containment match
      if (descLower.includes(key) || key.includes(descLower)) {
        unitPrice = val.price;
        currency = val.currency;
        break;
      }
    }

    items.push({ description: desc, quantity: qty, unitPrice, currency });
  }

  return items;
}

// ─── Extract sender name from WhatsApp chat ─────────────────────────────────
function extractSenderFromChat(chatText: string): string | null {
  const lines = chatText.split("\n");
  const timestampRe = /^\[(\d{1,2}:\d{2}),\s*\d{4}\/\d{1,2}\/\d{1,2}\]\s+([^:]+):/;
  let currentSender: string | null = null;
  for (const line of lines) {
    const m = line.match(timestampRe);
    if (m) currentSender = m[2].trim();
    const lower = line.toLowerCase();
    if (lower.includes("invoice me") || lower.includes("please invoice") || lower.includes("invoice for")) {
      return currentSender;
    }
  }
  return null;
}
// ─── Detect payments from WhatsApp chat ──────────────────────────────────────
function detectPaymentsFromChat(chatText: string): Array<{ invoiceNumber: string; confidence: "high" | "medium"; rawText: string }> {
  const results: Array<{ invoiceNumber: string; confidence: "high" | "medium"; rawText: string }> = [];
  const lines = chatText.split("\n");
  const paymentKeywords = ["paid", "payment sent", "transferred", "wire transfer", "bank transfer", "i have paid", "i've paid", "payment done", "payment made", "sent the payment", "sent payment", "money sent", "already paid"];
  const invoiceRe = /(?:invoice|inv)[\s\-#]*([0-9]{3,6})/gi;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    const isPaymentLine = paymentKeywords.some(kw => line.includes(kw));
    if (!isPaymentLine) continue;
    const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(" ");
    const rawText = lines[i].trim();
    let match;
    invoiceRe.lastIndex = 0;
    const foundNums: string[] = [];
    while ((match = invoiceRe.exec(context)) !== null) {
      const num = match[1].padStart(4, "0");
      foundNums.push(num);
      results.push({ invoiceNumber: num, confidence: "high", rawText });
    }
    if (foundNums.length === 0) {
      results.push({ invoiceNumber: "", confidence: "medium", rawText });
    }
  }
  const seen = new Set<string>();
  return results.filter(r => {
    const key = r.invoiceNumber + r.rawText;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// ─── Invoice number generator ──────────────────────────────────────────────
function generateInvoiceNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `INV-${y}${m}${d}-${rand}`;
}

// ============================================================
// Shipment shipping cost & customs duty recalculation helper
// ============================================================
type TradeRow = typeof tradeRecords.$inferSelect;
type ShipmentRow = typeof shipments.$inferSelect;
type ShipmentItemRow = typeof shipmentItems.$inferSelect;
type RouterDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type ParsedFedexShipmentItem = {
  productNameJa: string;
  productNameEn: string;
  quantity: number;
  invoiceNo: string | null;
  managementNo: string | null;
};
type FedexAllocationItem = ParsedFedexShipmentItem & { deliveryNo: string };

function toNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function getShipmentTradeRecordId(item: ShipmentItemRow): number | null {
  const id = Number(item.tradeRecordId ?? 0);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function normalizeShipmentTrackingNumber(value: string | null | undefined): string {
  return String(value ?? "").replace(/[\s-]/g, "").trim();
}

function getShipmentAllocationGroupKey(shipment: Pick<ShipmentRow, "id" | "trackingNumber">): string {
  const trackingNumber = normalizeShipmentTrackingNumber(shipment.trackingNumber);
  return trackingNumber ? `tracking:${trackingNumber}` : `shipment:${shipment.id}`;
}

function getDeliveryInvoiceNo(value: string | null | undefined): string | null {
  return invoiceNoFromDeliveryNo(value);
}

function getFedexItemInvoiceNo(row: Record<string, unknown>): string | null {
  return (
    normalizeAssignedInvoiceNo(row.invoiceNo as string | null | undefined) ??
    normalizeAssignedInvoiceNo(row.assignedInvoiceNo as string | null | undefined) ??
    invoiceNoFromManagementNo(row.managementNo as string | null | undefined) ??
    invoiceNoFromManagementNo(row.legacyManagementNo as string | null | undefined)
  );
}

function parseFedexShipmentItems(value: string | null | undefined): ParsedFedexShipmentItem[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== "object") return null;
        const row = item as Record<string, unknown>;
        const productNameJa = String(row.productNameJa ?? row.title ?? row.productNameEn ?? "").trim();
        const productNameEn = String(row.productNameEn ?? productNameJa).trim();
        const quantity = toNumber(row.quantity);
        if (!productNameJa || quantity <= 0) return null;
        return {
          productNameJa,
          productNameEn,
          quantity,
          invoiceNo: getFedexItemInvoiceNo(row),
          managementNo: String(row.managementNo ?? row.legacyManagementNo ?? "").trim() || null,
        };
      })
      .filter((item): item is ParsedFedexShipmentItem => item !== null);
  } catch {
    return [];
  }
}

function addTradeQuantity(map: Map<number, number>, tradeId: number, quantity: number) {
  if (!Number.isFinite(tradeId) || tradeId <= 0 || quantity <= 0) return;
  map.set(tradeId, (map.get(tradeId) ?? 0) + quantity);
}

function allocateFedexItemsToTradeRows(
  invoiceTrades: TradeRow[],
  shipmentItems: FedexAllocationItem[],
): Map<number, number> {
  const allocated = new Map<number, number>();
  const remainingByTradeId = new Map<number, number>();
  const csvProducts = invoiceTrades
    .map((trade) => ({
      tradeId: Number(trade.id),
      name: String(trade.productName ?? "").trim(),
      qty: toNumber(trade.quantity),
    }))
    .filter((trade) => trade.tradeId > 0 && trade.name);

  for (const trade of csvProducts) {
    remainingByTradeId.set(trade.tradeId, trade.qty);
  }

  for (const item of shipmentItems) {
    const shippedName = item.productNameJa || item.productNameEn;
    const shippedNameKey = normalizeLooseText(shippedName);
    let candidates = csvProducts.filter((product) => normalizeLooseText(product.name) === shippedNameKey);
    if (candidates.length === 0) {
      const suggestion = suggestCsvProduct(
        shippedName,
        `${item.deliveryNo} ${item.managementNo ?? ""}`,
        csvProducts.map((product) => ({ name: product.name, qty: product.qty })),
      );
      if (!suggestion) continue;
      candidates = csvProducts.filter((product) => product.name === suggestion.name);
    }

    const chosen =
      candidates.find((product) => (remainingByTradeId.get(product.tradeId) ?? 0) >= item.quantity) ??
      candidates.find((product) => (remainingByTradeId.get(product.tradeId) ?? 0) > 0) ??
      candidates[0];
    if (!chosen) continue;

    addTradeQuantity(allocated, chosen.tradeId, item.quantity);
    remainingByTradeId.set(
      chosen.tradeId,
      Math.max(0, (remainingByTradeId.get(chosen.tradeId) ?? 0) - item.quantity),
    );
  }

  return allocated;
}

function allocateQtyToTrades(
  trades: TradeRow[],
  alreadyAllocated: Map<number, number>,
  quantity: number
): Array<{ tradeId: number; quantity: number }> {
  let remaining = Math.max(0, quantity);
  const result: Array<{ tradeId: number; quantity: number }> = [];

  for (const trade of trades) {
    if (remaining <= 0) break;
    const tradeId = Number(trade.id);
    const orderedQty = toNumber(trade.quantity);
    const usedQty = alreadyAllocated.get(tradeId) ?? 0;
    const capacity = Math.max(0, orderedQty - usedQty);
    if (capacity <= 0) continue;
    const qty = Math.min(capacity, remaining);
    alreadyAllocated.set(tradeId, usedQty + qty);
    result.push({ tradeId, quantity: qty });
    remaining -= qty;
  }

  if (remaining > 0 && trades.length > 0) {
    const fallbackTradeId = Number(trades[0].id);
    alreadyAllocated.set(fallbackTradeId, (alreadyAllocated.get(fallbackTradeId) ?? 0) + remaining);
    result.push({ tradeId: fallbackTradeId, quantity: remaining });
  }

  return result;
}

type TradeShipmentRegistrationProgress = {
  fedexRegisteredQtyByTradeId: Map<number, number>;
  registeredQtyByTradeId: Map<number, number>;
};

async function getTradeShipmentRegistrationProgress(
  db: RouterDb,
  rows: TradeRow[],
): Promise<TradeShipmentRegistrationProgress> {
  const invoiceNos = Array.from(
    new Set(
      rows
        .map((row) => Number(row.no ?? 0))
        .filter((invoiceNo) => Number.isFinite(invoiceNo) && invoiceNo > 399),
    ),
  );

  if (invoiceNos.length === 0) {
    return {
      fedexRegisteredQtyByTradeId: new Map(),
      registeredQtyByTradeId: new Map(),
    };
  }
  const invoiceNoSet = new Set(invoiceNos.map((invoiceNo) => String(invoiceNo)));
  const fedexShipmentConditions = invoiceNos.flatMap((invoiceNo) => {
    const key = String(invoiceNo);
    return [
      eq(fedexShipments.deliveryNo, key),
      like(fedexShipments.deliveryNo, `${key}_%`),
      like(fedexShipments.deliveryNo, `${key}-%`),
      like(fedexShipments.itemsJson, `%\"invoiceNo\":\"${key}\"%`),
      like(fedexShipments.itemsJson, `%\"assignedInvoiceNo\":\"${key}\"%`),
    ];
  });

  const [allTrades, allFedexRows] = await Promise.all([
    db
      .select()
      .from(tradeRecords)
      .where(inArray(tradeRecords.no, invoiceNos))
      .orderBy(asc(tradeRecords.id)),
    db
      .select()
      .from(fedexShipments)
      .where(and(or(...fedexShipmentConditions), isNull(fedexShipments.cancelledAt)))
      .orderBy(asc(fedexShipments.id)),
  ]);

  const tradesByInvoiceNo = new Map<string, TradeRow[]>();
  for (const trade of allTrades) {
    const invoiceNo = String(trade.no ?? "");
    if (!invoiceNo) continue;
    const trades = tradesByInvoiceNo.get(invoiceNo) ?? [];
    trades.push(trade);
    tradesByInvoiceNo.set(invoiceNo, trades);
  }

  const fedexItemsByInvoiceNo = new Map<string, FedexAllocationItem[]>();
  for (const shipment of allFedexRows) {
    const deliveryInvoiceNo = getDeliveryInvoiceNo(shipment.deliveryNo);
    for (const item of parseFedexShipmentItems(shipment.itemsJson)) {
      const invoiceNo = item.invoiceNo ?? deliveryInvoiceNo;
      if (!invoiceNo || !invoiceNoSet.has(invoiceNo)) continue;
      const items = fedexItemsByInvoiceNo.get(invoiceNo) ?? [];
      items.push({ ...item, deliveryNo: shipment.deliveryNo });
      fedexItemsByInvoiceNo.set(invoiceNo, items);
    }
  }

  const fedexQtyByTradeId = new Map<number, number>();
  for (const [invoiceNo, shipmentItems] of fedexItemsByInvoiceNo) {
    const invoiceTrades = tradesByInvoiceNo.get(invoiceNo) ?? [];
    const allocated = allocateFedexItemsToTradeRows(invoiceTrades, shipmentItems);
    for (const [tradeId, quantity] of allocated) {
      addTradeQuantity(fedexQtyByTradeId, tradeId, quantity);
    }
  }

  const registeredQtyByTradeId = new Map<number, number>();
  for (const [tradeId, quantity] of fedexQtyByTradeId) {
    registeredQtyByTradeId.set(tradeId, quantity);
  }

  return {
    fedexRegisteredQtyByTradeId: fedexQtyByTradeId,
    registeredQtyByTradeId,
  };
}

function applyTradeShipmentRegistrationStatuses<T extends TradeRow>(
  rows: T[],
  progress: TradeShipmentRegistrationProgress,
) {
  return rows.map((row): T => {
    const invoiceNo = row.no == null ? null : Number(row.no);
    const tradeId = Number(row.id);
    const fedexQty = progress.fedexRegisteredQtyByTradeId.get(tradeId) ?? 0;
    const status = deriveTradeShipmentRegistrationStatus({
      status: row.status,
      invoiceNo,
      paymentDate: row.paymentDate,
      orderedQty: toNumber(row.quantity),
      registeredQty: progress.registeredQtyByTradeId.get(tradeId) ?? 0,
      fedexRegisteredQty: fedexQty,
    });
    return status === (row.status ?? "") ? row : { ...row, status };
  });
}

/**
 * 指定インボイスの送料・関税を再計算する。
 * - 全発送記録から当該インボイスの合計発送台数を集計
 * - 発送台数 >= 注文台数 なら実送料（按分）を適用
 * - それ以外は仮送料（550円×注文数）を維持
 * - USD取引の場合、各発送の発送日レートで関税（商品価格円換算×発送台数×10%）を計算
 */
async function recalcShippingCostsLegacy(
  db: RouterDb,
  invoiceNos: number[]
): Promise<void> {
  for (const invoiceNo of invoiceNos) {
    // 同じインボイスNoの全取引レコードを取得
    const trades = await db
      .select()
      .from(tradeRecords)
      .where(eq(tradeRecords.no, invoiceNo));
    if (trades.length === 0) continue;

    // 同一インボイスNoの全行の注文数合計を使用
    const orderedQty = trades.reduce((sum, t) => sum + Number(t.quantity ?? 0), 0);
    const isUSD = trades[0]?.currency === "ドル";

    // 全発送明細を取得
    const allItems = await db
      .select()
      .from(shipmentItems)
      .where(eq(shipmentItems.invoiceNo, invoiceNo));
    const shippedQty = allItems.reduce((s, i) => s + i.quantity, 0);

    let newShippingCost: number;

    if (shippedQty >= orderedQty && orderedQty > 0) {
      // 発送完了 → 実送料を按分計算
      let totalActualCost = 0;
      const shipmentIds = Array.from(new Set(allItems.map((i) => i.shipmentId)));
      for (const sid of shipmentIds) {
        const [s] = await db.select().from(shipments).where(eq(shipments.id, sid));
        if (!s) continue;
        const allSidItems = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, sid));
        const totalQtyInShipment = allSidItems.reduce((sum, i) => sum + i.quantity, 0);
        const thisInvoiceQtyInShipment = allSidItems
          .filter((i) => i.invoiceNo === invoiceNo)
          .reduce((sum, i) => sum + i.quantity, 0);
        if (totalQtyInShipment > 0) {
          totalActualCost += (Number(s.shippingCost) / totalQtyInShipment) * thisInvoiceQtyInShipment;
        }
      }
      newShippingCost = Math.round(totalActualCost);
    } else {
      // 発送未完了 → 仮送料（550円×注文数）
      newShippingCost = 550 * orderedQty;
    }

    // USD取引の場合、各発送の発送日レートで関税を計算する
    // 関税 = 商品価格(円換算) × 発送台数 × 10%
    // 分割発送の場合は各発送の発送日レートで分割計算し合計する
    let newCustomsDuty: number | null = null;
    if (isUSD && allItems.length > 0) {
      const shipmentIds = Array.from(new Set(allItems.map((i) => i.shipmentId)));
      let totalCustoms = 0;
      for (const sid of shipmentIds) {
        const [s] = await db.select().from(shipments).where(eq(shipments.id, sid));
        if (!s) continue;
        // 発送日のUSD/JPYレートをFrankfurter APIから取得
        let usdRate: number | null = null;
        try {
          const rateRes = await fetch(
            `https://api.frankfurter.dev/v1/${s.shippingDate}?base=USD&symbols=JPY`
          );
          if (rateRes.ok) {
            const rateData = await rateRes.json() as { rates?: { JPY?: number } };
            usdRate = rateData.rates?.JPY ?? null;
          }
        } catch {
          // レート取得失敗時はスキップ
        }
        if (usdRate === null) continue;
        // この発送に含まれるこのインボイスの台数
        const allSidItems = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, sid));
        const thisQty = allSidItems
          .filter((i) => i.invoiceNo === invoiceNo)
          .reduce((sum, i) => sum + i.quantity, 0);
        // 商品価格(円換算) = unitPrice × usdRate
        const unitPriceJPY = Number(trades[0]?.unitPrice ?? 0) * usdRate;
        totalCustoms += Math.round(unitPriceJPY * thisQty * 0.1);
      }
      newCustomsDuty = totalCustoms;
    }

    // 同一インボイスNoの全取引レコードの送料・関税・利益を更新
    for (const trade of trades) {
      const salesTotal = Number(trade.totalSales ?? 0);
      const procTotal = Number(trade.procurementTotal ?? 0);
      const refund = Number(trade.refund ?? 0);
      const customs = newCustomsDuty !== null ? newCustomsDuty : Number(trade.customsDuty ?? 0);
      const newProfit = salesTotal - procTotal + refund - newShippingCost - customs;
      await db
        .update(tradeRecords)
        .set({
          shippingCost: String(newShippingCost),
          ...(newCustomsDuty !== null ? { customsDuty: String(newCustomsDuty) } : {}),
          profitWithRefund: String(newProfit),
        })
        .where(eq(tradeRecords.id, trade.id));
    }
  }
}

async function recalcShippingCosts(
  db: RouterDb,
  invoiceNos: number[]
): Promise<void> {
  let uniqueInvoiceNos = Array.from(new Set(invoiceNos.filter((n) => Number.isFinite(n))));

  if (uniqueInvoiceNos.length > 0) {
    const baseItems = await db
      .select()
      .from(shipmentItems)
      .where(inArray(shipmentItems.invoiceNo, uniqueInvoiceNos));
    const baseShipmentIds = Array.from(new Set(baseItems.map((item) => item.shipmentId)));
    const baseShipments = baseShipmentIds.length > 0
      ? await db.select().from(shipments).where(inArray(shipments.id, baseShipmentIds))
      : [];
    const trackingNumbers = new Set(
      baseShipments
        .map((shipment) => normalizeShipmentTrackingNumber(shipment.trackingNumber))
        .filter((trackingNumber) => trackingNumber.length > 0)
    );
    if (trackingNumbers.size > 0) {
      const relatedShipmentIds = (await db.select().from(shipments))
        .filter((shipment) => {
          const trackingNumber = normalizeShipmentTrackingNumber(shipment.trackingNumber);
          return baseShipmentIds.includes(shipment.id) || (trackingNumber.length > 0 && trackingNumbers.has(trackingNumber));
        })
        .map((shipment) => shipment.id);
      if (relatedShipmentIds.length > 0) {
        const relatedItems = await db
          .select({ invoiceNo: shipmentItems.invoiceNo })
          .from(shipmentItems)
          .where(inArray(shipmentItems.shipmentId, Array.from(new Set(relatedShipmentIds))));
        uniqueInvoiceNos = Array.from(new Set([
          ...uniqueInvoiceNos,
          ...relatedItems.map((item) => item.invoiceNo).filter((invoiceNo) => Number.isFinite(invoiceNo)),
        ]));
      }
    }
  }

  for (const invoiceNo of uniqueInvoiceNos) {
    const trades = await db
      .select()
      .from(tradeRecords)
      .where(eq(tradeRecords.no, invoiceNo))
      .orderBy(asc(tradeRecords.id));
    if (trades.length === 0) continue;

    const allItems = await db
      .select()
      .from(shipmentItems)
      .where(eq(shipmentItems.invoiceNo, invoiceNo));

    const shippedByTradeId = new Map<number, number>();
    const allocatedQtyByTradeId = new Map<number, number>();
    for (const item of allItems) {
      const tradeId = getShipmentTradeRecordId(item);
      if (!tradeId) continue;
      shippedByTradeId.set(tradeId, (shippedByTradeId.get(tradeId) ?? 0) + item.quantity);
      allocatedQtyByTradeId.set(tradeId, (allocatedQtyByTradeId.get(tradeId) ?? 0) + item.quantity);
    }

    const shippingByTradeId = new Map<number, number>();
    const customsByTradeId = new Map<number, number>();
    const shipmentIds = Array.from(new Set(allItems.map((item) => item.shipmentId)));
    const baseShipments = shipmentIds.length > 0
      ? await db.select().from(shipments).where(inArray(shipments.id, shipmentIds))
      : [];
    const trackingNumbers = new Set(
      baseShipments
        .map((shipment) => normalizeShipmentTrackingNumber(shipment.trackingNumber))
        .filter((trackingNumber) => trackingNumber.length > 0)
    );
    const relatedShipments = trackingNumbers.size > 0
      ? (await db.select().from(shipments)).filter((shipment) => {
          const trackingNumber = normalizeShipmentTrackingNumber(shipment.trackingNumber);
          return shipmentIds.includes(shipment.id) || (trackingNumber.length > 0 && trackingNumbers.has(trackingNumber));
        })
      : baseShipments;
    relatedShipments.sort((a, b) => Number(a.id) - Number(b.id));

    const relatedShipmentIds = Array.from(new Set(relatedShipments.map((shipment) => shipment.id)));
    const relatedShipmentItems = relatedShipmentIds.length > 0
      ? await db.select().from(shipmentItems).where(inArray(shipmentItems.shipmentId, relatedShipmentIds))
      : [];
    const shipmentById = new Map(relatedShipments.map((shipment) => [shipment.id, shipment]));
    const shipmentGroups = new Map<string, { shippingDate: string; shippingCost: number; items: ShipmentItemRow[] }>();

    for (const shipment of relatedShipments) {
      const key = getShipmentAllocationGroupKey(shipment);
      const group = shipmentGroups.get(key) ?? {
        shippingDate: shipment.shippingDate,
        shippingCost: 0,
        items: [],
      };
      if (shipment.shippingDate && (!group.shippingDate || shipment.shippingDate < group.shippingDate)) {
        group.shippingDate = shipment.shippingDate;
      }
      const shippingCost = toNumber(shipment.shippingCost);
      if (shippingCost > 0) {
        group.shippingCost = Math.max(group.shippingCost, shippingCost);
      }
      shipmentGroups.set(key, group);
    }

    for (const item of relatedShipmentItems) {
      const shipment = shipmentById.get(item.shipmentId);
      if (!shipment) continue;
      const group = shipmentGroups.get(getShipmentAllocationGroupKey(shipment));
      if (!group) continue;
      group.items.push(item);
    }

    for (const group of shipmentGroups.values()) {
      const totalQtyInShipment = group.items.reduce((sum, item) => sum + item.quantity, 0);
      if (totalQtyInShipment <= 0) continue;

      let usdRate: number | null = null;
      const loadUsdRate = async () => {
        if (usdRate !== null) return usdRate;
        try {
          const rateRes = await fetch(`https://api.frankfurter.dev/v1/${group.shippingDate}?base=USD&symbols=JPY`);
          if (rateRes.ok) {
            const rateData = await rateRes.json() as { rates?: { JPY?: number } };
            usdRate = rateData.rates?.JPY ?? null;
          }
        } catch {
          usdRate = null;
        }
        return usdRate;
      };

      const unitShippingCost = group.shippingCost / totalQtyInShipment;
      const invoiceShipmentItems = group.items.filter((item) => item.invoiceNo === invoiceNo);

      for (const item of invoiceShipmentItems) {
        const explicitTradeId = getShipmentTradeRecordId(item);
        const allocations = explicitTradeId
          ? [{ tradeId: explicitTradeId, quantity: item.quantity }]
          : allocateQtyToTrades(trades, allocatedQtyByTradeId, item.quantity);

        for (const allocation of allocations) {
          const trade = trades.find((row) => row.id === allocation.tradeId);
          if (!trade) continue;

          shippingByTradeId.set(
            allocation.tradeId,
            (shippingByTradeId.get(allocation.tradeId) ?? 0) + unitShippingCost * allocation.quantity
          );

          if (!explicitTradeId) {
            shippedByTradeId.set(
              allocation.tradeId,
              (shippedByTradeId.get(allocation.tradeId) ?? 0) + allocation.quantity
            );
          }

          const orderedTradeQty = toNumber(trade.quantity);
          const shippedTradeQty = shippedByTradeId.get(allocation.tradeId) ?? 0;
          if (orderedTradeQty <= 0 || shippedTradeQty < orderedTradeQty) continue;
          if (String(trade.currency ?? "") !== "ドル") continue;

          const rate = await loadUsdRate();
          if (rate === null) continue;

          const customs = Math.round(toNumber(trade.unitPrice) * rate * allocation.quantity * 0.1);
          customsByTradeId.set(allocation.tradeId, (customsByTradeId.get(allocation.tradeId) ?? 0) + customs);
        }
      }
    }

    for (const trade of trades) {
      const tradeId = Number(trade.id);
      const orderedTradeQty = toNumber(trade.quantity);
      const shippedTradeQty = shippedByTradeId.get(tradeId) ?? 0;
      const tradeComplete = orderedTradeQty > 0 && shippedTradeQty >= orderedTradeQty;
      const newShippingCost = tradeComplete
        ? Math.round(shippingByTradeId.get(tradeId) ?? 0)
        : 550 * orderedTradeQty;
      const isDollarTrade = String(trade.currency ?? "") === "ドル";
      const newCustomsDuty = isDollarTrade
        ? (tradeComplete ? (customsByTradeId.get(tradeId) ?? 0) : 0)
        : undefined;
      const customs = newCustomsDuty !== undefined ? newCustomsDuty : toNumber(trade.customsDuty);
      const newProfit =
        toNumber(trade.totalSales) -
        toNumber(trade.procurementTotal) +
        toNumber(trade.refund) -
        newShippingCost -
        customs;

      await db
        .update(tradeRecords)
        .set({
          shippingCost: String(newShippingCost),
          ...(newCustomsDuty !== undefined ? { customsDuty: String(newCustomsDuty) } : {}),
          profitWithRefund: String(newProfit),
        })
        .where(eq(tradeRecords.id, trade.id));
    }
  }
}

// ============================================================
// Auth Gate Router - allowlisted email login
// ============================================================
function isLocalAuthBypass() {
  return (
    process.env.LOCAL_AUTH_BYPASS === "true" ||
    (process.env.NODE_ENV === "development" && process.env.LOCAL_AUTH_BYPASS !== "false")
  );
}

const authGateRouter = router({
  checkVerified: publicProcedure.query(async ({ ctx }) => {
    if (isLocalAuthBypass()) return { verified: true, loggedIn: true, user: ctx.user ?? null };
    if (!ctx.user) return { verified: false, loggedIn: false, user: null };
    return { verified: isAllowedLoginEmail(ctx.user.email), loggedIn: true, user: ctx.user };
  }),
  loginWithEmail: publicProcedure
    .input(z.object({ email: z.string().trim().email().max(320) }))
    .mutation(async ({ ctx, input }) => {
      if (isLocalAuthBypass()) {
        return { success: true, message: "ログインしました" };
      }

      const email = normalizeLoginEmail(input.email);
      if (!isAllowedLoginEmail(email)) {
        return { success: false, message: "このメールアドレスは許可されていません" };
      }

      const db = await getDb();
      if (!db) throw new Error("データベースに接続できません");

      const openId = createEmailOpenId(email);
      await upsertUser({
        openId,
        name: email,
        email,
        loginMethod: EMAIL_AUTH_LOGIN_METHOD,
        role: "admin",
        lastSignedIn: new Date(),
      });

      const token = await sdk.createSessionToken(openId, {
        name: email,
        expiresInMs: ONE_YEAR_MS,
      });
      ctx.res.cookie(COOKIE_NAME, token, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: ONE_YEAR_MS,
      });

      return { success: true, message: "ログインしました" };
    }),
});
>>>>>>> origin/main

export const appRouter = router({
  authGate: authGateRouter,
  system: systemRouter,
  inventory: inventoryRouter,
  auth: authRouter,

  quoteProxy: quoteProxyRouter,

  // Trade data management
  trade: tradeRouter,

  // ─── Invoice clients (宛先管理) ───────────────────────────────────────────
  invoiceClients: invoiceClientsRouter,

  // ─── Invoices (請求書) ────────────────────────────────────────────────────
  invoices: invoicesRouter,

  // ─── Invoice Settings (差出人デフォルト設定) ───────────────────────────────────────
  invoiceSettings: invoiceSettingsRouter,
  // ─── WhatsApp history upload & invoice number extraction ──────────────────
  whatsappHistory: whatsappHistoryRouter,

  // ─── WhatsApp会話履歴（読み返し用・和訳つき） ──────────────────────────────────
  whatsappChats: whatsappChatsRouter,

  // ─── Knowledge Base & AI Chat ────────────────────────────────────────────────
  knowledgeBase: knowledgeBaseRouter,

  // ─── Shipment (発送記録) Router ─────────────────────────────────────────────
  shipment: shipmentRouter,
});
export type AppRouter = typeof appRouter;
