import { useMemo, useState, type ClipboardEvent, type ReactNode } from "react";
import { CheckCircle2, ClipboardCheck, ExternalLink, ImagePlus, MessageSquare, Paperclip, Pencil, Pin, PinOff, RefreshCw, Search, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { ActionItemForm } from "@/inventory/components/ActionItemForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  fileToActionItemAttachment,
  getImageFilesFromClipboard,
  toActionItemAttachmentPayloads,
  type ActionItemAttachmentDraft,
} from "@/inventory/lib/actionItemAttachments";
import { normalizeExternalUrl } from "@/inventory/lib/supplier";
import { trpc } from "@/lib/trpc";

type StatusFilter = "open" | "done" | "all";
type AttachmentPreview = {
  url: string;
  fileName?: string | null;
};
const ASSIGNEE_ORDER = ["全員", "仕入れ担当", "荷受担当", "出荷担当"];
const ALL_REVIEWERS = ["村上さん", "鈴木さん", "藤本さん", "野田さん"] as const;
type ReviewerName = (typeof ALL_REVIEWERS)[number];
const SHIPPING_REVIEWERS: ReviewerName[] = ["鈴木さん", "藤本さん"];
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
    全員: "border-violet-200 bg-violet-50 text-violet-700",
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

const DETAIL_EXTERNAL_LINK_RE = /\[([^\]\n]{1,40})\]\((https?:\/\/[^\s)]+)\)/g;

function normalizeSafeDetailUrl(url: string) {
  const normalized = normalizeExternalUrl(url);
  try {
    const parsed = new URL(normalized);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function renderDetailLine(line: string) {
  const parts: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of line.matchAll(DETAIL_EXTERNAL_LINK_RE)) {
    const [raw, label, rawUrl] = match;
    const index = match.index ?? 0;
    const url = normalizeSafeDetailUrl(rawUrl);
    if (!url) continue;

    if (index > lastIndex) parts.push(line.slice(lastIndex, index));
    parts.push(
      <Button
        key={`${index}-${url}`}
        type="button"
        variant="link"
        className="h-auto p-0 align-baseline text-sm"
        onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
      >
        {label}
        <ExternalLink className="ml-1 h-3 w-3" />
      </Button>
    );
    lastIndex = index + raw.length;
  }

  if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  return parts.length > 0 ? parts : line || "\u00a0";
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
              renderDetailLine(line)
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

function normalizePersonName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/[ 　]/g, "").replace(/さん$/, "").replace(/様$/, "");
}

function getCheckReviewers(item: { assignee?: string | null; createdBy?: string | null }): ReviewerName[] {
  if (item.assignee === "出荷担当") return SHIPPING_REVIEWERS;
  if (item.assignee !== "全員") return [];
  const author = normalizePersonName(item.createdBy);
  return ALL_REVIEWERS.filter((reviewer) => normalizePersonName(reviewer) !== author);
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
  const [hasRepliesOnly, setHasRepliesOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [editingItemId, setEditingItemId] = useState<number | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});
  const [replyAuthors, setReplyAuthors] = useState<Record<number, string>>({});
  const [openReplyForms, setOpenReplyForms] = useState<Record<number, boolean>>({});
  const [openReplyLists, setOpenReplyLists] = useState<Record<number, boolean>>({});
  const [editingReplyId, setEditingReplyId] = useState<number | null>(null);
  const [replyEditDrafts, setReplyEditDrafts] = useState<Record<number, string>>({});
  const [replyEditAuthors, setReplyEditAuthors] = useState<Record<number, string>>({});
  const [uploadingAttachmentItemId, setUploadingAttachmentItemId] = useState<number | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<AttachmentPreview | null>(null);
  const queryStatus = hasRepliesOnly ? "all" : status;
  const { data: items = [], isLoading, refetch, isFetching } = trpc.inventory.actionItems.list.useQuery({ status: queryStatus });
  const { data: actionOptions } = trpc.inventory.actionItems.options.useQuery();
  const authorOptions = actionOptions?.authors ?? [];

  const setStatusMutation = trpc.inventory.actionItems.setStatus.useMutation({
    onSuccess: async () => {
      await utils.inventory.actionItems.list.invalidate();
    },
    onError: (error) => toast.error(`更新失敗: ${error.message}`),
  });

  const setPinnedMutation = trpc.inventory.actionItems.setPinned.useMutation({
    onSuccess: async (_, variables) => {
      await utils.inventory.actionItems.list.invalidate();
      toast.success(variables.pinned ? "ピン留めしました" : "ピン留めを解除しました");
    },
    onError: (error) => toast.error(`ピン留め更新失敗: ${error.message}`),
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

  const addAttachmentsMutation = trpc.inventory.actionItems.addAttachments.useMutation({
    onSuccess: async (_, variables) => {
      toast.success(`添付を${variables.attachments.length}件追加しました`);
      await utils.inventory.actionItems.list.invalidate();
    },
    onError: (error) => toast.error(`添付失敗: ${error.message}`),
    onSettled: () => setUploadingAttachmentItemId(null),
  });

  const deleteAttachmentMutation = trpc.inventory.actionItems.deleteAttachment.useMutation({
    onSuccess: async () => {
      toast.success("添付を削除しました");
      await utils.inventory.actionItems.list.invalidate();
    },
    onError: (error) => toast.error(`添付削除失敗: ${error.message}`),
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

  const updateReplyMutation = trpc.inventory.actionItems.updateReply.useMutation({
    onSuccess: async (_, variables) => {
      setEditingReplyId(null);
      setReplyEditDrafts((current) => ({ ...current, [variables.id]: "" }));
      setReplyEditAuthors((current) => ({ ...current, [variables.id]: "" }));
      await utils.inventory.actionItems.list.invalidate();
      toast.success("返信を保存しました");
    },
    onError: (error) => toast.error(`返信保存失敗: ${error.message}`),
  });

  const defaultReplyAuthor = useMemo(() => {
    return authorOptions.find((item) => item.name === "村上")?.name ?? authorOptions[0]?.name ?? "";
  }, [authorOptions]);

  const assigneeOptions = useMemo(() => {
    const assignees = Array.from(
      new Set([...ASSIGNEE_ORDER, ...items.map((item) => item.assignee || "未設定")]),
    ).filter((assignee) => assignee !== "その他");
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
      (!hasRepliesOnly || (item.replies?.length ?? 0) > 0) &&
      (assigneeFilter === "all" || (item.assignee || "未設定") === assigneeFilter) &&
      (!q ||
        item.title.toLowerCase().includes(q) ||
        (item.assignee || "").toLowerCase().includes(q) ||
        (item.createdBy || "").toLowerCase().includes(q) ||
        item.detail.toLowerCase().includes(q) ||
        (item.attachments ?? []).some((attachment) => (attachment.fileName || "").toLowerCase().includes(q))),
    );
  }, [assigneeFilter, hasRepliesOnly, items, search]);

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const pinDiff = Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned));
      if (pinDiff !== 0) return pinDiff;
      return getTimestamp(b.createdAt) - getTimestamp(a.createdAt);
    });
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

  const startReplyEdit = (reply: { id: number; body: string; author?: string | null }) => {
    setEditingReplyId(reply.id);
    setReplyEditDrafts((current) => ({ ...current, [reply.id]: reply.body }));
    setReplyEditAuthors((current) => ({ ...current, [reply.id]: reply.author || defaultReplyAuthor }));
  };

  const submitReplyEdit = (replyId: number) => {
    const body = (replyEditDrafts[replyId] ?? "").trim();
    if (!body) {
      toast.error("返信を入力してください");
      return;
    }
    const author = replyEditAuthors[replyId] || defaultReplyAuthor;
    if (!author) {
      toast.error("記入者を選択してください");
      return;
    }
    updateReplyMutation.mutate({ id: replyId, body, author });
  };

  const uploadAttachments = async (itemId: number, selectedFiles: File[]) => {
    if (selectedFiles.length === 0) return;
    setUploadingAttachmentItemId(itemId);
    const drafts: ActionItemAttachmentDraft[] = [];
    for (const file of selectedFiles) {
      try {
        drafts.push(await fileToActionItemAttachment(file));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "画像の読み込みに失敗しました");
      }
    }
    if (drafts.length === 0) {
      setUploadingAttachmentItemId(null);
      return;
    }
    addAttachmentsMutation.mutate({
      actionItemId: itemId,
      attachments: toActionItemAttachmentPayloads(drafts),
    });
  };

  const handleItemAttachmentPaste = (itemId: number, event: ClipboardEvent<HTMLDivElement>) => {
    const files = getImageFilesFromClipboard(event.clipboardData);
    if (files.length === 0) return;
    event.preventDefault();
    void uploadAttachments(itemId, files);
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
              <Button
                type="button"
                size="sm"
                variant={hasRepliesOnly ? "default" : "outline"}
                onClick={() => setHasRepliesOnly((current) => !current)}
              >
                返信済み
              </Button>
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
            const pinned = Boolean(item.isPinned);
            const deliveryLink = getDeliveryHistoryLink(item);
            const reviewerChecks = parseReviewerChecks(item.reviewerChecksJson);
            const replyText = replyDrafts[item.id] ?? "";
            const replies = item.replies ?? [];
            const attachments = item.attachments ?? [];
            const replyFormOpen = Boolean(openReplyForms[item.id]);
            const replyListOpen = openReplyLists[item.id] ?? true;
            const attachmentInputId = `action-item-attachment-${item.id}`;
            const checkReviewers = getCheckReviewers(item);
            return (
              <div key={item.id} className="space-y-2">
                <Card className={`rounded-lg ${done ? "opacity-65" : ""}`}>
                  <CardContent
                    className="p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    tabIndex={0}
                    onPaste={(event) => handleItemAttachmentPaste(item.id, event)}
                  >
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
                            {pinned ? (
                              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-700">
                                <Pin className="mr-1 h-3 w-3" />
                                ピン留め
                              </Badge>
                            ) : null}
                            {checkReviewers.length > 0 ? (
                              <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs">
                                {checkReviewers.map((reviewer) => (
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
                            {attachments.length > 0 ? (
                              <Badge variant="outline" className="bg-white">
                                <Paperclip className="h-3 w-3 mr-1" />
                                添付 {attachments.length}件
                              </Badge>
                            ) : null}
                          </div>
                          <ActionItemDetail detail={item.detail} deliveryLink={deliveryLink} onNavigate={setLocation} />
                          {attachments.length > 0 ? (
                            <div className="space-y-2">
                              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                                <Paperclip className="h-4 w-4" />
                                添付 {attachments.length}件
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {attachments.map((attachment) => (
                                  <div key={attachment.id} className="relative h-20 w-20 overflow-hidden rounded-md border bg-slate-50">
                                    <button
                                      type="button"
                                      className="block h-full w-full"
                                      onClick={() => setPreviewAttachment({ url: attachment.url, fileName: attachment.fileName })}
                                    >
                                      <img
                                        src={attachment.url}
                                        alt={attachment.fileName || "添付画像"}
                                        className="h-full w-full object-cover"
                                        loading="lazy"
                                      />
                                    </button>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="icon-sm"
                                      className="absolute right-1 top-1 h-6 w-6 bg-white/90 text-destructive shadow"
                                      onClick={() => deleteAttachmentMutation.mutate({ id: attachment.id })}
                                      disabled={deleteAttachmentMutation.isPending}
                                      aria-label="添付を削除"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : null}
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
                                  {replies.map((reply) => {
                                    const isEditingReply = editingReplyId === reply.id;
                                    const editText = replyEditDrafts[reply.id] ?? reply.body;
                                    const editAuthor = replyEditAuthors[reply.id] ?? reply.author ?? defaultReplyAuthor;
                                    return (
                                      <div key={reply.id} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-medium text-slate-700">{formatAuthorName(reply.author)}</span>
                                            <span>{formatDate(reply.createdAt)}</span>
                                          </div>
                                          {!isEditingReply ? (
                                            <Button
                                              type="button"
                                              variant="ghost"
                                              size="sm"
                                              className="h-7 px-2 text-xs"
                                              onClick={() => startReplyEdit(reply)}
                                            >
                                              <Pencil className="mr-1 h-3 w-3" />
                                              編集
                                            </Button>
                                          ) : null}
                                        </div>
                                        {isEditingReply ? (
                                          <div className="space-y-2">
                                            <div className="grid gap-2 md:grid-cols-[150px_1fr]">
                                              <div className="space-y-1">
                                                <div className="text-xs font-medium text-muted-foreground">記入者</div>
                                                <select
                                                  value={editAuthor}
                                                  onChange={(event) =>
                                                    setReplyEditAuthors((current) => ({ ...current, [reply.id]: event.target.value }))
                                                  }
                                                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-sm"
                                                >
                                                  {authorOptions.map((author) => (
                                                    <option key={author.id} value={author.name}>
                                                      {author.name}
                                                    </option>
                                                  ))}
                                                  {editAuthor && !authorOptions.some((author) => author.name === editAuthor) ? (
                                                    <option value={editAuthor}>{editAuthor}</option>
                                                  ) : null}
                                                </select>
                                              </div>
                                              <Textarea
                                                value={editText}
                                                onChange={(event) =>
                                                  setReplyEditDrafts((current) => ({ ...current, [reply.id]: event.target.value }))
                                                }
                                                className="min-h-[72px]"
                                              />
                                            </div>
                                            <div className="flex justify-end gap-2">
                                              <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setEditingReplyId(null)}
                                              >
                                                キャンセル
                                              </Button>
                                              <Button
                                                type="button"
                                                size="sm"
                                                onClick={() => submitReplyEdit(reply.id)}
                                                disabled={updateReplyMutation.isPending || editText.trim().length === 0}
                                              >
                                                保存
                                              </Button>
                                            </div>
                                          </div>
                                        ) : (
                                          <div className="whitespace-pre-wrap text-sm leading-6">{reply.body}</div>
                                        )}
                                      </div>
                                    );
                                  })}
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
                            variant={pinned ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => setPinnedMutation.mutate({ id: item.id, pinned: !pinned })}
                            disabled={setPinnedMutation.isPending}
                            className={
                              pinned
                                ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                                : "text-muted-foreground"
                            }
                          >
                            {pinned ? <PinOff className="h-4 w-4 mr-1" /> : <Pin className="h-4 w-4 mr-1" />}
                            {pinned ? "ピン解除" : "ピン留め"}
                          </Button>
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
                          <input
                            id={attachmentInputId}
                            type="file"
                            accept="image/*"
                            multiple
                            className="sr-only"
                            onChange={(event) => {
                              void uploadAttachments(item.id, Array.from(event.target.files ?? []));
                              event.currentTarget.value = "";
                            }}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => document.getElementById(attachmentInputId)?.click()}
                            disabled={uploadingAttachmentItemId === item.id}
                          >
                            <ImagePlus className="h-4 w-4 mr-1" />
                            {uploadingAttachmentItemId === item.id ? "追加中" : "添付追加"}
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
      <Dialog open={Boolean(previewAttachment)} onOpenChange={(open) => !open && setPreviewAttachment(null)}>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Paperclip className="h-4 w-4" />
              {previewAttachment?.fileName || "添付プレビュー"}
            </DialogTitle>
          </DialogHeader>
          {previewAttachment ? (
            <div className="rounded-md bg-slate-50 p-2">
              <img
                src={previewAttachment.url}
                alt={previewAttachment.fileName || "添付画像"}
                className="mx-auto max-h-[78dvh] w-auto max-w-full rounded-md object-contain"
              />
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
