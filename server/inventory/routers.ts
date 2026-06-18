import { z } from "zod";
import { COOKIE_NAME, ADMIN_EMAILS } from "@shared/const";
import { getEbayStockType, isEbayManagementNo } from "@shared/ebayInventory";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { getSessionCookieOptions } from "../_core/cookies";
import { systemRouter } from "../_core/systemRouter";
import { protectedProcedure, router } from "../_core/trpc";
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
  getLocalPurchases,
  updateLocalPurchaseStatus,
  countLocalPurchases,
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
} from "./db";

const shipmentSheetNameSchema = z.enum(["独発送管理", "サミー発送管理", "デボン発送管理"]);
type ShipmentSheetName = z.infer<typeof shipmentSheetNameSchema>;

function detectShipmentSheetName(...texts: Array<string | null | undefined>): ShipmentSheetName {
  const haystack = texts.filter(Boolean).join(" ").toLowerCase();
  if (haystack.includes("デボン") || haystack.includes("devon")) return "デボン発送管理";
  if (haystack.includes("サミー") || haystack.includes("samee") || haystack.includes("sami") || haystack.includes("sammy")) {
    return "サミー発送管理";
  }
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
  partner: string;
  invoiceNo: string;
  paymentDate: string;
  productName: string;
  orderQty: number;
  sellingPrice: number | null;
  currency: string;
  status: string;
};

async function getOrderRowsFromTradeRecords(): Promise<OrderCsvRow[]> {
  const db = await getDb();
  if (!db) return [];
  const { tradeRecords } = await import("../../drizzle/schema");
  const rows = await db
    .select({
      partner: tradeRecords.partner,
      invoiceNo: tradeRecords.no,
      paymentDate: tradeRecords.paymentDate,
      productName: tradeRecords.productName,
      orderQty: tradeRecords.quantity,
      sellingPrice: tradeRecords.unitPrice,
      currency: tradeRecords.currency,
      status: tradeRecords.status,
    })
    .from(tradeRecords);

  return rows
    .map((row) => ({
      partner: row.partner?.trim() || "その他",
      invoiceNo: row.invoiceNo != null ? String(row.invoiceNo) : "",
      paymentDate: row.paymentDate ?? "",
      productName: row.productName ?? "",
      orderQty: Number(row.orderQty ?? 0) || 0,
      sellingPrice: row.sellingPrice == null ? null : Number(row.sellingPrice) || null,
      currency: row.currency ?? "",
      status: row.status ?? "",
    }))
    .filter((row) => row.invoiceNo && /^\d+$/.test(row.invoiceNo))
    .sort((a, b) => Number(a.invoiceNo) - Number(b.invoiceNo));
}

type ShipmentGasItem = { productNameJa: string; productNameEn: string; quantity: number };

function invoiceNoFromDeliveryNo(deliveryNo: string): string {
  return deliveryNo.match(/^(\d+)/)?.[1] ?? deliveryNo;
}

function compactShipmentName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[　\s・･_\-ー]/g, "")
    .replace(/ニンテンドー|nintendo/g, "")
    .replace(/カラー/g, "color")
    .trim();
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
  if (target.includes("dsi")) return target.includes("ll") ? "dsill" : "dsi";
  if (target.includes("dslite")) return "dslite";
  return target;
}

function shipmentColorTokens(value: string): Set<string> {
  const target = compactShipmentName(value);
  const tokens = new Set<string>();
  const pairs: Array<[string, string]> = [
    ["ブラック", "black"], ["黒", "black"], ["black", "black"],
    ["ホワイト", "white"], ["白", "white"], ["white", "white"],
    ["ブルー", "blue"], ["青", "blue"], ["blue", "blue"],
    ["レッド", "red"], ["赤", "red"], ["red", "red"],
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
  for (const color of orderColors) {
    if (color === "metallic") continue;
    if (shippedColors.has(color)) return true;
  }
  return false;
}

async function alignShipmentItemsToOrderRows(invoiceNo: string, items: ShipmentGasItem[]): Promise<ShipmentGasItem[]> {
  const orderRows = (await getOrderRowsFromTradeRecords().catch(() => []))
    .filter((row) => row.invoiceNo === invoiceNo && row.productName.trim());
  if (orderRows.length === 0) return items;

  const sortedRows = [...orderRows].sort((a, b) => {
    const aRandom = isRandomShipmentName(a.productName) ? 1 : 0;
    const bRandom = isRandomShipmentName(b.productName) ? 1 : 0;
    return aRandom - bRandom || shipmentColorTokens(b.productName).size - shipmentColorTokens(a.productName).size;
  });

  const grouped = new Map<string, ShipmentGasItem>();
  for (const item of items) {
    const shippedName = item.productNameJa || item.productNameEn;
    const match = sortedRows.find((row) => shipmentProductMatches(row.productName, shippedName));
    const name = match?.productName || item.productNameJa || item.productNameEn;
    const current = grouped.get(name);
    if (current) current.quantity += item.quantity;
    else grouped.set(name, { productNameJa: name, productNameEn: name, quantity: item.quantity });
  }
  return Array.from(grouped.values()).filter((item) => item.quantity > 0);
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
};

function deliveryHistoryItemsToShipmentItems(itemsJson: string): ShipmentDisplayItem[] {
  let items: Array<{ title?: string; productNameJa?: string; productNameEn?: string; quantity?: unknown }> = [];
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
      return { productNameJa: name, productNameEn: name, quantity };
    })
    .filter((item) => item.productNameJa && item.quantity > 0);
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
    const history = (shipment.historyId ? historyById.get(shipment.historyId) : undefined)
      ?? historyByDeliveryNo.get(shipment.deliveryNo);
    if (!history) return shipment;

    const historyItems = deliveryHistoryItemsToShipmentItems(history.itemsJson);
    if (historyItems.length === 0) return shipment;
    return { ...shipment, itemsJson: JSON.stringify(historyItems) };
  });
}

function resolveOperatorToken(_operatorKey?: string): string | undefined {
  return undefined;
}

const publicProcedure = protectedProcedure;

type PurchasePageInput = {
  page?: number;
  pageSize?: number;
  status?: "ordered" | "shipped" | null;
  category?: string | null;
  search?: string | null;
};

type PurchasePageRow = {
  status: string;
  num?: string | null;
  csvSupplierName?: string | null;
  extra?: { trackingNumber?: string | null } | null;
  purchase_items: Array<{
    title?: string | null;
    quantity?: string | number | null;
    unit_price?: string | number | null;
    etc?: string | null;
    category?: string | null;
  }>;
};

function getEffectivePurchaseStatus(row: PurchasePageRow) {
  if (row.status !== "purchased" && row.extra?.trackingNumber) return "shipped";
  return row.status;
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
      return [item.title, etc, parts[0], parts[2]];
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

function buildPurchasePageResponse<T extends PurchasePageRow>(rows: T[], input?: PurchasePageInput) {
  const pageSize = Math.min(Math.max(input?.pageSize ?? 20, 1), 100);
  const requestedPage = Math.max(input?.page ?? 1, 1);
  const category = input?.category?.trim();
  const search = input?.search?.trim() ?? "";
  const status = input?.status ?? null;
  const activeRows = rows.filter((row) => row.status !== "purchased");
  let filteredRows = activeRows;

  if (category && category !== "すべて") {
    filteredRows = filteredRows.filter((row) =>
      row.purchase_items.some((item) => (item.category || "未分類") === category)
    );
  }
  if (status) {
    filteredRows = filteredRows.filter((row) => getEffectivePurchaseStatus(row) === status);
  }
  if (search) {
    filteredRows = filteredRows.filter((row) => purchaseRowMatchesSearch(row, search));
  }

  const totalCount = filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize;
  const items = filteredRows.slice(start, start + pageSize);
  const summary = summarizePurchaseRows(activeRows);

  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages,
    allCount: activeRows.length,
    ...summary,
  };
}

export const inventoryRouter = router({
  system: systemRouter,
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
      const localPurchaseRows = await getLocalPurchases();
      return localPurchaseRows.map((p) => {
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
          status: p.status === "purchased" ? "purchased" : "ordered",
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
            status: p.status === "purchased" ? "purchased" : "ordered",
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
            status: p.status === "purchased" ? "purchased" : "ordered",
            purchase_date: p.receivedDate ?? null,
            estimated_purchase_date: p.purchaseDate ?? null,
            etc: typeof item.etc === "string" ? item.etc : p.managementNo ?? undefined,
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
            operatorName: input.operatorName ?? (ctx.user?.name ?? null),
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
        const [localInvs, dbDateMap, deletedFromHistoryIds] = await Promise.all([
          getLocalInventories(),
          getLatestPurchaseDateMapFromDB(),
          getDeletedInventoryIdsFromDeliveryHistories(),
        ]);
        const hiddenInvs: typeof localInvs = [];
        const visibleInvs = localInvs.filter((inv) => {
          const displayId = inv.zaicoId ?? inv.id;
          const hidden = deletedFromHistoryIds.has(displayId) || deletedFromHistoryIds.has(inv.id) || (inv.zaicoId != null && deletedFromHistoryIds.has(inv.zaicoId));
          if (hidden) hiddenInvs.push(inv);
          return !hidden;
        });
        await Promise.all(hiddenInvs.map((inv) => deleteLocalInventory(inv.id).catch(() => {})));
        return visibleInvs.map((inv) => ({
          id: inv.zaicoId ?? inv.id,
          title: inv.title,
          quantity: String(inv.quantity ?? 0),
          unit: inv.unit ?? "個",
          unit_price: inv.unitPrice != null ? Number(inv.unitPrice) : null,
          category: inv.category ?? null,
          categories: inv.category ? [inv.category] : [],
          place: inv.place ?? null,
          etc: inv.etc ?? null,
          last_purchase_date: dbDateMap[inv.zaicoId ?? inv.id] ?? null,
          supplierUrl: inv.supplierUrl ?? null,
          supplierName: inv.supplierName ?? null,
          ebayListingUrl: inv.ebayListingUrl ?? null,
          ebayOrderUrl: inv.ebayOrderUrl ?? null,
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
      // 追跡番号マップを取得
      const inventoryIds = inventories.map((inv) => inv.id);
      const trackingMap = await getTrackingNumbersByInventoryIds(inventoryIds);
      // 各在庫に最新入庫日と補足情報を付与
      // 優先順位: DB入庫日 / Zaico API入庫日 / Zaico直接返す日付 / etcフィールド日付 / 手動増加日 のうち最新を使用
      return inventories.map((inv) => {
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
      .mutation(async ({ input }) => {
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
      }).optional())
      .query(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();

        if (!zaicoEnabled) {
          const localPurchaseRows = await getLocalPurchases();
          const invIds = localPurchaseRows
            .map((p) => p.localInventoryId)
            .filter((id): id is number => id != null);
          const invSupplierMap = new Map<number, { supplierName: string | null; supplierUrl: string | null; ebayListingUrl: string | null }>();

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
              }).from(localInvTbl).where(inArray(localInvTbl.id, invIds));
              for (const row of rows) {
                invSupplierMap.set(row.id, {
                  supplierName: row.supplierName ?? null,
                  supplierUrl: row.supplierUrl ?? null,
                  ebayListingUrl: row.ebayListingUrl ?? null,
                });
              }
            }
          }

          const rows = localPurchaseRows.map((p) => {
            const inv = p.localInventoryId ? invSupplierMap.get(p.localInventoryId) : null;
            return {
              id: p.zaicoId ?? p.id,
              num: p.purchaseNum ?? "",
              purchase_date: p.purchaseDate ?? null,
              status: p.status,
              csvSupplierName: p.supplierName ?? inv?.supplierName ?? null,
              csvSupplierUrl: p.supplierUrl ?? inv?.supplierUrl ?? null,
              extra: {
                shipDate: p.shipDate ?? null,
                trackingNumber: p.trackingNumber ?? null,
                carrier: p.carrier ?? null,
                note: p.note ?? null,
              },
              purchase_items: (() => {
                try {
                  const items = JSON.parse(p.itemsJson ?? "[]");
                  return Array.isArray(items) ? items.map((item: Record<string, unknown>) => ({
                    ...item,
                    category: p.category ?? "未分類",
                  })) : [];
                } catch {
                  return [{
                    id: p.id,
                    title: p.title,
                    quantity: String(p.quantity ?? 1),
                    unit_price: p.unitPrice ?? null,
                    etc: p.managementNo ?? null,
                    status: p.status,
                    inventory_id: null,
                    category: p.category ?? "未分類",
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
        const inventoryMap = new Map(inventories.map((inv) => [inv.id, inv]));
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
        const [localPurchaseRows, purchaseHistRows] = await Promise.all([
          getLocalPurchases(),
          getPurchaseHistories(2000),
        ]);
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
        const invSupplierMap = new Map<number, { supplierName: string | null; supplierUrl: string | null; ebayListingUrl: string | null }>();
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
            }).from(localInvTbl).where(inArray(localInvTbl.id, invIds));
            for (const row of rows) {
              invSupplierMap.set(row.id, {
                supplierName: row.supplierName ?? null,
                supplierUrl: row.supplierUrl ?? null,
                ebayListingUrl: row.ebayListingUrl ?? null,
              });
            }
          }
        }
        const rows = localPurchaseRows.map((p) => {
          const inv = p.localInventoryId ? invSupplierMap.get(p.localInventoryId) : null;
          // local_purchasesのstatusがpurchased、またはpurchase_historiesに有効な入庫履歴があればpurchased
          const localId = p.zaicoId ?? p.id;
          const isPurchased = p.status === "purchased" || purchasedZaicoIds.has(localId);
          return {
            id: localId,
            num: p.purchaseNum ?? "",
            purchase_date: p.purchaseDate ?? null,
            status: isPurchased ? "purchased" : "ordered",
            // local_purchases自体のsupplierName/Urlを優先、なければlocal_inventoriesから取得
            csvSupplierName: p.supplierName ?? inv?.supplierName ?? null,
            csvSupplierUrl: p.supplierUrl ?? inv?.supplierUrl ?? null,
          extra: {
            shipDate: p.shipDate ?? null,
            trackingNumber: p.trackingNumber ?? null,
            carrier: p.carrier ?? null,
            note: p.note ?? null,
          },
          purchase_items: (() => {
              try {
                const items = JSON.parse(p.itemsJson ?? "[]");
                return Array.isArray(items) ? items.map((item: Record<string, unknown>) => ({
                  ...item,
                  category: p.category ?? "未分類",
                })) : [];
              } catch {
                return [{
                  id: p.id,
                  title: p.title,
                  quantity: String(p.quantity ?? 1),
                  unit_price: p.unitPrice ?? null,
                  etc: p.managementNo ?? null,
                  status: p.status,
                  inventory_id: null,
                  category: p.category ?? "未分類",
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
            code: undefined as string | undefined,
            optional_attributes: [] as Array<{ name: string; value: string | null }>,
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
          const srnPrefix = srnFromEtc.replace(/_\d+\/\d+$/, "");
          const { localPurchases: lpTbl } = await import("../../drizzle/schema");
          const { like } = await import("drizzle-orm");
          const db = await getDb();
          const rows = db
            ? await db.select().from(lpTbl).where(like(lpTbl.managementNo, `${srnPrefix}%`))
            : (await getLocalPurchases()).filter((p) => String(p.managementNo ?? "").startsWith(srnPrefix));
          // フロントエンドが期待する形式に変換
          return rows.map((p) => ({
            id: p.id,
            num: p.purchaseNum ?? "",
            status: p.status === "purchased" ? "purchased" : "ordered",
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
      .mutation(async ({ input }) => {
        const operatorToken = resolveOperatorToken(input.operatorKey);
        const zaicoEnabled = await isZaicoEnabled();
        if (!zaicoEnabled) {
          // Zaico連携OFF時はローカルDBから直接削除
          // purchaseIdはzaicoIdまたはidのどちらかなので両方で検索
          const { localPurchases: lpTbl, localInventories: liTbl } = await import("../../drizzle/schema");
          const { or, eq } = await import("drizzle-orm");
          const db = await getDb();
          if (db) {
            // まず対象のlocal_purchasesを取得してlocalInventoryIdを確認
            const [targetPurchase] = await db.select({
              id: lpTbl.id,
              localInventoryId: lpTbl.localInventoryId,
            }).from(lpTbl).where(
              or(
                eq(lpTbl.id, input.purchaseId),
                eq(lpTbl.zaicoId, input.purchaseId)
              )
            ).limit(1);
            // local_purchasesを削除
            await db.delete(lpTbl).where(
              or(
                eq(lpTbl.id, input.purchaseId),
                eq(lpTbl.zaicoId, input.purchaseId)
              )
            );
            // localInventoryIdが存在する場合はlocal_inventoriesも削除
            const localInventoryId = targetPurchase?.localInventoryId ?? (input.inventoryId ?? null);
            if (localInventoryId) {
              await db.delete(liTbl).where(eq(liTbl.id, localInventoryId));
            }
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
        // 在庫も同時削除（inventoryIdが指定された場合）
        if (input.inventoryId) {
          try {
            await deleteInventory(input.inventoryId, operatorToken);
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "";
            if (!msg.includes("404") && !msg.includes("Not Found")) {
              console.error(`[deletePurchaseOnly] deleteInventory failed:`, err);
            }
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
      .mutation(async ({ input }) => {
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
            const lpUpdateData: Partial<typeof lpTbl.$inferInsert> = {};
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
              if (lp.localInventoryId) {
                await db.update(liTbl).set({ unitPrice }).where(eq(liTbl.id, lp.localInventoryId));
              }
            }
            if (firstItem?.title !== undefined) {
              const nextTitle = firstItem.title.trim();
              (lpUpdateData as Record<string, unknown>).title = nextTitle;
              updateFirstItemJson({ title: nextTitle });
              if (lp.localInventoryId) {
                await db.update(liTbl).set({ title: nextTitle }).where(eq(liTbl.id, lp.localInventoryId));
              }
            }
            if (firstItem?.etc !== undefined) {
              const nextManagementNo = firstItem.etc.split(",")[0]?.trim() ?? (lp.managementNo ?? undefined);
              lpUpdateData.managementNo = nextManagementNo;
              updateFirstItemJson({ etc: firstItem.etc });
              if (lp.localInventoryId) {
                await db.update(liTbl).set({ etc: firstItem.etc || nextManagementNo || null }).where(eq(liTbl.id, lp.localInventoryId));
              }
            }
            if (firstItem?.category !== undefined) {
              const nextCategory = normalizeCategoryName(firstItem.category) || null;
              (lpUpdateData as Record<string, unknown>).category = nextCategory;
              updateFirstItemJson({ category: nextCategory });
              if (lp.localInventoryId) {
                await db.update(liTbl).set({ category: nextCategory }).where(eq(liTbl.id, lp.localInventoryId));
              }
            }
            if (Object.keys(lpUpdateData).length > 0) {
              await db.update(lpTbl).set(lpUpdateData).where(eq(lpTbl.id, lp.id));
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
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const operatorToken = resolveOperatorToken(input.operatorKey);

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBから削除（論理削除）
          const localInv = await getLocalInventoryByZaicoIdOrId(input.inventoryId);
          if (localInv) {
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
          }
          // 連動削除が指定された場合はlocal_purchasesも削除
          if (input.alsoDeletePurchaseIds && input.alsoDeletePurchaseIds.length > 0) {
            const { localPurchases: lpTbl } = await import("../../drizzle/schema");
            const { inArray } = await import("drizzle-orm");
            const db = await getDb();
            if (db) {
              await db.delete(lpTbl).where(inArray(lpTbl.id, input.alsoDeletePurchaseIds));
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
      .mutation(async ({ input }) => {
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
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const { operatorKey, supplierUrl, supplierName, ebayListingUrl, ebayOrderUrl, ...payload } = input;

        if (!zaicoEnabled) {
          // Zaico連携OFF: ローカルDBに商品を作成
          await upsertLocalInventory({
            zaicoId: null,
            title: payload.title,
            category: payload.category ?? null,
            place: payload.place ?? null,
            quantity: Math.round(parseFloat(payload.quantity ?? "0") || 0),
            unit: payload.unit ?? "個",
            unitPrice: payload.purchase_unit_price != null ? String(payload.purchase_unit_price) : null,
            etc: payload.etc ?? null,
            supplierUrl: supplierUrl || null,
            supplierName: supplierName || null,
            ebayListingUrl: getEbayStockType(payload.etc) === "stocked" ? normalizeListingUrl(ebayListingUrl) : null,
            ebayOrderUrl: normalizeListingUrl(ebayOrderUrl),
            isDeleted: 0,
          });
          return { code: 200, status: "ok", message: "商品を登録しました（ローカルDB）", data_id: 0 };
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
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        const { inventoryId, operatorKey, supplierUrl, supplierName, ebayListingUrl, ebayOrderUrl, ...payload } = input;

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
            await updateLocalInventory(localInv.id, {
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
            });
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
        saleAmount: z.number().min(0),
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
          const allPurchases = await getLocalPurchases();
          const maxNum = allPurchases.reduce((max, p) => {
            const n = parseInt(p.purchaseNum ?? "0", 10);
            return n > max ? n : max;
          }, 0);
          const newNum = String(maxNum + 1);
          await upsertLocalPurchase({
            zaicoId: null,
            purchaseNum: input.num ?? newNum,
            status: "ordered",
            itemsJson: JSON.stringify([{
              id: 0,
              title: input.title,
              quantity: String(input.quantity),
              unit_price: input.unitPrice ?? null,
              etc: input.managementNo ?? null,
              status: "ordered",
              inventory_id: input.inventoryId,
            }]),
            localInventoryId: null,
            title: input.title,
            category: null,
            quantity: input.quantity,
            unitPrice: input.unitPrice != null ? String(input.unitPrice) : null,
            managementNo: input.managementNo ?? null,
            purchaseDate: input.estimatedPurchaseDate ?? null,
            receivedDate: null,
          });
          return { code: 200, status: "ok", message: "発注データを登録しました（ローカルDB）", data_id: 0 };
        }

        const token = resolveOperatorToken(input.operatorKey);
        const payload = {
          status: "ordered" as const,
          customer_name: input.customerName,
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
            })
          ).min(1, "出庫する商品を選択してください"),
          // FedEx発送情報（任意）
          trackingNumber: z.string().optional(),
          sheetName: shipmentSheetNameSchema.optional(),
          invoiceNo: z.string().optional(), // CSV商品集計用のインボイスNo
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();

        let zaicoResult: { code: number; status: string; message: string; data_id: number } | null = null;
        let historyStatus: "success" | "error" = "success";
        let errorMessage: string | undefined;

        if (zaicoEnabled) {
          // Zaico連携ON: Zaico APIに出庫データを作成
          const payload = {
            num: input.deliveryNo,
            status: "completed_delivery" as const,
            delivery_date: input.deliveryDate,
            deliveries: input.items.map((item) => ({
              inventory_id: item.inventoryId,
              quantity: item.quantity,
              ...(item.unitPrice !== undefined ? { unit_price: item.unitPrice } : {}),
            })),
          };
          try {
            zaicoResult = await createDelivery(payload);
          } catch (err: unknown) {
            historyStatus = "error";
            errorMessage = err instanceof Error ? err.message : "不明なエラー";
          }
        } else {
          // Zaico連携OFF: ローカルDBの在庫数を減算する
          try {
            for (const item of input.items) {
              // zaicoIdで検索（inventoryIdはZaico側のID）
              const localInv = await getLocalInventoryByZaicoIdOrId(item.inventoryId);
              if (localInv) {
                const newQty = Math.max(0, (localInv.quantity ?? 0) - item.quantity);
                await updateLocalInventory(localInv.id, { quantity: newQty });
              }
            }
          } catch (err: unknown) {
            historyStatus = "error";
            errorMessage = err instanceof Error ? err.message : "ローカルDB在庫更新エラー";
          }
        }

        const historyItems = await Promise.all(
          input.items.map(async (item) => {
            const localInv = await getLocalInventoryByZaicoIdOrId(item.inventoryId).catch(() => null);
            const managementNo = localInv?.etc?.split(",")[0]?.trim() || null;
            return {
              inventoryId: item.inventoryId,
              title: item.title,
              quantity: item.quantity,
              ...(managementNo ? { managementNo } : {}),
            };
          })
        );

        // 出庫履歴をDBに保存
        await createDeliveryHistory({
          deliveryNo: input.deliveryNo,
          zaicoDeliveryId: zaicoResult?.data_id ?? null,
          itemsJson: JSON.stringify(historyItems),
          status: historyStatus,
          errorMessage: errorMessage ?? null,
        });

        if (historyStatus === "error") {
          throw new Error(errorMessage ?? "出庫処理に失敗しました");
        }

        // FedEx発送情報が入力された場合は発送登録も行う
        let fedexResult: { success: boolean; message: string } | null = null;
        if (input.trackingNumber && input.sheetName) {
          try {
            // 発送日：当日日付を M/D 形式で自動設定
            const now = new Date();
            const shippingDate = `${now.getMonth() + 1}/${now.getDate()}`;

            // インボイスNoを導出（deliveryNoの先頭数字、またはinvoiceNo入力値）
            const invoiceNo = input.invoiceNo ?? (input.deliveryNo.match(/^(\d+)/)?.[1] ?? input.deliveryNo);

            // CSV商品データを取得して商品集計
            let csvProducts: Array<{ name: string; qty: number }> = [];
            try {
              for (const row of await getOrderRowsFromTradeRecords()) {
                const csvInvoiceNo = row.invoiceNo;
                if (csvInvoiceNo !== invoiceNo) continue;
                const productName = row.productName;
                const orderQty = row.orderQty;
                if (productName) csvProducts.push({ name: productName, qty: orderQty });
              }
            } catch { /* CSV取得失敗時は商品名直接使用 */ }

            // 商品名マッチング：CSV商品ごとに出庫商品を集計
            const extractModelKey = (title: string): string => {
              const t = title.toLowerCase();
              if (t.includes("new 2ds ll") || t.includes("new2dsll")) return "New2DSLL";
              if (t.includes("vita 2000") || t.includes("vita2000") || (t.includes("vita") && t.includes("2000"))) return "Vita2000";
              if (t.includes("vita 1000") || t.includes("vita1000") || (t.includes("vita") && !t.includes("2000"))) return "Vita1000";
              if (t.includes("new 3ds ll") || t.includes("new3dsll")) return "New3DSLL";
              if ((t.includes("new 3ds") || t.includes("new3ds")) && !t.includes("ll")) return "New3DS";
              if ((t.includes("3ds ll") || t.includes("3dsll")) && !t.includes("new")) return "3DSLL";
              if (t.includes("3ds") && !t.includes("ll") && !t.includes("new")) return "3DS";
              if (t.includes("psp")) return "PSP";
              if (t.includes("ps5")) return "PS5";
              if (t.includes("ps4")) return "PS4";
              return "";
            };
            const extractColorKey = (name: string): string => {
              const modelPatterns = [
                /^new\s*2ds\s*ll\s*/i, /^new\s*3ds\s*ll\s*/i, /^new\s*3ds\s*/i,
                /^3ds\s*ll\s*/i, /^3ds\s*/i, /^ps\s*vita\s*2000\s*/i,
                /^ps\s*vita\s*1000\s*/i, /^ps\s*vita\s*/i, /^vita\s*2000\s*/i,
                /^vita\s*1000\s*/i, /^vita\s*/i, /^psp\s*/i, /^ps5\s*/i, /^ps4\s*/i,
              ];
              let working = name.trim();
              for (const pat of modelPatterns) {
                if (pat.test(working)) { working = working.replace(pat, "").trim(); break; }
              }
              return working;
            };
            const normalizeColorToken = (value: string): string =>
              value.normalize("NFKC").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
            const isColorlessRandomColor = (colorName: string): boolean => {
              if (!colorName.normalize("NFKC").trim()) return true;
              const compact = normalizeColorToken(colorName);
              if (!compact) return false;
              if (/^(psp|pspgo|ps5|ps4|psvita|vita|vita1000|vita2000|new3dsll|new3ds|new2dsll|3dsll|3ds)$/.test(compact)) return true;
              if (/^\d{3,4}$/.test(compact)) return true;
              if (/^(?:\d{3,4})?(?:grade|rank)[abc]$/.test(compact)) return true;
              if (/^\d{3,4}(?:only|body|console|unit|set)$/.test(compact)) return true;
              return false;
            };
            const colorlessQualifierMatches = (colorName: string, title: string): boolean => {
              const compactColor = normalizeColorToken(colorName);
              const compactTitle = normalizeColorToken(title);
              const version = compactColor.match(/(?:1000|2000|3000)/)?.[0];
              if (version && !compactTitle.includes(version)) return false;
              const grade = compactColor.match(/(?:grade|rank)([abc])/)?.[1];
              if (grade && !compactTitle.includes(`grade${grade}`) && !compactTitle.includes(`rank${grade}`)) return false;
              return true;
            };
            const matchesCsvProduct = (csvName: string, invTitle: string): boolean => {
              const csvModel = extractModelKey(csvName);
              const invModel = extractModelKey(invTitle);
              if (!csvModel || !invModel || csvModel !== invModel) return false;
              const csvColor = extractColorKey(csvName);
              const invColor = extractColorKey(invTitle);
              if (/\u30e9\u30f3\u30c0\u30e0|random|ramdom/i.test(csvColor)) return true;
              if (isColorlessRandomColor(csvColor)) return colorlessQualifierMatches(csvColor, invTitle);
              if (/^other$/i.test(csvColor.trim()) || /other colors?/i.test(csvColor) || /\u305d\u306e\u4ed6|\u305d\u308c\u4ee5\u5916|\u4ee5\u5916/.test(csvColor)) return true;
              const baseMatch = csvColor.match(/^(.+?)\u30d9\u30fc\u30b9$/);
              if (baseMatch) {
                const bc = baseMatch[1].trim().toLowerCase();
                return invColor.toLowerCase().includes(bc) || invTitle.toLowerCase().includes(bc);
              }
              if (csvColor.includes("&")) {
                const parts = csvColor.split("&").map(p => p.trim().toLowerCase());
                return parts.some(p => invColor.toLowerCase().includes(p) || invTitle.toLowerCase().includes(p));
              }
              if (csvColor.includes("\u00d7")) {
                const parts = csvColor.split("\u00d7").map(p => p.trim().toLowerCase());
                return parts.every(p => invColor.toLowerCase().includes(p) || invTitle.toLowerCase().includes(p));
              }
              const cc = csvColor.toLowerCase();
              return invColor.toLowerCase().includes(cc) || invTitle.toLowerCase().includes(cc);
            };

            // 出庫商品をCSV商品にマッピングして数量集計
            const aggregated: Map<string, { productNameJa: string; productNameEn: string; quantity: number }> = new Map();
            if (csvProducts.length > 0) {
              for (const cp of csvProducts) {
                let total = 0;
                for (const item of input.items) {
                  if (matchesCsvProduct(cp.name, item.title)) total += item.quantity;
                }
                if (total > 0) {
                  aggregated.set(cp.name, { productNameJa: cp.name, productNameEn: cp.name, quantity: total });
                }
              }
              // CSV未登録商品も追加
              for (const item of input.items) {
                const matched = csvProducts.some(cp => matchesCsvProduct(cp.name, item.title));
                if (!matched) {
                  const existing = aggregated.get(item.title);
                  if (existing) {
                    existing.quantity += item.quantity;
                  } else {
                    aggregated.set(item.title, { productNameJa: item.title, productNameEn: item.title, quantity: item.quantity });
                  }
                }
              }
            } else {
              // CSVデータなし: 出庫商品をそのまま使用
              for (const item of input.items) {
                const existing = aggregated.get(item.title);
                if (existing) existing.quantity += item.quantity;
                else aggregated.set(item.title, { productNameJa: item.title, productNameEn: item.title, quantity: item.quantity });
              }
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
              operatorName: "delivery-form",
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
        return getPurchaseHistories(input.limit);
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
  // 入庫補足情報（発送日・追跡番号）
  // ============================================================
  purchaseExtra: router({
    upsert: publicProcedure
      .input(
        z.object({
          zaicoId: z.number().int().positive(),
          shipDate: z.string().optional(),
          trackingNumber: z.string().max(200).optional(),
          carrier: z.string().max(50).optional(),
          note: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        if (!zaicoEnabled) {
          // Zaico OFF: local_purchasesを直接更新
          const { localPurchases: lpTbl } = await import("../../drizzle/schema");
          const { eq } = await import("drizzle-orm");
          const db = await getDb();
          if (db) {
            await db.update(lpTbl).set({
              shipDate: input.shipDate ?? null,
              trackingNumber: input.trackingNumber ?? null,
              carrier: input.carrier ?? null,
              note: input.note ?? null,
            }).where(eq(lpTbl.id, input.zaicoId));
          }
          return { success: true };
        }
        await upsertPurchaseExtra({
          zaicoId: input.zaicoId,
          shipDate: input.shipDate ?? null,
          trackingNumber: input.trackingNumber ?? null,
          carrier: input.carrier ?? null,
          note: input.note ?? null,
        });
        return { success: true };
      }),
    upsertBulk: publicProcedure
      .input(
        z.object({
          zaicoIds: z.array(z.number().int().positive()).min(1).max(100),
          shipDate: z.string().optional(),
          trackingNumber: z.string().max(200).optional(),
          carrier: z.string().max(50).optional(),
          note: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const zaicoEnabled = await isZaicoEnabled();
        if (!zaicoEnabled) {
          // Zaico OFF: local_purchasesを直接一括更新
          const { localPurchases: lpTbl } = await import("../../drizzle/schema");
          const { inArray } = await import("drizzle-orm");
          const db = await getDb();
          if (db) {
            await db.update(lpTbl).set({
              shipDate: input.shipDate ?? null,
              trackingNumber: input.trackingNumber ?? null,
              carrier: input.carrier ?? null,
              note: input.note ?? null,
            }).where(inArray(lpTbl.id, input.zaicoIds));
          }
          return { success: true, count: input.zaicoIds.length };
        }
        await Promise.all(
          input.zaicoIds.map((zaicoId) =>
            upsertPurchaseExtra({
              zaicoId,
              shipDate: input.shipDate ?? null,
              trackingNumber: input.trackingNumber ?? null,
              carrier: input.carrier ?? null,
              note: input.note ?? null,
            })
          )
        );
        return { success: true, count: input.zaicoIds.length };
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
              const invoiceNo = shipment.deliveryNo.match(/^(\d+)/)?.[1] ?? shipment.deliveryNo;
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

    /**
     * 管理番号の先頭数字をキーに、発注済み数・出庫済み数・在庫数を集計する
     * 出庫 No の先頭数字（_ より前）と管理番号の先頭数字を照合
     * CSVのインボイスNoとも照合して発注数・取引先を追加
     */
    getSummary: publicProcedure.query(async () => {
      const zaicoEnabled = await isZaicoEnabled();
      type CsvRow = { partner: string; invoiceNo: string; productName: string; orderQty: number; status: string; paymentDate: string };
      const deliveriesPromise = getDeliveryHistories(1000);
      const allMemosPromise = getAllInvoiceMemos();
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
          let items: Array<{ inventory_id?: number | null; title: string; quantity: string; unit_price?: string | number | null; etc?: string | null }> = [];
          try {
            const parsed = JSON.parse(p.itemsJson ?? "[]");
            items = Array.isArray(parsed) ? parsed : [];
          } catch {
            items = [{ inventory_id: p.localInventoryId ?? null, title: p.title ?? "", quantity: String(p.quantity ?? 1), unit_price: p.unitPrice != null ? Number(p.unitPrice) : null, etc: p.managementNo ?? null }];
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
        const match = raw.match(/^(\d+)/);
        return match ? match[1] : null;
      }

      // 出庫 No から先頭数字を抽出する関数
      function extractKeyFromDeliveryNo(deliveryNo: string): string | null {
        const match = deliveryNo.match(/^(\d+)/);
        return match ? match[1] : null;
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
        purchaseItems: Array<{ purchaseId: number; num: string; title: string; quantity: number; status: string; managementNo: string }>;
        inventoryItems: Array<{ inventoryId: number; title: string; quantity: number; managementNo: string; etc: string; unitPrice: string; trackingNumber: string; supplierUrl: string; supplierName: string }>;
        deliveryItems: Array<{ deliveryNo: string; title: string; quantity: number; deliveredAt: string; managementNo: string; unitPrice: string; trackingNumber: string; supplierUrl: string; supplierName: string }>;
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
            purchaseItems: [],
            inventoryItems: [],
            deliveryItems: [],
          });
        }
        return groups.get(key)!;
      }

      // CSVインボイスマップにあるキーを先に登録（CSVのインボイスNoが存在するキーを必ず表示）
      for (const invoiceNo of Array.from(csvInvoiceMap.keys())) {
        getOrCreate(invoiceNo);
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
          // 入庫済み（purchased）は発注一覧から除外
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
        if (t.includes("new 3ds ll") || t.includes("new3dsll")) return "New3DSLL";
        if ((t.includes("new 3ds") || t.includes("new3ds")) && !t.includes("ll")) return "New3DS";
        if ((t.includes("3ds ll") || t.includes("3dsll")) && !t.includes("new")) return "3DSLL";
        if (t.includes("3ds") && !t.includes("ll") && !t.includes("new")) return "3DS";
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
          /^3ds\s*ll\s*/i,
          /^3ds\s*/i,
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
        if (/^(psp|pspgo|ps5|ps4|psvita|vita|vita1000|vita2000|new3dsll|new3ds|new2dsll|3dsll|3ds)$/.test(compact)) return true;
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

      function extractBaseColor(colorName: string): string | null {
        const m = colorName.match(/^(.+?)ベース$/);
        return m ? m[1].trim() : null;
      }

      // 在庫商品名がCSV商品名にマッチするか判定（管理番号も参照可能）
      // csvProductName: CSVの商品名（例: "New3DS ランダムカラー"、"Vita 1000 レッド&ブルー"）
      // invTitle: Zaico在庫商品名（例: "Vita1000 コズミックレッド"）
      // invManagementNo: Zaico在庫管理番号（例: "369_ルカ_レッド_3/10"）
      function invMatchesCsvProduct(csvProductName: string, invTitle: string, invManagementNo?: string): boolean {
        const csvModel = extractModelFromTitle(csvProductName);
        const invModel = extractModelFromTitle(invTitle);
        // 機種が一致しない場合は除外
        if (!csvModel || !invModel || csvModel !== invModel) return false;

        const csvColor = extractColorFromName(csvProductName);
        const invColor = extractColorFromName(invTitle);
        const mnLower = (invManagementNo ?? "").toLowerCase();

        if (isRandomColorName(csvColor)) {
          // ランダムカラー: 機種が一致すれば色は不問
          return true;
        }

        if (isColorlessRandomColorName(csvColor)) {
          return colorlessQualifierMatches(csvColor, invTitle, invManagementNo);
        }

        if (isOtherColorName(csvColor)) {
          return true;
        }

        const baseColor = extractBaseColor(csvColor);
        if (baseColor) {
          // ○○ベース: 在庫商品名または管理番号にベース色が含まれればOK
          const bc = baseColor.toLowerCase();
          return invColor.toLowerCase().includes(bc) ||
            invTitle.toLowerCase().includes(bc) ||
            mnLower.includes(bc);
        }

        // 「&」区切りの複合カラー（例: "レッド&ブルー"）
        if (csvColor.includes("&")) {
          const csvColorParts = csvColor.split("&").map((p) => p.trim().toLowerCase()).filter(Boolean);
          // 管理番号がある場合: 管理番号にいずれかのキーワードが含まれるかチェック（優先）
          if (mnLower) {
            const mnMatches = csvColorParts.some((part) => mnLower.includes(part));
            if (mnMatches) return true;
          }
          // 商品名にいずれかのキーワードが含まれるか（フォールバック）
          return csvColorParts.some((part) =>
            invColor.toLowerCase().includes(part) || invTitle.toLowerCase().includes(part)
          );
        }

        // 「×」区切りの複合カラー（例: "ブラック×ターコイズ"）
        if (csvColor.includes("×")) {
          const csvColorParts = csvColor.split("×").map((p) => p.trim().toLowerCase()).filter(Boolean);
          // 管理番号がある場合: 管理番号に全キーワードが含まれるかチェック（優先）
          if (mnLower) {
            const mnMatches = csvColorParts.every((part) => mnLower.includes(part));
            if (mnMatches) return true;
          }
          // 商品名に全キーワードが含まれるか（フォールバック）
          return csvColorParts.every((part) =>
            invColor.toLowerCase().includes(part) || invTitle.toLowerCase().includes(part)
          );
        }

        // 単一カラー: 管理番号優先、次に商品名で照合
        const csvColorLower = csvColor.toLowerCase();
        if (mnLower && mnLower.includes(csvColorLower)) return true;
        return invColor.toLowerCase().includes(csvColorLower) || invTitle.toLowerCase().includes(csvColorLower);
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
      for (const delivery of deliveries) {
        if (delivery.status !== "success") continue;

        const key = extractKeyFromDeliveryNo(delivery.deliveryNo);
        if (!key) continue;
        const items = JSON.parse(delivery.itemsJson) as Array<{ inventoryId: number; title: string; quantity: number }>;
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

          const g = getOrCreate(key);
          g.deliveredCount += activeQuantity;
          const etc = inventoryEtcMap.get(item.inventoryId) ?? "";
          const rawMgmt = etc.split(",")[0]?.trim() ?? "";
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
          });
        }
      }

      const summaries = Array.from(groups.values()).map((g) => {
        const isAutoComplete = g.csvOrderQty > 0 && g.deliveredCount === g.csvOrderQty;
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
          if (priceAttr?.value) unitPrice = parseFloat(priceAttr.value) || null;
        }
        if (unitPrice == null && inv.unit_price != null) {
          unitPrice = parseFloat(String(inv.unit_price)) || null;
        }
        const category = inv.categories?.[0] ?? inv.category ?? "未分類";
        inventorySummary.push({ category, title: inv.title, quantity: qty, unitPrice, totalValue: unitPrice != null ? unitPrice * qty : null });
      }
      inventorySummary.sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

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
          const itemEtcMatch = itemEtcFirstPart.match(/^(\d+)/);
          const numMatch = purchaseNum.match(/^(\d+)/);
          const invoiceNo = itemEtcMatch ? itemEtcMatch[1] : (numMatch ? numMatch[1] : null);
          if (!invoiceNo) continue;
          const managementNo = itemEtcMatch ? itemEtcFirstPart : purchaseNum;
          let unitPrice: number | null = null;
          const upStr = pItem.unit_price != null ? String(pItem.unit_price) : "";
          if (upStr) unitPrice = parseFloat(upStr) || null;
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
        const invoiceMatch = firstPart.match(/^(\d+)/);
        if (!invoiceMatch) continue;
        const invoiceNo = invoiceMatch[1];
        // 対象インボイスNoに含まれる商品のみ表示
        if (!invoiceNoSet.has(invoiceNo)) continue;
        const qty = typeof inv.quantity === "number" ? inv.quantity : parseInt(String(inv.quantity), 10) || 0;
        if (qty <= 0) continue;
        let unitPrice: number | null = null;
        if (inv.optional_attributes) {
          const priceAttr = inv.optional_attributes.find((a: { name: string; value: string | null }) => a.name === "仕入単価");
          if (priceAttr?.value) unitPrice = parseFloat(priceAttr.value) || null;
        }
        if (unitPrice == null && inv.unit_price != null) unitPrice = parseFloat(String(inv.unit_price)) || null;
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
          const deliveryNoInvoiceMatch = dh.deliveryNo?.match(/^(\d+)/);
          const deliveryNoInvoice = deliveryNoInvoiceMatch ? deliveryNoInvoiceMatch[1] : null;
          for (const item of items) {
            const mgmtNo = item.etc ?? "";
            const firstPart = mgmtNo.split(",")[0]?.trim() ?? "";
            const invoiceMatch = firstPart.match(/^(\d+)/);
            // item.etcからマッチしない場合はdeliveryNoから抽出したinvoiceNoを使用
            const invoiceNo = invoiceMatch ? invoiceMatch[1] : (deliveryNoInvoice ?? null);
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
        const invoiceMatch = firstPart.match(/^(\d+)/);
        if (!invoiceMatch) continue;
        const invoiceNo = invoiceMatch[1];
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

    /** レポート一覧を取得する */
    list: publicProcedure.query(async () => {
      return getMonthlyReports(50);
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
        return getFedexShipmentsByDeliveryNo(input.deliveryNo);
      }),

    /**
     * 全FedEx発送記録を取得する
     */
    getAll: protectedProcedure.query(async () => {
      return getAllFedexShipments();
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
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        type MergeItem = ShipmentGasItem;
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        const secret = process.env.GAS_WEBHOOK_SECRET ?? "";
        const invoiceNo = invoiceNoFromDeliveryNo(input.deliveryNo);
        const gasItems = await alignShipmentItemsToOrderRows(invoiceNo, input.items);

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
        const allRecords = await getAllFedexShipments();
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
          const gasResult = await callGasWrite(mergedItems);
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
          operatorName: ctx.user.name ?? ctx.user.email ?? "unknown",
          historyId: input.historyId ?? null,
        });

        if (!gasUrl) {
          await updateFedexShipmentStatus(id, "error", "GAS_WEBHOOK_URL が未設定です");
          return { id, success: false, message: "GAS_WEBHOOK_URL が未設定です。管理者に連絡してください。" };
        }

        const gasResult = await callGasWrite(gasItems);
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
          const invoiceNoMatch = deliveryNoForGas.match(/^(\d+)/);
          const invoiceNo = invoiceNoMatch ? invoiceNoMatch[1] : deliveryNoForGas;
          const gasItems = await alignShipmentItemsToOrderRows(invoiceNo, input.items);
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
          })),
        })),
      }))
      .mutation(async ({ input, ctx }) => {
        type MergeItem = ShipmentGasItem;
        const results: Array<{ deliveryNo: string; sheetName: string; trackingNumber: string; id: number; success: boolean; message: string }> = [];
        const gasUrl = process.env.GAS_WEBHOOK_URL;
        const secret = process.env.GAS_WEBHOOK_SECRET ?? "";

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
        const allRecords = await getAllFedexShipments();

        for (const shipment of input.shipments) {
          const sheetName = shipment.sheetName ?? detectShipmentSheetName(shipment.deliveryNo);
          const invoiceNo = invoiceNoFromDeliveryNo(shipment.deliveryNo);
          const gasItems = await alignShipmentItemsToOrderRows(invoiceNo, shipment.items);
          // 同一追跡番号かつ同一出庫Noの既存記録を確認
          const sameTracking = allRecords.filter((r) =>
            r.trackingNumber === shipment.trackingNumber &&
            r.deliveryNo === shipment.deliveryNo &&
            (shipment.historyId ? r.historyId === shipment.historyId : !r.historyId)
          );

          if (sameTracking.length > 0) {
            // 自動合算
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
            await updateFedexShipment(keepId, { sheetName, shippingDate: input.shippingDate, itemsJson: JSON.stringify(mergedItems), spreadsheetStatus: "pending" });
            for (const rec of sameTracking.slice(1)) await deleteFedexShipment(rec.id);
            await updateFedexShipmentHistoryAndDeliveryNo(keepId, shipment.historyId ?? null, shipment.deliveryNo);
            const gasResult = await callGasBatchWrite(sheetName, shipment.deliveryNo, shipment.trackingNumber, mergedItems);
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
          const id = await createFedexShipment({
            deliveryNo: shipment.deliveryNo,
            sheetName,
            shippingDate: input.shippingDate,
            trackingNumber: shipment.trackingNumber,
            itemsJson: JSON.stringify(gasItems),
            spreadsheetStatus: "pending",
            operatorName: ctx.user.name ?? ctx.user.email ?? "unknown",
            historyId: shipment.historyId ?? null,
          });
          if (!gasUrl) {
            await updateFedexShipmentStatus(id, "error", "GAS_WEBHOOK_URL が未設定です");
            results.push({ deliveryNo: shipment.deliveryNo, sheetName, trackingNumber: shipment.trackingNumber, id, success: false, message: "GAS_WEBHOOK_URL が未設定です" });
            continue;
          }
          const gasResult = await callGasBatchWrite(sheetName, shipment.deliveryNo, shipment.trackingNumber, gasItems);
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
          const partnerLower = partner.toLowerCase();
          if (isLuca && !partnerLower.includes("ルカ") && !partnerLower.includes("luca")) continue;
          if (isSamee && !partnerLower.includes("サミ") && !partnerLower.includes("samm") && !partnerLower.includes("same")) continue;
          if (isDevon && !partnerLower.includes("デボン") && !partnerLower.includes("devon")) continue;
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
      }))
      .mutation(async ({ input, ctx }) => {
        const id = await createManualShipment({
          invoiceNo: input.invoiceNo,
          sheetName: input.sheetName,
          shippingDate: input.shippingDate,
          trackingNumber: input.trackingNumber,
          itemsJson: JSON.stringify(input.items),
          operatorName: (ctx as { user?: { name?: string } }).user?.name ?? null,
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
