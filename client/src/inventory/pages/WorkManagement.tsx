import { useEffect, useMemo, useState } from "react";
import { BarChart3, Clock3, Play, RefreshCw, Save, Square, Timer, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type DateLike = string | Date | null | undefined;

type WorkLogRecord = {
  id: number;
  workerName: string;
  category: string;
  status: string;
  startedAt: DateLike;
  endedAt: DateLike;
  manualMinutes: number | null;
  quantity: number;
  memo: string | null;
  createdBy: string | null;
  createdAt: DateLike;
};

function toDate(value: DateLike) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toLocalDateTimeInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function formatDateTime(value: DateLike) {
  const date = toDate(value);
  if (!date) return "-";
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function parseNumber(value: string, fallback = 0) {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseOptionalMinutes(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null;
}

function getDurationMinutes(log: WorkLogRecord, now: Date) {
  if (typeof log.manualMinutes === "number") return log.manualMinutes;
  const started = toDate(log.startedAt);
  const ended = toDate(log.endedAt);
  if (started && ended) return Math.max(0, Math.round((ended.getTime() - started.getTime()) / 60000));
  if (log.status === "running" && started) return Math.max(0, Math.round((now.getTime() - started.getTime()) / 60000));
  return 0;
}

function formatMinutes(minutes: number) {
  if (minutes <= 0) return "0分";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}分`;
  if (rest === 0) return `${hours}時間`;
  return `${hours}時間${rest}分`;
}

function todayInputDate() {
  return toLocalDateTimeInput(new Date());
}

export default function WorkManagement() {
  const utils = trpc.useUtils();
  const [now, setNow] = useState(() => new Date());
  const [workerName, setWorkerName] = useState("村上");
  const [category, setCategory] = useState("入庫登録");
  const [startedAt, setStartedAt] = useState("");
  const [endedAt, setEndedAt] = useState("");
  const [manualMinutes, setManualMinutes] = useState("");
  const [quantity, setQuantity] = useState("0");
  const [memo, setMemo] = useState("");
  const [finishDrafts, setFinishDrafts] = useState<Record<number, { quantity: string; manualMinutes: string; memo: string }>>({});

  useEffect(() => {
    const timerId = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timerId);
  }, []);

  const { data: options } = trpc.inventory.workLogs.options.useQuery();
  const { data: logsData = [], isLoading, isFetching, refetch } = trpc.inventory.workLogs.list.useQuery(
    { status: "all", limit: 200 },
    { refetchInterval: 60000 },
  );
  const logs = logsData as WorkLogRecord[];

  const invalidateLogs = async () => {
    await Promise.all([
      utils.inventory.workLogs.list.invalidate(),
      utils.inventory.workLogs.options.invalidate(),
    ]);
  };

  const startMutation = trpc.inventory.workLogs.start.useMutation({
    onSuccess: async () => {
      setMemo("");
      await invalidateLogs();
      toast.success("作業を開始しました");
    },
    onError: (error) => toast.error(`開始失敗: ${error.message}`),
  });

  const createMutation = trpc.inventory.workLogs.create.useMutation({
    onSuccess: async () => {
      setStartedAt("");
      setEndedAt("");
      setManualMinutes("");
      setQuantity("0");
      setMemo("");
      await invalidateLogs();
      toast.success("作業ログを保存しました");
    },
    onError: (error) => toast.error(`保存失敗: ${error.message}`),
  });

  const finishMutation = trpc.inventory.workLogs.finish.useMutation({
    onSuccess: async (_, variables) => {
      setFinishDrafts((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      await invalidateLogs();
      toast.success("作業を終了しました");
    },
    onError: (error) => toast.error(`終了失敗: ${error.message}`),
  });

  const deleteMutation = trpc.inventory.workLogs.delete.useMutation({
    onSuccess: async () => {
      await invalidateLogs();
      toast.success("作業ログを削除しました");
    },
    onError: (error) => toast.error(`削除失敗: ${error.message}`),
  });

  const runningLogs = useMemo(() => logs.filter((log) => log.status === "running"), [logs]);
  const completedLogs = useMemo(() => logs.filter((log) => log.status !== "running"), [logs]);

  const summary = useMemo(() => {
    const totalMinutes = completedLogs.reduce((sum, log) => sum + getDurationMinutes(log, now), 0);
    const totalQuantity = completedLogs.reduce((sum, log) => sum + log.quantity, 0);
    const byCategory = new Map<string, { count: number; minutes: number; quantity: number }>();
    for (const log of completedLogs) {
      const current = byCategory.get(log.category) ?? { count: 0, minutes: 0, quantity: 0 };
      current.count += 1;
      current.minutes += getDurationMinutes(log, now);
      current.quantity += log.quantity;
      byCategory.set(log.category, current);
    }
    return {
      totalMinutes,
      totalQuantity,
      categoryRows: Array.from(byCategory.entries()).map(([name, values]) => ({ name, ...values })),
    };
  }, [completedLogs, now]);

  const handleStart = () => {
    const cleanWorker = workerName.trim();
    const cleanCategory = category.trim();
    if (!cleanWorker || !cleanCategory) {
      toast.error("担当者と作業カテゴリを入力してください");
      return;
    }
    startMutation.mutate({ workerName: cleanWorker, category: cleanCategory, memo: memo.trim() || undefined });
  };

  const handleCreate = () => {
    const cleanWorker = workerName.trim();
    const cleanCategory = category.trim();
    if (!cleanWorker || !cleanCategory) {
      toast.error("担当者と作業カテゴリを入力してください");
      return;
    }
    const minutes = parseOptionalMinutes(manualMinutes);
    if (!minutes && (!startedAt || !endedAt)) {
      toast.error("開始・終了、または作業時間を入力してください");
      return;
    }
    createMutation.mutate({
      workerName: cleanWorker,
      category: cleanCategory,
      startedAt: startedAt || undefined,
      endedAt: endedAt || undefined,
      manualMinutes: minutes,
      quantity: parseNumber(quantity),
      memo: memo.trim() || undefined,
    });
  };

  const handleFinish = (log: WorkLogRecord) => {
    const draft = finishDrafts[log.id] ?? { quantity: String(log.quantity || 0), manualMinutes: "", memo: log.memo ?? "" };
    finishMutation.mutate({
      id: log.id,
      quantity: parseNumber(draft.quantity),
      manualMinutes: parseOptionalMinutes(draft.manualMinutes),
      memo: draft.memo.trim() || undefined,
    });
  };

  const setFinishDraft = (id: number, key: "quantity" | "manualMinutes" | "memo", value: string) => {
    setFinishDrafts((current) => ({
      ...current,
      [id]: {
        quantity: current[id]?.quantity ?? "0",
        manualMinutes: current[id]?.manualMinutes ?? "",
        memo: current[id]?.memo ?? "",
        [key]: value,
      },
    }));
  };

  const workerOptions = options?.workers ?? [];
  const categoryOptions = options?.categories ?? [];
  const isMutating = startMutation.isPending || createMutation.isPending || finishMutation.isPending || deleteMutation.isPending;
  const hourlyRate = summary.totalMinutes > 0 ? Math.round((summary.totalQuantity / summary.totalMinutes) * 60 * 10) / 10 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Timer className="h-5 w-5 text-indigo-500" />
            作業管理
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            同じ担当者が複数カテゴリを行う場合は、カテゴリごとに作業ログを分けてください。
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          更新
        </Button>
      </div>

      <Card className="rounded-lg">
        <CardContent className="space-y-4 p-4">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm font-medium">
              担当者
              <Input value={workerName} onChange={(event) => setWorkerName(event.target.value)} list="work-worker-options" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              作業カテゴリ
              <Input value={category} onChange={(event) => setCategory(event.target.value)} list="work-category-options" />
            </label>
            <label className="space-y-1 text-sm font-medium">
              開始
              <Input type="datetime-local" value={startedAt} onChange={(event) => setStartedAt(event.target.value)} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              終了
              <Input type="datetime-local" value={endedAt} onChange={(event) => setEndedAt(event.target.value)} />
            </label>
            <label className="space-y-1 text-sm font-medium">
              作業時間(分)
              <Input
                type="number"
                min="0"
                inputMode="numeric"
                value={manualMinutes}
                onChange={(event) => setManualMinutes(event.target.value)}
                placeholder="手動入力"
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              処理数
              <Input type="number" min="0" inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
            </label>
            <div className="flex items-end gap-2 xl:col-span-2">
              <Button type="button" variant="outline" onClick={() => setStartedAt(todayInputDate())}>
                開始時刻を入れる
              </Button>
              <Button type="button" variant="outline" onClick={() => setEndedAt(todayInputDate())}>
                終了時刻を入れる
              </Button>
            </div>
            <label className="space-y-1 text-sm font-medium md:col-span-2 xl:col-span-4">
              メモ
              <Textarea value={memo} onChange={(event) => setMemo(event.target.value)} className="min-h-[84px]" />
            </label>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="outline" onClick={handleStart} disabled={isMutating}>
              <Play className="mr-2 h-4 w-4" />
              開始
            </Button>
            <Button type="button" onClick={handleCreate} disabled={isMutating}>
              <Save className="mr-2 h-4 w-4" />
              記録保存
            </Button>
          </div>
          <datalist id="work-worker-options">
            {workerOptions.map((worker) => (
              <option key={worker.id} value={worker.name} />
            ))}
          </datalist>
          <datalist id="work-category-options">
            {categoryOptions.map((item) => (
              <option key={item.id} value={item.name} />
            ))}
          </datalist>
        </CardContent>
      </Card>

      {runningLogs.length > 0 ? (
        <Card className="rounded-lg border-indigo-200 bg-indigo-50/40">
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2 font-semibold">
              <Clock3 className="h-4 w-4 text-indigo-600" />
              作業中
            </div>
            <div className="space-y-2">
              {runningLogs.map((log) => {
                const draft = finishDrafts[log.id] ?? { quantity: String(log.quantity || 0), manualMinutes: "", memo: log.memo ?? "" };
                return (
                  <div key={log.id} className="grid gap-2 rounded-lg border bg-white p-3 lg:grid-cols-[1fr_130px_150px_1fr_auto] lg:items-end">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{log.workerName}</span>
                        <Badge variant="outline">{log.category}</Badge>
                      </div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        開始: {formatDateTime(log.startedAt)} / 経過: {formatMinutes(getDurationMinutes(log, now))}
                      </div>
                    </div>
                    <label className="space-y-1 text-sm">
                      処理数
                      <Input
                        type="number"
                        min="0"
                        value={draft.quantity}
                        onChange={(event) => setFinishDraft(log.id, "quantity", event.target.value)}
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      作業時間(分)
                      <Input
                        type="number"
                        min="0"
                        value={draft.manualMinutes}
                        onChange={(event) => setFinishDraft(log.id, "manualMinutes", event.target.value)}
                        placeholder="自動計算"
                      />
                    </label>
                    <label className="space-y-1 text-sm">
                      メモ
                      <Input value={draft.memo} onChange={(event) => setFinishDraft(log.id, "memo", event.target.value)} />
                    </label>
                    <Button type="button" onClick={() => handleFinish(log)} disabled={isMutating}>
                      <Square className="mr-2 h-4 w-4" />
                      終了
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 md:grid-cols-4">
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              作業件数
            </div>
            <div className="mt-2 text-2xl font-semibold">{completedLogs.length}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Timer className="h-4 w-4" />
              作業時間
            </div>
            <div className="mt-2 text-2xl font-semibold">{formatMinutes(summary.totalMinutes)}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BarChart3 className="h-4 w-4" />
              処理数
            </div>
            <div className="mt-2 text-2xl font-semibold">{summary.totalQuantity.toLocaleString("ja-JP")}</div>
          </CardContent>
        </Card>
        <Card className="rounded-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock3 className="h-4 w-4" />
              1時間あたり
            </div>
            <div className="mt-2 text-2xl font-semibold">{hourlyRate.toLocaleString("ja-JP")}</div>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">カテゴリ別集計</h2>
            <Badge variant="outline">{summary.categoryRows.length}件</Badge>
          </div>
          {summary.categoryRows.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">集計対象の作業ログはありません</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>作業カテゴリ</TableHead>
                  <TableHead className="text-right">件数</TableHead>
                  <TableHead className="text-right">作業時間</TableHead>
                  <TableHead className="text-right">処理数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.categoryRows.map((row) => (
                  <TableRow key={row.name}>
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right">{row.count}</TableCell>
                    <TableCell className="text-right">{formatMinutes(row.minutes)}</TableCell>
                    <TableCell className="text-right">{row.quantity.toLocaleString("ja-JP")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="font-semibold">最近の作業ログ</h2>
            <Badge variant="outline">{logs.length}件</Badge>
          </div>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground">読み込み中...</div>
          ) : logs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">作業ログはありません</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日時</TableHead>
                  <TableHead>担当者</TableHead>
                  <TableHead>作業カテゴリ</TableHead>
                  <TableHead className="text-right">作業時間</TableHead>
                  <TableHead className="text-right">処理数</TableHead>
                  <TableHead>メモ</TableHead>
                  <TableHead className="w-16 text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>{formatDateTime(log.startedAt || log.createdAt)}</TableCell>
                    <TableCell className="font-medium">{log.workerName}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{log.category}</Badge>
                        {log.status === "running" ? <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">作業中</Badge> : null}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{formatMinutes(getDurationMinutes(log, now))}</TableCell>
                    <TableCell className="text-right">{log.quantity.toLocaleString("ja-JP")}</TableCell>
                    <TableCell className="max-w-[360px] whitespace-normal text-muted-foreground">{log.memo || "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteMutation.mutate({ id: log.id })}
                        disabled={isMutating}
                        aria-label="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
