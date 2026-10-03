import type { InventoryItem } from "./types";
import { getInventoryDisplayCategory, getManagementNo } from "./display";

/** 在庫一覧CSVエクスポート */
export function exportInventoryCSV(inventories: InventoryItem[]) {
  const rows: string[][] = [
    ["管理番号", "商品名", "カテゴリ", "仕入単価", "在庫数", "単位", "入庫日", "在庫金額", "保管場所"],
  ];
  for (const inv of inventories) {
    const managementNo = getManagementNo(inv.etc);
    const cat = getInventoryDisplayCategory(inv);
    const unitPrice = inv.purchase_unit_price ?? inv.unit_price;
    const stockQty = parseFloat(inv.quantity ?? "0");
    const stockValue = unitPrice != null && stockQty > 0 ? unitPrice * stockQty : null;
    rows.push([
      managementNo || "-",
      inv.title,
      cat,
      unitPrice != null ? String(unitPrice) : "-",
      inv.quantity ?? "0",
      inv.unit ?? "",
      inv.last_purchase_date ?? inv.updated_at?.slice(0, 10) ?? "-",
      stockValue != null ? String(stockValue) : "-",
      inv.place ?? "",
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `在庫一覧_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
