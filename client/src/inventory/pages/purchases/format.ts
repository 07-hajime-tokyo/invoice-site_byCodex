import { type PurchaseItem, type Purchase } from "./types";

export function cleanManagementNo(value?: string | null): string {
  const firstPart = (value ?? "").split(",")[0]?.trim() ?? "";
  return firstPart.split(/\s+\/\s+/)[0]?.trim() ?? firstPart;
}

export function parseEtc(etc?: string | null): {
  managementNo: string;
  supplierSite: string;
} {
  if (!etc) return { managementNo: "", supplierSite: "" };
  const parts = etc.split(",").map(p => p.trim());
  return {
    managementNo: cleanManagementNo(parts[0]),
    supplierSite: parts[2] ?? "",
  };
}

export function getPurchaseItemLabelIds(item: PurchaseItem): string[] {
  return (item.itemLabels ?? []).map(label => label.labelId).filter(Boolean);
}

export function hasUnitPrice(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function formatUnitPrice(value: unknown): string {
  return hasUnitPrice(value) ? `¥${Number(value).toLocaleString()}` : "-";
}

export const statusLabel: Record<string, string> = {
  none: "なし",
  not_ordered: "発注前",
  ordered: "発注済み",
  shipped: "発送済み / 入庫待ち",
  purchased: "入庫済み",
  quotation_requested: "見積依頼済み",
};

export function getStatusClass(purchase: Purchase): string {
  const effectiveStatus =
    purchase.status !== "purchased" && purchase.extra?.trackingNumber
      ? "shipped"
      : purchase.status;
  switch (effectiveStatus) {
    case "not_ordered":
      return "bg-muted text-muted-foreground border border-border";
    case "ordered":
      return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
    case "shipped":
      return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300";
    case "purchased":
      return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
    case "quotation_requested":
      return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export function getEffectiveStatusLabel(purchase: Purchase): string {
  if (purchase.status !== "purchased" && purchase.extra?.trackingNumber)
    return statusLabel["shipped"];
  return statusLabel[purchase.status] ?? purchase.status;
}
