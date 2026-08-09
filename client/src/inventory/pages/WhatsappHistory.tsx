/**
 * WhatsApp会話履歴 — 取り込んだやり取りを原文＋日本語訳で読み返す画面。
 *
 * 左: 相手一覧（最終メッセージが新しい順）
 * 右: 会話。原文 / 和訳 / 両方 を切り替えて読む。
 */
import { useEffect, useMemo, useState } from "react";
import {
  Download,
  Languages,
  Loader2,
  MessageSquare,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { trpc } from "@/lib/trpc";

type ViewMode = "both" | "original" | "ja";

const VIEW_MODES: Array<{ value: ViewMode; label: string }> = [
  { value: "both", label: "原文＋和訳" },
  { value: "ja", label: "和訳だけ" },
  { value: "original", label: "原文だけ" },
];

const SELECTED_KEY = "invoice-site-whatsapp-selected-conversation";

/**
 * sentAt には「WhatsAppの画面に出ていた時刻」がそのままUTCとして入っている
 * （取り込み元が壁時計の文字列なので、絶対時刻には変換していない）。
 * したがって表示も必ずUTCとして読む。ローカル時刻で解釈すると9時間ずれる。
 */
const WALL_CLOCK_TZ = "UTC";

function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ja-JP", {
    timeZone: WALL_CLOCK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("ja-JP", {
    timeZone: WALL_CLOCK_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

function formatTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleTimeString("ja-JP", { timeZone: WALL_CLOCK_TZ, hour: "2-digit", minute: "2-digit" });
}

/**
 * WhatsAppの本文には空行が3つ4つ続くことがあり、そのまま出すとバブルが間延びする。
 * 表示のときだけ詰める。DBの原文は触らない（取り込みの重複判定キーが原文由来のため）。
 */
function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

export default function WhatsappHistory() {
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("both");
  const [keyword, setKeyword] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importName, setImportName] = useState("");
  const [importText, setImportText] = useState("");

  const conversationsQuery = trpc.whatsappChats.listConversations.useQuery();
  const conversations = conversationsQuery.data ?? [];

  // 前回開いていた相手を復元する。無ければ先頭。
  useEffect(() => {
    if (selectedId !== null || conversations.length === 0) return;
    const saved = Number(localStorage.getItem(SELECTED_KEY));
    const exists = conversations.some((c) => c.id === saved);
    setSelectedId(exists ? saved : conversations[0].id);
  }, [conversations, selectedId]);

  useEffect(() => {
    if (selectedId !== null) localStorage.setItem(SELECTED_KEY, String(selectedId));
  }, [selectedId]);

  const messagesQuery = trpc.whatsappChats.getMessages.useQuery(
    { conversationId: selectedId ?? 0, keyword: keyword.trim() || undefined },
    { enabled: selectedId !== null },
  );
  const messages = messagesQuery.data ?? [];

  const selected = conversations.find((c) => c.id === selectedId) ?? null;

  const importMutation = trpc.whatsappChats.importChat.useMutation({
    onSuccess: (data) => {
      toast.success(
        `${data.imported}件を取り込みました（重複 ${data.skippedDuplicates}件をスキップ）`,
      );
      setImportOpen(false);
      setImportText("");
      setImportName("");
      setSelectedId(data.conversationId);
      conversationsQuery.refetch();
      messagesQuery.refetch();
    },
    onError: (e) => toast.error(`取り込みエラー: ${e.message}`),
  });

  const translateMutation = trpc.whatsappChats.translate.useMutation({
    onSuccess: (data) => {
      if (data.translated === 0 && data.remaining === 0) {
        toast.info("未翻訳のメッセージはありません");
      } else {
        toast.success(`${data.translated}件を和訳しました（残り ${data.remaining}件）`);
      }
      if (data.failedChunks > 0) toast.warning(`${data.failedChunks}ブロックの翻訳に失敗しました。もう一度実行してください`);
      conversationsQuery.refetch();
      messagesQuery.refetch();
    },
    onError: (e) => toast.error(`翻訳エラー: ${e.message}`),
  });

  const deleteMutation = trpc.whatsappChats.deleteConversation.useMutation({
    onSuccess: () => {
      toast.success("削除しました");
      setSelectedId(null);
      conversationsQuery.refetch();
    },
    onError: (e) => toast.error(`削除エラー: ${e.message}`),
  });

  // 日付が変わるところに区切りを入れる
  const grouped = useMemo(() => {
    const groups: Array<{ day: string; items: typeof messages }> = [];
    for (const message of messages) {
      const day = formatDay(message.sentAt);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(message);
      else groups.push({ day, items: [message] });
    }
    return groups;
  }, [messages]);

  const totalUntranslated = conversations.reduce((sum, c) => sum + c.untranslatedCount, 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <MessageSquare size={20} className="text-green-600" />
            WhatsApp会話履歴
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            バイヤーとのやり取りを取り込んで、原文と日本語訳を並べて読み返せます。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <Download size={14} className="mr-1.5" />
            会話を取り込む
          </Button>
          <Button
            size="sm"
            disabled={translateMutation.isPending || totalUntranslated === 0}
            onClick={() => translateMutation.mutate({ limit: 400 })}
          >
            {translateMutation.isPending ? (
              <Loader2 size={14} className="mr-1.5 animate-spin" />
            ) : (
              <Languages size={14} className="mr-1.5" />
            )}
            未翻訳をまとめて和訳{totalUntranslated > 0 ? `（${totalUntranslated}）` : ""}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
        {/* 相手一覧 */}
        <Card className="h-fit lg:sticky lg:top-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span>相手（{conversations.length}）</span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => conversationsQuery.refetch()}
              >
                <RefreshCw size={13} />
              </Button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {conversationsQuery.isLoading && (
              <div className="p-4 text-sm text-muted-foreground">読み込み中...</div>
            )}
            {!conversationsQuery.isLoading && conversations.length === 0 && (
              <div className="p-4 text-sm text-muted-foreground">
                まだ取り込まれていません。「会話を取り込む」から追加してください。
              </div>
            )}
            <div className="space-y-1">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  className={`w-full text-left rounded-md px-3 py-2 transition-colors ${
                    conversation.id === selectedId ? "bg-emerald-50 ring-1 ring-emerald-200" : "hover:bg-muted"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium leading-snug flex items-center gap-1.5">
                      {conversation.isGroup && <Users size={12} className="text-muted-foreground shrink-0" />}
                      {conversation.name}
                    </span>
                    {conversation.untranslatedCount > 0 && (
                      <Badge variant="outline" className="text-[10px] shrink-0 border-amber-300 text-amber-700">
                        未訳{conversation.untranslatedCount}
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-1">
                    {conversation.messageCount}件 ・ 最終 {formatDateTime(conversation.lastMessageAt)}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* 会話 */}
        <Card>
          <CardHeader className="pb-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">
                {selected ? selected.name : "会話を選んでください"}
              </CardTitle>
              {selected && (
                <div className="flex items-center gap-2">
                  <div className="flex rounded-md border overflow-hidden">
                    {VIEW_MODES.map((mode) => (
                      <button
                        key={mode.value}
                        type="button"
                        onClick={() => setViewMode(mode.value)}
                        className={`px-2.5 py-1 text-[11px] transition-colors ${
                          viewMode === mode.value ? "bg-emerald-600 text-white" : "bg-white hover:bg-muted"
                        }`}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-rose-500"
                    onClick={() => {
                      if (confirm(`「${selected.name}」の履歴を削除しますか？`)) {
                        deleteMutation.mutate({ conversationId: selected.id });
                      }
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              )}
            </div>
            {selected && (
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="原文・和訳・送信者から探す"
                    className="pl-8 h-8 text-sm"
                  />
                </div>
                {selected.untranslatedCount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8"
                    disabled={translateMutation.isPending}
                    onClick={() => translateMutation.mutate({ conversationId: selected.id, limit: 400 })}
                  >
                    {translateMutation.isPending ? (
                      <Loader2 size={13} className="mr-1.5 animate-spin" />
                    ) : (
                      <Languages size={13} className="mr-1.5" />
                    )}
                    この相手を和訳
                  </Button>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent>
            {messagesQuery.isLoading && <div className="text-sm text-muted-foreground">読み込み中...</div>}
            {!messagesQuery.isLoading && selected && messages.length === 0 && (
              <div className="text-sm text-muted-foreground">
                {keyword ? "一致するメッセージがありません。" : "メッセージがありません。"}
              </div>
            )}
            <div className="space-y-4">
              {grouped.map((group) => (
                <div key={group.day} className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="h-px bg-border flex-1" />
                    <span className="text-[11px] text-muted-foreground">{group.day}</span>
                    <div className="h-px bg-border flex-1" />
                  </div>
                  {group.items.map((message) => (
                    <div
                      key={message.id}
                      className={`flex ${message.isOutgoing ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-lg px-3 py-2 ${
                          message.isOutgoing ? "bg-emerald-50 border border-emerald-100" : "bg-muted"
                        }`}
                      >
                        <div className="flex items-baseline gap-2 mb-1">
                          <span className="text-[11px] font-medium">
                            {message.isOutgoing ? "自分" : message.sender}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {formatTime(message.sentAt)}
                          </span>
                        </div>
                        {viewMode !== "ja" && (
                          <p className="text-sm whitespace-pre-wrap break-words">{tidy(message.body)}</p>
                        )}
                        {viewMode !== "original" && message.bodyJa && (
                          <p
                            className={`text-sm whitespace-pre-wrap break-words text-slate-600 ${
                              viewMode === "both" ? "mt-1.5 pt-1.5 border-t border-dashed" : ""
                            }`}
                          >
                            {tidy(message.bodyJa)}
                          </p>
                        )}
                        {viewMode === "ja" && !message.bodyJa && (
                          <p className="text-sm whitespace-pre-wrap break-words">{tidy(message.body)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 取り込みダイアログ */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>会話を取り込む</DialogTitle>
            <DialogDescription>
              WhatsAppの「チャットをエクスポート」で書き出した本文、またはコピーしたやり取りを貼り付けてください。
              同じ内容を二重に貼っても重複しません。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium">相手の名前</label>
              <Input
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder="例: ConsoleBros – Orders with Hajime"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium">会話本文</label>
              <Textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder={"[13:32, 2026/7/25] Simon traut: Thank you very much\n[15:48, 2026/7/25] 自分: You're welcome!"}
                className="mt-1 h-64 font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              キャンセル
            </Button>
            <Button
              disabled={!importName.trim() || !importText.trim() || importMutation.isPending}
              onClick={() =>
                importMutation.mutate({ name: importName.trim(), rawText: importText })
              }
            >
              {importMutation.isPending && <Loader2 size={14} className="mr-1.5 animate-spin" />}
              取り込む
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
