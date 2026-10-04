import type { InventoryItem } from "./dataTypes";
import type { StockItemView } from "./viewTypes";
import { extractManagementNo as getInventoryManagementNo } from "@shared/ebayInventory";
import { toNumber } from "./format";
import { preferredManagementNo } from "./managementNumbers";
import { getInventoryCategory, displayStockCategory, stockModelName, STOCK_MODEL_ORDER } from "./productPresentation";
import { isInventoryPrintableLabel } from "./inventoryLabelViews";
import { labelStatusLabel } from "./labelStatus";
import { labelAllocationLabel } from "./labelTitles";

export function buildStockItemViewsFromInventories(inventories: InventoryItem[]): StockItemView[] {
  return inventories.flatMap((inventory) => {
    const stockQuantity = Math.max(0, Math.floor(toNumber(inventory.quantity)));
    if (stockQuantity <= 0) return [];

    const managementNo = getInventoryManagementNo(inventory.etc) || "-";
    const category = displayStockCategory(getInventoryCategory(inventory));
    const supplier = {
      name: inventory.supplierName?.trim() || "-",
      url: inventory.supplierUrl?.trim() || "",
    };
    const unitPrice = toNumber(inventory.purchase_unit_price ?? inventory.unit_price);
    const purchaseDate = inventory.last_purchase_date ?? inventory.updated_at ?? "";
    const labels = (inventory.itemLabels ?? [])
      .filter(isInventoryPrintableLabel)
      .slice(0, stockQuantity)
      .map((label) => {
        const legacyManagementNo = preferredManagementNo(managementNo, label.legacyManagementNo);
        return {
          key: `inventory-label-${inventory.id}-${label.id ?? label.labelId}`,
          labelId: label.labelId,
          inventoryId: inventory.id,
          status: labelStatusLabel(label.status || "stocked"),
          title: inventory.title,
          category,
          legacyManagementNo,
          assignedInvoiceNo: label.assignedInvoiceNo ?? null,
          allocationLabel: labelAllocationLabel(legacyManagementNo),
          unitPrice,
          quantity: 1,
          supplier,
          purchaseDate,
        };
      });

    const missingLabelQuantity = Math.max(0, stockQuantity - labels.length);
    if (missingLabelQuantity <= 0) return labels;

    return [
      ...labels,
      {
        key: `inventory-unlabeled-${inventory.id}`,
        inventoryId: inventory.id,
        labelId: null,
        status: "\u5728\u5eab",
        title: inventory.title,
        category,
        legacyManagementNo: managementNo,
        assignedInvoiceNo: null,
        allocationLabel: labelAllocationLabel(managementNo),
        unitPrice,
        quantity: missingLabelQuantity,
        supplier,
        purchaseDate,
      },
    ];
  });
}

export function buildStockItemGroups(items: StockItemView[]): { name: string; items: StockItemView[]; quantity: number }[] {
  const map = new Map<string, StockItemView[]>();
  for (const item of items) {
    const name = item.category || stockModelName(item.title);
    const current = map.get(name) ?? [];
    current.push(item);
    map.set(name, current);
  }
  return Array.from(map.entries())
    .map(([name, groupItems]) => ({
      name,
      items: groupItems.sort((a, b) => {
        const titleCompare = a.title.localeCompare(b.title, "ja", { numeric: true });
        if (titleCompare !== 0) return titleCompare;
        return a.legacyManagementNo.localeCompare(b.legacyManagementNo, "ja", { numeric: true });
      }),
      quantity: groupItems.reduce((total, item) => total + item.quantity, 0),
    }))
    .sort((a, b) => {
      const orderA = STOCK_MODEL_ORDER.indexOf(a.name);
      const orderB = STOCK_MODEL_ORDER.indexOf(b.name);
      const normalizedA = orderA === -1 ? STOCK_MODEL_ORDER.length : orderA;
      const normalizedB = orderB === -1 ? STOCK_MODEL_ORDER.length : orderB;
      if (normalizedA !== normalizedB) return normalizedA - normalizedB;
      return a.name.localeCompare(b.name, "ja", { numeric: true });
    });
}

export function stockItemStatusBadgeClass(item: StockItemView): string {
  switch (item.zeroStockStatus) {
    case "shipped":
      return "bg-slate-100 text-slate-700 hover:bg-slate-100";
    case "inspection_waiting":
      return "bg-blue-100 text-blue-700 hover:bg-blue-100";
    case "inbound_waiting":
      return "bg-amber-100 text-amber-800 hover:bg-amber-100";
    default:
      return item.inboundWaiting
        ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
        : "bg-emerald-100 text-emerald-700 hover:bg-emerald-100";
  }
}
