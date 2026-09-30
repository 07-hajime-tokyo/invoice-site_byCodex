import { getReceiptAckLabel } from "./receiptAck";
import type { PurchaseHistoryItem } from "./types";

/** 入庫履歴CSVエクスポート */
export function exportPurchaseHistoryCSV(items: PurchaseHistoryItem[]) {
  const rows: string[][] = [
    ["管理番号", "商品名", "カテゴリ", "仕入先", "入庫日", "数量", "入庫単価", "入庫金額", "追跡番号", "受取連絡", "担当者", "ステータス"],
  ];
  for (const h of items) {
    const qty = parseFloat(h.quantity ?? "0");
    const unitPrice = h.unitPrice != null && h.unitPrice !== "" ? parseFloat(h.unitPrice) : null;
    const totalValue = unitPrice != null && qty > 0 ? unitPrice * qty : null;
    rows.push([
      h.kanriNo ?? "-",
      h.title,
      h.category ?? "",
      h.supplier ?? "",
      h.purchaseDate,
      h.quantity,
      unitPrice != null ? String(unitPrice) : "-",
      totalValue != null ? String(totalValue) : "-",
      h.trackingNumber ?? "",
      getReceiptAckLabel(h) || "",
      h.operatorName ?? "",
      h.cancelled ? "取り消し済み" : "入庫済み",
    ]);
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `入庫履歴_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
