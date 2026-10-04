import { matchesCsvProductName } from "@/inventory/lib/productNameUtils";
import type {
  CsvInvoiceData,
  ShipmentInvoiceProductMatch,
  ShipmentInvoiceResolution,
  ShipmentInvoiceUsage,
  ShipmentItem,
} from "./types";

export function extractInvoiceNo(value: string | null | undefined): string | null {
  const text = value?.normalize("NFKC").trim();
  if (!text) return null;
  const direct = text.match(/^(?:No\.?\s*)?(\d{1,5})(?=$|[_\s,/-])/i);
  if (direct) return direct[1];
  const embedded = text.match(/(?:^|[^\d])(?:No\.?\s*)?(\d{1,5})(?=_)/i);
  return embedded?.[1] ?? null;
}

export function sortInvoiceNo(a: string, b: string): number {
  const na = Number.parseInt(a, 10);
  const nb = Number.parseInt(b, 10);
  const aNumeric = Number.isFinite(na);
  const bNumeric = Number.isFinite(nb);
  if (aNumeric && bNumeric && na !== nb) return na - nb;
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1;
  return a.localeCompare(b, "ja", { numeric: true });
}

export function shipmentProductUsageKey(invoiceNo: string, product: ShipmentInvoiceProductMatch): string {
  return `${invoiceNo}\n${product.index}\n${product.name}`;
}

export function reserveShipmentProductUsage(
  usage: ShipmentInvoiceUsage | undefined,
  invoiceNo: string,
  product: ShipmentInvoiceProductMatch | null,
  quantity: number,
) {
  if (!usage || !product) return;
  const key = shipmentProductUsageKey(invoiceNo, product);
  usage.set(key, (usage.get(key) ?? 0) + Math.max(0, Number(quantity) || 0));
}

export function findCsvProductForShipmentItem(
  products: CsvInvoiceData["products"],
  item: ShipmentItem,
): ShipmentInvoiceProductMatch | null {
  const itemTitle = item.productNameJa || item.productNameEn || "";
  const index = products.findIndex((product) =>
    matchesCsvProductName(itemTitle, product.name) ||
    matchesCsvProductName(item.productNameEn || "", product.name),
  );
  return index >= 0 ? { ...products[index], index } : null;
}

export function resolveShipmentItemInvoice(
  deliveryNo: string,
  item: ShipmentItem,
  csvData: Record<string, CsvInvoiceData>,
  usage?: ShipmentInvoiceUsage,
): ShipmentInvoiceResolution {
  const explicitInvoiceNo = extractInvoiceNo(item.invoiceNo);
  const managementInvoiceNo = extractInvoiceNo(item.managementNo);
  const deliveryInvoiceNo = extractInvoiceNo(deliveryNo);
  const preferredInvoiceNo = explicitInvoiceNo ?? managementInvoiceNo ?? deliveryInvoiceNo;

  if (preferredInvoiceNo) {
    const product = findCsvProductForShipmentItem(csvData[preferredInvoiceNo]?.products ?? [], item);
    reserveShipmentProductUsage(usage, preferredInvoiceNo, product, item.quantity);
    return { invoiceNo: preferredInvoiceNo, product };
  }

  const candidates = Object.entries(csvData)
    .sort(([a], [b]) => sortInvoiceNo(a, b))
    .flatMap(([invoiceNo, data]) => {
      const product = findCsvProductForShipmentItem(data.products, item);
      if (!product) return [];
      const usedQty = usage?.get(shipmentProductUsageKey(invoiceNo, product)) ?? 0;
      return [{
        invoiceNo,
        product,
        remainingQty: Math.max(0, product.qty - usedQty),
      }];
    });

  candidates.sort((a, b) => {
    const aHasRemaining = a.remainingQty > 0 ? 1 : 0;
    const bHasRemaining = b.remainingQty > 0 ? 1 : 0;
    if (aHasRemaining !== bHasRemaining) return bHasRemaining - aHasRemaining;
    if (a.remainingQty !== b.remainingQty) return b.remainingQty - a.remainingQty;
    return sortInvoiceNo(a.invoiceNo, b.invoiceNo);
  });

  const best = candidates[0];
  if (best) {
    reserveShipmentProductUsage(usage, best.invoiceNo, best.product, item.quantity);
    return { invoiceNo: best.invoiceNo, product: best.product };
  }

  return { invoiceNo: deliveryNo.trim() || "unknown", product: null };
}
