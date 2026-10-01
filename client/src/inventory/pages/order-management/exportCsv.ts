import type { SummaryItem } from "./types";

/** CSVエクスポート */
export function exportOrderManagementCSV(items: SummaryItem[]) {
  const rows: string[][] = [
    ["インボイスNo", "取引先", "取引データ発注数", "入庫済み数", "出庫済み数", "在庫数", "進捗率"],
  ];
  for (const item of items) {
    const progress = item.csvOrderQty > 0
      ? Math.round((item.deliveredCount / item.csvOrderQty) * 100)
      : 0;
    rows.push([
      item.key,
      item.partner,
      String(item.csvOrderQty),
      String(item.purchasedCount),
      String(item.deliveredCount),
      String(item.stockCount),
      `${progress}%`,
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `発注管理_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
