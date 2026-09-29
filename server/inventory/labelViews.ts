import type { InventoryItemLabel } from "../../drizzle/schema";

/** ラベル表示に公開する項目。DB定義から導出し、詳細な検品情報等は含めない。 */
export type InventoryItemLabelView = Pick<InventoryItemLabel, "labelId"> &
  Partial<
    Pick<
      InventoryItemLabel,
      "id" | "status" | "legacyManagementNo" | "localInventoryId"
    >
  >;

export function toInventoryItemLabelView(
  label: InventoryItemLabelView
): InventoryItemLabelView {
  return {
    id: label.id,
    labelId: label.labelId,
    status: label.status,
    legacyManagementNo: label.legacyManagementNo,
    localInventoryId: label.localInventoryId,
  };
}

export function uniqueInventoryItemLabelViews(
  labels: InventoryItemLabelView[]
): InventoryItemLabelView[] {
  const map = new Map<string, InventoryItemLabelView>();
  for (const label of labels) {
    const key = label.labelId?.trim().toUpperCase();
    if (!key) continue;
    const existing = map.get(key);
    if (existing?.localInventoryId && !label.localInventoryId) continue;
    map.set(key, toInventoryItemLabelView(label));
  }
  return Array.from(map.values());
}

export function isReceivedLabelStatus(status: unknown): boolean {
  return ["received", "stocked", "shipped"].includes(
    String(status ?? "")
      .trim()
      .toLowerCase()
  );
}
