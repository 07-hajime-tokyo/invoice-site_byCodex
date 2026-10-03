export type InvoiceRate = { rate: number } | null | undefined;
export function invoiceListCurrencies(invoices: readonly { currency: string }[]) {
  const set = new Set(invoices.map(inv => inv.currency).filter(c => c !== "JPY"));
  return Array.from(set);
}
export function buildInvoiceRateMap(eurRate: InvoiceRate, usdRate: InvoiceRate, gbpRate: InvoiceRate, chfRate: InvoiceRate) {
  const map: Record<string, number> = { JPY: 1 };
  if (eurRate) map["EUR"] = eurRate.rate;
  if (usdRate) map["USD"] = usdRate.rate;
  if (gbpRate) map["GBP"] = gbpRate.rate;
  if (chfRate) map["CHF"] = chfRate.rate;
  return map;
}
export function invoiceAmountJpy(totalAmount: number, currency: string, rateMap: Record<string, number>): number | null {
  const rate = rateMap[currency];
  if (rate == null) return null;
  return Math.round(totalAmount * rate);
}
export function invoiceCardAmounts(inv: { currency: string; totalAmount?: number | null; itemCount?: number | null }, rateMap: Record<string, number>) {
  const totalAmount = inv.totalAmount ?? 0;
  const itemCount = inv.itemCount ?? 0;
  const jpyAmount = invoiceAmountJpy(totalAmount, inv.currency, rateMap);
  const isOver1M = jpyAmount != null && jpyAmount >= 1_000_000;
  return { totalAmount, itemCount, jpyAmount, isOver1M };
}
