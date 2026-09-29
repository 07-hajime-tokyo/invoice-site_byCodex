import type { PurchaseRow } from "./dataTypes";
import type { ProductSummary, PurchaseRegistrationInvoice, AllocationGroup } from "./viewTypes";
import { getInvoiceInfo, OTHER_INVOICE_KEY, EBAY_GROUP_KEY, EBAY_GROUP_LABEL } from "./invoiceIdentity";
import { getSupplier } from "./supplier";
import { buildProductSummaries } from "./productSummaries";
import { buildLabelViews } from "./registrationLabelViews";
import { mergeLabelViewsById } from "./labelMerging";
import { toNumber } from "./format";
import { itemQuantity } from "./purchaseItems";
import { unique } from "./stringValues";

export function hasOpenInvoiceQuantity(product: ProductSummary): boolean {
  if (product.invoiceOrdered == null) return true;
  return Math.max(0, product.invoiceOrdered - (product.invoiceShipped ?? 0)) > 0;
}

export function buildAllocationGroups(
  rows: PurchaseRow[],
  invoiceSummaries?: PurchaseRegistrationInvoice[],
): AllocationGroup[] {
  const map = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    const key = getInvoiceInfo(row).key;
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  }

  const invoiceSummaryByKey = new Map<string, PurchaseRegistrationInvoice>(
    (invoiceSummaries ?? []).map((summary) => [`invoice-${summary.invoiceNo}`, summary]),
  );
  const shouldFilterClosedInvoices = invoiceSummaries !== undefined;

  const groups = Array.from(map.entries())
    .flatMap(([key, groupRows]) => {
      if (
        key !== OTHER_INVOICE_KEY &&
        key !== EBAY_GROUP_KEY &&
        shouldFilterClosedInvoices &&
        !invoiceSummaryByKey.has(key)
      ) return [];
      const first = groupRows[0];
      const supplier = getSupplier(first);
      const products = buildProductSummaries(groupRows);
      const labels = buildLabelViews(groupRows);
      const required = products.reduce((total, item) => total + item.required, 0);
      const secured = products.reduce((total, item) => total + item.secured, 0);
      const waiting = products.reduce((total, item) => total + item.waiting, 0);
      const purchaseTotal = groupRows.reduce(
        (total, row) =>
          total +
          row.purchase_items.reduce(
            (rowTotal, item) => rowTotal + toNumber(item.unit_price) * itemQuantity(item),
            0,
          ),
        0,
      );
      const invoiceInfo = getInvoiceInfo(first);
      const invoiceSummary = invoiceSummaryByKey.get(key);
      const partners = unique(groupRows.map((row) => getInvoiceInfo(row).partner).filter(Boolean));
      const partnerLabel = invoiceSummary?.partner || partners.join(" / ");
      const isEbayGroup = invoiceInfo.key === EBAY_GROUP_KEY;
      const label =
        invoiceInfo.key === OTHER_INVOICE_KEY
          ? "在庫"
          : isEbayGroup
            ? EBAY_GROUP_LABEL
            : `No.${invoiceInfo.invoiceNo}${partnerLabel ? ` ${partnerLabel}` : ""}`;
      return [{
        key,
        label,
        partner: invoiceInfo.key === OTHER_INVOICE_KEY ? "在庫" : partnerLabel || supplier.name,
        rows: groupRows,
        products,
        labels,
        required,
        secured,
        waiting,
        purchaseTotal,
        invoiceOrderQty: invoiceSummary?.totalOrderQty,
        invoiceDeliveredQty: invoiceSummary?.totalDeliveredQty,
        invoiceRemainingQty: invoiceSummary?.remainingQty,
      }];
    });

  for (const summary of invoiceSummaries ?? []) {
    const key = `invoice-${summary.invoiceNo}`;
    if (map.has(key)) continue;
    groups.push({
      key,
      label: `No.${summary.invoiceNo}${summary.partner ? ` ${summary.partner}` : ""}`,
      partner: summary.partner,
      rows: [],
      products: [],
      labels: [],
      required: 0,
      secured: 0,
      waiting: 0,
      purchaseTotal: 0,
      invoiceOrderQty: summary.totalOrderQty,
      invoiceDeliveredQty: summary.totalDeliveredQty,
      invoiceRemainingQty: summary.remainingQty,
    });
  }

  return groups.sort((a, b) => {
    if (a.key === OTHER_INVOICE_KEY) return 1;
    if (b.key === OTHER_INVOICE_KEY) return -1;
    if (a.key === EBAY_GROUP_KEY) return 1;
    if (b.key === EBAY_GROUP_KEY) return -1;
    return b.key.localeCompare(a.key, "ja", { numeric: true });
  });
}

export function mergeAllocationGroupsByKey(groups: AllocationGroup[]): AllocationGroup[] {
  const result: AllocationGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const group of groups) {
    const index = indexByKey.get(group.key);
    if (index === undefined) {
      indexByKey.set(group.key, result.length);
      result.push(group);
      continue;
    }

    const current = result[index];
    const labels = mergeLabelViewsById(current.labels, group.labels);
    result[index] = {
      ...current,
      rows: [...current.rows, ...group.rows],
      products: [...current.products, ...group.products],
      labels,
      required: labels.length > 0 ? labels.length : current.required + group.required,
      secured: labels.length > 0 ? labels.length : current.secured + group.secured,
      waiting: current.waiting + group.waiting,
      purchaseTotal: current.purchaseTotal + group.purchaseTotal,
      invoiceOrderQty: current.invoiceOrderQty ?? group.invoiceOrderQty,
      invoiceDeliveredQty: current.invoiceDeliveredQty ?? group.invoiceDeliveredQty,
      invoiceRemainingQty: labels.length > 0 ? labels.length : (current.invoiceRemainingQty ?? group.invoiceRemainingQty),
    };
  }
  return result;
}

export function getAllRowsFromGroup(group: AllocationGroup | null, fallbackRows: PurchaseRow[]): PurchaseRow[] {
  if (!group) return fallbackRows;
  return group.rows;
}
