import { monthlyReportRouter, snapshotRouter } from "./monthlyReportRouter";
import { parseMoneyNumber } from "./inventoryMoney";
import { type ShipmentGasItem } from "./shipmentDeclarationRules";
import { getOrderRowsFromTradeRecords, expandMaxim415416OrderRows } from "./orderTradeRows";
import { invoiceNoFromDeliveryNo, invoiceNoPrefixFromDeliveryNo } from "./deliveryInvoiceAttribution";
import { type LocalPurchaseRow } from "./purchaseRowTypes";
import { createStepTimer } from "./stepTimer";
import { suggestCsvProductNameFromHints } from "./orderProductMatching";

import { orderManagementRouter } from "./orderManagementRouter";
import { createOrderedPurchaseProcedure } from "./createOrderedPurchase";
import { normalizeCategoryName } from "./categoryName";
import { purchaseEditInputSchema, purchaseSupplierInputSchema, purchaseTrackingInputSchema, purchaseTrackingBulkInputSchema } from "./purchases/saveInput";
import { savePurchaseEdit } from "./purchases/saveEdit";
import { savePurchaseSupplier } from "./purchases/saveSupplier";
import { savePurchaseTracking, savePurchaseTrackingBulk } from "./purchases/saveTracking";
import type { PurchaseSnapshotInput } from "./purchases/snapshotContract";
import { resolveWorkOperatorName, resolveOperatorToken } from "./workOperator";
import { historyDateFrom, normalizePurchaseHistoryText, firstPurchaseHistoryEtcPart, positiveHistoryNumber, parseLocalPurchaseItems, localPurchasePrimaryManagementNo } from "./purchases/legacyValues";
import { localPurchaseMatchesInventoryLabel } from "./purchases/labelMatching";
import { restoreMissingLocalPurchasesFromOrphanLabels } from "./purchases/orphanRecovery";
import { ensureShaftPurchases } from "./purchases/shaftBackfill";
import { getInventoryManagementNo } from "./managementNo";
import { getDirectPartnerNames, resolveInboundInfoMap } from "./purchases/inboundClassification";
import { reconcileLocalPurchaseLabelQuantities } from "./purchases/reconcileLabels";
import { toInventoryItemLabelView, isReceivedLabelStatus, type InventoryItemLabelView } from "./labelViews";
import { getPurchaseItemManagementNo, localPurchaseItems } from "./purchases/items";
import { filterLabelsByManagementNo, labelsForPurchaseItem } from "./purchases/labels";
import { getLocalPurchaseDisplayStatus } from "./purchases/displayStatus";
import { createExternalPurchaseMaps, buildExternalPurchasePageRows, buildExternalPurchaseAllRows } from "./purchases/externalRows";
import { fillCsvPurchaseSuppliers } from "./purchases/csvSuppliers";
import { loadLocalPurchaseListData, refreshPurchaseInventoryMap } from "./purchases/localData";
import { buildLocalPurchaseRow, createPurchaseInventoryMap, attachPurchaseInventoryInfo } from "./purchases/localRows";
import { purchasePageInputSchema } from "./purchases/input";
import { buildPurchasePageResponse } from "./purchases/page";
import { z } from "zod";
import { google } from "googleapis";
import { COOKIE_NAME, ADMIN_EMAILS } from "@shared/const";
import { getEbayStockType, isEbayManagementNo, normalizeEbayOrderStatus } from "@shared/ebayInventory";
import { allocateShipmentItemsToCsvProducts, extractColor, extractManagementHints, extractModel, extractPreferredModel, inventoryItemCanMatchCsvProduct, isRandomColor, normalizeLooseText, productNamesCanMatch, suggestCsvProduct } from "@shared/productMatching";
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
  nextStage,
  isInboundClass,
  isRegisterStage,
  getStagesForClass,
  INBOUND_CLASS_ORDER,
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
  getSystemSetting,
  setSystemSetting,
  isZaicoEnabled,
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

async function alignShipmentItemsToOrderRows(invoiceNo: string, items: ShipmentGasItem[]): Promise<ShipmentGasItem[]> {
  // 個体IDを持つ箱経由の行はidentityを落とさないことを優先する。
  if (items.some((item) => item.labelId)) return mergeShipmentGasItems(items);
  const orderRows = (await getOrderRowsFromTradeRecords().catch(() => []))
    .filter((row) => row.invoiceNo === invoiceNo && row.productName.trim());
  if (orderRows.length === 0) return mergeShipmentGasItems(items);

  const expandedOrderRows = expandMaxim415416OrderRows(orderRows);
  const csvProducts = expandedOrderRows.map((row) => ({ name: row.productName, qty: row.orderQty }));
  return allocateShipmentItemsToCsvProducts(items, csvProducts);
}

const CATEGORY_SETTINGS_KEY = "inventory_categories";
const ALL_CATEGORY_LABEL = "すべて";
const UNCATEGORIZED_LABEL = "未分類";



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



function sumWorkQuantity(items: Array<{ quantity: string | number }>): number {
  return Math.round(items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0));
}

const publicProcedure = protectedProcedure;

type LocalInventoryRow = Awaited<ReturnType<typeof getLocalInventories>>[number];
type LocalInventoryItemLabelRow = NonNullable<LocalInventoryRow["itemLabels"]>[number];
type LocalPurchaseItemLabelRow = NonNullable<LocalPurchaseRow["itemLabels"]>[number];
type PurchaseHistoryRow = Awaited<ReturnType<typeof getPurchaseHistories>>[number];
type InventoryMemoRow = Awaited<ReturnType<typeof getInventoryMemos>>[number];


type InventoryItemLabelForEnsure = InventoryItemLabelView & {
  title?: string | null;
};

function historyTimestampFrom(value: unknown, fallback = new Date()): Date {
  const date = value ? new Date(value as string | number | Date) : fallback;
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function purchaseHistoryKey(row: Pick<PurchaseHistoryRow, "zaicoId" | "inventoryId" | "kanriNo" | "title">): string {
  return [row.zaicoId, row.inventoryId ?? "", row.kanriNo ?? "", row.title].join("\u0001");
}

function nonEmptyPurchaseHistoryText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  return text ? text : null;
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

function readStartupBooleanEnv(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

function shouldRunInventoryOneTimeRepairs(): boolean {
  const explicit = readStartupBooleanEnv("RUN_INVENTORY_ONE_TIME_REPAIRS");
  if (explicit !== undefined) return explicit;
  return process.env.NODE_ENV !== "production";
}

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

async function recordFullRestoreSnapshot(input: PurchaseSnapshotInput) {
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
    if (shouldRunInventoryOneTimeRepairs()) {
      inventoryOneTimeRepairPromise = (async () => {
        await repairEbay7696SecondInventoryOverwrite();
        await repairEbay7696SecondKnownContent();
        await repairEbay7696SecondOrderSync();
        await repairMaxim404PartialCancelLabel();
        await softDeleteInventoriesHiddenByDeliveryHistory();
      })().catch((error) => {
        console.warn("[inventory] Failed to run one-time repairs", error);
      });
    } else {
      inventoryOneTimeRepairPromise = (async () => {
        console.info("[perf] inventory.oneTimeRepairs.skipped");
      })();
    }
  }
  return inventoryOneTimeRepairPromise;
}

setTimeout(() => {
  void runInventoryOneTimeRepairsOnce();
}, 0);


async function ensureStockLabelsForInventories<T extends {
  id: number;
  title: string;
  quantity?: string | number | null;
  etc?: string | null;
}>(inventories: T[]): Promise<Array<T & { itemLabels: InventoryItemLabelView[] }>> {
  if (inventories.length === 0) return [];
  const labelMap = new Map<number, InventoryItemLabelForEnsure[]>();
  const idsNeedingLabelFetch: number[] = [];
  for (const inventory of inventories) {
    const inventoryId = Number(inventory.id);
    const preloadedLabels = (inventory as { itemLabels?: InventoryItemLabelForEnsure[] | null }).itemLabels;
    if (Array.isArray(preloadedLabels)) {
      labelMap.set(inventoryId, preloadedLabels);
    } else {
      idsNeedingLabelFetch.push(inventoryId);
    }
  }
  if (idsNeedingLabelFetch.length > 0) {
    const fetchedLabelMap = await getInventoryItemLabelsByInventoryIds(idsNeedingLabelFetch);
    for (const [inventoryId, labels] of fetchedLabelMap) {
      labelMap.set(inventoryId, labels);
    }
  }
  return Promise.all(inventories.map(async (inventory) => {
    const inventoryId = Number(inventory.id);
    const existingLabels = labelMap.get(inventoryId) ?? [];
    const quantity = inventoryStockQuantity(inventory.quantity);
    const labelQuantity = inventoryLabelQuantity(quantity);
    const labelStatus = inventoryInitialLabelStatus(quantity);
    const countableLabelCount = existingLabels.length;
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
      const startedAt = Date.now();
      const logPerf = (step: string, details: Record<string, unknown> = {}) => {
        console.info("[perf] inventory.getInventories", {
          step,
          elapsedMs: Date.now() - startedAt,
          ...details,
        });
      };
      const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
        const stepStartedAt = Date.now();
        try {
          return await fn();
        } finally {
          console.info("[perf] getInventories.step", {
            name,
            ms: Date.now() - stepStartedAt,
          });
        }
      };
      const zaicoEnabled = await isZaicoEnabled();
      logPerf("zaicoEnabled", { zaicoEnabled });
      // Zaico連携OFFの場合はローカルDBから取得
      if (!zaicoEnabled) {
        const localInvs = await timed("getLocalInventories", () => getLocalInventories());
        const dbDateMap = await timed("getLatestPurchaseDateMapFromDB", () => getLatestPurchaseDateMapFromDB());
        logPerf("localDataLoaded", { inventoryCount: localInvs.length });
        const visibleInvsWithLabels = await ensureStockLabelsForInventories(localInvs);
        logPerf("labelsEnsured", { inventoryCount: visibleInvsWithLabels.length });
        const result = visibleInvsWithLabels.map((inv) => ({
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
        logPerf("complete", { inventoryCount: result.length });
        return result;
      }
      const [inventories, zaicoDateMap, dbDateMap, inventoryExtras, increaseMemosMap] = await Promise.all([
        getInventories(),
        getLatestPurchaseDateMap(),
        getLatestPurchaseDateMapFromDB(),
        getAllInventoryExtras(),
        getLatestIncreaseMemosMap(),
      ]);
      logPerf("zaicoDataLoaded", {
        inventoryCount: inventories.length,
        extraCount: inventoryExtras.length,
      });
      const extrasMap = new Map(inventoryExtras.map((e) => [e.zaicoInventoryId, e]));
      const inventoriesWithLabels = await ensureStockLabelsForInventories(inventories);
      logPerf("labelsEnsured", { inventoryCount: inventoriesWithLabels.length });
      // 追跡番号マップを取得
      const inventoryIds = inventoriesWithLabels.map((inv) => inv.id);
      const trackingMap = await getTrackingNumbersByInventoryIds(inventoryIds);
      logPerf("trackingLoaded", { trackingCount: trackingMap.size });
      // 各在庫に最新入庫日と補足情報を付与
      // 優先順位: DB入庫日 / Zaico API入庫日 / Zaico直接返す日付 / etcフィールド日付 / 手動増加日 のうち最新を使用
      const result = inventoriesWithLabels.map((inv) => {
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
      logPerf("complete", { inventoryCount: result.length });
      return result;
    }),

    getCategories: publicProcedure.query(async () => {
      const startedAt = Date.now();
      const list = await getInventoryCategoryList();
      console.info("[perf] getCategories", { ms: Date.now() - startedAt, count: list.length });
      return list;
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
      .input(purchasePageInputSchema)
      .query(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();

        if (!zaicoEnabled) {
          const t = createStepTimer("purchasesWithCategoryPage");
          const { localInventoryRows, purchaseExtras, ...initialData } = await t.step("parallelFetch", () =>
            loadLocalPurchaseListData("page")
          );
          let { localPurchaseRows } = initialData;
          localPurchaseRows = await t.step("restoreMissingFromOrphanLabels", () =>
            restoreMissingLocalPurchasesFromOrphanLabels(localPurchaseRows, localInventoryRows)
          );
          localPurchaseRows = await t.step("ensureShaftPurchases", () =>
            ensureShaftPurchases(localPurchaseRows, localInventoryRows)
          );
          localPurchaseRows = await t.step("reconcileLabelQuantities", () =>
            reconcileLocalPurchaseLabelQuantities(localPurchaseRows)
          );
          // T22: 分類を解決（auto行は自動判定＋バックフィル、manual行は保存値尊重）
          const inboundInfoMap = await t.step("resolveInboundInfoMap", () =>
            resolveInboundInfoMap(localPurchaseRows, localInventoryRows)
          );
          const invIds = localPurchaseRows
            .map((p) => p.localInventoryId)
            .filter((id): id is number => id != null);
          t.mark("collectInventoryIds");
          const inventoryLabelMap = await t.step("getInventoryItemLabelsByInventoryIds", () =>
            getInventoryItemLabelsByInventoryIds(invIds)
          );
          const purchaseExtraMap = new Map(purchaseExtras.map((extra) => [extra.zaicoId, extra]));
          const invSupplierMap = createPurchaseInventoryMap(localInventoryRows);
          t.mark("prepareSupplierMap");

          await t.step("supplierMapQuery", () =>
            refreshPurchaseInventoryMap(invIds, invSupplierMap)
          );

          const rows = localPurchaseRows.map((p) =>
            buildLocalPurchaseRow(p, {
              extrasById: purchaseExtraMap,
              inventoryById: invSupplierMap,
              inbound: inboundInfoMap.get(p.id),
              getDisplayStatus: (purchase) => getLocalPurchaseDisplayStatus(purchase, inventoryLabelMap),
              getItemLabels: (purchase, item) => labelsForPurchaseItem(purchase, item, inventoryLabelMap),
            })
          );
          t.mark("mapRows");

          attachPurchaseInventoryInfo(rows, invSupplierMap);
          t.mark("attachItemInventoryInfo");

          const response = buildPurchasePageResponse(rows, input);
          t.mark("buildPageResponse");
          t.done({ purchaseCount: localPurchaseRows.length, inventoryCount: localInventoryRows.length, invIdCount: invIds.length });
          return response;
        }

        const [purchases, inventories, extras, inventoryExtras] = await Promise.all([
          getPurchases(),
          getInventories(),
          getAllPurchaseExtras(),
          getAllInventoryExtras(),
        ]);
        const inventoriesWithLabels = await ensureStockLabelsForInventories(inventories);
        const data = createExternalPurchaseMaps({ inventories: inventoriesWithLabels, extras, inventoryExtras });
        const rows = buildExternalPurchasePageRows(purchases, data, toInventoryItemLabelView);

        return buildPurchasePageResponse(rows, input);
      }),

    getPurchasesWithCategory: publicProcedure.query(async () => {
      const zaicoEnabled = await isZaicoEnabled();
      // Zaico連携OFFの場合はローカルDBから取得
      if (!zaicoEnabled) {
        const t = createStepTimer("purchasesWithCategory");
        const { localInventoryRows, purchaseExtras, purchaseHistRows, purchaseHistoriesMs, ...initialData } = await t.step("parallelFetch", () =>
          loadLocalPurchaseListData("all")
        );
        let { localPurchaseRows } = initialData;
        localPurchaseRows = await t.step("restoreMissingFromOrphanLabels", () =>
          restoreMissingLocalPurchasesFromOrphanLabels(localPurchaseRows, localInventoryRows)
        );
        localPurchaseRows = await t.step("ensureShaftPurchases", () =>
          ensureShaftPurchases(localPurchaseRows, localInventoryRows)
        );
        localPurchaseRows = await t.step("reconcileLabelQuantities", () =>
          reconcileLocalPurchaseLabelQuantities(localPurchaseRows)
        );
        const inboundInfoMap = await t.step("resolveInboundInfoMap", () =>
          resolveInboundInfoMap(localPurchaseRows, localInventoryRows)
        );
        // purchase_historiesから有効な入庫履歴（cancelled=0）のzaicoIdセットを構築（ステータス証明用）
        const purchasedZaicoIds = new Set<number>(
          purchaseHistRows
            .filter((h) => h.cancelled === 0 && h.zaicoId != null)
            .map((h) => h.zaicoId as number)
        );
        t.mark("buildPurchasedZaicoIds");
        // localInventoryIdをキーのlocal_inventoriesのsupplierName・supplierUrlを取得
        const invIds = localPurchaseRows
          .map((p) => p.localInventoryId)
            .filter((id): id is number => id != null);
        t.mark("collectInventoryIds");
        const inventoryLabelMap = await t.step("getInventoryItemLabelsByInventoryIds", () =>
          getInventoryItemLabelsByInventoryIds(invIds)
        );
        const purchaseExtraMap = new Map(purchaseExtras.map((extra) => [extra.zaicoId, extra]));
        const invSupplierMap = createPurchaseInventoryMap(localInventoryRows);
        t.mark("prepareSupplierMap");
        await t.step("supplierMapQuery", () =>
          refreshPurchaseInventoryMap(invIds, invSupplierMap)
        );
        const rows = localPurchaseRows.map((p) => ({
          ...buildLocalPurchaseRow(p, {
            extrasById: purchaseExtraMap,
            inventoryById: invSupplierMap,
            inbound: inboundInfoMap.get(p.id),
            // 全件取得だけは、従来どおり有効な入庫履歴も状態判定に使う。
            getDisplayStatus: (purchase) => getLocalPurchaseDisplayStatus(purchase, inventoryLabelMap, purchasedZaicoIds),
            getItemLabels: (purchase, item) => labelsForPurchaseItem(purchase, item, inventoryLabelMap),
          }),
          createdAt: p.createdAt ?? null,
          created_at: p.createdAt instanceof Date ? p.createdAt.toISOString() : (p.createdAt ? String(p.createdAt) : null),
        }));
        t.mark("mapRows");
        attachPurchaseInventoryInfo(rows, invSupplierMap);
        t.mark("attachItemInventoryInfo");
        t.done({
          purchaseCount: localPurchaseRows.length,
          historyCount: purchaseHistRows.length,
          inventoryCount: localInventoryRows.length,
          purchaseHistoriesMs,
        });
        return rows;
      }
      const [purchases, inventories, extras, inventoryExtras] = await Promise.all([
        getPurchases(),
        getInventories(),
        getAllPurchaseExtras(),
        getAllInventoryExtras(),
      ]);

      const data = createExternalPurchaseMaps({ inventories, extras, inventoryExtras });

      // CSVのN列（仕入先名）をインボイスNoをキーにマップ化
      // invoiceNo（C列=cols[2]） -> supplierName（N列=cols[13]）
      const csvSupplierMap = new Map<string, string>();
      try {
        const text = await fetchGithubCsv();
        fillCsvPurchaseSuppliers(text, csvSupplierMap, parseCSVLine);
      } catch (e) {
        console.error("CSV supplier fetch error:", e);
      }

      return buildExternalPurchaseAllRows(purchases, data, csvSupplierMap);
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
      .input(purchaseEditInputSchema)
      .mutation(async ({ input, ctx }) => savePurchaseEdit(input, { recordSnapshot: recordFullRestoreSnapshot, getOperatorName: () => ctx.user.name ?? ctx.user.email ?? null })),

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
        purchaseSupplierInputSchema
      )
      .mutation(async ({ input }) => savePurchaseSupplier(input)),

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

    createOrderedPurchase: createOrderedPurchaseProcedure,

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
        purchaseTrackingInputSchema
      )
      .mutation(async ({ input, ctx }) => savePurchaseTracking(input, ctx.user ?? {})),
    upsertBulk: publicProcedure
      .input(
        purchaseTrackingBulkInputSchema
      )
      .mutation(async ({ input, ctx }) => savePurchaseTrackingBulk(input, ctx.user ?? {})),
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
  orderManagement: orderManagementRouter,
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
  snapshot: snapshotRouter,

  // ============================================================
  // 月次棚卸しレポート（monthly_reports）
  // ============================================================
  monthlyReport: monthlyReportRouter,

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
