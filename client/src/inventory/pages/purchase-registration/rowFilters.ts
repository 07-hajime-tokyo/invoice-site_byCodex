import { isInboundCutoffVisible, isPurchaseInboundComplete } from "@shared/purchaseVisibility";
import type { PurchaseRow, PurchaseItem } from "./dataTypes";
import type { StatusFilter } from "./formTypes";
import { hasPurchaseTracking } from "./tracking";
import { purchaseRowStatusKind } from "./rowStatus";
import { sumQuantity, itemStockQuantity } from "./purchaseItems";

export type PurchaseRowCounts = {
  all: number;
  ordered: number;
  received: number;
  missingTracking: number;
  quantity: number;
};

export function matchesStatus(row: PurchaseRow, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "missing_tracking") return !hasPurchaseTracking(row);
  const kind = purchaseRowStatusKind(row);
  if (filter === "received") return kind === "received" || kind === "partial_shipped" || kind === "shipped";
  return kind === "ordered" || kind === "inbound_shipped";
}

export function countPurchaseRows(rows: PurchaseRow[]): PurchaseRowCounts {
  return rows.reduce(
    (acc, row) => {
      acc.all += 1;
      const statusKind = purchaseRowStatusKind(row);
      if (statusKind === "ordered" || statusKind === "inbound_shipped") acc.ordered += 1;
      else acc.received += 1;
      if (!hasPurchaseTracking(row)) acc.missingTracking += 1;
      acc.quantity += sumQuantity(row.purchase_items);
      return acc;
    },
    { all: 0, ordered: 0, received: 0, missingTracking: 0, quantity: 0 },
  );
}

export function visiblePurchaseItems(row: PurchaseRow): PurchaseItem[] {
  const kind = purchaseRowStatusKind(row);
  if (kind === "ordered" || kind === "inbound_shipped" || kind === "partial_shipped" || kind === "shipped") return row.purchase_items;
  return row.purchase_items.filter((item) => itemStockQuantity(item) > 0);
}

export function withVisiblePurchaseItems(row: PurchaseRow): PurchaseRow | null {
  const purchaseItems = visiblePurchaseItems(row);
  if (purchaseItems.length === 0) return null;
  return purchaseItems.length === row.purchase_items.length ? row : { ...row, purchase_items: purchaseItems };
}

export function normalizePurchaseRegistrationRows(rows: PurchaseRow[]): PurchaseRow[] {
  return rows.flatMap((row) => {
    if (row.status === "purchased") return [];
    if (!isInboundCutoffVisible(row)) return [];
    if (isPurchaseInboundComplete(row)) return [];
    const visibleRow = withVisiblePurchaseItems(row);
    return visibleRow ? [visibleRow] : [];
  });
}
