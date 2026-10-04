import {
  isInboundActivePurchase,
  getEffectivePurchaseStatus as getEffectivePurchaseStatusKey,
  isPurchaseInboundComplete,
} from "@shared/purchaseVisibility";
import { type Purchase, type InboundTabCounts } from "./types";
import { getPurchaseItemLabelIds } from "./format";

export function createEmptyInboundTabCounts(): InboundTabCounts {
  return {
    unclassified: 0,
    ebay: 0,
    oregon: 0,
    direct: 0,
    domestic: 0,
  };
}

export function countInboundTabsForClient(
  purchases: Purchase[]
): InboundTabCounts {
  const counts = createEmptyInboundTabCounts();
  for (const purchase of purchases) {
    if (
      !isInboundActivePurchase(purchase) ||
      isPurchaseInboundComplete(purchase)
    )
      continue;
    const key = purchase.inboundClass ?? "unclassified";
    counts[key] += 1;
  }
  return counts;
}

export function filterPurchasesForView(
  purchases: Purchase[],
  selectedCategory: string,
  selectedStatusFilter: string | null,
  searchQuery: string
) {
  let result = purchases.filter(isInboundActivePurchase);
  if (selectedCategory !== "すべて") {
    result = result.filter(purchase =>
      purchase.purchase_items.some(
        item => (item.category || "未分類") === selectedCategory
      )
    );
  }
  if (selectedStatusFilter) {
    result = result.filter(
      purchase =>
        getEffectivePurchaseStatusKey(purchase) === selectedStatusFilter
    );
  }
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter(purchase => {
      const trackingNo = (purchase.extra?.trackingNumber ?? "").toLowerCase();
      return purchase.purchase_items.some(item => {
        const itemTitle = (item.title ?? "").toLowerCase();
        const etcField = (item.etc ?? "").toLowerCase();
        const labelIds = getPurchaseItemLabelIds(item).join(" ").toLowerCase();
        const kanriNo = etcField.split(",")[0].trim();
        const invoiceNo = etcField.split(",")[2]?.trim() ?? "";
        return (
          kanriNo.includes(q) ||
          invoiceNo.includes(q) ||
          itemTitle.includes(q) ||
          labelIds.includes(q) ||
          trackingNo.includes(q)
        );
      });
    });
  }
  return result;
}
