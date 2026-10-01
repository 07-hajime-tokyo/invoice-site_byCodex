import { isShippableLabelStatus } from "./labelMerging";
import { unique } from "./stringValues";
import { EBAY_GROUP_KEY, parseInvoiceFromManagementNo, isEbayManagementNo, invoiceNoFromGroupKey } from "./invoiceIdentity";
import { normalizedLabelStatus } from "./rowStatus";
import type { LabelView, ShippingItemView, AllocationGroup } from "./viewTypes";
import { type HistoryItem } from "@/inventory/pages/DeliveryHistory";
import { SHIPMENT_SHEET_NAMES, type ShipmentSheetName } from "@shared/outboundBoxes";
import { invoiceNoFromManagementNo } from "@shared/invoiceKey";

export const INVENTORY_LABEL_GROUP_KEY = "inventory-stock-labels";

export { SHIPMENT_SHEET_NAMES, type ShipmentSheetName };

export function todayCompact(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
}

export function todayShortCompact(): string {
  const compact = todayCompact();
  return `${compact.slice(2, 4)}${compact.slice(4)}`;
}

export function todayShipmentDate(): string {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}`;
}

export function deliveryPartnerCode(group: AllocationGroup | null): string {
  const text = `${group?.partner ?? ""} ${group?.label ?? ""}`.normalize("NFKC").toLowerCase();
  if (text.includes("maxim") || text.includes("マキシム")) return "Maxim";
  if (text.includes("samee") || text.includes("sami") || text.includes("sammy") || text.includes("サミー")) return "samee";
  if (text.includes("simon") || text.includes("サイモン")) return "Simon";
  if (text.includes("nele") || text.includes("ネレ")) return "Nele";
  if (text.includes("devon") || text.includes("デボン")) return "devon";
  if (text.includes("luca") || text.includes("ルカ")) return "luca";
  if (text.includes("ebay")) return "ebay";
  const ascii = text.match(/[a-z0-9]+/g)?.join("") ?? "";
  return ascii || "stock";
}

export function generatePurchaseRegistrationDeliveryNo(group: AllocationGroup | null, invoiceNoOverride?: string | null): string {
  const invoiceNo = invoiceNoOverride || invoiceNoFromGroupKey(group?.key);
  const code = deliveryPartnerCode(group);
  const datePart = ["Maxim", "Simon", "Nele"].includes(code) ? todayShortCompact() : todayCompact();
  const deliveryNo = `${code}${datePart}`;
  return invoiceNo ? `${invoiceNo}_${deliveryNo}` : `stock_${deliveryNo}`;
}

export function commonInvoiceNoFromShippingItems(items: Array<Pick<ShippingItemView, "legacyManagementNo">>): string | null {
  const invoiceNos = unique(
    items
      .map((item) => parseInvoiceFromManagementNo(item.legacyManagementNo)?.invoiceNo ?? "")
      .filter(Boolean),
  );
  return invoiceNos.length === 1 ? invoiceNos[0] : null;
}

export function detectShipmentSheetNameForText(text: string | null | undefined): ShipmentSheetName | null {
  const haystack = text?.normalize("NFKC").toLowerCase() ?? "";
  if (!haystack) return null;
  if (haystack.includes("devon") || haystack.includes("デボン")) return "デボン発送管理";
  if (haystack.includes("simon") || haystack.includes("サイモン")) return "サイモン発送管理";
  if (haystack.includes("nele") || haystack.includes("ネレ")) return "ネレ発送管理";
  if (haystack.includes("samee") || haystack.includes("sami") || haystack.includes("sammy") || haystack.includes("サミー")) return "サミー発送管理";
  if (haystack.includes("maxim") || haystack.includes("マキシム") || haystack.includes("luca") || haystack.includes("ルカ")) return "独発送管理";
  return null;
}

export function detectShipmentSheetNameForGroup(
  group: AllocationGroup | null,
  items: Array<Pick<ShippingItemView, "legacyManagementNo" | "title">>,
): ShipmentSheetName {
  return (
    detectShipmentSheetNameForText(group?.partner) ??
    detectShipmentSheetNameForText(group?.label) ??
    items.map((item) => detectShipmentSheetNameForText(`${item.legacyManagementNo} ${item.title}`)).find(Boolean) ??
    "独発送管理"
  );
}

export function isShippableLabel(label: LabelView): boolean {
  return Boolean(label.labelId.trim()) && isShippableLabelStatus(label.rawStatus);
}

export function groupKeyFromLabel(label: LabelView): string {
  const parsed = parseInvoiceFromManagementNo(label.legacyManagementNo);
  if (!parsed && isEbayManagementNo(label.legacyManagementNo)) return EBAY_GROUP_KEY;
  return parsed ? `invoice-${parsed.invoiceNo}` : INVENTORY_LABEL_GROUP_KEY;
}

export function invoiceOptionByNo(invoiceOptions: AllocationGroup[], invoiceNo: string | null | undefined): AllocationGroup | null {
  if (!invoiceNo) return null;
  return invoiceOptions.find((option) => invoiceNoFromGroupKey(option.key) === invoiceNo) ?? null;
}

export function invoiceDisplayLabel(invoiceOptions: AllocationGroup[], invoiceNo: string | null | undefined): string {
  if (!invoiceNo) return "未設定";
  const option = invoiceOptionByNo(invoiceOptions, invoiceNo);
  const partner = option?.partner?.trim();
  return partner ? `No.${invoiceNo} ${partner}` : `No.${invoiceNo}`;
}

export function labelTargetInvoiceNo(input: { assignedInvoiceNo?: string | null; legacyManagementNo?: string | null }): string | null {
  return input.assignedInvoiceNo?.trim() || invoiceNoFromManagementNo(input.legacyManagementNo);
}

export function labelTargetShipmentSheetName(
  input: { assignedInvoiceNo?: string | null; legacyManagementNo?: string | null },
  invoiceOptions: AllocationGroup[],
): ShipmentSheetName | null {
  const invoiceNo = labelTargetInvoiceNo(input);
  const option = invoiceOptionByNo(invoiceOptions, invoiceNo);
  return detectShipmentSheetNameForText(option?.partner) ?? detectShipmentSheetNameForText(option?.label);
}

export function buildShippingItemsFromLabels(labels: LabelView[]): ShippingItemView[] {
  const used = new Set<string>();
  return labels.flatMap((label) => {
    const inventoryId = Number(label.inventoryId);
    const labelId = label.labelId.trim().toUpperCase();
    const canShip = isShippableLabelStatus(label.rawStatus);
    const isShipped = normalizedLabelStatus(label.rawStatus) === "shipped";
    if (!labelId || !Number.isFinite(inventoryId) || inventoryId <= 0 || (!canShip && !isShipped)) {
      return [];
    }
    const key = `${inventoryId}-${labelId}`;
    if (used.has(key)) return [];
    used.add(key);
    return [{
      key,
      inventoryId,
      labelId,
      rawStatus: label.rawStatus,
      status: label.status,
      canShip,
      title: label.title,
      legacyManagementNo: label.legacyManagementNo,
      assignedInvoiceNo: label.assignedInvoiceNo ?? null,
      allocationLabel: label.allocationLabel,
      unitPrice: label.unitPrice,
      supplier: label.supplier,
      quantity: 1,
      maxQuantity: 1,
    }];
  });
}

export function selectedShippingItems(
  items: ShippingItemView[],
  keys: Set<string>,
  quantities: Record<string, number>,
): ShippingItemView[] {
  return items
    .filter((item) => item.canShip && keys.has(item.key))
    .map((item) => {
      const quantity = Math.min(item.maxQuantity, Math.max(1, Math.floor(quantities[item.key] ?? item.quantity)));
      return { ...item, quantity };
    });
}

export function historyItemsToFedexItems(
  items: HistoryItem[],
): Array<{ productNameJa: string; productNameEn: string; quantity: number; managementNo?: string | null }> {
  return items
    .map((item) => ({
      productNameJa: item.title,
      productNameEn: item.title,
      quantity: Math.max(0, Math.floor(Number(item.quantity))),
      managementNo: item.managementNo ?? null,
    }))
    .filter((item) => item.quantity > 0);
}
