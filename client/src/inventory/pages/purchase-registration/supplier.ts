import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import type { PurchaseRow } from "./dataTypes";
import type { SupplierView } from "./viewTypes";

export function getSupplier(row: PurchaseRow): SupplierView {
  const firstItem = row.purchase_items[0];
  const parsed = parseEtc(firstItem?.etc);
  return {
    name: row.csvSupplierName?.trim() || parsed.supplierSite || "-",
    url: row.csvSupplierUrl?.trim() || "",
  };
}
