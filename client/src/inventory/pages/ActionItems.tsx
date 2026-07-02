import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardCheck, ExternalLink, MessageSquare, Pencil, RefreshCw, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { ActionItemForm } from "@/inventory/components/ActionItemForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type StatusFilter = "open" | "done" | "all";
const ASSIGNEE_ORDER = ["仕入れ担当", "荷受担当", "出荷担当", "その他"];
const SHIPPING_REVIEWERS = ["鈴木さん", "藤本さん"] as const;
const INVENTORY_RECONCILIATION_URL = "https://inventory-reconciliation-2026-06.vercel.app/";
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

function formatAuthorName(value: string | null | undefined) {
  if (!value) return "未設定";
  return value === "cron" ? "自動" : value;
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
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [replyAuthors, setReplyAuthors] = useState<Record<number, string>>({});
  const [openReplyForms, setOpenReplyForms] = useState<Record<number, boolean>>({});
  const [openReplyLists, setOpenReplyLists] = useState<Record<number, boolean>>({});
  const { data: items = [], isLoading, refetch, isFetching } = trpc.inventory.actionItems.list.useQuery({ status });
  const { data: actionOptions } = trpc.inventory.actionItems.options.useQuery();
  const authorOptions = actionOptions?.authors ?? [];

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

  const createReplyMutation = trpc.inventory.actionItems.createReply.useMutation({
    onSuccess: async (_, variables) => {
      setReplyDrafts((current) => ({ ...current, [variables.actionItemId]: "" }));
      setOpenReplyForms((current) => ({ ...current, [variables.actionItemId]: false }));
      setOpenReplyLists((current) => ({ ...current, [variables.actionItemId]: true }));
      await utils.inventory.actionItems.list.invalidate();
      toast.success("返信しました");
    },
    onError: (error) => toast.error(`返信失敗: ${error.message}`),
  });

  const defaultReplyAuthor = useMemo(() => {
    return authorOptions.find((item) => item.name === "村上")?.name ?? authorOptions[0]?.name ?? "";
  }, [authorOptions]);

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
        (item.createdBy || "").toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q)),
    );
  }, [assigneeFilter, items, search]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => getTimestamp(b.createdAt) - getTimestamp(a.createdAt));
  }, [filteredItems]);

  const getReplyAuthor = (itemId: number) => replyAuthors[itemId] || defaultReplyAuthor;

  const submitReply = (itemId: number) => {
    const body = (replyDrafts[itemId] ?? "").trim();
    if (!body) {
      toast.error("返信を入力してください");
      return;
    }
    const author = getReplyAuthor(itemId);
    if (!author) {
      toast.error("記入者を選択してください");
      return;
    }
    createReplyMutation.mutate({ actionItemId: itemId, body, author });
  };

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

      <Card className="rounded-lg border-orange-200 bg-orange-50/60">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-orange-200 bg-white text-orange-700">
                  6月末棚卸
                </Badge>
                <h2 className="text-base font-semibold">棚卸サイトの使い方</h2>
              </div>
              <div className="grid gap-2 text-sm leading-6 text-muted-foreground md:grid-cols-3">
                <div>
                  <span className="font-medium text-foreground">1. 税理士報告を見る</span>
                  <p>合計、未着品、未完了注文、未入金インボイス0393を確認します。</p>
                </div>
                <div>
                  <span className="font-medium text-foreground">2. スタッフ現物照合を使う</span>
                  <p>付箋の管理番号と表の管理番号を見ながら、「表示中をすべてOK」後に異常行だけ外します。</p>
                </div>
                <div>
                  <span className="font-medium text-foreground">3. CSVを残す</span>
                  <p>途中は一時保存、終わったら棚卸完了にして、照合CSVを非公開レポートに回します。</p>
                </div>
              </div>
              <p className="text-xs leading-5 text-muted-foreground">
                棚卸サイトは一時公開です。レポート保存後、2026年7月15日頃を目安に公開終了する前提で扱います。
              </p>
            </div>
            <Button asChild size="sm" className="shrink-0">
              <a href={INVENTORY_RECONCILIATION_URL} target="_blank" rel="noreferrer">
                棚卸サイトを開く
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

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
            const replyText = replyDrafts[item.id] ?? "";
            const replies = item.replies ?? [];
            const replyFormOpen = Boolean(openReplyForms[item.id]);
            const replyListOpen = openReplyLists[item.id] ?? true;
            return (
              <div key={item.id} className="space-y-2">
                <Card className={`rounded-lg ${done ? "opacity-65" : ""}`}>
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
                              {item.assignee || "未設定"}
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
                          {replyFormOpen ? (
                            <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                              <div className="grid gap-2 md:grid-cols-[150px_1fr_auto] md:items-start">
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-muted-foreground">記入者</div>
                                  <select
                                    value={getReplyAuthor(item.id)}
                                    onChange={(event) => setReplyAuthors((current) => ({ ...current, [item.id]: event.target.value }))}
                                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm"
                                  >
                                    {authorOptions.map((author) => (
                                      <option key={author.id} value={author.name}>
                                        {author.name}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <Textarea
                                  value={replyText}
                                  onChange={(event) => setReplyDrafts((current) => ({ ...current, [item.id]: event.target.value }))}
                                  placeholder="返信を書く"
                                  className="min-h-[68px] bg-white"
                                />
                                <Button
                                  type="button"
                                  size="sm"
                                  onClick={() => submitReply(item.id)}
                                  disabled={createReplyMutation.isPending || replyText.trim().length === 0}
                                  className="md:mt-6"
                                >
                                  <Send className="h-4 w-4 mr-1" />
                                  送信
                                </Button>
                              </div>
                            </div>
                          ) : null}
                          {replies.length > 0 ? (
                            <div className="space-y-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                  <MessageSquare className="h-4 w-4" />
                                  返信内容
                                </div>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs text-muted-foreground"
                                  onClick={() => setOpenReplyLists((current) => ({ ...current, [item.id]: !replyListOpen }))}
                                >
                                  {replyListOpen ? "非表示" : "表示"}
                                </Button>
                              </div>
                              {replyListOpen ? (
                                <div className="space-y-2">
                                  {replies.map((reply) => (
                                    <div key={reply.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <span className="font-medium text-slate-700">{formatAuthorName(reply.author)}</span>
                                        <span>{formatDate(reply.createdAt)}</span>
                                      </div>
                                      <div className="whitespace-pre-wrap text-sm leading-6">{reply.body}</div>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ) : null}
                          <div className="text-xs text-muted-foreground">
                            登録: {formatDate(item.createdAt)} / 記入者: {formatAuthorName(item.createdBy)}
                            {item.completedAt ? ` / 完了: ${formatDate(item.completedAt)}` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-start gap-1">
                        <div className="flex flex-col gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setEditingItemId(editingItemId === item.id ? null : item.id)}
                          >
                            <Pencil className="h-4 w-4 mr-1" />
                            編集
                          </Button>
                          <Button
                            type="button"
                            variant={replyFormOpen ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => setOpenReplyForms((current) => ({ ...current, [item.id]: !replyFormOpen }))}
                          >
                            <MessageSquare className="h-4 w-4 mr-1" />
                            返信
                          </Button>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          onClick={() => {
                            if (editingItemId === item.id) setEditingItemId(null);
                            deleteMutation.mutate({ id: item.id });
                          }}
                          aria-label="削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                {editingItemId === item.id ? (
                  <ActionItemForm
                    mode="edit"
                    initialItem={{
                      id: item.id,
                      title: item.title,
                      assignee: item.assignee,
                      detail: item.detail,
                      createdBy: item.createdBy,
                    }}
                    onUpdated={() => {
                      setEditingItemId(null);
                      refetch();
                    }}
                    onCancel={() => setEditingItemId(null)}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
