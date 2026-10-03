import type { CancelledItem, HistoryItem } from "./types";

/** etc フィールドから管理番号を取得する（数字・在庫・ebay始まりのみ） */
export function getManagementNo(etc: string | undefined): string {
  if (!etc) return "";
  const raw = etc.split(",")[0].trim();
  if (/^\d/.test(raw) || /^在庫/.test(raw) || /^ebay/i.test(raw) || /デボン|devon/i.test(raw)) return raw;
  return "";
}

/** etc フィールドから仕入先サイトを取得する（3番目の要素） */
export function getSupplierSite(etc: string | undefined): string {
  if (!etc) return "";
  const parts = etc.split(",");
  return parts[2]?.trim() ?? "";
}

export function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null) return "-";
  return `¥${price.toLocaleString()}`;
}

export function formatDate(date: Date | string) {
  const d = new Date(date);
  return d.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDateShort(dateStr: string) {
  return dateStr.slice(0, 10);
}

export function parseCancelledItems(cancelledItemsJson?: string | null): CancelledItem[] {
  if (!cancelledItemsJson) return [];
  try {
    return JSON.parse(cancelledItemsJson) as CancelledItem[];
  } catch {
    return [];
  }
}

export function getActiveHistoryItems(history: { items: unknown; cancelledItemsJson?: string | null }): HistoryItem[] {
  const cancelledIds = new Set(parseCancelledItems(history.cancelledItemsJson).map((item) => item.inventoryId));
  return ((history.items as HistoryItem[]) ?? []).filter((item) => !cancelledIds.has(item.inventoryId));
}
