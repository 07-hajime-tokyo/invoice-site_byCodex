import type { CancelledItem, HistoryItem } from "./types";
import { formatDate } from "./display";

/** CSV エクスポート */
export function exportCSV(
  histories: Array<{
    deliveryNo: string;
    status: string;
    createdAt: Date | string;
    items: HistoryItem[];
    deletedInventoryIds: number[];
    cancelledItems: CancelledItem[];
  }>,
  fedexMap?: Map<string, Array<{ shippingDate: string; trackingNumber: string; sheetName: string }>>
) {
  const rows: string[][] = [
    ["出庫No", "ステータス", "出庫日時", "商品名", "数量", "削除済み", "取り消し済み", "FedEx発送日", "FedEx追跡番号", "シート名"],
  ];
  for (const h of histories) {
    // deliveryNoのグループキー（インボイスNo部分）を取得
    const groupKey = h.deliveryNo.includes("_") ? h.deliveryNo.split("_")[0] : h.deliveryNo;
    const shipments = fedexMap?.get(groupKey) ?? fedexMap?.get(h.deliveryNo) ?? [];
    const shippingDateStr = shipments.map((s) => s.shippingDate).join(" / ");
    const trackingNumberStr = shipments.map((s) => s.trackingNumber).join(" / ");
    const sheetNameStr = shipments.map((s) => s.sheetName).join(" / ");
    for (const item of h.items) {
      const isDeleted = h.deletedInventoryIds.includes(item.inventoryId);
      const cancelledItem = h.cancelledItems.find((c) => c.inventoryId === item.inventoryId);
      rows.push([
        h.deliveryNo,
        h.status === "success" ? "成功" : "エラー",
        formatDate(h.createdAt),
        item.title,
        String(item.quantity),
        isDeleted ? "削除済み" : "",
        cancelledItem ? formatDate(cancelledItem.cancelledAt) : "",
        shippingDateStr,
        trackingNumberStr,
        sheetNameStr,
      ]);
    }
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `出庫履歴_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
