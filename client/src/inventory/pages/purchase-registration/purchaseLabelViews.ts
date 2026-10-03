import type { PurchaseItem, PurchaseRow } from "./dataTypes";
import type { LabelView, PurchaseRegistrationInvoice } from "./viewTypes";
import { parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { preferredManagementNo } from "./managementNumbers";
import { getInvoiceInfo, OTHER_INVOICE_KEY, EBAY_GROUP_KEY } from "./invoiceIdentity";
import { getSupplier } from "./supplier";
import { toNumber } from "./format";
import { itemStockQuantity } from "./purchaseItems";
import { displayStockCategory } from "./productPresentation";
import { labelStatusLabel } from "./labelStatus";
import { formatLabelPrintTitle, labelAllocationLabel } from "./labelTitles";
import { isInventoryPrintableLabel } from "./inventoryLabelViews";

// Keep the existing title fallback in the screen; construction never evaluates it.
export function createPurchaseLabelBuilders(actualProductTitle: (item: PurchaseItem) => string) {
  function buildLabelViews(rows: PurchaseRow[]): LabelView[] {
    return rows.flatMap((row) => {
      const supplier = getSupplier(row);
      return row.purchase_items.flatMap((item) => {
        const managementNo = parseEtc(item.etc).managementNo;
        const title = actualProductTitle(item);
        return (item.itemLabels ?? []).map((label) => {
          const legacyManagementNo = preferredManagementNo(managementNo, label.legacyManagementNo);
          return {
            key: `${row.id}-${item.id}-${label.id ?? label.labelId}`,
            labelId: label.labelId,
            rawStatus: label.status ?? "",
            status: labelStatusLabel(label.status),
            title,
            printTitle: formatLabelPrintTitle(title),
            category: displayStockCategory(item.category),
            legacyManagementNo,
            assignedInvoiceNo: label.assignedInvoiceNo ?? null,
            allocationLabel: labelAllocationLabel(legacyManagementNo),
            unitPrice: toNumber(item.unit_price),
            supplier,
            purchaseDate: row.purchase_date ?? item.estimated_purchase_date ?? "",
            rowId: row.id,
            itemId: item.id,
            inventoryId: label.localInventoryId ?? item.inventory_id ?? null,
            trackingNumber: row.extra?.trackingNumber ?? null,
            carrier: row.extra?.carrier ?? null,
          };
        });
      });
    });
  }

  function buildClosedInvoiceInventoryLabelViews(
    rows: PurchaseRow[],
    invoiceSummaries?: PurchaseRegistrationInvoice[],
  ): LabelView[] {
    if (invoiceSummaries === undefined) return [];
    const openInvoiceKeys = new Set(invoiceSummaries.map((summary) => `invoice-${summary.invoiceNo}`));
    return rows.flatMap((row) => {
      const invoiceInfo = getInvoiceInfo(row);
      if (invoiceInfo.key === OTHER_INVOICE_KEY || invoiceInfo.key === EBAY_GROUP_KEY) return [];
      if (openInvoiceKeys.has(invoiceInfo.key)) return [];

      const supplier = getSupplier(row);
      return row.purchase_items.flatMap((item) => {
        const stockQuantity = Math.max(0, Math.floor(itemStockQuantity(item)));
        if (stockQuantity <= 0) return [];
        const title = actualProductTitle(item);
        const managementNo = parseEtc(item.etc).managementNo;
        return (item.itemLabels ?? [])
          .filter(isInventoryPrintableLabel)
          .slice(0, stockQuantity)
          .map((label) => {
            const legacyManagementNo = preferredManagementNo(managementNo, label.legacyManagementNo);
            return {
              key: `closed-invoice-stock-${row.id}-${item.id}-${label.id ?? label.labelId}`,
              labelId: label.labelId,
              rawStatus: label.status || "stocked",
              status: labelStatusLabel(label.status || "stocked"),
              title,
              printTitle: formatLabelPrintTitle(title),
              category: displayStockCategory(item.category),
              legacyManagementNo,
              assignedInvoiceNo: label.assignedInvoiceNo ?? null,
              allocationLabel: "",
              unitPrice: toNumber(item.unit_price),
              supplier,
              purchaseDate: row.purchase_date ?? item.estimated_purchase_date ?? "",
              rowId: row.id,
              itemId: item.id,
              inventoryId: label.localInventoryId ?? item.inventory_id ?? null,
              trackingNumber: row.extra?.trackingNumber ?? null,
              carrier: row.extra?.carrier ?? null,
            };
          });
      });
    });
  }

  return { buildLabelViews, buildClosedInvoiceInventoryLabelViews };
}
