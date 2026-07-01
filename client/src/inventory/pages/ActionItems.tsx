import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, ExternalLink, RefreshCw, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { ActionItemForm } from "@/inventory/components/ActionItemForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";

type StatusFilter = "open" | "done" | "all";
const ASSIGNEE_ORDER = ["仕入れ担当", "荷受担当", "出荷担当", "その他"];
const SHIPPING_REVIEWERS = ["鈴木さん", "藤本さん"] as const;
const CUSTOM_ASSIGNEE_BADGE_CLASSES = [
  "border-slate-200 bg-slate-100 text-slate-700",
  "border-rose-200 bg-rose-50 text-rose-700",
  "border-cyan-200 bg-cyan-50 text-cyan-700",
  "border-lime-200 bg-lime-50 text-lime-700",
  "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
];

function getAssigneeBadgeClass(assignee: string | null | undefined, done: boolean) {
  const name = assignee || "未設定";
  const base = done ? "opacity-70" : "";
  const fixed: Record<string, string> = {
    仕入れ担当: "border-amber-200 bg-amber-50 text-amber-700",
    荷受担当: "border-sky-200 bg-sky-50 text-sky-700",
    出荷担当: "border-emerald-200 bg-emerald-50 text-emerald-700",
    その他: "border-violet-200 bg-violet-50 text-violet-700",
    未設定: "border-slate-200 bg-slate-100 text-slate-600",
  };
  if (fixed[name]) return `${fixed[name]} ${base}`;

  const hash = Array.from(name).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return `${CUSTOM_ASSIGNEE_BADGE_CLASSES[hash % CUSTOM_ASSIGNEE_BADGE_CLASSES.length]} ${base}`;
}

function parseReviewerChecks(value: string | null | undefined): Record<string, boolean> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).map(([key, checked]) => [key, Boolean(checked)]),
    );
  } catch {
    return {};
  }
}

function getDeliveryHistoryLink(item: { detail: string; sourceKey?: string | null }) {
  const historyId = item.sourceKey?.match(/^fedex-missing-history:(\d+)$/)?.[1];
  if (!historyId) return null;
  const deliveryNo = item.detail.match(/出庫No:\s*([^\n]+)/)?.[1]?.trim();
  if (!deliveryNo) return null;
  const group = deliveryNo.match(/^(\d{3,4})/)?.[1] ?? deliveryNo.split("_")[0] ?? deliveryNo;
  return {
    historyId,
    deliveryNo,
    url: `/inventory/delivery-history?group=${encodeURIComponent(group)}&historyId=${encodeURIComponent(historyId)}`,
  };
}

function ActionItemDetail({
  detail,
  deliveryLink,
  onNavigate,
}: {
  detail: string;
  deliveryLink: ReturnType<typeof getDeliveryHistoryLink>;
  onNavigate: (url: string) => void;
}) {
  return (
    <div className="text-sm whitespace-pre-wrap leading-6">
      {detail.split("\n").map((line, index) => {
        const lineDeliveryLink = deliveryLink && line.trim().startsWith("出庫No:") ? deliveryLink : null;
        return (
          <div key={`${index}-${line}`}>
            {lineDeliveryLink ? (
              <span>
                出庫No:{" "}
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0 align-baseline font-mono text-sm"
                  onClick={() => onNavigate(lineDeliveryLink.url)}
                >
                  {lineDeliveryLink.deliveryNo}
                  <ExternalLink className="ml-1 h-3 w-3" />
                </Button>
              </span>
            ) : (
              line || "\u00a0"
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatDate(value: string | Date | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTimestamp(value: string | Date | null) {
  if (!value) return 0;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

export default function ActionItems() {
  const utils = trpc.useUtils();
  const [, setLocation] = useLocation();
  const [status, setStatus] = useState<StatusFilter>("open");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const { data: items = [], isLoading, refetch, isFetching } = trpc.inventory.actionItems.list.useQuery({ status });

  const setStatusMutation = trpc.inventory.actionItems.setStatus.useMutation({
    onSuccess: async () => {
      await utils.inventory.actionItems.list.invalidate();
    },
    onError: (error) => toast.error(`更新失敗: ${error.message}`),
  });

  const setReviewerCheckMutation = trpc.inventory.actionItems.setReviewerCheck.useMutation({
    onSuccess: async () => {
      await utils.inventory.actionItems.list.invalidate();
    },
    onError: (error) => toast.error(`確認更新失敗: ${error.message}`),
  });

  const deleteMutation = trpc.inventory.actionItems.delete.useMutation({
    onSuccess: async () => {
      toast.success("削除しました");
      await utils.inventory.actionItems.list.invalidate();
    },
    onError: (error) => toast.error(`削除失敗: ${error.message}`),
  });

  const assigneeOptions = useMemo(() => {
    const assignees = Array.from(new Set([...ASSIGNEE_ORDER, ...items.map((item) => item.assignee || "未設定")]));
    return assignees.sort((a, b) => {
      const aIndex = ASSIGNEE_ORDER.indexOf(a);
      const bIndex = ASSIGNEE_ORDER.indexOf(b);
      if (aIndex !== -1 || bIndex !== -1) {
        return (aIndex === -1 ? ASSIGNEE_ORDER.length : aIndex) - (bIndex === -1 ? ASSIGNEE_ORDER.length : bIndex);
      }
      return a.localeCompare(b, "ja");
    });
  }, [items]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) =>
      (assigneeFilter === "all" || (item.assignee || "未設定") === assigneeFilter) &&
      (!q ||
        item.title.toLowerCase().includes(q) ||
        (item.assignee || "").toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q)),
    );
  }, [assigneeFilter, items, search]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));
  }, [filteredItems]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-emerald-600" />
            やることリスト
          </h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          更新
        </Button>
      </div>

      <ActionItemForm onCreated={() => refetch()} />

      <Card className="rounded-lg">
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              {(["open", "done", "all"] as StatusFilter[]).map((value) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={status === value ? "default" : "outline"}
                  onClick={() => setStatus(value)}
                >
                  {value === "open" ? "未完了" : value === "done" ? "完了" : "すべて"}
                </Button>
              ))}
            </div>
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                担当者
                <select
                  value={assigneeFilter}
                  onChange={(event) => setAssigneeFilter(event.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm"
                >
                  <option value="all">すべて</option>
                  {assigneeOptions.map((assignee) => (
                    <option key={assignee} value={assignee}>
                      {assignee}
                    </option>
                  ))}
                </select>
              </label>
              <div className="relative w-full sm:w-[320px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="検索"
                  className="pl-9"
                />
              </div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            {isLoading ? "読み込み中..." : `${sortedItems.length}件`}
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">読み込み中...</div>
      ) : sortedItems.length === 0 ? (
        <div className="py-10 text-center text-sm text-muted-foreground">やることはありません</div>
      ) : (
        <div className="space-y-3">
          {sortedItems.map((item) => {
            const done = item.status === "done";
            const deliveryLink = getDeliveryHistoryLink(item);
            const reviewerChecks = parseReviewerChecks(item.reviewerChecksJson);
            return (
              <Card key={item.id} className={`rounded-lg ${done ? "opacity-65" : ""}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setStatusMutation.mutate({ id: item.id, status: done ? "open" : "done" });
                        }}
                        disabled={setStatusMutation.isPending}
                        className={`mt-1 ${
                          done
                            ? "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                            : "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                        }`}
                      >
                        {done ? "未完了に戻す" : "完了にする"}
                      </Button>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className={`font-semibold break-all ${done ? "line-through" : ""}`}>
                            {item.title}
                          </h2>
                          <Badge variant="outline" className={getAssigneeBadgeClass(item.assignee, done)}>
                            {item.assignee}
                          </Badge>
                          {item.assignee === "出荷担当" ? (
                            <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                              {SHIPPING_REVIEWERS.map((reviewer) => (
                                <label key={reviewer} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                  <span>{reviewer}</span>
                                  <Checkbox
                                    checked={Boolean(reviewerChecks[reviewer])}
                                    onCheckedChange={(checked) => {
                                      setReviewerCheckMutation.mutate({
                                        id: item.id,
                                        reviewer,
                                        checked: checked === true,
                                      });
                                    }}
                                    disabled={setReviewerCheckMutation.isPending}
                                    className="h-4 w-4"
                                  />
                                </label>
                              ))}
                            </div>
                          ) : null}
                          {done ? (
                            <Badge variant="outline" className="text-emerald-700">
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              完了
                            </Badge>
                          ) : null}
                        </div>
                        <ActionItemDetail detail={item.detail} deliveryLink={deliveryLink} onNavigate={setLocation} />
                        <div className="text-xs text-muted-foreground">
                          登録: {formatDate(item.createdAt)}
                          {item.completedAt ? ` / 完了: ${formatDate(item.completedAt)}` : ""}
                        </div>
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:text-destructive"
                      onClick={() => deleteMutation.mutate({ id: item.id })}
                      aria-label="削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
