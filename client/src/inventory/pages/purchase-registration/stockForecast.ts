import type { ProductSummary } from "./viewTypes";
import { toNumber, formatCurrency, formatTradePrice, normalizeCurrencyLabel } from "./format";

export function buildForecastSummary(products: ProductSummary[], purchaseTotal: number) {
  let originalTotal = 0;
  let jpyTotal = 0;
  let currency: string | null = null;
  let hasOriginalPrice = false;
  let hasJpyPrice = false;
  let hasMixedCurrency = false;

  for (const product of products) {
    const quantity = Math.max(0, product.required);
    if (quantity <= 0) continue;

    const sellingPrice = toNumber(product.sellingPrice);
    const sellingPriceJpy = toNumber(product.sellingPriceJpy);
    if (sellingPrice > 0) {
      hasOriginalPrice = true;
      originalTotal += sellingPrice * quantity;
      const productCurrency = normalizeCurrencyLabel(product.sellingCurrency);
      if (!currency) {
        currency = productCurrency;
      } else if (productCurrency && productCurrency !== currency) {
        hasMixedCurrency = true;
      }
    }
    if (sellingPriceJpy > 0) {
      hasJpyPrice = true;
      jpyTotal += sellingPriceJpy * quantity;
    }
  }

  const roundedJpyTotal = Math.round(jpyTotal);
  const salesValue = hasOriginalPrice && !hasMixedCurrency
    ? formatTradePrice(Math.round(originalTotal), currency)
    : hasJpyPrice
      ? formatCurrency(roundedJpyTotal)
      : "-";
  const salesSub = hasJpyPrice && hasOriginalPrice && !hasMixedCurrency ? formatCurrency(roundedJpyTotal) : undefined;
  const grossProfit = hasJpyPrice ? Math.round(jpyTotal - purchaseTotal) : null;
  const grossProfitRate = hasJpyPrice && jpyTotal > 0 && grossProfit != null
    ? `${Math.round((grossProfit / jpyTotal) * 100)}%`
    : undefined;

  return {
    salesValue,
    salesSub,
    grossValue: grossProfit == null ? "-" : formatCurrency(grossProfit),
    grossSub: grossProfitRate,
  };
}
