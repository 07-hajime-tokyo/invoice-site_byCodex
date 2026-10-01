import { monthlyReportRouter, snapshotRouter } from "./monthlyReportRouter";

import { orderManagementRouter } from "./orderManagementRouter";
import { deletedItemsRouter } from "./deletedItemsRouter";
import { restoreManagementRouter } from "./restoreManagementRouter";
import { deliveryHistoryRouter } from "./deliveryHistoryRouter";
import { zaicoRouter } from "./zaicoRouter";
import { purchaseHistoryRouter } from "./purchaseHistoryRouter";
import { receiptAckRouter } from "./receiptAckRouter";
import { migrationRouter } from "./migrationRouter";
import { partnerRouter } from "./partnerRouter";
import { invoiceMemoRouter } from "./invoiceMemoRouter";
import { inventoryMemoRouter } from "./inventoryMemoRouter";
import { authRouter } from "./authRouter";
import { purchaseExtraRouter } from "./purchaseExtraRouter";
import { invoiceManualItemRouter } from "./invoiceManualItemRouter";
import { domesticProductRouter } from "./domesticProductRouter";
import { monthlyDomesticItemRouter } from "./monthlyDomesticItemRouter";
import { customerRouter } from "./customerRouter";
import { accessCodeRouter } from "./accessCodeRouter";
import { adminRouter } from "./adminRouter";
import { inventoryInitialLabelStatus, inventoryLabelQuantity } from "./labelQuantity";
import { type InventoryRestoreField, parseInventoryRestoreMemo } from "./restoreFields";
import { localPurchasePrimaryManagementNo } from "./purchases/legacyValues";
import { getInventoryManagementNo } from "./managementNo";
import { isReceivedLabelStatus } from "./labelViews";
import { filterLabelsByManagementNo } from "./purchases/labels";
import { google } from "googleapis";
import { normalizeEbayOrderStatus } from "@shared/ebayInventory";
import { extractColor, extractModel, extractPreferredModel, inventoryItemCanMatchCsvProduct, isRandomColor, normalizeLooseText, productNamesCanMatch, suggestCsvProduct } from "@shared/productMatching";
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
  isInboundClass,
  getStagesForClass,
  INBOUND_CLASS_ORDER,
} from "@shared/inboundPipeline";
import { eq } from "drizzle-orm";
import type { InsertLocalInventory, InsertLocalPurchase } from "../../drizzle/schema";
import { systemRouter } from "../_core/systemRouter";
import { protectedProcedure, router } from "../_core/trpc";
import { aiInvestigationRouter } from "./aiInvestigation";
import { actionItemsRouter } from "./actionItems";
import { inboundDeskRouter } from "./inboundDesk";
import { outboundBoxesRouter } from "./outboundBoxes";
import { fedexRouter } from "./fedexRouter";
import { workLogsRouter } from "./workLogs";
import { recordInventoryChange } from "./changeLog";
import {
  revertPurchase,
} from "./zaico";
import {
  upsertPurchaseExtra,
  getInventoryMemos,
  getLocalInventories,
  updateLocalInventory,
  deleteLocalInventory,
  updateLocalPurchase,
  getLocalPurchases,
  ensureInventoryItemLabels,
  ensureInventoryItemLabelsForInventory,
  getLocalPurchaseById,
  insertLocalPurchase,
  getSystemSetting,
  setSystemSetting,
  getDeletedInventoryIdsFromDeliveryHistories,
  getUnitPricesByInventoryIds,
  getLocalPurchaseUnitPriceMap,
  getLocalInventoryUnitPriceByZaicoIds,
  getLocalInventoryInfoByZaicoIds,
  getDeletedInventoryUnitPriceByZaicoIds,
  getDb,
  type InventoryItemLabelStatus,
} from "./db";

const publicProcedure = protectedProcedure;

type LocalInventoryRow = Awaited<ReturnType<typeof getLocalInventories>>[number];
type InventoryMemoRow = Awaited<ReturnType<typeof getInventoryMemos>>[number];


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


export const inventoryRouter = router({
  system: systemRouter,
  actionItems: actionItemsRouter,
  inboundDesk: inboundDeskRouter,
  outboundBoxes: outboundBoxesRouter,
  aiInvestigation: aiInvestigationRouter,
  workLogs: workLogsRouter,
  auth: authRouter,

  // ============================================================
  // Zaico API 連携
  // ============================================================
  zaico: zaicoRouter,

  // ============================================================
  // 入庫履歴
  // ============================================================
  purchaseHistory: purchaseHistoryRouter,

  // ============================================================
  // 受取連絡チェック
  // ============================================================
  receiptAck: receiptAckRouter,

  // ============================================================
  // 入庫補足情報（発送日・追跡番号）
  // ============================================================
  purchaseExtra: purchaseExtraRouter,
  // ============================================================
  // 出庫履歴
  // ============================================================
  deliveryHistory: deliveryHistoryRouter,

  // ============================================================
  // 発注管理（管理番号キーで発注済み・出庫済み・在庫数を集計）
  // ============================================================
  orderManagement: orderManagementRouter,
  // 削除済み商品管理
  deletedItems: deletedItemsRouter,

  // 復元管理
  restoreManagement: restoreManagementRouter,

  // ============================================================
  // Zaico移行・連携設定
  // ============================================================
  migration: migrationRouter,

  // ============================================================
  // 在庫メモ（inventory_memos）
  // ============================================================
  inventoryMemo: inventoryMemoRouter,

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
  invoiceManualItem: invoiceManualItemRouter,

  // ============================================================
  // 国内卸商品マスタ (domestic_products)
  // ============================================================
  domesticProduct: domesticProductRouter,

  // ============================================================
  // 月次棚卸し 国内卸発注行 (monthly_domestic_items)
  // ============================================================
  monthlyDomesticItem: monthlyDomesticItemRouter,

  invoiceMemo: invoiceMemoRouter,

  // ============================================================
  // 取引先マスタ
  // ============================================================
  customer: customerRouter,

  // ============================================================
  // 招待コード管理
  // ============================================================
  accessCode: accessCodeRouter,

  // ============================================================
  // FedEx発送管理
  // ============================================================
  fedex: fedexRouter,
  // 管理者メール確認
  // ============================================================
  admin: adminRouter,

  // ============================================================
  // 取引先ポータル
  // ============================================================
  partner: partnerRouter,
});
export type InventoryRouter = typeof inventoryRouter;
