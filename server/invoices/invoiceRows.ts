import type { InvoiceFields, InvoiceItemInput } from "./invoiceInput";

export function buildInvoiceRow(input: InvoiceFields, invoiceNumber: string) {
  return {
    invoiceNumber,
    clientId: input.clientId ?? null,
    clientSnapshot: input.clientSnapshot ?? null,
    invoiceDate: input.invoiceDate ?? null,
    dueDate: input.dueDate ?? null,
    currency: input.currency,
    showAmounts: input.showAmounts,
    notes: input.notes ?? null,
    rawChat: input.rawChat ?? null,
    status: input.status,
    accentColor: input.accentColor ?? "#db8b1a",
  };
}

export function buildInvoiceItemRows(
  items: InvoiceItemInput[],
  invoiceId: number
) {
  return items.map((item, idx) => ({
    invoiceId,
    description: item.description,
    variant: item.variant ?? null,
    quantity: String(item.quantity),
    unitPrice: String(item.unitPrice),
    currency: item.currency ?? null,
    sortOrder: item.sortOrder ?? idx,
    tax: item.tax !== undefined ? String(item.tax) : "0",
  }));
}
