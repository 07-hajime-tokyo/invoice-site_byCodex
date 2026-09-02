import { z } from "zod";
import { google } from "googleapis";
import { COOKIE_NAME, ADMIN_EMAILS } from "@shared/const";
import { getEbayStockType, isEbayManagementNo, normalizeEbayOrderStatus } from "@shared/ebayInventory";
import { allocateShipmentItemsToCsvProducts, extractColor, extractManagementHints, extractModel, extractPreferredModel, isRandomColor, normalizeLooseText, productNamesCanMatch, suggestCsvProduct } from "@shared/productMatching";
import {
  invoiceGroupKeyFromDeliveryNo,
  invoiceNoFromDeliveryNo as invoiceNoFromDeliveryNoStrict,
  invoiceNoFromManagementNo,
  normalizeAssignedInvoiceNo,
  resolveDeliveryItemInvoiceNo,
} from "@shared/invoiceKey";
import { isClosedTradeYear } from "@shared/tradeStatus";
import {
  allocateShipmentProgressToProducts,
  buildShipmentProgressProductTotals,
  parseShipmentProgressSheetRows,
  summarizeShipmentProgress,
  type TradeShipmentProgressEntry,
} from "@shared/tradeSheetStatus";
import {
  classifyInbound,
  nextStage,
  isInboundClass,
  isRegisterStage,
  isInboundComplete,
  extractInvoicePrefix,
  getStagesForClass,
  INBOUND_CLASS_ORDER,
  DEFAULT_DIRECT_PARTNER_NAMES,
  DIRECT_PARTNER_NAMES_SETTING_KEY,
  type InboundClass,
} from "@shared/inboundPipeline";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { InsertLocalInventory, InsertLocalPurchase } from "../../drizzle/schema";
import { getSessionCookieOptions } from "../_core/cookies";
import { systemRouter } from "../_core/systemRouter";
import { protectedProcedure, router } from "../_core/trpc";
import { aiInvestigationRouter } from "./aiInvestigation";
import { actionItemsRouter } from "./actionItems";
import { inboundDeskRouter } from "./inboundDesk";
import { outboundBoxesRouter } from "./outboundBoxes";
import { getReceiptAckSummary, markReceiptAckDone } from "./receiptAck";
import { processInventoryDelivery } from "./deliveryService";
import { recordWorkLog, workLogsRouter } from "./workLogs";
import { diffInventoryFields, recordInventoryChange } from "./changeLog";
import { captureDailySnapshot, listDailySnapshots } from "./dailySnapshot";
import { buildSnapshotBreakdown, parseDailySnapshotDate } from "@shared/inventorySnapshot";
import {
  testConnection,
  getPurchases,
  getAllPurchases,
  completePurchase,
  revertPurchase,
  getInventories,
  getInventory,
  deleteInventory,
  createDelivery,
  deleteDelivery,
  updateDeliveryNum,
  getLatestPurchaseDateMap,
  createInventory,
  updateInventory,
  createPurchase,
  getMaxPurchaseNum,
  getPurchaseById,
  deletePurchase,
  updatePurchase,
} from "./zaico";
import {
  createDeliveryHistory,
  getDeliveryHistories,
  markDeliveryItemsDeleted,
  updateDeliveryNo,
  updateDeliveryCancelledItems,
  getDeliveryHistoryById,
  getDeliveryHistoriesByDeliveryNo,
  getDeliveryHistoriesByInvoicePrefix,
  deleteDeliveryHistoryById,
  updateDeliveryHistoryItemsJson,
  getPurchaseHistories,
  createPurchaseHistory,
  cancelPurchaseHistory,
  getLatestPurchaseDateMapFromDB,
  upsertPurchaseExtra,
  getAllPurchaseExtras,
  createDeletedInventory,
  getDeletedInventories,
  removeDeletedInventory,
  upsertInventoryExtra,
  getAllInventoryExtras,
  deleteInventoryExtra,
  createInventoryMemo,
  getInventoryMemos,
  getAllInventoryMemos,
  upsertInvoiceMemo,
  getInvoiceMemos,
  getAllInvoiceMemos,
  upsertLocalInventory,
  getLocalInventories,
  getLocalInventoryById,
  getLocalInventoryByZaicoId,
  getLocalInventoryByZaicoIdOrId,
  updateLocalInventory,
  deleteLocalInventory,
  countLocalInventories,
  upsertLocalPurchase,
  updateLocalPurchase,
  getLocalPurchases,
  updateLocalPurchaseStatus,
  ensureInventoryItemLabels,
  ensureInventoryItemLabelsForInventory,
  getInventoryItemLabelsByInventoryIds,
  countLocalPurchases,
  setLocalPurchaseInboundClass,
  updateLocalPurchaseStage,
  getLocalPurchaseById,
  insertLocalPurchase,
  getPublishedInvoiceNumberSet,
  getSystemSetting,
  setSystemSetting,
  isZaicoEnabled,
  createMonthlyReport,
  getMonthlyReports,
  getMonthlyReportById,
  deleteMonthlyReport,
  upsertMonthlyReportCost,
  getMonthlyReportCosts,
  getAllDeliveryHistories,
  getDeletedInventoryIdsFromDeliveryHistories,
  getUnitPricesByInventoryIds,
  getLocalPurchaseUnitPriceMap,
  getLocalInventoryUnitPriceByZaicoIds,
  getLocalInventoryInfoByZaicoIds,
  getDeletedInventoryUnitPriceByZaicoIds,
  getShaftSales,
  upsertShaftSale,
  updateShaftSaleDate,
  updateShaftSaleProfit,
  getInvoiceManualItems,
  getInvoiceManualItemsByInvoiceNos,
  createInvoiceManualItem,
  updateInvoiceManualItem,
  deleteInvoiceManualItem,
  getDomesticProducts,
  createDomesticProduct,
  updateDomesticProduct,
  deleteDomesticProduct,
  getMonthlyDomesticItems,
  createMonthlyDomesticItem,
  updateMonthlyDomesticItem,
  deleteMonthlyDomesticItem,
  getLatestIncreaseMemosMap,
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  isAuthorizedUser,
  authorizeUser,
  bulkUpsertLocalInventoriesFromCsv,
  createFedexShipment,
  getFedexShipmentsByDeliveryNo,
  getFedexShipmentsByHistoryId,
  getAllFedexShipments,
  updateFedexShipmentStatus,
  updateFedexShipment,
  updateFedexShipmentHistoryAndDeliveryNo,
  deleteFedexShipment,
  getAllPartnerPortals,
  getPartnerPortalByCode,
  createPartnerPortal,
  updatePartnerPortal,
  deletePartnerPortal,
  setPartnerSessionToken,
  getShipmentChecksByPartner,
  upsertShipmentCheck,
  createPartnerMessage,
  getAllPartnerMessages,
  markPartnerMessageRead,
  replyToPartnerMessage,
  deletePartnerMessage,
  deletePartnerMessageByPartner,
  getPartnerMessagesByCode,
  markPartnerMessagesReadByPartner,
  addMessageThread,
  getThreadsByParentIds,
  markThreadsReadByPartner,
  markThreadsReadByAdmin,
  createManualShipment,
  getAllManualShipments,
  deleteManualShipment,
  getTrackingNumbersByInventoryIds,
  getInventoryExtraByZaicoId,
  getDb,
  type InventoryItemLabelStatus,
} from "./db";

const shipmentSheetNameSchema = z.enum(["独発送管理", "サミー発送管理", "デボン発送管理", "サイモン発送管理", "ネレ発送管理"]);
type ShipmentSheetName = z.infer<typeof shipmentSheetNameSchema>;

const TRADE_SHIPMENT_SPREADSHEET_ID = "133cDct4krrsJDeXpO9l0fIrd3-ZYDc39u6-JpQvcxv4";
const TRADE_SHIPMENT_SHEET_NAME_KEYWORD = "発送管理";

let orderManagementShipmentProgressCache: {
  expiresAt: number;
  data: Map<string, TradeShipmentProgressEntry[]>;
} | null = null;

function fixGoogleServiceAccountJson(raw: string) {
  const credentials = JSON.parse(raw);
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

function getInventorySheetsClient() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  const auth = new google.auth.GoogleAuth({
    credentials: fixGoogleServiceAccountJson(raw),
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function getShipmentSheetAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const status = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";

  if (status === "403" || message.toLowerCase().includes("permission")) {
    return new Error(
      `Google Sheetsの権限がありません。スプシID ${TRADE_SHIPMENT_SPREADSHEET_ID} をサービスアカウントに共有してください。詳細: ${message}`,
    );
  }

  return error instanceof Error ? error : new Error(message);
}

function quoteShipmentSheetName(sheetName: string) {
  return `'${sheetName.replace(/'/g, "''")}'`;
}

function isShipmentProgressSheet(sheet: { title: string; hidden?: boolean }) {
  return Boolean(sheet.title) && !sheet.hidden && sheet.title.includes(TRADE_SHIPMENT_SHEET_NAME_KEYWORD);
}

async function getOrderManagementShipmentProgressByInvoice() {
  const sheets = getInventorySheetsClient();
  if (!sheets) return new Map<string, TradeShipmentProgressEntry[]>();

  const now = Date.now();
  if (orderManagementShipmentProgressCache && orderManagementShipmentProgressCache.expiresAt > now) {
    return orderManagementShipmentProgressCache.data;
  }

  const metadata = await sheets.spreadsheets.get({
    spreadsheetId: TRADE_SHIPMENT_SPREADSHEET_ID,
    fields: "sheets.properties(title,index,hidden)",
  }).catch((error) => {
    throw getShipmentSheetAccessError(error);
  });

  const tabs = (metadata.data.sheets ?? [])
    .map((sheet) => ({
      title: sheet.properties?.title ?? "",
      index: sheet.properties?.index ?? 0,
      hidden: sheet.properties?.hidden ?? false,
    }))
    .filter(isShipmentProgressSheet)
    .sort((a, b) => a.index - b.index);

  if (tabs.length === 0) {
    const empty = new Map<string, TradeShipmentProgressEntry[]>();
    orderManagementShipmentProgressCache = { expiresAt: now + 20_000, data: empty };
    return empty;
  }

  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: TRADE_SHIPMENT_SPREADSHEET_ID,
    ranges: tabs.map((tab) => `${quoteShipmentSheetName(tab.title)}!B:G`),
    valueRenderOption: "FORMATTED_VALUE",
  }).catch((error) => {
    throw getShipmentSheetAccessError(error);
  });

  const progressByInvoice = parseShipmentProgressSheetRows(
    (response.data.valueRanges ?? []).map((valueRange) => valueRange.values ?? []),
  );
  orderManagementShipmentProgressCache = {
    expiresAt: now + 20_000,
    data: progressByInvoice,
  };
  return progressByInvoice;
}

function detectShipmentSheetNameInText(text: string | null | undefined): ShipmentSheetName | null {
  const haystack = text?.toLowerCase() ?? "";
  if (!haystack) return null;
  if (haystack.includes("デボン") || haystack.includes("devon")) return "デボン発送管理";
  if (haystack.includes("サイモン") || haystack.includes("simon") || haystack.includes("hennes kamusien")) return "サイモン発送管理";
  if (haystack.includes("ネレ") || haystack.includes("nele")) return "ネレ発送管理";
  if (haystack.includes("サミー") || haystack.includes("samee") || haystack.includes("sami") || haystack.includes("sammy")) return "サミー発送管理";
  if (haystack.includes("マキシム") || haystack.includes("maxim") || haystack.includes("ルカ") || haystack.includes("luca")) return "独発送管理";
  return null;
}

function detectShipmentSheetName(primaryText?: string | null, ...fallbackTexts: Array<string | null | undefined>): ShipmentSheetName {
  const primary = detectShipmentSheetNameInText(primaryText);
  if (primary) return primary;

  const haystack = fallbackTexts.filter(Boolean).join(" ").toLowerCase();
  if (haystack.includes("デボン") || haystack.includes("devon")) return "デボン発送管理";
  if (haystack.includes("サイモン") || haystack.includes("simon")) return "サイモン発送管理";
  if (haystack.includes("ネレ") || haystack.includes("nele")) return "ネレ発送管理";
  if (haystack.includes("サミー") || haystack.includes("samee") || haystack.includes("sami") || haystack.includes("sammy")) {
    return "サミー発送管理";
  }
  if (haystack.includes("マキシム") || haystack.includes("maxim")) return "独発送管理";
  return "独発送管理";
}

/**
 * GitHub プライベートリポジトリから CSV テキストを取得するヘルパー
 * GITHUB_CSV_TOKEN が設定されている場合は Authorization ヘッダーを付与する
 */
function normalizeListingUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function fetchGithubCsv(): Promise<string> {
  return fetchCsvFromGithub(
    process.env.MERUKANRI_CSV_URL ?? "https://raw.githubusercontent.com/07-hajime-tokyo/merukanri-data-site/main/data.csv",
    "CSV fetch failed",
  );
}

function getGithubCsvToken(): string | undefined {
  const token = process.env.GITHUB_CSV_TOKEN?.trim();
  if (!token) return undefined;
  if (/^(github-token|your_|YOUR_|<|placeholder)/.test(token)) return undefined;
  return token;
}

function buildGithubHeaders(accept = "text/plain"): Record<string, string> {
  const headers: Record<string, string> = { Accept: accept };
  const token = getGithubCsvToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function rawGithubUrlToContentsApi(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "raw.githubusercontent.com") return null;
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length < 4) return null;
    const [owner, repo, ref, ...pathParts] = parts;
    const path = pathParts.map((part) => encodeURIComponent(part)).join("/");
    return `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  } catch {
    return null;
  }
}

async function readGithubCsvResponse(res: Response): Promise<string> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return text;
  try {
    const json = JSON.parse(trimmed) as { content?: string; encoding?: string };
    if (json.content && json.encoding === "base64") {
      return Buffer.from(json.content.replace(/\s/g, ""), "base64").toString("utf8");
    }
  } catch {
    // Fall through and return the original text.
  }
  return text;
}

async function fetchCsvFromGithub(url: string, errorLabel: string): Promise<string> {
  const rawRes = await fetch(url, { headers: buildGithubHeaders() });
  if (rawRes.ok) return readGithubCsvResponse(rawRes);

  const apiUrl = rawGithubUrlToContentsApi(url);
  if (apiUrl && getGithubCsvToken()) {
    const apiRes = await fetch(apiUrl, { headers: buildGithubHeaders("application/vnd.github+json") });
    if (apiRes.ok) return readGithubCsvResponse(apiRes);
    throw new Error(`${errorLabel}: ${rawRes.status}; GitHub API fallback: ${apiRes.status}`);
  }

  throw new Error(`${errorLabel}: ${rawRes.status}`);
}

/**
 * operatorKey に対応する Zaico API トークンを返す
 * operatorKey: "default" | "A" | "B"
 */
/**
 * etcフィールドから「・YYYYMMDD」形式の日付を全て抽出し、最新の日付を YYYY-MM-DD 形式で返す
 * 例: 「・20260403Toynet入庫+4」 → "2026-04-03"
 * 該当なしの場合は null を返す
 */
function extractLatestDateFromEtc(etc?: string | null): string | null {
  if (!etc) return null;
  // 「・YYYYMMDD」または「・YYYYMMDD」形式の8桁数字を全て抽出
  const matches = etc.match(/[・・]?(\d{8})/g);
  if (!matches || matches.length === 0) return null;
  let latest = "";
  for (const m of matches) {
    const digits = m.replace(/[^\d]/g, "");
    if (digits.length !== 8) continue;
    const year = digits.slice(0, 4);
    const month = digits.slice(4, 6);
    const day = digits.slice(6, 8);
    // 有効な日付かどうか確認
    const y = parseInt(year), mo = parseInt(month), d = parseInt(day);
    if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) continue;
    const dateStr = `${year}-${month}-${day}`;
    if (!latest || dateStr > latest) latest = dateStr;
  }
  return latest || null;
}

/**
 * CSVの1行をパースして列の配列を返す
 * ダブルクォートで囲まれたフィールド（カンマ含む）に対応
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

type OrderCsvRow = {
  tradeRecordId: number | null;
  partner: string;
  invoiceNo: string;
  paymentDate: string;
  productName: string;
  orderQty: number;
  sellingPrice: number | null;
  sellingPriceJpy: number | null;
  currency: string;
  status: string;
};

type CsvProductCandidate = { name: string; qty: number };

function normalizeTradePartnerName(partner: string | null | undefined): string {
  const trimmed = String(partner ?? "").trim();
  if (!trimmed) return "その他";
  const normalized = trimmed.normalize("NFKC").toLowerCase();
  if (normalized === "hennes kamusien") return "サイモン";
  return trimmed;
}

function suggestCsvProductNameWithFallback(
  title: string,
  managementNo: string,
  candidates: CsvProductCandidate[],
): string | null {
  const suggestion = suggestCsvProduct(title, managementNo, candidates);
  if (suggestion) return suggestion.name;

  const model = extractPreferredModel(title, managementNo);
  if (!model) return null;

  const targetText = `${title} ${managementNo}`;
  const sameModelCandidates = candidates.filter((candidate) =>
    extractModel(candidate.name) === model &&
    productNamesCanMatch(targetText, candidate.name)
  );
  return sameModelCandidates.length === 1 ? sameModelCandidates[0].name : null;
}

function suggestCsvProductNameFromHints(
  title: string,
  managementHints: Array<string | null | undefined>,
  candidates: CsvProductCandidate[],
): string | null {
  const managementText = Array.from(new Set(extractManagementHints(...managementHints))).join(" ");
  const titleText = String(title ?? "").trim();

  return (
    (managementText ? suggestCsvProductNameWithFallback("", managementText, candidates) : null) ??
    (titleText ? suggestCsvProductNameWithFallback(titleText, managementText, candidates) : null)
  );
}

function productNameKey(value: string | null | undefined): string {
  return normalizeLooseText(String(value ?? ""));
}

function deliveryProductNameMatchesOrderProduct(
  deliveredName: string,
  orderProductName: string,
  candidates: CsvProductCandidate[],
): boolean {
  const delivered = deliveredName.trim();
  const order = orderProductName.trim();
  if (!delivered || !order) return false;
  if (!productNamesCanMatch(delivered, order)) return false;
  if (productNameKey(delivered) === productNameKey(order)) return true;

  const suggestion =
    suggestCsvProductNameWithFallback(delivered, "", candidates) ??
    suggestCsvProductNameFromHints(delivered, [delivered], candidates);
  if (suggestion && productNameKey(suggestion) === productNameKey(order)) return true;
  const deliveredModel = extractModel(delivered);
  const orderModel = extractModel(order);
  if (!deliveredModel || deliveredModel !== orderModel) return false;
  if (isRandomColor(order) || isRandomColor(extractColor(order))) return true;
  const sameModelCandidates = candidates.filter((candidate) =>
    extractModel(candidate.name) === orderModel &&
    productNamesCanMatch(delivered, candidate.name)
  );
  return sameModelCandidates.length === 1 && productNameKey(sameModelCandidates[0].name) === productNameKey(order);
}

async function getOrderRowsFromTradeRecords(): Promise<OrderCsvRow[]> {
  const db = await getDb();
  if (!db) return [];
  const { tradeRecords } = await import("../../drizzle/schema");
  const rows = await db
    .select({
      tradeRecordId: tradeRecords.id,
      partner: tradeRecords.partner,
      invoiceNo: tradeRecords.no,
      paymentDate: tradeRecords.paymentDate,
      productName: tradeRecords.productName,
      orderQty: tradeRecords.quantity,
      sellingPrice: tradeRecords.unitPrice,
      sellingPriceJpy: tradeRecords.unitPriceJPY,
      currency: tradeRecords.currency,
      status: tradeRecords.status,
    })
    .from(tradeRecords);

  return rows
    .map((row) => ({
      tradeRecordId: row.tradeRecordId == null ? null : Number(row.tradeRecordId),
      partner: normalizeTradePartnerName(row.partner),
      invoiceNo: row.invoiceNo != null ? String(row.invoiceNo) : "",
      paymentDate: row.paymentDate ?? "",
      productName: row.productName?.trim() ?? "",
      orderQty: Number(row.orderQty ?? 0) || 0,
      sellingPrice: row.sellingPrice == null ? null : Number(row.sellingPrice) || null,
      sellingPriceJpy: row.sellingPriceJpy == null ? null : Number(row.sellingPriceJpy) || null,
      currency: row.currency ?? "",
      status: row.status ?? "",
    }))
    .filter((row) => row.invoiceNo && /^\d+$/.test(row.invoiceNo))
    .sort((a, b) => Number(a.invoiceNo) - Number(b.invoiceNo));
}

type StoredDeliveryItem = {
  inventoryId?: number;
  labelId?: string | null;
  title?: string;
  quantity?: unknown;
  managementNo?: string | null;
  tradeRecordId?: number | null;
  csvProductName?: string | null;
};

/**
 * 個体ID -> 人が指定した引当先インボイスNo。
 * 在庫から充当したぶんや、別インボイスの在庫を回したぶんは推測できないので、
 * 画面で指定した値をここから引いて集計に効かせる。
 */
async function buildAssignedInvoiceNoMap(): Promise<Map<string, string>> {
  const db = await getDb();
  if (!db) return new Map();
  const { inventoryItemLabels: labelTbl } = await import("../../drizzle/schema");
  const rows = await db
    .select({ labelId: labelTbl.labelId, assignedInvoiceNo: labelTbl.assignedInvoiceNo })
    .from(labelTbl);
  const map = new Map<string, string>();
  for (const row of rows) {
    const invoiceNo = normalizeAssignedInvoiceNo(row.assignedInvoiceNo);
    if (invoiceNo) map.set(String(row.labelId).trim().toUpperCase(), invoiceNo);
  }
  return map;
}

/** 出庫明細に、人が指定した引当先を載せて返す。 */
function withAssignedInvoiceNo<T extends StoredDeliveryItem>(
  item: T,
  assignedMap: Map<string, string>,
): T & { assignedInvoiceNo?: string | null } {
  const labelId = String(item.labelId ?? "").trim().toUpperCase();
  return labelId ? { ...item, assignedInvoiceNo: assignedMap.get(labelId) ?? null } : item;
}

function parseDeliveryItemsJson(value: string | null | undefined): StoredDeliveryItem[] {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function buildInventoryManagementNoMap(): Promise<Map<number, string>> {
  const zaicoEnabled = await isZaicoEnabled();
  const [inventories, deletedInvList, purchaseHistList] = await Promise.all([
    zaicoEnabled ? getInventories() : getLocalInventories(),
    getDeletedInventories(2000),
    getPurchaseHistories(3000),
  ]);
  const inventoryEtcMap = new Map<number, string>();
  for (const inv of inventories as Array<{ id: number; etc?: string | null; managementNo?: string | null }>) {
    inventoryEtcMap.set(Number(inv.id), inv.etc ?? inv.managementNo ?? "");
  }
  for (const del of deletedInvList) {
    if (del.zaicoId && del.etc && !inventoryEtcMap.has(del.zaicoId)) {
      inventoryEtcMap.set(del.zaicoId, del.etc);
    }
  }
  for (const ph of purchaseHistList) {
    if (ph.inventoryId && ph.kanriNo && !inventoryEtcMap.has(ph.inventoryId)) {
      inventoryEtcMap.set(ph.inventoryId, ph.kanriNo);
    }
  }
  return inventoryEtcMap;
}

type ShipmentGasItem = { productNameJa: string; productNameEn: string; quantity: number; managementNo?: string | null; labelId?: string };

function mergeShipmentGasItems(items: ShipmentGasItem[]): ShipmentGasItem[] {
  const grouped = new Map<string, ShipmentGasItem>();
  for (const item of items) {
    const name = (item.productNameJa || item.productNameEn).trim();
    if (!name || item.quantity <= 0) continue;
    const key = item.labelId ? `${name}\u0000${item.labelId}` : name;
    const current = grouped.get(key);
    if (current) current.quantity += item.quantity;
    else grouped.set(key, {
      productNameJa: name,
      productNameEn: item.productNameEn || name,
      quantity: item.quantity,
      ...(item.managementNo !== undefined ? { managementNo: item.managementNo } : {}),
      ...(item.labelId ? { labelId: item.labelId } : {}),
    });
  }
  return Array.from(grouped.values()).filter((item) => item.quantity > 0);
}

// 読み取りの正本は shared/invoiceKey.ts。従来の呼び出し名だけ残す。
const invoiceNoPrefixFromDeliveryNo = invoiceNoFromDeliveryNoStrict;
const invoiceNoFromDeliveryNo = invoiceGroupKeyFromDeliveryNo;

function compactShipmentName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[　\s・･_\-ー]/g, "")
    .replace(/ニンテンドー|nintendo/g, "")
    .replace(/カラー/g, "color")
    .trim();
}

/** 取引データの通貨表記（ユーロ・ドル）を、送り状に書く3文字コードへ寄せる。 */
function normalizeDeclarationCurrency(value: string | null | undefined): string {
  const text = String(value ?? "").normalize("NFKC").trim();
  if (!text) return "—";
  const lower = text.toLowerCase();
  if (text.includes("ユーロ") || lower === "eur" || text.includes("€")) return "EUR";
  if (text.includes("ドル") || lower === "usd" || text.includes("$")) return "USD";
  if (text.includes("円") || lower === "jpy" || text.includes("¥")) return "JPY";
  return text;
}

function isRandomShipmentName(value: string): boolean {
  const target = compactShipmentName(value);
  return target.includes("ランダム") || target.includes("random") || target.includes("ramdom");
}

function shipmentModelKey(value: string): string {
  const target = compactShipmentName(value);
  if (/new3ds(ll|xl)|n3ds(ll|xl)/.test(target)) return "new3dsll";
  if (/new2ds(ll|xl)|n2ds(ll|xl)/.test(target)) return "new2dsll";
  if (/new3ds|n3ds/.test(target)) return "new3ds";
  if (/(^|[^a-z])3ds(ll|xl)/.test(target) || target.includes("3dsll")) return "3dsll";
  if (target.includes("3ds")) return "3ds";
  if (target.includes("vita2000") || target.includes("psvita2000") || target.includes("pch2000")) return "vita2000";
  if (target.includes("vita1000") || target.includes("psvita1000") || target.includes("pch1000") || target.includes("pch1100")) return "vita1000";
  if (target.includes("switchlite")) return "switchlite";
  if (target.includes("switch")) return "switch";
  if (target.includes("psp3000")) return "psp3000";
  if (target.includes("psp2000")) return "psp2000";
  if (target.includes("psp1000")) return "psp1000";
  if (target.includes("psp")) return "psp";
  if (target.includes("dslite")) return "dslite";
  if (target.includes("dsill") || target.includes("dsixl") || /dsi(ll|xl)/.test(target)) return "dsill";
  if (target.includes("dsi")) return "dsi";
  return target;
}

function shipmentColorTokens(value: string): Set<string> {
  const target = compactShipmentName(value);
  const tokens = new Set<string>();
  const pairs: Array<[string, string]> = [
    ["ブラック", "black"], ["黒", "black"], ["black", "black"],
    ["ホワイト", "white"], ["白", "white"], ["white", "white"],
    ["パールホワイト", "white"], ["pearlwhite", "white"], ["pearl white", "white"],
    ["ブルー", "blue"], ["青", "blue"], ["blue", "blue"],
    ["レッド", "red"], ["ワインレッド", "red"], ["赤", "red"], ["red", "red"], ["winered", "red"], ["wine red", "red"],
    ["ピンク", "pink"], ["pink", "pink"],
    ["ミント", "mint"], ["mint", "mint"],
    ["ライム", "lime"], ["lime", "lime"],
    ["グリーン", "green"], ["緑", "green"], ["green", "green"],
    ["イエロー", "yellow"], ["黄色", "yellow"], ["yellow", "yellow"],
    ["パープル", "purple"], ["紫", "purple"], ["purple", "purple"],
    ["アクア", "aqua"], ["aqua", "aqua"],
    ["ターコイズ", "turquoise"], ["turquoise", "turquoise"],
    ["ラベンダー", "lavender"], ["lavender", "lavender"],
    ["シルバー", "silver"], ["silver", "silver"],
    ["ゴールド", "gold"], ["gold", "gold"],
    ["グレー", "gray"], ["gray", "gray"], ["grey", "gray"],
    ["ブラウン", "brown"], ["茶", "brown"], ["brown", "brown"],
    ["ダークブラウン", "brown"], ["darkbrown", "brown"], ["dark brown", "brown"],
    ["オレンジ", "orange"], ["orange", "orange"],
    ["メタリック", "metallic"], ["metallic", "metallic"],
  ];
  for (const [needle, token] of pairs) {
    if (target.includes(compactShipmentName(needle))) tokens.add(token);
  }
  return tokens;
}

function shipmentProductMatches(orderName: string, shippedName: string): boolean {
  const orderModel = shipmentModelKey(orderName);
  const shippedModel = shipmentModelKey(shippedName);
  if (!orderModel || !shippedModel || orderModel !== shippedModel) return false;
  if (isRandomShipmentName(orderName) || isRandomShipmentName(shippedName)) return true;

  const orderColors = shipmentColorTokens(orderName);
  const shippedColors = shipmentColorTokens(shippedName);
  const orderCompact = compactShipmentName(orderName);
  if (orderCompact.includes("other") || orderCompact.includes("その他") || orderCompact.includes("それ以外")) {
    return true;
  }
  if (orderCompact.includes("base") || orderCompact.includes("ベース")) {
    orderColors.delete("base");
  }
  if (orderColors.size === 0 || shippedColors.size === 0) return true;
  for (const color of Array.from(orderColors)) {
    if (color === "metallic") continue;
    if (shippedColors.has(color)) return true;
  }
  return false;
}

async function alignShipmentItemsToOrderRows(invoiceNo: string, items: ShipmentGasItem[]): Promise<ShipmentGasItem[]> {
  // 個体IDを持つ箱経由の行はidentityを落とさないことを優先する。
  if (items.some((item) => item.labelId)) return mergeShipmentGasItems(items);
  const orderRows = (await getOrderRowsFromTradeRecords().catch(() => []))
    .filter((row) => row.invoiceNo === invoiceNo && row.productName.trim());
  if (orderRows.length === 0) return mergeShipmentGasItems(items);

  const csvProducts = orderRows.map((row) => ({ name: row.productName, qty: row.orderQty }));
  return allocateShipmentItemsToCsvProducts(items, csvProducts);
}

const CATEGORY_SETTINGS_KEY = "inventory_categories";
const ALL_CATEGORY_LABEL = "すべて";
const UNCATEGORIZED_LABEL = "未分類";

function normalizeCategoryName(value?: string | null): string {
  return (value ?? "").trim();
}

function uniqueSortedCategories(values: Array<string | null | undefined>): string[] {
  const categories = new Set<string>();
  for (const value of values) {
    const name = normalizeCategoryName(value);
    if (!name || name === ALL_CATEGORY_LABEL || name === UNCATEGORIZED_LABEL) continue;
    categories.add(name);
  }
  return Array.from(categories).sort((a, b) => a.localeCompare(b, "ja"));
}

async function getStoredCategories(): Promise<string[]> {
  const raw = await getSystemSetting(CATEGORY_SETTINGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return uniqueSortedCategories(parsed.filter((value): value is string => typeof value === "string"));
    }
  } catch {
    return [];
  }
  return [];
}

async function setStoredCategories(categories: Array<string | null | undefined>): Promise<string[]> {
  const next = uniqueSortedCategories(categories);
  await setSystemSetting(CATEGORY_SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function extractCategoriesFromItemsJson(itemsJson?: string | null): string[] {
  if (!itemsJson) return [];
  try {
    const items = JSON.parse(itemsJson) as unknown;
    if (!Array.isArray(items)) return [];
    return items
      .map((item) => {
        if (!item || typeof item !== "object") return "";
        const category = (item as { category?: unknown }).category;
        return typeof category === "string" ? category : "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function getInventoryCategoryList(): Promise<string[]> {
  const storedCategories = await getStoredCategories();
  const zaicoEnabled = await isZaicoEnabled();
  const categories: Array<string | null | undefined> = [...storedCategories];

  if (!zaicoEnabled) {
    const [localInvs, localPurchaseRows] = await Promise.all([
      getLocalInventories(),
      getLocalPurchases(),
    ]);
    categories.push(...localInvs.map((inv) => inv.category));
    for (const purchase of localPurchaseRows) {
      categories.push(purchase.category);
      categories.push(...extractCategoriesFromItemsJson(purchase.itemsJson));
    }
    return uniqueSortedCategories(categories);
  }

  const inventories = await getInventories();
  categories.push(...inventories.map((inv) => inv.categories?.[0] ?? inv.category));
  return uniqueSortedCategories(categories);
}

async function clearLocalCategory(categoryName: string, replacementCategory: string | null): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const { localInventories: liTbl, localPurchases: lpTbl } = await import("../../drizzle/schema");

  await db.update(liTbl).set({ category: replacementCategory }).where(eq(liTbl.category, categoryName));

  const localPurchaseRows = await getLocalPurchases();
  const relatedPurchases = localPurchaseRows.filter((purchase) => {
    if (purchase.category === categoryName) return true;
    return extractCategoriesFromItemsJson(purchase.itemsJson).some((category) => category === categoryName);
  });

  await db.update(lpTbl).set({ category: replacementCategory }).where(eq(lpTbl.category, categoryName));

  await Promise.all(
    relatedPurchases.map(async (purchase) => {
      try {
        const items = JSON.parse(purchase.itemsJson ?? "[]") as unknown;
        if (!Array.isArray(items)) return;
        let changed = false;
        const nextItems = items.map((item) => {
          if (!item || typeof item !== "object") return item;
          const row = item as Record<string, unknown>;
          if (normalizeCategoryName(typeof row.category === "string" ? row.category : "") !== categoryName) return item;
          changed = true;
          return { ...row, category: replacementCategory };
        });
        if (changed) {
          await db.update(lpTbl).set({ itemsJson: JSON.stringify(nextItems) }).where(eq(lpTbl.id, purchase.id));
        }
      } catch {
        // Broken snapshots should not block category cleanup.
      }
    })
  );
}

type ShipmentDisplayItem = {
  productNameJa: string;
  productNameEn: string;
  quantity: number;
  managementNo?: string | null;
};

function deliveryHistoryItemsToShipmentItems(itemsJson: string): ShipmentDisplayItem[] {
  let items: Array<{ title?: string; productNameJa?: string; productNameEn?: string; quantity?: unknown; managementNo?: string | null }> = [];
  try {
    const parsed = JSON.parse(itemsJson || "[]");
    items = Array.isArray(parsed) ? parsed : [];
  } catch {
    items = [];
  }
  return items
    .map((item) => {
      const name = String(item.title ?? item.productNameJa ?? item.productNameEn ?? "").trim();
      const quantity = Number(item.quantity ?? 0);
      return { productNameJa: name, productNameEn: name, quantity, managementNo: item.managementNo ?? null };
    })
    .filter((item) => item.productNameJa && item.quantity > 0);
}

function sumShipmentDisplayItems(items: ShipmentDisplayItem[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}

async function alignShipmentItemsWithDeliveryHistories<
  T extends { deliveryNo: string; itemsJson: string; historyId?: number | null; isManual?: boolean },
>(shipments: T[]): Promise<T[]> {
  if (shipments.length === 0) return shipments;

  const histories = await getAllDeliveryHistories().catch(() => []);
  const latestHistories = [...histories]
    .filter((history) => history.status === "success")
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const historyById = new Map<number, (typeof latestHistories)[number]>();
  const historyByDeliveryNo = new Map<string, (typeof latestHistories)[number]>();
  for (const history of latestHistories) {
    historyById.set(history.id, history);
    if (!historyByDeliveryNo.has(history.deliveryNo)) {
      historyByDeliveryNo.set(history.deliveryNo, history);
    }
  }

  return shipments.map((shipment) => {
    if (shipment.isManual) return shipment;
    const history = shipment.historyId
      ? historyById.get(shipment.historyId)
      : historyByDeliveryNo.get(shipment.deliveryNo);
    if (!history) return shipment;

    const historyItems = deliveryHistoryItemsToShipmentItems(history.itemsJson);
    if (historyItems.length === 0) return shipment;
    const storedItems = deliveryHistoryItemsToShipmentItems(shipment.itemsJson);
    const storedTotal = sumShipmentDisplayItems(storedItems);
    const historyTotal = sumShipmentDisplayItems(historyItems);
    if (storedItems.length === 0 || storedTotal !== historyTotal) {
      return shipment;
    }
    return { ...shipment, itemsJson: JSON.stringify(historyItems) };
  });
}

async function getShipmentItemsForHistory(historyId?: number | null): Promise<ShipmentGasItem[] | null> {
  if (!historyId) return null;
  const history = await getDeliveryHistoryById(historyId).catch(() => null);
  if (!history || history.status !== "success") return null;
  const items = deliveryHistoryItemsToShipmentItems(history.itemsJson).map((item) => ({
    productNameJa: item.productNameJa,
    productNameEn: item.productNameEn,
    quantity: item.quantity,
    ...(item.managementNo !== undefined ? { managementNo: item.managementNo } : {}),
  }));
  return items.length > 0 ? items : null;
}

async function getLiveDeliveryHistoryIds(): Promise<Set<number>> {
  const histories = await getAllDeliveryHistories().catch(() => []);
  return new Set(histories.filter((history) => history.status === "success").map((history) => history.id));
}

function shouldUseExistingShipmentForGas(
  record: { deliveryNo: string; sheetName: string; trackingNumber: string; historyId?: number | null },
  target: { deliveryNo: string; sheetName: string; trackingNumber: string; invoiceNo: string; historyId?: number | null },
  liveHistoryIds: Set<number>,
): boolean {
  if (record.sheetName !== target.sheetName) return false;
  if (record.trackingNumber !== target.trackingNumber) return false;
  if (invoiceNoFromDeliveryNo(record.deliveryNo) !== target.invoiceNo) return false;
  if (record.historyId) return liveHistoryIds.has(record.historyId);
  if (target.historyId) return false;
  return record.deliveryNo === target.deliveryNo;
}

function resolveOperatorToken(_operatorKey?: string): string | undefined {
  return undefined;
}

function resolveWorkOperatorName(operatorName?: string | null, fallback?: string | null): string {
  return operatorName?.trim() || fallback?.trim() || "野田";
}

function sumWorkQuantity(items: Array<{ quantity: string | number }>): number {
  return Math.round(items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0));
}

function parseMoneyNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const normalized = String(value)
    .normalize("NFKC")
    .replace(/[,\s￥¥円]/g, "")
    .replace(/[^\d.-]/g, "")
    .trim();
  if (!normalized || normalized === "-" || normalized === ".") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

const publicProcedure = protectedProcedure;

type PurchasePageInput = {
  page?: number;
  pageSize?: number;
  status?: "ordered" | "shipped" | null;
  category?: string | null;
  search?: string | null;
  showCompleted?: boolean;
  /** T22: 分類タブのフィルタ。"unclassified"=未仕訳 / null|undefined=全件 */
  inboundClass?: InboundClass | "unclassified" | null;
};

type PurchasePageRow = {
  status: string;
  num?: string | null;
  purchase_date?: string | null;
  purchaseDate?: string | null;
  created_at?: string | null;
  createdAt?: string | Date | null;
  csvSupplierName?: string | null;
  extra?: { trackingNumber?: string | null } | null;
  /** T22: 入庫分類（ebay/oregon/direct/domestic）。null=未仕訳 */
  inboundClass?: InboundClass | null;
  /** T22: 分類根拠 */
  classSource?: "auto" | "manual";
  /** T22: 現在の作業工程 */
  stage?: string;
  /** T22: 最終工程更新者 */
  stageUpdatedBy?: string | null;
  /** T22: シャフト分離元の発注ID */
  shaftParentPurchaseId?: number | null;
  purchase_items: Array<{
    id?: string | number | null;
    inventory_id?: number | null;
    inventoryId?: number | null;
    title?: string | null;
    quantity?: string | number | null;
    unit_price?: string | number | null;
    etc?: string | null;
    category?: string | null;
    currentInventoryQuantity?: string | number | null;
    itemLabels?: InventoryItemLabelView[];
  }>;
};

type LocalInventoryRow = Awaited<ReturnType<typeof getLocalInventories>>[number];
type LocalInventoryItemLabelRow = NonNullable<LocalInventoryRow["itemLabels"]>[number];
type LocalPurchaseRow = Awaited<ReturnType<typeof getLocalPurchases>>[number];
type LocalPurchaseItemLabelRow = NonNullable<LocalPurchaseRow["itemLabels"]>[number];
type PurchaseHistoryRow = Awaited<ReturnType<typeof getPurchaseHistories>>[number];
type InventoryMemoRow = Awaited<ReturnType<typeof getInventoryMemos>>[number];
type InventoryItemLabelView = {
  id?: number;
  labelId: string;
  status?: string | null;
  legacyManagementNo?: string | null;
  localInventoryId?: number | null;
};

function getInventoryManagementNo(etc: string | null | undefined) {
  return String(etc ?? "").split(",")[0]?.trim() ?? "";
}

function historyDateFrom(value: unknown, fallback = new Date()): string {
  const date = value ? new Date(value as string | number | Date) : fallback;
  return Number.isNaN(date.getTime()) ? fallback.toISOString().slice(0, 10) : date.toISOString().slice(0, 10);
}

function historyTimestampFrom(value: unknown, fallback = new Date()): Date {
  const date = value ? new Date(value as string | number | Date) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function purchaseHistoryKey(row: Pick<PurchaseHistoryRow, "zaicoId" | "inventoryId" | "kanriNo" | "title">): string {
  return [row.zaicoId, row.inventoryId ?? "", row.kanriNo ?? "", row.title].join("\u0001");
}

function normalizePurchaseHistoryText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function nonEmptyPurchaseHistoryText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
}

function firstPurchaseHistoryEtcPart(value: unknown): string {
  return normalizePurchaseHistoryText(String(value ?? "").split(",")[0] ?? "");
}

function positiveHistoryNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function localPurchaseItemQuantity(item: Record<string, unknown>): number {
  return positiveHistoryNumber(item.quantity ?? item.qty) ?? 0;
}

function localPurchaseItemMatchesHistory(
  row: PurchaseHistoryRow,
  item: Record<string, unknown>,
): boolean {
  const historyManagementNo = firstPurchaseHistoryEtcPart(row.kanriNo);
  const itemManagementNo = firstPurchaseHistoryEtcPart(
    item.etc ?? item.managementNo ?? item.kanriNo,
  );
  if (historyManagementNo && itemManagementNo && historyManagementNo === itemManagementNo) return true;

  const itemInventoryId = positiveHistoryNumber(item.inventory_id ?? item.inventoryId ?? item.zaicoId);
  const historyInventoryIds = [
    positiveHistoryNumber(row.inventoryId),
    positiveHistoryNumber(row.zaicoId),
  ].filter((id): id is number => id != null);
  if (itemInventoryId != null && historyInventoryIds.includes(itemInventoryId)) return true;

  const historyTitle = normalizePurchaseHistoryText(row.title);
  const itemTitle = normalizePurchaseHistoryText(item.title);
  return Boolean(historyTitle && itemTitle && historyTitle === itemTitle);
}

function localPurchaseQuantityForHistory(row: PurchaseHistoryRow, purchase: LocalPurchaseRow): number | null {
  const directQuantity = positiveHistoryNumber(purchase.quantity);
  const items = parseLocalPurchaseItems(purchase);
  const matchingItems = items.filter((item) => localPurchaseItemMatchesHistory(row, item));
  const quantityItems = matchingItems.length > 0
    ? matchingItems
    : items.length === 1
      ? items
      : [];
  const itemQuantity = quantityItems.reduce((sum, item) => sum + localPurchaseItemQuantity(item), 0);

  if (items.length === 1) return Math.max(itemQuantity, directQuantity ?? 0) || null;
  if (matchingItems.length > 0 && itemQuantity > 0) return itemQuantity;
  return items.length === 0 ? directQuantity : null;
}

function purchaseHistoryQuantityWithPurchase(row: PurchaseHistoryRow, purchase: LocalPurchaseRow): string {
  const purchaseQuantity = localPurchaseQuantityForHistory(row, purchase);
  if (purchaseQuantity == null) return row.quantity;
  return maxPurchaseHistoryQuantity(row.quantity, String(purchaseQuantity));
}

function historyRowCreatedMs(row: Pick<PurchaseHistoryRow, "createdAt">): number {
  const ms = new Date(row.createdAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function localPurchaseCreatedMs(row: LocalPurchaseRow): number {
  const ms = new Date(row.updatedAt ?? row.createdAt).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function parseLocalPurchaseItems(row: LocalPurchaseRow): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(row.itemsJson ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((item): item is Record<string, unknown> => item != null && typeof item === "object") : [];
  } catch {
    return [];
  }
}

function preferLocalPurchaseCandidate(candidate: LocalPurchaseRow, current: LocalPurchaseRow): boolean {
  const candidateHasTracking = normalizePurchaseHistoryText(candidate.trackingNumber).length > 0;
  const currentHasTracking = normalizePurchaseHistoryText(current.trackingNumber).length > 0;
  if (candidateHasTracking !== currentHasTracking) return candidateHasTracking;
  return localPurchaseCreatedMs(candidate) > localPurchaseCreatedMs(current);
}

type LocalPurchaseHistoryLookup = {
  byPurchaseId: Map<number, LocalPurchaseRow>;
  byInventoryId: Map<number, LocalPurchaseRow>;
  byManagementNo: Map<string, LocalPurchaseRow>;
};

function buildLocalPurchaseHistoryLookup(rows: LocalPurchaseRow[]): LocalPurchaseHistoryLookup {
  const lookup: LocalPurchaseHistoryLookup = {
    byPurchaseId: new Map(),
    byInventoryId: new Map(),
    byManagementNo: new Map(),
  };

  function setBest<K>(map: Map<K, LocalPurchaseRow>, key: K | null | undefined, row: LocalPurchaseRow) {
    if (key == null || key === "") return;
    const current = map.get(key);
    if (!current || preferLocalPurchaseCandidate(row, current)) {
      map.set(key, row);
    }
  }

  for (const row of rows) {
    setBest(lookup.byPurchaseId, positiveHistoryNumber(row.id), row);
    setBest(lookup.byPurchaseId, positiveHistoryNumber(row.zaicoId), row);
    setBest(lookup.byInventoryId, positiveHistoryNumber(row.localInventoryId), row);
    setBest(lookup.byManagementNo, firstPurchaseHistoryEtcPart(row.managementNo), row);

    for (const item of parseLocalPurchaseItems(row)) {
      setBest(lookup.byInventoryId, positiveHistoryNumber(item.inventory_id ?? item.inventoryId), row);
      setBest(lookup.byManagementNo, firstPurchaseHistoryEtcPart(item.etc), row);
    }
  }

  return lookup;
}

function findLocalPurchaseForHistory(
  row: PurchaseHistoryRow,
  lookup: LocalPurchaseHistoryLookup,
): LocalPurchaseRow | null {
  const candidates: LocalPurchaseRow[] = [];
  const purchaseId = positiveHistoryNumber(row.zaicoId);
  const inventoryId = positiveHistoryNumber(row.inventoryId);
  const managementNo = firstPurchaseHistoryEtcPart(row.kanriNo);

  if (purchaseId != null) {
    const purchase = lookup.byPurchaseId.get(purchaseId);
    if (purchase) candidates.push(purchase);
  }
  if (inventoryId != null) {
    const purchase = lookup.byInventoryId.get(inventoryId);
    if (purchase) candidates.push(purchase);
  }
  if (managementNo) {
    const purchase = lookup.byManagementNo.get(managementNo);
    if (purchase) candidates.push(purchase);
  }

  return candidates.reduce<LocalPurchaseRow | null>((best, candidate) => {
    if (!best || preferLocalPurchaseCandidate(candidate, best)) return candidate;
    return best;
  }, null);
}

function enrichPurchaseHistoryRow(
  row: PurchaseHistoryRow,
  lookup: LocalPurchaseHistoryLookup,
): PurchaseHistoryRow {
  const purchase = findLocalPurchaseForHistory(row, lookup);
  if (!purchase) return row;

  return {
    ...row,
    category: row.category ?? purchase.category ?? null,
    supplier: nonEmptyPurchaseHistoryText(row.supplier) ?? nonEmptyPurchaseHistoryText(purchase.supplierName),
    quantity: purchaseHistoryQuantityWithPurchase(row, purchase),
    unitPrice: row.unitPrice ?? (purchase.unitPrice == null ? null : String(purchase.unitPrice)),
    inventoryId: row.inventoryId ?? purchase.localInventoryId ?? null,
    supplierUrl: nonEmptyPurchaseHistoryText(row.supplierUrl) ?? nonEmptyPurchaseHistoryText(purchase.supplierUrl),
    supplierName: nonEmptyPurchaseHistoryText(row.supplierName) ?? nonEmptyPurchaseHistoryText(purchase.supplierName),
    trackingNumber: nonEmptyPurchaseHistoryText(row.trackingNumber) ?? nonEmptyPurchaseHistoryText(purchase.trackingNumber),
    carrier: nonEmptyPurchaseHistoryText(row.carrier) ?? nonEmptyPurchaseHistoryText(purchase.carrier),
    receiptAckPurchaseId: purchase.id,
    receiptAckStatus: nonEmptyPurchaseHistoryText(purchase.receiptAckStatus),
    receiptAckSource: nonEmptyPurchaseHistoryText(purchase.receiptAckSource),
    receiptAckAt: purchase.receiptAckAt ?? null,
    receiptAckNote: nonEmptyPurchaseHistoryText(purchase.receiptAckNote),
  };
}

function purchaseHistoryMergeKey(row: PurchaseHistoryRow): string {
  const managementNo = firstPurchaseHistoryEtcPart(row.kanriNo);
  if (managementNo) return `management:${managementNo}`;

  const inventoryId = positiveHistoryNumber(row.inventoryId);
  const title = normalizePurchaseHistoryText(row.title);
  const date = normalizePurchaseHistoryText(row.purchaseDate);
  if (inventoryId != null && title) return `inventory:${inventoryId}:${title}:${date}`;

  return `row:${row.id}`;
}

function preferPurchaseHistoryRow(candidate: PurchaseHistoryRow, current: PurchaseHistoryRow): boolean {
  const candidateIsStored = candidate.id > 0;
  const currentIsStored = current.id > 0;
  if (candidateIsStored !== currentIsStored) return candidateIsStored;

  const candidateActive = candidate.cancelled === 0;
  const currentActive = current.cancelled === 0;
  if (candidateActive !== currentActive) return candidateActive;

  return historyRowCreatedMs(candidate) > historyRowCreatedMs(current);
}

function maxPurchaseHistoryQuantity(a: string, b: string): string {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return String(Math.max(na, nb));
  return a || b;
}

function mergePurchaseHistoryRows(a: PurchaseHistoryRow, b: PurchaseHistoryRow): PurchaseHistoryRow {
  const primary = preferPurchaseHistoryRow(b, a) ? b : a;
  const secondary = primary === a ? b : a;

  return {
    ...primary,
    kanriNo: primary.kanriNo ?? secondary.kanriNo,
    title: primary.title || secondary.title,
    category: primary.category ?? secondary.category,
    supplier: primary.supplier ?? secondary.supplier,
    quantity: maxPurchaseHistoryQuantity(primary.quantity, secondary.quantity),
    unitPrice: primary.unitPrice ?? secondary.unitPrice,
    purchaseDate: primary.purchaseDate || secondary.purchaseDate,
    inventoryId: primary.inventoryId ?? secondary.inventoryId,
    cancelled: primary.cancelled === 0 || secondary.cancelled === 0 ? 0 : primary.cancelled,
    operatorName: primary.operatorName ?? secondary.operatorName,
    supplierUrl: nonEmptyPurchaseHistoryText(primary.supplierUrl) ?? nonEmptyPurchaseHistoryText(secondary.supplierUrl),
    supplierName: nonEmptyPurchaseHistoryText(primary.supplierName) ?? nonEmptyPurchaseHistoryText(secondary.supplierName),
    trackingNumber: nonEmptyPurchaseHistoryText(primary.trackingNumber) ?? nonEmptyPurchaseHistoryText(secondary.trackingNumber),
    carrier: nonEmptyPurchaseHistoryText(primary.carrier) ?? nonEmptyPurchaseHistoryText(secondary.carrier),
    receiptAckPurchaseId: primary.receiptAckPurchaseId ?? secondary.receiptAckPurchaseId,
    receiptAckStatus: nonEmptyPurchaseHistoryText(primary.receiptAckStatus) ?? nonEmptyPurchaseHistoryText(secondary.receiptAckStatus),
    receiptAckSource: nonEmptyPurchaseHistoryText(primary.receiptAckSource) ?? nonEmptyPurchaseHistoryText(secondary.receiptAckSource),
    receiptAckAt: primary.receiptAckAt ?? secondary.receiptAckAt,
    receiptAckNote: nonEmptyPurchaseHistoryText(primary.receiptAckNote) ?? nonEmptyPurchaseHistoryText(secondary.receiptAckNote),
  };
}

function collapsePurchaseHistoryRows(rows: PurchaseHistoryRow[]): PurchaseHistoryRow[] {
  const byKey = new Map<string, PurchaseHistoryRow>();
  for (const row of rows) {
    const key = purchaseHistoryMergeKey(row);
    const existing = byKey.get(key);
    byKey.set(key, existing ? mergePurchaseHistoryRows(existing, row) : row);
  }
  return Array.from(byKey.values());
}

async function getRecoveredPurchaseHistoriesFromLabels(
  histories: PurchaseHistoryRow[],
  limit: number,
): Promise<PurchaseHistoryRow[]> {
  const existingKeys = new Set(histories.map(purchaseHistoryKey));
  const recovered: PurchaseHistoryRow[] = [];
  const inventories = await getLocalInventories();

  for (const inventory of inventories) {
    const zaicoId = Number(inventory.zaicoId ?? inventory.id);
    if (!Number.isFinite(zaicoId) || zaicoId <= 0) continue;

    for (const label of inventory.itemLabels ?? []) {
      const status = String(label.status ?? "").trim().toLowerCase();
      if (status !== "received" && status !== "stocked") continue;

      const kanriNo = label.legacyManagementNo?.trim() || getInventoryManagementNo(inventory.etc) || null;
      const title = label.title?.trim() || inventory.title;
      const key = purchaseHistoryKey({ zaicoId, inventoryId: inventory.id, kanriNo, title });
      if (existingKeys.has(key)) continue;

      const createdAt = historyTimestampFrom(label.receivedAt ?? label.createdAt ?? inventory.updatedAt);
      recovered.push({
        id: -Math.abs(Number(label.id ?? recovered.length + 1)),
        zaicoId,
        kanriNo,
        title,
        category: inventory.category ?? null,
        supplier: inventory.supplierName ?? null,
        quantity: "1",
        unitPrice: inventory.unitPrice == null ? null : String(inventory.unitPrice),
        purchaseDate: historyDateFrom(label.receivedAt ?? label.createdAt ?? inventory.updatedAt, createdAt),
        inventoryId: inventory.id,
        cancelled: 0,
        operatorName: null,
        createdAt,
        supplierUrl: inventory.supplierUrl ?? null,
        supplierName: inventory.supplierName ?? null,
        trackingNumber: null,
        carrier: null,
        receiptAckPurchaseId: null,
        receiptAckStatus: null,
        receiptAckSource: null,
        receiptAckAt: null,
        receiptAckNote: null,
      });
      existingKeys.add(key);
      if (recovered.length >= limit) return recovered;
    }
  }

  return recovered;
}

function inventoryStockQuantity(quantity: unknown): number {
  const value = Math.floor(Number(quantity ?? 0));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function inventoryLabelQuantity(quantity: unknown): number {
  return Math.max(1, inventoryStockQuantity(quantity));
}

function inventoryInitialLabelStatus(quantity: unknown): "ordered" | "stocked" {
  return inventoryStockQuantity(quantity) > 0 ? "stocked" : "ordered";
}

const EBAY_7696_SECOND_MANAGEMENT_NO = "ebay_7696_2";
const EBAY_7696_SECOND_RESTORE_SETTING_KEY = "repair:inventory:ebay_7696_2:restored:v5";
const EBAY_7696_SECOND_ALTERNATE_MANAGEMENT_NO = "ebay_7696_2_代替";
const EBAY_7696_SECOND_ALTERNATE_RESTORE_SETTING_KEY = "repair:inventory:ebay_7696_2:alternate-restored:v1";
const EBAY_7696_SECOND_KNOWN_CONTENT_SETTING_KEY = "repair:inventory:ebay_7696_2:known-content:v1";
const EBAY_7696_SECOND_ORDER_SYNC_SETTING_KEY = "repair:inventory:ebay_7696_2:order-sync:v1";
const EBAY_7696_SECOND_CORRECTED_UNIT_PRICE = "14790";
const EBAY_7696_SECOND_KNOWN_PURCHASE_DATE = "2026-08-12";
const EBAY_7696_SECOND_KNOWN_SUPPLIER_NAME = "駿河屋 名古屋栄店";
let inventoryOneTimeRepairPromise: Promise<void> | null = null;

const MAXIM_404_3DSLL_SECOND_MANAGEMENT_NO = "404_マキシム_3DSLL_2/5";
const MAXIM_404_3DSLL_SECOND_KEEP_LABEL_ID = "SEGCUWZ";
const MAXIM_404_3DSLL_SECOND_REMOVE_LABEL_ID = "QDYEZHT";

type InventoryRestoreField =
  | "title"
  | "quantity"
  | "unit"
  | "category"
  | "place"
  | "etc"
  | "unitPrice"
  | "supplierName"
  | "supplierUrl"
  | "ebayListingUrl"
  | "ebayOrderUrl"
  | "ebayOrderStatus";

const INVENTORY_RESTORE_FIELD_LABELS: Record<string, InventoryRestoreField> = {
  商品名: "title",
  在庫数: "quantity",
  単位: "unit",
  カテゴリ: "category",
  保管場所: "place",
  "管理番号・備考": "etc",
  仕入単価: "unitPrice",
  仕入先: "supplierName",
  仕入先URL: "supplierUrl",
  eBay出品URL: "ebayListingUrl",
  eBay注文URL: "ebayOrderUrl",
  eBay状態: "ebayOrderStatus",
};

function parseInventoryRestoreMemo(memo: string | null | undefined): Partial<Record<InventoryRestoreField, string | null>> {
  const restored: Partial<Record<InventoryRestoreField, string | null>> = {};
  for (const part of String(memo ?? "").split(" / ")) {
    const separatorIndex = part.indexOf(": ");
    if (separatorIndex < 0) continue;
    const field = INVENTORY_RESTORE_FIELD_LABELS[part.slice(0, separatorIndex).trim()];
    if (!field) continue;

    const valuePart = part.slice(separatorIndex + 2);
    const arrowIndex = valuePart.indexOf(" → ");
    if (arrowIndex < 0) continue;
    const before = valuePart.slice(0, arrowIndex).trim();
    restored[field] = before === "（空）" ? null : before;
  }
  return restored;
}

function hasIdentityRestoreFields(restored: Partial<Record<InventoryRestoreField, string | null>>): boolean {
  return [
    "title",
    "quantity",
    "category",
    "place",
    "unit",
    "unitPrice",
    "supplierName",
    "supplierUrl",
    "ebayListingUrl",
    "ebayOrderUrl",
    "ebayOrderStatus",
  ].some((field) => field in restored);
}

function isUsableEbay7696SecondRestoreSnapshot(restored: Partial<Record<InventoryRestoreField, string | null>>): boolean {
  if (!hasIdentityRestoreFields(restored)) return false;
  if (!("etc" in restored)) return true;
  return getInventoryManagementNo(restored.etc) === EBAY_7696_SECOND_MANAGEMENT_NO;
}

function restoreSnapshotDiffersFromInventory(
  restored: Partial<Record<InventoryRestoreField, string | null>>,
  inventory: LocalInventoryRow,
): boolean {
  const currentValues: Record<InventoryRestoreField, string | null> = {
    title: inventory.title ?? null,
    quantity: String(Math.max(0, Math.round(Number(inventory.quantity) || 0))),
    unit: inventory.unit ?? null,
    category: inventory.category ?? null,
    place: inventory.place ?? null,
    etc: inventory.etc ?? null,
    unitPrice: inventory.unitPrice ?? null,
    supplierName: inventory.supplierName ?? null,
    supplierUrl: inventory.supplierUrl ?? null,
    ebayListingUrl: inventory.ebayListingUrl ?? null,
    ebayOrderUrl: inventory.ebayOrderUrl ?? null,
    ebayOrderStatus: normalizeEbayOrderStatus(inventory.ebayOrderStatus) ?? null,
  };
  return (Object.keys(restored) as InventoryRestoreField[]).some((field) => {
    const restoredValue = field === "quantity"
      ? String(Math.max(0, Math.round(Number(restored[field]) || 0)))
      : String(restored[field] ?? "").trim();
    const currentValue = String(currentValues[field] ?? "").trim();
    return restoredValue !== currentValue;
  });
}

const INVENTORY_RESTORE_FIELDS = [
  "title",
  "quantity",
  "unit",
  "category",
  "place",
  "etc",
  "unitPrice",
  "supplierName",
  "supplierUrl",
  "ebayListingUrl",
  "ebayOrderUrl",
  "ebayOrderStatus",
] as const satisfies readonly InventoryRestoreField[];

const INVENTORY_RESTORE_FIELD_NAMES: Record<InventoryRestoreField, string> = {
  title: "商品名",
  quantity: "在庫数",
  unit: "単位",
  category: "カテゴリ",
  place: "保管場所",
  etc: "管理番号・備考",
  unitPrice: "仕入単価",
  supplierName: "仕入先",
  supplierUrl: "仕入先URL",
  ebayListingUrl: "eBay出品URL",
  ebayOrderUrl: "eBay注文URL",
  ebayOrderStatus: "eBay状態",
};

function normalizeRestoreSearchText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function inventoryRestoreValue(inventory: LocalInventoryRow, field: InventoryRestoreField): string | null {
  if (field === "quantity") return String(Math.max(0, Math.round(Number(inventory.quantity) || 0)));
  if (field === "unitPrice") return inventory.unitPrice == null ? null : String(inventory.unitPrice);
  const value = inventory[field as keyof LocalInventoryRow];
  return value == null ? null : String(value);
}

function restoreSearchInventoryHaystack(inventory: LocalInventoryRow): string {
  const labelText = (inventory.itemLabels ?? [])
    .map((label) => `${label.labelId ?? ""} ${label.legacyManagementNo ?? ""}`)
    .join(" ");
  return normalizeRestoreSearchText([
    inventory.id,
    inventory.zaicoId,
    inventory.title,
    inventory.category,
    inventory.place,
    inventory.etc,
    inventory.supplierName,
    inventory.supplierUrl,
    getInventoryManagementNo(inventory.etc),
    labelText,
  ].filter(Boolean).join(" "));
}

function restoreSearchDeletedHaystack(item: Awaited<ReturnType<typeof getDeletedInventories>>[number]): string {
  return normalizeRestoreSearchText([
    item.id,
    item.zaicoId,
    item.title,
    item.category,
    item.place,
    item.etc,
    item.unitPrice,
    item.deletedBy,
    getInventoryManagementNo(item.etc),
  ].filter(Boolean).join(" "));
}

function parsedRestoreFieldsForMemo(memo: InventoryMemoRow, inventory: LocalInventoryRow | null) {
  const restored = parseInventoryRestoreMemo(memo.memo);
  return (Object.keys(restored) as InventoryRestoreField[])
    .filter((field) => INVENTORY_RESTORE_FIELDS.includes(field))
    .map((field) => ({
      field,
      label: INVENTORY_RESTORE_FIELD_NAMES[field],
      restoreValue: restored[field],
      currentValue: inventory ? inventoryRestoreValue(inventory, field) : null,
    }));
}

const FULL_RESTORE_SNAPSHOT_MARKER = "__FULL_RESTORE_SNAPSHOT_V1__:";
const FULL_RESTORE_SNAPSHOT_CHANGE_TYPE = "restore_snapshot";

type FullRestoreLabelSnapshot = Partial<LocalInventoryItemLabelRow & LocalPurchaseItemLabelRow>;
type FullRestoreInventorySnapshot = Partial<InsertLocalInventory> & {
  id?: number | null;
  zaicoId?: number | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  itemLabels?: FullRestoreLabelSnapshot[];
};
type FullRestorePurchaseSnapshot = Partial<InsertLocalPurchase> & {
  id?: number | null;
  zaicoId?: number | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  itemLabels?: FullRestoreLabelSnapshot[];
};
type FullRestoreSnapshot = {
  version: 1;
  capturedAt: string;
  source: string;
  reason: string;
  operatorName?: string | null;
  inventory: FullRestoreInventorySnapshot | null;
  purchases: FullRestorePurchaseSnapshot[];
  labels?: FullRestoreLabelSnapshot[];
};

function jsonSnapshotClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T;
}

function parseFullRestoreSnapshotMemo(memo: string | null | undefined): FullRestoreSnapshot | null {
  const text = String(memo ?? "");
  if (!text.startsWith(FULL_RESTORE_SNAPSHOT_MARKER)) return null;
  try {
    const parsed = JSON.parse(text.slice(FULL_RESTORE_SNAPSHOT_MARKER.length)) as FullRestoreSnapshot;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function fullRestoreSnapshotHaystack(memo: InventoryMemoRow, snapshot: FullRestoreSnapshot): string {
  const inventory = snapshot.inventory;
  const purchaseText = snapshot.purchases
    .map((purchase) => [
      purchase.id,
      purchase.zaicoId,
      purchase.title,
      purchase.managementNo,
      purchase.purchaseNum,
      purchase.trackingNumber,
      purchase.carrier,
      purchase.supplierName,
      purchase.supplierUrl,
      ...(purchase.itemLabels ?? []).map((label) => label.labelId),
    ].filter(Boolean).join(" "))
    .join(" ");
  return normalizeRestoreSearchText([
    memo.id,
    memo.zaicoInventoryId,
    memo.title,
    memo.operatorName,
    snapshot.source,
    snapshot.reason,
    inventory?.id,
    inventory?.zaicoId,
    inventory?.title,
    inventory?.etc,
    inventory ? getInventoryManagementNo(inventory.etc) : null,
    inventory?.supplierName,
    inventory?.supplierUrl,
    ...(inventory?.itemLabels ?? []).map((label) => label.labelId),
    purchaseText,
  ].filter(Boolean).join(" "));
}

function localPurchasePrimaryManagementNo(row: Pick<LocalPurchaseRow, "managementNo" | "itemsJson">): string {
  const direct = getInventoryManagementNo(row.managementNo);
  if (direct) return direct;
  for (const item of parseLocalPurchaseItems(row as LocalPurchaseRow)) {
    const itemManagementNo = getInventoryManagementNo(String(item.etc ?? ""));
    if (itemManagementNo) return itemManagementNo;
  }
  return "";
}

function localPurchaseMatchesInventoryForRestore(
  row: LocalPurchaseRow,
  localInventoryId: number | null,
  managementNo: string,
): boolean {
  if (localInventoryId != null && Number(row.localInventoryId) === Number(localInventoryId)) return true;
  if (managementNo && localPurchasePrimaryManagementNo(row) === managementNo) return true;
  return parseLocalPurchaseItems(row).some((item) => {
    const itemInventoryId = Number(item.inventory_id ?? item.inventoryId ?? 0);
    if (localInventoryId != null && itemInventoryId === Number(localInventoryId)) return true;
    const itemManagementNo = getInventoryManagementNo(String(item.etc ?? item.managementNo ?? ""));
    return Boolean(managementNo && itemManagementNo === managementNo);
  });
}

async function getRelatedLocalPurchasesForFullRestore(inventory: { id: number; etc?: string | null }): Promise<LocalPurchaseRow[]> {
  const managementNo = getInventoryManagementNo(inventory.etc);
  const rows = await getLocalPurchases();
  return rows.filter((row) => localPurchaseMatchesInventoryForRestore(row, inventory.id, managementNo));
}

async function enrichInventoryForFullRestore(
  inventory: (Partial<LocalInventoryRow> & { id: number }) | null | undefined,
): Promise<FullRestoreInventorySnapshot | null> {
  if (!inventory) return null;
  const labelMap = await getInventoryItemLabelsByInventoryIds([inventory.id]).catch(() => new Map<number, LocalInventoryItemLabelRow[]>());
  const itemLabels = (inventory.itemLabels ?? labelMap.get(inventory.id) ?? []) as FullRestoreLabelSnapshot[];
  return jsonSnapshotClone({
    ...inventory,
    itemLabels,
  } satisfies FullRestoreInventorySnapshot);
}

async function enrichPurchasesForFullRestore(
  purchases: Array<Partial<LocalPurchaseRow> & { id?: number | null }>,
): Promise<FullRestorePurchaseSnapshot[]> {
  if (purchases.length === 0) return [];
  const allPurchases = await getLocalPurchases().catch(() => [] as LocalPurchaseRow[]);
  return purchases.map((purchase) => {
    const enriched = purchase.id ? allPurchases.find((row) => row.id === purchase.id) ?? purchase : purchase;
    return jsonSnapshotClone(enriched as FullRestorePurchaseSnapshot);
  });
}

function uniqueFullRestoreLabels(snapshot: FullRestoreSnapshot): FullRestoreLabelSnapshot[] {
  const byLabelId = new Map<string, FullRestoreLabelSnapshot>();
  const add = (label: FullRestoreLabelSnapshot | null | undefined) => {
    const labelId = String(label?.labelId ?? "").trim().toUpperCase();
    if (!labelId) return;
    byLabelId.set(labelId, { ...label, labelId });
  };
  (snapshot.labels ?? []).forEach(add);
  (snapshot.inventory?.itemLabels ?? []).forEach(add);
  for (const purchase of snapshot.purchases) {
    (purchase.itemLabels ?? []).forEach(add);
  }
  return [...byLabelId.values()];
}

async function recordFullRestoreSnapshot(input: {
  inventory?: (Partial<LocalInventoryRow> & { id: number }) | null;
  purchases?: Array<Partial<LocalPurchaseRow> & { id?: number | null }>;
  source: string;
  reason: string;
  operatorName?: string | null;
}) {
  try {
    const inventory = await enrichInventoryForFullRestore(input.inventory ?? null);
    const purchases = input.purchases
      ? await enrichPurchasesForFullRestore(input.purchases)
      : inventory?.id
        ? await enrichPurchasesForFullRestore(await getRelatedLocalPurchasesForFullRestore({ id: inventory.id, etc: inventory.etc ?? null }))
        : [];
    if (!inventory && purchases.length === 0) return;

    const snapshot: FullRestoreSnapshot = {
      version: 1,
      capturedAt: new Date().toISOString(),
      source: input.source,
      reason: input.reason,
      operatorName: input.operatorName ?? null,
      inventory,
      purchases,
      labels: uniqueFullRestoreLabels({ version: 1, capturedAt: "", source: input.source, reason: input.reason, inventory, purchases }),
    };
    const memoInventoryId = Number(inventory?.zaicoId ?? inventory?.id ?? purchases[0]?.localInventoryId ?? purchases[0]?.id ?? 0);
    if (!Number.isFinite(memoInventoryId) || memoInventoryId <= 0) return;
    await createInventoryMemo({
      zaicoInventoryId: memoInventoryId,
      title: String(inventory?.title ?? purchases[0]?.title ?? "復元スナップショット"),
      changeType: FULL_RESTORE_SNAPSHOT_CHANGE_TYPE,
      quantityBefore: inventory?.quantity == null ? null : Math.round(Number(inventory.quantity) || 0),
      quantityAfter: inventory?.quantity == null ? null : Math.round(Number(inventory.quantity) || 0),
      quantityDelta: 0,
      memo: `${FULL_RESTORE_SNAPSHOT_MARKER}${JSON.stringify(snapshot)}`,
      operatorName: input.operatorName ?? null,
    });
  } catch (error) {
    console.warn("[restore-management] failed to record full restore snapshot", error);
  }
}

function fullRestoreInventoryValues(snapshot: FullRestoreInventorySnapshot): InsertLocalInventory {
  return {
    zaicoId: snapshot.zaicoId == null ? null : Number(snapshot.zaicoId),
    title: String(snapshot.title ?? "").trim() || "名称未設定",
    category: snapshot.category ?? null,
    place: snapshot.place ?? null,
    quantity: Math.max(0, Math.round(Number(snapshot.quantity) || 0)),
    unit: snapshot.unit ?? "個",
    unitPrice: snapshot.unitPrice == null ? null : String(snapshot.unitPrice),
    etc: snapshot.etc ?? null,
    supplierUrl: snapshot.supplierUrl ?? null,
    supplierName: snapshot.supplierName ?? null,
    ebayListingUrl: snapshot.ebayListingUrl ?? null,
    ebayOrderUrl: snapshot.ebayOrderUrl ?? null,
    ebayOrderStatus: normalizeEbayOrderStatus(snapshot.ebayOrderStatus ?? "normal"),
    isDeleted: Number(snapshot.isDeleted ?? 0),
  };
}

function snapshotDateValue(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(value as string | number | Date);
  return Number.isNaN(date.getTime()) ? null : date;
}

function updatePurchaseItemsInventoryId(itemsJson: unknown, previousInventoryId: number | null, nextInventoryId: number | null): string {
  if (!itemsJson) return "[]";
  try {
    const items = JSON.parse(String(itemsJson));
    if (!Array.isArray(items)) return String(itemsJson);
    return JSON.stringify(items.map((item) => {
      if (!item || typeof item !== "object") return item;
      const currentInventoryId = Number((item as Record<string, unknown>).inventory_id ?? (item as Record<string, unknown>).inventoryId ?? 0);
      if (previousInventoryId != null && currentInventoryId === previousInventoryId && nextInventoryId != null) {
        return { ...item, inventory_id: nextInventoryId, inventoryId: nextInventoryId };
      }
      return item;
    }));
  } catch {
    return String(itemsJson);
  }
}

function fullRestorePurchaseValues(
  snapshot: FullRestorePurchaseSnapshot,
  previousInventoryId: number | null,
  restoredInventoryId: number | null,
): InsertLocalPurchase {
  const linkedInventoryId = snapshot.localInventoryId == null
    ? null
    : Number(snapshot.localInventoryId) === Number(previousInventoryId)
      ? restoredInventoryId
      : Number(snapshot.localInventoryId);
  return {
    zaicoId: snapshot.zaicoId == null ? null : Number(snapshot.zaicoId),
    purchaseNum: snapshot.purchaseNum ?? null,
    status: snapshot.status ?? "ordered",
    itemsJson: updatePurchaseItemsInventoryId(snapshot.itemsJson, previousInventoryId, restoredInventoryId),
    localInventoryId: linkedInventoryId,
    title: snapshot.title ?? null,
    category: snapshot.category ?? null,
    quantity: Math.max(1, Math.round(Number(snapshot.quantity) || 1)),
    unitPrice: snapshot.unitPrice == null ? null : String(snapshot.unitPrice),
    managementNo: snapshot.managementNo ?? null,
    purchaseDate: snapshot.purchaseDate ?? null,
    receivedDate: snapshot.receivedDate ?? null,
    shipDate: snapshot.shipDate ?? null,
    trackingNumber: snapshot.trackingNumber ?? null,
    carrier: snapshot.carrier ?? null,
    note: snapshot.note ?? null,
    supplierUrl: snapshot.supplierUrl ?? null,
    supplierName: snapshot.supplierName ?? null,
    inboundClass: snapshot.inboundClass ?? null,
    classSource: snapshot.classSource ?? "auto",
    stage: snapshot.stage ?? "received",
    stageUpdatedBy: snapshot.stageUpdatedBy ?? null,
    stageUpdatedAt: snapshotDateValue(snapshot.stageUpdatedAt),
    shaftParentPurchaseId: snapshot.shaftParentPurchaseId ?? null,
  };
}

async function restoreInventoryFromFullSnapshot(snapshot: FullRestoreInventorySnapshot | null): Promise<number | null> {
  if (!snapshot) return null;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { localInventories: inventoryTbl } = await import("../../drizzle/schema");
  const values = fullRestoreInventoryValues(snapshot);
  const snapshotId = Number(snapshot.id ?? 0);
  const existingById = snapshotId > 0 ? await getLocalInventoryById(snapshotId) : null;
  if (existingById) {
    await updateLocalInventory(snapshotId, values);
    return snapshotId;
  }
  const existingByZaico = values.zaicoId != null ? await getLocalInventoryByZaicoId(Number(values.zaicoId)) : null;
  if (existingByZaico) {
    await updateLocalInventory(existingByZaico.id, values);
    return existingByZaico.id;
  }
  if (snapshotId > 0) {
    await db.insert(inventoryTbl).values({ id: snapshotId, ...values } as typeof inventoryTbl.$inferInsert);
    return snapshotId;
  }
  const insertedId = await upsertLocalInventory(values);
  if (insertedId > 0) return insertedId;
  const managementNo = getInventoryManagementNo(values.etc);
  const restored = (await getLocalInventories(true)).find((inventory) =>
    (values.zaicoId != null && inventory.zaicoId === values.zaicoId) ||
    (managementNo && getInventoryManagementNo(inventory.etc) === managementNo)
  );
  return restored?.id ?? null;
}

async function restorePurchasesFromFullSnapshot(
  snapshots: FullRestorePurchaseSnapshot[],
  previousInventoryId: number | null,
  restoredInventoryId: number | null,
): Promise<Map<number, number>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { localPurchases: purchaseTbl } = await import("../../drizzle/schema");
  const purchaseIdMap = new Map<number, number>();
  const currentPurchases = await getLocalPurchases();
  for (const snapshot of snapshots) {
    const values = fullRestorePurchaseValues(snapshot, previousInventoryId, restoredInventoryId);
    const snapshotId = Number(snapshot.id ?? 0);
    let target = snapshotId > 0 ? currentPurchases.find((row) => row.id === snapshotId) : null;
    if (!target && values.zaicoId != null) {
      target = currentPurchases.find((row) => row.zaicoId === values.zaicoId);
    }
    if (!target && values.managementNo) {
      target = currentPurchases.find((row) => localPurchasePrimaryManagementNo(row) === getInventoryManagementNo(values.managementNo));
    }
    if (target) {
      await updateLocalPurchase(target.id, values);
      if (snapshotId > 0) purchaseIdMap.set(snapshotId, target.id);
      continue;
    }
    if (snapshotId > 0) {
      await db.insert(purchaseTbl).values({ id: snapshotId, ...values } as typeof purchaseTbl.$inferInsert);
      purchaseIdMap.set(snapshotId, snapshotId);
      continue;
    }
    const insertedId = await insertLocalPurchase(values);
    if (insertedId > 0 && snapshotId > 0) purchaseIdMap.set(snapshotId, insertedId);
  }
  return purchaseIdMap;
}

function fullRestoreLabelValues(
  label: FullRestoreLabelSnapshot,
  previousInventoryId: number | null,
  restoredInventoryId: number | null,
  purchaseIdMap: Map<number, number>,
) {
  const previousPurchaseId = Number(label.purchaseId ?? 0);
  const nextPurchaseId = previousPurchaseId > 0 ? purchaseIdMap.get(previousPurchaseId) ?? previousPurchaseId : null;
  const previousLabelInventoryId = Number(label.localInventoryId ?? 0);
  const nextInventoryId =
    previousInventoryId != null &&
    previousLabelInventoryId === previousInventoryId &&
    restoredInventoryId != null
      ? restoredInventoryId
      : previousLabelInventoryId > 0 ? previousLabelInventoryId : null;
  return {
    labelId: String(label.labelId ?? "").trim().toUpperCase(),
    purchaseId: nextPurchaseId,
    localInventoryId: nextInventoryId,
    legacyManagementNo: label.legacyManagementNo ?? null,
    title: String(label.title ?? "").trim() || "名称未設定",
    status: label.status ?? "ordered",
    sourceKey: label.sourceKey ?? null,
    outboundBoxId: label.outboundBoxId ?? null,
    receivedAt: snapshotDateValue(label.receivedAt),
    shippedAt: snapshotDateValue(label.shippedAt),
    defectTags: label.defectTags ?? null,
    defectNote: label.defectNote ?? null,
    defectPhotosJson: label.defectPhotosJson ?? null,
    defectRecordedAt: snapshotDateValue(label.defectRecordedAt),
    yahooClosedPricesJson: label.yahooClosedPricesJson ?? null,
    yahooPriceFetchedAt: snapshotDateValue(label.yahooPriceFetchedAt),
    defectiveSheetSyncedAt: snapshotDateValue(label.defectiveSheetSyncedAt),
    inspectionOutcome: label.inspectionOutcome ?? null,
    replacementRequested: label.replacementRequested ?? null,
    inspectionSourceInventoryId: label.inspectionSourceInventoryId ?? null,
    inspectionInventoryId: label.inspectionInventoryId ?? null,
    inspectionQuantityDelta: label.inspectionQuantityDelta ?? null,
    inspectionPurchaseHistoryId: label.inspectionPurchaseHistoryId ?? null,
    inspectionActionItemId: label.inspectionActionItemId ?? null,
    inspectedAt: snapshotDateValue(label.inspectedAt),
    inspectionCancelledAt: snapshotDateValue(label.inspectionCancelledAt),
    inspectionCancelledBy: label.inspectionCancelledBy ?? null,
  };
}

async function restoreLabelsFromFullSnapshot(
  snapshot: FullRestoreSnapshot,
  previousInventoryId: number | null,
  restoredInventoryId: number | null,
  purchaseIdMap: Map<number, number>,
): Promise<number> {
  const labels = uniqueFullRestoreLabels(snapshot);
  if (labels.length === 0) return 0;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { inventoryItemLabels: labelTbl } = await import("../../drizzle/schema");
  let restoredCount = 0;
  for (const label of labels) {
    const values = fullRestoreLabelValues(label, previousInventoryId, restoredInventoryId, purchaseIdMap);
    if (!values.labelId) continue;
    const existing = await db
      .select({ id: labelTbl.id })
      .from(labelTbl)
      .where(eq(labelTbl.labelId, values.labelId))
      .limit(1);
    if (existing[0]) {
      await db.update(labelTbl).set(values).where(eq(labelTbl.id, existing[0].id));
    } else {
      await db.insert(labelTbl).values(values);
    }
    restoredCount++;
  }
  return restoredCount;
}

async function repairEbay7696SecondInventoryOverwrite(): Promise<void> {
  const alternateAlreadyRestored = await getSystemSetting(EBAY_7696_SECOND_ALTERNATE_RESTORE_SETTING_KEY);
  if (alternateAlreadyRestored !== "1") {
    const inventoriesWithDeleted = await getLocalInventories(true);
    const alternateTarget = inventoriesWithDeleted.find(
      (inventory) => getInventoryManagementNo(inventory.etc) === EBAY_7696_SECOND_ALTERNATE_MANAGEMENT_NO,
    );
    if (!alternateTarget) {
      await setSystemSetting(EBAY_7696_SECOND_ALTERNATE_RESTORE_SETTING_KEY, "1");
    } else {
      if (Number(alternateTarget.isDeleted ?? 0) !== 0) {
        await updateLocalInventory(alternateTarget.id, { isDeleted: 0 });
      }
      await setSystemSetting(EBAY_7696_SECOND_ALTERNATE_RESTORE_SETTING_KEY, "1");
    }
  }

  const alreadyRestored = await getSystemSetting(EBAY_7696_SECOND_RESTORE_SETTING_KEY);
  if (alreadyRestored === "1") return;

  const inventories = await getLocalInventories(true);
  const target = inventories.find(
    (inventory) => getInventoryManagementNo(inventory.etc) === EBAY_7696_SECOND_MANAGEMENT_NO,
  );
  if (!target) {
    await setSystemSetting(EBAY_7696_SECOND_RESTORE_SETTING_KEY, "1");
    return;
  }
  if (Number(target.isDeleted ?? 0) === 0) {
    await setSystemSetting(EBAY_7696_SECOND_RESTORE_SETTING_KEY, "1");
    return;
  }

  const memoCandidates: Array<{ inventory: LocalInventoryRow; memo: InventoryMemoRow; restored: Partial<Record<InventoryRestoreField, string | null>> }> = [];
  for (const inventory of [target]) {
    const inventoryIdForMemos = inventory.zaicoId ?? inventory.id;
    const memos = await getInventoryMemos(inventoryIdForMemos, 100);
    for (const memo of memos) {
      if (String(memo.changeType ?? "").trim() !== "updated") continue;
      if (!String(memo.memo ?? "").includes(" → ")) continue;
      const restored = parseInventoryRestoreMemo(memo.memo);
      if (!isUsableEbay7696SecondRestoreSnapshot(restored)) continue;
      memoCandidates.push({ inventory, memo, restored });
    }
  }
  memoCandidates.sort((a, b) => String(b.memo.createdAt ?? "").localeCompare(String(a.memo.createdAt ?? "")));
  const restoreCandidate = memoCandidates.find((candidate) =>
    restoreSnapshotDiffersFromInventory(candidate.restored, target),
  );
  if (!restoreCandidate) {
    await setSystemSetting(EBAY_7696_SECOND_RESTORE_SETTING_KEY, "1");
    return;
  }

  const restored = restoreCandidate.restored;
  const restoredEtc = restored.etc ?? target.etc;
  if (getInventoryManagementNo(restoredEtc) !== EBAY_7696_SECOND_MANAGEMENT_NO) {
    await setSystemSetting(EBAY_7696_SECOND_RESTORE_SETTING_KEY, "1");
    return;
  }

  const nextValues = {
    title: restored.title ?? target.title,
    quantity: restored.quantity == null ? target.quantity : Math.max(0, Math.round(Number(restored.quantity) || 0)),
    unit: restored.unit ?? target.unit,
    category: restored.category ?? target.category,
    place: restored.place ?? target.place,
    etc: restoredEtc,
    unitPrice: restored.unitPrice ?? target.unitPrice,
    supplierName: restored.supplierName ?? target.supplierName,
    supplierUrl: restored.supplierUrl ?? target.supplierUrl,
    ebayListingUrl: restored.ebayListingUrl ?? target.ebayListingUrl,
    ebayOrderUrl: restored.ebayOrderUrl ?? target.ebayOrderUrl,
    ebayOrderStatus: normalizeEbayOrderStatus(restored.ebayOrderStatus ?? target.ebayOrderStatus),
  };

  const targetInventoryIdForMemos = target.zaicoId ?? target.id;
  await updateLocalInventory(target.id, nextValues);
  await ensureInventoryItemLabelsForInventory({
    localInventoryId: target.id,
    legacyManagementNo: getInventoryManagementNo(nextValues.etc),
    title: nextValues.title,
    quantity: inventoryLabelQuantity(nextValues.quantity),
    status: inventoryInitialLabelStatus(nextValues.quantity),
    sourceKey: `inventory:${target.id}`,
  });
  await recordInventoryChange({
    inventoryId: targetInventoryIdForMemos,
    title: nextValues.title,
    changeType: "updated",
    source: "ui",
    note: "ebay_7696_2 を上書き前の変更履歴から復元",
    quantityBefore: target.quantity,
    quantityAfter: nextValues.quantity,
  });
  await setSystemSetting(EBAY_7696_SECOND_RESTORE_SETTING_KEY, "1");
}

async function repairEbay7696SecondKnownContent(): Promise<void> {
  const alreadyApplied = await getSystemSetting(EBAY_7696_SECOND_KNOWN_CONTENT_SETTING_KEY);
  if (alreadyApplied === "1") return;

  const inventories = await getLocalInventories(true);
  const target = inventories.find(
    (inventory) => getInventoryManagementNo(inventory.etc) === EBAY_7696_SECOND_MANAGEMENT_NO,
  );
  if (!target) {
    await setSystemSetting(EBAY_7696_SECOND_KNOWN_CONTENT_SETTING_KEY, "1");
    return;
  }

  const nextEtc = `${EBAY_7696_SECOND_MANAGEMENT_NO}, ${EBAY_7696_SECOND_KNOWN_PURCHASE_DATE}, ${EBAY_7696_SECOND_KNOWN_SUPPLIER_NAME}`;
  const currentSupplierUrl = String(target.supplierUrl ?? "").trim();
  const nextSupplierUrl = /suruga-ya|suruga/i.test(currentSupplierUrl) ? currentSupplierUrl : null;
  await updateLocalInventory(target.id, {
    etc: nextEtc,
    supplierName: EBAY_7696_SECOND_KNOWN_SUPPLIER_NAME,
    supplierUrl: nextSupplierUrl,
  });
  await recordInventoryChange({
    inventoryId: target.zaicoId ?? target.id,
    title: target.title,
    changeType: "updated",
    source: "ui",
    note: "ebay_7696_2 の仕入先をスクリーンショットの内容に補正",
    quantityBefore: target.quantity,
    quantityAfter: target.quantity,
  });
  await setSystemSetting(EBAY_7696_SECOND_KNOWN_CONTENT_SETTING_KEY, "1");
}

async function repairEbay7696SecondOrderSync(): Promise<void> {
  const alreadyApplied = await getSystemSetting(EBAY_7696_SECOND_ORDER_SYNC_SETTING_KEY);
  if (alreadyApplied === "1") return;

  const inventories = await getLocalInventories(true);
  const target = inventories.find(
    (inventory) => getInventoryManagementNo(inventory.etc) === EBAY_7696_SECOND_MANAGEMENT_NO,
  );
  if (!target) {
    await setSystemSetting(EBAY_7696_SECOND_ORDER_SYNC_SETTING_KEY, "1");
    return;
  }

  const supplierName = String(target.supplierName ?? "").trim() || EBAY_7696_SECOND_KNOWN_SUPPLIER_NAME;
  const supplierUrl = String(target.supplierUrl ?? "").trim() || null;
  const title = String(target.title ?? "").trim() || EBAY_7696_SECOND_MANAGEMENT_NO;
  await updateLocalInventory(target.id, {
    unitPrice: EBAY_7696_SECOND_CORRECTED_UNIT_PRICE,
    supplierName,
    supplierUrl,
    etc: target.etc ?? EBAY_7696_SECOND_MANAGEMENT_NO,
  });

  const purchases = await getLocalPurchases();
  const existing = purchases.find(
    (purchase) => getInventoryManagementNo(purchase.managementNo) === EBAY_7696_SECOND_MANAGEMENT_NO,
  );
  const maxNum = purchases.reduce((max, purchase) => {
    const n = parseInt(purchase.purchaseNum ?? "0", 10);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  const purchaseNum = existing?.purchaseNum ?? String(maxNum + 1);
  const quantity = 1;
  const status = existing?.status ?? "ordered";
  const purchaseData = {
    purchaseNum,
    status,
    itemsJson: JSON.stringify([{
      id: 0,
      inventory_id: target.id,
      inventoryId: target.id,
      title,
      quantity: String(quantity),
      unit_price: Number(EBAY_7696_SECOND_CORRECTED_UNIT_PRICE),
      unitPrice: Number(EBAY_7696_SECOND_CORRECTED_UNIT_PRICE),
      etc: EBAY_7696_SECOND_MANAGEMENT_NO,
      status,
      category: target.category ?? null,
    }]),
    localInventoryId: target.id,
    title,
    category: target.category ?? null,
    quantity,
    unitPrice: EBAY_7696_SECOND_CORRECTED_UNIT_PRICE,
    managementNo: EBAY_7696_SECOND_MANAGEMENT_NO,
    purchaseDate: existing?.purchaseDate ?? EBAY_7696_SECOND_KNOWN_PURCHASE_DATE,
    receivedDate: existing?.receivedDate ?? null,
    supplierUrl,
    supplierName,
  };

  const purchaseId = existing
    ? (await updateLocalPurchase(existing.id, purchaseData), existing.id)
    : await insertLocalPurchase({
        zaicoId: null,
        ...purchaseData,
        inboundClass: null,
        classSource: "auto",
        stage: "ordered",
        stageUpdatedBy: "system-repair",
        stageUpdatedAt: new Date(),
        shaftParentPurchaseId: null,
      });

  if (purchaseId > 0) {
    await ensureInventoryItemLabels({
      purchaseId,
      localInventoryId: target.id,
      legacyManagementNo: EBAY_7696_SECOND_MANAGEMENT_NO,
      title,
      quantity,
      status: status === "purchased" ? "received" : "ordered",
      sourceKey: `management:${EBAY_7696_SECOND_MANAGEMENT_NO}`,
    });
  }

  await setSystemSetting(EBAY_7696_SECOND_ORDER_SYNC_SETTING_KEY, "1");
}

async function repairMaxim404PartialCancelLabel(): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const { inventoryItemLabels: labelTbl } = await import("../../drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  const targetLabels = await db
    .select()
    .from(labelTbl)
    .where(inArray(labelTbl.labelId, [MAXIM_404_3DSLL_SECOND_KEEP_LABEL_ID, MAXIM_404_3DSLL_SECOND_REMOVE_LABEL_ID]));
  const keepLabel = targetLabels.find((label) =>
    String(label.labelId ?? "").trim().toUpperCase() === MAXIM_404_3DSLL_SECOND_KEEP_LABEL_ID
  );
  const removeLabel = targetLabels.find((label) =>
    String(label.labelId ?? "").trim().toUpperCase() === MAXIM_404_3DSLL_SECOND_REMOVE_LABEL_ID
  );

  if (removeLabel && !keepLabel) {
    await db
      .update(labelTbl)
      .set({
        labelId: MAXIM_404_3DSLL_SECOND_KEEP_LABEL_ID,
        legacyManagementNo: MAXIM_404_3DSLL_SECOND_MANAGEMENT_NO,
        title: removeLabel.title || "3DS LL ホワイト",
      })
      .where(eq(labelTbl.id, removeLabel.id));
    return;
  }

  if (removeLabel && keepLabel) {
    await db
      .update(labelTbl)
      .set({
        purchaseId: removeLabel.purchaseId ?? keepLabel.purchaseId,
        localInventoryId: removeLabel.localInventoryId ?? keepLabel.localInventoryId,
        legacyManagementNo: MAXIM_404_3DSLL_SECOND_MANAGEMENT_NO,
        title: removeLabel.title || keepLabel.title || "3DS LL ホワイト",
        status: removeLabel.status ?? keepLabel.status,
        receivedAt: removeLabel.receivedAt ?? keepLabel.receivedAt,
        shippedAt: removeLabel.shippedAt ?? keepLabel.shippedAt,
      })
      .where(eq(labelTbl.id, keepLabel.id));
    await db.delete(labelTbl).where(eq(labelTbl.id, removeLabel.id));
    return;
  }

  if (keepLabel && String(keepLabel.legacyManagementNo ?? "").trim() !== MAXIM_404_3DSLL_SECOND_MANAGEMENT_NO) {
    await db
      .update(labelTbl)
      .set({ legacyManagementNo: MAXIM_404_3DSLL_SECOND_MANAGEMENT_NO })
      .where(eq(labelTbl.id, keepLabel.id));
  }
}

async function softDeleteInventoriesHiddenByDeliveryHistory(): Promise<void> {
  const [localInvs, deletedFromHistoryIds] = await Promise.all([
    getLocalInventories(),
    getDeletedInventoryIdsFromDeliveryHistories(),
  ]);
  const hiddenInvs = localInvs.filter((inv) => {
    const displayId = inv.zaicoId ?? inv.id;
    return deletedFromHistoryIds.has(displayId) || deletedFromHistoryIds.has(inv.id) || (inv.zaicoId != null && deletedFromHistoryIds.has(inv.zaicoId));
  });
  await Promise.all(hiddenInvs.map((inv) =>
    deleteLocalInventory(inv.id).catch((error) => {
      console.warn("[inventory] Failed to soft-delete inventory hidden by delivery history", inv.id, error);
    }),
  ));
}

function runInventoryOneTimeRepairsOnce(): Promise<void> {
  if (!inventoryOneTimeRepairPromise) {
    inventoryOneTimeRepairPromise = (async () => {
      await repairEbay7696SecondInventoryOverwrite();
      await repairEbay7696SecondKnownContent();
      await repairEbay7696SecondOrderSync();
      await repairMaxim404PartialCancelLabel();
      await softDeleteInventoriesHiddenByDeliveryHistory();
    })().catch((error) => {
      console.warn("[inventory] Failed to run one-time repairs", error);
    });
  }
  return inventoryOneTimeRepairPromise;
}

setTimeout(() => {
  void runInventoryOneTimeRepairsOnce();
}, 0);

function isStockLabelView(label: InventoryItemLabelView): boolean {
  const status = String(label.status ?? "").trim().toLowerCase();
  return !status || status === "stocked" || status === "received";
}

function toInventoryItemLabelView(label: InventoryItemLabelView): InventoryItemLabelView {
  return {
    id: label.id,
    labelId: label.labelId,
    status: label.status,
    legacyManagementNo: label.legacyManagementNo,
    localInventoryId: label.localInventoryId,
  };
}

async function ensureStockLabelsForInventories<T extends {
  id: number;
  title: string;
  quantity?: string | number | null;
  etc?: string | null;
}>(inventories: T[]): Promise<Array<T & { itemLabels: InventoryItemLabelView[] }>> {
  if (inventories.length === 0) return [];
  const labelMap = await getInventoryItemLabelsByInventoryIds(inventories.map((inventory) => Number(inventory.id)));
  return Promise.all(inventories.map(async (inventory) => {
    const inventoryId = Number(inventory.id);
    const existingLabels = labelMap.get(inventoryId) ?? [];
    const quantity = inventoryStockQuantity(inventory.quantity);
    const labelQuantity = inventoryLabelQuantity(quantity);
    const labelStatus = inventoryInitialLabelStatus(quantity);
    const countableLabelCount = labelStatus === "ordered"
      ? existingLabels.length
      : existingLabels.filter(isStockLabelView).length;
    const expectedManagementNo = getInventoryManagementNo(inventory.etc);
    const hasStaleLabelData = existingLabels.some((label) =>
      String(label.legacyManagementNo ?? "").trim() !== expectedManagementNo ||
      String((label as { title?: string | null }).title ?? "").trim() !== String(inventory.title ?? "").trim()
    );
    const labels = labelQuantity > countableLabelCount || hasStaleLabelData
      ? await ensureInventoryItemLabelsForInventory({
          localInventoryId: inventoryId,
          legacyManagementNo: expectedManagementNo,
          title: inventory.title,
          quantity: labelQuantity,
          status: labelStatus,
          sourceKey: `inventory:${inventoryId}`,
        })
      : existingLabels;
    return {
      ...inventory,
      itemLabels: labels.map(toInventoryItemLabelView),
    };
  }));
}

function getInventoryEtcPart(etc: string | null | undefined, index: number) {
  return String(etc ?? "").split(",")[index]?.trim() ?? "";
}

function getPurchaseItemLabels(row: LocalPurchaseRow): InventoryItemLabelView[] {
  const labels = (row as { itemLabels?: InventoryItemLabelView[] }).itemLabels;
  return Array.isArray(labels) ? labels : [];
}

function uniqueInventoryItemLabelViews(labels: InventoryItemLabelView[]): InventoryItemLabelView[] {
  const map = new Map<string, InventoryItemLabelView>();
  for (const label of labels) {
    const key = label.labelId?.trim().toUpperCase();
    if (!key) continue;
    const existing = map.get(key);
    if (existing?.localInventoryId && !label.localInventoryId) continue;
    map.set(key, toInventoryItemLabelView(label));
  }
  return Array.from(map.values());
}

function getPurchaseItemManagementNo(row: LocalPurchaseRow, item: Record<string, unknown>): string {
  const direct = item.managementNo ?? item.management_no ?? item.legacyManagementNo;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const etc = String(item.etc ?? row.managementNo ?? "").trim();
  return etc.split(",")[0]?.trim() ?? "";
}

function filterLabelsByManagementNo<T extends { legacyManagementNo?: string | null }>(
  labels: T[],
  managementNo: string,
): T[] {
  const normalized = managementNo.trim();
  if (!normalized) return labels;
  return labels.filter((label) => {
    const labelManagementNo = String(label.legacyManagementNo ?? "").trim();
    return !labelManagementNo || labelManagementNo === normalized;
  });
}

function labelsForPurchaseItem(
  row: LocalPurchaseRow,
  item: Record<string, unknown>,
  inventoryLabelMap?: Map<number, InventoryItemLabelView[]>,
): InventoryItemLabelView[] {
  const labels = getPurchaseItemLabels(row);
  const rawInventoryId = item.inventory_id ?? item.inventoryId ?? row.localInventoryId;
  const inventoryId = Number(rawInventoryId);
  const managementNo = getPurchaseItemManagementNo(row, item);
  const inventoryLabels = Number.isFinite(inventoryId)
    ? filterLabelsByManagementNo(inventoryLabelMap?.get(inventoryId) ?? [], managementNo)
    : [];
  const scopedLabels = filterLabelsByManagementNo(labels, managementNo);
  if (scopedLabels.length === 0) return uniqueInventoryItemLabelViews(inventoryLabels);
  if (Number.isFinite(inventoryId)) {
    const labelsByInventory = scopedLabels.filter((label) => Number(label.localInventoryId) === inventoryId);
    if (labelsByInventory.length > 0) return uniqueInventoryItemLabelViews([...labelsByInventory, ...inventoryLabels]);
  }
  return uniqueInventoryItemLabelViews([...scopedLabels, ...inventoryLabels]);
}

function isReceivedLabelStatus(status: unknown): boolean {
  return ["received", "stocked", "shipped"].includes(String(status ?? "").trim().toLowerCase());
}

function localPurchaseItems(row: LocalPurchaseRow): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(row.itemsJson ?? "[]");
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Record<string, unknown>[];
  } catch {
    // Malformed legacy JSON falls back to the purchase row fields below.
  }
  return [{
    inventory_id: row.localInventoryId,
    inventoryId: row.localInventoryId,
    etc: row.managementNo,
    quantity: row.quantity,
  }];
}

function localPurchaseLabelViews(
  row: LocalPurchaseRow,
  inventoryLabelMap?: Map<number, InventoryItemLabelView[]>,
): InventoryItemLabelView[] {
  return uniqueInventoryItemLabelViews(
    localPurchaseItems(row).flatMap((item) => labelsForPurchaseItem(row, item, inventoryLabelMap)),
  );
}

async function reconcileLocalPurchaseLabelQuantities(rows: LocalPurchaseRow[]): Promise<LocalPurchaseRow[]> {
  let changed = false;

  for (const row of rows) {
    for (const item of localPurchaseItems(row)) {
      const desiredQuantity = Math.max(1, Math.floor(Number(item.quantity ?? row.quantity ?? 1)) || 1);
      const labels = labelsForPurchaseItem(row, item);
      if (labels.length <= desiredQuantity) continue;

      const rawInventoryId = Number(item.inventory_id ?? item.inventoryId ?? row.localInventoryId);
      const localInventoryId = Number.isFinite(rawInventoryId) && rawInventoryId > 0 ? rawInventoryId : null;
      const managementNo = getPurchaseItemManagementNo(row, item) || row.managementNo || null;
      const title = String(item.title ?? row.title ?? "").trim();

      await ensureInventoryItemLabels({
        purchaseId: row.id,
        localInventoryId,
        legacyManagementNo: managementNo,
        title: title || row.title || managementNo || "商品",
        quantity: desiredQuantity,
        status: row.status === "purchased" ? "received" : "ordered",
        sourceKey: managementNo ? `management:${managementNo}` : null,
      });
      changed = true;
    }
  }

  return changed ? getLocalPurchases() : rows;
}

function isLocalPurchaseReceivedFromLabels(
  row: LocalPurchaseRow,
  inventoryLabelMap?: Map<number, InventoryItemLabelView[]>,
): boolean {
  if (row.status === "purchased") return true;
  const labels = localPurchaseLabelViews(row, inventoryLabelMap);
  if (labels.length === 0) return false;
  const requiredQuantity = Math.max(1, Math.floor(Number(row.quantity ?? 1)) || 1);
  const receivedCount = labels.filter((label) => isReceivedLabelStatus(label.status)).length;
  return receivedCount >= Math.min(requiredQuantity, labels.length);
}

function getLocalPurchaseDisplayStatus(
  row: LocalPurchaseRow,
  inventoryLabelMap?: Map<number, InventoryItemLabelView[]>,
  purchasedZaicoIds?: Set<number>,
): string {
  if (row.status !== "purchased" && (String(row.trackingNumber ?? "").trim() || row.status === "shipped")) {
    return "shipped";
  }
  if (shouldKeepRecoveredPurchaseOrdered(row)) return "ordered";
  const localId = row.zaicoId ?? row.id;
  if (
    row.status === "purchased" ||
    (purchasedZaicoIds?.has(localId) ?? false) ||
    isLocalPurchaseReceivedFromLabels(row, inventoryLabelMap)
  ) {
    return "purchased";
  }
  return row.status || "ordered";
}

function localPurchaseMatchesInventoryLabel(
  row: LocalPurchaseRow,
  localInventoryId: number | null,
  managementNo: string,
): boolean {
  const inventoryId = Number(localInventoryId);
  if (!Number.isFinite(inventoryId)) return false;
  return localPurchaseItems(row).some((item) => {
    const itemInventoryId = Number(item.inventory_id ?? item.inventoryId ?? row.localInventoryId);
    if (!Number.isFinite(itemInventoryId) || itemInventoryId !== inventoryId) return false;
    const itemManagementNo = getPurchaseItemManagementNo(row, item);
    return !managementNo || !itemManagementNo || itemManagementNo === managementNo;
  });
}

function localPurchaseMatchesInventoryForLinkedDelete(
  row: LocalPurchaseRow,
  localInventoryId: number | null,
  managementNo: string,
): boolean {
  const normalizedManagementNo = managementNo.trim();
  const inventoryId = Number(localInventoryId);
  const rowManagementNo = String(row.managementNo ?? "").trim();
  const items = localPurchaseItems(row);

  if (!normalizedManagementNo) {
    return localPurchaseMatchesInventoryLabel(row, localInventoryId, "");
  }

  if (rowManagementNo === normalizedManagementNo) return true;
  if (rowManagementNo && rowManagementNo !== normalizedManagementNo) return false;

  let hasInventoryMatch = Number.isFinite(inventoryId) && Number(row.localInventoryId) === inventoryId;
  for (const item of items) {
    const itemManagementNo = getPurchaseItemManagementNo(row, item);
    if (itemManagementNo === normalizedManagementNo) return true;
    if (itemManagementNo && itemManagementNo !== normalizedManagementNo) return false;

    const itemInventoryId = Number(item.inventory_id ?? item.inventoryId ?? row.localInventoryId);
    if (Number.isFinite(inventoryId) && itemInventoryId === inventoryId) {
      hasInventoryMatch = true;
    }
  }

  return hasInventoryMatch;
}

const RECOVERABLE_ORPHAN_LABEL_MANAGEMENT_NOS = new Set([
  "402_マキシム_1/2",
  "402_マキシム_2/2",
  "在庫0807_1&2&3",
  "在庫0807_4",
  "在庫0807_5&6",
  "在庫0807_7",
]);

function canRecoverOrphanLabelPurchase(managementNo: string): boolean {
  return RECOVERABLE_ORPHAN_LABEL_MANAGEMENT_NOS.has(managementNo.trim());
}

const ORDERED_RECOVERED_PURCHASE_MANAGEMENT_NOS = new Set([
  "402_マキシム_2/2",
]);

const MAXIM_SECOND_LABEL_ID = "NRFZKRM";

function shouldKeepRecoveredPurchaseOrdered(row: LocalPurchaseRow): boolean {
  const rowManagementNo = String(row.managementNo ?? "").trim();
  if (ORDERED_RECOVERED_PURCHASE_MANAGEMENT_NOS.has(rowManagementNo)) return true;
  return localPurchaseItems(row).some((item) =>
    ORDERED_RECOVERED_PURCHASE_MANAGEMENT_NOS.has(getPurchaseItemManagementNo(row, item)),
  );
}

function getRecoveredPurchaseOverrides(managementNo: string) {
  if (managementNo === "402_マキシム_1/2") {
    return {
      purchaseNum: "1641259420",
      title: "PSP 3000 ミスティック・シルバー",
      category: "PSP",
      unitPrice: "13720",
      purchaseDate: "2026-08-06",
      trackingNumber: "490731074886",
      carrier: "yamato",
      supplierName: "駿河屋 岐阜マーサ21店",
    };
  }
  if (managementNo === "402_マキシム_2/2") {
    return {
      purchaseNum: "1794101757",
      title: "PSP 3000 ミスティック・シルバー",
      category: "PSP",
      unitPrice: "14426",
      purchaseDate: "2026-08-07",
      supplierName: "駿河屋 豊橋二ノ輪店",
      status: "ordered",
      stage: "ordered",
      labelStatus: "ordered" as InventoryItemLabelStatus,
      receivedDate: null,
      quantity: 1,
    };
  }
  return {};
}

async function cleanupUnexpectedRepairedLocalPurchases(
  localPurchaseRows: LocalPurchaseRow[],
): Promise<LocalPurchaseRow[]> {
  const unexpectedRows = localPurchaseRows.filter((purchase) => {
    if (purchase.stageUpdatedBy !== "system-repair") return false;
    const managementNo = String(purchase.managementNo ?? "").trim();
    return !canRecoverOrphanLabelPurchase(managementNo);
  });
  if (unexpectedRows.length === 0) return localPurchaseRows;

  const unexpectedIds = unexpectedRows.map((purchase) => purchase.id).filter((id) => Number.isFinite(id));
  const unexpectedIdSet = new Set(unexpectedIds);
  const db = await getDb();
  if (db && unexpectedIds.length > 0) {
    const { inventoryItemLabels: labelTbl, localPurchases: purchaseTbl } = await import("../../drizzle/schema");
    const { inArray } = await import("drizzle-orm");
    await db
      .update(labelTbl)
      .set({ purchaseId: null, status: "stocked" })
      .where(and(inArray(labelTbl.purchaseId, unexpectedIds), eq(labelTbl.status, "ordered")));
    await db
      .update(labelTbl)
      .set({ purchaseId: null })
      .where(inArray(labelTbl.purchaseId, unexpectedIds));
    await db.delete(purchaseTbl).where(inArray(purchaseTbl.id, unexpectedIds));
  }

  return localPurchaseRows.filter((purchase) => !unexpectedIdSet.has(purchase.id));
}

async function cleanupAllowedRecoveredPurchaseIssues(
  localPurchaseRows: LocalPurchaseRow[],
): Promise<LocalPurchaseRow[]> {
  const db = await getDb();
  if (!db) return localPurchaseRows;

  const { inventoryItemLabels: labelTbl, localPurchases: purchaseTbl } = await import("../../drizzle/schema");
  const { inArray } = await import("drizzle-orm");
  let changed = false;
  let nextRows = localPurchaseRows;

  const duplicateRows = nextRows
    .filter((purchase) => String(purchase.managementNo ?? "").trim() === "402_マキシム_1/2")
    .sort((a, b) => a.id - b.id);
  const keepDuplicateRow = duplicateRows[0];
  const duplicateDeleteIds = duplicateRows.slice(1).map((purchase) => purchase.id);
  if (keepDuplicateRow && duplicateDeleteIds.length > 0) {
    await db
      .update(labelTbl)
      .set({ purchaseId: keepDuplicateRow.id })
      .where(inArray(labelTbl.purchaseId, duplicateDeleteIds));
    await db.delete(purchaseTbl).where(inArray(purchaseTbl.id, duplicateDeleteIds));
    const deleteIdSet = new Set(duplicateDeleteIds);
    nextRows = nextRows.filter((purchase) => !deleteIdSet.has(purchase.id));
    changed = true;
  }

  const maximSecondRows = nextRows
    .filter((purchase) => String(purchase.managementNo ?? "").trim() === "402_マキシム_2/2")
    .sort((a, b) => a.id - b.id);
  const maximSecondRow = maximSecondRows[0] ?? null;
  const maximSecondOverrides = getRecoveredPurchaseOverrides("402_マキシム_2/2");
  if (maximSecondRow) {
    const title = maximSecondOverrides.title ?? maximSecondRow.title ?? "";
    const category = maximSecondOverrides.category ?? maximSecondRow.category ?? null;
    const quantity = Math.max(1, Number(maximSecondOverrides.quantity ?? maximSecondRow.quantity ?? 1) || 1);
    const unitPrice = maximSecondOverrides.unitPrice ?? maximSecondRow.unitPrice ?? null;
    const existingTrackingNumber = normalizePurchaseTrackingValue(maximSecondRow.trackingNumber);
    const existingShipDate = normalizePurchaseTrackingValue(maximSecondRow.shipDate);
    const existingCarrier = normalizePurchaseTrackingValue(maximSecondRow.carrier);
    const existingNote = normalizePurchaseTrackingValue(maximSecondRow.note);
    const hasInboundTracking = existingTrackingNumber != null;
    const repairedStatus = hasInboundTracking ? "shipped" : "ordered";
    const repairedStage = hasInboundTracking ? "shipped" : maximSecondOverrides.stage ?? "ordered";
    const itemsJson = JSON.stringify([{
      id: 1,
      inventory_id: maximSecondRow.localInventoryId,
      inventoryId: maximSecondRow.localInventoryId,
      title,
      quantity: String(quantity),
      unit_price: unitPrice,
      unitPrice,
      etc: "402_マキシム_2/2",
      category,
      status: repairedStatus,
    }]);
    await db
      .update(purchaseTbl)
      .set({
        purchaseNum: maximSecondOverrides.purchaseNum ?? maximSecondRow.purchaseNum,
        status: repairedStatus,
        itemsJson,
        title,
        category,
        quantity,
        unitPrice,
        managementNo: "402_マキシム_2/2",
        purchaseDate: maximSecondOverrides.purchaseDate ?? maximSecondRow.purchaseDate,
        receivedDate: null,
        shipDate: existingShipDate,
        trackingNumber: existingTrackingNumber,
        carrier: existingCarrier,
        note: existingNote,
        supplierName: maximSecondOverrides.supplierName ?? maximSecondRow.supplierName,
        stage: repairedStage,
        stageUpdatedBy: hasInboundTracking ? maximSecondRow.stageUpdatedBy ?? "tracking-registration" : "system-repair",
        stageUpdatedAt: hasInboundTracking ? maximSecondRow.stageUpdatedAt ?? new Date() : new Date(),
      })
      .where(eq(purchaseTbl.id, maximSecondRow.id));
    changed = true;
  }
  const maximSecondLabels = await db
    .select()
    .from(labelTbl)
    .where(eq(labelTbl.legacyManagementNo, "402_マキシム_2/2"));
  const sortedMaximSecondLabels = [...maximSecondLabels].sort((a, b) => {
    const aIsTargetLabel = String(a.labelId ?? "").trim().toUpperCase() === MAXIM_SECOND_LABEL_ID;
    const bIsTargetLabel = String(b.labelId ?? "").trim().toUpperCase() === MAXIM_SECOND_LABEL_ID;
    if (aIsTargetLabel !== bIsTargetLabel) return aIsTargetLabel ? -1 : 1;
    const timeA = new Date(a.createdAt ?? 0).getTime();
    const timeB = new Date(b.createdAt ?? 0).getTime();
    if (timeA !== timeB) return timeB - timeA;
    return Number(b.id) - Number(a.id);
  });
  const keepLabel = sortedMaximSecondLabels[0];
  const deleteLabelIds = sortedMaximSecondLabels.slice(1).map((label) => Number(label.id)).filter((id) => Number.isFinite(id));
  if (deleteLabelIds.length > 0) {
    await db.delete(labelTbl).where(inArray(labelTbl.id, deleteLabelIds));
    changed = true;
  }
  if (maximSecondRow && keepLabel) {
    const targetLocalInventoryId = maximSecondRow.localInventoryId ?? keepLabel.localInventoryId;
    const keepLabelNeedsUpdate =
      Number(keepLabel.purchaseId) !== maximSecondRow.id ||
      String(keepLabel.status ?? "").trim().toLowerCase() !== "ordered" ||
      (targetLocalInventoryId != null && Number(keepLabel.localInventoryId) !== Number(targetLocalInventoryId));
    if (keepLabelNeedsUpdate) {
      await db
        .update(labelTbl)
        .set({
          purchaseId: maximSecondRow.id,
          localInventoryId: targetLocalInventoryId,
          status: "ordered",
        })
        .where(eq(labelTbl.id, keepLabel.id));
      changed = true;
    }
  } else if (keepLabel && String(keepLabel.status ?? "").trim().toLowerCase() !== "ordered") {
    await db
      .update(labelTbl)
      .set({ status: "ordered" })
      .where(eq(labelTbl.id, keepLabel.id));
    changed = true;
  }

  return changed ? getLocalPurchases() : nextRows;
}

function localPurchaseStatusFromLabelStatus(status: unknown): string {
  const normalized = String(status ?? "").trim().toLowerCase();
  return ["received", "stocked", "shipped"].includes(normalized) ? "purchased" : "ordered";
}

async function restoreMissingLocalPurchasesFromOrphanLabels(
  localPurchaseRows: LocalPurchaseRow[],
): Promise<LocalPurchaseRow[]> {
  const db = await getDb();
  if (!db) return localPurchaseRows;
  localPurchaseRows = await cleanupUnexpectedRepairedLocalPurchases(localPurchaseRows);
  localPurchaseRows = await cleanupAllowedRecoveredPurchaseIssues(localPurchaseRows);

  const existingIds = new Set(localPurchaseRows.map((purchase) => purchase.id));
  const existingManagementNos = new Set<string>();
  for (const purchase of localPurchaseRows) {
    const rowManagementNo = String(purchase.managementNo ?? "").trim();
    if (rowManagementNo) existingManagementNos.add(rowManagementNo);
    for (const item of localPurchaseItems(purchase)) {
      const itemManagementNo = getPurchaseItemManagementNo(purchase, item);
      if (itemManagementNo) existingManagementNos.add(itemManagementNo);
    }
  }

  const inventories = await getLocalInventories(true);
  const candidates = new Map<string, {
    inventory: LocalInventoryRow;
    labels: LocalInventoryItemLabelRow[];
  }>();

  for (const inventory of inventories) {
    if (Number(inventory.isDeleted ?? 0) !== 0) continue;
    for (const label of inventory.itemLabels ?? []) {
      const labelPurchaseId = Number(label.purchaseId);
      const managementNo = String(label.legacyManagementNo ?? getInventoryManagementNo(inventory.etc)).trim();
      const canRecover = canRecoverOrphanLabelPurchase(managementNo);
      if (!canRecover && (!Number.isFinite(labelPurchaseId) || labelPurchaseId <= 0)) continue;
      if (Number.isFinite(labelPurchaseId) && labelPurchaseId > 0 && existingIds.has(labelPurchaseId)) continue;
      if (!managementNo || existingManagementNos.has(managementNo)) continue;
      const current = candidates.get(managementNo);
      if (current) {
        current.labels.push(label);
      } else {
        candidates.set(managementNo, { inventory, labels: [label] });
      }
    }
  }

  let repaired = false;
  for (const [managementNo, candidate] of candidates) {
    const { inventory, labels } = candidate;
    const firstLabel = labels[0];
    if (!firstLabel) continue;
    const overrides = getRecoveredPurchaseOverrides(managementNo);
    if (!canRecoverOrphanLabelPurchase(managementNo)) continue;
    const quantity = Math.max(1, Number(overrides.quantity ?? labels.length) || 1);
    const title = overrides.title ?? firstLabel.title ?? inventory.title;
    const category = overrides.category ?? inventory.category ?? null;
    const unitPrice = overrides.unitPrice ?? (inventory.unitPrice == null ? null : String(inventory.unitPrice));
    const purchaseDate = overrides.purchaseDate ?? historyDateFrom(firstLabel.createdAt ?? inventory.createdAt);
    const status = String(overrides.status ?? localPurchaseStatusFromLabelStatus(firstLabel.status));
    const receivedDate = "receivedDate" in overrides
      ? overrides.receivedDate ?? null
      : status === "purchased"
        ? historyDateFrom(firstLabel.receivedAt ?? inventory.updatedAt)
        : null;
    const newPurchaseId = await insertLocalPurchase({
      zaicoId: null,
      purchaseNum: overrides.purchaseNum ?? managementNo,
      status,
      itemsJson: JSON.stringify([{
        id: 1,
        inventory_id: inventory.id,
        inventoryId: inventory.id,
        title,
        quantity: String(quantity),
        unit_price: unitPrice,
        unitPrice,
        etc: managementNo,
        category,
      }]),
      localInventoryId: inventory.id,
      title,
      category,
      quantity,
      unitPrice,
      managementNo,
      purchaseDate,
      receivedDate,
      shipDate: null,
      trackingNumber: overrides.trackingNumber ?? null,
      carrier: overrides.carrier ?? null,
      note: null,
      supplierUrl: inventory.supplierUrl ?? null,
      supplierName: overrides.supplierName ?? inventory.supplierName ?? null,
      inboundClass: null,
      classSource: "auto",
      stage: overrides.stage ?? (status === "purchased" ? "received" : "ordered"),
      stageUpdatedBy: "system-repair",
      stageUpdatedAt: new Date(),
      shaftParentPurchaseId: null,
    });
    if (newPurchaseId > 0) {
      await ensureInventoryItemLabels({
        purchaseId: newPurchaseId,
        localInventoryId: inventory.id,
        legacyManagementNo: managementNo,
        title,
        quantity,
        status: (overrides.labelStatus ?? String(firstLabel.status ?? "ordered")) as InventoryItemLabelStatus,
        sourceKey: `repair:${managementNo}`,
      });
      existingManagementNos.add(managementNo);
      repaired = true;
    }
  }

  return cleanupAllowedRecoveredPurchaseIssues(repaired ? await getLocalPurchases() : localPurchaseRows);
}

async function ensureShaftPurchases(
  localPurchaseRows: LocalPurchaseRow[],
  localInventoryRows: LocalInventoryRow[],
): Promise<LocalPurchaseRow[]> {
  const existingManagementNos = new Set<string>();
  for (const purchase of localPurchaseRows) {
    const purchaseManagementNo = String(purchase.managementNo ?? "").trim();
    if (purchaseManagementNo) existingManagementNos.add(purchaseManagementNo);
    try {
      const items = JSON.parse(purchase.itemsJson ?? "[]");
      if (Array.isArray(items)) {
        for (const item of items) {
          const itemManagementNo = String(item?.etc ?? "").split(",")[0]?.trim() ?? "";
          if (itemManagementNo) existingManagementNos.add(itemManagementNo);
        }
      }
    } catch {
      // ignore malformed legacy JSON
    }
  }

  const missingShaftInventories = localInventoryRows.filter((inventory) => {
    if (inventory.isDeleted) return false;
    if (getEbayStockType(inventory.etc) !== "shaft") return false;
    const managementNo = getInventoryManagementNo(inventory.etc);
    return managementNo && !existingManagementNos.has(managementNo);
  });

  if (missingShaftInventories.length === 0) return localPurchaseRows;

  let repaired = false;
  for (const inventory of missingShaftInventories) {
    const managementNo = getInventoryManagementNo(inventory.etc);
    if (!managementNo) continue;
    const quantity = Math.max(1, Number(inventory.quantity ?? 1) || 1);
    try {
      await upsertLocalPurchase({
        zaicoId: null,
        purchaseNum: managementNo,
        status: "ordered",
        itemsJson: JSON.stringify([{
          id: 0,
          inventory_id: inventory.id,
          title: inventory.title,
          quantity: String(quantity),
          unit_price: inventory.unitPrice ?? null,
          etc: managementNo,
          status: "ordered",
          category: inventory.category ?? null,
        }]),
        localInventoryId: inventory.id,
        title: inventory.title,
        category: inventory.category ?? null,
        quantity,
        unitPrice: inventory.unitPrice ?? null,
        managementNo,
        purchaseDate: getInventoryEtcPart(inventory.etc, 1) || null,
        receivedDate: null,
        supplierUrl: inventory.supplierUrl ?? null,
        supplierName: inventory.supplierName ?? null,
      });
      repaired = true;
    } catch (error) {
      console.warn("[inventory] failed to backfill shaft purchase", {
        inventoryId: inventory.id,
        managementNo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return repaired ? getLocalPurchases() : localPurchaseRows;
}

// ============================================================
// T22: 入庫仕訳のenrich（読み取り時の自動判定＋バックフィル）
// ============================================================

type InboundInfo = {
  inboundClass: InboundClass | null;
  classSource: "auto" | "manual";
  stage: string;
  stageUpdatedBy: string | null;
  shaftParentPurchaseId: number | null;
};

/** システム設定から直取の相手名リストを取得（未設定なら初期値: サミー, ルカ, サイモン, マキシム, ネレ） */
async function getDirectPartnerNames(): Promise<string[]> {
  try {
    const raw = await getSystemSetting(DIRECT_PARTNER_NAMES_SETTING_KEY);
    if (!raw) return [...DEFAULT_DIRECT_PARTNER_NAMES];
    const names = raw
      .split(/[,、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length === 0) return [...DEFAULT_DIRECT_PARTNER_NAMES];
    return Array.from(new Set([...DEFAULT_DIRECT_PARTNER_NAMES, ...names]));
  } catch {
    return [...DEFAULT_DIRECT_PARTNER_NAMES];
  }
}

/**
 * local_purchases 行の集合に対し、分類（inboundClass）を解決してマップで返す。
 * - classSource=manual の行は保存値を尊重（自動再判定しない＝人間の判断を守る）
 * - それ以外は classifyInbound() で判定し、保存値と異なれば DB を更新（オンリードのバックフィル）
 * 併せて stage / stageUpdatedBy / shaftParentPurchaseId も返す。
 * 読み取り経路（Zaico OFF）専用。DBが無ければ保存値のみで組み立てる。
 */
async function resolveInboundInfoMap(
  localPurchaseRows: LocalPurchaseRow[],
  localInventoryRows: LocalInventoryRow[],
): Promise<Map<number, InboundInfo>> {
  const map = new Map<number, InboundInfo>();
  if (localPurchaseRows.length === 0) return map;

  const invById = new Map<number, LocalInventoryRow>();
  for (const inv of localInventoryRows) invById.set(inv.id, inv);

  const [partnerNames, invoiceNumberSet] = await Promise.all([
    getDirectPartnerNames(),
    getPublishedInvoiceNumberSet().catch(() => new Set<number>()),
  ]);

  for (const p of localPurchaseRows) {
    const storedClass = (p.inboundClass ?? null) as InboundClass | null;
    const storedSource = (p.classSource === "manual" ? "manual" : "auto") as "auto" | "manual";
    const stage = p.stage ?? "received";
    const stageUpdatedBy = p.stageUpdatedBy ?? null;
    const shaftParentPurchaseId = p.shaftParentPurchaseId ?? null;

    // manual は保存値をそのまま採用（domestic のシャフト分離行も manual 固定なので保護される）
    if (storedSource === "manual") {
      map.set(p.id, { inboundClass: storedClass, classSource: "manual", stage, stageUpdatedBy, shaftParentPurchaseId });
      continue;
    }

    // auto: 判定材料を集めて再分類
    const inv = p.localInventoryId != null ? invById.get(p.localInventoryId) : undefined;
    const managementNo = p.managementNo ?? getInventoryManagementNo(inv?.etc);
    const place = inv?.place ?? null;
    const ebayOrderUrl = inv?.ebayOrderUrl ?? null;
    const invoicePrefix = extractInvoicePrefix(managementNo);
    const hasLinkedInvoice = invoicePrefix != null && invoiceNumberSet.has(Number(invoicePrefix));

    const computed = classifyInbound({
      managementNo,
      place,
      ebayOrderUrl,
      directPartnerNames: partnerNames,
      hasLinkedInvoice,
    });

    // 保存値と異なればバックフィル（auto のまま更新）。DBが無い場合はスキップ。
    if (computed !== storedClass) {
      try {
        await setLocalPurchaseInboundClass(p.id, computed, "auto");
      } catch {
        // DB未接続やダンプ経路では保存できないが、表示は computed を使う
      }
    }

    map.set(p.id, { inboundClass: computed, classSource: "auto", stage, stageUpdatedBy, shaftParentPurchaseId });
  }

  return map;
}

function getEffectivePurchaseStatus(row: PurchasePageRow) {
  if (row.status !== "purchased" && row.extra?.trackingNumber) return "shipped";
  return row.status;
}

const PURCHASE_PAGE_INBOUND_CUTOFF_DATE = "2026-06-20";

function normalizePurchasePageDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null;
}

function isPurchasePageInboundCutoffVisible(row: PurchasePageRow): boolean {
  const filterDate =
    normalizePurchasePageDate(row.purchaseDate) ??
    normalizePurchasePageDate(row.purchase_date) ??
    normalizePurchasePageDate(row.created_at) ??
    normalizePurchasePageDate(row.createdAt);
  return filterDate == null || filterDate >= PURCHASE_PAGE_INBOUND_CUTOFF_DATE;
}

type PurchaseExtraView = {
  zaicoId: number;
  shipDate?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  note?: string | null;
};

function getLocalPurchaseStoredExtra(
  row: Pick<LocalPurchaseRow, "id" | "zaicoId" | "localInventoryId">,
  extrasByZaicoId: Map<number, PurchaseExtraView>,
): PurchaseExtraView | null {
  return (
    extrasByZaicoId.get(row.id) ??
    (row.zaicoId ? extrasByZaicoId.get(row.zaicoId) : undefined) ??
    (row.localInventoryId ? extrasByZaicoId.get(row.localInventoryId) : undefined) ??
    null
  );
}

function mergeLocalPurchaseStoredExtra<T extends LocalPurchaseRow>(
  row: T,
  extra: PurchaseExtraView | null | undefined,
): T {
  if (!extra) return row;
  return {
    ...row,
    shipDate: String(row.shipDate ?? "").trim() ? row.shipDate : extra.shipDate ?? null,
    trackingNumber: String(row.trackingNumber ?? "").trim() ? row.trackingNumber : extra.trackingNumber ?? null,
    carrier: String(row.carrier ?? "").trim() ? row.carrier : extra.carrier ?? null,
    note: String(row.note ?? "").trim() ? row.note : extra.note ?? null,
  };
}

type PurchaseTrackingSyncInput = {
  zaicoId: number;
  shipDate?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  note?: string | null;
  inventoryId?: number | null;
  managementNo?: string | null;
  labelId?: string | null;
  operatorName?: string | null;
  createdBy?: string | null;
};

type PurchaseTrackingAuditState = {
  shipDate: string | null;
  trackingNumber: string | null;
  carrier: string | null;
  note: string | null;
  status: string | null;
  stage: string | null;
};

type PurchaseTrackingAuditUpdate = Partial<
  Pick<InsertLocalPurchase, "shipDate" | "trackingNumber" | "carrier" | "note" | "status" | "stage">
>;

function hasOwnPurchaseTrackingField(input: PurchaseTrackingSyncInput, key: keyof PurchaseTrackingSyncInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function normalizePurchaseTrackingValue(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function buildPurchaseTrackingUpdate(input: PurchaseTrackingSyncInput) {
  const update: {
    shipDate?: string | null;
    trackingNumber?: string | null;
    carrier?: string | null;
    note?: string | null;
  } = {};
  if (hasOwnPurchaseTrackingField(input, "shipDate")) {
    update.shipDate = normalizePurchaseTrackingValue(input.shipDate);
  }
  if (hasOwnPurchaseTrackingField(input, "trackingNumber")) {
    update.trackingNumber = normalizePurchaseTrackingValue(input.trackingNumber);
    update.carrier = hasOwnPurchaseTrackingField(input, "carrier")
      ? normalizePurchaseTrackingValue(input.carrier)
      : null;
  } else if (hasOwnPurchaseTrackingField(input, "carrier")) {
    update.carrier = normalizePurchaseTrackingValue(input.carrier);
  }
  if (hasOwnPurchaseTrackingField(input, "note")) {
    update.note = normalizePurchaseTrackingValue(input.note);
  }
  return update;
}

function purchaseTrackingAuditValue(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text ? text : null;
}

function getPurchaseTrackingAuditState(row: LocalPurchaseRow): PurchaseTrackingAuditState {
  return {
    shipDate: purchaseTrackingAuditValue(row.shipDate),
    trackingNumber: purchaseTrackingAuditValue(row.trackingNumber),
    carrier: purchaseTrackingAuditValue(row.carrier),
    note: purchaseTrackingAuditValue(row.note),
    status: purchaseTrackingAuditValue(row.status),
    stage: purchaseTrackingAuditValue(row.stage),
  };
}

function getNextPurchaseTrackingAuditState(
  previous: PurchaseTrackingAuditState,
  update: PurchaseTrackingAuditUpdate,
): PurchaseTrackingAuditState {
  return {
    shipDate: Object.prototype.hasOwnProperty.call(update, "shipDate")
      ? purchaseTrackingAuditValue(update.shipDate)
      : previous.shipDate,
    trackingNumber: Object.prototype.hasOwnProperty.call(update, "trackingNumber")
      ? purchaseTrackingAuditValue(update.trackingNumber)
      : previous.trackingNumber,
    carrier: Object.prototype.hasOwnProperty.call(update, "carrier")
      ? purchaseTrackingAuditValue(update.carrier)
      : previous.carrier,
    note: Object.prototype.hasOwnProperty.call(update, "note")
      ? purchaseTrackingAuditValue(update.note)
      : previous.note,
    status: Object.prototype.hasOwnProperty.call(update, "status")
      ? purchaseTrackingAuditValue(update.status)
      : previous.status,
    stage: Object.prototype.hasOwnProperty.call(update, "stage")
      ? purchaseTrackingAuditValue(update.stage)
      : previous.stage,
  };
}

function getPurchaseTrackingChangedFields(
  previous: PurchaseTrackingAuditState,
  next: PurchaseTrackingAuditState,
): Array<keyof PurchaseTrackingAuditState> {
  const keys: Array<keyof PurchaseTrackingAuditState> = [
    "shipDate",
    "trackingNumber",
    "carrier",
    "note",
    "status",
    "stage",
  ];
  return keys.filter((key) => (previous[key] ?? null) !== (next[key] ?? null));
}

function getPurchaseTrackingAuditLabelIds(row: LocalPurchaseRow, input: PurchaseTrackingSyncInput): string[] {
  const labels = new Set<string>();
  const addLabel = (value: unknown) => {
    const label = String(value ?? "").trim().toUpperCase();
    if (label) labels.add(label);
  };

  addLabel(input.labelId);
  for (const label of row.itemLabels ?? []) {
    addLabel(label.labelId);
  }
  for (const item of parseLocalPurchaseItems(row)) {
    const itemLabels = (item as { itemLabels?: Array<{ labelId?: unknown }> }).itemLabels;
    for (const label of itemLabels ?? []) {
      addLabel(label.labelId);
    }
  }

  return Array.from(labels);
}

async function recordPurchaseTrackingAuditLog(
  input: PurchaseTrackingSyncInput,
  purchase: LocalPurchaseRow,
  previous: PurchaseTrackingAuditState,
  next: PurchaseTrackingAuditState,
  changedFields: Array<keyof PurchaseTrackingAuditState>,
) {
  if (changedFields.length === 0) return;

  const labelIds = getPurchaseTrackingAuditLabelIds(purchase, input);
  const managementNo =
    localPurchasePrimaryManagementNo(purchase) ||
    String(input.managementNo ?? purchase.managementNo ?? "").trim() ||
    null;
  const workerName = resolveWorkOperatorName(input.operatorName, input.createdBy);
  const trackingBefore = previous.trackingNumber ?? "未設定";
  const trackingAfter = next.trackingNumber ?? "未設定";

  try {
    await recordWorkLog({
      workerName,
      category: "追跡番号登録",
      status: "done",
      startedAt: new Date(),
      endedAt: new Date(),
      quantity: 1,
      memo: [
        managementNo ? `管理番号: ${managementNo}` : null,
        `追跡番号: ${trackingBefore} -> ${trackingAfter}`,
        labelIds.length > 0 ? `商品ID: ${labelIds.join(", ")}` : null,
      ].filter(Boolean).join(" / "),
      createdBy: input.createdBy ?? workerName,
      sourceType: "purchase-tracking-audit",
      sourceId: `purchase:${purchase.id}`,
      detailsJson: JSON.stringify({
        version: 1,
        action: "purchase_tracking_update",
        target: {
          purchaseId: purchase.id,
          zaicoId: purchase.zaicoId ?? null,
          localInventoryId: purchase.localInventoryId ?? input.inventoryId ?? null,
          purchaseNum: purchase.purchaseNum ?? null,
          title: purchase.title ?? null,
          managementNo,
          labelIds,
        },
        input: {
          zaicoId: input.zaicoId,
          inventoryId: input.inventoryId ?? null,
          managementNo: input.managementNo ?? null,
          labelId: input.labelId ?? null,
        },
        before: previous,
        after: next,
        changedFields,
      }),
    });
  } catch (error) {
    console.warn("[purchaseTrackingAudit] failed to record work log", error);
  }
}

function requiresLocalPurchaseTrackingTarget(input: PurchaseTrackingSyncInput): boolean {
  if (!hasOwnPurchaseTrackingField(input, "trackingNumber")) return false;
  return normalizePurchaseTrackingValue(input.trackingNumber) != null;
}

function assertLocalPurchaseTrackingSynced(input: PurchaseTrackingSyncInput, updatedCount: number) {
  if (!requiresLocalPurchaseTrackingTarget(input) || updatedCount > 0) return;
  throw new TRPCError({
    code: "NOT_FOUND",
    message: "追跡番号を反映できる発注データが見つかりませんでした。ページを更新してから再度登録してください。",
  });
}

function localPurchaseMatchesTrackingTarget(row: LocalPurchaseRow, input: PurchaseTrackingSyncInput): boolean {
  if (row.id === input.zaicoId || row.zaicoId === input.zaicoId) return true;
  const labelId = String(input.labelId ?? "").trim().toUpperCase();
  if (labelId && (row.itemLabels ?? []).some((label) => String(label.labelId ?? "").trim().toUpperCase() === labelId)) {
    return true;
  }

  const inventoryId = positiveHistoryNumber(input.inventoryId);
  const managementNo = firstPurchaseHistoryEtcPart(input.managementNo);
  if (inventoryId != null && localPurchaseMatchesInventoryLabel(row, inventoryId, managementNo)) return true;
  if (!managementNo) return false;
  if (firstPurchaseHistoryEtcPart(row.managementNo) === managementNo) return true;
  return parseLocalPurchaseItems(row).some((item) => firstPurchaseHistoryEtcPart(item.etc) === managementNo);
}

async function syncLocalPurchaseTrackingFromExtra(input: PurchaseTrackingSyncInput) {
  const db = await getDb();
  if (!db) return { updatedCount: 0, targetIds: [] as number[] };
  const { localPurchases: lpTbl } = await import("../../drizzle/schema");
  const { eq } = await import("drizzle-orm");
  const trackingNumberWasProvided = hasOwnPurchaseTrackingField(input, "trackingNumber");
  const trackingUpdate = buildPurchaseTrackingUpdate(input);
  if (Object.keys(trackingUpdate).length === 0) return { updatedCount: 0, targetIds: [] as number[] };
  const hasTrackingNumber = String(trackingUpdate.trackingNumber ?? "").trim().length > 0;
  const localPurchases = await getLocalPurchases();
  const directMatches = localPurchases.filter((row) => row.id === input.zaicoId || row.zaicoId === input.zaicoId);
  const targets = directMatches.length > 0
    ? directMatches
    : localPurchases.filter((row) => localPurchaseMatchesTrackingTarget(row, input));
  const uniqueTargets = Array.from(new Map(targets.map((row) => [row.id, row])).values());

  for (const purchase of uniqueTargets) {
    const updateData: Partial<typeof lpTbl.$inferInsert> = {
      ...trackingUpdate,
      stageUpdatedBy: "tracking-registration",
      stageUpdatedAt: new Date(),
    };
    if (purchase.status !== "purchased" && trackingNumberWasProvided) {
      if (hasTrackingNumber) {
        updateData.status = "shipped";
        updateData.stage = "shipped";
      } else if (purchase.status === "shipped") {
        updateData.status = "ordered";
        updateData.stage = "ordered";
      }
    }
    const previousAuditState = getPurchaseTrackingAuditState(purchase);
    const nextAuditState = getNextPurchaseTrackingAuditState(previousAuditState, updateData);
    const changedFields = getPurchaseTrackingChangedFields(previousAuditState, nextAuditState);
    await db
      .update(lpTbl)
      .set(updateData)
      .where(eq(lpTbl.id, purchase.id));
    await recordPurchaseTrackingAuditLog(input, purchase, previousAuditState, nextAuditState, changedFields);
  }

  return { updatedCount: uniqueTargets.length, targetIds: uniqueTargets.map((purchase) => purchase.id) };
}

function purchaseRowMatchesSearch(row: PurchasePageRow, rawSearch: string) {
  const search = rawSearch.trim().toLowerCase();
  if (!search) return true;
  const haystack = [
    row.num,
    row.csvSupplierName,
    row.extra?.trackingNumber,
    ...row.purchase_items.flatMap((item) => {
      const etc = item.etc ?? "";
      const parts = etc.split(",").map((part) => part.trim());
      return [item.title, etc, parts[0], parts[2], ...(item.itemLabels ?? []).map((label) => label.labelId)];
    }),
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n")
    .toLowerCase();
  return haystack.includes(search);
}

function summarizePurchaseRows(rows: PurchasePageRow[]) {
  const totals = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const seenCategories = new Set<string>();
    for (const item of row.purchase_items) {
      const category = item.category || "未分類";
      const price = Number(item.unit_price) || 0;
      const qty = Number(item.quantity) || 0;
      if (price) {
        const current = totals.get(category) ?? { total: 0, count: 0 };
        current.total += price * qty;
        totals.set(category, current);
      } else if (!totals.has(category)) {
        totals.set(category, { total: 0, count: 0 });
      }
      seenCategories.add(category);
    }
    seenCategories.forEach((category) => {
      const current = totals.get(category) ?? { total: 0, count: 0 };
      current.count += 1;
      totals.set(category, current);
    });
  }
  const categoryTotals = Array.from(totals.entries())
    .map(([category, value]) => ({ category, total: value.total, count: value.count }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category, "ja"));
  return {
    categoryTotals,
    grandTotal: categoryTotals.reduce((sum, row) => sum + row.total, 0),
  };
}

/** T22: 行が「完了」（工程バー全チェック＝最終工程到達）か */
function isRowComplete(row: PurchasePageRow): boolean {
  return isInboundComplete(row.inboundClass ?? null, row.stage ?? "received");
}

/** T22: 行が指定タブ（分類）に属するか。"unclassified"=未仕訳(null) */
function rowMatchesInboundTab(row: PurchasePageRow, tab: InboundClass | "unclassified"): boolean {
  const cls = row.inboundClass ?? null;
  if (tab === "unclassified") return cls == null;
  return cls === tab;
}

/**
 * T22: 分類ごとの「未完了件数」を集計する（タブ見出しバッジ用）。
 * 未仕訳(unclassified) と 4分類 のカウントを返す。
 */
function countInboundTabs(rows: PurchasePageRow[]) {
  const counts: Record<string, number> = {
    unclassified: 0,
    ebay: 0,
    oregon: 0,
    direct: 0,
    domestic: 0,
  };
  for (const row of rows) {
    if (isRowComplete(row)) continue; // バッジは未完了のみ数える
    const cls = row.inboundClass ?? null;
    const key = cls == null ? "unclassified" : cls;
    if (key in counts) counts[key] += 1;
  }
  return counts;
}

function buildPurchasePageResponse<T extends PurchasePageRow>(rows: T[], input?: PurchasePageInput) {
  const pageSize = Math.min(Math.max(input?.pageSize ?? 20, 1), 100);
  const requestedPage = Math.max(input?.page ?? 1, 1);
  const category = input?.category?.trim();
  const search = input?.search?.trim() ?? "";
  const status = input?.status ?? null;
  const inboundTab = input?.inboundClass ?? null;
  const showCompleted = input?.showCompleted ?? false;

  // T22: 完了行も消さずに残す（タブ内でグレー表示）。全行を基点にフィルタする。
  const baseRows = rows.filter((row) =>
    row.status !== "purchased" &&
    isPurchasePageInboundCutoffVisible(row) &&
    (showCompleted || !isRowComplete(row)),
  );
  let filteredRows: T[] = baseRows;

  // 分類タブフィルタ（指定時のみ）
  if (inboundTab) {
    filteredRows = filteredRows.filter((row) => rowMatchesInboundTab(row, inboundTab));
  }
  if (category && category !== "すべて") {
    filteredRows = filteredRows.filter((row) =>
      row.purchase_items.some((item) => (item.category || "未分類") === category)
    );
  }
  // 旧status(ordered/shipped)フィルタは後方互換で維持（タブ運用時はクライアントが送らない）
  if (status) {
    filteredRows = filteredRows.filter((row) => getEffectivePurchaseStatus(row) === status);
  }
  if (search) {
    // 商品ID・管理番号・追跡番号で探すときは、入庫済みや完了済みの発注も対象にする。
    // 探しているものが一覧から落ちていて「検索しても出てこない」となるのを防ぐため。
    const searchBase = rows.filter((row) => isPurchasePageInboundCutoffVisible(row));
    filteredRows = searchBase.filter((row) => purchaseRowMatchesSearch(row, search));
  }

  // 未完了を上、完了を下に（作業対象を主役の位置へ）。同群内は元順維持。
  const ordered = [
    ...filteredRows.filter((row) => !isRowComplete(row)),
    ...filteredRows.filter((row) => isRowComplete(row)),
  ];

  const totalCount = ordered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize;
  const items = ordered.slice(start, start + pageSize);
  // カテゴリ合計サマリーは従来どおり未完了(=purchased未満)ベースで算出
  const summary = summarizePurchaseRows(baseRows);
  const tabCounts = countInboundTabs(
    rows.filter((row) => row.status !== "purchased" && isPurchasePageInboundCutoffVisible(row)),
  );

  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages,
    allCount: baseRows.length,
    tabCounts,
    ...summary,
  };
}

export const inventoryRouter = router({
  system: systemRouter,
  actionItems: actionItemsRouter,
  inboundDesk: inboundDeskRouter,
  outboundBoxes: outboundBoxesRouter,
  aiInvestigation: aiInvestigationRouter,
  workLogs: workLogsRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    /**
     * 現在ログイン中のユーザーが認証済みか確認する
     */
    checkAuthorized: protectedProcedure.query(async ({ ctx }) => {
      const authorized = await isAuthorizedUser(ctx.user.openId, ctx.user.email);
      return { authorized };
    }),
    /**
     * 認証コードを検証し、正しければ認証済みユーザーとしてDBに登録する
     */
    authorize: protectedProcedure
      .input(z.object({ code: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const storedCode = await getSystemSetting("access_code");
        if (!storedCode) {
          // 認証コード未設定の場合は常に通過
          await authorizeUser({ openId: ctx.user.openId, name: ctx.user.name, email: ctx.user.email });
          return { valid: true };
        }
        if (input.code !== storedCode) {
          return { valid: false };
        }
        await authorizeUser({ openId: ctx.user.openId, name: ctx.user.name, email: ctx.user.email });
        return { valid: true };
      }),
  }),

  // ============================================================
  // Zaico API 連携
  // ============================================================
  zaico: router({
    /**
     * Zaicoオペレーター一覧を返す
     * 環境変数から登録済みの管理者一覧を生成する
     */
    getOperators: publicProcedure.query(() => {
      const operators: Array<{ key: string; name: string; email: string }> = [];
      // デフォルト（野田さんのトークン）
      const defaultName = process.env.INVENTORY_OPERATOR_DEFAULT_NAME ?? "担当者";
      const defaultEmail = process.env.INVENTORY_OPERATOR_DEFAULT_EMAIL ?? "";
      operators.push({ key: "default", name: defaultName, email: defaultEmail });
      if (process.env.INVENTORY_OPERATOR_A_NAME) {
        operators.push({ key: "A", name: process.env.INVENTORY_OPERATOR_A_NAME, email: process.env.INVENTORY_OPERATOR_A_EMAIL ?? "" });
      }
      if (process.env.INVENTORY_OPERATOR_B_NAME) {
        operators.push({ key: "B", name: process.env.INVENTORY_OPERATOR_B_NAME, email: process.env.INVENTORY_OPERATOR_B_EMAIL ?? "" });
      }
      return operators;
    }),

    /**
     * APIキー接続テスト
     */
    testConnection: publicProcedure
      .input(z.object({ token: z.string().min(1) }))
      .mutation(async () => {
        return testConnection();
      }),

    /**
     * 入庫予定一覧取得（ordered / not_ordered）
     */
    getPurchases: publicProcedure.query(async () => {
      let localPurchaseRows = await restoreMissingLocalPurchasesFromOrphanLabels(await getLocalPurchases());
      localPurchaseRows = await reconcileLocalPurchaseLabelQuantities(localPurchaseRows);
      return localPurchaseRows.map((p) => {
        const displayStatus = getLocalPurchaseDisplayStatus(p);
        const items = (() => {
          try {
            const parsed = JSON.parse(p.itemsJson ?? "[]");
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        })();
        return {
          id: p.zaicoId ?? p.id,
          num: p.purchaseNum ?? "",
          customer_name: p.supplierName ?? "",
          status: displayStatus,
          total_amount: p.unitPrice != null ? Number(p.unitPrice) * (p.quantity ?? 1) : 0,
          purchase_date: p.purchaseDate ?? null,
          estimated_purchase_date: p.purchaseDate ?? null,
          create_user_name: "",
          memo: p.note ?? undefined,
          etc: p.managementNo ?? undefined,
          created_at: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt),
          updated_at: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt),
          extra: {
            shipDate: p.shipDate ?? null,
            trackingNumber: p.trackingNumber ?? null,
            carrier: p.carrier ?? null,
            note: p.note ?? null,
          },
          purchase_items: (items.length > 0 ? items : [{
            id: p.id,
            inventory_id: p.localInventoryId ?? p.id,
            title: p.title ?? "",
            quantity: String(p.quantity ?? 1),
            unit_price: p.unitPrice ?? "0",
            status: displayStatus,
            purchase_date: p.receivedDate ?? null,
            estimated_purchase_date: p.purchaseDate ?? null,
            etc: p.managementNo ?? undefined,
          }]).map((item: Record<string, unknown>, index: number) => ({
            id: Number(item.id ?? p.id + index),
            inventory_id: Number(item.inventory_id ?? item.inventoryId ?? p.localInventoryId ?? p.id),
            title: String(item.title ?? p.title ?? ""),
            quantity: String(item.quantity ?? p.quantity ?? 1),
            unit: String(item.unit ?? "個"),
            unit_price: String(item.unit_price ?? item.unitPrice ?? p.unitPrice ?? "0"),
            status: displayStatus,
            purchase_date: p.receivedDate ?? null,
            estimated_purchase_date: p.purchaseDate ?? null,
            etc: typeof item.etc === "string" ? item.etc : p.managementNo ?? undefined,
            itemLabels: labelsForPurchaseItem(p, item),
          })),
        };
      });
    }),

    /**
     * 入庫処理（statusをpurchasedに更新）
     */
    completePurchase: publicProcedure
      .input(
        z.object({
          purchaseId: z.number().int().positive(),
          purchaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          purchaseItems: z.array(
            z.object({
              inventory_id: z.number().int().positive(),
              quantity: z.union([z.string(), z.number()]).transform(String),
              unit_price: z.union([z.string(), z.number()]).transform(String),
            })
          ),
          // 履歴保存用の追加情報
          historyData: z.object({
            kanriNo: z.string().optional(),
            title: z.string(),
            category: z.string().optional(),
            supplier: z.string().optional(),
            unitPrice: z.string().optional(),
            inventoryId: z.number().int().positive().optional(),
          }).optional(),
          operatorName: z.string().optional(),
          operatorKey: z.enum(["default", "A", "B"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const zaicoEnabled = await isZaicoEnabled();
        // operatorKeyに対応するAPIトークンを解決する
        const operatorToken = resolveOperatorToken(input.operatorKey);

        let result: { code: number; status: string; message: string } | null = null;

        if (zaicoEnabled) {
          // Zaico連携ON: Zaico APIに入庫処理を送信
          result = await completePurchase(input.purchaseId, input.purchaseDate, input.purchaseItems, operatorToken);
        } else {
          // Zaico連携OFF: ローカルDBの発注ステータスをpurchasedに更新し、在庫数を増加する
          // purchaseIdはzaicoId または id（zaicoIdがNULLの場合）として検索
          const localPurchaseRows = await getLocalPurchases();
          const localPurchase = localPurchaseRows.find(
            (p) => p.zaicoId === input.purchaseId || p.id === input.purchaseId
          );
          if (localPurchase) {
            await updateLocalPurchaseStatus(localPurchase.id, "purchased", input.purchaseDate);
            await ensureInventoryItemLabels({
              purchaseId: localPurchase.id,
              localInventoryId: localPurchase.localInventoryId ?? input.purchaseItems[0]?.inventory_id ?? null,
              legacyManagementNo: localPurchase.managementNo,
              title: localPurchase.title ?? input.historyData?.title ?? "",
              quantity: localPurchase.quantity ?? (Number(input.purchaseItems[0]?.quantity ?? 1) || 1),
              status: "received",
              sourceKey: localPurchase.managementNo ? `management:${localPurchase.managementNo}` : null,
            });
          }
          // 在庫数を増加する
          for (const item of input.purchaseItems) {
            const localInv = await getLocalInventoryByZaicoIdOrId(item.inventory_id);
            if (localInv) {
              const addQty = parseInt(item.quantity, 10) || 1;
              const newQty = (localInv.quantity ?? 0) + addQty;
              await updateLocalInventory(localInv.id, { quantity: newQty });
            }
          }
          result = { code: 200, status: "ok", message: "入庫処理完了（ローカルDB）" };
        }

        // 入庫履歴をDBに保存
        const workOperatorName = resolveWorkOperatorName(input.operatorName, ctx.user?.name ?? ctx.user?.email ?? null);
        if (input.historyData) {
          const item = input.purchaseItems[0];
          await createPurchaseHistory({
            zaicoId: input.purchaseId,
            kanriNo: input.historyData.kanriNo ?? null,
            title: input.historyData.title,
            category: input.historyData.category ?? null,
            supplier: input.historyData.supplier ?? null,
            quantity: item?.quantity ?? "1",
            unitPrice: input.historyData.unitPrice ?? item?.unit_price ?? null,
            purchaseDate: input.purchaseDate,
            inventoryId: input.historyData.inventoryId ?? item?.inventory_id ?? null,
            cancelled: 0,
            operatorName: workOperatorName,
          });
          await recordWorkLog({
            workerName: workOperatorName,
            category: "入庫登録",
            status: "done",
            startedAt: new Date(),
            endedAt: new Date(),
            quantity: sumWorkQuantity(input.purchaseItems),
            memo: `管理番号: ${input.historyData.kanriNo ?? input.purchaseId}`,
            createdBy: workOperatorName,
            sourceType: "purchase",
            sourceId: String(input.purchaseId),
            detailsJson: JSON.stringify({
              purchaseId: input.purchaseId,
              purchaseDate: input.purchaseDate,
              managementNo: input.historyData.kanriNo ?? null,
              title: input.historyData.title,
              items: input.purchaseItems,
            }),
          });
        }
        return result;
      }),

    /**
     * 在庫一覧取得（カテゴリ情報包む）
     * 入庫済みデータから各商品の最新入庫日も付帯する
     */
    getInventories: publicProcedure.query(async () => {
      const zaicoEnabled = await isZaicoEnabled();
      // Zaico連携OFFの場合はローカルDBから取得
      if (!zaicoEnabled) {
        const [localInvs, dbDateMap] = await Promise.all([
          getLocalInventories(),
          getLatestPurchaseDateMapFromDB(),
        ]);
        const visibleInvsWithLabels = await ensureStockLabelsForInventories(localInvs);
        return visibleInvsWithLabels.map((inv) => ({
          id: inv.zaicoId ?? inv.id,
          title: inv.title,
          quantity: String(inv.quantity ?? 0),
          unit: inv.unit ?? "個",
          unit_price: parseMoneyNumber(inv.unitPrice),
          purchase_unit_price: parseMoneyNumber(inv.unitPrice),
          category: inv.category ?? null,
          categories: inv.category ? [inv.category] : [],
          place: inv.place ?? null,
          etc: inv.etc ?? null,
          last_purchase_date: dbDateMap[inv.zaicoId ?? inv.id] ?? null,
          supplierUrl: inv.supplierUrl ?? null,
          supplierName: inv.supplierName ?? null,
          ebayListingUrl: inv.ebayListingUrl ?? null,
          ebayOrderUrl: inv.ebayOrderUrl ?? null,
          ebayOrderStatus: normalizeEbayOrderStatus(inv.ebayOrderStatus),
          itemLabels: (inv.itemLabels ?? []).map((label) => ({
            id: label.id,
            labelId: label.labelId,
            status: label.status,
            legacyManagementNo: label.legacyManagementNo,
            localInventoryId: label.localInventoryId,
          })),
        }));
      }
      const [inventories, zaicoDateMap, dbDateMap, inventoryExtras, increaseMemosMap] = await Promise.all([
        getInventories(),
        getLatestPurchaseDateMap(),
        getLatestPurchaseDateMapFromDB(),
        getAllInventoryExtras(),
        getLatestIncreaseMemosMap(),
      ]);
      const extrasMap = new Map(inventoryExtras.map((e) => [e.zaicoInventoryId, e]));
      const inventoriesWithLabels = await ensureStockLabelsForInventories(inventories);
      // 追跡番号マップを取得
      const inventoryIds = inventoriesWithLabels.map((inv) => inv.id);
      const trackingMap = await getTrackingNumbersByInventoryIds(inventoryIds);
      // 各在庫に最新入庫日と補足情報を付与
      // 優先順位: DB入庫日 / Zaico API入庫日 / Zaico直接返す日付 / etcフィールド日付 / 手動増加日 のうち最新を使用
      return inventoriesWithLabels.map((inv) => {
        const dbDate = dbDateMap[inv.id] ?? null;
        const zaicoDate = zaicoDateMap[inv.id] ?? null;
        // Zaico API が直接返す last_purchase_dateも候補に加える
        const zaicoDirectDate = inv.last_purchase_date ?? null;
        const increaseDate = increaseMemosMap[inv.id] ?? null;
        // etcフィールドから「・YYYYMMDD」形式の日付を全て抽出して最新を取得
        const etcDate = extractLatestDateFromEtc(inv.etc);
        // より新しい日付を使用（手動増加日・etc日付も含む）
        const candidates = [dbDate, zaicoDate, zaicoDirectDate, increaseDate, etcDate].filter(Boolean) as string[];
        let last_purchase_date: string | null = candidates.length > 0
          ? candidates.reduce((a, b) => (a > b ? a : b))
          : null;
        const extra = extrasMap.get(inv.id);
        return {
          ...inv,
          last_purchase_date,
          supplierUrl: extra?.supplierUrl ?? null,
          supplierName: extra?.supplierName ?? null,
          trackingNumber: trackingMap.get(inv.id) ?? null,
          purchase_unit_price: inv.purchase_unit_price ?? null,
          itemLabels: inv.itemLabels.map(toInventoryItemLabelView),
        };
      });
    }),

    getCategories: publicProcedure.query(async () => {
      return getInventoryCategoryList();
    }),

    addCategory: publicProcedure
      .input(z.object({ name: z.string().max(200) }))
      .mutation(async ({ input }) => {
        const name = normalizeCategoryName(input.name);
        if (!name || name === ALL_CATEGORY_LABEL || name === UNCATEGORIZED_LABEL) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "カテゴリ名を入力してください" });
        }
        const storedCategories = await getStoredCategories();
        await setStoredCategories([...storedCategories, name]);
        return getInventoryCategoryList();
      }),

    deleteCategory: publicProcedure
      .input(z.object({
        name: z.string().max(200),
        replacement: z.string().max(200).nullable().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const name = normalizeCategoryName(input.name);
        const replacementName = normalizeCategoryName(input.replacement);
        const replacementCategory = replacementName && replacementName !== ALL_CATEGORY_LABEL && replacementName !== UNCATEGORIZED_LABEL
          ? replacementName
          : null;
        if (!name || name === ALL_CATEGORY_LABEL || name === UNCATEGORIZED_LABEL) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "削除できないカテゴリです" });
        }
        const storedCategories = await getStoredCategories();
        await setStoredCategories(storedCategories.filter((category) => category !== name));
        if (!(await isZaicoEnabled())) {
          await clearLocalCategory(name, replacementCategory);
        }
        return getInventoryCategoryList();
      }),

    /**
     * 入庫予定一覧（在庫カテゴリをマッピングして返す）
     * 在庫一覧をキャッシュしてinventory_idでカテゴリを割り当てる
     */
    getPurchasesWithCategoryPage: publicProcedure
      .input(z.object({
        page: z.number().int().min(1).optional(),
        pageSize: z.number().int().min(1).max(100).optional(),
        status: z.enum(["ordered", "shipped"]).nullable().optional(),
        category: z.string().max(200).nullable().optional(),
        search: z.string().max(200).nullable().optional(),
        showCompleted: z.boolean().optional(),
        inboundClass: z.enum(["ebay", "oregon", "direct", "domestic", "unclassified"]).nullable().optional(),
      }).optional())
      .query(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();

        if (!zaicoEnabled) {
          let [localPurchaseRows, localInventoryRows, purchaseExtras] = await Promise.all([
            getLocalPurchases(),
            getLocalInventories(),
            getAllPurchaseExtras(),
          ]);
          localPurchaseRows = await restoreMissingLocalPurchasesFromOrphanLabels(localPurchaseRows);
          localPurchaseRows = await ensureShaftPurchases(localPurchaseRows, localInventoryRows);
          localPurchaseRows = await reconcileLocalPurchaseLabelQuantities(localPurchaseRows);
          // T22: 分類を解決（auto行は自動判定＋バックフィル、manual行は保存値尊重）
          const inboundInfoMap = await resolveInboundInfoMap(localPurchaseRows, localInventoryRows);
          const invIds = localPurchaseRows
            .map((p) => p.localInventoryId)
            .filter((id): id is number => id != null);
          const inventoryLabelMap = await getInventoryItemLabelsByInventoryIds(invIds);
          const purchaseExtraMap = new Map(purchaseExtras.map((extra) => [extra.zaicoId, extra]));
          const invSupplierMap = new Map<number, { supplierName: string | null; supplierUrl: string | null; ebayListingUrl: string | null; quantity: number | null }>();
          for (const inv of localInventoryRows) {
            invSupplierMap.set(inv.id, {
              supplierName: inv.supplierName ?? null,
              supplierUrl: inv.supplierUrl ?? null,
              ebayListingUrl: inv.ebayListingUrl ?? null,
              quantity: inv.quantity ?? null,
            });
          }

          if (invIds.length > 0) {
            const { localInventories: localInvTbl } = await import("../../drizzle/schema");
            const { inArray } = await import("drizzle-orm");
            const db = await getDb();
            if (db) {
              const rows = await db.select({
                id: localInvTbl.id,
                supplierName: localInvTbl.supplierName,
                supplierUrl: localInvTbl.supplierUrl,
                ebayListingUrl: localInvTbl.ebayListingUrl,
                quantity: localInvTbl.quantity,
              }).from(localInvTbl).where(inArray(localInvTbl.id, invIds));
              for (const row of rows) {
                invSupplierMap.set(row.id, {
                  supplierName: row.supplierName ?? null,
                  supplierUrl: row.supplierUrl ?? null,
                  ebayListingUrl: row.ebayListingUrl ?? null,
                  quantity: row.quantity ?? null,
                });
              }
            }
          }

          const rows = localPurchaseRows.map((p) => {
            const purchaseWithExtra = mergeLocalPurchaseStoredExtra(p, getLocalPurchaseStoredExtra(p, purchaseExtraMap));
            const inv = purchaseWithExtra.localInventoryId ? invSupplierMap.get(purchaseWithExtra.localInventoryId) : null;
            const inbound = inboundInfoMap.get(p.id);
            const displayStatus = getLocalPurchaseDisplayStatus(purchaseWithExtra, inventoryLabelMap);
            return {
              id: purchaseWithExtra.zaicoId ?? purchaseWithExtra.id,
              num: purchaseWithExtra.purchaseNum ?? "",
              purchase_date: purchaseWithExtra.purchaseDate ?? null,
              status: displayStatus,
              csvSupplierName: purchaseWithExtra.supplierName ?? inv?.supplierName ?? null,
              csvSupplierUrl: purchaseWithExtra.supplierUrl ?? inv?.supplierUrl ?? null,
              inboundClass: inbound?.inboundClass ?? null,
              classSource: inbound?.classSource ?? "auto",
              stage: inbound?.stage ?? "received",
              stageUpdatedBy: inbound?.stageUpdatedBy ?? null,
              shaftParentPurchaseId: inbound?.shaftParentPurchaseId ?? null,
              extra: {
                shipDate: purchaseWithExtra.shipDate ?? null,
                trackingNumber: purchaseWithExtra.trackingNumber ?? null,
                carrier: purchaseWithExtra.carrier ?? null,
                note: purchaseWithExtra.note ?? null,
              },
              purchase_items: (() => {
                try {
                  const items = JSON.parse(purchaseWithExtra.itemsJson ?? "[]");
                  return Array.isArray(items) ? items.map((item: Record<string, unknown>) => {
                    const parsedInventoryId = Number(item.inventory_id ?? item.inventoryId ?? purchaseWithExtra.localInventoryId);
                    const inventoryId = Number.isFinite(parsedInventoryId) ? parsedInventoryId : null;
                    const invInfo = inventoryId != null ? invSupplierMap.get(inventoryId) : null;
                    const itemEtc =
                      typeof item.etc === "string" && item.etc.trim()
                        ? item.etc
                        : purchaseWithExtra.managementNo ?? undefined;
                    return {
                      ...item,
                      status: displayStatus === "purchased" || displayStatus === "shipped" ? displayStatus : item.status,
                      inventory_id: inventoryId,
                      etc: itemEtc,
                      category: purchaseWithExtra.category ?? "未分類",
                      currentInventoryQuantity: invInfo?.quantity ?? null,
                      itemLabels: labelsForPurchaseItem(purchaseWithExtra, item, inventoryLabelMap),
                    };
                  }) : [];
                } catch {
                  const invInfo = purchaseWithExtra.localInventoryId ? invSupplierMap.get(purchaseWithExtra.localInventoryId) : null;
                  return [{
                    id: purchaseWithExtra.id,
                    title: purchaseWithExtra.title,
                    quantity: String(purchaseWithExtra.quantity ?? 1),
                    unit_price: purchaseWithExtra.unitPrice ?? null,
                    etc: purchaseWithExtra.managementNo ?? null,
                    status: displayStatus,
                    inventory_id: purchaseWithExtra.localInventoryId ?? null,
                    category: purchaseWithExtra.category ?? "未分類",
                    currentInventoryQuantity: invInfo?.quantity ?? null,
                    itemLabels: labelsForPurchaseItem(purchaseWithExtra, { inventory_id: purchaseWithExtra.localInventoryId }, inventoryLabelMap),
                  }];
                }
              })(),
            };
          });

          for (const row of rows) {
            for (const item of row.purchase_items as Array<Record<string, unknown>>) {
              const itemInventoryId = Number(item.inventory_id ?? item.inventoryId);
              const invInfo = Number.isFinite(itemInventoryId) ? invSupplierMap.get(itemInventoryId) : null;
              item.ebayListingUrl = invInfo?.ebayListingUrl ?? null;
              item.currentInventoryQuantity = item.currentInventoryQuantity ?? invInfo?.quantity ?? null;
            }
          }

          return buildPurchasePageResponse(rows, input);
        }

        const [purchases, inventories, extras, inventoryExtras] = await Promise.all([
          getPurchases(),
          getInventories(),
          getAllPurchaseExtras(),
          getAllInventoryExtras(),
        ]);
        const inventoriesWithLabels = await ensureStockLabelsForInventories(inventories);
        const inventoryMap = new Map(inventoriesWithLabels.map((inv) => [inv.id, inv]));
        const extrasMap = new Map(extras.map((e) => [e.zaicoId, e]));
        const inventoryExtrasMap = new Map(inventoryExtras.map((e) => [e.zaicoInventoryId, e]));
        const rows = purchases.map((p) => {
          const invExtra = p.purchase_items
            .map((item) => inventoryExtrasMap.get(item.inventory_id))
            .find((extra) => extra?.supplierName?.trim() || extra?.supplierUrl?.trim()) ?? null;
          return {
            ...p,
            csvSupplierName: invExtra?.supplierName ?? null,
            csvSupplierUrl: invExtra?.supplierUrl ?? null,
            extra: extrasMap.get(p.id) ?? null,
            purchase_items: p.purchase_items.map((item) => {
              const inv = inventoryMap.get(item.inventory_id);
              return {
                ...item,
                category: inv?.categories?.[0] ?? inv?.category ?? "未分類",
                currentInventoryQuantity: inv?.quantity ?? null,
                itemLabels: inv?.itemLabels?.map(toInventoryItemLabelView) ?? [],
                etc: (() => {
                  const itemEtc = item.etc?.trim() ?? "";
                  const invEtc = inv?.etc?.trim() ?? "";
                  if (itemEtc.includes(",")) return itemEtc;
                  if (invEtc.includes(",")) return invEtc;
                  return itemEtc || invEtc || undefined;
                })(),
              };
            }),
          };
        });

        return buildPurchasePageResponse(rows, input);
      }),

    getPurchasesWithCategory: publicProcedure.query(async () => {
      const zaicoEnabled = await isZaicoEnabled();
      // Zaico連携OFFの場合はローカルDBから取得
      if (!zaicoEnabled) {
        let [localPurchaseRows, purchaseHistRows, localInventoryRows, purchaseExtras] = await Promise.all([
          getLocalPurchases(),
          getPurchaseHistories(2000),
          getLocalInventories(),
          getAllPurchaseExtras(),
        ]);
        localPurchaseRows = await restoreMissingLocalPurchasesFromOrphanLabels(localPurchaseRows);
        localPurchaseRows = await ensureShaftPurchases(localPurchaseRows, localInventoryRows);
        localPurchaseRows = await reconcileLocalPurchaseLabelQuantities(localPurchaseRows);
        const inboundInfoMap = await resolveInboundInfoMap(localPurchaseRows, localInventoryRows);
        // purchase_historiesから有効な入庫履歴（cancelled=0）のzaicoIdセットを構築（ステータス証明用）
        const purchasedZaicoIds = new Set<number>(
          purchaseHistRows
            .filter((h) => h.cancelled === 0 && h.zaicoId != null)
            .map((h) => h.zaicoId as number)
        );
        // localInventoryIdをキーのlocal_inventoriesのsupplierName・supplierUrlを取得
        const invIds = localPurchaseRows
          .map((p) => p.localInventoryId)
            .filter((id): id is number => id != null);
        const inventoryLabelMap = await getInventoryItemLabelsByInventoryIds(invIds);
        const purchaseExtraMap = new Map(purchaseExtras.map((extra) => [extra.zaicoId, extra]));
        const invSupplierMap = new Map<number, { supplierName: string | null; supplierUrl: string | null; ebayListingUrl: string | null; quantity: number | null }>();
        for (const inv of localInventoryRows) {
          invSupplierMap.set(inv.id, {
            supplierName: inv.supplierName ?? null,
            supplierUrl: inv.supplierUrl ?? null,
            ebayListingUrl: inv.ebayListingUrl ?? null,
            quantity: inv.quantity ?? null,
          });
        }
        if (invIds.length > 0) {
          const { localInventories: localInvTbl } = await import("../../drizzle/schema");
          const { inArray } = await import("drizzle-orm");
          const db = await getDb();
          if (db) {
            const rows = await db.select({
              id: localInvTbl.id,
              supplierName: localInvTbl.supplierName,
              supplierUrl: localInvTbl.supplierUrl,
              ebayListingUrl: localInvTbl.ebayListingUrl,
              quantity: localInvTbl.quantity,
            }).from(localInvTbl).where(inArray(localInvTbl.id, invIds));
            for (const row of rows) {
              invSupplierMap.set(row.id, {
                supplierName: row.supplierName ?? null,
                supplierUrl: row.supplierUrl ?? null,
                ebayListingUrl: row.ebayListingUrl ?? null,
                quantity: row.quantity ?? null,
              });
            }
          }
        }
        const rows = localPurchaseRows.map((p) => {
          const purchaseWithExtra = mergeLocalPurchaseStoredExtra(p, getLocalPurchaseStoredExtra(p, purchaseExtraMap));
          const inv = purchaseWithExtra.localInventoryId ? invSupplierMap.get(purchaseWithExtra.localInventoryId) : null;
          const inbound = inboundInfoMap.get(p.id);
          // local_purchasesのstatusがpurchased、またはpurchase_historiesに有効な入庫履歴があればpurchased
          const localId = purchaseWithExtra.zaicoId ?? purchaseWithExtra.id;
          const displayStatus = getLocalPurchaseDisplayStatus(purchaseWithExtra, inventoryLabelMap, purchasedZaicoIds);
          return {
            id: localId,
            num: purchaseWithExtra.purchaseNum ?? "",
            purchase_date: purchaseWithExtra.purchaseDate ?? null,
            createdAt: purchaseWithExtra.createdAt ?? null,
            created_at: purchaseWithExtra.createdAt instanceof Date ? purchaseWithExtra.createdAt.toISOString() : (purchaseWithExtra.createdAt ? String(purchaseWithExtra.createdAt) : null),
            status: displayStatus,
            // local_purchases自体のsupplierName/Urlを優先、なければlocal_inventoriesから取得
            csvSupplierName: purchaseWithExtra.supplierName ?? inv?.supplierName ?? null,
            csvSupplierUrl: purchaseWithExtra.supplierUrl ?? inv?.supplierUrl ?? null,
            inboundClass: inbound?.inboundClass ?? null,
            classSource: inbound?.classSource ?? "auto",
            stage: inbound?.stage ?? "received",
            stageUpdatedBy: inbound?.stageUpdatedBy ?? null,
            shaftParentPurchaseId: inbound?.shaftParentPurchaseId ?? null,
            extra: {
              shipDate: purchaseWithExtra.shipDate ?? null,
              trackingNumber: purchaseWithExtra.trackingNumber ?? null,
              carrier: purchaseWithExtra.carrier ?? null,
              note: purchaseWithExtra.note ?? null,
            },
            purchase_items: (() => {
              try {
                const items = JSON.parse(purchaseWithExtra.itemsJson ?? "[]");
                return Array.isArray(items) ? items.map((item: Record<string, unknown>) => {
                  const parsedInventoryId = Number(item.inventory_id ?? item.inventoryId ?? purchaseWithExtra.localInventoryId);
                  const inventoryId = Number.isFinite(parsedInventoryId) ? parsedInventoryId : null;
                  const invInfo = inventoryId != null ? invSupplierMap.get(inventoryId) : null;
                  const itemEtc =
                    typeof item.etc === "string" && item.etc.trim()
                      ? item.etc
                      : purchaseWithExtra.managementNo ?? undefined;
                  return {
                    ...item,
                    status: displayStatus === "purchased" || displayStatus === "shipped" ? displayStatus : item.status,
                    inventory_id: inventoryId,
                    etc: itemEtc,
                    category: purchaseWithExtra.category ?? "未分類",
                    currentInventoryQuantity: invInfo?.quantity ?? null,
                    itemLabels: labelsForPurchaseItem(purchaseWithExtra, item, inventoryLabelMap),
                  };
                }) : [];
              } catch {
                const invInfo = purchaseWithExtra.localInventoryId ? invSupplierMap.get(purchaseWithExtra.localInventoryId) : null;
                return [{
                  id: purchaseWithExtra.id,
                  title: purchaseWithExtra.title,
                  quantity: String(purchaseWithExtra.quantity ?? 1),
                  unit_price: purchaseWithExtra.unitPrice ?? null,
                  etc: purchaseWithExtra.managementNo ?? null,
                  status: displayStatus,
                  inventory_id: purchaseWithExtra.localInventoryId ?? null,
                  category: purchaseWithExtra.category ?? "未分類",
                  currentInventoryQuantity: invInfo?.quantity ?? null,
                  itemLabels: labelsForPurchaseItem(purchaseWithExtra, { inventory_id: purchaseWithExtra.localInventoryId }, inventoryLabelMap),
                }];
              }
            })(),
          };
        });
        for (const row of rows) {
          for (const item of row.purchase_items as Array<Record<string, unknown>>) {
            const itemInventoryId = Number(item.inventory_id ?? item.inventoryId);
            const invInfo = Number.isFinite(itemInventoryId) ? invSupplierMap.get(itemInventoryId) : null;
            item.ebayListingUrl = invInfo?.ebayListingUrl ?? null;
            item.currentInventoryQuantity = item.currentInventoryQuantity ?? invInfo?.quantity ?? null;
          }
        }
        return rows;
      }
      const [purchases, inventories, extras, inventoryExtras] = await Promise.all([
        getPurchases(),
        getInventories(),
        getAllPurchaseExtras(),
        getAllInventoryExtras(),
      ]);

      const inventoryMap = new Map(inventories.map((inv) => [inv.id, inv]));
      const extrasMap = new Map(extras.map((e) => [e.zaicoId, e]));
      // inventory_extras.supplierName を inventoryId をキーにマップ化
      const inventoryExtrasMap = new Map(inventoryExtras.map((e) => [e.zaicoInventoryId, e]));

      // CSVのN列（仕入先名）をインボイスNoをキーにマップ化
      // invoiceNo（C列=cols[2]） -> supplierName（N列=cols[13]）
      const csvSupplierMap = new Map<string, string>();
      try {
        const text = await fetchGithubCsv();
        const lines = text.split(/\r?\n/);
        for (let i = 3; i < lines.length; i++) {
          const line = lines[i];
          if (!line.trim()) continue;
          const cols = parseCSVLine(line).map((col) => col.trim());
          const invoiceNo = cols[2]?.trim() ?? "";
          const supplierName = cols[13]?.trim() ?? "";
          if (!invoiceNo || !/^\d+$/.test(invoiceNo)) continue;
          // 同一インボイスNoの最初の非空値を採用
          if (supplierName && !csvSupplierMap.has(invoiceNo)) {
            csvSupplierMap.set(invoiceNo, supplierName);
          }
        }
      } catch (e) {
        console.error("CSV supplier fetch error:", e);
      }

      return purchases.map((p) => {
        // purchase_items の inventory_id から inventory_extras の supplierName/supplierUrl を取得
        const invExtra = p.purchase_items
          .map((item) => inventoryExtrasMap.get(item.inventory_id))
          .find((extra) => extra?.supplierName?.trim() || extra?.supplierUrl?.trim()) ?? null;
        const invSupplierName = invExtra?.supplierName ?? null;
        const invSupplierUrl = invExtra?.supplierUrl ?? null;
        return {
          ...p,
          // 優先順位: inventory_extras.supplierName > CSV取引相相手列 > null
          csvSupplierName: invSupplierName ?? csvSupplierMap.get(p.num) ?? null,
          csvSupplierUrl: invSupplierUrl ?? null,
          extra: extrasMap.get(p.id) ?? null,
          purchase_items: p.purchase_items.map((item) => {
            const inv = inventoryMap.get(item.inventory_id);
            return {
              ...item,
              category: inv?.categories?.[0] ?? inv?.category ?? "未分類",
              // 在庫の etc（備考欄）を優先して設定
              // item.etc が「管理番号のみ」（カンマなし）の場合は在庫の etc（サイト名含む完全形式）を優先する
              etc: (() => {
                const itemEtc = item.etc?.trim() ?? "";
                const invEtc = inv?.etc?.trim() ?? "";
                // カンマが含まれている = 「管理番号, 日付, サイト名」の完全形式
                if (itemEtc.includes(",")) return itemEtc;
                if (invEtc.includes(",")) return invEtc;
                return itemEtc || invEtc || undefined;
              })(),
            };
          }),
        };
      });
    }),

    /**
     * 在庫単件取得（詳細表示用）
     * 削除済みの場合はnullを返す
     */
    getInventoryById: publicProcedure
      .input(z.object({ inventoryId: z.number().int().positive() }))
      .query(async ({ input }) => {
        // local_inventoriesからDBフォールバック用のヘルパー関数
        async function buildFromLocalDb() {
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (!localInv) return null;
          const labelMap: Awaited<ReturnType<typeof getInventoryItemLabelsByInventoryIds>> =
            await getInventoryItemLabelsByInventoryIds([Number(localInv.id)]).catch(() => new Map());
          const itemLabels = (labelMap.get(Number(localInv.id)) ?? []).map((label) => ({
            labelId: label.labelId,
            status: label.status,
            legacyManagementNo: label.legacyManagementNo,
          }));
          return {
            id: localInv.zaicoId ?? input.inventoryId,
            title: localInv.title,
            quantity: String(localInv.quantity ?? 0),
            unit: localInv.unit ?? "個",
            category: localInv.category ?? undefined,
            categories: localInv.category ? [localInv.category] : undefined,
            place: localInv.place ?? undefined,
            etc: localInv.etc ?? undefined,
            unit_price: localInv.unitPrice != null ? Number(localInv.unitPrice) : undefined,
            purchase_unit_price: localInv.unitPrice != null ? Number(localInv.unitPrice) : undefined,
            ebayListingUrl: localInv.ebayListingUrl ?? null,
            ebayOrderUrl: localInv.ebayOrderUrl ?? null,
            ebayOrderStatus: normalizeEbayOrderStatus(localInv.ebayOrderStatus),
            code: undefined as string | undefined,
            optional_attributes: [] as Array<{ name: string; value: string | null }>,
            itemLabels,
            item_image: undefined,
            created_at: localInv.createdAt instanceof Date ? localInv.createdAt.toISOString() : String(localInv.createdAt),
            updated_at: localInv.updatedAt instanceof Date ? localInv.updatedAt.toISOString() : String(localInv.updatedAt),
            _fromLocalDb: true,
          };
        }
        return await buildFromLocalDb();
        try {
          const result = await getInventory(input.inventoryId);
          if (result) return result;
          // Zaico APIがnullを返した場合はlocal_inventoriesからフォールバック
          return await buildFromLocalDb();
        } catch (err: unknown) {
          // Zaico APIエラー（404・403・その他）の場合はlocal_inventoriesからフォールバック
          // DBにデータがある場合は詳細表示できるようにする
          const localResult = await buildFromLocalDb();
          if (localResult) return localResult;
          // DBにもない場合のみnullを返す（「Zaicoから削除されています」表示）
          return null;
        }
      }),

    /**
     * 指定した在庫IDに紐づく全ステータスの入庫データ一覧を取得する
     * ordered / not_ordered / purchased すべてを対象にする（在庫削除時の連動削除用）
     */
    getPurchasesByInventoryId: publicProcedure
      .input(z.object({
        inventoryId: z.number().int().positive(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
      }))
      .query(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        if (!zaicoEnabled) {
          // Zaico連携OFF: local_inventoriesのetcからSRN管理番号を取得し、
          // local_purchasesのmanagementNoが同じグループ（先頭プレフィックス一致）の発注データを返す
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (!localInv) return [];
          // etcの先頭部分（最初のカンマ前）= SRN管理番号
          const etcRaw = localInv.etc ?? "";
          const srnFromEtc = etcRaw.split(",")[0]?.trim() ?? "";
          if (!srnFromEtc) return [];
          // SRN番号のプレフィックス（例: "383_ヴィン_" → "383_ヴィン"）を抽出
          // 形式: "プレフィックス_連番/合計" なので最後の "_数字/数字" を除いたもの
          const rows = (await getLocalPurchases()).filter((p) =>
            localPurchaseMatchesInventoryForLinkedDelete(p, localInv.id, srnFromEtc)
          );
          // フロントエンドが期待する形式に変換
          return rows.map((p) => ({
            id: p.id,
            num: p.purchaseNum ?? "",
            status: getLocalPurchaseDisplayStatus(p),
            purchase_items: (() => {
              try {
                const items = JSON.parse(p.itemsJson ?? "[]");
                return Array.isArray(items) ? items : [];
              } catch {
                return [{ id: p.id, title: p.title, quantity: String(p.quantity ?? 1), unit_price: p.unitPrice ?? null, etc: p.managementNo ?? null }];
              }
            })(),
          }));
        }
        const operatorToken = resolveOperatorToken(input.operatorKey);
        // 全ステータス（ordered/not_ordered/purchased）を対象にフィルタリング
        const purchases = await getAllPurchases(operatorToken);
        return purchases.filter((p) =>
          p.purchase_items.some((item) => item.inventory_id === input.inventoryId)
        );
      }),

    /**
     * 発注データのみ削除（在庫データは消さない）
     * 入庫管理の削除ボタン用
     */
    deletePurchaseOnly: publicProcedure
      .input(z.object({
        purchaseId: z.number().int().positive(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
        inventoryId: z.number().int().positive().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const operatorToken = resolveOperatorToken(input.operatorKey);
        const zaicoEnabled = await isZaicoEnabled();
        if (!zaicoEnabled) {
          // Zaico連携OFF時はローカルDBから直接削除
          // purchaseIdはzaicoIdまたはidのどちらかなので両方で検索
          const { localPurchases: lpTbl } = await import("../../drizzle/schema");
          const { or, eq } = await import("drizzle-orm");
          const db = await getDb();
          if (db) {
            const [lp] = await db
              .select()
              .from(lpTbl)
              .where(or(eq(lpTbl.id, input.purchaseId), eq(lpTbl.zaicoId, input.purchaseId)))
              .limit(1);
            if (lp) {
              const inventoryId = input.inventoryId ?? lp.localInventoryId ?? null;
              const snapshotInventory = inventoryId ? await getLocalInventoryById(inventoryId) : null;
              const snapshotPurchase = (await getLocalPurchases().catch(() => [] as LocalPurchaseRow[]))
                .find((row) => row.id === lp.id) ?? lp;
              await recordFullRestoreSnapshot({
                inventory: snapshotInventory ?? null,
                purchases: [snapshotPurchase],
                source: "purchase",
                reason: "入庫管理削除前",
                operatorName: ctx.user.name ?? ctx.user.email ?? null,
              });
            }
            // local_purchasesを削除
            await db.delete(lpTbl).where(
              or(
                eq(lpTbl.id, input.purchaseId),
                eq(lpTbl.zaicoId, input.purchaseId)
              )
            );
          }
          return { success: true };
        }
        // Zaico連携ON時はZaico APIで削除
        try {
          await deletePurchase(input.purchaseId, operatorToken);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "";
          // 404の場合は既に削除済として続行
          if (!msg.includes("404") && !msg.includes("Not Found")) {
            throw err;
          }
        }
        return { success: true };
      }),

    /**
     * 発注データ更新（単価・管理番号・入庫予定日等）
     * 入庫管理の編集ダイアログ用
     */
    updatePurchaseData: publicProcedure
      .input(z.object({
        purchaseId: z.number().int().positive(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
        customerName: z.string().optional(),
        estimatedPurchaseDate: z.string().optional(),
        memo: z.string().optional(),
        purchaseItems: z.array(z.object({
          id: z.number().int().nonnegative().optional(),
          inventoryId: z.number().int().positive(),
          title: z.string().min(1).max(500).optional(),
          unitPrice: z.number().optional(),
          quantity: z.number().optional(),
          estimatedPurchaseDate: z.string().optional(),
          etc: z.string().optional(),
          category: z.string().max(200).nullable().optional(),
        })).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBを直接更新
          const { localPurchases: lpTbl, localInventories: liTbl } = await import("../../drizzle/schema");
          const { eq, or } = await import("drizzle-orm");
          const db = await getDb();
          if (!db) throw new Error("Database not available");
          // purchaseIdはlocal_purchases.idまたは同期元のzaicoIdとして渡る。
          const [lp] = await db
            .select()
            .from(lpTbl)
            .where(or(eq(lpTbl.id, input.purchaseId), eq(lpTbl.zaicoId, input.purchaseId)))
            .limit(1);
          if (lp) {
            // purchaseItemsの先頭要素からunitPrice・etcを取得
            const firstItem = input.purchaseItems?.[0];
            const firstInventoryId = firstItem?.inventoryId ?? lp.localInventoryId;
            const snapshotInventory = firstInventoryId ? await getLocalInventoryById(firstInventoryId) : null;
            const snapshotPurchase = (await getLocalPurchases().catch(() => [] as LocalPurchaseRow[]))
              .find((row) => row.id === lp.id) ?? lp;
            await recordFullRestoreSnapshot({
              inventory: snapshotInventory ?? null,
              purchases: [snapshotPurchase],
              source: "purchase",
              reason: "入庫管理編集前",
              operatorName: ctx.user.name ?? ctx.user.email ?? null,
            });
            const lpUpdateData: Partial<typeof lpTbl.$inferInsert> = {};
            if (firstInventoryId && lp.localInventoryId !== firstInventoryId) {
              lpUpdateData.localInventoryId = firstInventoryId;
            }
            let itemsJsonCache: Array<Record<string, unknown>> | null = null;
            const updateFirstItemJson = (changes: Record<string, unknown>) => {
              try {
                if (!itemsJsonCache) {
                  const parsed = JSON.parse(lp.itemsJson ?? "[]");
                  itemsJsonCache = Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
                }
                if (itemsJsonCache.length > 0) {
                  itemsJsonCache[0] = { ...itemsJsonCache[0], ...changes };
                  lpUpdateData.itemsJson = JSON.stringify(itemsJsonCache);
                }
              } catch {
                // Snapshot updates are best-effort.
              }
            };
            if (firstItem?.unitPrice !== undefined) {
              // decimal型は数値をそのまま渡せる
              const unitPrice = String(firstItem.unitPrice);
              (lpUpdateData as Record<string, unknown>).unitPrice = unitPrice;
              updateFirstItemJson({ unit_price: unitPrice, unitPrice });
              // local_inventoriesの単価も更新
              if (firstInventoryId) {
                await db.update(liTbl).set({ unitPrice }).where(eq(liTbl.id, firstInventoryId));
              }
            }
            if (firstItem?.quantity !== undefined) {
              const quantity = Math.max(1, Math.round(Number(firstItem.quantity) || 1));
              lpUpdateData.quantity = quantity;
              updateFirstItemJson({ quantity: String(quantity) });
            }
            if (firstItem?.title !== undefined) {
              const nextTitle = firstItem.title.trim();
              (lpUpdateData as Record<string, unknown>).title = nextTitle;
              updateFirstItemJson({ title: nextTitle });
              if (firstInventoryId) {
                await db.update(liTbl).set({ title: nextTitle }).where(eq(liTbl.id, firstInventoryId));
              }
            }
            if (firstItem?.etc !== undefined) {
              const nextManagementNo = firstItem.etc.split(",")[0]?.trim() ?? (lp.managementNo ?? undefined);
              lpUpdateData.managementNo = nextManagementNo;
              updateFirstItemJson({ etc: firstItem.etc });
              if (firstInventoryId) {
                await db.update(liTbl).set({ etc: firstItem.etc || nextManagementNo || null }).where(eq(liTbl.id, firstInventoryId));
              }
            }
            if (firstItem?.category !== undefined) {
              const nextCategory = normalizeCategoryName(firstItem.category) || null;
              (lpUpdateData as Record<string, unknown>).category = nextCategory;
              updateFirstItemJson({ category: nextCategory });
              if (firstInventoryId) {
                await db.update(liTbl).set({ category: nextCategory }).where(eq(liTbl.id, firstInventoryId));
              }
            }
            if (Object.keys(lpUpdateData).length > 0) {
              await db.update(lpTbl).set(lpUpdateData).where(eq(lpTbl.id, lp.id));
            }
            if (firstItem) {
              const nextManagementNo = firstItem.etc !== undefined
                ? firstItem.etc.split(",")[0]?.trim() || null
                : lp.managementNo ?? null;
              await ensureInventoryItemLabels({
                purchaseId: lp.id,
                localInventoryId: firstInventoryId ?? null,
                legacyManagementNo: nextManagementNo,
                title: firstItem.title?.trim() || lp.title || "",
                quantity: Math.max(1, Math.round(Number(firstItem.quantity ?? lp.quantity ?? 1) || 1)),
                status: lp.status === "purchased" ? "received" : "ordered",
                sourceKey: nextManagementNo ? `management:${nextManagementNo}` : null,
              });
            }
          }
          return { success: true };
        }

        const payload: Parameters<typeof updatePurchase>[1] = {};
        if (input.customerName !== undefined) payload.customer_name = input.customerName;
        if (input.estimatedPurchaseDate !== undefined) payload.estimated_purchase_date = input.estimatedPurchaseDate;
        if (input.memo !== undefined) payload.memo = input.memo;
        if (input.purchaseItems) {
          const invalidItem = input.purchaseItems.find((item) => !item.id || item.id <= 0);
          if (invalidItem) {
            throw new Error("Zaico連携ONでは発注明細IDが必要です");
          }
          payload.purchase_items = input.purchaseItems.map((item) => ({
            id: item.id!,
            inventory_id: item.inventoryId,
            ...(item.unitPrice !== undefined && { unit_price: item.unitPrice }),
            ...(item.quantity !== undefined && { quantity: item.quantity }),
            ...(item.estimatedPurchaseDate !== undefined && { estimated_purchase_date: item.estimatedPurchaseDate }),
            ...(item.etc !== undefined && { etc: item.etc }),
          }));
        }
        await updatePurchase(input.purchaseId, payload, operatorToken);
        if (input.purchaseItems) {
          const itemsWithInventoryChanges = input.purchaseItems.filter(
            (item) => item.title !== undefined || item.unitPrice !== undefined || item.category !== undefined || item.etc !== undefined
          );
          await Promise.all(
            itemsWithInventoryChanges.map(async (item) => {
              try {
                const inv = await getInventory(item.inventoryId);
                await updateInventory(
                  item.inventoryId,
                  {
                    title: item.title ?? inv.title,
                    quantity: String(inv.quantity ?? 0),
                    unit: inv.unit ?? undefined,
                    category: item.category !== undefined
                      ? (normalizeCategoryName(item.category) || undefined)
                      : inv.categories?.[0] ?? inv.category ?? undefined,
                    place: inv.place ?? undefined,
                    etc: item.etc !== undefined ? item.etc : inv.etc ?? undefined,
                    purchase_unit_price: item.unitPrice ?? inv.purchase_unit_price ?? undefined,
                  },
                  operatorToken
                );
              } catch {
                // 在庫同期の失敗はログのみ（発注更新自体は成功している）
              }
            })
          );
        }
        return { success: true };
      }),

    /**
     * 在庫削除（Zaicoから削除）
     * alsoDeletePurchaseIds: 同時に削除する発注データのID一覧
     */
    deleteInventory: publicProcedure
      .input(z.object({
        inventoryId: z.number().int().positive(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
        alsoDeletePurchaseIds: z.array(z.number().int().positive()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBから削除（論理削除）
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (localInv) {
            await recordFullRestoreSnapshot({
              inventory: localInv,
              purchases: await getRelatedLocalPurchasesForFullRestore(localInv),
              source: "ui",
              reason: "在庫削除前",
              operatorName: ctx.user.name ?? ctx.user.email ?? null,
            });
            // 削除前に商品データをdeleted_inventoriesに保存
            await createDeletedInventory({
              zaicoId: localInv.zaicoId ?? localInv.id,
              title: localInv.title,
              category: localInv.category ?? undefined,
              place: localInv.place ?? undefined,
              quantity: localInv.quantity != null ? String(localInv.quantity) : undefined,
              unit: localInv.unit ?? undefined,
              unitPrice: localInv.unitPrice ?? undefined,
              etc: localInv.etc ?? undefined,
              snapshotJson: JSON.stringify(localInv),
            }).catch(() => {});
            await deleteLocalInventory(localInv.id);
            await recordInventoryChange({
              inventoryId: localInv.zaicoId ?? localInv.id,
              title: localInv.title,
              changeType: "deleted",
              source: "ui",
              quantityBefore: localInv.quantity,
              quantityAfter: 0,
              note: localInv.etc ? `管理番号・備考: ${localInv.etc}` : null,
            });
          }
          // 連動削除が指定された場合はlocal_purchasesも削除
          if (input.alsoDeletePurchaseIds && input.alsoDeletePurchaseIds.length > 0) {
            const { localPurchases: lpTbl } = await import("../../drizzle/schema");
            const { inArray } = await import("drizzle-orm");
            const db = await getDb();
            if (db) {
              const requestedIds = new Set(input.alsoDeletePurchaseIds);
              const inventoryManagementNo = getInventoryManagementNo(localInv?.etc);
              const safePurchaseIds = (await getLocalPurchases())
                .filter((purchase) =>
                  requestedIds.has(purchase.id) &&
                  localPurchaseMatchesInventoryForLinkedDelete(purchase, localInv?.id ?? null, inventoryManagementNo)
                )
                .map((purchase) => purchase.id);
              if (safePurchaseIds.length > 0) {
                await db.delete(lpTbl).where(inArray(lpTbl.id, safePurchaseIds));
              }
            }
          }
          return { code: 200, status: "ok", message: "在庫を削除しました（ローカルDB）" };
        }

        // Zaico連携ON: 従来の処理
        // 削除前に商品データを取得してDBに保存する
        try {
          const inv = await getInventory(input.inventoryId);
          // optional_attributesから仕入単価を取得
          let unitPrice: string | undefined;
          if (inv.optional_attributes) {
            const priceAttr = inv.optional_attributes.find((a) => a.name === "仕入単価");
            if (priceAttr?.value) unitPrice = priceAttr.value;
          }
          await createDeletedInventory({
            zaicoId: inv.id,
            title: inv.title,
            category: inv.category ?? undefined,
            place: inv.place ?? undefined,
            quantity: inv.quantity != null ? String(inv.quantity) : undefined,
            unit: inv.unit ?? undefined,
            unitPrice: unitPrice ?? (inv.unit_price != null ? String(inv.unit_price) : undefined),
            etc: inv.etc ?? undefined,
            snapshotJson: JSON.stringify(inv),
          });
        } catch {
          // 取得失敗しても削除は続行する
        }
        // 在庫補足情報（supplierUrl等）も削除する
        await deleteInventoryExtra(input.inventoryId).catch(() => {});
        // 連動削除が指定されている場合は発注データも削除する
        if (input.alsoDeletePurchaseIds && input.alsoDeletePurchaseIds.length > 0) {
          await Promise.allSettled(
            input.alsoDeletePurchaseIds.map((pid) => deletePurchase(pid, operatorToken))
          );
        }
        // 在庫削除（既に削除済みの場合は404が返るがエラーにしない）
        try {
          return await deleteInventory(input.inventoryId, operatorToken);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "";
          // 404（既に削除済み）の場合はエラーにしない
          if (msg.includes("404")) {
            return { code: 200, status: "ok", message: "既に削除済みです" };
          }
          throw err;
        }
      }),

    /**
     * 在庫補足情報（supplierUrl等）のUpsert
     */
    upsertInventoryExtra: publicProcedure
      .input(
        z.object({
          zaicoInventoryId: z.number().int().positive(),
          supplierUrl: z.string().url().optional().or(z.literal("")),
          supplierName: z.string().max(200).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        await upsertInventoryExtra({
          zaicoInventoryId: input.zaicoInventoryId,
          supplierUrl: input.supplierUrl || null,
          supplierName: input.supplierName || null,
        });
        return { success: true };
      }),

    /**
     * 在庫データ新規作成
     * POST /api/v1/inventories
     */
    createInventory: publicProcedure
      .input(
        z.object({
          title: z.string().min(1, "商品名を入力してください").max(200),
          quantity: z.string().optional(),
          unit: z.string().optional(),
          category: z.string().max(250).optional(),
          place: z.string().max(200).optional(),
          etc: z.string().optional(),
          code: z.string().max(200).optional(),
          purchase_unit_price: z.number().optional(),
          operatorKey: z.enum(["default", "A", "B"]).optional(),
          supplierUrl: z.string().optional(),
          supplierName: z.string().max(200).optional(),
          ebayListingUrl: z.string().max(1000).nullable().optional(),
          ebayOrderUrl: z.string().max(1000).nullable().optional(),
          ebayOrderStatus: z.enum(["normal", "cancelled", "returned"]).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const { operatorKey, supplierUrl, supplierName, ebayListingUrl, ebayOrderUrl, ebayOrderStatus, ...payload } = input;

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBに商品を作成
          const createdQuantity = Math.round(parseFloat(payload.quantity ?? "0") || 0);
          const createdId = await upsertLocalInventory({
            zaicoId: null,
            title: payload.title,
            category: payload.category ?? null,
            place: payload.place ?? null,
            quantity: createdQuantity,
            unit: payload.unit ?? "個",
            unitPrice: payload.purchase_unit_price != null ? String(payload.purchase_unit_price) : null,
            etc: payload.etc ?? null,
            supplierUrl: supplierUrl || null,
            supplierName: supplierName || null,
            ebayListingUrl: getEbayStockType(payload.etc) === "stocked" ? normalizeListingUrl(ebayListingUrl) : null,
            ebayOrderUrl: normalizeListingUrl(ebayOrderUrl),
            ebayOrderStatus: isEbayManagementNo(payload.etc) ? normalizeEbayOrderStatus(ebayOrderStatus) : "normal",
            isDeleted: 0,
          });
          await recordInventoryChange({
            inventoryId: createdId,
            title: payload.title,
            changeType: "created",
            source: "ui",
            quantityAfter: createdQuantity,
            note: [
              payload.category ? `カテゴリ: ${payload.category}` : null,
              payload.purchase_unit_price != null ? `仕入単価: ${payload.purchase_unit_price}` : null,
              payload.etc ? `管理番号・備考: ${payload.etc}` : null,
            ].filter(Boolean).join(" / ") || null,
          });
          if (createdId > 0) {
            await ensureInventoryItemLabelsForInventory({
              localInventoryId: createdId,
              legacyManagementNo: getInventoryManagementNo(payload.etc),
              title: payload.title,
              quantity: inventoryLabelQuantity(createdQuantity),
              status: inventoryInitialLabelStatus(createdQuantity),
              sourceKey: `inventory:${createdId}`,
            });
          }
          return { code: 200, status: "ok", message: "商品を登録しました（ローカルDB）", data_id: createdId };
        }

        const token = resolveOperatorToken(operatorKey);
        const result = await createInventory(payload, token);
        // supplierUrlがある場合はDBに保存
        if (supplierUrl && result.data_id) {
          await upsertInventoryExtra({
            zaicoInventoryId: result.data_id,
            supplierUrl: supplierUrl || null,
            supplierName: supplierName || null,
          }).catch(() => {});
        }
        if (result.data_id) {
          await ensureInventoryItemLabelsForInventory({
            localInventoryId: result.data_id,
            legacyManagementNo: getInventoryManagementNo(payload.etc),
            title: payload.title,
            quantity: inventoryLabelQuantity(payload.quantity),
            status: inventoryInitialLabelStatus(payload.quantity),
            sourceKey: `inventory:${result.data_id}`,
          });
        }
        return result;
      }),

    /**
     * 在庫データ更新
     * PUT /api/v1/inventories/{id}
     */
    updateInventory: publicProcedure
      .input(
        z.object({
          inventoryId: z.number().int().positive(),
          title: z.string().min(1, "商品名を入力してください").max(200),
          quantity: z.string().optional(),
          unit: z.string().optional(),
          category: z.string().max(250).optional(),
          place: z.string().max(200).optional(),
          etc: z.string().optional(),
          code: z.string().max(200).optional(),
          purchase_unit_price: z.number().optional(),
          operatorKey: z.enum(["default", "A", "B"]).optional(),
          supplierUrl: z.string().optional(),
          supplierName: z.string().max(200).optional(),
          ebayListingUrl: z.string().max(1000).nullable().optional(),
          ebayOrderUrl: z.string().max(1000).nullable().optional(),
          ebayOrderStatus: z.enum(["normal", "cancelled", "returned"]).optional(),
          /** 呼び出し元が自前で在庫メモを書く場合に true（履歴の二重登録を防ぐ） */
          skipChangeLog: z.boolean().optional(),
          /** 変更元の識別子。履歴に残して原因追跡に使う */
          changeSource: z.enum(["ui", "api", "cron", "delivery", "purchase"]).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const { inventoryId, operatorKey, supplierUrl, supplierName, ebayListingUrl, ebayOrderUrl, ebayOrderStatus, skipChangeLog, changeSource, ...payload } = input;

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBの商品を更新
          const localInv = await getLocalInventoryByZaicoIdOrId(inventoryId);
          if (localInv) {
            const nextSupplierUrl = supplierUrl === undefined ? localInv.supplierUrl : supplierUrl || null;
            const nextSupplierName = supplierName === undefined ? localInv.supplierName : supplierName || null;
            const nextUnitPrice = payload.purchase_unit_price != null ? String(payload.purchase_unit_price) : localInv.unitPrice;
            const nextInventoryEtc = payload.etc ?? null;
            const nextManagementNo = nextInventoryEtc?.split(",")[0]?.trim() || null;
            const nextEbayStockType = getEbayStockType(nextInventoryEtc);
            const nextValues = {
              title: payload.title,
              category: payload.category ?? null,
              place: payload.place ?? null,
              quantity: payload.quantity != null ? Math.round(parseFloat(payload.quantity) || 0) : localInv.quantity,
              unit: payload.unit ?? localInv.unit,
              unitPrice: nextUnitPrice,
              etc: nextInventoryEtc,
              supplierUrl: nextSupplierUrl,
              supplierName: nextSupplierName,
              ebayListingUrl: nextEbayStockType === "stocked"
                ? (ebayListingUrl === undefined ? localInv.ebayListingUrl : normalizeListingUrl(ebayListingUrl))
                : null,
              ebayOrderUrl: ebayOrderUrl === undefined ? localInv.ebayOrderUrl : normalizeListingUrl(ebayOrderUrl),
              ebayOrderStatus: isEbayManagementNo(nextInventoryEtc)
                ? (ebayOrderStatus === undefined ? normalizeEbayOrderStatus(localInv.ebayOrderStatus) : normalizeEbayOrderStatus(ebayOrderStatus))
                : "normal",
            };
            await recordFullRestoreSnapshot({
              inventory: localInv,
              purchases: await getRelatedLocalPurchasesForFullRestore(localInv),
              source: changeSource ?? "ui",
              reason: "在庫更新前",
              operatorName: ctx.user.name ?? ctx.user.email ?? null,
            });
            await updateLocalInventory(localInv.id, nextValues);
            await ensureInventoryItemLabelsForInventory({
              localInventoryId: localInv.id,
              legacyManagementNo: nextManagementNo,
              title: payload.title,
              quantity: inventoryLabelQuantity(nextValues.quantity),
              status: inventoryInitialLabelStatus(nextValues.quantity),
              sourceKey: `inventory:${localInv.id}`,
            });
            // 在庫変動履歴を残す。skipChangeLog=true の呼び出し元は自前でメモを書く
            if (!skipChangeLog) {
              const diffs = diffInventoryFields(
                {
                  title: localInv.title,
                  category: localInv.category,
                  place: localInv.place,
                  quantity: localInv.quantity,
                  unit: localInv.unit,
                  unitPrice: localInv.unitPrice,
                  etc: localInv.etc,
                  supplierUrl: localInv.supplierUrl,
                  supplierName: localInv.supplierName,
                  ebayListingUrl: localInv.ebayListingUrl,
                  ebayOrderUrl: localInv.ebayOrderUrl,
                  ebayOrderStatus: localInv.ebayOrderStatus,
                },
                nextValues
              );
              if (diffs.length > 0) {
                await recordInventoryChange({
                  inventoryId: localInv.zaicoId ?? localInv.id,
                  title: payload.title,
                  changeType: "updated",
                  source: changeSource ?? "ui",
                  diffs,
                  quantityBefore: localInv.quantity,
                  quantityAfter: nextValues.quantity,
                });
              }
            }
            const db = await getDb();
            if (db) {
              const { localPurchases: lpTbl } = await import("../../drizzle/schema");
              const localPurchaseRows = await getLocalPurchases();
              const relatedPurchases = localPurchaseRows.filter((purchase) => {
                if (purchase.localInventoryId === localInv.id) return true;
                try {
                  const items = JSON.parse(purchase.itemsJson ?? "[]");
                  return Array.isArray(items) && items.some((item) => {
                    const itemInventoryId = Number(item.inventory_id ?? item.inventoryId ?? 0);
                    return itemInventoryId === localInv.id || (localInv.zaicoId != null && itemInventoryId === localInv.zaicoId);
                  });
                } catch {
                  return false;
                }
              });
              await Promise.all(
                relatedPurchases.map(async (purchase) => {
                  let itemsJson = purchase.itemsJson;
                  try {
                    const items = JSON.parse(purchase.itemsJson ?? "[]");
                    if (Array.isArray(items)) {
                      const updatedItems = items.map((item) => {
                        const itemInventoryId = Number(item.inventory_id ?? item.inventoryId ?? 0);
                        const shouldSync =
                          itemInventoryId === localInv.id ||
                          (localInv.zaicoId != null && itemInventoryId === localInv.zaicoId) ||
                          (purchase.localInventoryId === localInv.id && items.length === 1);
                        if (!shouldSync) return item;
                        return {
                          ...item,
                          title: payload.title,
                          category: payload.category ?? null,
                          unit_price: payload.purchase_unit_price != null ? payload.purchase_unit_price : item.unit_price,
                          unitPrice: payload.purchase_unit_price != null ? payload.purchase_unit_price : item.unitPrice,
                          etc: nextInventoryEtc,
                          managementNo: nextManagementNo,
                          inventory_id: item.inventory_id ?? localInv.id,
                        };
                      });
                      itemsJson = JSON.stringify(updatedItems);
                    }
                  } catch {
                    itemsJson = purchase.itemsJson;
                  }
                  await db.update(lpTbl).set({
                    title: payload.title,
                    category: payload.category ?? null,
                    unitPrice: nextUnitPrice,
                    managementNo: nextManagementNo,
                    supplierUrl: nextSupplierUrl,
                    supplierName: nextSupplierName,
                    itemsJson,
                  }).where(eq(lpTbl.id, purchase.id));
                })
              );
            }
          }
          return { code: 200, status: "ok", message: "商品を更新しました（ローカルDB）" };
        }

        const token = resolveOperatorToken(operatorKey);
        const result = await updateInventory(inventoryId, payload, token);
        await ensureInventoryItemLabelsForInventory({
          localInventoryId: inventoryId,
          legacyManagementNo: getInventoryManagementNo(payload.etc),
          title: payload.title,
          quantity: inventoryLabelQuantity(payload.quantity),
          status: inventoryInitialLabelStatus(payload.quantity),
          sourceKey: `inventory:${inventoryId}`,
        }).catch(() => {});
        // supplierUrlを更新
        await upsertInventoryExtra({
          zaicoInventoryId: inventoryId,
          supplierUrl: supplierUrl ?? null,
          supplierName: supplierName ?? null,
        }).catch(() => {});
        // 在庫変更を発注済み商品にも反映（unit_priceを同期）
        if (payload.purchase_unit_price != null) {
          try {
            const allPurchases = await getAllPurchases(token);
            const relatedPurchases = allPurchases.filter((p) =>
              p.purchase_items?.some((item) => item.inventory_id === inventoryId)
            );
            await Promise.all(
              relatedPurchases.map(async (purchase) => {
                const updatedItems = purchase.purchase_items
                  .filter((item) => item.inventory_id === inventoryId)
                  .map((item) => ({
                    id: item.id,
                    inventory_id: item.inventory_id,
                    unit_price: payload.purchase_unit_price!,
                  }));
                if (updatedItems.length > 0) {
                  await updatePurchase(purchase.id, { purchase_items: updatedItems }, token);
                }
              })
            );
          } catch {
            // 発注同期の失敗はログのみ（在庫更新自体は成功している）
          }
        }
        return result;
      }),

    getShaftSales: publicProcedure.query(async () => {
      return getShaftSales();
    }),

    upsertShaftSale: publicProcedure
      .input(z.object({
        inventoryId: z.number().int().positive().nullable().optional(),
        managementNo: z.string().min(1).max(200),
        title: z.string().min(1).max(500),
        category: z.string().max(200).nullable().optional(),
        quantity: z.number().int().min(1).default(1),
        unitPrice: z.number().nullable().optional(),
        saleAmount: z.number(),
        saleUrl: z.string().max(1000).nullable().optional(),
        profitAmount: z.number().nullable().optional(),
        soldAt: z.string().max(20).optional(),
        supplierName: z.string().max(200).nullable().optional(),
        supplierUrl: z.string().max(1000).nullable().optional(),
        snapshot: z.record(z.string(), z.unknown()).optional(),
      }))
      .mutation(async ({ input }) => {
        const sale = await upsertShaftSale({
          inventoryId: input.inventoryId ?? null,
          managementNo: input.managementNo.trim(),
          title: input.title.trim(),
          category: input.category ?? null,
          quantity: input.quantity,
          unitPrice: input.unitPrice == null ? null : String(input.unitPrice),
          saleAmount: String(input.saleAmount),
          saleUrl: input.saleUrl === undefined ? undefined : input.saleUrl,
          profitAmount: input.profitAmount == null ? null : String(input.profitAmount),
          soldAt: input.soldAt ?? new Intl.DateTimeFormat("en-CA", {
            timeZone: "Asia/Tokyo",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
          }).format(new Date()),
          supplierName: input.supplierName ?? null,
          supplierUrl: input.supplierUrl ?? null,
          snapshotJson: input.snapshot ? JSON.stringify(input.snapshot) : null,
        });
        return { success: true, sale };
      }),

    updateShaftSaleDate: publicProcedure
      .input(z.object({
        id: z.number().int().positive(),
        soldAt: z.string().min(1).max(20),
      }))
      .mutation(async ({ input }) => {
        const sale = await updateShaftSaleDate(input.id, input.soldAt);
        if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "シャフト売上が見つかりません" });
        return { success: true, sale };
      }),

    updateShaftSaleProfit: publicProcedure
      .input(z.object({
        id: z.number().int().positive(),
        profitAmount: z.number().nullable(),
      }))
      .mutation(async ({ input }) => {
        const sale = await updateShaftSaleProfit(
          input.id,
          input.profitAmount == null ? null : String(input.profitAmount),
        );
        if (!sale) throw new TRPCError({ code: "NOT_FOUND", message: "シャフト売上が見つかりません" });
        return { success: true, sale };
      }),

    /**
     * 仕入先名のみ更新（軽量プロシージャ）
     */
    updateSupplierNameOnly: publicProcedure
      .input(
        z.object({
          purchaseId: z.number().int().positive().optional(),
          inventoryId: z.number().int().positive(),
          supplierName: z.string().max(200).nullable(),
          supplierUrl: z.string().max(500).nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const normalizedSupplierUrl = (() => {
          const value = input.supplierUrl?.trim();
          if (!value) return null;
          return /^https?:\/\//i.test(value) ? value : `https://${value}`;
        })();
        if (!zaicoEnabled) {
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (localInv) {
            await updateLocalInventory(localInv.id, { supplierName: input.supplierName, supplierUrl: normalizedSupplierUrl });
          }
          const db = await getDb();
          if (db) {
            const { localPurchases: lpTbl } = await import("../../drizzle/schema");
            const purchaseRows = await getLocalPurchases();
            const targets = purchaseRows.filter((p) => {
              if (input.purchaseId && (p.id === input.purchaseId || p.zaicoId === input.purchaseId)) return true;
              if (localInv?.id && p.localInventoryId === localInv.id) return true;
              try {
                const items = JSON.parse(p.itemsJson ?? "[]");
                return Array.isArray(items) && items.some((item) => Number(item.inventory_id ?? item.inventoryId) === input.inventoryId);
              } catch {
                return false;
              }
            });
            await Promise.all(
              targets.map((p) => db.update(lpTbl).set({ supplierName: input.supplierName, supplierUrl: normalizedSupplierUrl }).where(eq(lpTbl.id, p.id)))
            );
          }
        } else {
          const existing = await getInventoryExtraByZaicoId(input.inventoryId);
          await upsertInventoryExtra({
            zaicoInventoryId: input.inventoryId,
            supplierName: input.supplierName,
            supplierUrl: normalizedSupplierUrl ?? existing?.supplierUrl ?? null,
          }).catch(() => {});
        }
        return { success: true };
      }),

    updateEbayListingUrl: publicProcedure
      .input(
        z.object({
          inventoryId: z.number().int().positive(),
          ebayListingUrl: z.string().max(1000).nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const normalizedUrl = normalizeListingUrl(input.ebayListingUrl);

        if (!zaicoEnabled) {
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (!localInv) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Inventory not found" });
          }
          if (getEbayStockType(localInv.etc) !== "stocked") {
            throw new TRPCError({ code: "BAD_REQUEST", message: "有在庫のeBay商品だけ出品ページを登録できます" });
          }
          await updateLocalInventory(localInv.id, { ebayListingUrl: normalizedUrl });
          return { success: true, ebayListingUrl: normalizedUrl };
        }

        const inv = await getInventory(input.inventoryId);
        if (getEbayStockType(inv.etc) !== "stocked") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "有在庫のeBay商品だけ出品ページを登録できます" });
        }
        const existing = await getInventoryExtraByZaicoId(input.inventoryId);
        await upsertInventoryExtra({
          zaicoInventoryId: input.inventoryId,
          supplierName: existing?.supplierName ?? null,
          supplierUrl: existing?.supplierUrl ?? null,
        }).catch(() => {});
        return { success: true, ebayListingUrl: normalizedUrl };
      }),

    updateEbayOrderUrl: publicProcedure
      .input(
        z.object({
          inventoryId: z.number().int().positive(),
          ebayOrderUrl: z.string().max(1000).nullable().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const normalizedUrl = normalizeListingUrl(input.ebayOrderUrl);

        if (!zaicoEnabled) {
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (!localInv) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Inventory not found" });
          }
          if (!isEbayManagementNo(localInv.etc)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "eBay管理番号の商品だけOrderページを登録できます" });
          }
          await updateLocalInventory(localInv.id, { ebayOrderUrl: normalizedUrl });
          return { success: true, ebayOrderUrl: normalizedUrl };
        }

        const inv = await getInventory(input.inventoryId);
        if (!isEbayManagementNo(inv.etc)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "eBay管理番号の商品だけOrderページを登録できます" });
        }
        return { success: true, ebayOrderUrl: normalizedUrl };
      }),

    updateEbayOrderStatus: publicProcedure
      .input(
        z.object({
          inventoryId: z.number().int().positive(),
          ebayOrderStatus: z.enum(["normal", "cancelled", "returned"]),
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const normalizedStatus = normalizeEbayOrderStatus(input.ebayOrderStatus);

        if (!zaicoEnabled) {
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (!localInv) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Inventory not found" });
          }
          if (!isEbayManagementNo(localInv.etc)) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "eBay管理番号の商品だけOrder状態を登録できます" });
          }
          await updateLocalInventory(localInv.id, { ebayOrderStatus: normalizedStatus });
          return { success: true, ebayOrderStatus: normalizedStatus };
        }

        const inv = await getInventory(input.inventoryId);
        if (!isEbayManagementNo(inv.etc)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "eBay管理番号の商品だけOrder状態を登録できます" });
        }
        return { success: true, ebayOrderStatus: normalizedStatus };
      }),

    updateCategoryOnly: publicProcedure
      .input(
        z.object({
          inventoryId: z.number().int().positive(),
          category: z.string().max(250).nullable(),
          operatorKey: z.enum(["default", "A", "B"]).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);
        const nextCategory = normalizeCategoryName(input.category);
        const localCategory = nextCategory || null;

        if (!zaicoEnabled) {
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (localInv) {
            await updateLocalInventory(localInv.id, { category: localCategory });
          }

          const db = await getDb();
          if (db) {
            const { localPurchases: lpTbl } = await import("../../drizzle/schema");
            const purchaseRows = await getLocalPurchases();
            const inventoryIds = new Set(
              [input.inventoryId, localInv?.id, localInv?.zaicoId]
                .filter((id): id is number => typeof id === "number")
                .map((id) => Number(id))
            );
            const targets = purchaseRows.filter((purchase) => {
              if (localInv?.id && purchase.localInventoryId === localInv.id) return true;
              try {
                const items = JSON.parse(purchase.itemsJson ?? "[]");
                return Array.isArray(items) && items.some((item) => inventoryIds.has(Number(item.inventory_id ?? item.inventoryId)));
              } catch {
                return false;
              }
            });

            await Promise.all(
              targets.map(async (purchase) => {
                const updateData: Partial<typeof lpTbl.$inferInsert> = { category: localCategory };
                try {
                  const items = JSON.parse(purchase.itemsJson ?? "[]");
                  if (Array.isArray(items)) {
                    let changed = false;
                    const nextItems = items.map((item) => {
                      if (!item || typeof item !== "object") return item;
                      const row = item as Record<string, unknown>;
                      const itemInventoryId = Number(row.inventory_id ?? row.inventoryId);
                      const matchesItem = inventoryIds.has(itemInventoryId);
                      const matchesSingleLocalPurchase = Boolean(localInv?.id && purchase.localInventoryId === localInv.id && items.length === 1);
                      if (!matchesItem && !matchesSingleLocalPurchase) return item;
                      changed = true;
                      return { ...row, category: localCategory };
                    });
                    if (changed) updateData.itemsJson = JSON.stringify(nextItems);
                  }
                } catch {
                  // Snapshot updates are best-effort; the row category remains authoritative.
                }
                await db.update(lpTbl).set(updateData).where(eq(lpTbl.id, purchase.id));
              })
            );
          }
          return { success: true };
        }

        const inv = await getInventory(input.inventoryId);
        await updateInventory(
          input.inventoryId,
          {
            title: inv.title,
            quantity: String(inv.quantity ?? 0),
            unit: inv.unit ?? undefined,
            category: nextCategory,
            place: inv.place ?? undefined,
            etc: inv.etc ?? undefined,
            purchase_unit_price: inv.purchase_unit_price ?? undefined,
          },
          operatorToken
        );
        return { success: true };
      }),

    // ============================================================
    // T22: 入庫仕訳・工程 mutations
    // ============================================================

    /**
     * 直取の相手名リスト等の設定を取得。UI（未仕訳ゲートの説明・設定画面）で使う。
     */
    getInboundConfig: publicProcedure.query(async () => {
      const directPartnerNames = await getDirectPartnerNames();
      return { directPartnerNames };
    }),

    /**
     * 直取の相手名リストを保存（カンマ区切りで蓄積）。設定で追加可能にする要件。
     */
    setDirectPartnerNames: publicProcedure
      .input(z.object({ names: z.array(z.string().max(100)).max(100) }))
      .mutation(async ({ input }) => {
        const cleaned = Array.from(
          new Set(input.names.map((n) => n.trim()).filter(Boolean)),
        );
        await setSystemSetting(DIRECT_PARTNER_NAMES_SETTING_KEY, cleaned.join(","));
        return { success: true, directPartnerNames: cleaned };
      }),

    /**
     * 分類を人間が手動で上書きする（未仕訳ゲートの確定ボタン／各行の分類変更）。
     * classSource=manual を立て、以降の自動再判定から保護する。
     * inboundClass=null を渡すと「未仕訳」に戻す（この場合 classSource=auto に戻し再判定に委ねる）。
     */
    setInboundClass: publicProcedure
      .input(z.object({
        purchaseId: z.number().int().positive(),
        inboundClass: z.enum(["ebay", "oregon", "direct", "domestic"]).nullable(),
      }))
      .mutation(async ({ input }) => {
        if (await isZaicoEnabled()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Zaico連携中は未対応です" });
        }
        const { localPurchases: lpTbl } = await import("../../drizzle/schema");
        const { eq, or } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const [lp] = await db
          .select()
          .from(lpTbl)
          .where(or(eq(lpTbl.id, input.purchaseId), eq(lpTbl.zaicoId, input.purchaseId)))
          .limit(1);
        if (!lp) throw new TRPCError({ code: "NOT_FOUND", message: "発注が見つかりません" });
        if (input.inboundClass == null) {
          // 未仕訳へ戻す: auto に戻して次回読み取りで再判定させる
          await setLocalPurchaseInboundClass(lp.id, null, "auto");
        } else {
          await setLocalPurchaseInboundClass(lp.id, input.inboundClass, "manual");
        }
        return { success: true };
      }),

    /**
     * 工程を1つ進める（「次の工程へ進む」ボタン）。
     * - 分類ごとの工程列に沿って現stage→次stageへ。
     * - 「登録」工程に入るとき status=purchased を連動（仕入れ観点の入庫済みと整合）。
     * - 最終工程なら以降は進めない（完了は行を残してグレー表示）。
     */
    advanceStage: publicProcedure
      .input(z.object({
        purchaseId: z.number().int().positive(),
        operatorName: z.string().max(200).optional(),
        /** 楽観ロック用（任意）: 想定している現在の工程。ズレていれば弾く */
        expectedStage: z.string().max(20).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (await isZaicoEnabled()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Zaico連携中は未対応です" });
        }
        const { localPurchases: lpTbl } = await import("../../drizzle/schema");
        const { eq, or } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const [lp] = await db
          .select()
          .from(lpTbl)
          .where(or(eq(lpTbl.id, input.purchaseId), eq(lpTbl.zaicoId, input.purchaseId)))
          .limit(1);
        if (!lp) throw new TRPCError({ code: "NOT_FOUND", message: "発注が見つかりません" });

        const inboundClass = (lp.inboundClass ?? null) as InboundClass | null;
        if (!inboundClass) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "先に分類を確定してください（未仕訳のままでは工程を進められません）" });
        }
        const currentStage = lp.stage ?? "received";
        if (input.expectedStage && input.expectedStage !== currentStage) {
          throw new TRPCError({ code: "CONFLICT", message: "工程が更新されています。画面を更新してください" });
        }
        const next = nextStage(inboundClass, currentStage);
        if (!next) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "すでに最終工程です" });
        }
        const updatedBy = (input.operatorName ?? "").trim() || ctx.user?.name || ctx.user?.email || null;
        // 「登録」工程に入るとき status=purchased を連動（既存completePurchaseと同義の入庫確定）
        const statusUpdate = isRegisterStage(next) ? "purchased" : undefined;
        const today = new Date().toISOString().slice(0, 10);
        await updateLocalPurchaseStage(lp.id, next, {
          updatedBy,
          status: statusUpdate,
          receivedDate: statusUpdate === "purchased" ? today : undefined,
        });
        return { success: true, stage: next };
      }),

    /**
     * シャフト分離（T22）。
     * eBay/オレゴンのゴルフヘッド行（親）の登録工程で実行し、
     * 「国内出品・発送待ち(domestic)」分類の新しい在庫行を生成する。
     * 親行はそのまま（ヘッド側の分類・工程を継続）。1荷物内の分類混在をこれで吸収する。
     */
    separateShaft: publicProcedure
      .input(z.object({
        purchaseId: z.number().int().positive(),
        title: z.string().max(500).optional(),
        quantity: z.number().int().min(1).max(999).optional(),
        managementNo: z.string().max(200).optional(),
        operatorName: z.string().max(200).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (await isZaicoEnabled()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Zaico連携中は未対応です" });
        }
        const { localPurchases: lpTbl } = await import("../../drizzle/schema");
        const { eq, or } = await import("drizzle-orm");
        const db = await getDb();
        if (!db) throw new Error("Database not available");
        const [parent] = await db
          .select()
          .from(lpTbl)
          .where(or(eq(lpTbl.id, input.purchaseId), eq(lpTbl.zaicoId, input.purchaseId)))
          .limit(1);
        if (!parent) throw new TRPCError({ code: "NOT_FOUND", message: "分離元の発注が見つかりません" });

        const parentClass = (parent.inboundClass ?? null) as InboundClass | null;
        if (parentClass !== "ebay" && parentClass !== "oregon") {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "シャフト分離はeBay/オレゴンの行でのみ実行できます",
          });
        }

        const qty = input.quantity ?? 1;
        const baseTitle = (input.title ?? "").trim() || `${parent.title ?? "シャフト"}（シャフト）`;
        const shaftManagementNo = (input.managementNo ?? "").trim()
          || `${parent.managementNo ?? "シャフト"}-S`;
        const updatedBy = (input.operatorName ?? "").trim() || ctx.user?.name || ctx.user?.email || null;

        // 国内(domestic)の新規在庫行を作成。分類は manual 固定（自動再判定で消さない）。
        // 工程は domestic の先頭「登録(registered)」から開始。
        const newId = await insertLocalPurchase({
          zaicoId: null,
          purchaseNum: shaftManagementNo,
          status: "ordered",
          itemsJson: JSON.stringify([{
            id: 0,
            inventory_id: parent.localInventoryId ?? null,
            title: baseTitle,
            quantity: String(qty),
            unit_price: null,
            etc: shaftManagementNo,
            status: "ordered",
            category: parent.category ?? null,
          }]),
          localInventoryId: null,
          title: baseTitle,
          category: parent.category ?? null,
          quantity: qty,
          unitPrice: null,
          managementNo: shaftManagementNo,
          purchaseDate: parent.purchaseDate ?? null,
          receivedDate: null,
          supplierUrl: parent.supplierUrl ?? null,
          supplierName: parent.supplierName ?? null,
          inboundClass: "domestic",
          classSource: "manual",
          stage: "registered",
          stageUpdatedBy: updatedBy,
          stageUpdatedAt: new Date(),
          shaftParentPurchaseId: parent.id,
        });

        return { success: true, newPurchaseId: newId };
      }),

    /**
     * 発注済み（ordered）ステータスで入庫データを新規作成
     * POST /api/v1/purchases/
     */
    getNextPurchaseNum: publicProcedure
      .query(async () => {
        const allPurchases = await getLocalPurchases();
        const maxNum = allPurchases.reduce((max, p) => {
          const n = parseInt(p.purchaseNum ?? "0", 10);
          return Number.isFinite(n) && n > max ? n : max;
        }, 0);
        return { nextNum: maxNum + 1 };
      }),

    createOrderedPurchase: publicProcedure
      .input(
        z.object({
          inventoryId: z.number().int().positive(),
          title: z.string().min(1),
          quantity: z.number().positive("数量は1以上にしてください"),
          unitPrice: z.number().optional(),
          customerName: z.string().optional(),
          supplierName: z.string().nullable().optional(),
          supplierUrl: z.string().nullable().optional(),
          num: z.string().optional(),
          estimatedPurchaseDate: z.string().optional(),
          memo: z.string().optional(),
          managementNo: z.string().optional(),
          operatorKey: z.enum(["default", "A", "B"]).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBに発注データを作成
          // 最大の発注Noを取得して+1する
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          const allPurchases = await getLocalPurchases();
          const linkedInventoryId = localInv?.id ?? input.inventoryId;
          const managementNo = input.managementNo?.trim() || null;
          const supplierName =
            input.supplierName !== undefined
              ? input.supplierName?.trim() || null
              : input.customerName?.trim() || localInv?.supplierName || null;
          const supplierUrl =
            input.supplierUrl !== undefined
              ? input.supplierUrl?.trim() || null
              : localInv?.supplierUrl ?? null;
          const unitPrice =
            input.unitPrice != null
              ? input.unitPrice
              : localInv?.unitPrice != null
                ? Number(localInv.unitPrice)
                : undefined;
          const maxNum = allPurchases.reduce((max, p) => {
            const n = parseInt(p.purchaseNum ?? "0", 10);
            return n > max ? n : max;
          }, 0);
          const newNum = String(maxNum + 1);
          const existing = managementNo
            ? allPurchases.find((purchase) => getInventoryManagementNo(purchase.managementNo) === managementNo)
            : undefined;
          if (localInv && unitPrice != null && Number.isFinite(unitPrice)) {
            await updateLocalInventory(localInv.id, {
              unitPrice: String(unitPrice),
              supplierName: supplierName ?? localInv.supplierName,
              supplierUrl: supplierUrl ?? localInv.supplierUrl,
            });
          }
          const purchaseData = {
            purchaseNum: input.num ?? existing?.purchaseNum ?? newNum,
            status: "ordered",
            itemsJson: JSON.stringify([{
              id: 0,
              title: input.title,
              quantity: String(input.quantity),
              unit_price: unitPrice ?? null,
              etc: managementNo,
              status: "ordered",
              inventory_id: linkedInventoryId,
              inventoryId: linkedInventoryId,
            }]),
            localInventoryId: linkedInventoryId,
            title: input.title,
            category: localInv?.category ?? null,
            quantity: input.quantity,
            unitPrice: unitPrice != null && Number.isFinite(unitPrice) ? String(unitPrice) : null,
            managementNo,
            purchaseDate: input.estimatedPurchaseDate ?? null,
            receivedDate: null,
            supplierUrl,
            supplierName,
          };
          const purchaseId = existing
            ? (await updateLocalPurchase(existing.id, purchaseData), existing.id)
            : await insertLocalPurchase({
                zaicoId: null,
                ...purchaseData,
                inboundClass: null,
                classSource: "auto",
                stage: "ordered",
                stageUpdatedBy: "ui",
                stageUpdatedAt: new Date(),
                shaftParentPurchaseId: null,
              });
          if (purchaseId > 0) {
            await ensureInventoryItemLabels({
              purchaseId,
              localInventoryId: linkedInventoryId,
              legacyManagementNo: managementNo,
              title: input.title,
              quantity: input.quantity,
              status: "ordered",
              sourceKey: managementNo ? `management:${managementNo}` : `purchase:${purchaseId}`,
            });
          }
          return { code: 200, status: "ok", message: "発注データを登録しました（ローカルDB）", data_id: purchaseId };
        }

        const token = resolveOperatorToken(input.operatorKey);
        const payload = {
          status: "ordered" as const,
          customer_name: input.customerName ?? input.supplierName ?? undefined,
          num: input.num,
          memo: input.memo,
          purchase_items: [
            {
              inventory_id: input.inventoryId,
              quantity: input.quantity,
              unit_price: input.unitPrice,
              estimated_purchase_date: input.estimatedPurchaseDate,
              etc: input.managementNo,
            },
          ],
        };
        return createPurchase(payload, token);
      }),

    /**
     * まとめて出庫処理
     */
    createDelivery: publicProcedure
      .input(
        z.object({
          deliveryNo: z.string().min(1, "出庫Noを入力してください"),
          deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          items: z.array(
            z.object({
              inventoryId: z.number().int().positive(),
              title: z.string(),
              quantity: z.number().positive("出庫数量は1以上にしてください"),
              unitPrice: z.number().optional(),
              tradeRecordId: z.number().int().positive().nullable().optional(),
              csvProductName: z.string().nullable().optional(),
              labelId: z.string().min(1).max(80).optional(),
            })
          ).min(1, "出庫する商品を選択してください"),
          // FedEx発送情報（任意）
          trackingNumber: z.string().optional(),
          sheetName: shipmentSheetNameSchema.optional(),
          invoiceNo: z.string().optional(), // CSV商品集計用のインボイスNo
          operatorName: z.string().max(200).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const deliveryResult = await processInventoryDelivery(input);
        const historyItems = deliveryResult.historyItems;
        const zaicoResult = deliveryResult.zaicoDeliveryId
          ? { data_id: deliveryResult.zaicoDeliveryId }
          : null;
        // FedEx発送情報が入力された場合は発送登録も行う
        let fedexResult: { success: boolean; message: string } | null = null;
        if (input.trackingNumber && input.sheetName) {
          try {
            // 発送日：当日日付を M/D 形式で自動設定
            const now = new Date();
            const shippingDate = `${now.getMonth() + 1}/${now.getDate()}`;

            // インボイスNoを導出（入力値を優先し、出庫Noから抽出できる場合のみ補完）
            const invoiceNo = input.invoiceNo ?? invoiceNoPrefixFromDeliveryNo(input.deliveryNo) ?? input.deliveryNo;

            // CSV商品データを取得して商品集計
            let csvProducts: Array<{ tradeRecordId: number | null; name: string; qty: number }> = [];
            try {
              for (const row of await getOrderRowsFromTradeRecords()) {
                const csvInvoiceNo = row.invoiceNo;
                if (csvInvoiceNo !== invoiceNo) continue;
                const productName = row.productName;
                const orderQty = row.orderQty;
                if (productName) csvProducts.push({ tradeRecordId: row.tradeRecordId, name: productName, qty: orderQty });
              }
            } catch { /* CSV取得失敗時は商品名直接使用 */ }

            // 出庫商品を、保存済みの注文行または共通マッチングでCSV商品へ集計する
            const aggregated: Map<string, { productNameJa: string; productNameEn: string; quantity: number; labelId?: string }> = new Map();
            const addAggregatedItem = (name: string, quantity: number, labelId?: string) => {
              const productName = name.trim() || "未分類";
              const normalizedLabelId = labelId?.trim().toUpperCase();
              const key = normalizedLabelId ? `${productName}\u0000${normalizedLabelId}` : productName;
              const existing = aggregated.get(key);
              if (existing) existing.quantity += quantity;
              else aggregated.set(key, { productNameJa: productName, productNameEn: productName, quantity, ...(normalizedLabelId ? { labelId: normalizedLabelId } : {}) });
            };

            for (let itemIndex = 0; itemIndex < input.items.length; itemIndex += 1) {
              const item = input.items[itemIndex];
              const historyItem = historyItems[itemIndex];
              const managementNo = historyItem && "managementNo" in historyItem ? String(historyItem.managementNo ?? "") : "";

              if (item.csvProductName !== undefined) {
                if (item.csvProductName !== null) {
                  addAggregatedItem(item.csvProductName, item.quantity, item.labelId);
                } else {
                  const suggestionName = csvProducts.length > 0
                    ? suggestCsvProductNameFromHints(item.title, extractManagementHints(managementNo, item.title), csvProducts)
                    : null;
                  addAggregatedItem(suggestionName ?? item.title, item.quantity, item.labelId);
                }
                continue;
              }

              if (item.tradeRecordId) {
                const product = csvProducts.find((cp) => cp.tradeRecordId === item.tradeRecordId);
                if (product) {
                  addAggregatedItem(product.name, item.quantity, item.labelId);
                  continue;
                }
              }

              const suggestionName = csvProducts.length > 0
                ? suggestCsvProductNameFromHints(item.title, extractManagementHints(managementNo, item.title), csvProducts)
                : null;
              addAggregatedItem(suggestionName ?? item.title, item.quantity, item.labelId);
            }
            const fedexItems = Array.from(aggregated.values());

            // DBに発送記録を保存
            const fedexId = await createFedexShipment({
              deliveryNo: input.deliveryNo,
              sheetName: input.sheetName,
              shippingDate,
              trackingNumber: input.trackingNumber,
              itemsJson: JSON.stringify(fedexItems),
              spreadsheetStatus: "pending",
              operatorName: resolveWorkOperatorName(input.operatorName, "delivery-form"),
              historyId: deliveryResult.historyId,
            });
            await recordWorkLog({
              workerName: resolveWorkOperatorName(input.operatorName, "野田"),
              category: "FedEx発送登録",
              status: "done",
              startedAt: new Date(),
              endedAt: new Date(),
              quantity: sumWorkQuantity(fedexItems),
              memo: `出庫No: ${input.deliveryNo} / 追跡番号: ${input.trackingNumber}`,
              createdBy: resolveWorkOperatorName(input.operatorName, "出庫登録"),
              sourceType: "fedex",
              sourceId: `${input.deliveryNo}:${input.trackingNumber}`,
              detailsJson: JSON.stringify({
                deliveryNo: input.deliveryNo,
                sheetName: input.sheetName,
                shippingDate,
                trackingNumber: input.trackingNumber,
                items: fedexItems,
              }),
            });

            // GAS Webhookでスプシに書き込む
            const gasUrl = process.env.GAS_WEBHOOK_URL;
            if (gasUrl) {
              const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
              const gasPayload = {
                secret,
                action: "writeShipmentBatch",
                deliveryNo: input.deliveryNo,
                invoiceNo,
                sheetName: input.sheetName,
                shippingDate,
                trackingNumber: input.trackingNumber,
                items: fedexItems,
              };
              const res0 = await fetch(gasUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(gasPayload),
                redirect: "manual",
              });
              let text: string;
              if (res0.status === 302 || res0.status === 301) {
                const redirectUrl = res0.headers.get("location") ?? gasUrl;
                const res0r = await fetch(redirectUrl, { method: "GET" });
                text = await res0r.text();
              } else {
                text = await res0.text();
              }
              let gasResult: { success: boolean; message?: string };
              try { gasResult = JSON.parse(text); } catch { gasResult = { success: false, message: text }; }
              if (gasResult.success) {
                await updateFedexShipmentStatus(fedexId, "success");
                fedexResult = { success: true, message: "スプシへの書き込みが完了しました" };
              } else {
                await updateFedexShipmentStatus(fedexId, "error", gasResult.message ?? "不明なエラー");
                fedexResult = { success: false, message: gasResult.message ?? "スプシへの書き込みに失敗しました" };
              }
            } else {
              await updateFedexShipmentStatus(fedexId, "error", "GAS_WEBHOOK_URLが未設定");
              fedexResult = { success: false, message: "GAS_WEBHOOK_URLが未設定です" };
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            fedexResult = { success: false, message: `FedEx登録エラー: ${msg}` };
          }
        }

        return { success: true, zaicoDeliveryId: zaicoResult?.data_id, fedexResult };
      }),
  }),

  // ============================================================
  // 入庫履歴
  // ============================================================
  purchaseHistory: router({
    list: publicProcedure
      .input(z.object({ limit: z.number().int().positive().max(500).default(200) }))
      .query(async ({ input }) => {
        const histories = await getPurchaseHistories(input.limit);
        const localPurchases = await getLocalPurchases().catch((error) => {
          console.warn("[purchaseHistory.list] failed to load local purchases for enrichment:", error);
          return [] as LocalPurchaseRow[];
        });
        const localLookup = buildLocalPurchaseHistoryLookup(localPurchases);
        try {
          const recovered = await getRecoveredPurchaseHistoriesFromLabels(histories, input.limit);
          return collapsePurchaseHistoryRows([...histories, ...recovered].map((row) => enrichPurchaseHistoryRow(row, localLookup)))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, input.limit);
        } catch (error) {
          console.warn("[purchaseHistory.list] failed to recover QR inbound histories:", error);
          return collapsePurchaseHistoryRows(histories.map((row) => enrichPurchaseHistoryRow(row, localLookup)))
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, input.limit);
        }
      }),

    cancel: publicProcedure
      .input(z.object({
        id: z.number().int().positive(),
        purchaseId: z.number().int().positive(),
        purchaseItems: z.array(
          z.object({
            inventory_id: z.number().int().positive(),
            quantity: z.union([z.string(), z.number()]).transform(String),
            unit_price: z.union([z.string(), z.number()]).transform(String),
          })
        ),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
        // 新規発注データ作成用の追加情報
        kanriNo: z.string().optional(),
        title: z.string().optional(),
        category: z.string().optional(),
        supplier: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBの入庫取り消し
          // Step1: 入庫済みの発注をorderedに戺す
          const localPurchaseRows = await getLocalPurchases();
          const localPurchase = localPurchaseRows.find(
            (p) => p.zaicoId === input.purchaseId || p.id === input.purchaseId
          );
          if (localPurchase && localPurchase.status === "purchased") {
            await updateLocalPurchaseStatus(localPurchase.id, "ordered");
          }
          // Step2: 在庫数を入庫数量分減算する
          for (const item of input.purchaseItems) {
            const localInv = await getLocalInventoryByZaicoIdOrId(item.inventory_id);
            if (localInv) {
              const subQty = parseInt(item.quantity, 10) || 1;
              const newQty = Math.max(0, (localInv.quantity ?? 0) - subQty);
              await updateLocalInventory(localInv.id, { quantity: newQty });
            }
          }
          // Step3: DBの履歴を取り消し済みに更新
          await cancelPurchaseHistory(input.id);
          return { success: true };
        }

        // Zaico連携ON: 従来の処理
        // Step1: 元の発注データ情報を保存しておく（削除後に新規発注データを作成するため）
        const originalPurchase = await getPurchaseById(input.purchaseId, operatorToken);

        // Step2: Zaicoの入庫データを削除する
        // 入庫済みの場合、Zaico側で自動的に在庫数が入庫数量分だけ減算される
        try {
          await deletePurchase(input.purchaseId, operatorToken);
        } catch (e) {
          console.error(`[cancel] deletePurchase failed:`, e);
          throw e; // 入庫削除失敗時は処理を中断する
        }

        // Step3: 新規発注データ（orderedステータス）をZaicoに作成する
        try {
          const newPurchaseNum = await getMaxPurchaseNum(operatorToken);
          await createPurchase({
            num: String(newPurchaseNum + 1),
            customer_name: originalPurchase?.customer_name ?? (input.supplier ?? ""),
            status: "ordered",
            memo: originalPurchase?.memo,
            etc: originalPurchase?.etc,
            purchase_items: input.purchaseItems.map((item) => ({
              inventory_id: item.inventory_id,
              quantity: parseInt(item.quantity, 10) || 1,
              unit_price: parseFloat(item.unit_price) || undefined,
            })),
          }, operatorToken);
        } catch (e) {
          console.error(`[cancel] createPurchase failed:`, e);
        }

        // Step4: DBの履歴を取り消し済みに更新
        await cancelPurchaseHistory(input.id);
        return { success: true };
      }),
  }),

  // ============================================================
  // 受取連絡チェック
  // ============================================================
  receiptAck: router({
    summary: publicProcedure.query(async () => {
      return getReceiptAckSummary();
    }),

    markDone: publicProcedure
      .input(z.object({ purchaseId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        return markReceiptAckDone(input.purchaseId);
      }),
  }),

  // ============================================================
  // 入庫補足情報（発送日・追跡番号）
  // ============================================================
  purchaseExtra: router({
    upsert: publicProcedure
      .input(
        z.object({
          zaicoId: z.number().int().positive(),
          shipDate: z.string().nullable().optional(),
          trackingNumber: z.string().max(200).nullable().optional(),
          carrier: z.string().max(50).nullable().optional(),
          note: z.string().nullable().optional(),
          inventoryId: z.number().int().positive().optional(),
          managementNo: z.string().max(200).optional(),
          labelId: z.string().max(20).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const operatorName = resolveWorkOperatorName(undefined, ctx.user?.name ?? ctx.user?.email ?? null);
        const auditInput: PurchaseTrackingSyncInput = {
          ...input,
          operatorName,
          createdBy: ctx.user?.email ?? operatorName,
        };
        const zaicoEnabled = await isZaicoEnabled();
        if (!zaicoEnabled) {
          const syncResult = await syncLocalPurchaseTrackingFromExtra(auditInput);
          assertLocalPurchaseTrackingSynced(auditInput, syncResult.updatedCount);
          return { success: true, localUpdatedCount: syncResult.updatedCount };
        }
        const trackingUpdate = buildPurchaseTrackingUpdate(auditInput);
        if (Object.keys(trackingUpdate).length > 0) {
          await upsertPurchaseExtra({ zaicoId: input.zaicoId, ...trackingUpdate });
          if (input.inventoryId && input.inventoryId !== input.zaicoId) {
            await upsertPurchaseExtra({ zaicoId: input.inventoryId, ...trackingUpdate });
          }
        }
        const syncResult = await syncLocalPurchaseTrackingFromExtra(auditInput);
        return { success: true, localUpdatedCount: syncResult.updatedCount };
      }),
    upsertBulk: publicProcedure
      .input(
        z.object({
          zaicoIds: z.array(z.number().int().positive()).min(1).max(100),
          shipDate: z.string().nullable().optional(),
          trackingNumber: z.string().max(200).nullable().optional(),
          carrier: z.string().max(50).nullable().optional(),
          note: z.string().nullable().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const operatorName = resolveWorkOperatorName(undefined, ctx.user?.name ?? ctx.user?.email ?? null);
        const auditBase: Omit<PurchaseTrackingSyncInput, "zaicoId"> = {
          operatorName,
          createdBy: ctx.user?.email ?? operatorName,
        };
        if (Object.prototype.hasOwnProperty.call(input, "shipDate")) auditBase.shipDate = input.shipDate;
        if (Object.prototype.hasOwnProperty.call(input, "trackingNumber")) auditBase.trackingNumber = input.trackingNumber;
        if (Object.prototype.hasOwnProperty.call(input, "carrier")) auditBase.carrier = input.carrier;
        if (Object.prototype.hasOwnProperty.call(input, "note")) auditBase.note = input.note;
        const trackingUpdate = buildPurchaseTrackingUpdate({ zaicoId: input.zaicoIds[0], ...auditBase });
        const zaicoEnabled = await isZaicoEnabled();
        if (!zaicoEnabled) {
          const syncResults = await Promise.all(input.zaicoIds.map((zaicoId) => syncLocalPurchaseTrackingFromExtra({ ...auditBase, zaicoId })));
          const localUpdatedCount = syncResults.reduce((sum, result) => sum + result.updatedCount, 0);
          assertLocalPurchaseTrackingSynced({ ...auditBase, zaicoId: input.zaicoIds[0] }, localUpdatedCount);
          return { success: true, count: input.zaicoIds.length, localUpdatedCount };
        }
        await Promise.all(
          Object.keys(trackingUpdate).length > 0
            ? input.zaicoIds.map((zaicoId) =>
                upsertPurchaseExtra({ zaicoId, ...trackingUpdate })
              )
            : []
        );
        const syncResults = await Promise.all(input.zaicoIds.map((zaicoId) => syncLocalPurchaseTrackingFromExtra({ ...auditBase, zaicoId })));
        const localUpdatedCount = syncResults.reduce((sum, result) => sum + result.updatedCount, 0);
        return { success: true, count: input.zaicoIds.length, localUpdatedCount };
      }),
  }),
  // ============================================================
  // 出庫履歴
  // ============================================================
  deliveryHistory: router({
    list: publicProcedure
      .input(z.object({ limit: z.number().int().positive().max(500).default(100) }))
      .query(async ({ input }) => {
        const histories = await getDeliveryHistories(input.limit);
        return histories.map((h) => ({
          ...h,
          items: JSON.parse(h.itemsJson) as Array<{
            inventoryId: number;
            title: string;
            quantity: number;
          }>,
          deletedInventoryIds: h.deletedInventoryIdsJson
            ? (JSON.parse(h.deletedInventoryIdsJson) as number[])
            : [],
          cancelledItems: h.cancelledItemsJson
            ? (JSON.parse(h.cancelledItemsJson) as Array<{ inventoryId: number; quantity: number; cancelledAt: string }>)
            : [],
        }));
      }),
    listByInvoicePrefix: publicProcedure
      .input(z.object({ invoiceNo: z.string().min(1) }))
      .query(async ({ input }) => {
        const histories = await getDeliveryHistoriesByInvoicePrefix(input.invoiceNo);
        return histories.map((h) => ({
          ...h,
          items: JSON.parse(h.itemsJson) as Array<{
            inventoryId: number;
            title: string;
            quantity: number;
          }>,
        }));
      }),
    markDeleted: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        deletedIds: z.array(z.number().int()),
      }))
      .mutation(async ({ input }) => {
        await markDeliveryItemsDeleted(input.historyId, input.deletedIds);
        return { ok: true };
      }),
    updateDeliveryNo: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        zaicoDeliveryId: z.number().int().positive().nullable(),
        deliveryNo: z.string(),
      }))
      .mutation(async ({ input }) => {
        // DBの出庫Noを更新
        await updateDeliveryNo(input.historyId, input.deliveryNo);
        // Zaico APIにも反映（zaicoDeliveryIdがある場合のみ）
        if ((await isZaicoEnabled()) && input.zaicoDeliveryId) {
          await updateDeliveryNum(input.zaicoDeliveryId, input.deliveryNo);
        }
        return { ok: true };
      }),
    /**
     * 出庫Noを一括更新する（複数履歴をまとめて変更）
     */
    bulkUpdateDeliveryNo: publicProcedure
      .input(z.object({
        historyIds: z.array(z.number().int().positive()).min(1),
        deliveryNo: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        for (const historyId of input.historyIds) {
          await updateDeliveryNo(historyId, input.deliveryNo);
        }
        return { ok: true, updatedCount: input.historyIds.length };
      }),
    /**
     * 商品単位で出庫Noを変更する
     * 指定した出庫履歴から商品（inventoryIdで指定）を分離し、新しい出庫Noの出庫履歴を新規作成する
     * - 元の出庫履歴から対象商品を除去（残りの商品が0になれば元履歴も削除）
     * - 新しい出庫Noで新規出庫履歴を作成（zaicoDeliveryIdは新規登録なし、status=success）
     */
    moveItemsToDeliveryNo: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        inventoryIds: z.array(z.number().int().positive()).min(1),
        newDeliveryNo: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        // 元の出庫履歴を取得
        const history = await getDeliveryHistoryById(input.historyId);
        if (!history) throw new Error("出庫履歴が見つかりません");

        const allItems: Array<{ inventoryId: number; title: string; quantity: number }> =
          JSON.parse(history.itemsJson);

        // 対象商品と残りの商品に分割
        const moveSet = new Set(input.inventoryIds);
        const movedItems = allItems.filter((item) => moveSet.has(item.inventoryId));
        const remainingItems = allItems.filter((item) => !moveSet.has(item.inventoryId));

        if (movedItems.length === 0) throw new Error("対象商品が見つかりません");

        // 元の出庫履歴を更新（残りの商品が0なら履歴を削除、それ以外はitemsJsonを更新）
        if (remainingItems.length === 0) {
          await deleteDeliveryHistoryById(input.historyId);
        } else {
          await updateDeliveryHistoryItemsJson(input.historyId, JSON.stringify(remainingItems));
        }

        // 移動先の出庫Noに既存の出庫履歴があればマージ、なければ新規作成
        const existingHistories = await getDeliveryHistoriesByDeliveryNo(input.newDeliveryNo);
        let targetHistoryId: number | null = null;
        if (existingHistories.length > 0) {
          // 既存行にマージ（同じinventoryIdがあれば数量を加算）
          const existHistory = existingHistories[0];
          const existItems: Array<{ inventoryId: number; title: string; quantity: number }> =
            JSON.parse(existHistory.itemsJson);
          const mergedMap = new Map<number, { inventoryId: number; title: string; quantity: number }>();
          for (const item of existItems) mergedMap.set(item.inventoryId, { ...item });
          for (const item of movedItems) {
            if (mergedMap.has(item.inventoryId)) mergedMap.get(item.inventoryId)!.quantity += item.quantity;
            else mergedMap.set(item.inventoryId, { ...item });
          }
          await updateDeliveryHistoryItemsJson(existHistory.id, JSON.stringify(Array.from(mergedMap.values())));
          targetHistoryId = existHistory.id;
        } else {
          // 新規作成
          await createDeliveryHistory({
            deliveryNo: input.newDeliveryNo,
            zaicoDeliveryId: null,
            itemsJson: JSON.stringify(movedItems),
            status: "success",
            errorMessage: null,
            deletedInventoryIdsJson: null,
            cancelledItemsJson: null,
          });
          // 新規作成した履歴のIDを取得
          const newHistories = await getDeliveryHistoriesByDeliveryNo(input.newDeliveryNo);
          targetHistoryId = newHistories[0]?.id ?? null;
        }

        // 追跡番号引き継ぎ: 移動元historyIdに紐付くfedex_shipmentsを移動先historyIdに更新
        if (targetHistoryId !== null) {
          const srcFedexByHistory = await getFedexShipmentsByHistoryId(input.historyId);
          for (const shipment of srcFedexByHistory) {
            await updateFedexShipmentHistoryAndDeliveryNo(shipment.id, targetHistoryId, input.newDeliveryNo);
          }
        }

        // GAS自動反映: 元の出庫Noと移動先の出庫Noに紐付くfedex_shipmentsを更新
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
        const gasResults: Array<{ trackingNumber: string; success: boolean; message?: string }> = [];

        if (gasUrl) {
          // 元出庫Noに紐付くfedex_shipmentsを取得（historyIdまたはdeliveryNoで紐付）
          const srcShipments = await getFedexShipmentsByDeliveryNo(history.deliveryNo);
          const srcByHistoryId = history.id ? await getFedexShipmentsByHistoryId(input.historyId) : [];
          const srcAll = Array.from(new Map([...srcShipments, ...srcByHistoryId].map((s) => [s.id, s])).values());

          // 移動先出庫Noに紐付くfedex_shipmentsを取得
          const dstShipments = await getFedexShipmentsByDeliveryNo(input.newDeliveryNo);
          const dstByHistoryId = targetHistoryId ? await getFedexShipmentsByHistoryId(targetHistoryId) : [];
          const dstAll = Array.from(new Map([...dstShipments, ...dstByHistoryId].map((s) => [s.id, s])).values());

          // 各追跡番号についてスプシを再書き込み
          const allAffected = Array.from(new Map([...srcAll, ...dstAll].map((s) => [s.id, s])).values());
          const trackingGroups = new Map<string, typeof allAffected[0]>();
          for (const s of allAffected) {
            if (!trackingGroups.has(s.trackingNumber)) trackingGroups.set(s.trackingNumber, s);
          }

          for (const [trackingNumber, shipment] of Array.from(trackingGroups.entries())) {
            try {
              // 削除
              const delPayload = { secret, action: "deleteShipmentBatch", sheetName: shipment.sheetName, trackingNumber };
              const delRes = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(delPayload), redirect: "manual" });
              if (delRes.status === 302 || delRes.status === 301) { const loc = delRes.headers.get("location") ?? gasUrl; await fetch(loc, { method: "GET" }); }

              // 再書き込み（同じ追跡番号の全記録を取得して合算）
              const allSameTracking = allAffected.filter((s) => s.trackingNumber === trackingNumber);
              type GasItem = { productNameJa: string; productNameEn: string; quantity: number };
              const mergedGasMap = new Map<string, GasItem>();
              for (const s of allSameTracking) {
                let items: GasItem[] = [];
                try { items = JSON.parse(s.itemsJson); } catch { items = []; }
                for (const item of items) {
                  if (mergedGasMap.has(item.productNameJa)) mergedGasMap.get(item.productNameJa)!.quantity += item.quantity;
                  else mergedGasMap.set(item.productNameJa, { ...item });
                }
              }
              const mergedGasItems = Array.from(mergedGasMap.values());
              const invoiceNo = invoiceNoFromDeliveryNo(shipment.deliveryNo);
              const writePayload = { secret, action: "writeShipmentBatch", deliveryNo: shipment.deliveryNo, invoiceNo, sheetName: shipment.sheetName, shippingDate: shipment.shippingDate, trackingNumber, items: mergedGasItems };
              const writeRes = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(writePayload), redirect: "manual" });
              let writeText: string;
              if (writeRes.status === 302 || writeRes.status === 301) { const loc = writeRes.headers.get("location") ?? gasUrl; const r2 = await fetch(loc, { method: "GET" }); writeText = await r2.text(); }
              else { writeText = await writeRes.text(); }
              let writeResult: { success: boolean; message?: string };
              try { writeResult = JSON.parse(writeText); } catch { writeResult = { success: false, message: writeText }; }
              gasResults.push({ trackingNumber, success: writeResult.success, message: writeResult.message });
              // スプシ書き込みステータスを更新
              for (const s of allSameTracking) {
                await updateFedexShipmentStatus(s.id, writeResult.success ? "success" : "error", writeResult.success ? undefined : (writeResult.message ?? "不明なエラー"));
              }
            } catch (e) {
              gasResults.push({ trackingNumber, success: false, message: e instanceof Error ? e.message : String(e) });
            }
          }
        }

        return {
          ok: true,
          movedCount: movedItems.length,
          remainingCount: remainingItems.length,
          merged: existingHistories.length > 0,
          gasResults,
        };
      }),
    /**
     * 出庫取り消し（個別）
     * 指定した出庫履歴内の1商品分の出庫を取り消すす
     *
     * 出庫履歴に zaicoDeliveryId がある場合：
     *   - 出庫商品が1商品のみ → Zaico出庫データを削除（Zaico側で在庫数自動復元）
     *   - 出庫商品が複数 → Zaico在庫数を直接増加（出庫データ全体を削除すると他商品も取り消されるため）
     * zaicoDeliveryId がない場合： Zaico在庫数を直接増加
     */
    cancelItem: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        inventoryId: z.number().int().positive(),
        quantity: z.number().int().positive(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);

        // Step1: 出庫履歴を取得して取り消し済みかチェック
        const history = await getDeliveryHistoryById(input.historyId);
        if (!history) throw new Error("出庫履歴が見つかりません");

        const cancelledItems: Array<{ inventoryId: number; quantity: number; cancelledAt: string }> =
          history.cancelledItemsJson ? JSON.parse(history.cancelledItemsJson) : [];

        // 既に取り消し済みかチェック
        const alreadyCancelled = cancelledItems.some((c) => c.inventoryId === input.inventoryId);
        if (alreadyCancelled) throw new Error("この商品は既に取り消し済みです");

        const allItems = JSON.parse(history.itemsJson) as Array<{ inventoryId: number; title: string; quantity: number }>;
        const notCancelledItems = allItems.filter((item) =>
          !cancelledItems.some((c) => c.inventoryId === item.inventoryId)
        );
        const isSingleItem = notCancelledItems.length === 1 && notCancelledItems[0].inventoryId === input.inventoryId;

        let newQty: number | undefined;

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBの在庫数を直接増加
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (localInv) {
            newQty = (localInv.quantity ?? 0) + input.quantity;
            await updateLocalInventory(localInv.id, { quantity: newQty });
          }
        } else if (history.zaicoDeliveryId && isSingleItem) {
          // 取り消し対象が1商品のみの場合：Zaico出庫データを削除（Zaico側で在庫数自動復元）
          await deleteDelivery(history.zaicoDeliveryId, operatorToken);
          // 復元後の在庫数を取得して返却値に使用
          const inv = await getInventory(input.inventoryId);
          newQty = Math.floor(parseFloat(inv.quantity ?? "0"));
        } else {
          // 複数商品またはzaicoDeliveryIdなしの場合：在庫数を直接増加
          const inv = await getInventory(input.inventoryId);
          const currentQty = Math.floor(parseFloat(inv.quantity ?? "0"));
          newQty = currentQty + input.quantity;
          await updateInventory(
            input.inventoryId,
            {
              title: inv.title,
              quantity: String(newQty),
              unit: inv.unit,
              category: inv.categories?.[0] ?? inv.category,
              place: inv.place,
              etc: inv.etc,
            },
            operatorToken
          );
        }

        // Step4: DBの取り消し済みリストを更新
        const updatedCancelledItems = [
          ...cancelledItems,
          { inventoryId: input.inventoryId, quantity: input.quantity, cancelledAt: new Date().toISOString() },
        ];
        await updateDeliveryCancelledItems(input.historyId, updatedCancelledItems);

        return { success: true, newQuantity: newQty };
      }),

    /**
     * 出庫取り消し（一括）
     * 指定した出庫履歴内の複数商品の出庫を一括取り消しする
     *
     * 全商品を選択した場合： Zaico出庫データを削除（Zaico側で全商品の在庫数自動復元）
     * 一部商品のみ選択した場合： 各商品のZaico在庫数を直接増加
     */
    /**
     * 出庫履歴グループを一括削除
     * - 出庫No内の全商品をZaicoから削除
     * - DBの出庫履歴レコードを削除
     */
    deleteGroup: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        inventoryIds: z.array(z.number().int().positive()),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);
        const results: Array<{ inventoryId: number; success: boolean; error?: string }> = [];

        if (zaicoEnabled) {
          // Zaico連携ON: 各商品をZaicoから削除
          for (const inventoryId of input.inventoryIds) {
            try {
              await deleteInventory(inventoryId, operatorToken);
              results.push({ inventoryId, success: true });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "不明なエラー";
              results.push({ inventoryId, success: false, error: errMsg });
            }
          }
        } else {
          // Zaico連携OFF: ローカル在庫を在庫一覧から非表示にする
          for (const inventoryId of input.inventoryIds) {
            try {
              const localInv = await getLocalInventoryByZaicoIdOrId(inventoryId);
              if (localInv) {
                await createDeletedInventory({
                  zaicoId: localInv.zaicoId ?? localInv.id,
                  title: localInv.title,
                  category: localInv.category ?? undefined,
                  place: localInv.place ?? undefined,
                  quantity: localInv.quantity != null ? String(localInv.quantity) : undefined,
                  unit: localInv.unit ?? undefined,
                  unitPrice: localInv.unitPrice ?? undefined,
                  etc: localInv.etc ?? undefined,
                  snapshotJson: JSON.stringify(localInv),
                }).catch(() => {});
                await deleteLocalInventory(localInv.id);
              }
              results.push({ inventoryId, success: true });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "不明なエラー";
              results.push({ inventoryId, success: false, error: errMsg });
            }
          }
        }

        // 全商品をdeletedInventoryIdsに記録（取り消し線表示のためDBレコードは削除せず残す）
        const history = await getDeliveryHistoryById(input.historyId);
        if (history) {
          const currentDeleted = history.deletedInventoryIdsJson
            ? (JSON.parse(history.deletedInventoryIdsJson as string) as number[])
            : [];
          const newDeleted = Array.from(new Set([...currentDeleted, ...input.inventoryIds]));
          await markDeliveryItemsDeleted(input.historyId, newDeleted);
        }

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;
        return { ok: true, successCount, failCount, results };
      }),

    cancelItems: publicProcedure
      .input(z.object({
        historyId: z.number().int().positive(),
        items: z.array(z.object({
          inventoryId: z.number().int().positive(),
          quantity: z.number().int().positive(),
        })).min(1),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);

        // Step1: 出庫履歴を取得して取り消し済みかチェック
        const history = await getDeliveryHistoryById(input.historyId);
        if (!history) throw new Error("出庫履歴が見つかりません");

        const cancelledItems: Array<{ inventoryId: number; quantity: number; cancelledAt: string }> =
          history.cancelledItemsJson ? JSON.parse(history.cancelledItemsJson) : [];

        const cancelledIds = new Set(cancelledItems.map((c) => c.inventoryId));

        // 取り消し対象のフィルタリング（既に取り消し済みは除外）
        const targetItems = input.items.filter((item) => !cancelledIds.has(item.inventoryId));
        if (targetItems.length === 0) throw new Error("選択した商品はすべて既に取り消し済みです");

        const allItems = JSON.parse(history.itemsJson) as Array<{ inventoryId: number; title: string; quantity: number }>;
        const notCancelledItems = allItems.filter((item) => !cancelledIds.has(item.inventoryId));
        const targetIds = new Set(targetItems.map((i) => i.inventoryId));
        const isCancellingAll = notCancelledItems.every((item) => targetIds.has(item.inventoryId));

        const results: Array<{ inventoryId: number; success: boolean; error?: string }> = [];
        const newCancelledItems = [...cancelledItems];

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBの在庫数を直接増加
          for (const item of targetItems) {
            try {
              const localInv = await getLocalInventoryByZaicoIdOrId(item.inventoryId);
              if (localInv) {
                const newQty = (localInv.quantity ?? 0) + item.quantity;
                await updateLocalInventory(localInv.id, { quantity: newQty });
              }
              newCancelledItems.push({
                inventoryId: item.inventoryId,
                quantity: item.quantity,
                cancelledAt: new Date().toISOString(),
              });
              results.push({ inventoryId: item.inventoryId, success: true });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "不明なエラー";
              results.push({ inventoryId: item.inventoryId, success: false, error: errMsg });
            }
          }
        } else if (history.zaicoDeliveryId && isCancellingAll) {
          // 全商品取り消し：Zaico出庫データを削除（Zaico側で在庫数自動復元）
          try {
            await deleteDelivery(history.zaicoDeliveryId, operatorToken);
            for (const item of targetItems) {
              newCancelledItems.push({
                inventoryId: item.inventoryId,
                quantity: item.quantity,
                cancelledAt: new Date().toISOString(),
              });
              results.push({ inventoryId: item.inventoryId, success: true });
            }
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : "不明なエラー";
            for (const item of targetItems) {
              results.push({ inventoryId: item.inventoryId, success: false, error: errMsg });
            }
          }
        } else {
          // 一部商品のみ取り消し：各商品のZaico在庫数を直接増加
          for (const item of targetItems) {
            try {
              const inv = await getInventory(item.inventoryId);
              const currentQty = Math.floor(parseFloat(inv.quantity ?? "0"));
              const newQty = currentQty + item.quantity;

              await updateInventory(
                item.inventoryId,
                {
                  title: inv.title,
                  quantity: String(newQty),
                  unit: inv.unit,
                  category: inv.categories?.[0] ?? inv.category,
                  place: inv.place,
                  etc: inv.etc,
                },
                operatorToken
              );

              newCancelledItems.push({
                inventoryId: item.inventoryId,
                quantity: item.quantity,
                cancelledAt: new Date().toISOString(),
              });
              results.push({ inventoryId: item.inventoryId, success: true });
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : "不明なエラー";
              results.push({ inventoryId: item.inventoryId, success: false, error: errMsg });
            }
          }
        }

        // Step3: DBの取り消し済みリストを更新（成功分のみ）
        await updateDeliveryCancelledItems(input.historyId, newCancelledItems);

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;
        return { success: true, successCount, failCount, results };
      }),
  }),

  // ============================================================
  // 発注管理（管理番号キーで発注済み・出庫済み・在庫数を集計）
  // ============================================================
  orderManagement: router({
    /**
     * 箱の中身をFedEx送り状の申告明細にする。
     *
     * 単価と通貨は取引データ（trade_records）が持っている。箱→個体ラベル→旧管理番号→
     * インボイスNo の経路は既にFedEx紐付けで通っているので、突き合わせて金額を出すだけ。
     * 突き合わせは発送管理シート書き込みと同じ shipmentProductMatches を使う。
     */
    boxDeclaration: protectedProcedure
      .input(z.object({ boxCode: z.string().min(1).max(20) }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
        const { outboundBoxes: boxTbl, inventoryItemLabels: labelTbl } = await import("../../drizzle/schema");
        const boxCode = input.boxCode.normalize("NFKC").trim().toUpperCase();
        const [box] = await db.select().from(boxTbl).where(eq(boxTbl.boxCode, boxCode)).limit(1);
        if (!box) throw new TRPCError({ code: "NOT_FOUND", message: `${boxCode} が見つかりません` });

        const labels = await db
          .select({
            labelId: labelTbl.labelId,
            title: labelTbl.title,
            legacyManagementNo: labelTbl.legacyManagementNo,
            assignedInvoiceNo: labelTbl.assignedInvoiceNo,
          })
          .from(labelTbl)
          .where(eq(labelTbl.outboundBoxId, box.id));

        const orderRows = await getOrderRowsFromTradeRecords().catch(() => []);
        const rowsByInvoice = new Map<string, OrderCsvRow[]>();
        for (const row of orderRows) {
          if (!row.productName.trim()) continue;
          rowsByInvoice.set(row.invoiceNo, [...(rowsByInvoice.get(row.invoiceNo) ?? []), row]);
        }

        type DeclarationLine = {
          key: string;
          invoiceNo: string | null;
          partner: string;
          productName: string;
          quantity: number;
          /** 旧管理番号からインボイスNoを読めず、箱の中の他インボイスから推定した行 */
          estimatedQuantity: number;
          unitPrice: number | null;
          currency: string;
          subtotal: number | null;
        };
        const lineByKey = new Map<string, DeclarationLine>();
        const unmatched: Array<{
          labelId: string;
          title: string;
          managementNo: string | null;
          invoiceCandidates: string[];
          reason: string;
        }> = [];

        /** 色まで一致する行を優先し、無ければ「ランダムカラー」等の総称行に落とす。 */
        function pickRow(candidates: OrderCsvRow[], title: string): OrderCsvRow | null {
          const exact = candidates.find(
            (row) => !isRandomShipmentName(row.productName) && shipmentProductMatches(row.productName, title),
          );
          return exact ?? candidates.find((row) => shipmentProductMatches(row.productName, title)) ?? null;
        }

        // 在庫から充当したぶんは旧管理番号にインボイスNoが無い。
        // その場合は「この箱に入っている他のインボイス」だけを探索範囲にして推定する。
        // 候補が1つに絞れないときは推定せず、未照合として人に返す。
        const invoicesInBox = Array.from(
          new Set(
            labels
              .map((row) => invoiceNoFromManagementNo(row.legacyManagementNo?.trim() || null))
              .filter((value): value is string => Boolean(value)),
          ),
        );

        for (const label of labels) {
          const managementNo = label.legacyManagementNo?.trim() || null;
          // 人が指定した引当先があればそれが正。在庫充当や別インボイスからの振替はこれで解決する。
          const invoiceNo =
            normalizeAssignedInvoiceNo(label.assignedInvoiceNo) ?? invoiceNoFromManagementNo(managementNo);
          const title = String(label.title ?? "").trim();
          let matched = invoiceNo ? pickRow(rowsByInvoice.get(invoiceNo) ?? [], title) : null;
          let estimated = false;

          if (!matched && !invoiceNo) {
            const guesses = invoicesInBox
              .map((candidateInvoiceNo) => pickRow(rowsByInvoice.get(candidateInvoiceNo) ?? [], title))
              .filter((row): row is OrderCsvRow => Boolean(row));
            const distinct = new Map(guesses.map((row) => [`${row.invoiceNo}::${row.productName}`, row]));
            if (distinct.size === 1) {
              matched = Array.from(distinct.values())[0];
              estimated = true;
            }
          }

          if (!matched) {
            unmatched.push({
              labelId: label.labelId,
              title,
              managementNo,
              invoiceCandidates: invoicesInBox,
              reason: !invoiceNo
                ? "旧管理番号からインボイスNoを読めず、この箱のインボイスからも1つに絞れません"
                : (rowsByInvoice.get(invoiceNo) ?? []).length === 0
                  ? `取引データにNo.${invoiceNo}の明細がありません`
                  : `No.${invoiceNo}の明細に一致する商品名が見つかりません`,
            });
            continue;
          }

          const key = `${matched.invoiceNo}::${matched.productName}`;
          const current = lineByKey.get(key);
          if (current) {
            current.quantity += 1;
            if (estimated) current.estimatedQuantity += 1;
            current.subtotal = current.unitPrice == null ? null : current.unitPrice * current.quantity;
            continue;
          }
          lineByKey.set(key, {
            key,
            invoiceNo: matched.invoiceNo,
            partner: matched.partner,
            productName: matched.productName,
            quantity: 1,
            estimatedQuantity: estimated ? 1 : 0,
            unitPrice: matched.sellingPrice,
            currency: normalizeDeclarationCurrency(matched.currency),
            subtotal: matched.sellingPrice,
          });
        }

        const lines = Array.from(lineByKey.values()).sort((a, b) => {
          const invoiceDiff = Number(a.invoiceNo ?? 0) - Number(b.invoiceNo ?? 0);
          return invoiceDiff !== 0 ? invoiceDiff : a.productName.localeCompare(b.productName, "ja");
        });

        const totalsByCurrency = new Map<string, { currency: string; quantity: number; amount: number; incomplete: boolean }>();
        for (const line of lines) {
          const current = totalsByCurrency.get(line.currency) ?? {
            currency: line.currency,
            quantity: 0,
            amount: 0,
            incomplete: false,
          };
          current.quantity += line.quantity;
          if (line.subtotal == null) current.incomplete = true;
          else current.amount += line.subtotal;
          totalsByCurrency.set(line.currency, current);
        }

        return {
          boxCode: box.boxCode,
          status: box.status,
          trackingNumber: box.trackingNumber ?? null,
          itemCount: labels.length,
          lines,
          totals: Array.from(totalsByCurrency.values()),
          unmatched,
        };
      }),

    /**
     * GitHub Raw URLからCSVを取得してインボイスNo・取引先・発注数をパースする
     */
    getCsvData: publicProcedure.query(async () => {
      try {
        return await getOrderRowsFromTradeRecords();
      } catch (err) {
        console.error("Trade order data error:", err);
        return [];
      }
    }),

    getPurchaseRegistrationInvoices: publicProcedure.query(async () => {
      try {
        const [orderRows, histories, allMemos, shipmentProgressByInvoice] = await Promise.all([
          getOrderRowsFromTradeRecords(),
          getAllDeliveryHistories().catch(() => []),
          getAllInvoiceMemos().catch(() => []),
          getOrderManagementShipmentProgressByInvoice().catch((error) => {
            console.warn("[OrderManagement] Failed to load shipment progress sheet", error);
            return new Map<string, TradeShipmentProgressEntry[]>();
          }),
        ]);

        const manualCompleteSet = new Set<string>(
          allMemos
            .filter((memo) => memo.colorKey === "__manual_complete__" && memo.memo === "1")
            .map((memo) => String(memo.invoiceKey)),
        );

        const invoiceMap = new Map<
          string,
          {
            invoiceNo: string;
            partner: string;
            totalOrderQty: number;
          }
        >();

        for (const row of orderRows) {
          const invoiceNumber = Number(row.invoiceNo);
          if (!Number.isFinite(invoiceNumber) || invoiceNumber <= 383) continue;
          if (manualCompleteSet.has(row.invoiceNo) || isClosedTradeYear(row.paymentDate)) continue;

          const current = invoiceMap.get(row.invoiceNo) ?? {
            invoiceNo: row.invoiceNo,
            partner: row.partner,
            totalOrderQty: 0,
          };
          current.totalOrderQty += Number(row.orderQty ?? 0) || 0;
          if (!current.partner && row.partner) current.partner = row.partner;
          invoiceMap.set(row.invoiceNo, current);
        }

        const sheetDeliveredQtyByInvoiceNo = new Map<string, number>();
        for (const [invoiceNo, entries] of shipmentProgressByInvoice.entries()) {
          if (!invoiceMap.has(invoiceNo)) continue;
          sheetDeliveredQtyByInvoiceNo.set(invoiceNo, summarizeShipmentProgress(entries).shippedQty);
        }

        // 出庫Noの文字列ではなく明細1点ずつの管理番号でインボイスに振り分ける。
        // 箱ID（B000002）のように出庫Noから読めない出庫でも、中身が403と408に
        // 分かれていればそれぞれに計上される。従来の出庫Noは接頭辞で当たるので挙動は変わらない。
        const inventoryManagementNoMap = await buildInventoryManagementNoMap().catch(
          () => new Map<number, string>(),
        );
        const assignedInvoiceNoMap = await buildAssignedInvoiceNoMap().catch(() => new Map<string, string>());
        const deliveredQtyByInvoiceNo = new Map<string, number>();
        for (const history of histories) {
          if (history.status !== "success") continue;

          type CancelledDeliveryItem = { inventoryId?: number; quantity?: unknown };
          const items = parseDeliveryItemsJson(history.itemsJson);
          let cancelledItems: CancelledDeliveryItem[] = [];
          try {
            const parsed = JSON.parse(history.cancelledItemsJson || "[]");
            cancelledItems = Array.isArray(parsed) ? parsed : [];
          } catch {
            cancelledItems = [];
          }

          const cancelledByInventoryId = new Map<number, number>();
          for (const item of cancelledItems) {
            const inventoryId = Number(item.inventoryId ?? 0);
            const quantity = Number(item.quantity ?? 0);
            if (inventoryId > 0 && quantity > 0) {
              cancelledByInventoryId.set(inventoryId, (cancelledByInventoryId.get(inventoryId) ?? 0) + quantity);
            }
          }

          for (const item of items) {
            const quantity = Number(item.quantity ?? 0);
            if (quantity <= 0) continue;
            const inventoryId = item.inventoryId == null ? undefined : Number(item.inventoryId);
            const cancelledQty = inventoryId ? (cancelledByInventoryId.get(inventoryId) ?? 0) : 0;
            const usedCancelledQty = Math.min(quantity, cancelledQty);
            if (inventoryId && usedCancelledQty > 0) {
              cancelledByInventoryId.set(inventoryId, cancelledQty - usedCancelledQty);
            }
            const deliveredQty = Math.max(0, quantity - usedCancelledQty);
            if (deliveredQty <= 0) continue;

            const invoiceNo = resolveDeliveryItemInvoiceNo(
              withAssignedInvoiceNo(item, assignedInvoiceNoMap),
              history.deliveryNo,
              inventoryId ? inventoryManagementNoMap.get(inventoryId) : null,
            );
            if (!invoiceNo || !invoiceMap.has(invoiceNo)) continue;
            deliveredQtyByInvoiceNo.set(
              invoiceNo,
              (deliveredQtyByInvoiceNo.get(invoiceNo) ?? 0) + deliveredQty,
            );
          }
        }

        return Array.from(invoiceMap.values())
          .map((invoice) => {
            const totalDeliveredQty = sheetDeliveredQtyByInvoiceNo.has(invoice.invoiceNo)
              ? sheetDeliveredQtyByInvoiceNo.get(invoice.invoiceNo) ?? 0
              : deliveredQtyByInvoiceNo.get(invoice.invoiceNo) ?? 0;
            const remainingQty = Math.max(0, invoice.totalOrderQty - totalDeliveredQty);
            return {
              ...invoice,
              totalDeliveredQty,
              remainingQty,
            };
          })
          .filter((invoice) => invoice.remainingQty > 0)
          .sort((a, b) => Number(b.invoiceNo) - Number(a.invoiceNo));
      } catch (err) {
        console.error("getPurchaseRegistrationInvoices error:", err);
        return [];
      }
    }),

    getInvoiceProducts: publicProcedure
      .input(z.object({ invoiceNo: z.string().min(1) }))
      .query(async ({ input }) => {
        const invoiceNo = input.invoiceNo.trim();
        const orderRows = (await getOrderRowsFromTradeRecords())
          .filter((row) => row.invoiceNo === invoiceNo);
        const csvProducts = orderRows.map((row) => ({ name: row.productName, qty: row.orderQty }));
        const shipmentEntries = (await getOrderManagementShipmentProgressByInvoice().catch((error) => {
          console.warn("[OrderManagement] Failed to load shipment progress sheet", error);
          return new Map<string, TradeShipmentProgressEntry[]>();
        })).get(invoiceNo);

        type StoredDeliveryItem = {
          inventoryId?: number;
          title?: string;
          quantity?: unknown;
          managementNo?: string | null;
          tradeRecordId?: number | null;
          csvProductName?: string | null;
        };
        type CancelledDeliveryItem = { inventoryId?: number; quantity?: unknown };

        const deliveredByTradeRecordId = new Map<number, number>();
        const deliveredByProductName = new Map<string, number>();
        const inventoryManagementMap = await buildInventoryManagementNoMap();
        // 出庫Noの接頭辞ではなく明細の管理番号で判定する。1箱に複数インボイスが
        // 混ざっていても、このインボイスの明細を持つ出庫は拾う（明細側でも再度絞る）。
        const assignedInvoiceNoMap = await buildAssignedInvoiceNoMap().catch(() => new Map<string, string>());
        const deliveryItemInvoiceNo = (item: StoredDeliveryItem, deliveryNo: string) =>
          resolveDeliveryItemInvoiceNo(
            withAssignedInvoiceNo(item, assignedInvoiceNoMap),
            deliveryNo,
            item.inventoryId ? inventoryManagementMap.get(Number(item.inventoryId)) : null,
          );
        const deliveries = (await getAllDeliveryHistories()).filter((history) => {
          if (history.status !== "success") return false;
          const items = parseDeliveryItemsJson(history.itemsJson) as StoredDeliveryItem[];
          return items.some((item) => deliveryItemInvoiceNo(item, history.deliveryNo) === invoiceNo);
        });

        const addByTradeRecordId = (tradeRecordId: number, quantity: number) => {
          deliveredByTradeRecordId.set(tradeRecordId, (deliveredByTradeRecordId.get(tradeRecordId) ?? 0) + quantity);
        };
        const addByProductName = (productName: string, quantity: number) => {
          const name = productName.trim();
          if (!name) return;
          deliveredByProductName.set(name, (deliveredByProductName.get(name) ?? 0) + quantity);
        };
        const consumeCancelledQuantity = (
          cancelledByInventoryId: Map<number, number>,
          inventoryId: number | undefined,
          quantity: number,
        ) => {
          if (!inventoryId) return 0;
          const cancelledQty = cancelledByInventoryId.get(inventoryId) ?? 0;
          const usedQty = Math.min(quantity, cancelledQty);
          if (usedQty > 0) cancelledByInventoryId.set(inventoryId, cancelledQty - usedQty);
          return usedQty;
        };

        for (const delivery of deliveries) {
          let items: StoredDeliveryItem[] = [];
          let cancelledItems: CancelledDeliveryItem[] = [];
          try {
            const parsed = JSON.parse(delivery.itemsJson || "[]");
            items = Array.isArray(parsed) ? parsed : [];
          } catch {
            items = [];
          }
          try {
            const parsed = JSON.parse(delivery.cancelledItemsJson || "[]");
            cancelledItems = Array.isArray(parsed) ? parsed : [];
          } catch {
            cancelledItems = [];
          }

          const cancelledByInventoryId = new Map<number, number>();
          const allocationItems: ShipmentGasItem[] = [];
          for (const item of cancelledItems) {
            const inventoryId = Number(item.inventoryId ?? 0);
            const quantity = Number(item.quantity ?? 0);
            if (inventoryId > 0 && quantity > 0) {
              cancelledByInventoryId.set(inventoryId, (cancelledByInventoryId.get(inventoryId) ?? 0) + quantity);
            }
          }

          for (const item of items) {
            const quantity = Number(item.quantity ?? 0);
            if (quantity <= 0) continue;
            // 他インボイス宛の明細が同じ箱に入っていることがある。ここで落とす。
            if (deliveryItemInvoiceNo(item, delivery.deliveryNo) !== invoiceNo) continue;
            const inventoryId = item.inventoryId == null ? undefined : Number(item.inventoryId);
            const effectiveQuantity = quantity - consumeCancelledQuantity(cancelledByInventoryId, inventoryId, quantity);
            if (effectiveQuantity <= 0) continue;

            const tradeRecordId = item.tradeRecordId == null ? null : Number(item.tradeRecordId);
            if (tradeRecordId && orderRows.some((row) => row.tradeRecordId === tradeRecordId)) {
              addByTradeRecordId(tradeRecordId, effectiveQuantity);
              continue;
            }

            const fallbackManagement = inventoryId ? (inventoryManagementMap.get(inventoryId) ?? "") : "";
            const storedCsvProductName = typeof item.csvProductName === "string" ? item.csvProductName.trim() : "";
            const title = String(item.title ?? "").trim();
            const managementText = Array.from(new Set(extractManagementHints(
              item.managementNo,
              fallbackManagement.split(",")[0],
              fallbackManagement,
              delivery.deliveryNo,
              title,
              storedCsvProductName,
            ))).join(" ");
            const allocationName = storedCsvProductName || title;
            if (allocationName) {
              allocationItems.push({
                productNameJa: allocationName,
                productNameEn: allocationName,
                quantity: effectiveQuantity,
                managementNo: managementText || null,
              });
              continue;
            }

            const suggestion = suggestCsvProduct(
              title,
              String(item.managementNo ?? fallbackManagement),
              csvProducts,
            );
            if (suggestion) {
              addByProductName(suggestion.name, effectiveQuantity);
              continue;
            }

            const rawTitle = String(item.title ?? "").trim();
            if (rawTitle) addByProductName(rawTitle, effectiveQuantity);
          }

          const allocatedItems = allocationItems.length > 0 && csvProducts.length > 0
            ? allocateShipmentItemsToCsvProducts(allocationItems, csvProducts)
            : allocationItems;
          for (const item of allocatedItems) {
            addByProductName(item.productNameJa, item.quantity);
          }
        }

        const remainingNameDelivered = new Map(deliveredByProductName);
        const consumeDeliveredByProductName = (productName: string, quantityNeeded: number): number => {
          let allocated = 0;
          const consume = (key: string, quantity: number) => {
            const remaining = Math.max(0, quantityNeeded - allocated);
            if (remaining <= 0 || quantity <= 0) return;
            const used = Math.min(remaining, quantity);
            allocated += used;
            if (used > 0) remainingNameDelivered.set(key, quantity - used);
          };

          const exactKey = productName.trim();
          if (exactKey) {
            consume(exactKey, remainingNameDelivered.get(exactKey) ?? 0);
          }
          if (allocated >= quantityNeeded) return allocated;

          for (const [key, quantity] of Array.from(remainingNameDelivered.entries())) {
            if (key === exactKey || quantity <= 0) continue;
            if (!deliveryProductNameMatchesOrderProduct(key, productName, csvProducts)) continue;
            consume(key, quantity);
            if (allocated >= quantityNeeded) break;
          }
          return allocated;
        };
        const sheetAllocations = shipmentEntries?.length
          ? allocateShipmentProgressToProducts(orderRows, shipmentEntries)
          : null;
        const products = orderRows.map((row, index) => {
          const deliveredQty = sheetAllocations
            ? (sheetAllocations[index]?.shippedQty ?? 0)
            : (() => {
                const byId = row.tradeRecordId ? (deliveredByTradeRecordId.get(row.tradeRecordId) ?? 0) : 0;
                const allocatedByName = consumeDeliveredByProductName(row.productName, Math.max(0, row.orderQty - byId));
                return byId + allocatedByName;
              })();
          return {
            tradeRecordId: row.tradeRecordId,
            productName: row.productName,
            orderQty: row.orderQty,
            deliveredQty,
            remainingQty: Math.max(0, row.orderQty - deliveredQty),
            sellingPrice: row.sellingPrice,
            sellingPriceJpy: row.sellingPriceJpy,
            currency: row.currency,
            paymentDate: row.paymentDate,
            status: row.status,
          };
        });

        return {
          invoiceNo,
          products,
          totalOrderQty: products.reduce((sum, product) => sum + product.orderQty, 0),
          totalDeliveredQty: products.reduce((sum, product) => sum + product.deliveredQty, 0),
        };
      }),

    receivePurchaseLabel: publicProcedure
      .input(
        z.object({
          labelId: z.string().min(1).max(80),
          operatorName: z.string().max(200).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const labelId = input.labelId.trim().toUpperCase();
        const db = await getDb();
        if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

        const { inventoryItemLabels: labelTbl } = await import("../../drizzle/schema");
        const [label] = await db.select().from(labelTbl).where(eq(labelTbl.labelId, labelId)).limit(1);
        if (!label) {
          throw new TRPCError({ code: "NOT_FOUND", message: `商品ID ${labelId} が見つかりません` });
        }

        const currentStatus = String(label.status ?? "").trim().toLowerCase();
        const alreadyReceived = isReceivedLabelStatus(currentStatus);
        const localInventoryId = label.localInventoryId ?? null;
        const inventory = localInventoryId ? await getLocalInventoryByZaicoIdOrId(localInventoryId) : null;
        const labelManagementNo = String(
          label.legacyManagementNo ?? getInventoryManagementNo(inventory?.etc) ?? "",
        ).trim();
        let purchase: LocalPurchaseRow | null = label.purchaseId ? await getLocalPurchaseById(label.purchaseId) : null;
        if (!purchase && localInventoryId) {
          const candidatePurchases = (await getLocalPurchases()).filter((row) =>
            localPurchaseMatchesInventoryLabel(row, localInventoryId, labelManagementNo),
          );
          purchase =
            candidatePurchases.find((row) => row.status !== "purchased") ??
            candidatePurchases[0] ??
            null;
        }
        const today = new Date().toISOString().slice(0, 10);
        const operatorName = resolveWorkOperatorName(input.operatorName, ctx.user?.name ?? ctx.user?.email ?? null);

        const markPurchaseReceivedIfReady = async () => {
          if (!purchase || purchase.status === "purchased") return;
          let labelsForPurchase = await db
            .select()
            .from(labelTbl)
            .where(eq(labelTbl.purchaseId, purchase.id));
          if (labelsForPurchase.length === 0 && purchase.localInventoryId) {
            const inventoryLabels = await db
              .select()
              .from(labelTbl)
              .where(eq(labelTbl.localInventoryId, purchase.localInventoryId));
            labelsForPurchase = filterLabelsByManagementNo(
              inventoryLabels,
              String(purchase.managementNo ?? labelManagementNo ?? "").trim(),
            );
          } else {
            labelsForPurchase = filterLabelsByManagementNo(
              labelsForPurchase,
              String(purchase.managementNo ?? labelManagementNo ?? "").trim(),
            );
          }

          const relevantLabels = labelsForPurchase.length > 0 ? labelsForPurchase : [label];
          const requiredQuantity = Math.max(1, Math.floor(Number(purchase.quantity ?? 1)) || 1);
          const receivedCount = relevantLabels.filter((row) => (
            row.id === label.id || isReceivedLabelStatus(row.status)
          )).length;
          if (receivedCount >= Math.min(requiredQuantity, relevantLabels.length)) {
            await updateLocalPurchaseStatus(purchase.id, "purchased", today);
            purchase = { ...purchase, status: "purchased", receivedDate: today };
          }
        };

        if (!alreadyReceived) {
          const now = new Date();
          await db
            .update(labelTbl)
            .set({ status: "received", receivedAt: label.receivedAt ?? now })
            .where(eq(labelTbl.id, label.id));

          if (inventory) {
            await updateLocalInventory(inventory.id, { quantity: Number(inventory.quantity ?? 0) + 1 });
          }

          const historyZaicoId =
            purchase?.zaicoId ??
            purchase?.id ??
            inventory?.zaicoId ??
            inventory?.id ??
            localInventoryId;
          if (historyZaicoId) {
            const historyManagementNo =
              label.legacyManagementNo ?? purchase?.managementNo ?? getInventoryManagementNo(inventory?.etc) ?? null;
            const historyTitle = label.title || purchase?.title || inventory?.title || labelId;
            const historyCategory = purchase?.category ?? inventory?.category ?? null;
            const historySupplier = purchase?.supplierName ?? inventory?.supplierName ?? null;
            const historyUnitPrice =
              purchase?.unitPrice == null
                ? inventory?.unitPrice == null
                  ? null
                  : String(inventory.unitPrice)
                : String(purchase.unitPrice);
            await createPurchaseHistory({
              zaicoId: historyZaicoId,
              kanriNo: historyManagementNo,
              title: historyTitle,
              category: historyCategory,
              supplier: historySupplier,
              quantity: "1",
              unitPrice: historyUnitPrice,
              purchaseDate: today,
              inventoryId: inventory?.id ?? localInventoryId,
              cancelled: 0,
              operatorName,
            });

            await recordWorkLog({
              workerName: operatorName,
              category: "入庫登録",
              status: "done",
              startedAt: now,
              endedAt: now,
              quantity: 1,
              memo: `商品ID: ${labelId}`,
              createdBy: operatorName,
              sourceType: "purchase-label",
              sourceId: labelId,
              detailsJson: JSON.stringify({
                labelId,
                purchaseId: purchase?.id ?? null,
                inventoryId: inventory?.id ?? localInventoryId,
                managementNo: historyManagementNo,
              }),
            });
          }
        } else {
          const historyZaicoId =
            purchase?.zaicoId ??
            purchase?.id ??
            inventory?.zaicoId ??
            inventory?.id ??
            localInventoryId;
          if (historyZaicoId) {
            const { purchaseHistories: purchaseHistoriesTbl } = await import("../../drizzle/schema");
            const historyManagementNo =
              label.legacyManagementNo ?? purchase?.managementNo ?? getInventoryManagementNo(inventory?.etc) ?? null;
            const historyTitle = label.title || purchase?.title || inventory?.title || labelId;
            const existingHistory = await db
              .select({ id: purchaseHistoriesTbl.id })
              .from(purchaseHistoriesTbl)
              .where(
                and(
                  eq(purchaseHistoriesTbl.zaicoId, historyZaicoId),
                  eq(purchaseHistoriesTbl.title, historyTitle),
                  eq(purchaseHistoriesTbl.cancelled, 0),
                ),
              )
              .limit(1);

            if (existingHistory.length === 0) {
              const now = new Date();
              const receivedAt = label.receivedAt ? new Date(label.receivedAt) : now;
              const purchaseDate = Number.isNaN(receivedAt.getTime()) ? today : receivedAt.toISOString().slice(0, 10);
              const historyCategory = purchase?.category ?? inventory?.category ?? null;
              const historySupplier = purchase?.supplierName ?? inventory?.supplierName ?? null;
              const historyUnitPrice =
                purchase?.unitPrice == null
                  ? inventory?.unitPrice == null
                    ? null
                    : String(inventory.unitPrice)
                  : String(purchase.unitPrice);

              await createPurchaseHistory({
                zaicoId: historyZaicoId,
                kanriNo: historyManagementNo,
                title: historyTitle,
                category: historyCategory,
                supplier: historySupplier,
                quantity: "1",
                unitPrice: historyUnitPrice,
                purchaseDate,
                inventoryId: inventory?.id ?? localInventoryId,
                cancelled: 0,
                operatorName,
              });

              await recordWorkLog({
                workerName: operatorName,
                category: "入庫登録",
                status: "done",
                startedAt: now,
                endedAt: now,
                quantity: 1,
                memo: `商品ID: ${labelId} / 履歴補完`,
                createdBy: operatorName,
                sourceType: "purchase-label",
                sourceId: labelId,
                detailsJson: JSON.stringify({
                  labelId,
                  purchaseId: purchase?.id ?? null,
                  inventoryId: inventory?.id ?? localInventoryId,
                  managementNo: historyManagementNo,
                  recoveredHistory: true,
                }),
              });
            }
          }
        }

        await markPurchaseReceivedIfReady();

        const [updatedLabel] = await db.select().from(labelTbl).where(eq(labelTbl.id, label.id)).limit(1);
        return {
          labelId,
          alreadyReceived,
          status: updatedLabel?.status ?? (alreadyReceived ? label.status : "received"),
          title: updatedLabel?.title ?? label.title,
          legacyManagementNo: updatedLabel?.legacyManagementNo ?? label.legacyManagementNo,
          purchaseId: updatedLabel?.purchaseId ?? label.purchaseId ?? purchase?.id ?? null,
          localInventoryId: updatedLabel?.localInventoryId ?? label.localInventoryId,
          inventoryQuantity: inventory ? Number(inventory.quantity ?? 0) + (alreadyReceived ? 0 : 1) : null,
        };
      }),

    /**
     * 管理番号の先頭数字をキーに、発注済み数・出庫済み数・在庫数を集計する
     * 出庫 No の先頭数字（_ より前）と管理番号の先頭数字を照合
     * CSVのインボイスNoとも照合して発注数・取引先を追加
     */
    backfillDeliveryOrderLines: publicProcedure
      .input(z.object({
        dryRun: z.boolean().optional(),
        overwrite: z.boolean().optional(),
        limit: z.number().int().positive().max(5000).optional(),
      }).optional())
      .mutation(async ({ input }) => {
        const dryRun = input?.dryRun ?? false;
        const overwrite = input?.overwrite ?? false;
        const limit = input?.limit ?? 2000;
        const orderRows = await getOrderRowsFromTradeRecords();
        const rowsByInvoice = new Map<string, OrderCsvRow[]>();
        for (const row of orderRows) {
          const list = rowsByInvoice.get(row.invoiceNo) ?? [];
          list.push(row);
          rowsByInvoice.set(row.invoiceNo, list);
        }

        const timeOf = (value: unknown) => value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
        const histories = (await getAllDeliveryHistories())
          .slice(0, limit)
          .filter((history) => history.status === "success")
          .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt));
        const inventoryManagementMap = await buildInventoryManagementNoMap();
        const remainingByTradeRecordId = new Map<number, number>();
        for (const row of orderRows) {
          if (row.tradeRecordId) remainingByTradeRecordId.set(row.tradeRecordId, row.orderQty);
        }

        let scannedHistories = 0;
        let scannedItems = 0;
        let updatedHistories = 0;
        let updatedItems = 0;
        let alreadyLinkedItems = 0;
        let skippedNoInvoice = 0;
        let skippedNoRows = 0;
        let skippedNoMatch = 0;

        const consumeLinkedQuantity = (item: StoredDeliveryItem) => {
          const tradeRecordId = item.tradeRecordId == null ? null : Number(item.tradeRecordId);
          if (!tradeRecordId) return;
          const quantity = Number(item.quantity ?? 0) || 0;
          if (quantity <= 0) return;
          remainingByTradeRecordId.set(
            tradeRecordId,
            Math.max(0, (remainingByTradeRecordId.get(tradeRecordId) ?? 0) - quantity),
          );
        };

        for (const history of histories) {
          scannedHistories += 1;
          const invoiceNo = invoiceNoFromDeliveryNo(history.deliveryNo);
          const items = parseDeliveryItemsJson(history.itemsJson);
          if (!invoiceNo) {
            skippedNoInvoice += items.length;
            continue;
          }
          const rows = rowsByInvoice.get(invoiceNo);
          if (!rows || rows.length === 0) {
            skippedNoRows += items.length;
            continue;
          }

          const csvProducts = rows.map((row) => ({ name: row.productName, qty: row.orderQty }));
          let hasChange = false;
          const nextItems = items.map((item) => {
            scannedItems += 1;
            const quantity = Number(item.quantity ?? 0) || 0;
            if (quantity <= 0) return item;

            const hasExistingLink = item.tradeRecordId != null || item.csvProductName !== undefined;
            if (hasExistingLink && !overwrite) {
              alreadyLinkedItems += 1;
              consumeLinkedQuantity(item);
              return item;
            }

            const inventoryId = item.inventoryId == null ? null : Number(item.inventoryId);
            const fallbackManagement = inventoryId ? (inventoryManagementMap.get(inventoryId) ?? "") : "";
            const managementNo = String(item.managementNo || fallbackManagement.split(",")[0] || "").trim();
            const managementHints = extractManagementHints(managementNo, fallbackManagement, history.deliveryNo);
            const suggestionName =
              suggestCsvProductNameFromHints("", managementHints, csvProducts) ??
              suggestCsvProductNameFromHints(String(item.title ?? ""), managementHints, csvProducts);
            if (!suggestionName) {
              skippedNoMatch += 1;
              return item;
            }

            const candidateRows = rows.filter((row) => row.productName === suggestionName);
            const chosenRow =
              candidateRows.find((row) => row.tradeRecordId && (remainingByTradeRecordId.get(row.tradeRecordId) ?? 0) >= quantity) ??
              candidateRows.find((row) => row.tradeRecordId && (remainingByTradeRecordId.get(row.tradeRecordId) ?? 0) > 0) ??
              candidateRows[0];
            if (!chosenRow) {
              skippedNoMatch += 1;
              return item;
            }

            if (chosenRow.tradeRecordId) {
              remainingByTradeRecordId.set(
                chosenRow.tradeRecordId,
                Math.max(0, (remainingByTradeRecordId.get(chosenRow.tradeRecordId) ?? 0) - quantity),
              );
            }

            const nextItem = {
              ...item,
              csvProductName: suggestionName,
              ...(chosenRow.tradeRecordId ? { tradeRecordId: chosenRow.tradeRecordId } : {}),
              ...(!item.managementNo && managementNo ? { managementNo } : {}),
            };
            const changed =
              item.csvProductName !== nextItem.csvProductName ||
              item.tradeRecordId !== nextItem.tradeRecordId ||
              item.managementNo !== nextItem.managementNo;
            if (changed) {
              hasChange = true;
              updatedItems += 1;
            }
            return nextItem;
          });

          if (hasChange) {
            updatedHistories += 1;
            if (!dryRun) {
              await updateDeliveryHistoryItemsJson(history.id, JSON.stringify(nextItems));
            }
          }
        }

        return {
          dryRun,
          overwrite,
          scannedHistories,
          scannedItems,
          updatedHistories,
          updatedItems,
          alreadyLinkedItems,
          skippedNoInvoice,
          skippedNoRows,
          skippedNoMatch,
        };
      }),

    getSummary: publicProcedure.query(async () => {
      const zaicoEnabled = await isZaicoEnabled();
      type CsvRow = { partner: string; invoiceNo: string; productName: string; orderQty: number; status: string; paymentDate: string };
      const deliveriesPromise = getDeliveryHistories(1000);
      const allMemosPromise = getAllInvoiceMemos();
      const shipmentProgressPromise = getOrderManagementShipmentProgressByInvoice().catch((error) => {
        console.warn("[OrderManagement] Failed to load shipment progress sheet", error);
        return new Map<string, TradeShipmentProgressEntry[]>();
      });
      const csvRowsPromise: Promise<CsvRow[]> = getOrderRowsFromTradeRecords().catch((e) => {
        console.error("Trade order data error:", e);
        return [];
      });
      // 1. 発注済み入庫一覧（ordered + purchased）を取得
      let allPurchases: Array<{ id: number; num: string; status: string; purchase_items: Array<{ inventory_id?: number | null; title: string; quantity: string; unit_price?: string | number | null; etc?: string | null }> }>;
      if (!zaicoEnabled) {
        const [localPurchaseRows, _purchaseHistForStatus] = await Promise.all([
          getLocalPurchases(),
          getPurchaseHistories(2000),
        ]);
        // purchase_historiesから有効な入庫履歴（cancelled=0）のzaicoIdセットを構築（ステータス証明用）
        const _purchasedIds = new Set<number>(
          _purchaseHistForStatus
            .filter((h) => h.cancelled === 0 && h.zaicoId != null)
            .map((h) => h.zaicoId as number)
        );
        allPurchases = localPurchaseRows.map((p) => {
          const fallbackItem = {
            inventory_id: p.localInventoryId ?? null,
            title: p.title ?? "",
            quantity: String(p.quantity ?? 1),
            unit_price: p.unitPrice != null ? Number(p.unitPrice) : null,
            etc: p.managementNo ?? null,
          };
          let items: Array<{ inventory_id?: number | null; title: string; quantity: string; unit_price?: string | number | null; etc?: string | null }> = [];
          try {
            const parsed = JSON.parse(p.itemsJson ?? "[]");
            const parsedItems = Array.isArray(parsed) ? parsed : [];
            items = (parsedItems.length > 0 ? parsedItems : [fallbackItem]).map((raw) => {
              const item = raw as Record<string, unknown>;
              return {
                inventory_id: typeof item.inventory_id === "number"
                  ? item.inventory_id
                  : typeof item.inventoryId === "number"
                    ? item.inventoryId
                    : p.localInventoryId ?? null,
                title: String(item.title ?? p.title ?? ""),
                quantity: String(item.quantity ?? p.quantity ?? 1),
                unit_price: (item.unit_price ?? item.unitPrice ?? p.unitPrice ?? null) as string | number | null,
                etc: (item.etc ?? item.managementNo ?? p.managementNo ?? null) as string | null,
              };
            });
          } catch {
            items = [fallbackItem];
          }
          const localId = p.zaicoId ?? p.id;
          const isPurchased = p.status === "purchased" || _purchasedIds.has(localId);
          return { id: localId, num: p.purchaseNum ?? "", status: isPurchased ? "purchased" : "ordered", purchase_items: items };
        });
      } else {
        allPurchases = await getPurchases();
      }
      // 2. 在庫一覧を取得
      let inventories: Array<{ id: number; title: string; quantity: string; etc?: string | null }>;
      if (!zaicoEnabled) {
        const localInvRows = await getLocalInventories();
        inventories = localInvRows.map((inv) => ({
          id: inv.zaicoId ?? inv.id,
          title: inv.title,
          quantity: String(inv.quantity ?? 0),
          etc: inv.etc ?? null,
        }));
      } else {
        inventories = await getInventories();
      }
      // 3. 出庫履歴を全件取得
      const deliveries = await deliveriesPromise;
      const shipmentProgressByInvoice = await shipmentProgressPromise;
      // 5. 全インボイスの手動完了フラグを取得
      const allMemos = await allMemosPromise;
      const manualCompleteSet = new Set<string>(
        allMemos
          .filter((m) => m.colorKey === "__manual_complete__" && m.memo === "1")
          .map((m) => m.invoiceKey)
      );
      // 4. GitHub CSVからインボイスNo・取引先・発注数を取得
      const csvRows = await csvRowsPromise;
      // CSVインボイスNoマップ: invoiceNo -> { partner, totalOrderQty, products }
      type CsvInvoice = { partner: string; totalOrderQty: number; products: Array<{ name: string; qty: number; status: string; paymentDate: string }> };
      const csvInvoiceMap = new Map<string, CsvInvoice>();
      for (const row of csvRows) {
        const existing = csvInvoiceMap.get(row.invoiceNo);
        if (existing) {
          existing.totalOrderQty += row.orderQty;
          existing.products.push({ name: row.productName, qty: row.orderQty, status: row.status, paymentDate: row.paymentDate });
        } else {
          csvInvoiceMap.set(row.invoiceNo, {
            partner: row.partner,
            totalOrderQty: row.orderQty,
            products: [{ name: row.productName, qty: row.orderQty, status: row.status, paymentDate: row.paymentDate }],
          });
        }
      }

      // 管理番号の先頭数字を抽出する関数
      // etc フィールド: "管理番号, 日付, 仕入先"
      function extractKey(etc?: string | null): string | null {
        if (!etc) return null;
        const raw = etc.split(",")[0]?.trim() ?? "";
        // 数字始まりまたは「在庫」始まりのみ対象
        if (!/^\d/.test(raw) && !/^在庫/.test(raw)) return null;
        // 先頭の数字部分を抽出（_ または - または 空白で区切る）
        return invoiceNoPrefixFromDeliveryNo(raw);
      }

      // 出庫 No から先頭数字を抽出する関数
      function extractKeyFromDeliveryNo(deliveryNo: string): string | null {
        return invoiceNoPrefixFromDeliveryNo(deliveryNo);
      }

      // キー別に集計マップを構築
      type GroupData = {
        key: string;
        partner: string;          // 取引先名（CSVから）
        csvOrderQty: number;      // CSVの発注数
        csvStatus: string;        // CSVの状況（complete等）
        manualComplete: boolean;  // 手動完了フラグ
        csvProducts: Array<{ name: string; qty: number; status: string; paymentDate: string }>;  // CSVの商品明細
        orderedCount: number;     // 発注済み数（ordered）
        purchasedCount: number;   // 入庫済み数（purchased）
        deliveredCount: number;   // 出庫済み数
        stockCount: number;       // 在庫数
        shipmentProgressSource: "sheet" | "delivery_history";
        purchaseItems: Array<{ purchaseId: number; num: string; title: string; quantity: number; status: string; managementNo: string }>;
        inventoryItems: Array<{ inventoryId: number; title: string; quantity: number; managementNo: string; etc: string; unitPrice: string; trackingNumber: string; supplierUrl: string; supplierName: string }>;
        deliveryItems: Array<{ deliveryNo: string; title: string; quantity: number; deliveredAt: string; managementNo: string; unitPrice: string; trackingNumber: string; supplierUrl: string; supplierName: string; tradeRecordId?: number | null; csvProductName?: string | null }>;
        sheetShipmentItems: Array<{ deliveryNo: string; title: string; quantity: number; deliveredAt: string; managementNo: string; unitPrice: string; trackingNumber: string; supplierUrl: string; supplierName: string; tradeRecordId?: number | null; csvProductName?: string | null }>;
      };

      const groups = new Map<string, GroupData>();

      function getOrCreate(key: string): GroupData {
        if (!groups.has(key)) {
          // CSVインボイスマップから取引先・発注数・状況を取得
          const csvData = csvInvoiceMap.get(key);
          // 全商品がcompleteならcomplete
          const allComplete = csvData?.products.length
            ? csvData.products.every(p => p.status === "complete")
            : false;
          groups.set(key, {
            key,
            partner: csvData?.partner ?? "その他",
            csvOrderQty: csvData?.totalOrderQty ?? 0,
            csvStatus: allComplete ? "complete" : "",
            manualComplete: manualCompleteSet.has(key),
            csvProducts: csvData?.products ?? [],
            orderedCount: 0,
            purchasedCount: 0,
            deliveredCount: 0,
            stockCount: 0,
            shipmentProgressSource: "delivery_history",
            purchaseItems: [],
            inventoryItems: [],
            deliveryItems: [],
            sheetShipmentItems: [],
          });
        }
        return groups.get(key)!;
      }

      // CSVインボイスマップにあるキーを先に登録（CSVのインボイスNoが存在するキーを必ず表示）
      for (const invoiceNo of Array.from(csvInvoiceMap.keys())) {
        getOrCreate(invoiceNo);
      }

      const invoiceNosWithShipmentSheetRows = new Set<string>();
      for (const [invoiceNo, entries] of shipmentProgressByInvoice.entries()) {
        const groupData = groups.get(invoiceNo);
        if (!groupData || entries.length === 0) continue;

        invoiceNosWithShipmentSheetRows.add(invoiceNo);
        groupData.deliveredCount = summarizeShipmentProgress(entries).shippedQty;
        groupData.shipmentProgressSource = "sheet";

        const productTotals = buildShipmentProgressProductTotals(
          groupData.csvProducts.map((product) => ({ name: product.name, qty: product.qty })),
          entries,
        );
        groupData.sheetShipmentItems = Array.from(productTotals.entries())
          .filter(([, total]) => total.shippedQty > 0)
          .map(([productName, total]) => ({
            deliveryNo: "スプシ発送管理",
            title: productName,
            quantity: total.shippedQty,
            deliveredAt: "",
            managementNo: "",
            unitPrice: "",
            trackingNumber: "",
            supplierUrl: "",
            supplierName: "",
            tradeRecordId: null,
            csvProductName: productName,
          }));
      }

      // 発注データを集計
      for (const purchase of allPurchases) {
        for (const item of purchase.purchase_items) {
          const key = extractKey(item.etc);
          if (!key) continue;
          const g = getOrCreate(key);
          const qty = parseFloat(item.quantity) || 1;
          if (purchase.status === "ordered") {
            g.orderedCount += qty;
          } else if (purchase.status === "purchased") {
            g.purchasedCount += qty;
          }
          // 発注一覧には未入庫の発注済み/発送済みだけを表示する。入庫済みは在庫一覧側で表示する。
          if (purchase.status !== "purchased") {
            g.purchaseItems.push({
              purchaseId: purchase.id,
              num: purchase.num,
              title: item.title,
              quantity: qty,
              status: purchase.status,
              managementNo: item.etc?.split(",")[0]?.trim() ?? "",
            });
          }
        }
      }

      // ============================================================
      // 在庫商品がCSV商品名にマッチするか判定する関数群
      // ============================================================

      // 周辺機器・アクセサリーキーワード（ゲーム機本体ではないものを除外）
      const ACCESSORY_KEYWORDS = [
        "タッチペン", "バッテリー", "ケース", "カバー", "ケーブル",
        "アダプター", "コントローラー", "スタンド", "プロテクター",
        "charger", "battery", "cable", "case", "stylus",
      ];
      function isAccessory(title: string): boolean {
        const t = title.toLowerCase();
        return ACCESSORY_KEYWORDS.some((kw) => t.includes(kw.toLowerCase()));
      }

      // 商品名から機種を抽出（長いパターンを優先）
      function extractModelFromTitle(title: string): string {
        const t = title.toLowerCase();
        if (t.includes("new 2ds ll") || t.includes("new2dsll")) return "New2DSLL";
        if (t.includes("vita 2000") || t.includes("vita2000") || (t.includes("vita") && t.includes("2000"))) return "Vita2000";
        if (t.includes("vita 1000") || t.includes("vita1000") || (t.includes("vita") && !t.includes("2000"))) return "Vita1000";
        if (t.includes("new 3ds ll") || t.includes("new 3dsll") || t.includes("new3ds ll") || t.includes("new3dsll")) return "New3DSLL";
        if ((t.includes("new 3ds") || t.includes("new3ds")) && !t.includes("ll")) return "New3DS";
        if (t.includes("2ds") && !t.includes("new") && !t.includes("ll")) return "2DS";
        if ((t.includes("3ds ll") || t.includes("3dsll")) && !t.includes("new")) return "3DSLL";
        if (t.includes("3ds") && !t.includes("ll") && !t.includes("new")) return "3DS";
        if (t.includes("ds lite") || t.includes("dslite")) return "DSLite";
        if (t.includes("dsi ll") || t.includes("dsi xl") || t.includes("dsill")) return "DSiLL";
        if (t.includes("dsi")) return "DSi";
        if (t.includes("psp")) return "PSP";
        if (t.includes("ps5")) return "PS5";
        if (t.includes("ps4")) return "PS4";
        return "";
      }

      // 商品名からカラー部分を抽出（メーカー名・機種名プレフィックスを除去）
      // 例: "toynet PS Vita2000 グレイシャー・ホワイト" -> "グレイシャー・ホワイト"
      function extractColorFromName(name: string): string {
        const trimmed = name.trim();
        // まずメーカー名・ブランド名プレフィックスを除去（先頭の非機種名ワードを除去）
        const brandPattern = /^(?:toynet|hori|pdp|cyber|nintendo|sony|sega|microsoft|\w+net)\s+/i;
        let working = trimmed.replace(brandPattern, "").trim();

        const modelPatterns = [
          /^new\s*2ds\s*ll\s*/i,
          /^new\s*3ds\s*ll\s*/i,
          /^new\s*3ds\s*/i,
          /^2ds\s*/i,
          /^3ds\s*ll\s*/i,
          /^3ds\s*/i,
          /^ds\s*lite\s*/i,
          /^dslite\s*/i,
          /^dsi\s*ll\s*/i,
          /^dsi\s*/i,
          /^ps\s*vita\s*2000\s*/i,
          /^ps\s*vita\s*1000\s*/i,
          /^ps\s*vita\s*/i,
          /^vita\s*2000\s*/i,
          /^vita\s*1000\s*/i,
          /^vita\s*/i,
          /^psp\s*(?:go\s*)?/i,
          /^ps5\s*/i,
          /^ps4\s*/i,
        ];
        // 元の文字列とブランド除去後の両方で試す
        for (const source of [working, trimmed]) {
          for (const pat of modelPatterns) {
            if (pat.test(source)) {
              const result = source.replace(pat, "").trim();
              if (result) return result;
            }
          }
        }
        // どのパターンにも一致しない場合は元の文字列をそのまま返す
        return trimmed;
      }

      // カラーが「ランダムカラー」か判定
      function isRandomColorName(colorName: string): boolean {
        const c = colorName.toLowerCase();
        return c.includes("ランダム") || c.includes("random") || c.includes("ramdom");
      }

      // カラーが「○○ベース」か判定し、ベース色を返す（例: "ホワイトベース" → "ホワイト"）
      function normalizeColorToken(value: string): string {
        return value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
      }

      function isColorlessRandomColorName(colorName: string): boolean {
        if (!colorName.normalize("NFKC").trim()) return true;
        const compact = normalizeColorToken(colorName);
        if (!compact) return false;
        if (/^(psp|pspgo|ps5|ps4|psvita|vita|vita1000|vita2000|new3dsll|new3ds|new2dsll|2ds|3dsll|3ds|dslite|dsill|dsi)$/.test(compact)) return true;
        if (/^\d{3,4}$/.test(compact)) return true;
        if (/^(?:\d{3,4})?(?:grade|rank)[abc]$/.test(compact)) return true;
        if (/^\d{3,4}(?:only|body|console|unit|set)$/.test(compact)) return true;
        return false;
      }

      function colorlessQualifierMatches(colorName: string, title: string, managementNo = ""): boolean {
        const compactColor = normalizeColorToken(colorName);
        const compactTarget = normalizeColorToken(`${title} ${managementNo}`);
        const version = compactColor.match(/(?:1000|2000|3000)/)?.[0];
        if (version && !compactTarget.includes(version)) return false;
        const grade = compactColor.match(/(?:grade|rank)([abc])/)?.[1];
        if (grade && !compactTarget.includes(`grade${grade}`) && !compactTarget.includes(`rank${grade}`)) return false;
        return true;
      }

      function isOtherColorName(colorName: string): boolean {
        const c = colorName.normalize("NFKC").trim().toLowerCase();
        return c === "other" ||
          c.includes("other color") ||
          c.includes("その他") ||
          c.includes("それ以外") ||
          c.includes("以外");
      }

      function hasLimitedEditionMarker(value: string | null | undefined): boolean {
        const v = (value ?? "").normalize("NFKC").toLowerCase();
        return v.includes("限定版") || v.includes("limited") || v.includes("special edition");
      }

      function extractBaseColor(colorName: string): string | null {
        const m = colorName.match(/^(.+?)ベース$/);
        return m ? m[1].trim() : null;
      }

      // 在庫商品名がCSV商品名にマッチするか判定（管理番号も参照可能）
      // csvProductName: CSVの商品名（例: "New3DS ランダムカラー"、"Vita 1000 レッド&ブルー"）
      // invTitle: Zaico在庫商品名（例: "Vita1000 コズミックレッド"）
      // invManagementNo: Zaico在庫管理番号（例: "369_ルカ_レッド_3/10"）
      function invMatchesCsvProduct(csvProductName: string, invTitle: string, invManagementNo?: string): boolean {
        const managementHints = extractManagementHints(invManagementNo, invTitle);
        return (
          suggestCsvProductNameFromHints("", managementHints, [{ name: csvProductName, qty: 1 }]) === csvProductName ||
          suggestCsvProductNameFromHints(invTitle, managementHints, [{ name: csvProductName, qty: 1 }]) === csvProductName
        );
      }

      // inventoryId -> 仕入情報マップ（入庫履歴の最新レコードを使用）
      // 在庫集計ループ前に構築する必要がある
      type PurchaseInfo = { unitPrice: string; trackingNumber: string; supplierUrl: string; supplierName: string };
      const purchaseInfoMap = new Map<number, PurchaseInfo>();
      const _deletedInvListForInfo = await getDeletedInventories(1000);
      const _purchaseHistListForInfo = await getPurchaseHistories(1000);
      for (const ph of _purchaseHistListForInfo) {
        if (ph.inventoryId && !purchaseInfoMap.has(ph.inventoryId)) {
          purchaseInfoMap.set(ph.inventoryId, {
            unitPrice: ph.unitPrice ?? "",
            trackingNumber: (ph as { trackingNumber?: string | null }).trackingNumber ?? "",
            supplierUrl: (ph as { supplierUrl?: string | null }).supplierUrl ?? "",
            supplierName: (ph as { supplierName?: string | null }).supplierName ?? "",
          });
        }
      }
      for (const del of _deletedInvListForInfo) {
        if (del.zaicoId && !purchaseInfoMap.has(del.zaicoId)) {
          const matchPh = _purchaseHistListForInfo.find((ph) => ph.inventoryId === del.zaicoId);
          if (matchPh) {
            purchaseInfoMap.set(del.zaicoId, {
              unitPrice: matchPh.unitPrice ?? "",
              trackingNumber: (matchPh as { trackingNumber?: string | null }).trackingNumber ?? "",
              supplierUrl: (matchPh as { supplierUrl?: string | null }).supplierUrl ?? "",
              supplierName: (matchPh as { supplierName?: string | null }).supplierName ?? "",
            });
          }
        }
      }

      // local_inventoriesからzaicoIdベースの仕入先・仕入単価をフォールバックとして取得
      // 入庫履歴がない商品でもDBに同期済みの仕入先・仕入単価を表示するため
      const allInvZaicoIds = inventories
        .map((inv: { id: number }) => inv.id)
        .filter((id: number) => id > 0);
      const localInvInfoMap = await getLocalInventoryInfoByZaicoIds(allInvZaicoIds);
      // purchaseInfoMapにない商品はlocal_inventoriesから補完
      for (const [zaicoId, info] of Array.from(localInvInfoMap.entries())) {
        if (!purchaseInfoMap.has(zaicoId) && (info.unitPrice || info.supplierName || info.supplierUrl)) {
          purchaseInfoMap.set(zaicoId, {
            unitPrice: info.unitPrice,
            trackingNumber: "",
            supplierUrl: info.supplierUrl,
            supplierName: info.supplierName,
          });
        }
      }
      // 在庫データを集計（在庫0は除外）
      for (const inv of inventories) {
        const qty = parseFloat(inv.quantity) || 0;
        if (qty <= 0) continue;

        // 周辺機器・アクセサリーは除外
        if (isAccessory(inv.title)) continue;

        // まずetcフィールドからインボイスNoを抽出
        const keyFromEtc = extractKey(inv.etc);

        if (keyFromEtc) {
          // etcにインボイスNoがある場合: そのインボイスのCSV商品名と照合してマッチするもののみ追加
          const g = getOrCreate(keyFromEtc);
          const csvProducts = g.csvProducts;
          const invMgmtNo = inv.etc?.split(",")[0]?.trim() ?? "";
          // インボイスのCSV商品のいそれかにマッチする場合のみ追加（管理番号も渡す）
          const matches = csvProducts.length === 0 || csvProducts.some((cp) => invMatchesCsvProduct(cp.name, inv.title, invMgmtNo));
          if (matches) {
            g.stockCount += qty;
            const pInfo1 = purchaseInfoMap.get(inv.id) ?? { unitPrice: "", trackingNumber: "", supplierUrl: "", supplierName: "" };
            g.inventoryItems.push({
              inventoryId: inv.id,
              title: inv.title,
              quantity: qty,
              managementNo: invMgmtNo,
              etc: inv.etc ?? "",
              unitPrice: pInfo1.unitPrice,
              trackingNumber: pInfo1.trackingNumber,
              supplierUrl: pInfo1.supplierUrl,
              supplierName: pInfo1.supplierName,
            });
          }
        } else {
          // etcにインボイスNoがない場合: 商品名から機種を判定し、各インボイスのCSV商品名と照合
          const invModel = extractModelFromTitle(inv.title);
          if (!invModel) continue;

          for (const [, groupData] of Array.from(groups.entries())) {
            // CSV商品がないインボイスはスキップ（CSVにないインボイスに在庫を結びつけない）
            if (groupData.csvProducts.length === 0) continue;
            // そのインボイスのCSV商品のいずれかにマッチするか確認（etcなしの場合管理番号は空文字列）
            const matchesCsv = groupData.csvProducts.some((cp) => invMatchesCsvProduct(cp.name, inv.title, ""));
            if (matchesCsv) {
              groupData.stockCount += qty;
              const pInfo2 = purchaseInfoMap.get(inv.id) ?? { unitPrice: "", trackingNumber: "", supplierUrl: "", supplierName: "" };
              groupData.inventoryItems.push({
                inventoryId: inv.id,
                title: inv.title,
                quantity: qty,
                managementNo: inv.etc?.split(",")[0]?.trim() ?? "",
                etc: inv.etc ?? "",
                unitPrice: pInfo2.unitPrice,
                trackingNumber: pInfo2.trackingNumber,
                supplierUrl: pInfo2.supplierUrl,
                supplierName: pInfo2.supplierName,
              });
              break; // 最初に一致したインボイスに追加
            }
          }
        }
      }

      // 出庫履歴データを集計
      // 削除済み在庫・入庫履歴からも管理番号を補完
      const deletedInvList = await getDeletedInventories(1000);
      const purchaseHistList = await getPurchaseHistories(1000);
      // inventoryId -> etc のマップ（現在在庫 + 削除済み在庫 + 入庫履歴のkanriNoで補完）
      const inventoryEtcMap = new Map<number, string>(inventories.map((inv: { id: number; etc?: string | null }) => [inv.id, inv.etc ?? ""]));
      // 削除済み在庫のetcを追加（zaicoIdをキーとして使用）
      for (const del of deletedInvList) {
        if (del.zaicoId && del.etc && !inventoryEtcMap.has(del.zaicoId)) {
          inventoryEtcMap.set(del.zaicoId, del.etc);
        }
      }
      // 入庫履歴のkanriNoを追加（inventoryIdをキーとして使用）
      for (const ph of purchaseHistList) {
        if (ph.inventoryId && ph.kanriNo && !inventoryEtcMap.has(ph.inventoryId)) {
          inventoryEtcMap.set(ph.inventoryId, ph.kanriNo);
        }
      }
      const assignedInvoiceNoMap = await buildAssignedInvoiceNoMap().catch(() => new Map<string, string>());
      for (const delivery of deliveries) {
        if (delivery.status !== "success") continue;

        const deliveryKey = extractKeyFromDeliveryNo(delivery.deliveryNo);
        const items = JSON.parse(delivery.itemsJson) as Array<{ inventoryId: number; labelId?: string | null; title: string; quantity: number; managementNo?: string | null; tradeRecordId?: number | null; csvProductName?: string | null }>;
        const cancelledItems = delivery.cancelledItemsJson
          ? (JSON.parse(delivery.cancelledItemsJson) as Array<{ inventoryId: number; quantity: number; cancelledAt: string }>)
          : [];
        const cancelledQtyByInventoryId = new Map<number, number>();
        for (const cancelled of cancelledItems) {
          cancelledQtyByInventoryId.set(
            cancelled.inventoryId,
            (cancelledQtyByInventoryId.get(cancelled.inventoryId) ?? 0) + cancelled.quantity
          );
        }

        for (const item of items) {
          const cancelledQty = Math.min(item.quantity, cancelledQtyByInventoryId.get(item.inventoryId) ?? 0);
          if (cancelledQty > 0) {
            cancelledQtyByInventoryId.set(item.inventoryId, (cancelledQtyByInventoryId.get(item.inventoryId) ?? 0) - cancelledQty);
          }
          const activeQuantity = item.quantity - cancelledQty;
          if (activeQuantity <= 0) continue;

          const etc = inventoryEtcMap.get(item.inventoryId) ?? "";
          const rawMgmt = etc.split(",")[0]?.trim() ?? "";
          // 出庫Noから読めない箱ID出庫（B000002 など）は、明細ごとの管理番号で振り分ける。
          // 出庫Noに宛先が書いてあるときはそちらが優先（在庫を別インボイスへ充てる運用があるため）。
          const assigned = normalizeAssignedInvoiceNo(
            assignedInvoiceNoMap.get(String(item.labelId ?? "").trim().toUpperCase()),
          );
          const key = assigned ?? deliveryKey ?? resolveDeliveryItemInvoiceNo(item, delivery.deliveryNo, rawMgmt);
          if (!key) continue;

          const g = getOrCreate(key);
          if (!invoiceNosWithShipmentSheetRows.has(key)) {
            g.deliveredCount += activeQuantity;
          }
          // 管理番号として有効な形式: 「在庫」始まり、または3、4桁の数字始まり（例: 371_ルカ_1/5、在庫0408_1）
          const isValidMgmt = /^在庫/.test(rawMgmt) || /^ebay/i.test(rawMgmt) || /^\d{3,4}[^\d]/.test(rawMgmt) || /^\d{3,4}$/.test(rawMgmt);
          const managementNo = isValidMgmt ? rawMgmt : "";
          const pInfo3 = purchaseInfoMap.get(item.inventoryId) ?? { unitPrice: "", trackingNumber: "", supplierUrl: "", supplierName: "" };
          g.deliveryItems.push({
            deliveryNo: delivery.deliveryNo,
            title: item.title,
            quantity: activeQuantity,
            deliveredAt: delivery.createdAt.toISOString(),
            managementNo,
            unitPrice: pInfo3.unitPrice,
            trackingNumber: pInfo3.trackingNumber,
            supplierUrl: pInfo3.supplierUrl,
            supplierName: pInfo3.supplierName,
            tradeRecordId: item.tradeRecordId ?? null,
            csvProductName: item.csvProductName,
          });
        }
      }

      const summaries = Array.from(groups.values()).map((g) => {
        const isAutoComplete = g.csvOrderQty > 0 && g.deliveredCount >= g.csvOrderQty;
        const isComplete = g.manualComplete || g.csvStatus === "complete" || isAutoComplete;
        if (!isComplete) return g;
        return {
          ...g,
          csvProducts: g.csvProducts.map((p) => ({ ...p, status: "complete" })),
        };
      });

       // キーの昇順でソートして返却
      return summaries.sort((a, b) => {
        const na = parseInt(a.key, 10);
        const nb = parseInt(b.key, 10);
        return na - nb;
      });
    }),

    /**
     * 未完了インボイス一覧を返す（出庫登録フォーム用）
     * 完了判定: manualComplete || csvStatus=complete || deliveredCount >= csvOrderQty
     */
    getIncompleteInvoices: publicProcedure.query(async () => {
      try {
        type CsvRow = { partner: string; invoiceNo: string; status: string; };
        const rows: CsvRow[] = (await getOrderRowsFromTradeRecords()).map(({ partner, invoiceNo, status }) => ({ partner, invoiceNo, status }));
        // 完了ステータス以外を未完了として返す
        const allMemos = await getAllInvoiceMemos();
        const manualCompleteSet = new Set<string>(
          allMemos
            .filter((m) => m.colorKey === "__manual_complete__" && m.memo === "1")
            .map((m) => m.invoiceKey)
        );
        // invoiceNoごとに集約（同一invoiceNoの行が複数ある場合）
        const invoiceMap = new Map<string, { partner: string; allComplete: boolean }>();
        for (const row of rows) {
          const existing = invoiceMap.get(row.invoiceNo);
          const rowComplete = row.status.toLowerCase() === "complete";
          if (!existing) {
            invoiceMap.set(row.invoiceNo, { partner: row.partner, allComplete: rowComplete });
          } else {
            if (!rowComplete) existing.allComplete = false;
          }
        }
        // 未完了のみ抽出（手動完了フラグがなかつcsvStatusが完了でない）
        const incomplete: { invoiceNo: string; partner: string }[] = [];
        for (const [invoiceNo, data] of Array.from(invoiceMap.entries())) {
          if (!manualCompleteSet.has(invoiceNo) && !data.allComplete) {
            incomplete.push({ invoiceNo, partner: data.partner });
          }
        }
        // invoiceNoの降順で返す（新しいものが先）
        return incomplete.sort((a, b) => parseInt(b.invoiceNo, 10) - parseInt(a.invoiceNo, 10));
      } catch (err) {
        console.error("getIncompleteInvoices error:", err);
        return [];
      }
    }),
  }),
  // 削除済み商品管理
  deletedItems: router({
    // 削除済み商品一覧取得
    list: protectedProcedure.query(async () => {
      return getDeletedInventories();
    }),
    // 在庫商品を削除してDBに保存
    deleteAndRecord: protectedProcedure
      .input(z.object({
        zaicoId: z.number(),
        title: z.string(),
        category: z.string().optional(),
        place: z.string().optional(),
        quantity: z.string().optional(),
        unit: z.string().optional(),
        unitPrice: z.string().optional(),
        etc: z.string().optional(),
        snapshotJson: z.string(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
        deletedBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const token = resolveOperatorToken(input.operatorKey);
        // Zaicoから削除
        const localInv = await getLocalInventoryByZaicoIdOrId(input.zaicoId);
        if (localInv) {
          await deleteLocalInventory(localInv.id);
        }
        // DBに履歴を保存
        await createDeletedInventory({
          zaicoId: input.zaicoId,
          title: input.title,
          category: input.category ?? null,
          place: input.place ?? null,
          quantity: input.quantity ?? null,
          unit: input.unit ?? null,
          unitPrice: input.unitPrice ?? null,
          etc: input.etc ?? null,
          snapshotJson: input.snapshotJson,
          deletedBy: input.deletedBy ?? null,
        });
        return { success: true };
      }),
    // 削除済み商品を復元（Zaicoに再登録）
    restore: protectedProcedure
      .input(z.object({
        id: z.number(),
        operatorKey: z.enum(["default", "A", "B"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const records = await getDeletedInventories(1000);
        const record = records.find(r => r.id === input.id);
        if (!record) throw new Error("削除済み商品が見つかりません");
        const snapshot = JSON.parse(record.snapshotJson);
        await upsertLocalInventory({
          zaicoId: record.zaicoId ?? null,
          title: String(snapshot.title ?? record.title),
          quantity: Math.round(parseFloat(String(snapshot.quantity ?? record.quantity ?? "0")) || 0),
          unit: snapshot.unit ?? record.unit ?? "個",
          category: snapshot.category ?? record.category ?? null,
          place: snapshot.place ?? record.place ?? null,
          etc: snapshot.etc ?? record.etc ?? null,
          unitPrice: snapshot.unit_price != null ? String(snapshot.unit_price) : record.unitPrice ?? null,
          supplierUrl: null,
          supplierName: null,
          isDeleted: 0,
        });
        await removeDeletedInventory(input.id);
        return { success: true };
        const token = resolveOperatorToken(input.operatorKey);
        // Zaicoに再登録
        await createInventory({
          title: snapshot.title,
          quantity: snapshot.quantity ? String(snapshot.quantity) : "0",
          unit: snapshot.unit,
          category: snapshot.category,
          place: snapshot.place,
          etc: snapshot.etc,
          purchase_unit_price: snapshot.unit_price != null ? parseFloat(snapshot.unit_price) : undefined,
        }, token);
        // DBから削除済みレコードを削除
        await removeDeletedInventory(input.id);
        return { success: true };
      }),
    // DBから削除済みレコードを永久削除
    permanentDelete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await removeDeletedInventory(input.id);
        return { success: true };
    }),
  }),

  // 復元管理
  restoreManagement: router({
    search: protectedProcedure
      .input(z.object({
        query: z.string().max(200).optional(),
        limit: z.number().int().positive().max(200).default(80),
      }))
      .query(async ({ input, ctx }) => {
        if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "復元管理は管理者のみ利用できます" });
        }

        const q = normalizeRestoreSearchText(input.query);
        const [inventories, deletedItems, memos] = await Promise.all([
          getLocalInventories(true),
          getDeletedInventories(500),
          getAllInventoryMemos(1000),
        ]);

        const inventoryByMemoId = new Map<number, LocalInventoryRow>();
        const inventorySummaries = inventories
          .filter((inventory) => !q || restoreSearchInventoryHaystack(inventory).includes(q))
          .slice(0, input.limit)
          .map((inventory) => {
            const memoInventoryId = inventory.zaicoId ?? inventory.id;
            inventoryByMemoId.set(memoInventoryId, inventory);
            return {
              id: inventory.id,
              zaicoId: inventory.zaicoId,
              memoInventoryId,
              title: inventory.title,
              category: inventory.category,
              quantity: inventory.quantity,
              unit: inventory.unit,
              unitPrice: inventory.unitPrice == null ? null : String(inventory.unitPrice),
              etc: inventory.etc,
              managementNo: getInventoryManagementNo(inventory.etc),
              supplierName: inventory.supplierName,
              supplierUrl: inventory.supplierUrl,
              isDeleted: Number(inventory.isDeleted ?? 0) === 1,
              itemLabels: (inventory.itemLabels ?? []).map((label) => ({
                labelId: label.labelId,
                status: label.status ?? null,
                legacyManagementNo: label.legacyManagementNo ?? null,
              })),
              updatedAt: inventory.updatedAt,
            };
          });

        for (const inventory of inventories) {
          inventoryByMemoId.set(inventory.zaicoId ?? inventory.id, inventory);
        }

        const deletedSummaries = deletedItems
          .filter((item) => !q || restoreSearchDeletedHaystack(item).includes(q))
          .slice(0, input.limit)
          .map((item) => ({
            id: item.id,
            zaicoId: item.zaicoId,
            title: item.title,
            category: item.category,
            quantity: item.quantity,
            unit: item.unit,
            unitPrice: item.unitPrice,
            etc: item.etc,
            managementNo: getInventoryManagementNo(item.etc),
            deletedBy: item.deletedBy,
            createdAt: item.createdAt,
          }));

        const matchedInventoryIds = new Set(inventorySummaries.map((inventory) => inventory.memoInventoryId));
        const fullSnapshotSummaries = memos
          .map((memo) => {
            const snapshot = parseFullRestoreSnapshotMemo(memo.memo);
            if (!snapshot) return null;
            const inventory = snapshot.inventory;
            const managementNo = inventory
              ? getInventoryManagementNo(inventory.etc)
              : getInventoryManagementNo(snapshot.purchases[0]?.managementNo);
            return {
              id: memo.id,
              zaicoInventoryId: memo.zaicoInventoryId,
              title: String(inventory?.title ?? snapshot.purchases[0]?.title ?? memo.title ?? ""),
              managementNo,
              source: snapshot.source,
              reason: snapshot.reason,
              capturedAt: snapshot.capturedAt,
              createdAt: memo.createdAt,
              inventoryLocalId: inventory?.id ?? null,
              hasInventory: Boolean(inventory),
              purchaseCount: snapshot.purchases.length,
              labelCount: uniqueFullRestoreLabels(snapshot).length,
              canRestore: Boolean(inventory || snapshot.purchases.length > 0),
              _matches: !q || fullRestoreSnapshotHaystack(memo, snapshot).includes(q),
            };
          })
          .filter((row): row is NonNullable<typeof row> => Boolean(row?._matches))
          .slice(0, input.limit)
          .map(({ _matches, ...row }) => row);

        const historySummaries = memos
          .filter((memo) => !parseFullRestoreSnapshotMemo(memo.memo))
          .map((memo) => {
            const inventory = inventoryByMemoId.get(memo.zaicoInventoryId);
            const fields = parsedRestoreFieldsForMemo(memo, inventory ?? null);
            const haystack = normalizeRestoreSearchText([
              memo.id,
              memo.zaicoInventoryId,
              memo.title,
              memo.changeType,
              memo.memo,
              memo.operatorName,
              inventory?.title,
              inventory?.etc,
              inventory ? getInventoryManagementNo(inventory.etc) : null,
            ].filter(Boolean).join(" "));
            return {
              id: memo.id,
              zaicoInventoryId: memo.zaicoInventoryId,
              inventoryLocalId: inventory?.id ?? null,
              title: inventory?.title ?? memo.title ?? "",
              managementNo: inventory ? getInventoryManagementNo(inventory.etc) : "",
              changeType: memo.changeType,
              quantityBefore: memo.quantityBefore,
              quantityAfter: memo.quantityAfter,
              quantityDelta: memo.quantityDelta,
              memo: memo.memo,
              operatorName: memo.operatorName,
              createdAt: memo.createdAt,
              fields,
              canRestore: Boolean(inventory && fields.length > 0),
              _matches: !q || haystack.includes(q) || matchedInventoryIds.has(memo.zaicoInventoryId),
            };
          })
          .filter((memo) => memo._matches)
          .slice(0, input.limit)
          .map(({ _matches, ...memo }) => memo);

        return {
          inventories: inventorySummaries,
          deletedItems: deletedSummaries,
          fullSnapshots: fullSnapshotSummaries,
          histories: historySummaries,
        };
      }),

    restoreDeleted: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "復元管理は管理者のみ利用できます" });
        }

        const records = await getDeletedInventories(1000);
        const record = records.find((item) => item.id === input.id);
        if (!record) throw new Error("削除済み商品が見つかりません");
        const snapshot = JSON.parse(record.snapshotJson);
        await upsertLocalInventory({
          zaicoId: record.zaicoId ?? null,
          title: String(snapshot.title ?? record.title),
          quantity: Math.max(0, Math.round(parseFloat(String(snapshot.quantity ?? record.quantity ?? "0")) || 0)),
          unit: snapshot.unit ?? record.unit ?? "個",
          category: snapshot.category ?? record.category ?? null,
          place: snapshot.place ?? record.place ?? null,
          etc: snapshot.etc ?? record.etc ?? null,
          unitPrice: snapshot.unit_price != null ? String(snapshot.unit_price) : record.unitPrice ?? null,
          supplierUrl: snapshot.supplierUrl ?? snapshot.supplier_url ?? null,
          supplierName: snapshot.supplierName ?? snapshot.supplier_name ?? null,
          ebayListingUrl: snapshot.ebayListingUrl ?? null,
          ebayOrderUrl: snapshot.ebayOrderUrl ?? null,
          ebayOrderStatus: normalizeEbayOrderStatus(snapshot.ebayOrderStatus ?? "normal"),
          isDeleted: 0,
        });
        await removeDeletedInventory(input.id);
        return { success: true };
      }),

    restoreFullSnapshot: protectedProcedure
      .input(z.object({ memoId: z.number().int().positive() }))
      .mutation(async ({ input, ctx }) => {
        if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "復元管理は管理者のみ利用できます" });
        }

        const memo = (await getAllInventoryMemos(2000)).find((row) => row.id === input.memoId);
        if (!memo) throw new Error("完全復元スナップショットが見つかりません");
        const snapshot = parseFullRestoreSnapshotMemo(memo.memo);
        if (!snapshot) throw new Error("この履歴は完全復元スナップショットではありません");

        const previousInventoryId = snapshot.inventory?.id == null ? null : Number(snapshot.inventory.id);
        const restoredInventoryId = await restoreInventoryFromFullSnapshot(snapshot.inventory);
        const purchaseIdMap = await restorePurchasesFromFullSnapshot(
          snapshot.purchases,
          previousInventoryId,
          restoredInventoryId,
        );
        const labelCount = await restoreLabelsFromFullSnapshot(
          snapshot,
          previousInventoryId,
          restoredInventoryId,
          purchaseIdMap,
        );

        if (labelCount === 0 && restoredInventoryId != null && snapshot.inventory) {
          await ensureInventoryItemLabelsForInventory({
            localInventoryId: restoredInventoryId,
            legacyManagementNo: getInventoryManagementNo(snapshot.inventory.etc),
            title: String(snapshot.inventory.title ?? ""),
            quantity: inventoryLabelQuantity(snapshot.inventory.quantity),
            status: inventoryInitialLabelStatus(snapshot.inventory.quantity),
            sourceKey: `inventory:${restoredInventoryId}`,
          }).catch(() => {});
        }
        if (labelCount === 0) {
          for (const purchase of snapshot.purchases) {
            const snapshotPurchaseId = Number(purchase.id ?? 0);
            const restoredPurchaseId = snapshotPurchaseId > 0 ? purchaseIdMap.get(snapshotPurchaseId) ?? snapshotPurchaseId : null;
            if (!restoredPurchaseId) continue;
            await ensureInventoryItemLabels({
              purchaseId: restoredPurchaseId,
              localInventoryId: purchase.localInventoryId == null ? restoredInventoryId : Number(purchase.localInventoryId),
              legacyManagementNo: getInventoryManagementNo(purchase.managementNo),
              title: String(purchase.title ?? snapshot.inventory?.title ?? ""),
              quantity: Math.max(1, Math.round(Number(purchase.quantity) || 1)),
              status: purchase.status === "purchased" ? "received" : "ordered",
              sourceKey: purchase.managementNo ? `management:${getInventoryManagementNo(purchase.managementNo)}` : null,
            }).catch(() => {});
          }
        }

        await recordInventoryChange({
          inventoryId: restoredInventoryId ?? memo.zaicoInventoryId,
          title: String(snapshot.inventory?.title ?? snapshot.purchases[0]?.title ?? memo.title ?? "完全復元"),
          changeType: "updated",
          source: "ui",
          note: `復元管理から完全復元スナップショット #${memo.id} を復元（入庫管理 ${snapshot.purchases.length}件 / 商品ID ${labelCount}件）`,
          operatorName: ctx.user.name ?? ctx.user.email ?? null,
        });

        return {
          success: true,
          restoredInventoryId,
          purchaseCount: snapshot.purchases.length,
          labelCount,
        };
      }),

    restoreFromHistory: protectedProcedure
      .input(z.object({
        localInventoryId: z.number().int().positive(),
        memoId: z.number().int().positive(),
      }))
      .mutation(async ({ input, ctx }) => {
        if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "復元管理は管理者のみ利用できます" });
        }

        const inventory = await getLocalInventoryById(input.localInventoryId);
        if (!inventory) throw new Error("復元対象の商品が見つかりません");
        const memoInventoryId = inventory.zaicoId ?? inventory.id;
        const memo = (await getInventoryMemos(memoInventoryId, 200)).find((row) => row.id === input.memoId);
        if (!memo) throw new Error("対象の変更履歴が見つかりません");

        const restored = parseInventoryRestoreMemo(memo.memo);
        const fields = (Object.keys(restored) as InventoryRestoreField[]).filter((field) =>
          INVENTORY_RESTORE_FIELDS.includes(field)
        );
        if (fields.length === 0) throw new Error("この履歴には復元できる変更前データがありません");

        const nextValues = {
          title: restored.title ?? inventory.title,
          quantity: restored.quantity == null
            ? inventory.quantity
            : Math.max(0, Math.round(Number(restored.quantity) || 0)),
          unit: restored.unit ?? inventory.unit,
          category: restored.category ?? inventory.category,
          place: restored.place ?? inventory.place,
          etc: restored.etc ?? inventory.etc,
          unitPrice: restored.unitPrice ?? inventory.unitPrice,
          supplierName: restored.supplierName ?? inventory.supplierName,
          supplierUrl: restored.supplierUrl ?? inventory.supplierUrl,
          ebayListingUrl: restored.ebayListingUrl ?? inventory.ebayListingUrl,
          ebayOrderUrl: restored.ebayOrderUrl ?? inventory.ebayOrderUrl,
          ebayOrderStatus: normalizeEbayOrderStatus(restored.ebayOrderStatus ?? inventory.ebayOrderStatus),
        };

        await updateLocalInventory(inventory.id, nextValues);
        await ensureInventoryItemLabelsForInventory({
          localInventoryId: inventory.id,
          legacyManagementNo: getInventoryManagementNo(nextValues.etc),
          title: nextValues.title,
          quantity: inventoryLabelQuantity(nextValues.quantity),
          status: inventoryInitialLabelStatus(nextValues.quantity),
          sourceKey: `inventory:${inventory.id}`,
        });
        await recordInventoryChange({
          inventoryId: memoInventoryId,
          title: nextValues.title,
          changeType: "updated",
          source: "ui",
          quantityBefore: inventory.quantity,
          quantityAfter: nextValues.quantity,
          note: `復元管理から変更履歴 #${memo.id} の変更前に復元`,
          operatorName: ctx.user.name ?? ctx.user.email ?? null,
        });

        return { success: true };
      }),
  }),

  // ============================================================
  // Zaico移行・連携設定
  // ============================================================
  migration: router({
    /**
     * Zaico連携の有効/無効状態を取得する
     */
    getZaicoEnabled: publicProcedure.query(async () => {
      return { enabled: await isZaicoEnabled() };
    }),
    /**
     * Zaico連携のON/OFFを切り替える
     */
    setZaicoEnabled: protectedProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ input }) => {
        await setSystemSetting("zaico_enabled", "false");
        return { success: true, enabled: false };
      }),
    /**
     * ZaicoデータをサイトDBにインポートする
     * 在庫データと発注データ（ordered/not_ordered）を全件取得してDBに保存する
     */
    importFromZaico: protectedProcedure.mutation(async () => {
      const results = { inventories: 0, purchases: 0, errors: [] as string[] };
      results.errors.push("Zaico API integration is disabled. Use CSV import or create records in this site.");
      return results;

      // 1. 在庫データをインポート
      try {
        const inventories = await getInventories(50); // 最大50ページ
        const extras = await getAllInventoryExtras();
        const extrasMap = new Map(extras.map((e) => [e.zaicoInventoryId, e]));

        for (const inv of inventories) {
          const extra = extrasMap.get(inv.id);
          await upsertLocalInventory({
            zaicoId: inv.id,
            title: inv.title,
            category: inv.category ?? null,
            place: inv.place ?? null,
            quantity: Math.round(parseFloat(inv.quantity) || 0),
            unit: inv.unit ?? "個",
            unitPrice: inv.unit_price != null ? String(inv.unit_price) : null,
            etc: inv.etc ?? null,
            supplierUrl: extra?.supplierUrl ?? null,
            supplierName: extra?.supplierName ?? null,
            isDeleted: 0,
          });
          results.inventories++;
        }
      } catch (err) {
        const msg = String(err);
        results.errors.push(`在庫インポートエラー: ${msg}`);
      }

      // 2. 発注データ（ordered/not_ordered）をインポート
      try {
        const purchases = await getPurchases();
        for (const p of purchases) {
          for (const item of p.purchase_items) {
            await upsertLocalPurchase({
              zaicoId: p.id * 10000 + item.id, // ユニークID: purchaseId*10000+itemId
              purchaseNum: p.num ?? null,
              status: item.status === "purchased" ? "purchased" : "ordered",
              itemsJson: JSON.stringify(p.purchase_items),
              localInventoryId: null,
              title: item.title,
              category: null,
              quantity: Math.round(parseFloat(item.quantity) || 1),
              unitPrice: item.unit_price != null ? String(item.unit_price) : null,
              managementNo: item.etc ?? null,
              purchaseDate: p.purchase_date ?? null,
              receivedDate: item.status === "purchased" ? (item.purchase_date ?? null) : null,
            });
            results.purchases++;
          }
        }
      } catch (err) {
        const msg = String(err);
        results.errors.push(`発注インポートエラー: ${msg}`);
      }

      return results;
    }),
    /**
     * インポート済みデータの件数を返す（進捗確認用）
     */
    getImportStats: publicProcedure.query(async () => {
      const [invCount, purCount] = await Promise.all([
        countLocalInventories(),
        countLocalPurchases(),
      ]);
      return { inventories: invCount, purchases: purCount };
    }),
    /**
     * Zaico CSVエクスポートデータをパースしてlocal_inventoriesに一括upsertする
     * フロントエンドからCSVテキストを送信する
     */
    importZaicoCsv: protectedProcedure
      .input(z.object({
        csvText: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        // CSVパース（Shift-JISはフロントエンド側でUTF-8に変換済みと想定）
        const lines = input.csvText.split(/\r?\n/);
        if (lines.length < 2) throw new Error("データがありません");

        // ヘッダー行の列名を取得
        const headerLine = lines[0];
        const headers = parseCSVLine(headerLine);
        const idxId = headers.indexOf("在庫ID");
        const idxTitle = headers.indexOf("物品名");
        const idxCategory = headers.indexOf("カテゴリ");
        const idxPlace = headers.indexOf("保管場所");
        const idxQty = headers.indexOf("数量");
        const idxUnit = headers.indexOf("単位");
        const idxNote = headers.indexOf("備考");
        const idxUnitPrice = headers.indexOf("仕入単価");

        if (idxId < 0 || idxTitle < 0) {
          throw new Error("必須列（在庫ID、物品名）が見つかりません。ヘッダー: " + headers.join(","));
        }

        const items: import("../../drizzle/schema").InsertLocalInventory[] = [];
        for (let i = 1; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;
          const cols = parseCSVLine(line);
          const zaicoIdRaw = idxId >= 0 ? cols[idxId]?.trim() : "";
          const title = idxTitle >= 0 ? cols[idxTitle]?.trim() : "";
          if (!title) continue;

          const zaicoId = zaicoIdRaw ? parseInt(zaicoIdRaw, 10) : null;
          const category = idxCategory >= 0 ? cols[idxCategory]?.trim() || null : null;
          const place = idxPlace >= 0 ? cols[idxPlace]?.trim() || null : null;
          const qtyRaw = idxQty >= 0 ? cols[idxQty]?.trim() : "0";
          const quantity = Math.round(parseFloat(qtyRaw || "0") || 0);
          const unit = idxUnit >= 0 ? cols[idxUnit]?.trim() || "個" : "個";
          const note = idxNote >= 0 ? cols[idxNote]?.trim() || null : null;
          const unitPriceRaw = idxUnitPrice >= 0 ? cols[idxUnitPrice]?.trim() : "";
          const unitPrice = unitPriceRaw ? unitPriceRaw : null;

          // 備考フィールドから管理番号と仕入先を抽出
          // パターン: "管理番号, YYYY-MM-DD HH:MM:SS, 仕入先名"
          let supplierName: string | null = null;
          let etc: string | null = note;
          if (note) {
            const noteParts = note.split(",").map((p: string) => p.trim());
            if (noteParts.length >= 3) {
              // 3パーツ形式: 管理番号, 日付, 仕入先
              supplierName = noteParts[2] || null;
              etc = noteParts[0] || null; // 管理番号のみをetcに保存
            }
          }

          items.push({
            zaicoId: zaicoId && !isNaN(zaicoId) ? zaicoId : null,
            title,
            category,
            place,
            quantity,
            unit,
            unitPrice,
            etc,
            supplierUrl: null,
            supplierName,
            isDeleted: 0,
          });
        }

        if (items.length === 0) throw new Error("インポート対象のデータがありません");

        const result = await bulkUpsertLocalInventoriesFromCsv(items);
        return {
          total: items.length,
          inserted: result.inserted,
          updated: result.updated,
          errors: result.errors.slice(0, 10), // 最大2件のエラーのみ返却
        };
      }),
  }),

  // ============================================================
  // 在庫メモ（inventory_memos）
  // ============================================================
  inventoryMemo: router({
    /** 在庫数変更時のメモを保存する */
    create: publicProcedure
      .input(z.object({
        zaicoInventoryId: z.number().int().positive(),
        title: z.string().optional(),
        changeType: z.enum(["increase", "decrease", "set"]),
        quantityBefore: z.number().int().optional(),
        quantityAfter: z.number().int().optional(),
        quantityDelta: z.number().int().optional(),
        memo: z.string().max(1000).optional(),
        operatorName: z.string().max(200).optional(),
      }))
      .mutation(async ({ input }) => {
        await createInventoryMemo({
          zaicoInventoryId: input.zaicoInventoryId,
          title: input.title ?? null,
          changeType: input.changeType,
          quantityBefore: input.quantityBefore ?? null,
          quantityAfter: input.quantityAfter ?? null,
          quantityDelta: input.quantityDelta ?? null,
          memo: input.memo ?? null,
          operatorName: input.operatorName ?? null,
        });
        return { success: true };
      }),
    /** 在庫別のメモ履歴を取得する */
    list: publicProcedure
      .input(z.object({
        zaicoInventoryId: z.number().int().positive(),
        limit: z.number().int().positive().max(100).default(50),
      }))
      .query(async ({ input }) => {
        return getInventoryMemos(input.zaicoInventoryId, input.limit);
      }),
    /** 全在庫のメモ履歴を取得する */
    listAll: publicProcedure
      .input(z.object({ limit: z.number().int().positive().max(1000).default(500) }))
      .query(async ({ input }) => {
        return getAllInventoryMemos(input.limit);
      }),
  }),

  // ============================================================
  // 日次在庫スナップショット（monthly_reports に [日次] ラベルで保存）
  // ============================================================
  snapshot: router({
    /**
     * 日次スナップショットの推移を返す。
     * 明細JSONは重いので、一覧では区分別サマリーだけに畳んで返す。
     */
    list: publicProcedure
      .input(z.object({ limit: z.number().int().positive().max(400).default(120) }).optional())
      .query(async ({ input }) => {
        const rows = await listDailySnapshots(input?.limit ?? 120);
        return rows.map(({ report, date }) => {
          let breakdown = null;
          try {
            const inventorySummary = JSON.parse(report.inventorySummaryJson ?? "[]");
            const invoiceList = JSON.parse(report.invoiceListJson ?? "[]");
            breakdown = buildSnapshotBreakdown(inventorySummary, invoiceList);
          } catch {
            breakdown = null;
          }
          return {
            id: report.id,
            date,
            label: report.label,
            createdBy: report.createdBy,
            createdAt: report.createdAt,
            breakdown,
          };
        });
      }),

    /**
     * 手動でその日のスナップショットを保存する。
     * 画面が持っているプレビュー結果をそのまま渡す（preview を再計算すると重いため）。
     */
    capture: publicProcedure
      .input(z.object({
        inventorySummaryJson: z.string(),
        invoiceListJson: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        force: z.boolean().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const preview = {
          inventorySummary: JSON.parse(input.inventorySummaryJson),
          invoiceList: JSON.parse(input.invoiceListJson),
        };
        return captureDailySnapshot(preview, {
          date: input.date,
          force: input.force,
          createdBy: (ctx as { user?: { name?: string } }).user?.name ?? "manual",
        });
      }),
  }),

  // ============================================================
  // 月次棚卸しレポート（monthly_reports）
  // ============================================================
  monthlyReport: router({
    /**
     * 月次レポート生成用データを取得する（保存はしない）
     * - 在庫金額サマリー（カテゴリ×商品別）
     * - 支払い済み・未完了インボイス一覧（G列販売価格・H列通貨込み）
     * - 各インボイスの発注済み商品・在庫商品リスト（仕入単価付き）
     * - 備考欄からtoynet等の国内卸使用情報を解析
     */
    preview: publicProcedure.query(async () => {
      // 1-3. 在庫一覧・発注一覧・インボイスメモ・CSV・DB出庫履歴を並列取得して処理時間を短縮
      const zaicoEnabledForReport = await isZaicoEnabled();
      const getInventoriesForReport = async () => {
        if (zaicoEnabledForReport) return getInventories();
        const [localInvs, dbDateMap] = await Promise.all([
          getLocalInventories(),
          getLatestPurchaseDateMapFromDB(),
        ]);
        return localInvs.map((inv) => ({
          id: inv.zaicoId ?? inv.id,
          title: inv.title,
          quantity: String(inv.quantity ?? 0),
          unit_price: inv.unitPrice != null ? Number(inv.unitPrice) : null,
          category: inv.category ?? null,
          categories: inv.category ? [inv.category] : [],
          etc: inv.etc ?? null,
          optional_attributes: [] as Array<{ name: string; value: string | null }>,
          last_purchase_date: dbDateMap[inv.zaicoId ?? inv.id] ?? null,
        }));
      };
      const getPurchasesForReport = async () => {
        if (zaicoEnabledForReport) return getAllPurchases();
        const localPurchaseRows = await getLocalPurchases();
        return localPurchaseRows.map((purchase) => {
          let items: Array<Record<string, unknown>> = [];
          try {
            const parsed = JSON.parse(purchase.itemsJson ?? "[]");
            if (Array.isArray(parsed)) items = parsed;
          } catch {
            items = [];
          }
          if (items.length === 0) {
            items = [{
              id: purchase.id,
              title: purchase.title,
              quantity: purchase.quantity,
              unit_price: purchase.unitPrice,
              etc: purchase.managementNo,
              status: purchase.status,
            }];
          }
          return {
            id: purchase.zaicoId ?? purchase.id,
            num: purchase.purchaseNum ?? purchase.managementNo ?? String(purchase.id),
            purchase_items: items.map((item, index) => ({
              id: Number(item.id ?? purchase.zaicoId ?? purchase.id + index),
              title: String(item.title ?? purchase.title ?? ""),
              quantity: String(item.quantity ?? purchase.quantity ?? 1),
              unit_price: item.unit_price ?? item.unitPrice ?? purchase.unitPrice ?? null,
              etc: item.etc ?? purchase.managementNo ?? null,
              status: purchase.status === "purchased" ? "purchased" : "ordered",
              inventory_id: item.inventory_id ?? item.inventoryId ?? purchase.localInventoryId ?? null,
            })),
          };
        });
      };
      const [inventories, allPurchases, allMemos, allDeliveriesForParallel, orderRows, localPurchaseUnitPriceMap, allPurchaseHistories] = await Promise.all([
        getInventoriesForReport(),
        getPurchasesForReport(),
        getAllInvoiceMemos(),
        getAllDeliveryHistories().catch(() => []),
        getOrderRowsFromTradeRecords().catch(() => []),
        getLocalPurchaseUnitPriceMap().catch(() => new Map<string, number>()),
        getPurchaseHistories(2000).catch(() => []),
      ]);
      const invoiceMemoMap = new Map<string, string>();
      for (const m of allMemos) {
        if (m.colorKey === "__invoice__") invoiceMemoMap.set(m.invoiceKey, m.memo);
      }
      // 手動完了セット
      const manualCompleteSet = new Set<string>(
        allMemos.filter((m) => m.colorKey === "__manual_complete__" && m.memo === "1").map((m) => m.invoiceKey)
      );

      // 4. CSVからインボイス情報取得（G列販売価格・H列通貨・D列支払日込み）
      type CsvInvoiceRow = {
        partner: string;
        invoiceNo: string;
        paymentDate: string;
        productName: string;
        orderQty: number;
        sellingPrice: number | null;
        currency: string;
        rowStatus: string; // 行単位のstatus
      };
      const csvRows: CsvInvoiceRow[] = [];
      try {
        csvRows.push(
          ...orderRows.map((row) => ({
            partner: row.partner,
            invoiceNo: row.invoiceNo,
            paymentDate: row.paymentDate,
            productName: row.productName,
            orderQty: row.orderQty,
            sellingPrice: row.sellingPrice,
            currency: row.currency,
            rowStatus: row.status === "complete" ? "complete" : "",
          })),
        );
      } catch (e) {
        console.error("Trade order data error:", e);
      }

      // 5. CSVインボイスマップ構築
      // 完了判定: 全行がcompleteの場合のみインボイス全体をcomplete扱い
      type CsvInvoiceSummary = {
        partner: string;
        paymentDate: string;
        products: Array<{ name: string; qty: number; sellingPrice: number | null; currency: string; tradeAmount: number | null }>;
        totalOrderQty: number;
        allRowsComplete: boolean; // 全行completeか
        hasAnyRow: boolean;
      };
      const csvInvoiceMap = new Map<string, CsvInvoiceSummary>();
      for (const row of csvRows) {
        const tradeAmount = row.sellingPrice != null ? row.sellingPrice * row.orderQty : null;
        const existing = csvInvoiceMap.get(row.invoiceNo);
        if (existing) {
          existing.totalOrderQty += row.orderQty;
          existing.products.push({ name: row.productName, qty: row.orderQty, sellingPrice: row.sellingPrice, currency: row.currency, tradeAmount });
          // 1行でも未完了があればallRowsCompleteをfalseに
          if (row.rowStatus !== "complete") existing.allRowsComplete = false;
        } else {
          csvInvoiceMap.set(row.invoiceNo, {
            partner: row.partner,
            paymentDate: row.paymentDate,
            products: [{ name: row.productName, qty: row.orderQty, sellingPrice: row.sellingPrice, currency: row.currency, tradeAmount }],
            totalOrderQty: row.orderQty,
            allRowsComplete: row.rowStatus === "complete",
            hasAnyRow: true,
          });
        }
      }

      // 6. 在庫金額サマリー（カテゴリ×商品別）
      type InventorySummaryItem = {
        category: string;
        managementNo: string;
        title: string;
        quantity: number;
        unitPrice: number | null;
        totalValue: number | null;
      };
      const inventorySummary: InventorySummaryItem[] = [];
      for (const inv of inventories) {
        const qty = typeof inv.quantity === "number" ? inv.quantity : parseInt(String(inv.quantity), 10) || 0;
        if (qty <= 0) continue;
        let unitPrice: number | null = null;
        if (inv.optional_attributes) {
          const priceAttr = inv.optional_attributes.find((a: { name: string; value: string | null }) => a.name === "仕入単価");
          if (priceAttr?.value) unitPrice = parseMoneyNumber(priceAttr.value);
        }
        if (unitPrice == null && inv.unit_price != null) {
          unitPrice = parseMoneyNumber(inv.unit_price);
        }
        const category = inv.categories?.[0] ?? inv.category ?? "未分類";
        const managementNo = String(inv.etc ?? "").split(",")[0]?.trim() ?? "";
        inventorySummary.push({ category, managementNo, title: inv.title, quantity: qty, unitPrice, totalValue: unitPrice != null ? unitPrice * qty : null });
      }
      inventorySummary.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title) || a.managementNo.localeCompare(b.managementNo, "ja", { numeric: true }));

      // 7. Zaico発注をinvoiceNoでグループ化
      type PurchaseItemForReport = { zaicoId: number; title: string; quantity: number; unitPrice: number | null; managementNo: string; status: string };
      type StockItemForReport = { inventoryId: number; title: string; quantity: number; unitPrice: number | null; managementNo: string; category: string };
      type DeliveryItemForReport2 = { inventoryId: number; title: string; quantity: number; unitPrice: number | null; managementNo: string; deliveredAt: string; deliveryNo: string };
      type InvoiceForReport = {
        invoiceNo: string; partner: string; paymentDate: string;
        products: Array<{ name: string; qty: number; sellingPrice: number | null; currency: string; tradeAmount: number | null }>;
        totalOrderQty: number;
        purchaseItems: PurchaseItemForReport[];
        stockItems: StockItemForReport[];
        deliveryItems: DeliveryItemForReport2[];
        domesticNote: string | null;
        totalPurchaseCost: number | null;
        totalStockCost: number | null;
      };

      // 「テスト」を含む発注済み商品を除外するヘルパー
      const isTestItem = (title: string, etc: string | undefined | null): boolean => {
        const lowerTitle = title.toLowerCase();
        const lowerEtc = (etc ?? "").toLowerCase();
        return lowerTitle.includes("テスト") || lowerTitle.includes("test") ||
               lowerEtc.includes("テスト") || lowerEtc.includes("test");
      };

      const purchaseByInvoice = new Map<string, PurchaseItemForReport[]>();
      for (const p of allPurchases) {
        // 各purchase_item[].etcの先頭数字をインボイスNoとして紐付け
        // purchase_items[].etc = "372_ルカ_ブラック_8/10" のような管理番号
        for (const pItem of p.purchase_items) {
          const title = String(pItem.title ?? "");
          const itemEtc = typeof pItem.etc === "string" ? pItem.etc : "";
          const purchaseNum = typeof p.num === "string" ? p.num : String(p.num ?? "");
          // 「テスト」を含む商品は月次棚卸しから除外
          if (isTestItem(title, itemEtc)) continue;
          // status=ordered（未入庫）のみ表示（入庫済み=purchasedは除外）
          if (pItem.status !== "ordered") continue;
          // pItem.etcが設定されていればそこから、なければp.num（発注No）から抽出
          const itemEtcFirstPart = itemEtc.split(",")[0]?.trim() ?? "";
          const itemEtcInvoiceNo = invoiceNoPrefixFromDeliveryNo(itemEtcFirstPart);
          const numInvoiceNo = invoiceNoPrefixFromDeliveryNo(purchaseNum);
          const invoiceNo = itemEtcInvoiceNo ?? numInvoiceNo;
          if (!invoiceNo) continue;
          const managementNo = itemEtcInvoiceNo ? itemEtcFirstPart : purchaseNum;
          let unitPrice: number | null = null;
          const upStr = pItem.unit_price != null ? String(pItem.unit_price) : "";
          if (upStr) unitPrice = parseMoneyNumber(upStr);
          // Zaicoの仕入単価が未設定の場合、ローカルDB（local_purchases）の管理番号で補完
          if (unitPrice == null && managementNo) {
            unitPrice = localPurchaseUnitPriceMap.get(managementNo) ?? null;
          }
          const item: PurchaseItemForReport = { zaicoId: Number(pItem.id), title, quantity: parseInt(String(pItem.quantity), 10) || 0, unitPrice, managementNo, status: pItem.status };
          const arr = purchaseByInvoice.get(invoiceNo) ?? [];
          arr.push(item);
          purchaseByInvoice.set(invoiceNo, arr);
        }
      }

      // csvInvoiceMapから支払済み・未完了のインボイスNoセットを構築（在庫一覧の絞り込みに使用）
      const invoiceNoSet = new Set<string>();
      for (const [invoiceNo, csvInvoice] of Array.from(csvInvoiceMap.entries())) {
        if (!csvInvoice.paymentDate) continue; // 支払日なし = 未払いは除外
        if (manualCompleteSet.has(invoiceNo) || csvInvoice.allRowsComplete) continue; // 完了済みは除外
        invoiceNoSet.add(invoiceNo);
      }

      const stockByInvoice = new Map<string, StockItemForReport[]>();
      for (const inv of inventories) {
        const mgmtNo = inv.etc ?? "";
        const firstPart = mgmtNo.split(",")[0]?.trim() ?? "";
        const invoiceNo = invoiceNoPrefixFromDeliveryNo(firstPart);
        if (!invoiceNo) continue;
        // 対象インボイスNoに含まれる商品のみ表示
        if (!invoiceNoSet.has(invoiceNo)) continue;
        const qty = typeof inv.quantity === "number" ? inv.quantity : parseInt(String(inv.quantity), 10) || 0;
        if (qty <= 0) continue;
        let unitPrice: number | null = null;
        if (inv.optional_attributes) {
          const priceAttr = inv.optional_attributes.find((a: { name: string; value: string | null }) => a.name === "仕入単価");
          if (priceAttr?.value) unitPrice = parseMoneyNumber(priceAttr.value);
        }
        if (unitPrice == null && inv.unit_price != null) unitPrice = parseMoneyNumber(inv.unit_price);
        const category = inv.categories?.[0] ?? inv.category ?? "未分類";
        const item: StockItemForReport = { inventoryId: inv.id, title: inv.title, quantity: qty, unitPrice, managementNo: firstPart, category };
        const arr = stockByInvoice.get(invoiceNo) ?? [];
        arr.push(item);
        stockByInvoice.set(invoiceNo, arr);
      }

      // 8. 出庫履歴を全件取得してインボイスNoでグループ化
      type DeliveryItemForReport = {
        inventoryId: number;
        title: string;
        quantity: number;
        unitPrice: number | null;
        managementNo: string;
        deliveredAt: string;
        deliveryNo: string;
      };
      const deliveryByInvoice = new Map<string, DeliveryItemForReport[]>();
      try {
        // 並列取得済みのallDeliveriesForParallelを使用（重複取得なし）
        // まず全inventoryIdを収集してpurchase_historiesから仕入単価を一括取得
        const allDeliveryInventoryIds: number[] = [];
        for (const dh of allDeliveriesForParallel) {
          if (dh.status !== "success") continue;
          let items: Array<{ inventoryId: number; title: string; quantity: number; unitPrice?: number | null; etc?: string }> = [];
          try { items = JSON.parse(dh.itemsJson); } catch { continue; }
          for (const item of items) {
            if (item.inventoryId) allDeliveryInventoryIds.push(item.inventoryId);
          }
        }
        // purchase_historiesから仕入単価を一括取得（inventoryIdをキーに）
        const uniqueInventoryIds = Array.from(new Set(allDeliveryInventoryIds));
        // local_inventoriesからもzaicoIdベースで仕入単価を一括取得（purchase_historiesにない場合のフォールバック）
        // deleted_inventoriesからも取得（在庫削除後も仕入単価を保持するため）
        const [unitPriceMap, localInvUnitPriceMap, deletedInvUnitPriceMap] = await Promise.all([
          getUnitPricesByInventoryIds(uniqueInventoryIds),
          getLocalInventoryUnitPriceByZaicoIds(uniqueInventoryIds),
          getDeletedInventoryUnitPriceByZaicoIds(uniqueInventoryIds),
        ]);

        for (const dh of allDeliveriesForParallel) {
          if (dh.status !== "success") continue;
          let items: Array<{ inventoryId: number; title: string; quantity: number; unitPrice?: number | null; etc?: string }> = [];
          try { items = JSON.parse(dh.itemsJson); } catch { continue; }
          // deliveryNoからもインボイスNoを抽出（例: "372_luca20260326" → "372"）
          const deliveryNoInvoice = invoiceNoPrefixFromDeliveryNo(dh.deliveryNo);
          for (const item of items) {
            const mgmtNo = item.etc ?? "";
            const firstPart = mgmtNo.split(",")[0]?.trim() ?? "";
            const itemInvoiceNo = invoiceNoPrefixFromDeliveryNo(firstPart);
            // item.etcからマッチしない場合はdeliveryNoから抽出したinvoiceNoを使用
            const invoiceNo = itemInvoiceNo ?? deliveryNoInvoice;
            if (!invoiceNo) continue;
            // 仕入単価補完優先順位: itemsJson保存値 > purchase_histories > local_inventories > deleted_inventories
            const unitPrice = (item.unitPrice != null)
              ? item.unitPrice
              : (unitPriceMap.get(item.inventoryId) ?? localInvUnitPriceMap.get(item.inventoryId) ?? deletedInvUnitPriceMap.get(item.inventoryId) ?? null);
            const deliveryItem: DeliveryItemForReport = {
              inventoryId: item.inventoryId,
              title: item.title,
              quantity: item.quantity,
              unitPrice,
              managementNo: firstPart,
              deliveredAt: dh.createdAt instanceof Date ? dh.createdAt.toISOString() : String(dh.createdAt),
              deliveryNo: dh.deliveryNo,
            };
            const arr = deliveryByInvoice.get(invoiceNo) ?? [];
            arr.push(deliveryItem);
            deliveryByInvoice.set(invoiceNo, arr);
          }
        }
      } catch (e) {
        console.error("Delivery history fetch error:", e);
      }

      // 9a. 出庫済みinventoryIdのセットを構築（purchaseByInvoiceのフィルタリングに使用）
      const deliveredInventoryIds = new Set<number>();
      for (const items of Array.from(deliveryByInvoice.values())) {
        for (const di of items) {
          if (di.inventoryId) deliveredInventoryIds.add(di.inventoryId);
        }
      }

      // 9b. purchase_historiesから zaicoId→inventoryId のマップを構築
      // これにより purchaseByInvoice の zaicoId が出庫済みかどうか判定できる
      const purchaseZaicoIdToInventoryId = new Map<number, number>();
      for (const ph of allPurchaseHistories) {
        if (ph.cancelled === 0 && ph.zaicoId && ph.inventoryId) {
          purchaseZaicoIdToInventoryId.set(ph.zaicoId, ph.inventoryId);
        }
      }

      // 9c. purchaseByInvoice から出庫済み商品を除外
      for (const [invoiceNo, items] of Array.from(purchaseByInvoice.entries())) {
        const filtered = items.filter((pi: PurchaseItemForReport) => {
          const inventoryId = purchaseZaicoIdToInventoryId.get(pi.zaicoId);
          if (!inventoryId) return true; // 入庫履歴がない（未入庫）→ 発注済み商品として残す
          return !deliveredInventoryIds.has(inventoryId); // 出庫済みなら除外
        });
        if (filtered.length === 0) {
          purchaseByInvoice.delete(invoiceNo);
        } else {
          purchaseByInvoice.set(invoiceNo, filtered);
        }
      }

      // 9d. 入庫済み・未出庫の商品を stockByInvoice に追加
      // purchase_histories に記録があり、出庫済みでなく、Zaico在庫一覧に既に存在しない商品を追加
      // stockByInvoice に既にある inventoryId は重複追加しない
      const stockInventoryIds = new Set<number>();
      for (const items of Array.from(stockByInvoice.values())) {
        for (const si of items) stockInventoryIds.add(si.inventoryId);
      }

      for (const ph of allPurchaseHistories) {
        if (ph.cancelled !== 0) continue; // 取り消し済みは除外
        if (!ph.inventoryId) continue;
        if (deliveredInventoryIds.has(ph.inventoryId)) continue; // 出庫済みは除外
        if (stockInventoryIds.has(ph.inventoryId)) continue; // 既にZaico在庫一覧に存在する
        // 管理番号からインボイスNoを抽出
        const mgmtNo = ph.kanriNo ?? "";
        const firstPart = mgmtNo.split(",")[0]?.trim() ?? "";
        const invoiceNo = invoiceNoPrefixFromDeliveryNo(firstPart);
        if (!invoiceNo) continue;
        // 仕入単価
        const unitPrice = ph.unitPrice != null ? parseFloat(ph.unitPrice) : null;
        const qty = parseInt(String(ph.quantity), 10) || 0;
        if (qty <= 0) continue;
        const item: StockItemForReport = {
          inventoryId: ph.inventoryId,
          title: ph.title,
          quantity: qty,
          unitPrice,
          managementNo: firstPart,
          category: ph.category ?? "未分類",
        };
        const arr = stockByInvoice.get(invoiceNo) ?? [];
        arr.push(item);
        stockByInvoice.set(invoiceNo, arr);
        stockInventoryIds.add(ph.inventoryId); // 重複追加防止
      }

      // 9. 支払い済み・未完了インボイスを抽出
      const invoiceList: InvoiceForReport[] = [];
      for (const [invoiceNo, csvInvoice] of Array.from(csvInvoiceMap.entries())) {
        if (!csvInvoice.paymentDate) continue; // 支払日なし = 未払い
        // 完了判定: 全行completeまたは手動完了の場合のみ除外
        const isComplete = manualCompleteSet.has(invoiceNo) || csvInvoice.allRowsComplete;
        if (isComplete) continue; // 完了済みは除外
        const purchaseItems = purchaseByInvoice.get(invoiceNo) ?? [];
        const stockItems = stockByInvoice.get(invoiceNo) ?? [];
        const deliveryItems = deliveryByInvoice.get(invoiceNo) ?? [];
        const domesticNote = invoiceMemoMap.get(invoiceNo) ?? null;
        let totalPurchaseCost: number | null = null;
        for (const pi of purchaseItems) {
          if (pi.unitPrice != null) totalPurchaseCost = (totalPurchaseCost ?? 0) + pi.unitPrice * pi.quantity;
        }
        let totalStockCost: number | null = null;
        for (const si of stockItems) {
          if (si.unitPrice != null) totalStockCost = (totalStockCost ?? 0) + si.unitPrice * si.quantity;
        }
        invoiceList.push({ invoiceNo, partner: csvInvoice.partner, paymentDate: csvInvoice.paymentDate, products: csvInvoice.products, totalOrderQty: csvInvoice.totalOrderQty, purchaseItems, stockItems, deliveryItems, domesticNote, totalPurchaseCost, totalStockCost });
      }
      invoiceList.sort((a, b) => parseInt(a.invoiceNo) - parseInt(b.invoiceNo));

      return { inventorySummary, invoiceList };
    }),

    /** レポートを保存する */
    save: publicProcedure
      .input(z.object({
        yearMonth: z.string().max(7),
        label: z.string().max(200).optional(),
        inventorySummaryJson: z.string(),
        invoiceListJson: z.string(),
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await createMonthlyReport({
          yearMonth: input.yearMonth,
          label: input.label ?? null,
          inventorySummaryJson: input.inventorySummaryJson,
          invoiceListJson: input.invoiceListJson,
          createdBy: (ctx as { user?: { name?: string } }).user?.name ?? null,
        });
        return { id };
      }),

    /**
     * レポート一覧を取得する
     * 日次スナップショット（label が "[日次] " 始まり）は既定で除外する。
     * 月次の保存済み一覧に毎日の自動保存が混ざると使い物にならないため。
     */
    list: publicProcedure
      .input(z.object({ includeDaily: z.boolean().optional() }).optional())
      .query(async ({ input }) => {
        const reports = await getMonthlyReports(input?.includeDaily ? 50 : 400);
        if (input?.includeDaily) return reports;
        return reports.filter((report) => parseDailySnapshotDate(report.label) === null).slice(0, 50);
      }),

    /** レポート詳細を取得する */
    get: publicProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const report = await getMonthlyReportById(input.id);
        if (!report) return null;
        const costs = await getMonthlyReportCosts(input.id);
        return { ...report, costs };
      }),

    /** レポートを削除する */
    delete: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteMonthlyReport(input.id);
        return { success: true };
      }),

    /** 仕入れ単価を保存する（手入力分） */
    upsertCost: publicProcedure
      .input(z.object({
        reportId: z.number(),
        invoiceKey: z.string().max(50),
        itemKey: z.string().max(500),
        title: z.string().max(500).optional(),
        quantity: z.number().int(),
        unitPrice: z.number().nullable(),
        itemType: z.enum(["ordered", "stock"]).default("ordered"),
        isManual: z.boolean().default(false),
      }))
      .mutation(async ({ input }) => {
        const subtotal = input.unitPrice != null ? input.unitPrice * input.quantity : null;
        await upsertMonthlyReportCost({
          reportId: input.reportId,
          invoiceKey: input.invoiceKey,
          itemKey: input.itemKey,
          title: input.title ?? null,
          quantity: input.quantity,
          unitPrice: input.unitPrice != null ? String(input.unitPrice) : null,
          subtotal: subtotal != null ? String(subtotal) : null,
          itemType: input.itemType,
          isManual: input.isManual ? 1 : 0,
        });
        return { success: true };
      }),
  }),

  // ============================================================
  // インボイスメモ（invoice_memos）
  // ============================================================
  invoiceManualItem: router({
    /** 指定インボイスの手動入力行を取得 */
    list: publicProcedure
      .input(z.object({ invoiceNo: z.string().max(50) }))
      .query(async ({ input }) => {
        return getInvoiceManualItems(input.invoiceNo);
      }),
    /** 複数インボイスの手動入力行を一括取得 */
    listByInvoiceNos: publicProcedure
      .input(z.object({ invoiceNos: z.array(z.string().max(50)) }))
      .query(async ({ input }) => {
        return getInvoiceManualItemsByInvoiceNos(input.invoiceNos);
      }),
    /** 手動入力行を作成 */
    create: protectedProcedure
      .input(z.object({
        invoiceNo: z.string().max(50),
        title: z.string().max(500).default(""),
        quantity: z.number().int().min(1).default(1),
        unitPrice: z.number().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await createInvoiceManualItem({
          invoiceNo: input.invoiceNo,
          title: input.title,
          quantity: input.quantity,
          unitPrice: input.unitPrice ?? null,
          sortOrder: input.sortOrder,
        });
        return { success: true, insertId: (result as { insertId?: number }).insertId };
      }),
    /** 手動入力行を更新 */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int(),
        title: z.string().max(500).optional(),
        quantity: z.number().int().min(1).optional(),
        unitPrice: z.number().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        await updateInvoiceManualItem(input.id, {
          title: input.title,
          quantity: input.quantity,
          unitPrice: input.unitPrice ?? null,
        });
        return { success: true };
      }),
    /** 手動入力行を削除 */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteInvoiceManualItem(input.id);
        return { success: true };
      }),
  }),

  // ============================================================
  // 国内卸商品マスタ (domestic_products)
  // ============================================================
  domesticProduct: router({
    /** 国内卸商品マスタ一覧を取得 */
    list: publicProcedure.query(async () => {
      return getDomesticProducts();
    }),
    /** 国内卸商品マスタを作成 */
    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1).max(500),
        unitPrice: z.number().nullable().optional(),
        supplierName: z.string().max(200).nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await createDomesticProduct(input);
        return { success: true, insertId: (result as { insertId?: number }).insertId };
      }),
    /** 国内卸商品マスタを更新 */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int(),
        title: z.string().min(1).max(500).optional(),
        unitPrice: z.number().nullable().optional(),
        supplierName: z.string().max(200).nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateDomesticProduct(id, data);
        return { success: true };
      }),
    /** 国内卸商品マスタを削除 */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteDomesticProduct(input.id);
        return { success: true };
      }),
  }),

  // ============================================================
  // 月次棚卸し 国内卸発注行 (monthly_domestic_items)
  // ============================================================
  monthlyDomesticItem: router({
    /** 指定年月の国内卸発注行を取得 */
    list: publicProcedure
      .input(z.object({ yearMonth: z.string().max(7) }))
      .query(async ({ input }) => {
        return getMonthlyDomesticItems(input.yearMonth);
      }),
    /** 国内卸発注行を作成 */
    create: protectedProcedure
      .input(z.object({
        yearMonth: z.string().max(7),
        domesticProductId: z.number().int().nullable().optional(),
        title: z.string().max(500).default(""),
        quantity: z.number().int().min(1).default(1),
        unitPrice: z.union([z.number(), z.string().transform((v) => v === "" ? null : parseFloat(v))]).nullable().optional(),
        supplierName: z.string().max(200).nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const unitPrice = typeof input.unitPrice === "number" ? input.unitPrice : (input.unitPrice != null ? parseFloat(String(input.unitPrice)) : null);
        const result = await createMonthlyDomesticItem({ ...input, unitPrice });
        return { success: true, insertId: (result as { insertId?: number }).insertId };
      }),
    /** 国内卸発注行を更新 */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int(),
        title: z.string().max(500).optional(),
        quantity: z.number().int().min(1).optional(),
        unitPrice: z.number().nullable().optional(),
        supplierName: z.string().max(200).nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
        isPaid: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, isPaid, ...rest } = input;
        const data: Record<string, unknown> = { ...rest };
        if (isPaid !== undefined) data.isPaid = isPaid ? 1 : 0;
        await updateMonthlyDomesticItem(id, data);
        return { success: true };
      }),
    /** 国内卸発注行の支払済みフラグをトグル */
    togglePaid: protectedProcedure
      .input(z.object({ id: z.number().int(), isPaid: z.boolean() }))
      .mutation(async ({ input }) => {
        await updateMonthlyDomesticItem(input.id, { isPaid: input.isPaid ? 1 : 0 });
        return { success: true };
      }),
    /** 国内卸発注行を削除 */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteMonthlyDomesticItem(input.id);
        return { success: true };
      }),
  }),

  invoiceMemo: router({
    /** インボイスの商品種別メモを保存する（upsert） */
    upsert: publicProcedure
      .input(z.object({
        invoiceKey: z.string().max(50),
        colorKey: z.string().max(200),
        memo: z.string().max(2000),
      }))
      .mutation(async ({ input }) => {
        await upsertInvoiceMemo(input.invoiceKey, input.colorKey, input.memo);
        return { success: true };
      }),
    /** インボイスのメモ一覧を取得する */
    list: publicProcedure
      .input(z.object({ invoiceKey: z.string().max(50) }))
      .query(async ({ input }) => {
        return getInvoiceMemos(input.invoiceKey);
      }),
    /** 全インボイスのメモを取得する */
    listAll: publicProcedure.query(async () => {
      return getAllInvoiceMemos();
    }),
    /**
     * インボイスの手動完了フラグをセット/解除する
     * colorKey = "__manual_complete__" を使って invoice_memos に保存
     */
    setManualComplete: publicProcedure
      .input(z.object({
        invoiceKey: z.string().max(50),
        completed: z.boolean(),
      }))
      .mutation(async ({ input }) => {
        await upsertInvoiceMemo(input.invoiceKey, "__manual_complete__", input.completed ? "1" : "0");
        return { success: true };
      }),
  }),

  // ============================================================
  // 取引先マスタ
  // ============================================================
  customer: router({
    /** 取引先一覧を取得 */
    list: protectedProcedure.query(async () => {
      return getCustomers();
    }),
    /** 取引先を作成 */
    create: protectedProcedure
      .input(z.object({
        displayName: z.string().min(1).max(100),
        code: z.string().min(1).max(100),
        keywords: z.string().min(1).max(500),
        sortOrder: z.number().int().default(0),
      }))
      .mutation(async ({ input }) => {
        await createCustomer(input);
        return { success: true };
      }),
    /** 取引先を更新 */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int(),
        displayName: z.string().min(1).max(100).optional(),
        code: z.string().min(1).max(100).optional(),
        keywords: z.string().min(1).max(500).optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateCustomer(id, data);
        return { success: true };
      }),
    /** 取引先を削除 */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteCustomer(input.id);
        return { success: true };
      }),
  }),

  // ============================================================
  // 招待コード管理
  // ============================================================
  accessCode: router({
    /**
     * 招待コードを検証する（ログイン後のアクセス制限用）
     * コードが未設定の場合は常にtrueを返す
     */
    verify: protectedProcedure
      .input(z.object({ code: z.string() }))
      .mutation(async ({ input }) => {
        const storedCode = await getSystemSetting("access_code");
        if (!storedCode) return { valid: true }; // 未設定なら常に通過
        return { valid: input.code === storedCode };
      }),
    /**
     * 現在の招待コードが設定されているか確認する（コード値は返さない）
     * 管理者のみ利用可能
     */
    isSet: protectedProcedure.query(async ({ ctx }) => {
      if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "管理者のみ利用できます" });
      }
      const storedCode = await getSystemSetting("access_code");
      return { isSet: !!storedCode };
    }),
    /**
     * 招待コードを設定・変更する（設定画面用）
     * 管理者のみ利用可能
     */
    set: protectedProcedure
      .input(z.object({ code: z.string().max(100) }))
      .mutation(async ({ input, ctx }) => {
        if (!ADMIN_EMAILS.includes(ctx.user.email ?? "")) {
          throw new TRPCError({ code: "FORBIDDEN", message: "管理者のみ利用できます" });
        }
        if (input.code.trim() === "") {
          await setSystemSetting("access_code", "");
        } else {
          await setSystemSetting("access_code", input.code.trim());
        }
        return { success: true };
      }),
  }),

  // ============================================================
  // FedEx発送管理
  // ============================================================
  fedex: router({
    /**
     * 出庫Noに紐づくFedEx発送記録を取得する
     */
    getByDeliveryNo: protectedProcedure
      .input(z.object({ deliveryNo: z.string() }))
      .query(async ({ input }) => {
        return alignShipmentItemsWithDeliveryHistories(await getFedexShipmentsByDeliveryNo(input.deliveryNo));
      }),

    /**
     * 全FedEx発送記録を取得する
     */
    getAll: protectedProcedure.query(async () => {
      return alignShipmentItemsWithDeliveryHistories(await getAllFedexShipments());
    }),

    /**
     * 当日登録された追跡番号の一覧を返す（プルダウン再利用用）
     */
    getTodayTrackingNumbers: publicProcedure.query(async () => {
      const all = await getAllFedexShipments();
      const todayStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const todayRecords = all.filter((r) => {
        const d = new Date(r.createdAt);
        return d.toISOString().slice(0, 10) === todayStr;
      });
      // 重複除去して一覧返す
      const seen = new Set<string>();
      const result: Array<{ trackingNumber: string; sheetName: string }> = [];
      for (const r of todayRecords) {
        if (!seen.has(r.trackingNumber)) {
          seen.add(r.trackingNumber);
          result.push({ trackingNumber: r.trackingNumber, sheetName: r.sheetName });
        }
      }
      return result;
    }),

    /**
     * FedEx発送記録を登録し、GASを通じてスプシに書き込む
     */
    create: protectedProcedure
      .input(z.object({
        deliveryNo: z.string(),
        sheetName: shipmentSheetNameSchema,
        shippingDate: z.string(), // 例: "3/26"
        trackingNumber: z.string(),
        historyId: z.number().int().positive().optional(),
        items: z.array(z.object({
          productNameJa: z.string(),
          productNameEn: z.string(),
          quantity: z.number().int().positive(),
          managementNo: z.string().nullable().optional(),
        })),
        operatorName: z.string().max(200).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        type MergeItem = ShipmentGasItem;
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
        const invoiceNo = invoiceNoFromDeliveryNo(input.deliveryNo);
        const sourceItems = (await getShipmentItemsForHistory(input.historyId)) ?? input.items;
        const gasItems = await alignShipmentItemsToOrderRows(invoiceNo, sourceItems);
        const workOperatorName = resolveWorkOperatorName(input.operatorName, ctx.user.name ?? ctx.user.email ?? null);

        // GAS呼び出しヘルパー
        async function callGasWrite(items: MergeItem[]): Promise<{ success: boolean; message?: string }> {
          if (!gasUrl) return { success: false, message: "GAS_WEBHOOK_URLが未設定" };
          try {
            const payload = {
              secret, action: "writeShipmentBatch",
              deliveryNo: input.deliveryNo,
              invoiceNo,
              sheetName: input.sheetName,
              shippingDate: input.shippingDate,
              trackingNumber: input.trackingNumber,
              items,
            };
            const res = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "manual" });
            let text: string;
            if (res.status === 302 || res.status === 301) { const loc = res.headers.get("location") ?? gasUrl; const r2 = await fetch(loc, { method: "GET" }); text = await r2.text(); }
            else { text = await res.text(); }
            try { return JSON.parse(text); } catch { return { success: false, message: text }; }
          } catch (e) { return { success: false, message: e instanceof Error ? e.message : String(e) }; }
        }
        // 同一追跡番号かつ同一出庫Noの既存記録を確認
        const allRecords = await alignShipmentItemsWithDeliveryHistories(await getAllFedexShipments());
        const liveHistoryIds = await getLiveDeliveryHistoryIds();

        function parseShipmentRecordItems(itemsJson: string): MergeItem[] {
          try {
            return JSON.parse(itemsJson) as MergeItem[];
          } catch {
            return [];
          }
        }

        function getExistingGasItemsForWrite(): MergeItem[] {
          return mergeShipmentGasItems(allRecords
            .filter((record) => shouldUseExistingShipmentForGas(record, {
              deliveryNo: input.deliveryNo,
              sheetName: input.sheetName,
              trackingNumber: input.trackingNumber,
              invoiceNo,
              historyId: input.historyId ?? null,
            }, liveHistoryIds))
            .flatMap((record) => parseShipmentRecordItems(record.itemsJson)));
        }

        function getGasItemsForWrite(additionalItems: MergeItem[]): MergeItem[] {
          return mergeShipmentGasItems([
            ...getExistingGasItemsForWrite(),
            ...additionalItems,
          ]);
        }

        const sameTracking = allRecords.filter((r) =>
          r.trackingNumber === input.trackingNumber &&
          r.deliveryNo === input.deliveryNo &&
          (input.historyId ? r.historyId === input.historyId : !r.historyId)
        );

        if (sameTracking.length > 0) {
          // 自動合算: 既存記録と新規分をマージ
          const mergedMap = new Map<string, MergeItem>();
          for (const rec of sameTracking) {
            let items: MergeItem[] = [];
            try { items = JSON.parse(rec.itemsJson); } catch { items = []; }
            for (const item of items) {
              const key = item.productNameJa;
              if (mergedMap.has(key)) mergedMap.get(key)!.quantity += item.quantity;
              else mergedMap.set(key, { ...item });
            }
          }
          for (const item of gasItems) {
            const key = item.productNameJa;
            if (mergedMap.has(key)) mergedMap.get(key)!.quantity += item.quantity;
            else mergedMap.set(key, { ...item });
          }
          const mergedItems = Array.from(mergedMap.values());
          const keepId = sameTracking[0].id;
          // 既存記録を合算内容で更新
          await updateFedexShipment(keepId, {
            sheetName: input.sheetName,
            shippingDate: input.shippingDate,
            itemsJson: JSON.stringify(mergedItems),
            spreadsheetStatus: "pending",
          });
          // 既存の山積み記録の山積み分（2件目以降）を削除
          for (const rec of sameTracking.slice(1)) await deleteFedexShipment(rec.id);
          // Keep the displayed delivery number and linked history in sync after merging.
          await updateFedexShipmentHistoryAndDeliveryNo(keepId, input.historyId ?? null, input.deliveryNo);
          await recordWorkLog({
            workerName: workOperatorName,
            category: "FedEx発送登録",
            status: "done",
            startedAt: new Date(),
            endedAt: new Date(),
            quantity: sumWorkQuantity(gasItems),
            memo: `出庫No: ${input.deliveryNo} / 追跡番号: ${input.trackingNumber}`,
            createdBy: workOperatorName,
            sourceType: "fedex",
            sourceId: `${input.deliveryNo}:${input.trackingNumber}`,
            detailsJson: JSON.stringify({
              deliveryNo: input.deliveryNo,
              sheetName: input.sheetName,
              shippingDate: input.shippingDate,
              trackingNumber: input.trackingNumber,
              items: gasItems,
            }),
          });
          const gasResult = await callGasWrite(getGasItemsForWrite(gasItems));
          if (gasResult.success) {
            await updateFedexShipmentStatus(keepId, "success");
            return { id: keepId, success: true, message: `同一追跡番号の既存記録と合算してスプシを更新しました（合計: ${mergedItems.map((i) => `${i.productNameJa} x${i.quantity}`).join(", ")}）` };
          } else {
            await updateFedexShipmentStatus(keepId, "error", gasResult.message ?? "不明なエラー");
            return { id: keepId, success: false, message: `DB合算済み。スプシ更新失敗: ${gasResult.message}` };
          }
        }

        // 同一追跡番号なし: 通常登録
        const id = await createFedexShipment({
          deliveryNo: input.deliveryNo,
          sheetName: input.sheetName,
          shippingDate: input.shippingDate,
          trackingNumber: input.trackingNumber,
          itemsJson: JSON.stringify(gasItems),
          spreadsheetStatus: "pending",
          operatorName: workOperatorName,
          historyId: input.historyId ?? null,
        });
        await recordWorkLog({
          workerName: workOperatorName,
          category: "FedEx発送登録",
          status: "done",
          startedAt: new Date(),
          endedAt: new Date(),
          quantity: sumWorkQuantity(gasItems),
          memo: `出庫No: ${input.deliveryNo} / 追跡番号: ${input.trackingNumber}`,
          createdBy: workOperatorName,
          sourceType: "fedex",
          sourceId: `${input.deliveryNo}:${input.trackingNumber}`,
          detailsJson: JSON.stringify({
            deliveryNo: input.deliveryNo,
            sheetName: input.sheetName,
            shippingDate: input.shippingDate,
            trackingNumber: input.trackingNumber,
            items: gasItems,
          }),
        });

        if (!gasUrl) {
          await updateFedexShipmentStatus(id, "error", "GAS_WEBHOOK_URL が未設定です");
          return { id, success: false, message: "GAS_WEBHOOK_URL が未設定です。管理者に連絡してください。" };
        }

        const gasResult = await callGasWrite(getGasItemsForWrite(gasItems));
        if (gasResult.success) {
          await updateFedexShipmentStatus(id, "success");
          return { id, success: true, message: "スプシへの書き込みが完了しました" };
        } else {
          await updateFedexShipmentStatus(id, "error", gasResult.message ?? "不明なエラー");
          return { id, success: false, message: gasResult.message ?? "スプシへの書き込みに失敗しました" };
        }
      }),

    /**
     * FedEx発送記録を削除する（DBのみ、GASには通知しない旧バージョン）
     */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deleteFedexShipment(input.id);
        return { success: true };
      }),

    /**
     * FedEx発送記録を削除し、GASを通じてスプシからも削除する
     */
    deleteWithGas: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const records = await getAllFedexShipments();
        const record = records.find((r) => r.id === input.id);
        if (!record) {
          await deleteFedexShipment(input.id);
          return { success: true, message: "発送記録を削除しました" };
        }
        // DBから削除
        await deleteFedexShipment(input.id);
        // GASを通じてスプシからも削除
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        if (!gasUrl) {
          return { success: true, message: "DBから削除しました（GAS_WEBHOOK_URLが未設定のためスプシは未反映）" };
        }
        try {
          const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
          const payload = {
            secret,
            action: "deleteShipmentBatch",
            sheetName: record.sheetName,
            trackingNumber: record.trackingNumber,
          };
          const res1 = await fetch(gasUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
            redirect: "manual",
          });
          let text: string;
          if (res1.status === 302 || res1.status === 301) {
            const redirectUrl = res1.headers.get("location") ?? gasUrl;
            const res2 = await fetch(redirectUrl, { method: "GET" });
            text = await res2.text();
          } else {
            text = await res1.text();
          }
          let result: { success: boolean; message?: string };
          try { result = JSON.parse(text); } catch { result = { success: false, message: text }; }
          if (result.success) {
            return { success: true, message: "DBとスプシから削除しました" };
          } else {
            return { success: true, message: `DBから削除しました（スプシ削除失敗: ${result.message}）` };
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return { success: true, message: `DBから削除しました（GASエラー: ${msg}）` };
        }
      }),

    /**
     * FedEx発送記録を更新し、GASを通じてスプシも更新する
     */
    updateWithGas: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        trackingNumber: z.string(),
        shippingDate: z.string(),
        items: z.array(z.object({
          productNameJa: z.string(),
          productNameEn: z.string(),
          quantity: z.number().int().positive(),
          managementNo: z.string().nullable().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const records = await getAllFedexShipments();
        const record = records.find((r) => r.id === input.id);
        if (!record) {
          return { success: false, message: "発送記録が見つかりません" };
        }
        const oldTrackingNumber = record.trackingNumber;
        // GASを通じてスプシも更新
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        if (!gasUrl) {
          await updateFedexShipment(input.id, { spreadsheetStatus: "error", spreadsheetError: "GAS_WEBHOOK_URLが未設定" });
          return { success: false, message: "GAS_WEBHOOK_URL が未設定です。管理者に連絡してください。" };
        }
        try {
          const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
          const history = record.historyId ? await getDeliveryHistoryById(record.historyId).catch(() => null) : null;
          const deliveryNoForGas = history?.deliveryNo?.trim() || record.deliveryNo;
          if (deliveryNoForGas !== record.deliveryNo) {
            await updateFedexShipmentHistoryAndDeliveryNo(input.id, record.historyId ?? null, deliveryNoForGas);
          }
          const invoiceNo = invoiceNoFromDeliveryNo(deliveryNoForGas);
          const sourceItems = (await getShipmentItemsForHistory(record.historyId)) ?? input.items;
          const gasItems = await alignShipmentItemsToOrderRows(invoiceNo, sourceItems);
          // DBを更新
          await updateFedexShipment(input.id, {
            trackingNumber: input.trackingNumber,
            shippingDate: input.shippingDate,
            itemsJson: JSON.stringify(gasItems),
            spreadsheetStatus: "pending",
          });
          const postGas = async (payload: Record<string, unknown>): Promise<{ success: boolean; message?: string }> => {
            const res1 = await fetch(gasUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              redirect: "manual",
            });
            let text: string;
            if (res1.status === 302 || res1.status === 301) {
              const redirectUrl = res1.headers.get("location") ?? gasUrl;
              const res2 = await fetch(redirectUrl, { method: "GET" });
              text = await res2.text();
            } else {
              text = await res1.text();
            }
            try { return JSON.parse(text); } catch { return { success: false, message: text }; }
          };
          const payload = {
            secret,
            action: "updateShipmentBatch",
            sheetName: record.sheetName,
            oldTrackingNumber,
            trackingNumber: input.trackingNumber,
            shippingDate: input.shippingDate,
            invoiceNo,
            items: gasItems,
          };
          let result = await postGas(payload);
          if (!result.success && /見つかりません|not\s*found/i.test(result.message ?? "")) {
            result = await postGas({
              secret,
              action: "writeShipmentBatch",
              deliveryNo: deliveryNoForGas,
              invoiceNo,
              sheetName: record.sheetName,
              shippingDate: input.shippingDate,
              trackingNumber: input.trackingNumber,
              items: gasItems,
            });
          }
          if (result.success) {
            await updateFedexShipment(input.id, { spreadsheetStatus: "success", spreadsheetError: null });
            return { success: true, message: "発送情報を更新しました" };
          } else {
            await updateFedexShipment(input.id, { spreadsheetStatus: "error", spreadsheetError: result.message ?? "不明なエラー" });
            return { success: false, message: result.message ?? "スプシへの更新に失敗しました" };
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await updateFedexShipment(input.id, { spreadsheetStatus: "error", spreadsheetError: msg });
          return { success: false, message: `GAS呼び出しエラー: ${msg}` };
        }
      }),

    /**
     * 複数グループをまとめてFedEx発送登録する（バッチ登録）
     * 出庫Noから取引先を自動判別してシートを振り分ける
     */
    createBatch: protectedProcedure
      .input(z.object({
        shippingDate: z.string(),
        shipments: z.array(z.object({
          deliveryNo: z.string(),
          sheetName: shipmentSheetNameSchema.optional(),
          trackingNumber: z.string(),
          historyId: z.number().int().positive().optional(),
          items: z.array(z.object({
            productNameJa: z.string(),
            productNameEn: z.string(),
            quantity: z.number().int().positive(),
            managementNo: z.string().nullable().optional(),
          })),
        })),
        operatorName: z.string().max(200).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        type MergeItem = ShipmentGasItem;
        const results: Array<{ deliveryNo: string; sheetName: string; trackingNumber: string; id: number; success: boolean; message: string }> = [];
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
        const workOperatorName = resolveWorkOperatorName(input.operatorName, ctx.user.name ?? ctx.user.email ?? null);
        const alignedShipments = await Promise.all(input.shipments.map(async (shipment) => {
          const sheetName = shipment.sheetName ?? detectShipmentSheetName(shipment.deliveryNo);
          const invoiceNo = invoiceNoFromDeliveryNo(shipment.deliveryNo);
          const sourceItems = (await getShipmentItemsForHistory(shipment.historyId)) ?? shipment.items;
          const gasItems = await alignShipmentItemsToOrderRows(invoiceNo, sourceItems);
          return { ...shipment, sheetName, invoiceNo, gasItems };
        }));

        function getBatchGasItemsForWrite(target: { deliveryNo: string; sheetName: ShipmentSheetName; trackingNumber: string; invoiceNo: string; historyId?: number | null }): MergeItem[] {
          return mergeShipmentGasItems(alignedShipments
            .filter((shipment) =>
              shipment.sheetName === target.sheetName &&
              shipment.trackingNumber === target.trackingNumber &&
              shipment.invoiceNo === target.invoiceNo
            )
            .flatMap((shipment) => shipment.gasItems));
        }

        async function callGasBatchWrite(sheetName: string, deliveryNo: string, trackingNumber: string, items: MergeItem[]): Promise<{ success: boolean; message?: string }> {
          if (!gasUrl) return { success: false, message: "GAS_WEBHOOK_URLが未設定" };
          try {
            const invoiceNo = invoiceNoFromDeliveryNo(deliveryNo);
            const payload = { secret, action: "writeShipmentBatch", deliveryNo, invoiceNo, sheetName, shippingDate: input.shippingDate, trackingNumber, items };
            const res = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), redirect: "manual" });
            let text: string;
            if (res.status === 302 || res.status === 301) { const loc = res.headers.get("location") ?? gasUrl; const r2 = await fetch(loc, { method: "GET" }); text = await r2.text(); }
            else { text = await res.text(); }
            try { return JSON.parse(text); } catch { return { success: false, message: text }; }
          } catch (e) { return { success: false, message: e instanceof Error ? e.message : String(e) }; }
        }
        const allRecords = await alignShipmentItemsWithDeliveryHistories(await getAllFedexShipments());
        const liveHistoryIds = await getLiveDeliveryHistoryIds();

        function parseShipmentRecordItems(itemsJson: string): MergeItem[] {
          try {
            return JSON.parse(itemsJson) as MergeItem[];
          } catch {
            return [];
          }
        }

        function getExistingGasItemsForWrite(target: { deliveryNo: string; sheetName: ShipmentSheetName; trackingNumber: string; invoiceNo: string; historyId?: number | null }): MergeItem[] {
          return mergeShipmentGasItems(allRecords
            .filter((record) => shouldUseExistingShipmentForGas(record, {
              deliveryNo: target.deliveryNo,
              sheetName: target.sheetName,
              trackingNumber: target.trackingNumber,
              invoiceNo: target.invoiceNo,
              historyId: target.historyId ?? null,
            }, liveHistoryIds))
            .flatMap((record) => parseShipmentRecordItems(record.itemsJson)));
        }

        function getGasItemsForWrite(target: { deliveryNo: string; sheetName: ShipmentSheetName; trackingNumber: string; invoiceNo: string; historyId?: number | null }): MergeItem[] {
          return mergeShipmentGasItems([
            ...getExistingGasItemsForWrite(target),
            ...getBatchGasItemsForWrite(target),
          ]);
        }

        for (const shipment of alignedShipments) {
          const { sheetName, gasItems } = shipment;
          // 同一追跡番号かつ同一出庫Noの既存記録を確認
          const sameTracking = allRecords.filter((r) =>
            r.trackingNumber === shipment.trackingNumber &&
            r.deliveryNo === shipment.deliveryNo &&
            (shipment.historyId ? r.historyId === shipment.historyId : !r.historyId)
          );

          if (sameTracking.length > 0) {
            // 自動合算
            const existingItems: MergeItem[] = [];
            for (const rec of sameTracking) {
              existingItems.push(...parseShipmentRecordItems(rec.itemsJson));
            }
            const mergedItems = mergeShipmentGasItems([...existingItems, ...gasItems]);
            const gasItemsForWrite = getGasItemsForWrite(shipment);
            const keepId = sameTracking[0].id;
            await updateFedexShipment(keepId, { sheetName, shippingDate: input.shippingDate, itemsJson: JSON.stringify(mergedItems), spreadsheetStatus: "pending" });
            for (const rec of sameTracking.slice(1)) await deleteFedexShipment(rec.id);
            await updateFedexShipmentHistoryAndDeliveryNo(keepId, shipment.historyId ?? null, shipment.deliveryNo);
            await recordWorkLog({
              workerName: workOperatorName,
              category: "FedEx発送登録",
              status: "done",
              startedAt: new Date(),
              endedAt: new Date(),
              quantity: sumWorkQuantity(gasItems),
              memo: `出庫No: ${shipment.deliveryNo} / 追跡番号: ${shipment.trackingNumber}`,
              createdBy: workOperatorName,
              sourceType: "fedex",
              sourceId: `${shipment.deliveryNo}:${shipment.trackingNumber}`,
              detailsJson: JSON.stringify({
                deliveryNo: shipment.deliveryNo,
                sheetName,
                shippingDate: input.shippingDate,
                trackingNumber: shipment.trackingNumber,
                items: gasItems,
              }),
            });
            const gasResult = await callGasBatchWrite(sheetName, shipment.deliveryNo, shipment.trackingNumber, gasItemsForWrite);
            if (gasResult.success) {
              await updateFedexShipmentStatus(keepId, "success");
              results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id: keepId, success: true, message: `合算してスプシ更新` });
            } else {
              await updateFedexShipmentStatus(keepId, "error", gasResult.message ?? "不明なエラー");
              results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id: keepId, success: false, message: `DB合算済み。スプシ失敗: ${gasResult.message}` });
            }
            continue;
          }

          // 通常登録
          const gasItemsForWrite = getGasItemsForWrite(shipment);
          const id = await createFedexShipment({
            deliveryNo: shipment.deliveryNo,
            sheetName,
            shippingDate: input.shippingDate,
            trackingNumber: shipment.trackingNumber,
            itemsJson: JSON.stringify(gasItems),
            spreadsheetStatus: "pending",
            operatorName: workOperatorName,
            historyId: shipment.historyId ?? null,
          });
          await recordWorkLog({
            workerName: workOperatorName,
            category: "FedEx発送登録",
            status: "done",
            startedAt: new Date(),
            endedAt: new Date(),
            quantity: sumWorkQuantity(gasItems),
            memo: `出庫No: ${shipment.deliveryNo} / 追跡番号: ${shipment.trackingNumber}`,
            createdBy: workOperatorName,
            sourceType: "fedex",
            sourceId: `${shipment.deliveryNo}:${shipment.trackingNumber}`,
            detailsJson: JSON.stringify({
              deliveryNo: shipment.deliveryNo,
              sheetName,
              shippingDate: input.shippingDate,
              trackingNumber: shipment.trackingNumber,
              items: gasItems,
            }),
          });
          if (!gasUrl) {
            await updateFedexShipmentStatus(id, "error", "GAS_WEBHOOK_URL が未設定です");
            results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id, success: false, message: "GAS_WEBHOOK_URL が未設定です" });
            continue;
          }
          const gasResult = await callGasBatchWrite(sheetName, shipment.deliveryNo, shipment.trackingNumber, gasItemsForWrite);
          if (gasResult.success) {
            await updateFedexShipmentStatus(id, "success");
            results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id, success: true, message: "書き込み完了" });
          } else {
            await updateFedexShipmentStatus(id, "error", gasResult.message ?? "不明なエラー");
            results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id, success: false, message: gasResult.message ?? "スプシへの書き込みに失敗" });
          }
        }
        const allSuccess = results.every((r) => r.success);
        const successCount = results.filter((r) => r.success).length;
        return {
          results,
          success: allSuccess,
          message: allSuccess
            ? `${successCount}件の発送情報をスプシに登録しました`
            : `${successCount}/${results.length}件成功（一部失敗あり）`,
        };
      }),
    /**
     * 同一追跡番号の複数FedEx発送記録を合算して1件にまとめ、スプシに再送信する
     */
    mergeByTracking: protectedProcedure
      .input(z.object({
        trackingNumber: z.string(),
        sheetName: z.string(),
        shippingDate: z.string(),
      }))
      .mutation(async ({ input }) => {
        const allRecords = await getAllFedexShipments();
        const targets = allRecords.filter((r) => r.trackingNumber === input.trackingNumber);
        if (targets.length === 0) return { success: false, message: "記録が見つかりません" };
        if (targets.length === 1) return { success: false, message: "合算対象が1件のみです（複数件必要）" };
        type Item = { productNameJa: string; productNameEn: string; quantity: number };
        const mergedMap = new Map<string, Item>();
        for (const rec of targets) {
          let items: Item[] = [];
          try { items = JSON.parse(rec.itemsJson); } catch { items = []; }
          for (const item of items) {
            const key = item.productNameJa;
            if (mergedMap.has(key)) mergedMap.get(key)!.quantity += item.quantity;
            else mergedMap.set(key, { ...item });
          }
        }
        const mergedItems = Array.from(mergedMap.values());
        const keepId = targets[0].id;
        await updateFedexShipment(keepId, {
          sheetName: input.sheetName,
          shippingDate: input.shippingDate,
          itemsJson: JSON.stringify(mergedItems),
          spreadsheetStatus: "pending",
        });
        for (const rec of targets.slice(1)) await deleteFedexShipment(rec.id);
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        if (!gasUrl) return { success: true, message: `DBで${targets.length}件を合算しました（GAS未設定）` };
        try {
          const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
          const delPayload = { secret, action: "deleteShipmentBatch", sheetName: input.sheetName, trackingNumber: input.trackingNumber };
          const delRes = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(delPayload), redirect: "manual" });
          if (delRes.status === 302 || delRes.status === 301) { const loc = delRes.headers.get("location") ?? gasUrl; await fetch(loc, { method: "GET" }); }
          const writePayload = { secret, action: "writeShipmentBatch", sheetName: input.sheetName, shippingDate: input.shippingDate, trackingNumber: input.trackingNumber, items: mergedItems };
          const writeRes = await fetch(gasUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(writePayload), redirect: "manual" });
          let text: string;
          if (writeRes.status === 302 || writeRes.status === 301) { const loc = writeRes.headers.get("location") ?? gasUrl; const r2 = await fetch(loc, { method: "GET" }); text = await r2.text(); } else { text = await writeRes.text(); }
          let result: { success: boolean; message?: string };
          try { result = JSON.parse(text); } catch { result = { success: false, message: text }; }
          if (result.success) {
            await updateFedexShipmentStatus(keepId, "success");
            return { success: true, message: `${targets.length}件を合算してスプシに再送信しました（合計: ${mergedItems.map((i) => `${i.productNameJa} x${i.quantity}`).join(", ")}）` };
          } else {
            await updateFedexShipmentStatus(keepId, "error", result.message ?? "不明なエラー");
            return { success: true, message: `DBで合算しましたがスプシへの書き込みに失敗: ${result.message}` };
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          await updateFedexShipmentStatus(keepId, "error", msg);
          return { success: false, message: `GASエラー: ${msg}` };
        }
      }),
  }),
  // 管理者メール確認
  // ============================================================
  admin: router({
    /**
     * 現在ログイン中のユーザーが管理者かどうかを返す
     */
    isAdmin: protectedProcedure.query(async ({ ctx }) => {
      return { isAdmin: ADMIN_EMAILS.includes(ctx.user.email ?? "") };
    }),
  }),

  // ============================================================
  // 取引先ポータル
  // ============================================================
  partner: router({
    /**
     * 取引先ポータルにパスワードでログインする（公開プロシージャ）
     */
    login: publicProcedure
      .input(z.object({ partnerCode: z.string(), password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const portal = await getPartnerPortalByCode(input.partnerCode);
        if (!portal || !portal.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Partner not found" });
        if (portal.password !== input.password) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid password" });
        // セッショントークン生成（90日有効）
        const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        await setPartnerSessionToken(input.partnerCode, token, expiresAt);
        ctx.res.cookie("partner_session", JSON.stringify({ partnerCode: input.partnerCode, token }), {
          httpOnly: true, sameSite: "lax", maxAge: 90 * 24 * 60 * 60 * 1000,
        });
        return { success: true, partnerCode: input.partnerCode, partnerName: portal.partnerName };
      }),

    /**
     * 取引先ポータルのセッションを確認する（公開プロシージャ）
     */
    checkSession: publicProcedure.query(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (!match) return { authenticated: false, partnerCode: null, partnerName: null };
      try {
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || !portal.sessionToken || portal.sessionToken !== session.token) return { authenticated: false, partnerCode: null, partnerName: null };
        if (portal.sessionExpiresAt && new Date(portal.sessionExpiresAt) < new Date()) return { authenticated: false, partnerCode: null, partnerName: null };
        return { authenticated: true, partnerCode: portal.partnerCode, partnerName: portal.partnerName };
      } catch {
        return { authenticated: false, partnerCode: null, partnerName: null };
      }
    }),

    /**
     * 取引先ポータルからログアウトする
     */
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (match) {
        try {
          const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
          await setPartnerSessionToken(session.partnerCode, null, null);
        } catch { /* ignore */ }
      }
      ctx.res.clearCookie("partner_session");
      return { success: true };
    }),

    /**
     * 取引先向け: 自分のSheetNameに対応するFedEx発送記録とCSV情報を取得
     */
    getShipments: publicProcedure.query(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
      let partnerCode: string;
      let sheetName: string;
      try {
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        if (portal.sessionExpiresAt && new Date(portal.sessionExpiresAt) < new Date()) throw new TRPCError({ code: "UNAUTHORIZED" });
        partnerCode = portal.partnerCode;
        sheetName = portal.sheetName;
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      // 対応するFedEx発送記録を取得
      const allShipments = await getAllFedexShipments();
      const myShipments = await alignShipmentItemsWithDeliveryHistories(
        allShipments.filter((s) => s.sheetName === sheetName),
      );
      // 手動発送データも取得して統合
      const allManual = await getAllManualShipments();
      const myManual = allManual.filter((m) => m.sheetName === sheetName);
      const manualAsFedex = myManual.map((m) => ({
        id: -(m.id),
        deliveryNo: m.invoiceNo,
        sheetName: m.sheetName,
        shippingDate: m.shippingDate,
        trackingNumber: m.trackingNumber,
        itemsJson: m.itemsJson,
        spreadsheetStatus: "success" as const,
        spreadsheetError: null,
        operatorName: m.operatorName,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
        isManual: true,
        manualId: m.id,
      }));
      const combinedShipments = [...myShipments, ...manualAsFedex];
      // 受取確認チェックを取得
      const checks = await getShipmentChecksByPartner(partnerCode);
      const checkMap = new Map(checks.map((c) => [`${c.fedexShipmentId}_${c.itemIndex}`, c.isChecked === 1] as [string, boolean]));
      // CSV情報を取得（インボイスNo・支払日・発注数）
      let csvData: Record<string, { paymentDate: string; products: Array<{ name: string; qty: number }> }> = {};
      try {
        for (const row of await getOrderRowsFromTradeRecords()) {
          const partner = row.partner;
          const invoiceNo = row.invoiceNo;
          const paymentDate = row.paymentDate;
          const productName = row.productName;
          const orderQty = row.orderQty;
          // 取引先フィルタリング（シート名と取引先を照合）
          const isLuca = sheetName === "独発送管理";
          const isSamee = sheetName === "サミー発送管理";
          const isDevon = sheetName === "デボン発送管理";
          const isSimon = sheetName === "サイモン発送管理";
          const isNele = sheetName === "ネレ発送管理";
          const partnerLower = partner.toLowerCase();
          if (isLuca && !partnerLower.includes("ルカ") && !partnerLower.includes("luca") && !partnerLower.includes("マキシム") && !partnerLower.includes("maxim")) continue;
          if (isSamee && !partnerLower.includes("サミ") && !partnerLower.includes("samm") && !partnerLower.includes("same")) continue;
          if (isDevon && !partnerLower.includes("デボン") && !partnerLower.includes("devon")) continue;
          if (isSimon && !partnerLower.includes("サイモン") && !partnerLower.includes("simon")) continue;
          if (isNele && !partnerLower.includes("ネレ") && !partnerLower.includes("nele")) continue;
          if (!csvData[invoiceNo]) csvData[invoiceNo] = { paymentDate, products: [] };
          if (productName) csvData[invoiceNo].products.push({ name: productName, qty: orderQty });
        }
      } catch { /* CSV取得失敗時は空データ */ }
      return { shipments: combinedShipments, checks: Object.fromEntries(checks.map((c) => [`${c.fedexShipmentId}_${c.itemIndex}`, c.isChecked === 1])), csvData };
    }),

    /**
     * 受取確認チェックを更新する
     */
    updateCheck: publicProcedure
      .input(z.object({ fedexShipmentId: z.number(), itemIndex: z.number(), isChecked: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const cookieHeader = ctx.req.headers.cookie ?? "";
        const match = cookieHeader.match(/partner_session=([^;]+)/);
        if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        await upsertShipmentCheck(session.partnerCode, input.fedexShipmentId, input.itemIndex, input.isChecked);
        return { success: true };
      }),

    /**
     * 取引先からメッセージを送信する
     */
    sendMessage: publicProcedure
      .input(z.object({ message: z.string().min(1).max(2000), fedexShipmentId: z.number().optional() }))
      .mutation(async ({ input, ctx }) => {
        const cookieHeader = ctx.req.headers.cookie ?? "";
        const match = cookieHeader.match(/partner_session=([^;]+)/);
        if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        await createPartnerMessage({
          partnerCode: session.partnerCode,
          partnerName: portal.partnerName,
          fedexShipmentId: input.fedexShipmentId ?? null,
          message: input.message,
        });
        // 管理者に通知
        try {
          const { notifyOwner } = await import("../_core/notification");
          await notifyOwner({ title: `メッセージ: ${portal.partnerName}`, content: input.message });
        } catch { /* 通知失敗は無視 */ }
        return { success: true };
      }),

    // ===== 管理者向け =====
    /**
     * 全取引先ポータル一覧（管理者向け）
     */
    listPortals: protectedProcedure.query(async () => {
      return getAllPartnerPortals();
    }),

    /**
     * 取引先ポータルを作成する
     */
    createPortal: protectedProcedure
      .input(z.object({
        partnerCode: z.string().min(1).max(100),
        partnerName: z.string().min(1).max(200),
        sheetName: z.string().min(1).max(100),
        password: z.string().min(1).max(200),
      }))
      .mutation(async ({ input }) => {
        const id = await createPartnerPortal({ ...input, isActive: 1 });
        return { id };
      }),

    /**
     * 取引先ポータルを更新する（パスワード変更等）
     */
    updatePortal: protectedProcedure
      .input(z.object({
        id: z.number(),
        partnerName: z.string().min(1).max(200).optional(),
        sheetName: z.string().min(1).max(100).optional(),
        password: z.string().min(1).max(200).optional(),
        isActive: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updatePartnerPortal(id, data);
        return { success: true };
      }),

    /**
     * 取引先ポータルを削除する
     */
    deletePortal: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deletePartnerPortal(input.id);
        return { success: true };
      }),

    /**
     * 取引先からのメッセージ一覧（管理者向け）
     */
    listMessages: protectedProcedure.query(async () => {
      return getAllPartnerMessages();
    }),

    /**
     * メッセージを既読にする
     */
    markMessageRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await markPartnerMessageRead(input.id);
        return { success: true };
      }),

    /**
     * メッセージに返信する（管理者向け）
     */
    replyMessage: protectedProcedure
      .input(z.object({ id: z.number(), replyText: z.string().min(1).max(2000) }))
      .mutation(async ({ input }) => {
        await replyToPartnerMessage(input.id, input.replyText);
        return { success: true };
      }),

    /**
     * メッセージを削除する（管理者向け）
     */
    deleteMessage: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deletePartnerMessage(input.id);
        return { success: true };
      }),

    /**
     * 取引先が自分のメッセージ履歴を取得する（取引先向け）
     */
    getMyMessages: publicProcedure.query(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
      let partnerCode: string;
      try {
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        partnerCode = session.partnerCode;
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return getPartnerMessagesByCode(partnerCode);
    }),

    /**
     * 取引先が自分のメッセージを削除する（取引先向け）
     */
    deleteMyMessage: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const cookieHeader = ctx.req.headers.cookie ?? "";
        const match = cookieHeader.match(/partner_session=([^;]+)/);
        if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
         if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        await deletePartnerMessageByPartner(input.id, session.partnerCode);
        return { success: true };
      }),
    /**
     * 取引先が自分のメッセージを既読にする（返信ありメッセージのバッジを消す）
     */
    markMessagesRead: publicProcedure.mutation(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
      let partnerCode: string;
      try {
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        partnerCode = session.partnerCode;
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      await markPartnerMessagesReadByPartner(partnerCode);
      // スレッド内のadmin返信も既読にする
      const myMsgs = await getPartnerMessagesByCode(partnerCode);
      const msgIds = myMsgs.map(m => m.id);
      if (msgIds.length > 0) await markThreadsReadByPartner(msgIds);
      return { success: true };
    }),
    /**
     * スレッド返信を追加する（取引先向け）
     */
    addThreadReply: publicProcedure
      .input(z.object({
        parentMessageId: z.number().int().positive(),
        content: z.string().min(1).max(2000),
      }))
      .mutation(async ({ input, ctx }) => {
        const cookieHeader = ctx.req.headers.cookie ?? "";
        const match = cookieHeader.match(/partner_session=([^;]+)/);
        if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
        let partnerCode: string;
        let partnerName: string;
        try {
          const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
          const portal = await getPartnerPortalByCode(session.partnerCode);
          if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
          partnerCode = portal.partnerCode;
          partnerName = portal.partnerName;
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        await addMessageThread({
          parentMessageId: input.parentMessageId,
          senderType: "partner",
          senderName: partnerName,
          content: input.content,
        });
        return { success: true };
      }),
    /**
     * スレッド返信を追加する（管理者向け）
     */
    addAdminThreadReply: protectedProcedure
      .input(z.object({
        parentMessageId: z.number().int().positive(),
        content: z.string().min(1).max(2000),
      }))
      .mutation(async ({ input, ctx }) => {
        await addMessageThread({
          parentMessageId: input.parentMessageId,
          senderType: "admin",
          senderName: ctx.user.name ?? "管理者",
          content: input.content,
        });
        return { success: true };
      }),
    /**
     * スレッド一覧を取得する（親メッセージIDリストで一括取得）
     */
    getThreads: publicProcedure
      .input(z.object({ parentMessageIds: z.array(z.number().int()) }))
      .query(async ({ input }) => {
        return getThreadsByParentIds(input.parentMessageIds);
      }),
    /**
     * 管理者側で取引先からのスレッド返信を既読にする
     */
    markThreadReadByAdmin: protectedProcedure
      .input(z.object({ parentMessageId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await markThreadsReadByAdmin(input.parentMessageId);
        return { success: true };
      }),
    /**
     * 手動発送データを登録する（管理者向け）
     */
    addManualShipment: protectedProcedure
      .input(z.object({
        invoiceNo: z.string().min(1),
        sheetName: z.string().min(1),
        shippingDate: z.string().min(1),
        trackingNumber: z.string().min(1),
        items: z.array(z.object({
          productNameJa: z.string(),
          productNameEn: z.string(),
          quantity: z.number().int().min(1),
        })),
        operatorName: z.string().max(200).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const workOperatorName = resolveWorkOperatorName(input.operatorName, (ctx as { user?: { name?: string; email?: string } }).user?.name ?? null);
        const id = await createManualShipment({
          invoiceNo: input.invoiceNo,
          sheetName: input.sheetName,
          shippingDate: input.shippingDate,
          trackingNumber: input.trackingNumber,
          itemsJson: JSON.stringify(input.items),
          operatorName: workOperatorName,
        });
        await recordWorkLog({
          workerName: workOperatorName,
          category: "FedEx発送登録",
          status: "done",
          startedAt: new Date(),
          endedAt: new Date(),
          quantity: sumWorkQuantity(input.items),
          memo: `インボイスNo: ${input.invoiceNo} / 追跡番号: ${input.trackingNumber}`,
          createdBy: workOperatorName,
          sourceType: "manual-shipment",
          sourceId: `${input.invoiceNo}:${input.trackingNumber}`,
          detailsJson: JSON.stringify({
            invoiceNo: input.invoiceNo,
            sheetName: input.sheetName,
            shippingDate: input.shippingDate,
            trackingNumber: input.trackingNumber,
            items: input.items,
          }),
        });
        return { id };
      }),

    /**
     * 手動発送データを削除する（管理者向け）
     */
    deleteManualShipment: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteManualShipment(input.id);
        return { success: true };
      }),

    /**
     * 手動発送データ一覧を取得する（管理者向け）
     */
    listManualShipments: protectedProcedure.query(async () => {
      return getAllManualShipments();
    }),

    /**
     * 管理者向け: 全FedEx発送記録とCSV情報を取得（海外発送ページ用）
     */
    getAdminShipments: protectedProcedure.query(async () => {
      const allShipments = await alignShipmentItemsWithDeliveryHistories(await getAllFedexShipments());
      const manualShipmentsList = await getAllManualShipments();
      // 手動発送データをFedexShipment形式に変換して統合
      const manualAsFedex = manualShipmentsList.map((m) => ({
        id: -(m.id), // 負のIDで手動データを識別
        deliveryNo: m.invoiceNo,
        sheetName: m.sheetName,
        shippingDate: m.shippingDate,
        trackingNumber: m.trackingNumber,
        itemsJson: m.itemsJson,
        spreadsheetStatus: "success" as const,
        spreadsheetError: null,
        operatorName: m.operatorName,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
        isManual: true,
        manualId: m.id,
      }));
      const combinedShipments = [...allShipments, ...manualAsFedex];
      let csvData: Record<string, { partner: string; paymentDate: string; products: Array<{ name: string; qty: number }> }> = {};
      try {
        for (const row of await getOrderRowsFromTradeRecords()) {
          const partner = row.partner;
          const invoiceNo = row.invoiceNo;
          const paymentDate = row.paymentDate;
          const productName = row.productName;
          const orderQty = row.orderQty;
          const status = row.status;
          if (!csvData[invoiceNo]) csvData[invoiceNo] = { partner, paymentDate, products: [] };
          if (productName) csvData[invoiceNo].products.push({ name: productName, qty: orderQty });
          // statusをcompleteとして記録
          if (status.toLowerCase() === "complete") (csvData[invoiceNo] as { partner: string; paymentDate: string; products: Array<{ name: string; qty: number }>; isComplete?: boolean }).isComplete = true;
        }
      } catch { /* CSV取得失敗 */ }
      return { shipments: combinedShipments, csvData };
    }),
  }),
});
export type InventoryRouter = typeof inventoryRouter;
