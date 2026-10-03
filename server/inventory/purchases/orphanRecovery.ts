import { getDb } from "../../db";
import {
  getLocalInventories,
  getLocalPurchases,
  insertLocalPurchase,
  ensureInventoryItemLabels,
  type InventoryItemLabelStatus,
  type LocalPurchaseWithLabels as LocalPurchaseRow,
  type LocalInventoryWithLabels as LocalInventoryRow,
} from "../db";
import { getInventoryManagementNo } from "../managementNo";
import { isReceivedLabelStatus } from "../labelViews";
import { localPurchaseItems, getPurchaseItemManagementNo } from "./items";
import { historyDateFrom } from "./legacyValues";
import {
  canRecoverOrphanLabelPurchase,
  getRecoveredPurchaseOverrides,
} from "./recoveryRules";
import {
  cleanupUnexpectedRepairedLocalPurchases,
  cleanupAllowedRecoveredPurchaseIssues,
} from "./recoveryCleanup";
type LocalInventoryItemLabelRow = NonNullable<
  LocalInventoryRow["itemLabels"]
>[number];

export function localPurchaseStatusFromLabelStatus(status: unknown): string {
  return isReceivedLabelStatus(status) ? "purchased" : "ordered";
}

export async function restoreMissingLocalPurchasesFromOrphanLabels(
  localPurchaseRows: LocalPurchaseRow[],
  preloadedInventories?: LocalInventoryRow[]
): Promise<LocalPurchaseRow[]> {
  const db = await getDb();
  if (!db) return localPurchaseRows;
  localPurchaseRows =
    await cleanupUnexpectedRepairedLocalPurchases(localPurchaseRows);
  localPurchaseRows =
    await cleanupAllowedRecoveredPurchaseIssues(localPurchaseRows);

  const existingIds = new Set(localPurchaseRows.map(purchase => purchase.id));
  const existingManagementNos = new Set<string>();
  for (const purchase of localPurchaseRows) {
    const rowManagementNo = String(purchase.managementNo ?? "").trim();
    if (rowManagementNo) existingManagementNos.add(rowManagementNo);
    for (const item of localPurchaseItems(purchase)) {
      const itemManagementNo = getPurchaseItemManagementNo(purchase, item);
      if (itemManagementNo) existingManagementNos.add(itemManagementNo);
    }
  }

  const inventories = preloadedInventories ?? (await getLocalInventories());
  const candidates = new Map<
    string,
    {
      inventory: LocalInventoryRow;
      labels: LocalInventoryItemLabelRow[];
    }
  >();

  for (const inventory of inventories) {
    if (Number(inventory.isDeleted ?? 0) !== 0) continue;
    for (const label of inventory.itemLabels ?? []) {
      const labelPurchaseId = Number(label.purchaseId);
      const managementNo = String(
        label.legacyManagementNo ?? getInventoryManagementNo(inventory.etc)
      ).trim();
      const canRecover = canRecoverOrphanLabelPurchase(managementNo);
      if (
        !canRecover &&
        (!Number.isFinite(labelPurchaseId) || labelPurchaseId <= 0)
      )
        continue;
      if (
        Number.isFinite(labelPurchaseId) &&
        labelPurchaseId > 0 &&
        existingIds.has(labelPurchaseId)
      )
        continue;
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
    const quantity = Math.max(
      1,
      Number(overrides.quantity ?? labels.length) || 1
    );
    const title = overrides.title ?? firstLabel.title ?? inventory.title;
    const category = overrides.category ?? inventory.category ?? null;
    const unitPrice =
      overrides.unitPrice ??
      (inventory.unitPrice == null ? null : String(inventory.unitPrice));
    const purchaseDate =
      overrides.purchaseDate ??
      historyDateFrom(firstLabel.createdAt ?? inventory.createdAt);
    const status = String(
      overrides.status ?? localPurchaseStatusFromLabelStatus(firstLabel.status)
    );
    const receivedDate =
      "receivedDate" in overrides
        ? (overrides.receivedDate ?? null)
        : status === "purchased"
          ? historyDateFrom(firstLabel.receivedAt ?? inventory.updatedAt)
          : null;
    const newPurchaseId = await insertLocalPurchase({
      zaicoId: null,
      purchaseNum: overrides.purchaseNum ?? managementNo,
      status,
      itemsJson: JSON.stringify([
        {
          id: 1,
          inventory_id: inventory.id,
          inventoryId: inventory.id,
          title,
          quantity: String(quantity),
          unit_price: unitPrice,
          unitPrice,
          etc: managementNo,
          category,
        },
      ]),
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
      stage:
        overrides.stage ?? (status === "purchased" ? "received" : "ordered"),
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
        status: (overrides.labelStatus ??
          String(firstLabel.status ?? "ordered")) as InventoryItemLabelStatus,
        sourceKey: `repair:${managementNo}`,
      });
      existingManagementNos.add(managementNo);
      repaired = true;
    }
  }

  if (!repaired) return localPurchaseRows;
  return cleanupAllowedRecoveredPurchaseIssues(await getLocalPurchases());
}
