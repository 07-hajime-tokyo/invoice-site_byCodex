import type { StockProposalProduct, StockProposalDetail } from "./viewTypes";
import { productKey } from "./productText";
import { normalizeStockProposalTitle } from "./stockProposalRules";

// These helpers intentionally mutate only the per-call proposal accumulator/map.

export function addStockProposalPrice(product: StockProposalProduct, unitPrice: number, quantity: number) {
  if (unitPrice <= 0 || quantity <= 0) return;
  product.unitPriceTotal += unitPrice * quantity;
  product.unitPriceQuantity += quantity;
  product.minUnitPrice = product.minUnitPrice == null ? unitPrice : Math.min(product.minUnitPrice, unitPrice);
  product.maxUnitPrice = product.maxUnitPrice == null ? unitPrice : Math.max(product.maxUnitPrice, unitPrice);
}

export function appendStockProposalDetail(product: StockProposalProduct, detail: StockProposalDetail) {
  product.details.push(detail);
  product.searchText = [
    product.searchText,
    detail.managementNo,
    detail.labelId ?? "",
    detail.supplier.name,
    detail.status,
  ]
    .join("\n")
    .toLowerCase();
}

export function getOrCreateStockProposalProduct(
  map: Map<string, StockProposalProduct>,
  title: string,
  model: string,
): StockProposalProduct {
  const normalizedTitle = normalizeStockProposalTitle(title);
  const key = `${model}::${productKey(normalizedTitle)}`;
  const current = map.get(key);
  if (current) return current;
  const created: StockProposalProduct = {
    key,
    title: normalizedTitle,
    model,
    stockQuantity: 0,
    waitingQuantity: 0,
    totalQuantity: 0,
    unitPriceTotal: 0,
    unitPriceQuantity: 0,
    minUnitPrice: null,
    maxUnitPrice: null,
    details: [],
    searchText: [model, normalizedTitle].join("\n").toLowerCase(),
  };
  map.set(key, created);
  return created;
}
