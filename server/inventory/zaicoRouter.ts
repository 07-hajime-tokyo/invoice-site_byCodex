import { parseMoneyNumber } from "./inventoryMoney";
import { getOrderRowsFromTradeRecords } from "./orderTradeRows";
import { invoiceNoPrefixFromDeliveryNo } from "./deliveryInvoiceAttribution";
import { type LocalPurchaseRow } from "./purchaseRowTypes";
import { createStepTimer } from "./stepTimer";
import { suggestCsvProductNameFromHints } from "./orderProductMatching";
import { parseCSVLine } from "./csvLine";
import { inventoryInitialLabelStatus, inventoryLabelQuantity, inventoryStockQuantity } from "./labelQuantity";
import { getRelatedLocalPurchasesForFullRestore, recordFullRestoreSnapshot } from "./fullRestoreSnapshot";
import { createOrderedPurchaseProcedure } from "./createOrderedPurchase";
import { normalizeCategoryName } from "./categoryName";
import { purchaseEditInputSchema, purchaseSupplierInputSchema } from "./purchases/saveInput";
import { savePurchaseEdit } from "./purchases/saveEdit";
import { savePurchaseSupplier } from "./purchases/saveSupplier";
import { resolveWorkOperatorName, resolveOperatorToken } from "./workOperator";
import { localPurchaseMatchesInventoryLabel } from "./purchases/labelMatching";
import { restoreMissingLocalPurchasesFromOrphanLabels } from "./purchases/orphanRecovery";
import { ensureShaftPurchases } from "./purchases/shaftBackfill";
import { getInventoryManagementNo } from "./managementNo";
import { getDirectPartnerNames, resolveInboundInfoMap } from "./purchases/inboundClassification";
import { reconcileLocalPurchaseLabelQuantities } from "./purchases/reconcileLabels";
import { toInventoryItemLabelView, type InventoryItemLabelView } from "./labelViews";
import { getPurchaseItemManagementNo, localPurchaseItems } from "./purchases/items";
import { labelsForPurchaseItem } from "./purchases/labels";
import { getLocalPurchaseDisplayStatus } from "./purchases/displayStatus";
import { createExternalPurchaseMaps, buildExternalPurchasePageRows, buildExternalPurchaseAllRows } from "./purchases/externalRows";
import { fillCsvPurchaseSuppliers } from "./purchases/csvSuppliers";
import { loadLocalPurchaseListData, refreshPurchaseInventoryMap } from "./purchases/localData";
import { buildLocalPurchaseRow, createPurchaseInventoryMap, attachPurchaseInventoryInfo } from "./purchases/localRows";
import { purchasePageInputSchema } from "./purchases/input";
import { buildPurchasePageResponse } from "./purchases/page";
import { z } from "zod";
import { getEbayStockType, isEbayManagementNo, normalizeEbayOrderStatus } from "@shared/ebayInventory";
import { extractManagementHints } from "@shared/productMatching";
import { nextStage, isRegisterStage, DIRECT_PARTNER_NAMES_SETTING_KEY, type InboundClass } from "@shared/inboundPipeline";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { shipmentSheetNameSchema, sumWorkQuantity } from "./fedexRouter";
import { processInventoryDelivery } from "./deliveryService";
import { recordWorkLog } from "./workLogs";
import { diffInventoryFields, recordInventoryChange } from "./changeLog";
import {
  testConnection,
  getPurchases,
  getAllPurchases,
  completePurchase,
  getInventories,
  getInventory,
  deleteInventory,
  createDelivery,
  getLatestPurchaseDateMap,
  createInventory,
  updateInventory,
  deletePurchase,
  updatePurchase,
} from "./zaico";
import {
  createPurchaseHistory,
  getLatestPurchaseDateMapFromDB,
  getAllPurchaseExtras,
  createDeletedInventory,
  upsertInventoryExtra,
  getAllInventoryExtras,
  deleteInventoryExtra,
  upsertLocalInventory,
  getLocalInventories,
  getLocalInventoryById,
  getLocalInventoryByZaicoIdOrId,
  updateLocalInventory,
  deleteLocalInventory,
  getLocalPurchases,
  updateLocalPurchaseStatus,
  ensureInventoryItemLabels,
  ensureInventoryItemLabelsForInventory,
  getInventoryItemLabelsByInventoryIds,
  setLocalPurchaseInboundClass,
  updateLocalPurchaseStage,
  insertLocalPurchase,
  getSystemSetting,
  setSystemSetting,
  isZaicoEnabled,
  getShaftSales,
  upsertShaftSale,
  updateShaftSaleDate,
  updateShaftSaleProfit,
  getLatestIncreaseMemosMap,
  createFedexShipment,
  updateFedexShipmentStatus,
  getTrackingNumbersByInventoryIds,
  getInventoryExtraByZaicoId,
  getDb,
  getAllDeliveryHistories,
} from "./db";
import {
  attachDeliveryHistoryRefsToLabelMap,
  attachDeliveryHistoryRefsToLabels,
  liveDeliveryHistoryLabelIdMap,
} from "./deliveryHistoryLabelRefs";
import { protectedProcedure, router } from "../_core/trpc";

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

const publicProcedure = protectedProcedure;

type InventoryItemLabelForEnsure = InventoryItemLabelView & {
  title?: string | null;
};

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

export const zaicoRouter = router({
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
            assignedInvoiceNo: label.assignedInvoiceNo ?? null,
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
          let inventoryLabelMap = await t.step("getInventoryItemLabelsByInventoryIds", () =>
            getInventoryItemLabelsByInventoryIds(invIds)
          );
          const deliveryHistoryByLabelId = await t.step("deliveryHistoryLabelMap", async () =>
            liveDeliveryHistoryLabelIdMap(await getAllDeliveryHistories())
          );
          localPurchaseRows = localPurchaseRows.map((row) => ({
            ...row,
            itemLabels: attachDeliveryHistoryRefsToLabels(row.itemLabels, deliveryHistoryByLabelId),
          }));
          inventoryLabelMap = attachDeliveryHistoryRefsToLabelMap(inventoryLabelMap, deliveryHistoryByLabelId);
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
        const zaicoDeliveryHistoryByLabelId = liveDeliveryHistoryLabelIdMap(await getAllDeliveryHistories());
        const inventoriesWithLabels = (await ensureStockLabelsForInventories(inventories)).map((inventory) => ({
          ...inventory,
          itemLabels: attachDeliveryHistoryRefsToLabels(inventory.itemLabels, zaicoDeliveryHistoryByLabelId),
        }));
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
        let inventoryLabelMap = await t.step("getInventoryItemLabelsByInventoryIds", () =>
          getInventoryItemLabelsByInventoryIds(invIds)
        );
        const deliveryHistoryByLabelId = await t.step("deliveryHistoryLabelMap", async () =>
          liveDeliveryHistoryLabelIdMap(await getAllDeliveryHistories())
        );
        localPurchaseRows = localPurchaseRows.map((row) => ({
          ...row,
          itemLabels: attachDeliveryHistoryRefsToLabels(row.itemLabels, deliveryHistoryByLabelId),
        }));
        inventoryLabelMap = attachDeliveryHistoryRefsToLabelMap(inventoryLabelMap, deliveryHistoryByLabelId);
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
});
