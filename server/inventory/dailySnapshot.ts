/**
 * 日次在庫スナップショット
 *
 * 月次棚卸しレポートは「今この瞬間の在庫」しか返せず、対象年月を変えても中身は変わらない。
 * そのため過去の月末在庫を後から取り出す手段が無く、6月末の確定に2週間かかっていた。
 *
 * ここでは毎日1回、在庫の姿を monthly_reports へ保存して履歴を残す。
 * 専用テーブルを作らないのは、本番DBのマイグレーションを伴わずに運用へ乗せるため。
 * 月次レポートとは label の接頭辞（[日次] YYYY-MM-DD）で区別する。
 */

import {
  buildDailySnapshotLabel,
  buildSnapshotBreakdown,
  parseDailySnapshotDate,
  todayInJst,
  yearMonthOf,
  type SnapshotBreakdown,
  type SnapshotInventoryRow,
  type SnapshotInvoiceRow,
} from "@shared/inventorySnapshot";
import { createMonthlyReport, getMonthlyReports } from "./db";

export type SnapshotPreviewData = {
  inventorySummary: SnapshotInventoryRow[];
  invoiceList: SnapshotInvoiceRow[];
};

export type CaptureResult =
  | { saved: true; date: string; id: number; breakdown: SnapshotBreakdown }
  | { saved: false; date: string; reason: "already_exists"; breakdown?: undefined };

/** その日のスナップショットが既にあるか調べる */
export async function findSnapshotByDate(date: string) {
  // 日次は1日1件なので、直近200件を見れば十分（月次レポートが混ざっても数件）
  const reports = await getMonthlyReports(200);
  return reports.find((report) => parseDailySnapshotDate(report.label) === date) ?? null;
}

/** 保存済みの日次スナップショットを新しい順で返す */
export async function listDailySnapshots(limit = 120) {
  const reports = await getMonthlyReports(400);
  return reports
    .map((report) => ({ report, date: parseDailySnapshotDate(report.label) }))
    .filter((row): row is { report: (typeof reports)[number]; date: string } => row.date !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, limit);
}

/**
 * 日次スナップショットを1件保存する。
 * 同じ日のものが既にあれば何もしない（cronの再実行・手動実行が重なっても増えない）。
 */
export async function captureDailySnapshot(
  preview: SnapshotPreviewData,
  options: { date?: string; force?: boolean; createdBy?: string | null } = {}
): Promise<CaptureResult> {
  const date = options.date ?? todayInJst();

  if (!options.force) {
    const existing = await findSnapshotByDate(date);
    if (existing) return { saved: false, date, reason: "already_exists" };
  }

  const breakdown = buildSnapshotBreakdown(preview.inventorySummary, preview.invoiceList);

  const id = await createMonthlyReport({
    yearMonth: yearMonthOf(date),
    label: buildDailySnapshotLabel(date),
    inventorySummaryJson: JSON.stringify(preview.inventorySummary),
    invoiceListJson: JSON.stringify(preview.invoiceList),
    createdBy: options.createdBy ?? "daily-snapshot",
  });

  return { saved: true, date, id, breakdown };
}
