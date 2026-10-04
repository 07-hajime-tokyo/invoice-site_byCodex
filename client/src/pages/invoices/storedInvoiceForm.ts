import type { InvoiceFormData } from "./types";

export type StoredInvoiceItem = {
  description: string;
  variant?: string | null;
  quantity: string | number;
  unitPrice: string | number;
  currency?: string | null;
  sortOrder?: number | null;
  tax?: string | number | null;
};
export type StoredInvoiceSource<Item extends StoredInvoiceItem = StoredInvoiceItem> = {
  invoiceNumber: string;
  clientId?: number | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  currency: string;
  showAmounts: boolean;
  notes?: string | null;
  rawChat?: string | null;
  status: InvoiceFormData["status"];
  accentColor?: string | null;
  items?: Item[] | null;
};
function storedInvoiceFields(inv: StoredInvoiceSource) {
  return {
    invoiceNumber: inv.invoiceNumber,
    clientId: inv.clientId ?? null,
    invoiceDate: inv.invoiceDate ?? "",
    dueDate: inv.dueDate ?? "",
    currency: inv.currency,
    showAmounts: inv.showAmounts,
    notes: inv.notes ?? "",
    rawChat: inv.rawChat ?? "",
    status: inv.status,
    accentColor: inv.accentColor ?? "#db8b1a",
  };
}
function storedItemFields(item: StoredInvoiceItem) {
  return {
    description: item.description,
    subText: item.variant ?? undefined,
    quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice),
    currency: item.currency ?? undefined,
  };
}
/** The identical list-preview and list-PDF conversion. */
export function storedInvoiceToForm(inv: StoredInvoiceSource): InvoiceFormData {
  return {
    ...storedInvoiceFields(inv),
    items: (inv.items ?? []).map(item => ({
      ...storedItemFields(item),
      sortOrder: item.sortOrder ?? undefined,
      tax: item.tax != null ? Number(item.tax) : undefined,
    })),
  };
}
/** Editing historically omits tax and passes sortOrder through; do not unify those differences. */
export function storedInvoiceToEditForm(inv: StoredInvoiceSource<Omit<StoredInvoiceItem, "sortOrder"> & { sortOrder?: number }>): InvoiceFormData {
  return {
    ...storedInvoiceFields(inv),
    items: (inv.items ?? []).map(item => ({ ...storedItemFields(item), sortOrder: item.sortOrder })),
  };
}
