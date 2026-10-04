import type { InvoiceFormData, InvoiceItem } from "./types";
import type { InvoiceSplit } from "./splitInvoices";

function invoiceSaveItem(item: InvoiceItem) {
  return { ...item, variant: item.subText ?? undefined };
}
function snapshot<Client extends { id: number }>(form: InvoiceFormData, clients: readonly Client[]) {
  const selectedClient = clients.find(c => c.id === form.clientId);
  return selectedClient ?? null;
}
export function buildInvoiceSavePayload<Client extends { id: number }>(form: InvoiceFormData, clients: readonly Client[]) {
  return { ...form, clientSnapshot: snapshot(form, clients), items: form.items.map(invoiceSaveItem) };
}
export function buildInvoiceSplitPayload<Client extends { id: number }>(form: InvoiceFormData, clients: readonly Client[], exchangeRateInfo: { rate: number } | null, splitPreview: InvoiceSplit[]) {
  if (!exchangeRateInfo || splitPreview.length === 0) return;
  const clientSnapshot = snapshot(form, clients);
  return {
      baseInvoiceNumber: form.invoiceNumber,
      clientId: form.clientId,
      clientSnapshot,
      invoiceDate: form.invoiceDate,
      dueDate: form.dueDate,
      currency: form.currency,
      showAmounts: form.showAmounts,
      notes: form.notes,
      rawChat: form.rawChat,
      status: form.status as "draft" | "sent" | "paid",
      accentColor: form.accentColor,
      exchangeRate: exchangeRateInfo.rate,
      splits: splitPreview.map(g => ({
        invoiceNumber: g.invoiceNumber,
        items: g.items.map(invoiceSaveItem),
      })),
    };
}
