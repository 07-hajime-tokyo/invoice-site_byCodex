import { cleanLegacyManagementNo, parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { extractManagementHints } from "@shared/productMatching";
import type { PurchaseItem } from "./dataTypes";

export function normalizeManagementNoForDisplay(value: string): string {
  return cleanLegacyManagementNo(value).normalize("NFKC").trim().toLowerCase();
}

export function isStockManagementNoSuffixAlias(value: string, candidates: string[]): boolean {
  const normalized = normalizeManagementNoForDisplay(value);
  if (!normalized || normalized.startsWith("在庫")) return false;
  return candidates.some((candidate) => {
    const other = normalizeManagementNoForDisplay(candidate);
    return other !== normalized && other.startsWith("在庫") && other.endsWith(normalized);
  });
}

export function uniqueManagementNos(values: string[]): string[] {
  const cleaned = values.map(cleanLegacyManagementNo).filter(Boolean);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of cleaned) {
    const key = normalizeManagementNoForDisplay(value);
    if (!key || seen.has(key) || isStockManagementNoSuffixAlias(value, cleaned)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

export function preferredManagementNo(currentManagementNo?: string | null, labelManagementNo?: string | null, fallback = "-"): string {
  return cleanLegacyManagementNo(currentManagementNo ?? "") || cleanLegacyManagementNo(labelManagementNo ?? "") || fallback;
}

export function getManagementNos(items: PurchaseItem[]): string[] {
  return uniqueManagementNos(
    items.flatMap((item) => {
      const parsed = parseEtc(item.etc);
      const labelNos = parsed.managementNo
        ? []
        : (item.itemLabels ?? []).map((label) => label.legacyManagementNo ?? "");
      return [parsed.managementNo, ...extractManagementHints(item.etc, parsed.managementNo, ...labelNos), ...labelNos];
    }),
  );
}
