import type { LocalPurchaseWithLabels as LocalPurchaseRow } from "../db";
import { getInventoryManagementNo } from "../managementNo";

export function historyDateFrom(value: unknown, fallback = new Date()): string {
  const date = value ? new Date(value as string | number | Date) : fallback;
  return Number.isNaN(date.getTime())
    ? fallback.toISOString().slice(0, 10)
    : date.toISOString().slice(0, 10);
}

export function normalizePurchaseHistoryText(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function firstPurchaseHistoryEtcPart(value: unknown): string {
  return normalizePurchaseHistoryText(String(value ?? "").split(",")[0] ?? "");
}

export function positiveHistoryNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function parseLocalPurchaseItems(
  row: LocalPurchaseRow
): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(row.itemsJson ?? "[]");
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Record<string, unknown> =>
            item != null && typeof item === "object"
        )
      : [];
  } catch {
    return [];
  }
}

export function localPurchasePrimaryManagementNo(
  row: Pick<LocalPurchaseRow, "managementNo" | "itemsJson">
): string {
  const direct = getInventoryManagementNo(row.managementNo);
  if (direct) return direct;
  for (const item of parseLocalPurchaseItems(row as LocalPurchaseRow)) {
    const itemManagementNo = getInventoryManagementNo(String(item.etc ?? ""));
    if (itemManagementNo) return itemManagementNo;
  }
  return "";
}
