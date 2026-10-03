import { detectCarrier } from "@/inventory/lib/tracking";
import { type Purchase } from "./types";
import { CARRIER_OPTIONS } from "./constants";
import { parseEtc } from "./format";

export function buildPurchasesCsv(purchases: Purchase[]): string {
  const rows: string[][] = [
    [
      "発注No",
      "商品名",
      "管理番号",
      "カテゴリ",
      "仕入先",
      "発注日",
      "入庫予定日",
      "入庫日",
      "発送日",
      "追跡番号",
      "配送業者",
      "ステータス",
    ],
  ];
  for (const p of purchases) {
    for (const item of p.purchase_items) {
      const { managementNo, supplierSite } = parseEtc(item.etc);
      const manualCarrier = p.extra?.carrier;
      const autoInfo = p.extra?.trackingNumber
        ? detectCarrier(p.extra.trackingNumber)
        : null;
      const carrierKey =
        manualCarrier && manualCarrier !== "auto"
          ? manualCarrier
          : (autoInfo?.carrier ?? "");
      const carrierName =
        CARRIER_OPTIONS.find(o => o.value === carrierKey)?.label ??
        autoInfo?.carrierName ??
        "";
      rows.push([
        p.num,
        item.title,
        managementNo,
        item.category ?? "",
        supplierSite,
        p.purchase_date ?? "",
        p.estimated_purchase_date ?? "",
        p.status === "purchased" ? (p.purchase_date ?? "") : "",
        p.extra?.shipDate ?? "",
        p.extra?.trackingNumber ?? "",
        carrierName,
        p.status,
      ]);
    }
  }
  const csv = rows
    .map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const bom = "\uFEFF";
  return bom + csv;
}

export function exportPurchasesCSV(purchases: Purchase[]) {
  const blob = new Blob([buildPurchasesCsv(purchases)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `入庫管理_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
