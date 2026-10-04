import type { HistoryItem } from "./types";

/** deliveryNoの先頭数字を抽出（例: "378_luca20260403" → "378"） */
export function extractDeliveryGroup(deliveryNo: string): string {
  const match = deliveryNo.match(/^(\d+)/);
  return match ? match[1] : deliveryNo;
}

export function extractInvoiceNoFromManagementText(value: string | null | undefined): string | null {
  const text = value?.normalize("NFKC").trim();
  if (!text) return null;
  const direct = text.match(/^(?:No\.?\s*)?(\d+)(?=_|[\s,、]|$)/i);
  if (direct) return direct[1];
  const parenthesized = text.match(/[（(]\s*(?:No\.?\s*)?(\d+)(?=_|[\s,、）)]|$)/i);
  if (parenthesized) return parenthesized[1];
  const embedded = text.match(/(?:^|[\s,、])(?:No\.?\s*)?(\d+)(?=_)/i);
  return embedded?.[1] ?? null;
}

export function resolveHistoryGroup(
  history: { deliveryNo: string; items: HistoryItem[] },
  inventoryManagementMap: Map<number, string>
): string {
  const deliveryGroup = extractDeliveryGroup(history.deliveryNo);
  if (deliveryGroup !== history.deliveryNo) return deliveryGroup;

  const prefixes = history.items
    .map((item) => (
      item.managementNo
        ? extractInvoiceNoFromManagementText(item.managementNo)
        : extractInvoiceNoFromManagementText(inventoryManagementMap.get(item.inventoryId))
          ?? extractInvoiceNoFromManagementText(item.title)
    ))
    .filter((prefix): prefix is string => !!prefix);
  const uniquePrefixes = Array.from(new Set(prefixes));
  return uniquePrefixes.length === 1 ? uniquePrefixes[0] : deliveryGroup;
}

export function formatDisplayDeliveryNo(deliveryNo: string, groupKey: string): string {
  if (extractInvoiceNoFromManagementText(deliveryNo)) return deliveryNo;
  return /^\d+$/.test(groupKey) ? `${groupKey}_${deliveryNo}` : deliveryNo;
}
