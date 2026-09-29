import type { PurchaseItem, InventoryItemLabel } from "./dataTypes";
import { toNumber } from "./format";

export function itemQuantity(item: PurchaseItem): number {
  return toNumber(item.quantity);
}

export function itemStockQuantity(item: PurchaseItem): number {
  return Math.max(0, toNumber(item.currentInventoryQuantity));
}

export function sumQuantity(items: PurchaseItem[]): number {
  return items.reduce((total, item) => total + itemQuantity(item), 0);
}

export function getItemLabels(items: PurchaseItem[]): InventoryItemLabel[] {
  return items.flatMap((item) => item.itemLabels ?? []).filter((label) => label.labelId);
}
