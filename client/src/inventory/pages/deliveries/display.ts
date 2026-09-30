import type { InventoryItem } from "./types";

/** 入庫日または最終更新日からの経過日数を返す */
export function normalizeInventoryCategoryName(category?: string | null, title?: string | null): string {
  const raw = (category ?? "").trim();
  const compact = `${raw} ${title ?? ""}`.normalize("NFKC").toLowerCase().replace(/[\s\u3000_-]+/g, "");
  if (
    compact.includes("vita1000") ||
    compact.includes("psvita1000") ||
    compact.includes("pch1000") ||
    compact.includes("vita1100") ||
    compact.includes("psvita1100") ||
    compact.includes("pch1100")
  ) {
    return "Vita1000";
  }
  return raw || "未分類";
}

export function getInventoryDisplayCategory(inv: InventoryItem): string {
  return normalizeInventoryCategoryName(inv.categories?.[0] ?? inv.category, inv.title);
}

export function calcDaysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/** 経過日数に応じたバッジの色を返す */
export function daysBadgeClass(days: number): string {
  if (days <= 14) return "bg-green-100 text-green-800 border-green-200";
  if (days <= 30) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (days <= 60) return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-red-100 text-red-800 border-red-200";
}

export function formatPrice(price: number | undefined | null): string {
  if (price === undefined || price === null || !Number.isFinite(price)) return "-";
  return `¥${price.toLocaleString()}`;
}

/** etc フィールドから管理番号を取得する（数字・在庫・ebay始まりのみ表示） */
export function getManagementNo(etc: string | undefined): string {
  if (!etc) return "";
  // カンマ区切りまたはスペース区切りの先頭部分を管理番号として取得
  const firstPart = etc.split(",")[0].trim();
  const raw = firstPart.split(" ")[0].trim();
  if (/^\d/.test(raw) || /^在庫/.test(raw) || /^ebay/i.test(raw) || /^E/i.test(raw) || /^シャフト/i.test(raw)) return raw;
  return "";
}

export function getInventoryLabelIds(inv: InventoryItem): string[] {
  return (inv.itemLabels ?? []).map((label) => label.labelId).filter(Boolean);
}
