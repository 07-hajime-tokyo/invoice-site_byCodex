import { getEbayStockType, normalizeEbayOrderStatus } from "@shared/ebayInventory";

export type DirectSummary = {
  key: string;
  partner: string;
  csvOrderQty: number;
  csvStatus: string;
  manualComplete: boolean;
  deliveredCount: number;
  stockCount: number;
  csvProducts: Array<{ status: string }>;
};

export type PurchaseRow = {
  id: number;
  num: string;
  status: string;
  extra?: { trackingNumber?: string | null; shipDate?: string | null } | null;
  purchase_items: Array<{
    title: string;
    quantity: string;
    etc?: string | null;
  }>;
};

export type InventoryRow = {
  id: number;
  title: string;
  quantity: string;
  etc?: string | null;
  ebayOrderUrl?: string | null;
  ebayOrderStatus?: string | null;
};

export type DeliveryRow = {
  id: number;
  deliveryNo: string;
  status: string;
  createdAt: string | Date;
  items: Array<{ inventoryId: number; title: string; quantity: number }>;
  cancelledItems?: Array<{ inventoryId: number; quantity: number }>;
};

export function quantityOf(value: unknown) {
  const quantity = Number(value ?? 0);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

export function isDirectComplete(row: DirectSummary) {
  const productsComplete = row.csvProducts.length > 0 && row.csvProducts.every((product) => product.status === "complete");
  return row.manualComplete || row.csvStatus === "complete" || productsComplete ||
    (row.csvOrderQty > 0 && row.deliveredCount >= row.csvOrderQty);
}

export function extractInvoiceNo(value: string | null | undefined) {
  return value?.trim().match(/^(\d+)/)?.[1] ?? null;
}

export function effectiveDeliveryQuantity(row: DeliveryRow) {
  const cancelled = new Map<number, number>();
  for (const item of row.cancelledItems ?? []) {
    cancelled.set(item.inventoryId, (cancelled.get(item.inventoryId) ?? 0) + quantityOf(item.quantity));
  }
  return row.items.reduce((sum, item) => {
    const itemQuantity = quantityOf(item.quantity);
    const cancelledQuantity = Math.min(itemQuantity, cancelled.get(item.inventoryId) ?? 0);
    if (cancelledQuantity > 0) {
      cancelled.set(item.inventoryId, (cancelled.get(item.inventoryId) ?? 0) - cancelledQuantity);
    }
    return sum + itemQuantity - cancelledQuantity;
  }, 0);
}

function jstDateKey(value: string | Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

export function buildOrderMonitorSnapshot(
  directRows: DirectSummary[],
  purchaseRows: PurchaseRow[],
  inventoryRows: InventoryRow[],
  deliveryRows: DeliveryRow[],
  now = new Date(),
) {
  const openDirectRows = directRows.filter((row) => !isDirectComplete(row));
  const directOrdered = openDirectRows.reduce((sum, row) => sum + quantityOf(row.csvOrderQty), 0);
  const directDelivered = openDirectRows.reduce((sum, row) => sum + quantityOf(row.deliveredCount), 0);
  const directOutstanding = openDirectRows.reduce(
    (sum, row) => sum + Math.max(0, quantityOf(row.csvOrderQty) - quantityOf(row.deliveredCount)),
    0,
  );

  const activeEbayRows = inventoryRows.filter((row) =>
    getEbayStockType(row.etc) !== null &&
    normalizeEbayOrderStatus(row.ebayOrderStatus) === "normal" &&
    quantityOf(row.quantity) > 0,
  );
  const ebayOrderRows = activeEbayRows.filter((row) => Boolean(row.ebayOrderUrl?.trim()));
  const ebayOutstanding = ebayOrderRows.reduce((sum, row) => sum + quantityOf(row.quantity), 0);
  const ebayWithoutOrderUrl = activeEbayRows
    .filter((row) => !row.ebayOrderUrl?.trim())
    .reduce((sum, row) => sum + quantityOf(row.quantity), 0);

  const openPurchases = purchaseRows.filter((row) => row.status !== "purchased");
  const awaitingSupplier = openPurchases.filter((row) => !row.extra?.trackingNumber?.trim());
  const supplierShipped = openPurchases.filter((row) => Boolean(row.extra?.trackingNumber?.trim()));
  const purchaseQuantity = (rows: PurchaseRow[]) => rows.reduce(
    (sum, row) => sum + row.purchase_items.reduce((itemSum, item) => itemSum + quantityOf(item.quantity), 0),
    0,
  );

  const today = jstDateKey(now);
  const month = today.slice(0, 7);
  const successfulDeliveries = deliveryRows.filter((row) => row.status === "success");
  const shippedToday = successfulDeliveries
    .filter((row) => jstDateKey(row.createdAt) === today)
    .reduce((sum, row) => sum + effectiveDeliveryQuantity(row), 0);
  const shippedThisMonth = successfulDeliveries
    .filter((row) => jstDateKey(row.createdAt).startsWith(month))
    .reduce((sum, row) => sum + effectiveDeliveryQuantity(row), 0);
  const ebayShippedThisMonth = successfulDeliveries
    .filter((row) => jstDateKey(row.createdAt).startsWith(month) && /^E/i.test(row.deliveryNo.trim()))
    .reduce((sum, row) => sum + effectiveDeliveryQuantity(row), 0);
  const directShippedThisMonth = successfulDeliveries
    .filter((row) => jstDateKey(row.createdAt).startsWith(month) && /^\d/.test(row.deliveryNo.trim()))
    .reduce((sum, row) => sum + effectiveDeliveryQuantity(row), 0);

  return {
    openDirectRows,
    directOrdered,
    directDelivered,
    directOutstanding,
    activeEbayRows,
    ebayOrderRows,
    ebayOutstanding,
    ebayWithoutOrderUrl,
    openPurchases,
    awaitingSupplier,
    supplierShipped,
    purchaseOrderedQuantity: purchaseQuantity(awaitingSupplier),
    supplierShippedQuantity: purchaseQuantity(supplierShipped),
    shippedToday,
    shippedThisMonth,
    ebayShippedThisMonth,
    directShippedThisMonth,
  };
}
