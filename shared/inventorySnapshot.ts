/**
 * 日次在庫スナップショットの共通定義
 *
 * 日次スナップショットは monthly_reports テーブルに保存する。
 * 月次レポートと区別するため label に固定の接頭辞を付ける。
 * （専用テーブルを増やさないのは、本番DBへのマイグレーションを伴わずに運用へ乗せるため）
 */

/** 日次スナップショットの label 接頭辞 */
export const DAILY_SNAPSHOT_PREFIX = "[日次] ";

/** JSTの「今日」を YYYY-MM-DD で返す */
export function todayInJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** YYYY-MM-DD → YYYY-MM */
export function yearMonthOf(date: string): string {
  return date.slice(0, 7);
}

/** 日次スナップショットの label を作る */
export function buildDailySnapshotLabel(date: string): string {
  return `${DAILY_SNAPSHOT_PREFIX}${date}`;
}

/** label が日次スナップショットのものか */
export function isDailySnapshotLabel(label?: string | null): boolean {
  return typeof label === "string" && label.startsWith(DAILY_SNAPSHOT_PREFIX);
}

/** 日次スナップショットの label から日付を取り出す（違えば null） */
export function parseDailySnapshotDate(label?: string | null): string | null {
  if (!isDailySnapshotLabel(label)) return null;
  const rest = (label as string).slice(DAILY_SNAPSHOT_PREFIX.length).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(rest) ? rest : null;
}

// ============================================================
// 区分別サマリー
// ============================================================

/** 在庫サマリー1行（monthlyReport.preview の inventorySummary 要素） */
export type SnapshotInventoryRow = {
  category: string;
  managementNo?: string;
  title?: string;
  quantity: number;
  unitPrice: number | null;
  totalValue: number | null;
};

/** インボイス1件（monthlyReport.preview の invoiceList 要素のうち集計に使う部分） */
export type SnapshotInvoiceRow = {
  invoiceNo: string;
  stockItems?: Array<{ inventoryId: number; quantity: number; unitPrice: number | null }>;
  purchaseItems?: Array<{ quantity: number; unitPrice: number | null }>;
};

/** 区分別サマリー。税理士報告で必要な切り分けをそのまま持つ */
export type SnapshotBreakdown = {
  /** 在庫金額の総額 */
  totalAmount: number;
  /** 売り先決定済み（支払済み・未完了インボイスに引き当て済み） */
  assignedAmount: number;
  /** 売り先未定＝税理士報告の本体 */
  unassignedAmount: number;
  /** 発注済み・未到着（在庫金額には含めない別枠） */
  onOrderAmount: number;
  /** 在庫行数（在庫数1以上） */
  rowCount: number;
  /** 在庫点数の合計 */
  itemCount: number;
  /** 単価未設定（0円計上）の行数 */
  zeroPricedRowCount: number;
  /** カテゴリ別の金額 */
  categories: Array<{ category: string; amount: number; rowCount: number; itemCount: number }>;
};

function toAmount(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 在庫サマリーとインボイス一覧から区分別サマリーを組み立てる。
 * サーバー（日次スナップショット）とクライアント（画面表示）の両方から使う。
 */
export function buildSnapshotBreakdown(
  inventorySummary: SnapshotInventoryRow[],
  invoiceList: SnapshotInvoiceRow[]
): SnapshotBreakdown {
  const categoryMap = new Map<string, { amount: number; rowCount: number; itemCount: number }>();
  let totalAmount = 0;
  let itemCount = 0;
  let zeroPricedRowCount = 0;

  for (const row of inventorySummary) {
    const amount = toAmount(row.totalValue);
    const qty = toAmount(row.quantity);
    totalAmount += amount;
    itemCount += qty;
    if (row.unitPrice == null || row.unitPrice === 0) zeroPricedRowCount += 1;

    const key = row.category || "未分類";
    const cur = categoryMap.get(key) ?? { amount: 0, rowCount: 0, itemCount: 0 };
    cur.amount += amount;
    cur.rowCount += 1;
    cur.itemCount += qty;
    categoryMap.set(key, cur);
  }

  // 売り先決定済み: 同じ在庫IDが複数インボイスに現れても二重計上しない
  const countedInventoryIds = new Set<number>();
  let assignedAmount = 0;
  let onOrderAmount = 0;
  for (const invoice of invoiceList) {
    for (const item of invoice.stockItems ?? []) {
      if (countedInventoryIds.has(item.inventoryId)) continue;
      countedInventoryIds.add(item.inventoryId);
      assignedAmount += toAmount(item.unitPrice) * toAmount(item.quantity);
    }
    for (const item of invoice.purchaseItems ?? []) {
      onOrderAmount += toAmount(item.unitPrice) * toAmount(item.quantity);
    }
  }

  return {
    totalAmount,
    assignedAmount,
    unassignedAmount: totalAmount - assignedAmount,
    onOrderAmount,
    rowCount: inventorySummary.length,
    itemCount,
    zeroPricedRowCount,
    categories: Array.from(categoryMap.entries())
      .map(([category, v]) => ({ category, ...v }))
      .sort((a, b) => b.amount - a.amount),
  };
}
