import type { StockProposalProduct } from "./viewTypes";
import { formatCurrency } from "./format";
import { unique } from "./stringValues";

export function proposalAveragePrice(total: number, quantity: number): number {
  return quantity > 0 ? Math.round(total / quantity) : 0;
}

export function stockProposalPriceLabel(product: StockProposalProduct): { main: string; sub: string } {
  const average = proposalAveragePrice(product.unitPriceTotal, product.unitPriceQuantity);
  if (average <= 0) return { main: "-", sub: "" };
  const min = product.minUnitPrice ?? average;
  const max = product.maxUnitPrice ?? average;
  return {
    main: `平均 ${formatCurrency(average)}`,
    sub: min === max ? "" : `${formatCurrency(min)} - ${formatCurrency(max)}`,
  };
}

export function stockProposalManagementLabel(product: StockProposalProduct): string {
  const values = unique(product.details.map((detail) => detail.managementNo).filter((value) => value && value !== "-"));
  if (values.length === 0) return "-";
  const visible = values.slice(0, 4).join(" / ");
  return values.length > 4 ? `${visible} / ほか${values.length - 4}件` : visible;
}
