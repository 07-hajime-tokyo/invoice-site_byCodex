import type { InventoryItem, PurchaseItem, PurchaseRow } from "./dataTypes";
import type { StockItemView, ZeroStockPurchaseStatus } from "./viewTypes";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { getSupplier } from "./supplier";
import { purchaseRowStatusKind, normalizedLabelStatus } from "./rowStatus";
import { itemStockQuantity, itemQuantity, getItemLabels } from "./purchaseItems";
import { getManagementNos } from "./managementNumbers";
import { getInventoryCategory, displayStockCategory } from "./productPresentation";
import { labelAllocationLabel } from "./labelTitles";
import { toNumber } from "./format";
import { isStockProposalAccessory } from "./stockProposalRules";

export function isInventoryDeleted(inventory: InventoryItem | null | undefined): boolean {
  return inventory?.isDeleted === true || Number(inventory?.isDeleted ?? 0) === 1;
}

export function buildActiveInventoryMap(inventories: InventoryItem[]): Map<number, InventoryItem> {
  return new Map(
    inventories
      .filter((inventory) => !isInventoryDeleted(inventory))
      .map((inventory) => [inventory.id, inventory]),
  );
}

export function zeroStockPurchaseStatusForItem(
  row: PurchaseRow,
  item: PurchaseItem,
): { kind: ZeroStockPurchaseStatus; label: string; inboundWaiting: boolean } | null {
  const itemStatus = normalizedLabelStatus(item.status);
  const labels = getItemLabels([item]);
  const labelStatuses = labels.map((label) => normalizedLabelStatus(label.status));

  if ((labelStatuses.length > 0 && labelStatuses.every((status) => status === "shipped")) || itemStatus === "shipped") {
    return { kind: "shipped", label: "出庫済み", inboundWaiting: false };
  }

  if (
    itemStatus === "returned" ||
    itemStatus === "cancelled" ||
    labelStatuses.some((status) => status === "returned" || status === "cancelled")
  ) {
    return null;
  }

  if (labelStatuses.some((status) => status === "received") || itemStatus === "received") {
    return { kind: "inspection_waiting", label: "動作確認待ち", inboundWaiting: false };
  }

  if (labelStatuses.some((status) => status === "stocked") || itemStatus === "stocked") {
    return null;
  }

  const rowStatus = purchaseRowStatusKind({ ...row, purchase_items: [item] });
  if (rowStatus === "ordered" || rowStatus === "inbound_shipped" || itemStatus === "ordered") {
    return { kind: "inbound_waiting", label: "入庫待ち", inboundWaiting: true };
  }

  return null;
}

// The existing title resolver stays in the screen; construction does not call it.
export function createZeroStockPurchaseItemsFilter(actualProductTitle: (item: PurchaseItem) => string) {
  function zeroStockPurchaseItems(row: PurchaseRow, inventories?: InventoryItem[]): PurchaseItem[] {
    const activeInventoryById = inventories ? buildActiveInventoryMap(inventories) : null;
    return row.purchase_items.filter((item) => {
      const inventoryId = Number(item.inventory_id);
      if (!Number.isFinite(inventoryId) || inventoryId <= 0) return false;
      if (activeInventoryById && !activeInventoryById.has(inventoryId)) return false;
      const orderedQuantity = Math.max(0, Math.floor(itemQuantity(item)));
      if (orderedQuantity <= 0 || itemStockQuantity(item) > 0) return false;
      const title = actualProductTitle(item);
      if (isStockProposalAccessory(title, item.category)) return false;
      return zeroStockPurchaseStatusForItem(row, item) != null;
    });
  }

  return zeroStockPurchaseItems;
}

export function createZeroStockPurchaseBuilder(actualProductTitle: (item: PurchaseItem) => string) {
  function buildZeroStockPurchaseItemViewsFromRows(rows: PurchaseRow[], inventories: InventoryItem[]): StockItemView[] {
    const activeInventoryById = buildActiveInventoryMap(inventories);
    return rows.flatMap((row) => {
      const supplier = getSupplier(row);
      return row.purchase_items.flatMap((item) => {
        const inventoryId = Number(item.inventory_id);
        if (!Number.isFinite(inventoryId) || inventoryId <= 0) return [];
        const inventory = activeInventoryById.get(inventoryId);
        if (!inventory) return [];
        if (itemStockQuantity(item) > 0) return [];

        const quantity = Math.max(0, Math.floor(itemQuantity(item)));
        if (quantity <= 0) return [];

        const title = actualProductTitle(item);
        if (isStockProposalAccessory(title, item.category)) return [];

        const zeroStockStatus = zeroStockPurchaseStatusForItem(row, item);
        if (!zeroStockStatus) return [];

        const rowManagementNos = getManagementNos(row.purchase_items);
        const managementNo = parseEtc(item.etc).managementNo || getManagementNos([item])[0] || rowManagementNos[0] || "-";
        const firstLabel = getItemLabels([item])[0] ?? null;
        const labelId = firstLabel?.labelId?.trim() || null;
        return [
          {
            key: `zero-stock-purchase-${row.id}-${item.id}-${inventoryId}`,
            inventoryId,
            labelId,
            status: zeroStockStatus.label,
            title,
            category: displayStockCategory(item.category || getInventoryCategory(inventory)),
            legacyManagementNo: managementNo,
            assignedInvoiceNo: firstLabel?.assignedInvoiceNo ?? null,
            allocationLabel: labelAllocationLabel(managementNo),
            unitPrice: toNumber(item.unit_price),
            quantity,
            supplier,
            purchaseDate: row.purchase_date ?? item.purchase_date ?? item.estimated_purchase_date ?? "",
            inboundWaiting: zeroStockStatus.inboundWaiting,
            zeroStockPurchase: true,
            zeroStockStatus: zeroStockStatus.kind,
          },
        ];
      });
    });
  }

  return buildZeroStockPurchaseItemViewsFromRows;
}
