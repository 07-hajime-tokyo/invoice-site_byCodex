import type {
  PreviewData,
  InventorySummaryItem,
  InvoiceForReport,
  CostOverrides,
} from "./types";
import { resolveReportCost } from "./model";

export type SavedReportCsvInput = {
  yearMonth: string;
  invoiceListJson?: string | null;
  inventorySummaryJson?: string | null;
};
export type DomesticCsvItem = {
  title: string;
  quantity: number;
  unitPrice: string | number | null;
  supplierName: string | null;
};

function reportRows(
  data: PreviewData,
  grandTotal: number,
  costOverrides: CostOverrides
): string[][] {
  const rows: string[][] = [];

  rows.push(["=== 在庫金額サマリー ===", "", "", "", "", ""]);
  rows.push(["カテゴリ", "管理番号", "商品名", "数量", "仕入単価", "在庫金額"]);
  for (const item of data.inventorySummary) {
    rows.push([
      item.category,
      item.managementNo ?? "",
      item.title,
      String(item.quantity),
      item.unitPrice != null ? String(item.unitPrice) : "",
      item.totalValue != null ? String(item.totalValue) : "",
    ]);
  }
  rows.push(["", "", "", "", "合計", String(grandTotal)]);
  rows.push([]);

  rows.push(["=== 支払い済み・未完了インボイス ===", "", "", "", "", "", ""]);
  rows.push([
    "インボイスNo",
    "取引相手",
    "支払日",
    "商品名",
    "発注数",
    "販売価格",
    "通貨",
    "取引金額",
  ]);
  for (const inv of data.invoiceList) {
    for (const p of inv.products) {
      rows.push([
        inv.invoiceNo,
        inv.partner,
        inv.paymentDate,
        p.name,
        String(p.qty),
        p.sellingPrice != null ? String(p.sellingPrice) : "",
        p.currency,
        p.tradeAmount != null ? String(p.tradeAmount) : "",
      ]);
    }
  }
  rows.push([]);

  rows.push(["=== インボイス別仕入れコスト ===", "", "", "", "", ""]);
  rows.push(["インボイスNo", "種別", "商品名", "数量", "仕入単価", "小計"]);
  for (const inv of data.invoiceList) {
    for (const pi of inv.purchaseItems) {
      const key = `${inv.invoiceNo}__ordered__${pi.zaicoId}`;
      const up = resolveReportCost(key, pi.unitPrice, costOverrides);
      rows.push([
        inv.invoiceNo,
        "発注済み",
        pi.title,
        String(pi.quantity),
        up != null ? String(up) : "",
        up != null ? String(up * pi.quantity) : "",
      ]);
    }
    for (const si of inv.stockItems) {
      const key = `${inv.invoiceNo}__stock__${si.inventoryId}`;
      const up = resolveReportCost(key, si.unitPrice, costOverrides);
      rows.push([
        inv.invoiceNo,
        "在庫",
        si.title,
        String(si.quantity),
        up != null ? String(up) : "",
        up != null ? String(up * si.quantity) : "",
      ]);
    }
  }
  rows.push([]);

  rows.push(["=== 出庫済み商品 ===", "", "", "", "", ""]);
  rows.push([
    "インボイスNo",
    "商品名",
    "出庫数",
    "仕入単価",
    "出庫金額",
    "出庫日",
    "出庫No",
  ]);
  for (const inv of data.invoiceList) {
    for (const di of inv.deliveryItems ?? []) {
      rows.push([
        inv.invoiceNo,
        di.title,
        String(di.quantity),
        di.unitPrice != null ? String(di.unitPrice) : "",
        di.unitPrice != null ? String(di.unitPrice * di.quantity) : "",
        di.deliveredAt,
        di.deliveryNo,
      ]);
    }
  }

  return rows;
}

function encodeCsv(rows: string[][]) {
  const csv = rows
    .map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  return "\uFEFF" + csv;
}

// 保存済みCSVは保存当時の値のみ。プレビューの補完単価・国内卸行を混ぜない。
export function buildSavedReportCsv(report: SavedReportCsvInput) {
  const invList: InvoiceForReport[] = (() => {
    try {
      return JSON.parse(report.invoiceListJson ?? "[]") as InvoiceForReport[];
    } catch {
      return [];
    }
  })();
  const invSummary: InventorySummaryItem[] = (() => {
    try {
      return JSON.parse(
        report.inventorySummaryJson ?? "[]"
      ) as InventorySummaryItem[];
    } catch {
      return [];
    }
  })();

  const savedGrandTotal = invSummary.reduce(
    (sum, item) => sum + (item.totalValue ?? 0),
    0
  );
  return encodeCsv(
    reportRows(
      { inventorySummary: invSummary, invoiceList: invList },
      savedGrandTotal,
      {}
    )
  );
}

export function buildPreviewReportCsv(
  previewData: PreviewData,
  grandTotal: number,
  costOverrides: CostOverrides,
  domesticItemsRaw: DomesticCsvItem[] | undefined,
  domesticItemsTotal: number
) {
  const rows = reportRows(previewData, grandTotal, costOverrides);
  rows.push([]);

  // 国内卸発注商品セクション
  if (domesticItemsRaw && domesticItemsRaw.length > 0) {
    rows.push(["=== 国内卸発注商品 ===", "", "", "", ""]);
    rows.push(["商品名", "数量", "仕入単価", "小計", "仕入先"]);
    for (const item of domesticItemsRaw) {
      const up =
        item.unitPrice != null ? parseFloat(String(item.unitPrice)) : null;
      rows.push([
        item.title,
        String(item.quantity),
        up != null ? String(up) : "",
        up != null ? String(up * item.quantity) : "",
        item.supplierName ?? "",
      ]);
    }
    rows.push(["", "", "小計", String(domesticItemsTotal), ""]);
  }

  return encodeCsv(rows);
}

export function downloadReportCsv(csv: string, yearMonth: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `棚卸しレポート_${yearMonth}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
