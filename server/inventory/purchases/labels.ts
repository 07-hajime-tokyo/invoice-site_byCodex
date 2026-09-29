import {
  uniqueInventoryItemLabelViews,
  type InventoryItemLabelView,
} from "../labelViews";
import {
  getPurchaseItemManagementNo,
  localPurchaseItems,
  type PurchaseItemSource,
} from "./items";

export type PurchaseLabelSource = PurchaseItemSource & {
  itemLabels?: InventoryItemLabelView[];
};

export function getPurchaseItemLabels(
  row: PurchaseLabelSource
): InventoryItemLabelView[] {
  const labels = (row as { itemLabels?: InventoryItemLabelView[] }).itemLabels;
  return Array.isArray(labels) ? labels : [];
}

export function filterLabelsByManagementNo<
  T extends { legacyManagementNo?: string | null },
>(labels: T[], managementNo: string): T[] {
  const normalized = managementNo.trim();
  if (!normalized) return labels;
  return labels.filter(label => {
    const labelManagementNo = String(label.legacyManagementNo ?? "").trim();
    return !labelManagementNo || labelManagementNo === normalized;
  });
}

export function labelsForPurchaseItem(
  row: PurchaseLabelSource,
  item: Record<string, unknown>,
  inventoryLabelMap?: Map<number, InventoryItemLabelView[]>
): InventoryItemLabelView[] {
  const labels = getPurchaseItemLabels(row);
  const rawInventoryId =
    item.inventory_id ?? item.inventoryId ?? row.localInventoryId;
  const inventoryId = Number(rawInventoryId);
  const managementNo = getPurchaseItemManagementNo(row, item);
  const inventoryLabels = Number.isFinite(inventoryId)
    ? filterLabelsByManagementNo(
        inventoryLabelMap?.get(inventoryId) ?? [],
        managementNo
      )
    : [];
  const scopedLabels = filterLabelsByManagementNo(labels, managementNo);
  if (scopedLabels.length === 0)
    return uniqueInventoryItemLabelViews(inventoryLabels);
  if (Number.isFinite(inventoryId)) {
    const labelsByInventory = scopedLabels.filter(
      label => Number(label.localInventoryId) === inventoryId
    );
    if (labelsByInventory.length > 0)
      return uniqueInventoryItemLabelViews([
        ...labelsByInventory,
        ...inventoryLabels,
      ]);
  }
  return uniqueInventoryItemLabelViews([...scopedLabels, ...inventoryLabels]);
}

export function localPurchaseLabelViews(
  row: PurchaseLabelSource,
  inventoryLabelMap?: Map<number, InventoryItemLabelView[]>
): InventoryItemLabelView[] {
  return uniqueInventoryItemLabelViews(
    localPurchaseItems(row).flatMap(item =>
      labelsForPurchaseItem(row, item, inventoryLabelMap)
    )
  );
}
