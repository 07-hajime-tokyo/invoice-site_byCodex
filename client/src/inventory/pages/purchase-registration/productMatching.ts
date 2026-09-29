import type { PurchaseItem } from "./dataTypes";
import type { InvoiceProductSummary, StockItemView } from "./viewTypes";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { extractManagementHints } from "@shared/productMatching";
import { productKey } from "./productText";
import { unique } from "./stringValues";
import { displayProductTitle, actualProductTitle } from "./productTitles";
import { canMatchTargetProduct, canMatchStockTargetProduct } from "./productMatchConstraints";
import { suggestInvoiceProductName, suggestInvoiceProductNameFromHints } from "./invoiceProductSuggestions";

export function invoiceAlignedProductTitle(
  item: PurchaseItem,
  invoiceProducts: InvoiceProductSummary[],
): string {
  const fallbackTitle = displayProductTitle(item);
  if (invoiceProducts.length === 0) return fallbackTitle;

  const candidates = invoiceProducts.map((product) => ({
    name: product.productName,
    qty: product.orderQty,
  }));
  const managementNo = parseEtc(item.etc).managementNo;
  const managementHints = extractManagementHints(item.etc, managementNo);
  const rawTitle = actualProductTitle(item);
  const matchText = unique([
    rawTitle,
    item.title?.trim() ?? "",
    item.etc?.trim() ?? "",
    managementNo,
    ...managementHints,
  ]).join(" ");
  const suggestedName =
    suggestInvoiceProductNameFromHints(rawTitle, [item.etc, managementNo, ...managementHints], candidates) ??
    suggestInvoiceProductName(matchText, managementHints.join(" "), candidates);

  return suggestedName && canMatchTargetProduct(matchText, suggestedName)
    ? suggestedName
    : fallbackTitle;
}

export function purchaseItemMatchTexts(item: PurchaseItem): string[] {
  const managementNo = parseEtc(item.etc).managementNo;
  const managementHints = extractManagementHints(item.etc, managementNo);
  return unique([
    item.title?.trim() ?? "",
    item.etc?.trim() ?? "",
    managementNo,
    ...managementHints,
    displayProductTitle(item),
  ]);
}

export function purchaseItemMatchesProduct(item: PurchaseItem, targetKey: string, targetTitle?: string): boolean {
  const title = displayProductTitle(item);
  const candidateText = purchaseItemMatchTexts(item).join(" ");
  if (!canMatchTargetProduct(candidateText, targetTitle)) return false;
  if (productKey(title) === targetKey) return true;
  if (!targetTitle) return false;
  const managementNo = parseEtc(item.etc).managementNo;
  const managementHints = extractManagementHints(item.etc, managementNo);
  if (
    suggestInvoiceProductNameFromHints("", managementHints, [{ name: targetTitle, qty: 1 }]) ===
    targetTitle
  ) {
    return true;
  }
  const rawTitle = item.title?.trim() || title;
  return (
    suggestInvoiceProductNameFromHints(rawTitle, managementHints, [{ name: targetTitle, qty: 1 }]) === targetTitle ||
    suggestInvoiceProductNameFromHints(title, managementHints, [{ name: targetTitle, qty: 1 }]) === targetTitle ||
    suggestInvoiceProductName(candidateText, managementHints.join(" "), [{ name: targetTitle, qty: 1 }]) === targetTitle
  );
}

export function stockItemMatchesProduct(item: StockItemView, targetKey: string, targetTitle?: string): boolean {
  const { managementHints, matchText } = stockItemMatchData(item);

  if (!canMatchStockTargetProduct(matchText, targetTitle)) return false;
  if (productKey(item.title) === targetKey) return true;
  if (!targetTitle) return false;

  return (
    suggestInvoiceProductNameFromHints(item.title, managementHints, [{ name: targetTitle, qty: 1 }]) === targetTitle ||
    suggestInvoiceProductName(matchText, managementHints.join(" "), [{ name: targetTitle, qty: 1 }]) === targetTitle
  );
}

export function stockItemMatchData(item: StockItemView): { managementHints: string[]; matchText: string } {
  const managementHints = extractManagementHints(item.legacyManagementNo, item.allocationLabel);
  return {
    managementHints,
    matchText: unique([
      item.title,
      item.category,
      item.legacyManagementNo,
      item.allocationLabel,
      item.supplier.name,
      ...managementHints,
    ]).join(" "),
  };
}

export function findInvoiceProductNameForStockItem(
  item: StockItemView,
  invoiceProducts: InvoiceProductSummary[],
): string | null {
  if (invoiceProducts.length === 0) return null;

  const { managementHints, matchText } = stockItemMatchData(item);
  const direct = invoiceProducts.find((product) =>
    productKey(product.productName) === productKey(item.title) &&
    canMatchStockTargetProduct(matchText, product.productName)
  );
  if (direct) return direct.productName;

  const candidates = invoiceProducts.map((product) => ({
    name: product.productName,
    qty: product.orderQty,
  }));
  const suggestedName =
    suggestInvoiceProductNameFromHints(
      item.title,
      [item.legacyManagementNo, item.allocationLabel, item.category, ...managementHints],
      candidates,
    ) ??
    suggestInvoiceProductName(matchText, managementHints.join(" "), candidates);

  return suggestedName && canMatchStockTargetProduct(matchText, suggestedName) ? suggestedName : null;
}
