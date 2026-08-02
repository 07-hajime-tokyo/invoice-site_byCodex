import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RefreshCw, TrendingUp, History, ArrowDown, ArrowUp, Search } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";

function fmt(n: number | null | undefined): string {
  if (n == null) return "-";
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

function fmtDateTime(value: unknown): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const CHANGE_TYPE_LABELS: Record<string, string> = {
  created: "新規登録",
  updated: "変更",
  deleted: "削除",
  increase: "在庫増",
  decrease: "在庫減",
  set: "在庫数の修正",
};

export default function InventoryTrend() {
  const [keyword, setKeyword] = useState("");

  const {
    data: snapshots = [],
    isLoading: snapshotsLoading,
    refetch: refetchSnapshots,
  } = trpc.inventory.snapshot.list.useQuery({ limit: 120 });

  const {
    data: changeLogs = [],
    isLoading: logsLoading,
    refetch: refetchLogs,
  } = trpc.inventory.inventoryMemo.listAll.useQuery({ limit: 500 });

  /** グラフは古い順に並べる */
  const chartData = useMemo(() => {
    return snapshots
      .filter((row) => row.breakdown != null)
      .map((row) => ({
        date: row.date.slice(5),
        売り先未定: Math.round(row.breakdown!.unassignedAmount),
        売り先決定済み: Math.round(row.breakdown!.assignedAmount),
        合計: Math.round(row.breakdown!.totalAmount),
      }))
      .reverse();
  }, [snapshots]);

  /** 前日との差分を付けた表 */
  const tableRows = useMemo(() => {
    return snapshots.map((row, index) => {
      const prev = snapshots[index + 1];
      const total = row.breakdown?.totalAmount ?? null;
      const prevTotal = prev?.breakdown?.totalAmount ?? null;
      const delta = total != null && prevTotal != null ? total - prevTotal : null;
      return { ...row, delta };
    });
  }, [snapshots]);

  const filteredLogs = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return changeLogs;
    return changeLogs.filter((log) =>
      [log.title, log.memo, log.operatorName, log.changeType]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [changeLogs, keyword]);

  return (
    <div className="space-y-4 p-4">
      {/* ========== 日次の在庫金額推移 ========== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <TrendingUp className="h-4 w-4 text-emerald-500" />
            在庫金額の推移（日次スナップショット）
            <Badge variant="secondary">{snapshots.length}日分</Badge>
            <span className="text-xs font-normal text-muted-foreground">
              毎日23:50 JSTに自動保存されます
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-8"
              onClick={() => refetchSnapshots()}
              disabled={snapshotsLoading}
            >
              <RefreshCw className={`h-4 w-4 ${snapshotsLoading ? "animate-spin" : ""}`} />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {snapshots.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              まだスナップショットがありません。月次棚卸し画面の「今日のスナップショットを保存」から手動で作るか、
              翌日の自動保存をお待ちください。
            </p>
          ) : (
            <>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      width={70}
                      tickFormatter={(v: number) => `${Math.round(v / 10000)}万`}
                    />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="合計" stroke="#64748b" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="売り先未定" stroke="#10b981" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="売り先決定済み" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-xs text-muted-foreground">
                      <th className="py-2 px-2 text-left">日付</th>
                      <th className="py-2 px-2 text-right">売り先未定</th>
                      <th className="py-2 px-2 text-right">売り先決定済み</th>
                      <th className="py-2 px-2 text-right">合計</th>
                      <th className="py-2 px-2 text-right">前日差</th>
                      <th className="py-2 px-2 text-right">行/点</th>
                      <th className="py-2 px-2 text-left">保存者</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((row) => (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-1.5 px-2 tabular-nums">{row.date}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums font-medium text-emerald-600 dark:text-emerald-400">
                          {fmt(row.breakdown?.unassignedAmount)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {fmt(row.breakdown?.assignedAmount)}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{fmt(row.breakdown?.totalAmount)}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">
                          {row.delta == null ? (
                            "-"
                          ) : (
                            <span
                              className={
                                row.delta > 0
                                  ? "text-emerald-600 dark:text-emerald-400"
                                  : row.delta < 0
                                    ? "text-rose-600 dark:text-rose-400"
                                    : "text-muted-foreground"
                              }
                            >
                              {row.delta > 0 ? "+" : ""}
                              {fmt(row.delta)}
                            </span>
                          )}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-xs text-muted-foreground">
                          {row.breakdown ? `${row.breakdown.rowCount} / ${row.breakdown.itemCount}` : "-"}
                        </td>
                        <td className="py-1.5 px-2 text-xs text-muted-foreground">{row.createdBy ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ========== 在庫変動履歴 ========== */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <History className="h-4 w-4 text-violet-500" />
            在庫変動履歴
            <Badge variant="secondary">{filteredLogs.length}件</Badge>
            <span className="text-xs font-normal text-muted-foreground">
              新規登録・変更・削除がすべて残ります
            </span>
            <div className="ml-auto flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="商品名・内容で絞り込み"
                  className="h-8 w-56 pl-7 text-xs"
                />
              </div>
              <Button size="sm" variant="ghost" className="h-8" onClick={() => refetchLogs()} disabled={logsLoading}>
                <RefreshCw className={`h-4 w-4 ${logsLoading ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredLogs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">履歴がありません。</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 px-2 text-left">日時</th>
                    <th className="py-2 px-2 text-left">種類</th>
                    <th className="py-2 px-2 text-left">商品名</th>
                    <th className="py-2 px-2 text-right">在庫数</th>
                    <th className="py-2 px-2 text-left">内容</th>
                    <th className="py-2 px-2 text-left">操作者</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map((log) => (
                    <tr key={log.id} className="border-b last:border-0 align-top">
                      <td className="whitespace-nowrap py-1.5 px-2 text-xs tabular-nums text-muted-foreground">
                        {fmtDateTime(log.createdAt)}
                      </td>
                      <td className="whitespace-nowrap py-1.5 px-2 text-xs">
                        <Badge variant="outline" className="font-normal">
                          {CHANGE_TYPE_LABELS[log.changeType] ?? log.changeType}
                        </Badge>
                      </td>
                      <td className="py-1.5 px-2">{log.title ?? "-"}</td>
                      <td className="whitespace-nowrap py-1.5 px-2 text-right tabular-nums">
                        {log.quantityBefore == null && log.quantityAfter == null ? (
                          "-"
                        ) : (
                          <span className="inline-flex items-center gap-1">
                            {log.quantityBefore ?? "-"}
                            <span className="text-muted-foreground">→</span>
                            {log.quantityAfter ?? "-"}
                            {log.quantityDelta != null && log.quantityDelta !== 0 && (
                              <span
                                className={
                                  log.quantityDelta > 0
                                    ? "text-emerald-600 dark:text-emerald-400"
                                    : "text-rose-600 dark:text-rose-400"
                                }
                              >
                                {log.quantityDelta > 0 ? (
                                  <ArrowUp className="inline h-3 w-3" />
                                ) : (
                                  <ArrowDown className="inline h-3 w-3" />
                                )}
                                {Math.abs(log.quantityDelta)}
                              </span>
                            )}
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-xs text-muted-foreground">{log.memo ?? "-"}</td>
                      <td className="whitespace-nowrap py-1.5 px-2 text-xs text-muted-foreground">
                        {log.operatorName ?? "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
