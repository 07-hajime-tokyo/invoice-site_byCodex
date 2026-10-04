import type { LocalPurchase } from "../../../drizzle/schema";

export type PurchaseItemSource = Pick<
  LocalPurchase,
  "itemsJson" | "managementNo" | "localInventoryId" | "quantity"
>;

// 状態・照合用の解釈。空配列も発注行へフォールバックする点は表示用localRows.tsと異なる。
export function getPurchaseItemManagementNo(
  row: PurchaseItemSource,
  item: Record<string, unknown>
): string {
  const direct =
    item.managementNo ?? item.management_no ?? item.legacyManagementNo;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const etc = String(item.etc ?? row.managementNo ?? "").trim();
  return etc.split(",")[0]?.trim() ?? "";
}

export function localPurchaseItems(
  row: PurchaseItemSource
): Record<string, unknown>[] {
  try {
    const parsed = JSON.parse(row.itemsJson ?? "[]");
    if (Array.isArray(parsed) && parsed.length > 0)
      return parsed as Record<string, unknown>[];
  } catch {
    // Malformed legacy JSON falls back to the purchase row fields below.
  }
  return [
    {
      inventory_id: row.localInventoryId,
      inventoryId: row.localInventoryId,
      etc: row.managementNo,
      quantity: row.quantity,
    },
  ];
}
