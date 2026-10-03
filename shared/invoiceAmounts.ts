export type InvoiceAmountItem = {
  quantity: number;
  unitPrice: number;
  tax?: number | null;
};

/** Keep the original two passes and defer rounding to each presentation. */
export function calculateInvoiceTotals(items: readonly InvoiceAmountItem[]) {
  const subtotal = items.reduce((s, item) => s + item.quantity * item.unitPrice, 0);
  const taxTotal = items.reduce((s, item) => {
    const rate = (item.tax ?? 0) / 100;
    return s + item.quantity * item.unitPrice * rate;
  }, 0);
  return { subtotal, taxTotal, total: subtotal + taxTotal };
}
