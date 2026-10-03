import type { InvoiceFormData, InvoiceItem, InvoiceClientOption } from "./types";
import { getDefaultCurrencyForClient } from "./clientRules";

export function addInvoiceItem(f: InvoiceFormData): InvoiceFormData {
  return { ...f, items: [...f.items, { description: "", quantity: 1, unitPrice: 0, currency: f.currency, sortOrder: f.items.length }] };
}
export function updateInvoiceItem(f: InvoiceFormData, idx: number, field: keyof InvoiceItem, value: string | number): InvoiceFormData {
  return { ...f, items: f.items.map((item, i) => i === idx ? { ...item, [field]: value } : item) };
}
export function removeInvoiceItem(f: InvoiceFormData, idx: number): InvoiceFormData {
  return { ...f, items: f.items.filter((_, i) => i !== idx) };
}
/** Resolve selection before setForm, matching the original event-time lookup. */
export function resolveInvoiceClient(clients: readonly InvoiceClientOption[], value: string) {
  const clientId = value === "__none__" ? null : Number(value);
  const client = clientId ? clients.find(c => c.id === clientId) : null;
  return { clientId, client };
}
export function applyInvoiceClient(f: InvoiceFormData, { clientId, client }: ReturnType<typeof resolveInvoiceClient>): InvoiceFormData {
  if (!client) return { ...f, clientId };
  const nextCurrency = getDefaultCurrencyForClient(client);
  return {
    ...f, clientId, currency: nextCurrency,
    items: f.items.map(item => !item.currency || item.currency === f.currency ? { ...item, currency: nextCurrency } : item),
  };
}
