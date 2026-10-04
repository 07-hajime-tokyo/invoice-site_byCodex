import { eq } from "drizzle-orm";
import type { InsertLocalInventory, InsertLocalPurchase } from "../../drizzle/schema";
import { normalizeEbayOrderStatus } from "@shared/ebayInventory";
import {
  createInventoryMemo,
  getDb,
  getInventoryItemLabelsByInventoryIds,
  getInventoryMemos,
  getLocalInventories,
  getLocalInventoryById,
  getLocalInventoryByZaicoId,
  getLocalPurchases,
  insertLocalPurchase,
  updateLocalInventory,
  updateLocalPurchase,
  upsertLocalInventory,
} from "./db";
import { getInventoryManagementNo } from "./managementNo";
import { type LocalPurchaseRow } from "./purchaseRowTypes";
import { localPurchasePrimaryManagementNo, parseLocalPurchaseItems } from "./purchases/legacyValues";
import type { PurchaseSnapshotInput } from "./purchases/snapshotContract";
import { normalizeRestoreSearchText } from "./restoreFields";

type LocalInventoryRow = Awaited<ReturnType<typeof getLocalInventories>>[number];
type LocalInventoryItemLabelRow = NonNullable<LocalInventoryRow["itemLabels"]>[number];
type LocalPurchaseItemLabelRow = NonNullable<LocalPurchaseRow["itemLabels"]>[number];
type InventoryMemoRow = Awaited<ReturnType<typeof getInventoryMemos>>[number];

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
export type FullRestoreSnapshot = {
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

export function parseFullRestoreSnapshotMemo(memo: string | null | undefined): FullRestoreSnapshot | null {
  const text = String(memo ?? "");
  if (!text.startsWith(FULL_RESTORE_SNAPSHOT_MARKER)) return null;
  try {
    const parsed = JSON.parse(text.slice(FULL_RESTORE_SNAPSHOT_MARKER.length)) as FullRestoreSnapshot;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function fullRestoreSnapshotHaystack(memo: InventoryMemoRow, snapshot: FullRestoreSnapshot): string {
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

export async function getRelatedLocalPurchasesForFullRestore(inventory: { id: number; etc?: string | null }): Promise<LocalPurchaseRow[]> {
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

export function uniqueFullRestoreLabels(snapshot: FullRestoreSnapshot): FullRestoreLabelSnapshot[] {
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

export async function recordFullRestoreSnapshot(input: PurchaseSnapshotInput) {
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

export async function restoreInventoryFromFullSnapshot(snapshot: FullRestoreInventorySnapshot | null): Promise<number | null> {
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

export async function restorePurchasesFromFullSnapshot(
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

export async function restoreLabelsFromFullSnapshot(
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
