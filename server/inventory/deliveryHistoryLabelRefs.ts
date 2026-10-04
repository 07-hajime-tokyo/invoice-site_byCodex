import { normalizeOutboundScan } from "@shared/outboundBoxes";
import type { InventoryItemLabelView } from "./labelViews";

/**
 * 出庫履歴（成功分のみ）からラベルID→出庫履歴IDの対応表を作る。
 * キャンセル済みラベルは除外し、同じラベルは最初に見つかった履歴を優先する。
 */
export function liveDeliveryHistoryLabelIdMap(
  histories: Array<{
    id: number;
    status?: string | null;
    itemsJson?: string | null;
    cancelledItemsJson?: string | null;
  }>,
): Map<string, number> {
  const result = new Map<string, number>();
  for (const history of histories) {
    if (history.status && history.status !== "success") continue;
    const cancelledLabelIds = new Set<string>();
    try {
      const cancelledItems = JSON.parse(history.cancelledItemsJson || "[]");
      if (Array.isArray(cancelledItems)) {
        for (const item of cancelledItems) {
          const labelId = normalizeOutboundScan(item?.labelId ?? "");
          if (labelId) cancelledLabelIds.add(labelId);
        }
      }
    } catch {
      // 古い履歴の不正なJSONは無視して、itemsJson側の情報だけ使う。
    }

    try {
      const items = JSON.parse(history.itemsJson || "[]");
      if (!Array.isArray(items)) continue;
      for (const item of items) {
        const labelId = normalizeOutboundScan(item?.labelId ?? "");
        if (!labelId || cancelledLabelIds.has(labelId)) continue;
        if (!result.has(labelId)) result.set(labelId, history.id);
      }
    } catch {
      // 読めない履歴は表示判定に使わない。
    }
  }
  return result;
}

/** ラベル一覧に deliveryHistoryId を付与する。 */
export function attachDeliveryHistoryRefsToLabels<T extends InventoryItemLabelView>(
  labels: T[] | null | undefined,
  deliveryHistoryByLabelId: Map<string, number>,
): T[] {
  return (labels ?? []).map((label) => ({
    ...label,
    deliveryHistoryId: deliveryHistoryByLabelId.get(normalizeOutboundScan(label.labelId)) ?? null,
  }));
}

/** 在庫ID→ラベル一覧のMap全体に deliveryHistoryId を付与する。 */
export function attachDeliveryHistoryRefsToLabelMap<T extends InventoryItemLabelView>(
  labelMap: Map<number, T[]>,
  deliveryHistoryByLabelId: Map<string, number>,
): Map<number, T[]> {
  return new Map(
    Array.from(labelMap.entries()).map(([inventoryId, labels]) => [
      inventoryId,
      attachDeliveryHistoryRefsToLabels(labels, deliveryHistoryByLabelId),
    ]),
  );
}
