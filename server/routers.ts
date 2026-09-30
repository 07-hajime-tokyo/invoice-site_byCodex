import { invoiceClientsRouter } from "./invoices/invoiceClientsRouter";
import { invoicesRouter } from "./invoices/invoicesRouter";
import { invoiceSettingsRouter } from "./invoices/invoiceSettingsRouter";
import { generateInvoiceNumber } from "./invoices/numbering";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import {
  createEmailOpenId,
  EMAIL_AUTH_LOGIN_METHOD,
  isAllowedLoginEmail,
  normalizeLoginEmail,
} from "./_core/emailAuth";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { getAllInvoiceMemos } from "./inventory/db";
import { inventoryRouter } from "./inventory/routers";
import { whatsappHistoryRouter } from "./whatsappHistoryRouter";
import { whatsappChatsRouter } from "./whatsappChatsRouter";
import { knowledgeBaseRouter } from "./knowledgeBaseRouter";
import { normalizeLooseText, suggestCsvProduct } from "@shared/productMatching";
import { deriveTradeShipmentRegistrationStatus, isClosedTradeYear, isTradeStatusComplete } from "@shared/tradeStatus";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { google } from "googleapis";
import { getDb, upsertUser } from "./db";
import { invoiceClients, invoices, invoiceItems, tradeRecords, shipments, shipmentItems, fedexShipments } from "../drizzle/schema";
import { eq, desc, asc, or, like, and, sql, isNull, isNotNull, inArray } from "drizzle-orm";

const SPREADSHEET_ID = "1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw";
const SHEET_NAME = "全体";
const TRADE_VIEW_SPREADSHEET_ID = "133cDct4krrsJDeXpO9l0fIrd3-ZYDc39u6-JpQvcxv4";
const TRADE_VIEW_DEFAULT_SHEET_NAME = "独発送管理";
const TRADE_VIEW_SHEET_NAME_KEYWORD = "発送管理";
const TRADE_SHEET_WRITE_BACK_ENABLED = false;

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

// ============================================================
// Shipment shipping cost & customs duty recalculation helper
// ============================================================
type TradeRow = typeof tradeRecords.$inferSelect;
type ShipmentRow = typeof shipments.$inferSelect;
type ShipmentItemRow = typeof shipmentItems.$inferSelect;
type FedexShipmentRow = typeof fedexShipments.$inferSelect;
type RouterDb = NonNullable<Awaited<ReturnType<typeof getDb>>>;

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
  const match = String(value ?? "").match(/^(\d+)/);
  return match ? match[1] : null;
}

function parseFedexShipmentItems(value: string | null | undefined): Array<{ productNameJa: string; productNameEn: string; quantity: number }> {
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
        return { productNameJa, productNameEn, quantity };
      })
      .filter((item): item is { productNameJa: string; productNameEn: string; quantity: number } => item !== null);
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
  shipmentRows: FedexShipmentRow[],
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

  for (const shipment of shipmentRows) {
    for (const item of parseFedexShipmentItems(shipment.itemsJson)) {
      const shippedName = item.productNameJa || item.productNameEn;
      const shippedNameKey = normalizeLooseText(shippedName);
      let candidates = csvProducts.filter((product) => normalizeLooseText(product.name) === shippedNameKey);
      if (candidates.length === 0) {
        const suggestion = suggestCsvProduct(
          shippedName,
          shipment.deliveryNo,
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
  shippedQtyByTradeId: Map<number, number>;
  fedexRegisteredQtyByTradeId: Map<number, number>;
  registeredQtyByTradeId: Map<number, number>;
  invoiceNosWithShipmentSignal: Set<string>;
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
      shippedQtyByTradeId: new Map(),
      fedexRegisteredQtyByTradeId: new Map(),
      registeredQtyByTradeId: new Map(),
      invoiceNosWithShipmentSignal: new Set(),
    };
  }

  const fedexDeliveryNoConditions = invoiceNos.flatMap((invoiceNo) => {
    const key = String(invoiceNo);
    return [
      eq(fedexShipments.deliveryNo, key),
      like(fedexShipments.deliveryNo, `${key}_%`),
      like(fedexShipments.deliveryNo, `${key}-%`),
    ];
  });

  const [allTrades, allItems, allFedexRows] = await Promise.all([
    db
      .select()
      .from(tradeRecords)
      .where(inArray(tradeRecords.no, invoiceNos))
      .orderBy(asc(tradeRecords.id)),
    db
      .select()
      .from(shipmentItems)
      .where(inArray(shipmentItems.invoiceNo, invoiceNos)),
    db
      .select()
      .from(fedexShipments)
      .where(or(...fedexDeliveryNoConditions))
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

  const shipmentItemQtyByTradeId = new Map<number, number>();
  const invoiceNosWithShipmentSignal = new Set<string>();

  for (const item of allItems) {
    let tradeId = getShipmentTradeRecordId(item);
    if (!tradeId) continue;
    addTradeQuantity(shipmentItemQtyByTradeId, tradeId, item.quantity);
    invoiceNosWithShipmentSignal.add(String(item.invoiceNo));
  }

  const fedexRowsByInvoiceNo = new Map<string, FedexShipmentRow[]>();
  for (const shipment of allFedexRows) {
    if (String(shipment.spreadsheetStatus ?? "").trim().toLowerCase() !== "success") continue;
    const invoiceNo = getDeliveryInvoiceNo(shipment.deliveryNo);
    if (!invoiceNo) continue;
    const rows = fedexRowsByInvoiceNo.get(invoiceNo) ?? [];
    rows.push(shipment);
    fedexRowsByInvoiceNo.set(invoiceNo, rows);
    if (parseFedexShipmentItems(shipment.itemsJson).length > 0) {
      invoiceNosWithShipmentSignal.add(invoiceNo);
    }
  }

  const fedexQtyByTradeId = new Map<number, number>();
  for (const [invoiceNo, shipmentRows] of fedexRowsByInvoiceNo) {
    const invoiceTrades = tradesByInvoiceNo.get(invoiceNo) ?? [];
    const allocated = allocateFedexItemsToTradeRows(invoiceTrades, shipmentRows);
    for (const [tradeId, quantity] of allocated) {
      addTradeQuantity(fedexQtyByTradeId, tradeId, quantity);
    }
  }

  const registeredQtyByTradeId = new Map<number, number>();
  const tradeIds = new Set<number>([
    ...Array.from(shipmentItemQtyByTradeId.keys()),
    ...Array.from(fedexQtyByTradeId.keys()),
  ]);
  for (const tradeId of tradeIds) {
    registeredQtyByTradeId.set(tradeId, shipmentItemQtyByTradeId.get(tradeId) ?? 0);
  }

  return {
    shippedQtyByTradeId: shipmentItemQtyByTradeId,
    fedexRegisteredQtyByTradeId: fedexQtyByTradeId,
    registeredQtyByTradeId,
    invoiceNosWithShipmentSignal,
  };
}

function applyTradeShipmentRegistrationStatuses<T extends TradeRow>(
  rows: T[],
  progress: TradeShipmentRegistrationProgress,
) {
  return rows.map((row): T => {
    const invoiceNo = row.no == null ? null : Number(row.no);
    const tradeId = Number(row.id);
    const shipmentQty = progress.shippedQtyByTradeId.get(tradeId) ?? 0;
    const fedexQty = progress.fedexRegisteredQtyByTradeId.get(tradeId) ?? 0;
    const hasActualShipmentQty =
      progress.shippedQtyByTradeId.has(tradeId) || progress.fedexRegisteredQtyByTradeId.has(tradeId);
    const status = deriveTradeShipmentRegistrationStatus({
      status: row.status,
      invoiceNo,
      paymentDate: row.paymentDate,
      orderedQty: toNumber(row.quantity),
      registeredQty: progress.registeredQtyByTradeId.get(tradeId) ?? 0,
      actualShippedQty: hasActualShipmentQty ? Math.max(shipmentQty, fedexQty) : undefined,
      fedexRegisteredQty: fedexQty,
      hasShipmentSignal: invoiceNo !== null && progress.invoiceNosWithShipmentSignal.has(String(invoiceNo)),
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

export const appRouter = router({
  authGate: authGateRouter,
  system: systemRouter,
  inventory: inventoryRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  quoteProxy: router({
    invoiceClientsList: quoteProxyProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(invoiceClients).orderBy(asc(invoiceClients.name));
    }),

    invoicesGetNextNumber: quoteProxyProcedure.query(async () => {
      const db = await getDb();
      if (!db) return generateInvoiceNumber();
      const rows = await db.select({ invoiceNumber: invoices.invoiceNumber }).from(invoices).orderBy(desc(invoices.createdAt));
      let maxNum = 0;
      for (const row of rows) {
        const match = row.invoiceNumber.match(/(\d+)$/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      }
      const next = maxNum + 1;
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `INV-${y}${m}${d}-${String(next).padStart(3, "0")}`;
    }),

    invoicesCreate: quoteProxyProcedure
      .input(z.object({
        invoiceNumber: z.string().min(1),
        clientId: z.number().nullable().optional(),
        clientSnapshot: z.any().optional(),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        currency: z.string().default("EUR"),
        showAmounts: z.boolean().default(false),
        notes: z.string().optional(),
        rawChat: z.string().optional(),
        status: z.enum(["draft", "sent", "paid"]).default("draft"),
        accentColor: z.string().optional(),
        items: z.array(z.object({
          description: z.string().min(1),
          variant: z.string().optional(),
          quantity: z.number().min(0),
          unitPrice: z.number().min(0),
          currency: z.string().optional(),
          sortOrder: z.number().optional(),
          tax: z.number().min(0).optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const existing = await db
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(eq(invoices.invoiceNumber, input.invoiceNumber), isNull(invoices.deletedAt)))
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `インボイス番号 ${input.invoiceNumber} は既に存在します。新規作成し直してください。`,
          });
        }
        const result = await db.insert(invoices).values({
          invoiceNumber: input.invoiceNumber,
          clientId: input.clientId ?? null,
          clientSnapshot: input.clientSnapshot ?? null,
          invoiceDate: input.invoiceDate ?? null,
          dueDate: input.dueDate ?? null,
          currency: input.currency,
          showAmounts: input.showAmounts,
          notes: input.notes ?? null,
          rawChat: input.rawChat ?? null,
          status: input.status,
          accentColor: input.accentColor ?? "#db8b1a",
        });
        const invoiceId = Number(result[0].insertId);

        if (input.items.length > 0) {
          await db.insert(invoiceItems).values(
            input.items.map((item, idx) => ({
              invoiceId,
              description: item.description,
              variant: item.variant ?? null,
              quantity: String(item.quantity),
              unitPrice: String(item.unitPrice),
              currency: item.currency ?? null,
              sortOrder: item.sortOrder ?? idx,
              tax: item.tax !== undefined ? String(item.tax) : "0",
            }))
          );
        }

        return { id: invoiceId };
      }),
  }),

  // Trade data management
  trade: router({
    // ─── DB-backed procedures ─────────────────────────────────────────────────
    /** DB から全取引データを取得する（フィルター・検索対応） */
    listFromDb: protectedProcedure
      .input(z.object({
        search: z.string().optional().default(""),
        year: z.string().optional().default(""),
        monthFrom: z.string().optional().default(""),
        monthTo: z.string().optional().default(""),
        partner: z.string().optional().default(""),
        currency: z.string().optional().default(""),
        status: z.string().optional().default(""),
        incompleteOnly: z.boolean().optional().default(false),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(20).max(5000).optional().default(20),
        sortKey: z.string().optional().default("no"),
        sortDir: z.enum(["asc", "desc", "none"]).optional().default("asc"),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) {
          return {
            rows: [],
            totalCount: 0,
            summary: {
              totalProfit: 0,
              totalSales: 0,
              totalQty: 0,
              partners: 0,
              totalRefund: 0,
              totalShipping: 0,
              totalCustomsDuty: 0,
            },
          };
        }
        await repairKnownEuroRateRows(db);
        const conditions = [];
        if (input.search) {
          // スペースを除去した正規化キーワードで検索（例: "New3DSLL" → "New 3DS LL" にもマッチ）
          const normalized = input.search.replace(/\s+/g, "");
          const q = `%${input.search}%`;
          const qNorm = `%${normalized}%`;
          conditions.push(
            or(
              like(tradeRecords.productName, q),
              like(tradeRecords.partner, q),
              like(tradeRecords.status, q),
              sql`CAST(${tradeRecords.no} AS CHAR) LIKE ${q}`,
              // スペース除去後の商品名と照合
              sql`REPLACE(${tradeRecords.productName}, ' ', '') LIKE ${qNorm}`,
              sql`REPLACE(${tradeRecords.partner}, ' ', '') LIKE ${qNorm}`,
            )
          );
        }
        if (input.year) {
          conditions.push(like(tradeRecords.paymentDate, `${input.year}%`));
        }
        if (input.monthFrom) {
          conditions.push(sql`CAST(${tradeRecords.month} AS UNSIGNED) >= ${parseInt(input.monthFrom)}`);
        }
        if (input.monthTo) {
          conditions.push(sql`CAST(${tradeRecords.month} AS UNSIGNED) <= ${parseInt(input.monthTo)}`);
        }
        if (input.partner) {
          conditions.push(eq(tradeRecords.partner, input.partner));
        }
        if (input.currency) {
          conditions.push(eq(tradeRecords.currency, input.currency));
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const sortColumn = (() => {
          switch (input.sortKey) {
            case "month": return sql`CAST(${tradeRecords.month} AS UNSIGNED)`;
            case "partner": return tradeRecords.partner;
            case "paymentDate": return tradeRecords.paymentDate;
            case "productName": return tradeRecords.productName;
            case "quantity": return tradeRecords.quantity;
            case "unitPrice": return tradeRecords.unitPrice;
            case "currency": return tradeRecords.currency;
            case "unitPriceJPY": return tradeRecords.unitPriceJPY;
            case "status": return tradeRecords.status;
            case "totalSales": return tradeRecords.totalSales;
            case "procurementTotal": return tradeRecords.procurementTotal;
            case "shippingCost": return tradeRecords.shippingCost;
            case "customsDuty": return tradeRecords.customsDuty;
            case "profitWithRefund": return tradeRecords.profitWithRefund;
            default: return tradeRecords.no;
          }
        })();
        const orderExpr = input.sortDir === "desc" ? desc(sortColumn) : asc(sortColumn);
        const offset = (input.page - 1) * input.pageSize;
        const toNumber = (value: unknown) => Number(value ?? 0) || 0;
        const [sheetProgress, invoiceMemos] = await Promise.all([
          getSheetShipmentProgressByInvoice().catch((error) => {
            console.warn("[Trade] Failed to load sheet shipment progress", error);
            return null;
          }),
          getAllInvoiceMemos().catch((error) => {
            console.warn("[Trade] Failed to load manual complete invoice memos", error);
            return [];
          }),
        ]);
        const manualCompleteSet = new Set<string>(
          invoiceMemos
            .filter((memo) => memo.colorKey === "__manual_complete__" && memo.memo === "1")
            .map((memo) => memo.invoiceKey),
        );
        const baseRowsFromDb = whereClause
          ? await db.select().from(tradeRecords).where(whereClause).orderBy(orderExpr)
          : await db.select().from(tradeRecords).orderBy(orderExpr);
        const baseRows = await applyDisplayedEuroRateRepairs(db, baseRowsFromDb);
        const rowsWithSheetStatus = sheetProgress
          ? applySheetShipmentStatuses(baseRows, sheetProgress)
          : baseRows;
        const rowsWithManualCompleteStatus = applyManualCompleteTradeStatuses(rowsWithSheetStatus, manualCompleteSet);
        const shipmentRegistrationProgress = await getTradeShipmentRegistrationProgress(db, rowsWithManualCompleteStatus);
        const rowsWithShipmentRegistrationStatus = applyTradeShipmentRegistrationStatuses(
          rowsWithManualCompleteStatus,
          shipmentRegistrationProgress,
        );
        const rowsWithComputedStatus = applyClosedTradeYearStatuses(rowsWithShipmentRegistrationStatus);
        const statusFilter = input.status.trim().toLowerCase();
        const statusFilteredRows = statusFilter
          ? rowsWithComputedStatus.filter((row) => {
              const rowStatus = String(row.status ?? "").trim();
              return rowStatus === input.status || (isTradeStatusComplete(input.status) && isTradeStatusComplete(rowStatus));
            })
          : rowsWithComputedStatus;
        const matchingRows = input.incompleteOnly
          ? statusFilteredRows.filter((row) => !isTradeStatusComplete(row.status))
          : statusFilteredRows;
        const rows = matchingRows.slice(offset, offset + input.pageSize);
        const completedRowsForProfit = matchingRows.filter((row) => isTradeStatusComplete(row.status));
        const partnerCount = new Set(
          matchingRows
            .map((row) => row.partner?.trim())
            .filter((partner): partner is string => !!partner),
        ).size;
        return {
          rows,
          totalCount: matchingRows.length,
          summary: {
            totalProfit: completedRowsForProfit.reduce((sum, row) => sum + toNumber(row.profitWithRefund), 0),
            totalSales: matchingRows.reduce((sum, row) => sum + toNumber(row.totalSales), 0),
            totalQty: matchingRows.reduce((sum, row) => sum + toNumber(row.quantity), 0),
            partners: partnerCount,
            totalRefund: matchingRows.reduce((sum, row) => sum + toNumber(row.refund), 0),
            totalShipping: matchingRows.reduce((sum, row) => sum + toNumber(row.shippingCost), 0),
            totalCustomsDuty: matchingRows.reduce((sum, row) => sum + toNumber(row.customsDuty), 0),
          },
        };
      }),

    /** DB の取引データを更新する */
    updateInDb: protectedProcedure
      .input(z.object({
        id: z.number(),
        month: z.string().optional(),
        partner: z.string().optional(),
        paymentDate: z.string().optional(),
        productName: z.string().optional(),
        quantity: z.number().optional(),
        unitPrice: z.number().optional(),
        currency: z.string().optional(),
        status: z.string().optional(),
        procurement: z.string().optional(),
        shippingFromTokyo: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const { id, ...fields } = input;
        const updateData: Record<string, unknown> = {};
        if (fields.month !== undefined) updateData.month = fields.month;
        if (fields.partner !== undefined) updateData.partner = fields.partner;
        if (fields.paymentDate !== undefined) updateData.paymentDate = fields.paymentDate;
        if (fields.productName !== undefined) updateData.productName = fields.productName;
        if (fields.quantity !== undefined) updateData.quantity = String(fields.quantity);
        if (fields.unitPrice !== undefined) updateData.unitPrice = String(fields.unitPrice);
        if (fields.currency !== undefined) updateData.currency = fields.currency;
        if (fields.status !== undefined) updateData.status = fields.status;
        if (fields.procurement !== undefined) updateData.procurement = fields.procurement;
        if (fields.shippingFromTokyo !== undefined) updateData.shippingFromTokyo = fields.shippingFromTokyo;
        await db.update(tradeRecords).set(updateData).where(eq(tradeRecords.id, id));
        return { success: true };
      }),

    /** DB の取引データを削除する */
    deleteFromDb: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.delete(tradeRecords).where(eq(tradeRecords.id, input.id));
        return { success: true };
      }),

    /** DB の取引データの支払日を一括更新する */
    bulkUpdatePaymentDate: protectedProcedure
      .input(z.object({
        ids: z.array(z.number().int().positive()).min(1).max(500),
        paymentDate: z.string().trim().min(1).max(64),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not available" });

        const ids = Array.from(new Set(input.ids));
        const targets = await db.select({ id: tradeRecords.id })
          .from(tradeRecords)
          .where(inArray(tradeRecords.id, ids));
        const targetIds = targets.map((row) => row.id);
        if (targetIds.length === 0) {
          return { success: true, updatedCount: 0, requestedCount: ids.length };
        }

        await db.update(tradeRecords)
          .set({ paymentDate: input.paymentDate })
          .where(inArray(tradeRecords.id, targetIds));

        return { success: true, updatedCount: targetIds.length, requestedCount: ids.length };
      }),

    /** DB のフィルター用ユニーク値を取得する */
    getFilterOptions: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { years: [], partners: [], currencies: [], statuses: [] };
      const [yearRows, partnerRows, currencyRows, statusRows] = await Promise.all([
        db.selectDistinct({ value: sql<string>`SUBSTRING(${tradeRecords.paymentDate}, 1, 4)` })
          .from(tradeRecords)
          .where(isNotNull(tradeRecords.paymentDate)),
        db.selectDistinct({ value: tradeRecords.partner })
          .from(tradeRecords)
          .where(isNotNull(tradeRecords.partner)),
        db.selectDistinct({ value: tradeRecords.currency })
          .from(tradeRecords)
          .where(isNotNull(tradeRecords.currency)),
        db.selectDistinct({ value: tradeRecords.status })
          .from(tradeRecords)
          .where(isNotNull(tradeRecords.status)),
      ]);
      const toOptions = (rows: Array<{ value: string | null }>) =>
        rows.map((r) => r.value?.trim()).filter((v): v is string => !!v).sort();
      const years = toOptions(yearRows);
      const partners = toOptions(partnerRows);
      const currencies = toOptions(currencyRows);
      const statuses = toOptions(statusRows);
      const monthRows = await db.selectDistinct({ value: tradeRecords.month })
        .from(tradeRecords)
        .where(isNotNull(tradeRecords.month));
      const months = toOptions(monthRows).sort((a, b) => parseInt(a) - parseInt(b));
      return { years, months, partners, currencies, statuses };
    }),

    getSheetTabs: protectedProcedure.query(async () => {
      if (!canSyncTradeSheet()) {
        return { configured: false as const, spreadsheetId: TRADE_VIEW_SPREADSHEET_ID, tabs: [] };
      }
      const sheets = getSheetsClient();
      const metadata = await sheets.spreadsheets.get({
        spreadsheetId: TRADE_VIEW_SPREADSHEET_ID,
        fields: "spreadsheetId,spreadsheetUrl,sheets.properties(title,index,hidden,gridProperties(rowCount,columnCount))",
      }).catch((error) => {
        throw getSheetsAccessError(error, TRADE_VIEW_SPREADSHEET_ID);
      });
      const tabs = (metadata.data.sheets ?? [])
        .map((sheet) => ({
          title: sheet.properties?.title ?? "",
          index: sheet.properties?.index ?? 0,
          hidden: sheet.properties?.hidden ?? false,
          rowCount: sheet.properties?.gridProperties?.rowCount ?? 0,
          columnCount: sheet.properties?.gridProperties?.columnCount ?? 0,
        }))
        .filter(isTradeViewSheet)
        .sort((a, b) => a.index - b.index);
      return {
        configured: true as const,
        spreadsheetId: metadata.data.spreadsheetId ?? TRADE_VIEW_SPREADSHEET_ID,
        spreadsheetUrl: metadata.data.spreadsheetUrl ?? `https://docs.google.com/spreadsheets/d/${TRADE_VIEW_SPREADSHEET_ID}/edit`,
        tabs,
      };
    }),

    getSheetView: protectedProcedure
      .input(z.object({
        sheetName: z.string().optional().default(TRADE_VIEW_DEFAULT_SHEET_NAME),
        startRow: z.number().int().min(1).max(10000).optional().default(1),
        maxRows: z.number().int().min(10).max(300).optional().default(140),
        maxColumns: z.number().int().min(6).max(225).optional().default(140),
        focusColumn: z.number().int().min(1).max(225).optional(),
      }))
      .query(async ({ input }) => {
        const sheetName = input.sheetName?.trim() || TRADE_VIEW_DEFAULT_SHEET_NAME;
        const { sheets, sheet } = await assertTradeSheetExists(sheetName, TRADE_VIEW_SPREADSHEET_ID);
        const totalColumnCount = Math.min(sheet.gridProperties?.columnCount ?? input.maxColumns, 225);
        const totalRowCount = sheet.gridProperties?.rowCount ?? input.maxRows;
        const startRow = Math.min(input.startRow, Math.max(totalRowCount, 1));
        const rowCount = Math.min(input.maxRows, Math.max(totalRowCount - startRow + 1, 0));
        const endRow = Math.max(startRow, startRow + rowCount - 1);

        const focusColumn = input.focusColumn ? Math.min(input.focusColumn, totalColumnCount) : undefined;
        const fixedEndColumn = Math.min(7, totalColumnCount);
        const focusWindowStart = focusColumn && focusColumn > input.maxColumns
          ? Math.max(fixedEndColumn + 1, focusColumn - 6)
          : 0;
        const focusWindowEnd = focusColumn && focusWindowStart > 0
          ? Math.min(totalColumnCount, focusColumn + 10)
          : 0;

        const ranges = focusWindowStart > 0
          ? [
              { startColumn: 1, endColumn: fixedEndColumn },
              { startColumn: focusWindowStart, endColumn: focusWindowEnd },
            ]
          : [
              { startColumn: 1, endColumn: Math.min(totalColumnCount, input.maxColumns) },
            ];
        const frozenRowCount = Math.min(3, totalRowCount);
        const rangeToA1 = (range: { startColumn: number; endColumn: number }, fromRow: number, toRow: number) => {
          const startColumnName = spreadsheetColumnName(range.startColumn);
          const endColumnName = spreadsheetColumnName(range.endColumn);
          return `${quoteSheetName(sheetName)}!${startColumnName}${fromRow}:${endColumnName}${toRow}`;
        };
        const frozenRanges = frozenRowCount > 0
          ? ranges.map((range) => rangeToA1(range, 1, frozenRowCount))
          : [];
        const bodyRanges = ranges.map((range) => rangeToA1(range, startRow, endRow));
        const response = await sheets.spreadsheets.values.batchGet({
          spreadsheetId: TRADE_VIEW_SPREADSHEET_ID,
          ranges: [...frozenRanges, ...bodyRanges],
          valueRenderOption: "FORMATTED_VALUE",
        }).catch((error) => {
          throw getSheetsAccessError(error, TRADE_VIEW_SPREADSHEET_ID);
        });
        const columnIndexes = ranges.flatMap((range) =>
          Array.from({ length: range.endColumn - range.startColumn + 1 }, (_, index) => range.startColumn + index)
        );
        const valueRanges = response.data.valueRanges ?? [];
        const frozenValueRanges = valueRanges.slice(0, frozenRanges.length);
        const bodyValueRanges = valueRanges.slice(frozenRanges.length);
        const frozenRows = Array.from({ length: frozenRowCount }, (_, rowIndex) =>
          frozenValueRanges.flatMap((valueRange, rangeIndex) => {
            const expectedLength = ranges[rangeIndex].endColumn - ranges[rangeIndex].startColumn + 1;
            const row = valueRange.values?.[rowIndex] ?? [];
            return Array.from({ length: expectedLength }, (_, columnIndex) => String(row[columnIndex] ?? ""));
          })
        );
        const rows = Array.from({ length: rowCount }, (_, rowIndex) =>
          bodyValueRanges.flatMap((valueRange, rangeIndex) => {
            const expectedLength = ranges[rangeIndex].endColumn - ranges[rangeIndex].startColumn + 1;
            const row = valueRange.values?.[rowIndex] ?? [];
            return Array.from({ length: expectedLength }, (_, columnIndex) => String(row[columnIndex] ?? ""));
          })
        );
        return {
          sheetName,
          startRow,
          rowCount,
          totalRowCount,
          columnCount: columnIndexes.length,
          totalColumnCount,
          columnIndexes,
          frozenRows,
          rows,
        };
      }),

    updateSheetCell: protectedProcedure
      .input(z.object({
        sheetName: z.string().min(1),
        row: z.number().int().min(1).max(10000),
        column: z.number().int().min(1).max(225),
        value: z.string().max(2000),
      }))
      .mutation(async ({ input }) => {
        const { sheets } = await assertTradeSheetExists(input.sheetName, TRADE_VIEW_SPREADSHEET_ID);
        const cell = `${spreadsheetColumnName(input.column)}${input.row}`;
        await sheets.spreadsheets.values.update({
          spreadsheetId: TRADE_VIEW_SPREADSHEET_ID,
          range: `${quoteSheetName(input.sheetName)}!${cell}`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [[input.value]] },
        }).catch((error) => {
          throw getSheetsAccessError(error, TRADE_VIEW_SPREADSHEET_ID);
        });
        tradeShipmentProgressCache = null;
        return { success: true, cell };
      }),

    findTradeViewInvoiceCell: protectedProcedure
      .input(z.object({ invoiceNo: z.string().min(1) }))
      .query(async ({ input }) => {
        const invoiceNo = input.invoiceNo.trim();
        const sheets = getSheetsClient();
        const metadata = await sheets.spreadsheets.get({
          spreadsheetId: TRADE_VIEW_SPREADSHEET_ID,
          fields: "sheets.properties(title,index,hidden,gridProperties(columnCount))",
        }).catch((error) => {
          throw getSheetsAccessError(error, TRADE_VIEW_SPREADSHEET_ID);
        });
        const tabs = (metadata.data.sheets ?? [])
          .map((sheet) => ({
            title: sheet.properties?.title ?? "",
            index: sheet.properties?.index ?? 0,
            hidden: sheet.properties?.hidden ?? false,
            columnCount: sheet.properties?.gridProperties?.columnCount ?? 225,
          }))
          .filter(isTradeViewSheet)
          .sort((a, b) => a.index - b.index);
        if (tabs.length === 0) return { found: false as const };

        const response = await sheets.spreadsheets.values.batchGet({
          spreadsheetId: TRADE_VIEW_SPREADSHEET_ID,
          ranges: tabs.map((tab) => `${quoteSheetName(tab.title)}!B:B`),
          valueRenderOption: "FORMATTED_VALUE",
        }).catch((error) => {
          throw getSheetsAccessError(error, TRADE_VIEW_SPREADSHEET_ID);
        });

        for (let tabIndex = 0; tabIndex < tabs.length; tabIndex++) {
          const rows = response.data.valueRanges?.[tabIndex]?.values ?? [];
          for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
            const cell = String(rows[rowIndex]?.[0] ?? "").trim();
            if (cell === invoiceNo) {
              const rowNumber = rowIndex + 1;
              const maxColumn = Math.min(tabs[tabIndex].columnCount || 225, 225);
              const rowResponse = await sheets.spreadsheets.values.get({
                spreadsheetId: TRADE_VIEW_SPREADSHEET_ID,
                range: `${quoteSheetName(tabs[tabIndex].title)}!A${rowNumber}:${spreadsheetColumnName(maxColumn)}${rowNumber}`,
                valueRenderOption: "FORMATTED_VALUE",
              }).catch((error) => {
                throw getSheetsAccessError(error, TRADE_VIEW_SPREADSHEET_ID);
              });
              const rowValues = rowResponse.data.values?.[0] ?? [];
              const quantityCell = rowValues
                .map((value, index) => ({ column: index + 1, value: String(value ?? "").trim() }))
                .filter((entry) => entry.column > 7 && /^\d+(?:\.\d+)?$/.test(entry.value.replace(/,/g, "")) && Number(entry.value.replace(/,/g, "")) > 0)
                .at(-1);
              return {
                found: true as const,
                sheetName: tabs[tabIndex].title,
                row: rowNumber,
                column: 2,
                focusColumn: quantityCell?.column ?? 2,
                focusValue: quantityCell?.value ?? "",
              };
            }
          }
        }
        return { found: false as const };
      }),

    // ─── Spreadsheet-backed procedures (kept for write-back) ─────────────────
    getExchangeRates: protectedProcedure.query(async () => {
      const sheets = getSheetsClient();
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!G1:H2`,
      });
      const rows = response.data.values ?? [];
      const eurRate = parseFloat(rows[0]?.[0] ?? "0");
      const usdRate = parseFloat(rows[1]?.[0] ?? "0");
      return { eur: eurRate, usd: usdRate };
    }),

    getRateByDate: protectedProcedure
      .input(z.object({
        date: z.string(), // YYYY-MM-DD or "latest"
        currency: z.enum(["EUR", "USD"]),
      }))
      .query(async ({ input }) => {
        const endpoint = input.date === "latest"
          ? `https://api.frankfurter.dev/v1/latest?base=${input.currency}&symbols=JPY`
          : `https://api.frankfurter.dev/v1/${input.date}?base=${input.currency}&symbols=JPY`;
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
        const data = await res.json() as { rates: { JPY?: number } };
        const rate = data.rates?.JPY;
        if (!rate) throw new Error("JPY rate not found");
        return { rate };
      }),

    findRowByInvoiceNo: protectedProcedure
      .input(z.object({ invoiceNo: z.string() }))
      .query(async ({ input }) => {
        const sheets = getSheetsClient();
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!C:C`,
        });
        const rows = response.data.values ?? [];
        for (let i = 3; i < rows.length; i++) {
          const cell = String(rows[i]?.[0] ?? "").trim();
          if (cell === input.invoiceNo.trim()) {
            return { rowIndex: i + 1 };
          }
        }
        return { rowIndex: null };
      }),

    updateRecord: protectedProcedure
      .input(z.object({
        id: z.number().int().positive().optional(),
        invoiceNo: z.string().min(1),
        month: z.number().min(1).max(12),
        partner: z.string().min(1),
        paymentDate: z.string(),
        productName: z.string().min(1),
        customsDuty: z.number().optional(),
        quantity: z.number().min(1),
        unitPrice: z.number().min(0),
        currency: z.enum(["ユーロ", "ドル"]),
        status: z.string().default(""),
        eurRate: z.number().optional(),
        usdRate: z.number().optional(),
        procurementTotal: z.number().default(0),
        refund: z.number().default(0),
        shippingCost: z.number().default(0),
      }))
      .mutation(async ({ input }) => {
        const no = parseInt(input.invoiceNo) || null;
        const paymentDate = input.paymentDate && input.paymentDate.trim() !== ""
          ? input.paymentDate
          : null;
        const currency = inferTradeCurrencyForPartner(input.partner, input.currency);
        const db = await getDb();
        let existing: TradeRow[] = [];
        let target: TradeRow | undefined;
        if (db && input.id) {
          [target] = await db.select().from(tradeRecords)
            .where(eq(tradeRecords.id, input.id))
            .limit(1);
        }
        const lookupNo = Number(target?.no ?? no);
        const lookupInvoiceNo = Number.isFinite(lookupNo) && lookupNo > 0
          ? String(lookupNo)
          : input.invoiceNo.trim();
        if (db && lookupNo !== null && Number.isFinite(lookupNo) && lookupNo > 0) {
          existing = await db.select().from(tradeRecords)
            .where(eq(tradeRecords.no, lookupNo))
            .orderBy(asc(tradeRecords.id));
          if (target) {
            target = existing.find(r => r.id === target!.id) ?? target;
          } else {
            target = existing.find(r => r.productName === input.productName);
          }
          target ??= existing[0];
        }

        if (!TRADE_SHEET_WRITE_BACK_ENABLED || !canSyncTradeSheet()) {
          if (db) {
            if (no === null) return { success: true, updatedRow: null, sheetSync: "skipped" as const };
            if (target) {
              const shouldRecalculateSales =
                changedNumber(target.quantity, input.quantity) ||
                changedNumber(target.unitPrice, input.unitPrice) ||
                normalizeTradeCurrency(target.currency) !== normalizeTradeCurrency(currency);
              const normalizedRate = selectTradeRate(currency, input.eurRate, input.usdRate);
              const unitPriceJPY = shouldRecalculateSales && normalizedRate ? Math.round(input.unitPrice * normalizedRate * 10000) / 10000 : null;
              const totalSalesNew = unitPriceJPY ? Math.round(input.quantity * unitPriceJPY * 10000) / 10000 : null;
              const effectiveTotalSales = totalSalesNew ?? Number(target.totalSales ?? 0);
              const customsDuty = input.customsDuty !== undefined
                ? input.customsDuty
                : Number(target.customsDuty ?? 0);
              const profitWithRefund = effectiveTotalSales > 0
                ? Math.round((effectiveTotalSales - input.procurementTotal + input.refund - input.shippingCost - customsDuty) * 10000) / 10000
                : null;
              await db.update(tradeRecords)
                .set({
                  month: String(input.month),
                  partner: input.partner,
                  paymentDate,
                  productName: input.productName,
                  quantity: String(input.quantity),
                  unitPrice: String(input.unitPrice),
                  currency,
                  status: input.status,
                  ...(unitPriceJPY !== null ? { unitPriceJPY: String(unitPriceJPY) } : {}),
                  ...(totalSalesNew !== null ? { totalSales: String(totalSalesNew) } : {}),
                  procurementTotal: String(input.procurementTotal),
                  refund: String(input.refund),
                  shippingCost: String(input.shippingCost),
                  customsDuty: String(customsDuty),
                  ...(profitWithRefund !== null ? { profitWithRefund: String(profitWithRefund) } : {}),
                })
                .where(eq(tradeRecords.id, target.id));
            }
          }
          return { success: true, updatedRow: null, sheetSync: "skipped" as const };
        }
        const sheets = getSheetsClient();
        // C列(インボイスNo)とE列(商品名)を同時取得し、インボイスNo+商品名で行を特定
        const searchResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!C:E`,
        });
        const rows = searchResponse.data.values ?? [];
        let targetRow: number | null = null;
        let fallbackByCurrentProduct: number | null = null;
        let fallbackByNewProduct: number | null = null;
        let fallbackByInvoice: number | null = null;
        const targetOccurrenceIndex = target ? existing.findIndex((row) => row.id === target!.id) : -1;
        let currentInvoiceNo = "";
        let invoiceOccurrenceIndex = -1;
        for (let i = 3; i < rows.length; i++) {
          const rawInvoiceCell = String(rows[i]?.[0] ?? "").trim();
          if (/^\d+$/.test(rawInvoiceCell)) {
            currentInvoiceNo = rawInvoiceCell;
          } else if (rawInvoiceCell) {
            currentInvoiceNo = "";
          }
          const invoiceCell = currentInvoiceNo;
          const productCell = String(rows[i]?.[2] ?? "").trim();
          if (invoiceCell !== lookupInvoiceNo) continue;
          invoiceOccurrenceIndex++;
          if (targetOccurrenceIndex >= 0 && invoiceOccurrenceIndex === targetOccurrenceIndex) {
            targetRow = i + 1;
            break;
          }
          if (fallbackByInvoice === null) fallbackByInvoice = i + 1;
          if (target?.productName && productCell === String(target.productName).trim()) {
            fallbackByCurrentProduct ??= i + 1;
          }
          if (productCell === input.productName.trim()) {
            fallbackByNewProduct ??= i + 1;
          }
        }
        // 商品名で見つからない場合はインボイスNoのみで最初の行を使用
        targetRow ??= fallbackByCurrentProduct ?? fallbackByNewProduct ?? fallbackByInvoice;
        if (targetRow === null) {
          throw new Error(`インボイスNo. ${lookupInvoiceNo} の行が見つかりませんでした。`);
        }
        // A〜H列（商品価格(円)のI列は数式のため書き込まない）とJ列（状況）を別々に更新
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: [
              {
                range: `${SHEET_NAME}!A${targetRow}:H${targetRow}`,
                values: [[
                  input.month,
                  input.partner,
                  input.invoiceNo,
                  input.paymentDate,
                  input.productName,
                  input.quantity,
                  input.unitPrice,
                  currency,
                ]],
              },
              {
                range: `${SHEET_NAME}!J${targetRow}`,
                values: [[input.status]],
              },
            ],
          },
        });

        // DBも同時更新
        if (db && target) {
          // noが一致するレコードを更新（noが同じ行が複数ある場合は商品名でも絞り込む）
          if (no === null) return { success: false, updatedRow: targetRow };
            // 商品名が一致するレコードを更新、なければ最初のレコードを更新
            // 商品価格(円)・売上合計・還付込利益を自動計算
            const normalizedRate = selectTradeRate(currency, input.eurRate, input.usdRate);
            const shouldRecalculateSales =
              changedNumber(target.quantity, input.quantity) ||
              changedNumber(target.unitPrice, input.unitPrice) ||
              normalizeTradeCurrency(target.currency) !== normalizeTradeCurrency(currency);
            const unitPriceJPY = shouldRecalculateSales && normalizedRate ? Math.round(input.unitPrice * normalizedRate * 10000) / 10000 : null;
            const totalSalesNew = unitPriceJPY ? Math.round(input.quantity * unitPriceJPY * 10000) / 10000 : null;
            // 為替レートが未取得の場合はDBの既存totalSalesを使って利益を計算する
            const effectiveTotalSales = totalSalesNew ?? Number(target.totalSales ?? 0);
            // 関税: 入力値があればそれを使用、なければ既存DB値を維持
            const customsDuty = input.customsDuty !== undefined
              ? input.customsDuty
              : Number(target.customsDuty ?? 0);
            const profitWithRefund = effectiveTotalSales > 0
              ? Math.round((effectiveTotalSales - input.procurementTotal + input.refund - input.shippingCost - customsDuty) * 10000) / 10000
              : null;

            await db.update(tradeRecords)
              .set({
                month: String(input.month),
                partner: input.partner,
                paymentDate,
                productName: input.productName,
                quantity: String(input.quantity),
                unitPrice: String(input.unitPrice),
                currency,
                status: input.status,
                ...(unitPriceJPY !== null ? { unitPriceJPY: String(unitPriceJPY) } : {}),
                ...(totalSalesNew !== null ? { totalSales: String(totalSalesNew) } : {}),
                procurementTotal: String(input.procurementTotal),
                refund: String(input.refund),
                shippingCost: String(input.shippingCost),
                customsDuty: String(customsDuty),
                ...(profitWithRefund !== null ? { profitWithRefund: String(profitWithRefund) } : {}),
              })
              .where(eq(tradeRecords.id, target.id));
        }

        return { success: true, updatedRow: targetRow };
      }),

    addRecord: protectedProcedure
      .input(z.object({
        month: z.number().min(1).max(12),
        partner: z.string().min(1),
        invoiceNo: z.string().min(1),
        paymentDate: z.string().optional().default(""),
        productName: z.string().min(1),
        quantity: z.number().min(1),
        unitPrice: z.number().min(0),
        currency: z.enum(["ユーロ", "ドル"]),
        status: z.string().default(""),
        eurRate: z.number().min(0),
        usdRate: z.number().min(0),
        shippingCost: z.number().default(0),
      }))
      .mutation(async ({ input }) => {
        const currency = inferTradeCurrencyForPartner(input.partner, input.currency);
        if (!TRADE_SHEET_WRITE_BACK_ENABLED || !canSyncTradeSheet()) {
          const db = await getDb();
          if (db) {
            const no = parseInt(input.invoiceNo) || null;
            const selectedRate = selectTradeRate(currency, input.eurRate, input.usdRate) ?? 0;
            const unitPriceJPY = input.unitPrice * selectedRate;
            const totalSales = unitPriceJPY * input.quantity;
            const paymentDate = input.paymentDate && input.paymentDate.trim() !== ""
              ? input.paymentDate
              : null;
            await db.insert(tradeRecords).values({
              month: String(input.month),
              partner: input.partner,
              no,
              paymentDate,
              productName: input.productName,
              quantity: String(input.quantity),
              unitPrice: String(input.unitPrice),
              currency,
              unitPriceJPY: String(unitPriceJPY),
              status: input.status,
              procurement: "",
              shippingFromTokyo: "",
              totalSales: String(totalSales),
              procurementTotal: "0",
              refund: "0",
              shippingCost: String(input.shippingCost),
              profitWithRefund: String(totalSales - input.shippingCost),
              cumulativeProfit: "0",
            });
          }
          return { success: true, sheetSync: "skipped" as const };
        }
        const sheets = getSheetsClient();
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: [
              { range: `${SHEET_NAME}!G1`, values: [[input.eurRate]] },
              { range: `${SHEET_NAME}!G2`, values: [[input.usdRate]] },
            ],
          },
        });
        // 現在の最終行番号を取得して、追加後の行番号を計算する
        const existingData = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A:A`,
        });
        const existingRows = existingData.data.values ?? [];
        const newRowNumber = existingRows.length + 1; // 追加後の行番号
        const rateCell = normalizeTradeCurrency(currency) === "EUR" ? "$G$1" : "$G$2";

        const newRow = [
          input.month,
          input.partner,
          input.invoiceNo,
          input.paymentDate,
          input.productName,
          input.quantity,
          input.unitPrice,
          currency,
          `=G${newRowNumber}*${rateCell}`, // I列: 商品価格 = 単価 × 通貨別レート
          input.status,
        ];
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A:J`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [newRow] },
        });

        // DBにも同時保存
        const db = await getDb();
        if (db) {
          const no = parseInt(input.invoiceNo) || null;
          const selectedRate = selectTradeRate(currency, input.eurRate, input.usdRate) ?? 0;
          const unitPriceJPY = input.unitPrice * selectedRate;
          const totalSales = unitPriceJPY * input.quantity;
          const paymentDate = input.paymentDate && input.paymentDate.trim() !== ""
            ? input.paymentDate
            : null;
          await db.insert(tradeRecords).values({
            month: String(input.month),
            partner: input.partner,
            no,
            paymentDate,
            productName: input.productName,
            quantity: String(input.quantity),
            unitPrice: String(input.unitPrice),
            currency,
            unitPriceJPY: String(unitPriceJPY),
            status: input.status,
            procurement: "",
            shippingFromTokyo: "",
            totalSales: String(totalSales),
            procurementTotal: "0",
            refund: "0",
            shippingCost: String(input.shippingCost),
            profitWithRefund: String(totalSales - input.shippingCost),
            cumulativeProfit: "0",
          });
        }

        return { success: true };
      }),
  }),

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
  shipment: router({
    /** 全発送記録を取得（明細付き） */
    list: protectedProcedure.query(async () => {
      const db = (await getDb())!;
      const rows = await db.select().from(shipments).orderBy(desc(shipments.shippingDate));
      const items = await db.select().from(shipmentItems);
      const tradeRecordIds = Array.from(new Set(items.map((i) => i.tradeRecordId).filter((id): id is number => typeof id === "number" && id > 0)));
      const tradeRows = tradeRecordIds.length > 0
        ? await db
            .select({ id: tradeRecords.id, productName: tradeRecords.productName })
            .from(tradeRecords)
            .where(inArray(tradeRecords.id, tradeRecordIds))
        : [];
      const productNameByTradeId = new Map(tradeRows.map((row) => [row.id, row.productName ?? ""]));
      return rows.map((s) => ({
        ...s,
        items: items
          .filter((i) => i.shipmentId === s.id)
          .map((i) => ({ ...i, productName: i.tradeRecordId ? productNameByTradeId.get(i.tradeRecordId) ?? null : null })),
      }));
    }),

    /** インボイスNoの発注数合計・発送済み数・残数を返す */
    invoiceSummary: protectedProcedure
      .input(z.object({ invoiceNo: z.number() }))
      .query(async ({ input }) => {
        const db = (await getDb())!;
        // 同一インボイスNoの全商品の発注数合計
        const trades = await db
          .select({
            id: tradeRecords.id,
            productName: tradeRecords.productName,
            quantity: tradeRecords.quantity,
          })
          .from(tradeRecords)
          .where(eq(tradeRecords.no, input.invoiceNo))
          .orderBy(asc(tradeRecords.id));
        const orderedQty = trades.reduce((sum, t) => sum + Number(t.quantity ?? 0), 0);
        // 発送済み合計
        const items = await db
          .select({
            quantity: shipmentItems.quantity,
            tradeRecordId: shipmentItems.tradeRecordId,
          })
          .from(shipmentItems)
          .where(eq(shipmentItems.invoiceNo, input.invoiceNo));
        const shippedByTradeId = new Map<number, number>();
        let unassignedShippedQty = 0;
        for (const item of items) {
          if (item.tradeRecordId) {
            shippedByTradeId.set(item.tradeRecordId, (shippedByTradeId.get(item.tradeRecordId) ?? 0) + item.quantity);
          } else {
            unassignedShippedQty += item.quantity;
          }
        }
        const itemSummaries = trades.map((trade) => {
          const ordered = Number(trade.quantity ?? 0);
          const shipped = shippedByTradeId.get(trade.id) ?? 0;
          return {
            tradeRecordId: trade.id,
            productName: trade.productName ?? "",
            orderedQty: ordered,
            shippedQty: shipped,
            remainingQty: Math.max(0, ordered - shipped),
          };
        });
        const shippedQty = itemSummaries.reduce((sum, item) => sum + item.shippedQty, 0);
        return {
          invoiceNo: input.invoiceNo,
          orderedQty,
          shippedQty,
          remainingQty: Math.max(0, orderedQty - shippedQty),
          isComplete: orderedQty > 0 && shippedQty >= orderedQty,
          unassignedShippedQty,
          items: itemSummaries,
        };
      }),

    /** 特定インボイスの発送記録を取得 */
    byInvoice: protectedProcedure
      .input(z.object({ invoiceNo: z.number() }))
      .query(async ({ input }) => {
        const db = (await getDb())!;
        const items = await db
          .select()
          .from(shipmentItems)
          .where(eq(shipmentItems.invoiceNo, input.invoiceNo));
        if (items.length === 0) return [];
        const tradeRecordIds = Array.from(new Set(items.map((i) => i.tradeRecordId).filter((id): id is number => typeof id === "number" && id > 0)));
        const tradeRows = tradeRecordIds.length > 0
          ? await db
              .select({ id: tradeRecords.id, productName: tradeRecords.productName })
              .from(tradeRecords)
              .where(inArray(tradeRecords.id, tradeRecordIds))
          : [];
        const productNameByTradeId = new Map(tradeRows.map((row) => [row.id, row.productName ?? ""]));
        const shipmentIds = Array.from(new Set(items.map((i) => i.shipmentId)));
        const result: Array<
          typeof shipments.$inferSelect & {
            allocationTotalQty?: number;
            allocationShippingCost?: number;
            items: Array<typeof shipmentItems.$inferSelect & { productName?: string | null }>;
          }
        > = [];
        for (const sid of shipmentIds) {
          const [s] = await db.select().from(shipments).where(eq(shipments.id, sid));
          if (s) {
            const allItems = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, sid));
            result.push({
              ...s,
              items: allItems.map((item) => ({
                ...item,
                productName: item.tradeRecordId ? productNameByTradeId.get(item.tradeRecordId) ?? null : null,
              })),
            });
          }
        }
        const trackingNumbers = new Set(
          result
            .map((shipment) => normalizeShipmentTrackingNumber(shipment.trackingNumber))
            .filter((trackingNumber) => trackingNumber.length > 0)
        );
        const relatedShipments = trackingNumbers.size > 0
          ? (await db.select().from(shipments)).filter((shipment) => {
              const trackingNumber = normalizeShipmentTrackingNumber(shipment.trackingNumber);
              return shipmentIds.includes(shipment.id) || (trackingNumber.length > 0 && trackingNumbers.has(trackingNumber));
            })
          : result;
        const relatedShipmentIds = Array.from(new Set(relatedShipments.map((shipment) => shipment.id)));
        const relatedShipmentItems = relatedShipmentIds.length > 0
          ? await db.select().from(shipmentItems).where(inArray(shipmentItems.shipmentId, relatedShipmentIds))
          : [];
        const shipmentById = new Map(relatedShipments.map((shipment) => [shipment.id, shipment]));
        const groupStats = new Map<string, { totalQty: number; shippingCost: number }>();
        for (const shipment of relatedShipments) {
          const key = getShipmentAllocationGroupKey(shipment);
          const group = groupStats.get(key) ?? { totalQty: 0, shippingCost: 0 };
          const shippingCost = toNumber(shipment.shippingCost);
          if (shippingCost > 0) {
            group.shippingCost = Math.max(group.shippingCost, shippingCost);
          }
          groupStats.set(key, group);
        }
        for (const item of relatedShipmentItems) {
          const shipment = shipmentById.get(item.shipmentId);
          if (!shipment) continue;
          const group = groupStats.get(getShipmentAllocationGroupKey(shipment));
          if (!group) continue;
          group.totalQty += item.quantity;
        }
        return result
          .map((shipment) => {
            const group = groupStats.get(getShipmentAllocationGroupKey(shipment));
            return {
              ...shipment,
              allocationTotalQty: group?.totalQty ?? shipment.items.reduce((sum, item) => sum + item.quantity, 0),
              allocationShippingCost: group?.shippingCost ?? toNumber(shipment.shippingCost),
            };
          })
          .sort((a, b) => a.shippingDate.localeCompare(b.shippingDate));
      }),

    /** 発送記録を新規作成し、送料を按分更新する */
    create: protectedProcedure
      .input(
        z.object({
          shippingDate: z.string(),
          trackingNumber: z.string().optional(),
          shippingCost: z.number(),
          notes: z.string().optional(),
          items: z.array(
            z.object({
              invoiceNo: z.number(),
              tradeRecordId: z.number().int().positive(),
              quantity: z.number(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        const db = (await getDb())!;

        // 1. 発送レコードを作成
        const tradeRecordIds = Array.from(new Set(input.items.map((item) => item.tradeRecordId)));
        const tradeRows = tradeRecordIds.length > 0
          ? await db
              .select({ id: tradeRecords.id, no: tradeRecords.no })
              .from(tradeRecords)
              .where(inArray(tradeRecords.id, tradeRecordIds))
          : [];
        const tradeInvoiceById = new Map(tradeRows.map((row) => [row.id, row.no]));
        for (const item of input.items) {
          if (tradeInvoiceById.get(item.tradeRecordId) !== item.invoiceNo) {
            throw new Error(`出庫明細の商品行がNo.${item.invoiceNo}に紐づいていません。`);
          }
        }

        const [result] = await db.insert(shipments).values({
          shippingDate: input.shippingDate,
          trackingNumber: input.trackingNumber ?? null,
          shippingCost: String(input.shippingCost),
          notes: input.notes ?? null,
        });
        const shipmentId = (result as any).insertId as number;

        // 2. 発送明細を作成
        for (const item of input.items) {
          await db.insert(shipmentItems).values({
            shipmentId,
            invoiceNo: item.invoiceNo,
            tradeRecordId: item.tradeRecordId,
            quantity: item.quantity,
          });
        }

        // 3. 各インボイスの送料を更新（発送完了チェック）
        await recalcShippingCosts(db, input.items.map((i) => i.invoiceNo));

        return { shipmentId };
      }),

    /** 発送記録を更新する（発送日・追跡番号・送料・メモ） */
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          shippingDate: z.string(),
          trackingNumber: z.string().optional(),
          shippingCost: z.number(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = (await getDb())!;
        await db
          .update(shipments)
          .set({
            shippingDate: input.shippingDate,
            trackingNumber: input.trackingNumber ?? null,
            shippingCost: String(input.shippingCost),
            notes: input.notes ?? null,
          })
          .where(eq(shipments.id, input.id));
        // 送料変更後に再計算
        const items = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, input.id));
        const invoiceNos = items.map((i) => i.invoiceNo);
        await recalcShippingCosts(db, invoiceNos);
        return { ok: true };
      }),

    /** 発送記録を削除し、送料を再計算する */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = (await getDb())!;
        const items = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, input.id));
        const invoiceNos = items.map((i) => i.invoiceNo);
        await db.delete(shipmentItems).where(eq(shipmentItems.shipmentId, input.id));
        await db.delete(shipments).where(eq(shipments.id, input.id));
        // 送料を再計算
        await recalcShippingCosts(db, invoiceNos);
        return { ok: true };
      }),
  }),
});
export type AppRouter = typeof appRouter;
