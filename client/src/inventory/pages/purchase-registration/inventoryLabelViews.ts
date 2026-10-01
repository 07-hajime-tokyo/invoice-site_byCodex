import type { InventoryItemLabel, InventoryItem } from "./dataTypes";
import type { LabelView } from "./viewTypes";
import { extractManagementNo as getInventoryManagementNo } from "@shared/ebayInventory";
import { toNumber } from "./format";
import { preferredManagementNo } from "./managementNumbers";
import { labelStatusLabel } from "./labelStatus";
import { formatLabelPrintTitle } from "./labelTitles";
import { getInventoryCategory, displayStockCategory } from "./productPresentation";

export function isInventoryPrintableLabel(label: InventoryItemLabel): boolean {
  if (!label.labelId?.trim()) return false;
  const status = (label.status ?? "").trim().toLowerCase();
  return !status || status === "stocked" || status === "received";
}

export function buildInventoryLabelViews(inventories: InventoryItem[]): LabelView[] {
  return inventories.flatMap((inventory) => {
    const stockQuantity = Math.max(0, Math.floor(toNumber(inventory.quantity)));
    if (stockQuantity <= 0) return [];
    const title = inventory.title;
    const managementNo = getInventoryManagementNo(inventory.etc) || "-";
    const supplier = {
      name: inventory.supplierName?.trim() || "-",
      url: inventory.supplierUrl?.trim() || "",
    };
    return (inventory.itemLabels ?? [])
      .filter(isInventoryPrintableLabel)
      .slice(0, stockQuantity)
      .map((label) => {
        const legacyManagementNo = preferredManagementNo(managementNo, label.legacyManagementNo);
        return {
          key: `inventory-${inventory.id}-${label.id ?? label.labelId}`,
          labelId: label.labelId,
          rawStatus: label.status || "stocked",
          status: labelStatusLabel(label.status || "stocked"),
          title,
          printTitle: formatLabelPrintTitle(title),
          category: displayStockCategory(getInventoryCategory(inventory)),
          legacyManagementNo,
          assignedInvoiceNo: label.assignedInvoiceNo ?? null,
          allocationLabel: "",
          unitPrice: toNumber(inventory.purchase_unit_price ?? inventory.unit_price),
          supplier,
          purchaseDate: inventory.last_purchase_date ?? inventory.updated_at ?? "",
          rowId: -inventory.id,
          itemId: -inventory.id,
          inventoryId: inventory.id,
          trackingNumber: null,
          carrier: null,
        };
      });
  });
}
