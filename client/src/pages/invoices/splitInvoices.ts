import type { InvoiceItem } from "./types";

export type InvoiceSplit = { invoiceNumber: string; items: InvoiceItem[]; totalJpy: number };

export function computeInvoiceSplits(invoiceNumber: string, items: InvoiceItem[], rate: number, limitJpy = 1_000_000) {
    const groups: Array<{ invoiceNumber: string; items: InvoiceItem[]; totalJpy: number }> = [];
    let currentItems: InvoiceItem[] = [];
    let currentTotal = 0;
    const formatSplitInvoiceNumber = (offset: number) => {
      const base = invoiceNumber.trim();
      const match = base.match(/(\d+)$/);
      if (!match || match.index === undefined) return String(offset + 1).padStart(4, "0");
      const nextNumber = Number.parseInt(match[1], 10) + offset;
      const width = Math.max(match[1].length, 4);
      return `${base.slice(0, match.index)}${String(nextNumber).padStart(width, "0")}`;
    };

    for (const item of items) {
      const itemJpy = item.quantity * item.unitPrice * rate;
      // 単体で上限超える場合はそのまま単独グループに
      if (currentItems.length > 0 && currentTotal + itemJpy > limitJpy) {
        groups.push({ invoiceNumber: formatSplitInvoiceNumber(groups.length), items: currentItems, totalJpy: currentTotal });
        currentItems = [];
        currentTotal = 0;
      }
      currentItems.push(item);
      currentTotal += itemJpy;
    }
    if (currentItems.length > 0) {
      groups.push({ invoiceNumber: formatSplitInvoiceNumber(groups.length), items: currentItems, totalJpy: currentTotal });
    }
    return groups;
  }
