// Sorting prefers creation time; the shared visibility cutoff prefers purchase date.
import type { PurchaseRow } from "./dataTypes";

export function purchaseRegistrationOrderValue(row: PurchaseRow): number {
  const rawDate = row.createdAt ?? row.created_at ?? row.purchaseDate ?? row.purchase_date ?? null;
  const time = rawDate ? new Date(rawDate).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : row.id;
}

export function comparePurchaseRegistrationOrder(a: PurchaseRow, b: PurchaseRow): number {
  const byDate = purchaseRegistrationOrderValue(b) - purchaseRegistrationOrderValue(a);
  return byDate || b.id - a.id;
}
