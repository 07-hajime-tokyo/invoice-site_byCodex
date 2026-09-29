import { cleanLegacyManagementNo } from "@shared/purchaseMetadata";
import { getManagementNos } from "./managementNumbers";
import type { PurchaseRow } from "./dataTypes";

// Registration grouping intentionally requires a three-digit invoice followed by "_".
// The broader shared invoice parser and /^E/ stock classifier have different meanings.

export const OTHER_INVOICE_KEY = "invoice-other";

export const EBAY_GROUP_KEY = "invoice-ebay";

export const EBAY_GROUP_LABEL = "eBay";

export function parseInvoiceFromManagementNo(managementNo: string): { invoiceNo: string; partner: string } | null {
  const trimmed = managementNo.trim();
  const match = trimmed.match(/^(\d{3})(?:_([^_,\s]+))?/);
  if (!match || !trimmed.startsWith(`${match[1]}_`)) return null;
  return {
    invoiceNo: match[1],
    partner: match[2] ?? "",
  };
}

export function isEbayManagementNo(managementNo: string | null | undefined): boolean {
  return /^ebay(?:[_-]|$)/i.test(cleanLegacyManagementNo(managementNo ?? ""));
}

export function getInvoiceInfo(row: PurchaseRow): { key: string; invoiceNo: string; partner: string } {
  const managementNos = getManagementNos(row.purchase_items);
  for (const managementNo of managementNos) {
    const parsed = parseInvoiceFromManagementNo(managementNo);
    if (parsed) {
      return {
        key: `invoice-${parsed.invoiceNo}`,
        invoiceNo: parsed.invoiceNo,
        partner: parsed.partner,
      };
    }
  }
  if (managementNos.some(isEbayManagementNo)) {
    return {
      key: EBAY_GROUP_KEY,
      invoiceNo: EBAY_GROUP_LABEL,
      partner: EBAY_GROUP_LABEL,
    };
  }
  return {
    key: OTHER_INVOICE_KEY,
    invoiceNo: "在庫",
    partner: "",
  };
}

export function invoiceNoFromGroupKey(key?: string | null): string | null {
  const match = key?.match(/^invoice-(\d+)$/);
  return match?.[1] ?? null;
}
