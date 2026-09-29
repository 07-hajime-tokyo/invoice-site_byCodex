import type { PurchaseRow } from "./dataTypes";
import type { StockItemView } from "./viewTypes";
import { cleanLegacyManagementNo } from "@shared/purchaseMetadata";
import { parseInvoiceFromManagementNo } from "./invoiceIdentity";
import { getManagementNos } from "./managementNumbers";
import { hasAnyProductText } from "./productText";
import { stockModelName } from "./productPresentation";
import { purchaseRowStatusKind } from "./rowStatus";

export function normalizeStockProposalTitle(title: string): string {
  let normalizedTitle = title.replace(/^登録漏れ\s*/u, "").replace(/\s+/g, " ").trim();
  if (!normalizedTitle) return "-";
  normalizedTitle = normalizedTitle.replace(/\b(?:ps\s*)?vita\s*1[01]00\b/gi, "Vita 1000");
  normalizedTitle = normalizedTitle.replace(/\bnew\s*3ds\s*(?:ll|xl)\b/gi, "New 3DS LL");
  normalizedTitle = normalizedTitle.replace(/\b3ds\s*(?:ll|xl)\b/gi, "3DS LL");
  return normalizedTitle;
}

export function stockProposalModelName(title: string, category?: string | null): string {
  const fromTitle = stockModelName(title);
  if (fromTitle !== "その他") return fromTitle;
  const fromCategory = stockModelName(category ?? "");
  return fromCategory !== "その他" ? fromCategory : "その他";
}

export const STOCK_PROPOSAL_EXCLUDED_MANAGEMENT_PREFIXES = ["403_ネレ"];

export const STOCK_PROPOSAL_ACCESSORY_KEYWORDS = [
  "付属品",
  "アクセサリ",
  "アクセサリー",
  "ケーブル",
  "コード",
  "バッテリー",
  "タッチペン",
  "充電器",
  "充電ケーブル",
  "usbケーブル",
  "acアダプタ",
  "acアダプター",
  "アダプタ",
  "アダプター",
  "電源",
  "ケース",
  "ポーチ",
  "カバー",
  "メモリーカード",
  "メモリースティック",
  "sdカード",
];

export const STOCK_BODY_KEYWORDS = [
  "本体",
  "本体のみ",
  "console",
  "unit",
  "body",
];

export function isExcludedStockProposalManagementNo(managementNo?: string | null): boolean {
  const normalized = (managementNo ?? "").trim();
  return STOCK_PROPOSAL_EXCLUDED_MANAGEMENT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

export function isUnfinishedInvoiceManagementNo(managementNo: string | null | undefined, unfinishedInvoiceNos: Set<string>): boolean {
  const parsed = parseInvoiceFromManagementNo(cleanLegacyManagementNo(managementNo ?? ""));
  return parsed ? unfinishedInvoiceNos.has(parsed.invoiceNo) : false;
}

export function isStockProposalAccessory(title: string, category?: string | null): boolean {
  const text = `${title} ${category ?? ""}`;
  if (!hasAnyProductText(text, STOCK_PROPOSAL_ACCESSORY_KEYWORDS)) return false;
  return !hasAnyProductText(title, STOCK_BODY_KEYWORDS);
}

export function isFulfillmentStockItem(item: StockItemView): boolean {
  return !isStockProposalAccessory(item.title, item.category);
}

export function isStockWaitingPurchaseRow(row: PurchaseRow, unfinishedInvoiceNos: Set<string>): boolean {
  const kind = purchaseRowStatusKind(row);
  if (kind !== "ordered" && kind !== "inbound_shipped") return false;
  return getManagementNos(row.purchase_items).some((managementNo) => {
    const normalized = managementNo.trim();
    if (isUnfinishedInvoiceManagementNo(normalized, unfinishedInvoiceNos)) return false;
    return normalized.startsWith("在庫") && !isExcludedStockProposalManagementNo(normalized);
  });
}
