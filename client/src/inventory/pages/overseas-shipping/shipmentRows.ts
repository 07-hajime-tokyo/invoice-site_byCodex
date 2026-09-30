import { matchesCsvProductName } from "@/inventory/lib/productNameUtils";
import { suggestCsvProduct } from "@shared/productMatching";
import { findCsvProductForShipmentItem } from "./invoiceResolution";
import type {
  AggregatedShipmentRow,
  CsvInvoiceData,
  InvoiceEntry,
  OrderSummaryItem,
  ShipmentInvoiceProductMatch,
} from "./types";

export function normalizeShipmentGroupKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\s\u3000・･_\-ー,、]/g, "");
}

export function cleanShipmentProductTitle(title: string): string {
  return title.replace(/\s*[\(\（][^\)\）]*[\)\）]\s*/g, "").trim() || title.trim();
}

export function sameShipmentValue(values: string[], fallback: string): string {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (unique.length === 0) return "";
  return unique.length === 1 ? unique[0] : fallback;
}

export function findShipmentCsvProduct(
  products: CsvInvoiceData["products"],
  row: InvoiceEntry["shipments"][number],
): ShipmentInvoiceProductMatch | null {
  return findCsvProductForShipmentItem(products, row.item, row.shipment.deliveryNo);
}

export function aggregateShipmentRowsByOrderLine(
  products: CsvInvoiceData["products"],
  rows: InvoiceEntry["shipments"],
): AggregatedShipmentRow[] {
  const groups = new Map<string, AggregatedShipmentRow & { dates: string[]; trackingNumbers: string[] }>();

  for (const row of rows) {
    const rawTitle = row.item.productNameJa || row.item.productNameEn || "";
    const linkedProduct = findShipmentCsvProduct(products, row);
    const productName = linkedProduct?.name ?? cleanShipmentProductTitle(rawTitle);
    const key = normalizeShipmentGroupKey(productName);
    const existing = groups.get(key);

    if (existing) {
      existing.quantity += row.item.quantity;
      existing.dates.push(row.shipment.shippingDate);
      existing.trackingNumbers.push(row.shipment.trackingNumber);
    } else {
      groups.set(key, {
        key,
        shippingDate: row.shipment.shippingDate,
        trackingNumber: row.shipment.trackingNumber,
        productName,
        quantity: row.item.quantity,
        productOrder: linkedProduct?.index ?? products.length,
        dates: [row.shipment.shippingDate],
        trackingNumbers: [row.shipment.trackingNumber],
      });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      key: group.key,
      shippingDate: sameShipmentValue(group.dates, "複数日"),
      trackingNumber: sameShipmentValue(group.trackingNumbers, "複数"),
      productName: group.productName,
      quantity: group.quantity,
      productOrder: group.productOrder,
    }))
    .sort((a, b) => a.productOrder - b.productOrder || a.productName.localeCompare(b.productName, "ja"));
}

export function findCsvProductForDeliveryItem(
  products: CsvInvoiceData["products"],
  item: OrderSummaryItem["deliveryItems"][number],
): ShipmentInvoiceProductMatch | null {
  const csvProductName = item.csvProductName?.trim() ?? "";
  if (csvProductName) {
    const csvProductIndex = products.findIndex((product) =>
      product.name === csvProductName || matchesCsvProductName(csvProductName, product.name),
    );
    if (csvProductIndex >= 0) return { ...products[csvProductIndex], index: csvProductIndex };
  }

  const title = item.title ?? "";
  const directIndex = products.findIndex((product) => matchesCsvProductName(title, product.name));
  if (directIndex >= 0) return { ...products[directIndex], index: directIndex };

  const suggestion = suggestCsvProduct(
    title,
    item.managementNo ?? "",
    products.map((product) => ({ name: product.name, qty: product.qty })),
  );
  if (!suggestion) return null;

  const suggestedIndex = products.findIndex((product) => product.name === suggestion.name);
  if (suggestedIndex < 0) return null;
  return { ...products[suggestedIndex], index: suggestedIndex };
}

export function sumDeliveredQtyByOrderProduct(
  products: CsvInvoiceData["products"],
  deliveryItems: OrderSummaryItem["deliveryItems"],
): Map<number, number> {
  const deliveredQtyByProductIndex = new Map<number, number>();

  for (const item of deliveryItems) {
    const linkedProduct = findCsvProductForDeliveryItem(products, item);
    if (!linkedProduct) continue;
    deliveredQtyByProductIndex.set(
      linkedProduct.index,
      (deliveredQtyByProductIndex.get(linkedProduct.index) ?? 0) + item.quantity,
    );
  }

  return deliveredQtyByProductIndex;
}
