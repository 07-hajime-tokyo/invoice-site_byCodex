// Label-level outbound state takes precedence over the purchase header here.
// This is intentionally different from the inbound purchases list status.
import type { PurchaseRow } from "./dataTypes";
import { normalizedZeroStockStatus } from "../purchaseRegistrationZeroStock";
import { getItemLabels } from "./purchaseItems";
import { hasPurchaseTracking } from "./tracking";

export type PurchaseRowStatusKind = "ordered" | "inbound_shipped" | "received" | "partial_shipped" | "shipped";

export function isReceived(row: PurchaseRow): boolean {
  return row.status === "purchased" || row.purchase_items.some((item) => item.status === "purchased");
}

export function normalizedLabelStatus(status?: string | null): string {
  return normalizedZeroStockStatus(status);
}

export function purchaseRowStatusKind(row: PurchaseRow): PurchaseRowStatusKind {
  const labels = getItemLabels(row.purchase_items);
  if (labels.length > 0) {
    const statuses = labels.map((label) => normalizedLabelStatus(label.status));
    const shippedCount = statuses.filter((status) => status === "shipped").length;
    if (shippedCount === labels.length) return "shipped";
    if (shippedCount > 0) return "partial_shipped";
    if (statuses.some((status) => status === "received" || status === "stocked")) return "received";
  }
  if (isReceived(row)) return "received";
  if (row.status === "shipped" || hasPurchaseTracking(row)) return "inbound_shipped";
  return "ordered";
}

export function statusLabel(row: PurchaseRow): string {
  switch (purchaseRowStatusKind(row)) {
    case "inbound_shipped":
      return "発送済み / 入庫待ち";
    case "shipped":
      return "出庫済み";
    case "partial_shipped":
      return "一部出庫済み";
    case "received":
      return "入庫済み";
    case "ordered":
    default:
      return "発注済み";
  }
}

export function statusClass(row: PurchaseRow): string {
  switch (purchaseRowStatusKind(row)) {
    case "inbound_shipped":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "shipped":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "partial_shipped":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "received":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "ordered":
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}
