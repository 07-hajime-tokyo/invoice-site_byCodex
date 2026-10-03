/** Client preview/PDF formatting; the server PDF and editor have different rules. */
export function invoiceCurrencySymbol(currency: string) {
  return currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : currency === "JPY" ? "¥" : currency;
}

export function formatInvoiceAmount(n: number, currency: string) {
  if (currency === "JPY") return n.toLocaleString();
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
