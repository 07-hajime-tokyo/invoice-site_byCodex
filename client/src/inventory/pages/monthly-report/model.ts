import type { InventorySummaryItem, CostOverrides } from "./types";

export type InventoryCategorySummary = {
  category: string;
  items: InventorySummaryItem[];
  total: number | null;
};

export function inventoryCategoryTotal(
  categories: InventoryCategorySummary[],
  inventoryPriceOverrides: CostOverrides
) {
  let total = 0;
  for (const cat of categories) {
    for (const item of cat.items) {
      const key = `${cat.category}__${item.title}__${cat.items.indexOf(item)}`;
      const up = item.unitPrice ?? inventoryPriceOverrides[key] ?? null;
      if (up != null) total += up * item.quantity;
    }
  }
  return total;
}

export function resolveReportCost(
  itemKey: string,
  defaultPrice: number | null,
  costOverrides: CostOverrides
): number | null {
  if (itemKey in costOverrides) return costOverrides[itemKey];
  return defaultPrice;
}
