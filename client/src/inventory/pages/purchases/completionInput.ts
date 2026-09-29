import { type Purchase } from "./types";
import { parseEtc, hasUnitPrice } from "./format";

export function buildPurchaseCompletionInput(
  purchase: Purchase,
  date: string,
  operatorKey: string,
  operatorName: string
) {
  const firstItem = purchase.purchase_items[0];
  const { managementNo, supplierSite } = parseEtc(firstItem?.etc);
  return {
    purchaseId: purchase.id,
    purchaseDate: date,
    purchaseItems: purchase.purchase_items.map(item => ({
      inventory_id: item.inventory_id,
      quantity: String(item.quantity),
      unit_price: String(item.unit_price),
    })),
    historyData: {
      kanriNo: managementNo || undefined,
      title: firstItem?.title ?? "",
      category: firstItem?.category || undefined,
      supplier: supplierSite || purchase.customer_name || undefined,
      unitPrice: hasUnitPrice(firstItem?.unit_price)
        ? String(firstItem?.unit_price)
        : undefined,
      inventoryId: firstItem?.inventory_id || undefined,
    },
    operatorKey: operatorKey as "default" | "A" | "B",
    operatorName: operatorName,
  };
}
