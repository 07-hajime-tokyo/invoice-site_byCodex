import { useEffect, useMemo, useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Clock3, GitBranch, Pencil, Play, Plus, RefreshCw, Save, Square, Timer, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { setCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
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
  sourceType: string | null;
  sourceId: string | null;
  detailsJson: string | null;
  createdBy: string | null;
  createdAt: DateLike;
};

type WorkOption = {
  id: number;
  name: string;
  sortOrder: number;
};

type WorkLogForm = {
  workerName: string;
  category: string;
  customCategory: string;
  startedAt: string;
  endedAt: string;
  manualMinutes: string;
  quantity: string;
  memo: string;
  status: "running" | "done";
  sourceType?: string | null;
  sourceId?: string | null;
  detailsJson?: string | null;
};

type SplitDraft = {
  category: string;
  customCategory: string;
  manualMinutes: string;
  quantity: string;
  memo: string;
};

type DeliveryDetails = {
  deliveryNo?: string | null;
  deliveryDate?: string | null;
  trackingNumber?: string | null;
  items?: Array<{
    inventoryId?: number | string | null;
    title?: string | null;
    quantity?: number | string | null;
    managementNo?: string | null;
  }>;
};

const DURATION_PRESETS = [30, 60, 90, 120, 150, 180];

function toDate(value: DateLike) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toLocalDateTimeInput(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toInputDateTime(value: DateLike) {
  const date = toDate(value);
  return date ? toLocalDateTimeInput(date) : "";
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
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
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

function parseDetails(json: string | null | undefined): DeliveryDetails | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as DeliveryDetails;
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function hasDetails(log: WorkLogRecord) {
  return Boolean(parseDetails(log.detailsJson)?.items?.length);
}

function initialForm(): WorkLogForm {
  return {
    workerName: "鈴木",
    category: "入庫登録",
    customCategory: "",
    startedAt: "",
    endedAt: "",
    manualMinutes: "",
    quantity: "0",
    memo: "",
    status: "done",
  };
}

function formFromLog(log: WorkLogRecord): WorkLogForm {
  return {
    workerName: log.workerName,
    category: log.category,
    customCategory: "",
    startedAt: toInputDateTime(log.startedAt),
    endedAt: toInputDateTime(log.endedAt),
    manualMinutes: log.manualMinutes == null ? "" : String(log.manualMinutes),
    quantity: String(log.quantity ?? 0),
    memo: log.memo ?? "",
    status: log.status === "running" ? "running" : "done",
    sourceType: log.sourceType,
    sourceId: log.sourceId,
    detailsJson: log.detailsJson,
  };
}

function initialSplitDraft(categoryOptions: WorkOption[] = []): SplitDraft {
  const preferredCategory =
    categoryOptions.find((item) => item.name === "出庫登録") ??
    categoryOptions.find((item) => item.name !== "その他") ??
    categoryOptions[0];
  return {
    category: preferredCategory?.name ?? "その他",
    customCategory: "",
    manualMinutes: "30",
    quantity: "0",
    memo: "",
  };
}

export default function WorkManagement() {
  const utils = trpc.useUtils();
  const [now, setNow] = useState(() => new Date());
  const [form, setForm] = useState<WorkLogForm>(() => initialForm());
  const [finishDrafts, setFinishDrafts] = useState<Record<number, { quantity: string; manualMinutes: string; memo: string }>>({});
  const [newWorkerName, setNewWorkerName] = useState("");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingWorker, setEditingWorker] = useState<{ id: number; name: string } | null>(null);
  const [editingCategory, setEditingCategory] = useState<{ id: number; name: string } | null>(null);
  const [editingLog, setEditingLog] = useState<WorkLogRecord | null>(null);
  const [editForm, setEditForm] = useState<WorkLogForm>(() => initialForm());
  const [expandedDetails, setExpandedDetails] = useState<Record<number, boolean>>({});
  const [splittingLogId, setSplittingLogId] = useState<number | null>(null);
  const [splitDraft, setSplitDraft] = useState<SplitDraft>(() => initialSplitDraft());
  const [showSettings, setShowSettings] = useState(false);

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

  const workerOptions = (options?.workers ?? []) as WorkOption[];
  const categoryOptions = (options?.categories ?? []) as WorkOption[];

  const invalidateLogs = async () => {
    await Promise.all([
      utils.inventory.workLogs.list.invalidate(),
      utils.inventory.workLogs.options.invalidate(),
    ]);
  };

  const onMutationSuccess = async (message: string) => {
    await invalidateLogs();
    toast.success(message);
  };

  const addWorkerMutation = trpc.inventory.workLogs.addWorker.useMutation({
    onSuccess: async () => {
      setNewWorkerName("");
      await onMutationSuccess("担当者を追加しました");
    },
    onError: (error) => toast.error(`担当者追加失敗: ${error.message}`),
  });
  const updateWorkerMutation = trpc.inventory.workLogs.updateWorker.useMutation({
    onSuccess: async () => {
      setEditingWorker(null);
      await onMutationSuccess("担当者を更新しました");
    },
    onError: (error) => toast.error(`担当者更新失敗: ${error.message}`),
  });
  const deleteWorkerMutation = trpc.inventory.workLogs.deleteWorker.useMutation({
    onSuccess: async () => onMutationSuccess("担当者を削除しました"),
    onError: (error) => toast.error(`担当者削除失敗: ${error.message}`),
  });
  const addCategoryMutation = trpc.inventory.workLogs.addCategory.useMutation({
    onSuccess: async () => {
      setNewCategoryName("");
      await onMutationSuccess("作業カテゴリを追加しました");
    },
    onError: (error) => toast.error(`カテゴリ追加失敗: ${error.message}`),
  });
  const updateCategoryMutation = trpc.inventory.workLogs.updateCategory.useMutation({
    onSuccess: async () => {
      setEditingCategory(null);
      await onMutationSuccess("作業カテゴリを更新しました");
    },
    onError: (error) => toast.error(`カテゴリ更新失敗: ${error.message}`),
  });
  const deleteCategoryMutation = trpc.inventory.workLogs.deleteCategory.useMutation({
    onSuccess: async () => onMutationSuccess("作業カテゴリを削除しました"),
    onError: (error) => toast.error(`カテゴリ削除失敗: ${error.message}`),
  });

  const startMutation = trpc.inventory.workLogs.start.useMutation({
    onSuccess: async () => {
      setForm((current) => ({ ...current, memo: "" }));
      await onMutationSuccess("作業を開始しました");
    },
    onError: (error) => toast.error(`開始失敗: ${error.message}`),
  });

  const createMutation = trpc.inventory.workLogs.create.useMutation({
    onSuccess: async () => {
      setForm(initialForm());
      await onMutationSuccess("作業ログを保存しました");
    },
    onError: (error) => toast.error(`保存失敗: ${error.message}`),
  });

  const updateMutation = trpc.inventory.workLogs.update.useMutation({
    onSuccess: async () => {
      setEditingLog(null);
      await onMutationSuccess("作業ログを更新しました");
    },
    onError: (error) => toast.error(`更新失敗: ${error.message}`),
  });

  const finishMutation = trpc.inventory.workLogs.finish.useMutation({
    onSuccess: async (_, variables) => {
      setFinishDrafts((current) => {
        const next = { ...current };
        delete next[variables.id];
        return next;
      });
      await onMutationSuccess("作業を終了しました");
    },
    onError: (error) => toast.error(`終了失敗: ${error.message}`),
  });

  const deleteMutation = trpc.inventory.workLogs.delete.useMutation({
    onSuccess: async () => onMutationSuccess("作業ログを削除しました"),
    onError: (error) => toast.error(`削除失敗: ${error.message}`),
  });

  const splitMutation = trpc.inventory.workLogs.split.useMutation({
    onSuccess: async () => {
      setSplittingLogId(null);
      setSplitDraft(initialSplitDraft(categoryOptions));
      await onMutationSuccess("作業ログを分割しました");
    },
    onError: (error) => toast.error(`分割失敗: ${error.message}`),
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

  const isMutating =
    startMutation.isPending ||
    createMutation.isPending ||
    updateMutation.isPending ||
    finishMutation.isPending ||
    deleteMutation.isPending ||
    splitMutation.isPending ||
    addWorkerMutation.isPending ||
    updateWorkerMutation.isPending ||
    deleteWorkerMutation.isPending ||
    addCategoryMutation.isPending ||
    updateCategoryMutation.isPending ||
    deleteCategoryMutation.isPending;

  const hourlyRate = summary.totalMinutes > 0 ? Math.round((summary.totalQuantity / summary.totalMinutes) * 60 * 10) / 10 : 0;

  const setFormField = <K extends keyof WorkLogForm>(key: K, value: WorkLogForm[K]) => {
    setForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "category" && value !== "その他" ? { customCategory: "" } : {}),
    }));
  };

  const setEditFormField = <K extends keyof WorkLogForm>(key: K, value: WorkLogForm[K]) => {
    setEditForm((current) => ({
      ...current,
      [key]: value,
      ...(key === "category" && value !== "その他" ? { customCategory: "" } : {}),
    }));
  };

  const resolveCategory = (target: WorkLogForm) => {
    if (target.category === "その他") return target.customCategory.trim();
    return target.category.trim();
  };

  const resolveSplitCategory = () => {
    if (splitDraft.category === "その他") return splitDraft.customCategory.trim();
    return splitDraft.category.trim();
  };

  const createPayloadFromForm = (target: WorkLogForm) => ({
    workerName: target.workerName.trim(),
    category: resolveCategory(target),
    startedAt: target.startedAt || undefined,
    endedAt: target.endedAt || undefined,
    manualMinutes: parseOptionalMinutes(target.manualMinutes),
    quantity: parseNumber(target.quantity),
    memo: target.memo.trim() || undefined,
    sourceType: target.sourceType ?? undefined,
    sourceId: target.sourceId ?? undefined,
    detailsJson: target.detailsJson ?? undefined,
  });

  const handleStart = () => {
    const category = resolveCategory(form);
    const workerName = form.workerName.trim();
    if (!workerName || !category) {
      toast.error("担当者と作業カテゴリを入力してください");
      return;
    }
    setCurrentWorkWorkerName(workerName);
    startMutation.mutate({
      workerName,
      category,
      memo: form.memo.trim() || undefined,
    });
  };

  const handleCreate = () => {
    if (!form.workerName.trim() || !resolveCategory(form)) {
      toast.error("担当者と作業カテゴリを入力してください");
      return;
    }
    const minutes = parseOptionalMinutes(form.manualMinutes);
    if (minutes == null && (!form.startedAt || !form.endedAt)) {
      toast.error("開始・終了、または作業時間を入力してください");
      return;
    }
    createMutation.mutate(createPayloadFromForm(form));
  };

  const handleUpdate = () => {
    if (!editingLog) return;
    if (!editForm.workerName.trim() || !resolveCategory(editForm)) {
      toast.error("担当者と作業カテゴリを入力してください");
      return;
    }
    updateMutation.mutate({
      id: editingLog.id,
      status: editForm.status,
      ...createPayloadFromForm(editForm),
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

  const openSplitLog = (log: WorkLogRecord) => {
    const duration = getDurationMinutes(log, now);
    setSplittingLogId(log.id);
    setSplitDraft({
      ...initialSplitDraft(categoryOptions),
      manualMinutes: String(duration > 0 ? Math.min(30, duration) : 30),
      quantity: "0",
      memo: "",
    });
  };

  const handleSplit = (log: WorkLogRecord) => {
    const category = resolveSplitCategory();
    const manualMinutes = parseNumber(splitDraft.manualMinutes);
    const quantity = parseNumber(splitDraft.quantity);
    const duration = getDurationMinutes(log, now);
    if (!category) {
      toast.error("分割先カテゴリを入力してください");
      return;
    }
    if (manualMinutes <= 0) {
      toast.error("分割する作業時間を入力してください");
      return;
    }
    if (duration > 0 && manualMinutes > duration) {
      toast.error("分割時間が元ログの作業時間を超えています");
      return;
    }
    splitMutation.mutate({
      id: log.id,
      category,
      manualMinutes,
      quantity,
      memo: splitDraft.memo.trim() || undefined,
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

  const openEditLog = (log: WorkLogRecord) => {
    setEditingLog(log);
    setEditForm(formFromLog(log));
  };

  const renderDurationInput = (
    value: string,
    onChange: (value: string) => void,
    idPrefix: string,
  ) => {
    const presetValue = DURATION_PRESETS.includes(Number(value)) ? value : "custom";
    return (
      <div className="grid gap-2 sm:grid-cols-[150px_1fr]">
        <Select value={presetValue} onValueChange={(next) => onChange(next === "custom" ? "" : next)}>
          <SelectTrigger id={`${idPrefix}-duration-preset`}>
            <SelectValue placeholder="選択" />
          </SelectTrigger>
          <SelectContent>
            {DURATION_PRESETS.map((minutes) => (
              <SelectItem key={minutes} value={String(minutes)}>
                {formatMinutes(minutes)}
              </SelectItem>
            ))}
            <SelectItem value="custom">手動入力</SelectItem>
          </SelectContent>
        </Select>
        <Input
          id={`${idPrefix}-duration-manual`}
          type="number"
          min="0"
          inputMode="numeric"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="分で入力"
        />
      </div>
    );
  };

  const renderOptionManager = (
    title: string,
    optionsList: WorkOption[],
    addValue: string,
    setAddValue: (value: string) => void,
    editing: { id: number; name: string } | null,
    setEditing: (value: { id: number; name: string } | null) => void,
    onAdd: (name: string) => void,
    onUpdate: (id: number, name: string) => void,
    onDelete: (id: number) => void,
  ) => (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="text-sm font-semibold">{title}</div>
      <div className="flex flex-wrap gap-2">
        {optionsList.map((option) => (
          <div key={option.id} className="flex items-center gap-1 rounded-full border bg-background px-2 py-1 text-sm">
            {editing?.id === option.id ? (
              <>
                <Input
                  value={editing.name}
                  onChange={(event) => setEditing({ id: option.id, name: event.target.value })}
                  className="h-7 w-32"
                  autoFocus
                />
                <Button type="button" size="sm" variant="ghost" className="h-7 px-2" onClick={() => onUpdate(option.id, editing.name)} disabled={isMutating}>
                  保存
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(null)}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <span>{option.name}</span>
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditing({ id: option.id, name: option.name })}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button type="button" size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => onDelete(option.id)} disabled={isMutating}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="flex max-w-md gap-2">
        <Input value={addValue} onChange={(event) => setAddValue(event.target.value)} placeholder={`${title}を追加`} />
        <Button type="button" variant="outline" onClick={() => onAdd(addValue)} disabled={!addValue.trim() || isMutating}>
          <Plus className="mr-1.5 h-4 w-4" />
          追加
        </Button>
      </div>
    </div>
  );

  const renderDeliveryDetails = (log: WorkLogRecord) => {
    const details = parseDetails(log.detailsJson);
    if (!details?.items?.length) return null;
    const expanded = expandedDetails[log.id] ?? false;
    return (
      <div className="mt-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setExpandedDetails((current) => ({ ...current, [log.id]: !expanded }))}
        >
          {expanded ? <ChevronDown className="mr-1.5 h-4 w-4" /> : <ChevronRight className="mr-1.5 h-4 w-4" />}
          出庫商品 {details.items.length}件
        </Button>
        {expanded && (
          <div className="mt-2 rounded-lg border bg-muted/20 p-3 text-sm">
            <div className="mb-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>出庫No: {details.deliveryNo || log.sourceId || "-"}</span>
              <span>出庫日: {details.deliveryDate || "-"}</span>
              {details.trackingNumber && <span>追跡番号: {details.trackingNumber}</span>}
            </div>
            <div className="space-y-1">
              {details.items.map((item, index) => (
                <div key={`${item.inventoryId ?? index}-${index}`} className="flex flex-wrap justify-between gap-2 rounded bg-background px-3 py-2">
                  <div>
                    <span className="font-medium">{item.title || "-"}</span>
                    {item.managementNo && <span className="ml-2 text-xs text-muted-foreground">{item.managementNo}</span>}
                  </div>
                  <div className="font-medium">x {item.quantity ?? 0}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderSplitPanel = (log: WorkLogRecord) => {
    if (splittingLogId !== log.id) return null;
    return (
      <div className="mt-3 rounded-lg border bg-amber-50/40 p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold">作業ログを分割</div>
            <div className="text-xs text-muted-foreground">
              元ログ: {formatMinutes(getDurationMinutes(log, now))} / 処理数 {log.quantity.toLocaleString("ja-JP")}
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={() => setSplittingLogId(null)} aria-label="分割を閉じる">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid gap-3 lg:grid-cols-[220px_280px_130px_1fr_auto] lg:items-end">
          <div className="space-y-1.5">
            <Label htmlFor={`split-${log.id}-category`}>分割先カテゴリ</Label>
            <Select
              value={splitDraft.category}
              onValueChange={(value) => setSplitDraft((current) => ({
                ...current,
                category: value,
                customCategory: value === "その他" ? current.customCategory : "",
              }))}
            >
              <SelectTrigger id={`split-${log.id}-category`}>
                <SelectValue placeholder="カテゴリを選択" />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((item) => (
                  <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
                ))}
                {categoryOptions.every((item) => item.name !== "その他") && (
                  <SelectItem value="その他">その他</SelectItem>
                )}
              </SelectContent>
            </Select>
            {splitDraft.category === "その他" && (
              <Input
                value={splitDraft.customCategory}
                onChange={(event) => setSplitDraft((current) => ({ ...current, customCategory: event.target.value }))}
                placeholder="カテゴリを入力"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>分割する作業時間</Label>
            {renderDurationInput(
              splitDraft.manualMinutes,
              (value) => setSplitDraft((current) => ({ ...current, manualMinutes: value })),
              `split-${log.id}`,
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`split-${log.id}-quantity`}>処理数</Label>
            <Input
              id={`split-${log.id}-quantity`}
              type="number"
              min="0"
              inputMode="numeric"
              value={splitDraft.quantity}
              onChange={(event) => setSplitDraft((current) => ({ ...current, quantity: event.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`split-${log.id}-memo`}>メモ</Label>
            <Input
              id={`split-${log.id}-memo`}
              value={splitDraft.memo}
              onChange={(event) => setSplitDraft((current) => ({ ...current, memo: event.target.value }))}
              placeholder="分割理由など"
            />
          </div>
          <Button type="button" onClick={() => handleSplit(log)} disabled={isMutating}>
            <GitBranch className="mr-2 h-4 w-4" />
            分割する
          </Button>
        </div>
      </div>
    );
  };

  const renderLogFormFields = (
    target: WorkLogForm,
    setField: <K extends keyof WorkLogForm>(key: K, value: WorkLogForm[K]) => void,
    idPrefix: string,
  ) => (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-worker`}>担当者</Label>
        <Select value={target.workerName} onValueChange={(value) => setField("workerName", value)}>
          <SelectTrigger id={`${idPrefix}-worker`}>
            <SelectValue placeholder="担当者を選択" />
          </SelectTrigger>
          <SelectContent>
            {workerOptions.map((worker) => (
              <SelectItem key={worker.id} value={worker.name}>{worker.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-category`}>作業カテゴリ</Label>
        <Select value={target.category} onValueChange={(value) => setField("category", value)}>
          <SelectTrigger id={`${idPrefix}-category`}>
            <SelectValue placeholder="カテゴリを選択" />
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((item) => (
              <SelectItem key={item.id} value={item.name}>{item.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {target.category === "その他" && (
          <Input
            id={`${idPrefix}-category-custom`}
            value={target.customCategory}
            onChange={(event) => setField("customCategory", event.target.value)}
            placeholder="作業カテゴリを入力"
          />
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-started`}>開始</Label>
        <div className="flex gap-2">
          <Input id={`${idPrefix}-started`} type="datetime-local" value={target.startedAt} onChange={(event) => setField("startedAt", event.target.value)} />
          {target.startedAt && (
            <Button type="button" size="icon" variant="outline" onClick={() => setField("startedAt", "")} aria-label="開始をクリア">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-ended`}>終了</Label>
        <div className="flex gap-2">
          <Input id={`${idPrefix}-ended`} type="datetime-local" value={target.endedAt} onChange={(event) => setField("endedAt", event.target.value)} />
          {target.endedAt && (
            <Button type="button" size="icon" variant="outline" onClick={() => setField("endedAt", "")} aria-label="終了をクリア">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
      <div className="space-y-1.5 md:col-span-2">
        <Label>作業時間</Label>
        {renderDurationInput(target.manualMinutes, (value) => setField("manualMinutes", value), idPrefix)}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-quantity`}>処理数</Label>
        <Input id={`${idPrefix}-quantity`} type="number" min="0" inputMode="numeric" value={target.quantity} onChange={(event) => setField("quantity", event.target.value)} />
      </div>
      <div className="flex items-end gap-2">
        <Button type="button" variant="outline" onClick={() => setField("startedAt", toLocalDateTimeInput())}>
          開始を入れる
        </Button>
        <Button type="button" variant="outline" onClick={() => setField("endedAt", toLocalDateTimeInput())}>
          終了を入れる
        </Button>
      </div>
      <div className="space-y-1.5 md:col-span-2 xl:col-span-4">
        <Label htmlFor={`${idPrefix}-memo`}>メモ</Label>
        <Textarea id={`${idPrefix}-memo`} value={target.memo} onChange={(event) => setField("memo", event.target.value)} className="min-h-[84px]" />
      </div>
    </div>
  );

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
          {renderLogFormFields(form, setFormField, "work-new")}
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
        </CardContent>
      </Card>

      <Card className="rounded-lg">
        <CardContent className="p-4">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 rounded-md px-1 py-1 text-left transition hover:bg-muted/50"
            onClick={() => setShowSettings((current) => !current)}
            aria-expanded={showSettings}
          >
            <div className="flex items-center gap-2">
              {showSettings ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
              <span className="font-semibold">設定</span>
              <span className="text-sm text-muted-foreground">担当者・作業カテゴリ</span>
            </div>
            <Badge variant="outline">
              担当者 {workerOptions.length} / カテゴリ {categoryOptions.length}
            </Badge>
          </button>
          {showSettings && (
            <div className="mt-4 grid gap-3 xl:grid-cols-2">
              {renderOptionManager(
                "担当者",
                workerOptions,
                newWorkerName,
                setNewWorkerName,
                editingWorker,
                setEditingWorker,
                (name) => addWorkerMutation.mutate({ name: name.trim() }),
                (id, name) => updateWorkerMutation.mutate({ id, name: name.trim() }),
                (id) => deleteWorkerMutation.mutate({ id }),
              )}
              {renderOptionManager(
                "作業カテゴリ",
                categoryOptions,
                newCategoryName,
                setNewCategoryName,
                editingCategory,
                setEditingCategory,
                (name) => addCategoryMutation.mutate({ name: name.trim() }),
                (id, name) => updateCategoryMutation.mutate({ id, name: name.trim() }),
                (id) => deleteCategoryMutation.mutate({ id }),
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {runningLogs.length > 0 && (
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
                  <div key={log.id} className="grid gap-2 rounded-lg border bg-white p-3 lg:grid-cols-[1fr_130px_250px_1fr_auto] lg:items-end">
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
                      作業時間
                      {renderDurationInput(draft.manualMinutes, (value) => setFinishDraft(log.id, "manualMinutes", value), `finish-${log.id}`)}
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
      )}

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
                  <TableHead className="text-right">1時間あたり</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.categoryRows.map((row) => {
                  const categoryHourlyRate = row.minutes > 0 ? Math.round((row.quantity / row.minutes) * 60 * 10) / 10 : 0;
                  return (
                    <TableRow key={row.name}>
                      <TableCell className="font-medium">{row.name}</TableCell>
                      <TableCell className="text-right">{row.count}</TableCell>
                      <TableCell className="text-right">{formatMinutes(row.minutes)}</TableCell>
                      <TableCell className="text-right">{row.quantity.toLocaleString("ja-JP")}</TableCell>
                      <TableCell className="text-right">{categoryHourlyRate.toLocaleString("ja-JP")}</TableCell>
                    </TableRow>
                  );
                })}
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
            <div className="space-y-3">
              {logs.map((log) => (
                <div key={log.id} className="rounded-lg border bg-background p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold">{log.workerName}</span>
                        <Badge variant="outline">{log.category}</Badge>
                        {log.status === "running" && <Badge className="bg-indigo-100 text-indigo-700 hover:bg-indigo-100">作業中</Badge>}
                        {log.sourceType === "delivery" && <Badge className="bg-emerald-50 text-emerald-700 hover:bg-emerald-50">出庫自動</Badge>}
                      </div>
                      <div className="text-sm text-muted-foreground">
                        {formatDateTime(log.startedAt || log.createdAt)}
                        {log.endedAt ? ` - ${formatDateTime(log.endedAt)}` : ""}
                      </div>
                      <div className="flex flex-wrap gap-3 text-sm">
                        <span>作業時間: <span className="font-medium">{formatMinutes(getDurationMinutes(log, now))}</span></span>
                        <span>処理数: <span className="font-medium">{log.quantity.toLocaleString("ja-JP")}</span></span>
                        {log.sourceId && <span>参照: <span className="font-medium">{log.sourceId}</span></span>}
                      </div>
                      {log.memo && <div className="text-sm text-muted-foreground">{log.memo}</div>}
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openSplitLog(log)}
                        disabled={log.status === "running" || isMutating}
                      >
                        <GitBranch className="mr-1.5 h-4 w-4" />
                        分割
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => openEditLog(log)}>
                        <Pencil className="mr-1.5 h-4 w-4" />
                        編集
                      </Button>
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
                    </div>
                  </div>
                  {renderSplitPanel(log)}
                  {hasDetails(log) && renderDeliveryDetails(log)}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editingLog)} onOpenChange={(open) => !open && setEditingLog(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>作業ログ編集</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>状態</Label>
              <Select value={editForm.status} onValueChange={(value) => setEditFormField("status", value as "running" | "done")}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="done">完了</SelectItem>
                  <SelectItem value="running">作業中</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {renderLogFormFields(editForm, setEditFormField, "work-edit")}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditingLog(null)}>
              キャンセル
            </Button>
            <Button type="button" onClick={handleUpdate} disabled={isMutating}>
              <Save className="mr-2 h-4 w-4" />
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
