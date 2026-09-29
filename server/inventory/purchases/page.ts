import type { InboundClass } from "@shared/inboundPipeline";
import {
  getEffectivePurchaseStatus,
  isInboundActivePurchase,
  isInboundCutoffVisible,
  isPurchaseInboundComplete,
  type InboundPurchaseState,
} from "@shared/purchaseVisibility";
import type { PurchasePageInput } from "./input";

/** 集計に必要な行の形。元の行にある他の情報はジェネリックで維持する。 */
export type PurchasePageRow = InboundPurchaseState & {
  num?: string | null;
  csvSupplierName?: string | null;
  purchase_items: Array<{
    title?: string | null;
    quantity?: string | number | null;
    unit_price?: string | number | null;
    etc?: string | null;
    category?: string | null;
    itemLabels?: Array<{ labelId: string }>;
  }>;
};

function purchaseRowMatchesSearch(row: PurchasePageRow, rawSearch: string) {
  const search = rawSearch.trim().toLowerCase();
  if (!search) return true;
  const haystack = [
    row.num,
    row.csvSupplierName,
    row.extra?.trackingNumber,
    ...row.purchase_items.flatMap(item => {
      const etc = item.etc ?? "";
      const parts = etc.split(",").map(part => part.trim());
      return [
        item.title,
        etc,
        parts[0],
        parts[2],
        ...(item.itemLabels ?? []).map(label => label.labelId),
      ];
    }),
  ]
    .filter(
      (value): value is string => typeof value === "string" && value.length > 0
    )
    .join("\n")
    .toLowerCase();
  return haystack.includes(search);
}

function summarizePurchaseRows(rows: PurchasePageRow[]) {
  const totals = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const seenCategories = new Set<string>();
    for (const item of row.purchase_items) {
      const category = item.category || "未分類";
      const price = Number(item.unit_price) || 0;
      const qty = Number(item.quantity) || 0;
      if (price) {
        const current = totals.get(category) ?? { total: 0, count: 0 };
        current.total += price * qty;
        totals.set(category, current);
      } else if (!totals.has(category)) {
        totals.set(category, { total: 0, count: 0 });
      }
      seenCategories.add(category);
    }
    seenCategories.forEach(category => {
      const current = totals.get(category) ?? { total: 0, count: 0 };
      current.count += 1;
      totals.set(category, current);
    });
  }
  const categoryTotals = Array.from(totals.entries())
    .map(([category, value]) => ({
      category,
      total: value.total,
      count: value.count,
    }))
    .sort(
      (a, b) => b.total - a.total || a.category.localeCompare(b.category, "ja")
    );
  return {
    categoryTotals,
    grandTotal: categoryTotals.reduce((sum, row) => sum + row.total, 0),
  };
}

/** T22: 行が指定タブ（分類）に属するか。"unclassified"=未仕訳(null) */
function rowMatchesInboundTab(
  row: PurchasePageRow,
  tab: InboundClass | "unclassified"
): boolean {
  const cls = row.inboundClass ?? null;
  if (tab === "unclassified") return cls == null;
  return cls === tab;
}

/**
 * T22: 分類ごとの「未完了件数」を集計する（タブ見出しバッジ用）。
 * 未仕訳(unclassified) と 4分類 のカウントを返す。
 */
function countInboundTabs(rows: PurchasePageRow[]) {
  const counts: Record<string, number> = {
    unclassified: 0,
    ebay: 0,
    oregon: 0,
    direct: 0,
    domestic: 0,
  };
  for (const row of rows) {
    if (isPurchaseInboundComplete(row)) continue; // バッジは未完了のみ数える
    const cls = row.inboundClass ?? null;
    const key = cls == null ? "unclassified" : cls;
    if (key in counts) counts[key] += 1;
  }
  return counts;
}

export function buildPurchasePageResponse<T extends PurchasePageRow>(
  rows: T[],
  input?: PurchasePageInput
) {
  const pageSize = Math.min(Math.max(input?.pageSize ?? 20, 1), 100);
  const requestedPage = Math.max(input?.page ?? 1, 1);
  const category = input?.category?.trim();
  const search = input?.search?.trim() ?? "";
  const status = input?.status ?? null;
  const inboundTab = input?.inboundClass ?? null;
  const showCompleted = input?.showCompleted ?? false;

  // T22: 完了行も消さずに残す（タブ内でグレー表示）。全行を基点にフィルタする。
  const baseRows = rows.filter(
    row =>
      isInboundActivePurchase(row) &&
      (showCompleted || !isPurchaseInboundComplete(row))
  );
  let filteredRows: T[] = baseRows;

  // 分類タブフィルタ（指定時のみ）
  if (inboundTab) {
    filteredRows = filteredRows.filter(row =>
      rowMatchesInboundTab(row, inboundTab)
    );
  }
  if (category && category !== "すべて") {
    filteredRows = filteredRows.filter(row =>
      row.purchase_items.some(item => (item.category || "未分類") === category)
    );
  }
  // 旧status(ordered/shipped)フィルタは後方互換で維持（タブ運用時はクライアントが送らない）
  if (status) {
    filteredRows = filteredRows.filter(
      row => getEffectivePurchaseStatus(row) === status
    );
  }
  if (search) {
    // 商品ID・管理番号・追跡番号で探すときは、入庫済みや完了済みの発注も対象にする。
    // 探しているものが一覧から落ちていて「検索しても出てこない」となるのを防ぐため。
    const searchBase = rows.filter(isInboundCutoffVisible);
    filteredRows = searchBase.filter(row =>
      purchaseRowMatchesSearch(row, search)
    );
  }

  // 未完了を上、完了を下に（作業対象を主役の位置へ）。同群内は元順維持。
  const ordered = [
    ...filteredRows.filter(row => !isPurchaseInboundComplete(row)),
    ...filteredRows.filter(row => isPurchaseInboundComplete(row)),
  ];

  const totalCount = ordered.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const page = Math.min(requestedPage, totalPages);
  const start = totalCount === 0 ? 0 : (page - 1) * pageSize;
  const items = ordered.slice(start, start + pageSize);
  // カテゴリ合計サマリーは従来どおり未完了(=purchased未満)ベースで算出
  const summary = summarizePurchaseRows(baseRows);
  const tabCounts = countInboundTabs(rows.filter(isInboundActivePurchase));

  return {
    items,
    page,
    pageSize,
    totalCount,
    totalPages,
    allCount: baseRows.length,
    tabCounts,
    ...summary,
  };
}
