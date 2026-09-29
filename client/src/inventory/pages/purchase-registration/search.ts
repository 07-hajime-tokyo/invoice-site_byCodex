import { getItemLabels } from "./purchaseItems";
import { getManagementNos } from "./managementNumbers";
import { getSupplier } from "./supplier";
import type { PurchaseRow } from "./dataTypes";
import type { StockItemView } from "./viewTypes";

// Field coverage and width handling differ between purchase and stock search.

export function buildSearchText(row: PurchaseRow): string {
  const labels = getItemLabels(row.purchase_items).map((label) => label.labelId);
  const managementNos = getManagementNos(row.purchase_items);
  const supplier = getSupplier(row);
  return [
    row.num ?? "",
    supplier.name,
    supplier.url,
    ...labels,
    ...managementNos,
    ...row.purchase_items.flatMap((item) => [item.title, item.category ?? "", item.etc ?? ""]),
  ]
    .join("\n")
    .toLowerCase();
}

export function buildStockSearchText(item: StockItemView): string {
  return [
    item.labelId ?? "",
    item.title,
    item.category,
    item.legacyManagementNo,
    item.allocationLabel,
    item.supplier.name,
    item.status,
  ]
    .join("\n")
    .toLowerCase();
}
