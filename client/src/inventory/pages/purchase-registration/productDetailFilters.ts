import type { PurchaseRow } from "./dataTypes";
import type { ProductDetailFilter, StockItemView, InvoiceProductSummary } from "./viewTypes";
import { productKey } from "./productText";
import { purchaseRowStatusKind } from "./rowStatus";
import { itemStockQuantity } from "./purchaseItems";
import { purchaseItemMatchesProduct, stockItemMatchesProduct, findInvoiceProductNameForStockItem } from "./productMatching";

export function filterRowsByProductDetail(rows: PurchaseRow[], filter: ProductDetailFilter | null): PurchaseRow[] {
  if (!filter) return rows;
  return rows.flatMap((row) => {
    const rowStatus = purchaseRowStatusKind(row);
    const purchaseItems = row.purchase_items.filter((item) => {
      if (filter.productKey && !purchaseItemMatchesProduct(item, filter.productKey, filter.productTitle)) return false;
      if (filter.mode === "stock") {
        return rowStatus !== "ordered" && rowStatus !== "inbound_shipped" && itemStockQuantity(item) > 0;
      }
      return rowStatus === "ordered" || rowStatus === "inbound_shipped";
    });
    return purchaseItems.length > 0 ? [{ ...row, purchase_items: purchaseItems }] : [];
  });
}

export function filterStockItemsByProductDetail(items: StockItemView[], filter: ProductDetailFilter | null): StockItemView[] {
  if (!filter || filter.mode !== "stock") return [];
  if (!filter.productKey) return items;
  return items.filter((item) => stockItemMatchesProduct(item, filter.productKey ?? "", filter.productTitle));
}

export function filterStockItemsByInvoiceProductDetail(
  items: StockItemView[],
  filter: ProductDetailFilter | null,
  invoiceProducts: InvoiceProductSummary[],
): StockItemView[] {
  if (!filter || filter.mode !== "stock") return [];
  if (!filter.productKey) return items;
  return items.filter(
    (item) => productKey(findInvoiceProductNameForStockItem(item, invoiceProducts) ?? "") === filter.productKey,
  );
}

export function productDetailFilterLabel(filter: ProductDetailFilter): string {
  if (!filter.productKey) return filter.mode === "stock" ? "現在庫すべて" : "入庫まちすべて";
  return `${filter.productTitle} / ${filter.mode === "stock" ? "現在庫" : "入庫まち"}`;
}
