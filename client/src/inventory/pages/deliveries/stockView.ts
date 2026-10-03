import { getInventoryDisplayCategory, getManagementNo } from "./display";
import type { InventoryItem } from "./types";

/** カテゴリ別合計金額（在庫数1以上かつ単価ありのみ集計） */
export function calcCategoryTotals(inventories: InventoryItem[] | undefined): Map<string, number> {
    if (!inventories) return new Map<string, number>();
    const totals = new Map<string, number>();
    for (const inv of inventories as InventoryItem[]) {
      if (inv.quantity === null || inv.quantity === undefined) continue;
      const stockQty = parseFloat(inv.quantity ?? "0");
      if (stockQty <= 0) continue;
      const price = inv.purchase_unit_price ?? inv.unit_price ?? 0;
      if (!price) continue;
      const cat = getInventoryDisplayCategory(inv);
      totals.set(cat, (totals.get(cat) ?? 0) + price * stockQty);
    }
    return totals;
}

/** 管理番号から先頭の数字部分を抽出する（例: "371_ルカ_New3DS_8/10" → "371"） */
export function extractPrefixFromManagementNo(etc: string | undefined): string | undefined {
    const managementNo = getManagementNo(etc);
    if (!managementNo) return undefined;
    const match = managementNo.match(/^(\d+)/);
    return match ? match[1] : undefined;
}

/** 販売価格照合に必要なCSV行の形（orderManagement.getCsvData の行と構造互換） */
export interface SellingPriceCsvRow {
  invoiceNo: string;
  productName: string;
  sellingPrice: number | null;
  currency: string;
}

/**
 * 管理番号またはインボイスNoからCSVのユーロ建て販売価格を照合する
 * @param inv 在庫アイテム
 * @param invoiceNoOverride 管理番号がない場合に使用するインボイスNo
 */
export function lookupSellingPrice(
  csvRows: SellingPriceCsvRow[] | undefined,
  inv: InventoryItem,
  invoiceNoOverride?: string,
): { sellingPrice: number | null; currency: string } {
    if (!csvRows || csvRows.length === 0) return { sellingPrice: null, currency: "" };
    // 管理番号からインボイスNoを抽出
    const prefix = extractPrefixFromManagementNo(inv.etc);
    const targetInvoiceNo = prefix ?? invoiceNoOverride;
    if (!targetInvoiceNo) return { sellingPrice: null, currency: "" };
    // 同じインボイスNoのCSV行を絞り込み
    const invoiceRows = csvRows.filter((r) => r.invoiceNo === targetInvoiceNo);
    if (invoiceRows.length === 0) return { sellingPrice: null, currency: "" };
    // 商品名で照合（部分一致: CSVの商品名がinv.titleに含まれるか、またはその逆）
    const titleLower = inv.title.toLowerCase();
    const matched = invoiceRows.find((r) => {
      if (!r.productName) return false;
      const csvNameLower = r.productName.toLowerCase();
      return titleLower.includes(csvNameLower) || csvNameLower.includes(titleLower);
    });
    if (matched && matched.sellingPrice != null) {
      return { sellingPrice: matched.sellingPrice, currency: matched.currency };
    }
    // 部分一致で見つからない場合: 同インボイスの最初の行を使用（フォールバック）
    const first = invoiceRows.find((r) => r.sellingPrice != null);
    if (first) return { sellingPrice: first.sellingPrice, currency: first.currency };
    return { sellingPrice: null, currency: "" };
}
