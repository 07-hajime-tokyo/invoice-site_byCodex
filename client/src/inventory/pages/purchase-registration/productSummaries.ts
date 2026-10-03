import type { PurchaseRow } from "./dataTypes";
import type { ProductSummary, InvoiceProductSummary, StockItemView } from "./viewTypes";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { extractManagementHints } from "@shared/productMatching";
import { productKey } from "./productText";
import { unique } from "./stringValues";
import { toNumber } from "./format";
import { itemQuantity, itemStockQuantity } from "./purchaseItems";
import { isReceived } from "./rowStatus";
import { invoiceAlignedProductTitle, purchaseItemMatchTexts, findInvoiceProductNameForStockItem } from "./productMatching";
import { canMatchTargetProduct } from "./productMatchConstraints";
import { suggestInvoiceProductName, suggestInvoiceProductNameFromHints } from "./invoiceProductSuggestions";

export function buildProductSummaries(
  rows: PurchaseRow[],
  invoiceProducts: InvoiceProductSummary[] = [],
): ProductSummary[] {
  const map = new Map<string, ProductSummary>();
  for (const row of rows) {
    for (const item of row.purchase_items) {
      const title = invoiceAlignedProductTitle(item, invoiceProducts);
      const key = productKey(title);
      const current = map.get(key) ?? {
        key,
        title,
        managementNos: [],
        matchTexts: [],
        required: 0,
        secured: 0,
        waiting: 0,
        unitPriceTotal: 0,
        unitPriceCount: 0,
      };
      const quantity = itemQuantity(item);
      const managementNo = parseEtc(item.etc).managementNo;
      const managementHints = extractManagementHints(item.etc, managementNo);
      if (managementHints.length > 0) {
        current.managementNos = unique([...(current.managementNos ?? []), ...managementHints]);
      }
      current.matchTexts = unique([...(current.matchTexts ?? []), ...purchaseItemMatchTexts(item)]);
      current.required += quantity;
      const securedQuantity = Math.min(quantity, itemStockQuantity(item));
      current.secured += securedQuantity;
      if (!isReceived(row)) {
        current.waiting += Math.max(0, quantity - securedQuantity);
      }
      const unitPrice = toNumber(item.unit_price);
      if (unitPrice > 0) {
        current.unitPriceTotal += unitPrice;
        current.unitPriceCount += 1;
      }
      map.set(key, current);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, "ja"));
}

export function buildInvoiceStockProductSummaries(
  stockItems: StockItemView[],
  invoiceProducts: InvoiceProductSummary[],
  excludedInventoryIds: Set<number>,
): ProductSummary[] {
  if (invoiceProducts.length === 0) return [];
  const map = new Map<string, ProductSummary>();

  for (const item of stockItems) {
    if (excludedInventoryIds.has(item.inventoryId)) continue;
    const matchedProductName = findInvoiceProductNameForStockItem(item, invoiceProducts);
    if (!matchedProductName) continue;

    const title = matchedProductName;
    const key = productKey(title);
    const current = map.get(key) ?? {
      key,
      title,
      managementNos: [],
      matchTexts: [],
      required: 0,
      secured: 0,
      waiting: 0,
      unitPriceTotal: 0,
      unitPriceCount: 0,
    };
    const quantity = Math.max(0, Math.floor(Number(item.quantity)) || 0);
    if (quantity <= 0) continue;

    current.secured += quantity;
    current.managementNos = unique([...(current.managementNos ?? []), item.legacyManagementNo]);
    current.matchTexts = unique([
      ...(current.matchTexts ?? []),
      item.title,
      item.category,
      item.legacyManagementNo,
      item.allocationLabel,
      item.supplier.name,
    ]);
    if (item.unitPrice > 0) {
      current.unitPriceTotal += item.unitPrice * quantity;
      current.unitPriceCount += quantity;
    }
    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, "ja"));
}

export function filterInvoiceStockItems(
  stockItems: StockItemView[],
  invoiceProducts: InvoiceProductSummary[],
  excludedInventoryIds: Set<number>,
): StockItemView[] {
  if (invoiceProducts.length === 0) return [];
  return stockItems.filter((item) => {
    if (excludedInventoryIds.has(item.inventoryId)) return false;
    return Boolean(findInvoiceProductNameForStockItem(item, invoiceProducts));
  });
}

export function withInvoiceProductCounts(
  products: ProductSummary[],
  invoiceProducts: InvoiceProductSummary[],
): ProductSummary[] {
  if (invoiceProducts.length === 0) return products;

  type InvoiceProductStats = InvoiceProductSummary & {
    sellingPriceTotal: number;
    sellingPriceQuantity: number;
    sellingPriceJpyTotal: number;
    sellingPriceJpyQuantity: number;
  };
  const statsByKey = new Map<string, InvoiceProductStats>();
  const statsOrder: string[] = [];
  for (const product of invoiceProducts) {
    const key = productKey(product.productName);
    const current = statsByKey.get(key);
    const orderQty = toNumber(product.orderQty);
    const deliveredQty = toNumber(product.deliveredQty);
    const sellingPrice = toNumber(product.sellingPrice);
    const sellingPriceJpy = toNumber(product.sellingPriceJpy);
    if (current) {
      current.orderQty += orderQty;
      current.deliveredQty += deliveredQty;
      if (sellingPrice > 0 && orderQty > 0) {
        current.sellingPriceTotal += sellingPrice * orderQty;
        current.sellingPriceQuantity += orderQty;
        current.sellingPrice = current.sellingPriceTotal / current.sellingPriceQuantity;
      }
      if (sellingPriceJpy > 0 && orderQty > 0) {
        current.sellingPriceJpyTotal += sellingPriceJpy * orderQty;
        current.sellingPriceJpyQuantity += orderQty;
        current.sellingPriceJpy = current.sellingPriceJpyTotal / current.sellingPriceJpyQuantity;
      }
    } else {
      statsOrder.push(key);
      statsByKey.set(key, {
        productName: product.productName,
        orderQty,
        deliveredQty,
        sellingPrice: sellingPrice > 0 ? sellingPrice : null,
        sellingPriceJpy: sellingPriceJpy > 0 ? sellingPriceJpy : null,
        currency: product.currency ?? null,
        sellingPriceTotal: sellingPrice > 0 && orderQty > 0 ? sellingPrice * orderQty : 0,
        sellingPriceQuantity: sellingPrice > 0 && orderQty > 0 ? orderQty : 0,
        sellingPriceJpyTotal: sellingPriceJpy > 0 && orderQty > 0 ? sellingPriceJpy * orderQty : 0,
        sellingPriceJpyQuantity: sellingPriceJpy > 0 && orderQty > 0 ? orderQty : 0,
      });
    }
  }

  const createInvoiceSummary = (key: string, product: InvoiceProductStats): ProductSummary => ({
    key,
    title: product.productName,
    managementNos: [],
    matchTexts: [],
    invoiceOrdered: product.orderQty,
    invoiceShipped: product.deliveredQty,
    required: Math.max(0, product.orderQty - product.deliveredQty),
    secured: 0,
    waiting: 0,
    unitPriceTotal: 0,
    unitPriceCount: 0,
    sellingPrice: product.sellingPrice ?? null,
    sellingPriceJpy: product.sellingPriceJpy ?? null,
    sellingCurrency: product.currency ?? null,
  });

  const summariesByInvoiceKey = new Map<string, ProductSummary>();
  for (const key of statsOrder) {
    const product = statsByKey.get(key);
    if (product) summariesByInvoiceKey.set(key, createInvoiceSummary(key, product));
  }

  const candidates = Array.from(statsByKey.values()).map((product) => ({
    name: product.productName,
    qty: product.orderQty,
  }));

  for (const product of products) {
    const direct = statsByKey.get(product.key);
    const managementHints = extractManagementHints(
      ...(product.managementNos ?? []),
      ...(product.matchTexts ?? []),
    );
    const matchText = unique([product.title, ...(product.matchTexts ?? []), ...managementHints]).join(" ");
    const titleSuggestion =
      suggestInvoiceProductNameFromHints(product.title, managementHints, candidates) ??
      (product.title.trim() ? suggestInvoiceProductName(product.title, managementHints.join(" "), candidates) : null);
    const suggestedName =
      suggestInvoiceProductNameFromHints("", managementHints, candidates) ??
      titleSuggestion ??
      (matchText.trim() ? suggestInvoiceProductName(matchText, managementHints.join(" "), candidates) : null);
    const suggestedKey = suggestedName && canMatchTargetProduct(matchText, suggestedName) ? productKey(suggestedName) : "";
    const directMatchesTarget = direct ? canMatchTargetProduct(matchText, direct.productName) : false;
    const matchedKey =
      suggestedKey && summariesByInvoiceKey.has(suggestedKey)
        ? suggestedKey
        : direct && directMatchesTarget
          ? product.key
          : "";
    const target = matchedKey ? summariesByInvoiceKey.get(matchedKey) : undefined;

    if (!target) {
      continue;
    }

    target.secured += product.secured;
    target.waiting += product.waiting;
    target.unitPriceTotal += product.unitPriceTotal;
    target.unitPriceCount += product.unitPriceCount;
    target.managementNos = unique([...(target.managementNos ?? []), ...managementHints, ...(product.managementNos ?? [])]);
    target.matchTexts = unique([...(target.matchTexts ?? []), ...(product.matchTexts ?? []), ...managementHints]);
  }

  return statsOrder
    .map((key) => summariesByInvoiceKey.get(key))
    .filter((product): product is ProductSummary => Boolean(product));
}

export function withInvoiceStockCountsFromItems(
  products: ProductSummary[],
  stockItems: StockItemView[],
  invoiceProducts: InvoiceProductSummary[],
): ProductSummary[] {
  if (invoiceProducts.length === 0) return products;

  const stockCountByProductKey = new Map<string, number>();
  for (const item of stockItems) {
    const matchedProductName = findInvoiceProductNameForStockItem(item, invoiceProducts);
    if (!matchedProductName) continue;
    const key = productKey(matchedProductName);
    const quantity = Math.max(0, Math.floor(Number(item.quantity)) || 0);
    if (quantity <= 0) continue;
    stockCountByProductKey.set(key, (stockCountByProductKey.get(key) ?? 0) + quantity);
  }

  return products.map((product) => {
    if (product.invoiceOrdered == null) return product;
    return {
      ...product,
      secured: stockCountByProductKey.get(product.key) ?? 0,
    };
  });
}
