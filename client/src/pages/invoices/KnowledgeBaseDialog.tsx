import { useState, useRef, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { MessageSquare } from "lucide-react";
import type { InvoiceItem } from "./types";
import { KnowledgeFilePicker } from "./KnowledgeFilePicker";
import { KnowledgePendingFiles } from "./KnowledgePendingFiles";
import type { PendingKnowledgeFile } from "./KnowledgePendingFiles";
import { KnowledgeHistory } from "./KnowledgeHistory";
import { KnowledgeChat } from "./KnowledgeChat";
import type { KnowledgeChatMessage } from "./KnowledgeChat";
import { KnowledgeConversations } from "./KnowledgeConversations";
import { KnowledgeLatestNumber } from "./KnowledgeLatestNumber";
import type { KnowledgeLatestNumberResult } from "./KnowledgeLatestNumber";

const getTodayStr = () => new Date().toISOString().slice(0, 10);

export function KnowledgeBaseDialog({
  open,
  onClose,
  onNewWithNumber,
}: {
  open: boolean;
  onClose: () => void;
  onNewWithNumber: (num: string, items?: InvoiceItem[]) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFiles, setPendingFiles] = useState<PendingKnowledgeFile[]>([]);
  const [editingNameIdx, setEditingNameIdx] = useState<number | null>(null);
  const [editingNameValue, setEditingNameValue] = useState<string>("");
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"upload" | "chat">("upload");
  const [chatInput, setChatInput] = useState("");
  // Conversation session management
  const [activeConversationId, setActiveConversationId] = useState<
    number | null
  >(null);
  const [chatHistory, setChatHistory] = useState<KnowledgeChatMessage[]>([]);
  const [latestNumberResult, setLatestNumberResult] =
    useState<KnowledgeLatestNumberResult | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const { data: knowledgeList = [], refetch: refetchList } =
    trpc.knowledgeBase.list.useQuery();

  // Conversations list
  const { data: conversations = [], refetch: refetchConversations } =
    trpc.knowledgeBase.listConversations.useQuery();

  // Load chat history for active conversation
  const { data: persistedHistory } = trpc.knowledgeBase.getChatHistory.useQuery(
    activeConversationId ? { conversationId: activeConversationId } : undefined,
    { enabled: activeConversationId !== null }
  );

  // Sync DB history to local state when conversation changes
  useEffect(() => {
    if (activeConversationId === null) {
      setChatHistory([]);
      return;
    }
    if (persistedHistory !== undefined) {
      setChatHistory(
        persistedHistory.map((m: any) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        }))
      );
    }
  }, [persistedHistory, activeConversationId]);

  const createConversationMutation =
    trpc.knowledgeBase.createConversation.useMutation({
      onSuccess: data => {
        setActiveConversationId(data.id);
        setChatHistory([]);
        refetchConversations();
        setActiveTab("chat");
      },
      onError: e => toast.error(`作成エラー: ${e.message}`),
    });

  const deleteConversationMutation =
    trpc.knowledgeBase.deleteConversation.useMutation({
      onSuccess: (_, variables) => {
        if (activeConversationId === variables.id) {
          setActiveConversationId(null);
          setChatHistory([]);
        }
        refetchConversations();
        toast.success("会話を削除しました");
      },
      onError: e => toast.error(`削除エラー: ${e.message}`),
    });

  const uploadMutation = trpc.knowledgeBase.upload.useMutation({
    onSuccess: data => {
      const ok = data.results.filter((r: any) => r.status === "ok").length;
      const err = data.results.filter((r: any) => r.status === "error").length;
      if (ok > 0) toast.success(`${ok}件のファイルを知識ベースに追加しました`);
      if (err > 0) toast.error(`${err}件のファイルでエラーが発生しました`);
      setPendingFiles([]);
      refetchList();
    },
    onError: e => toast.error(`アップロードエラー: ${e.message}`),
  });

  const deleteMutation = trpc.knowledgeBase.delete.useMutation({
    onSuccess: () => {
      toast.success("削除しました");
      refetchList();
    },
    onError: e => toast.error(`削除エラー: ${e.message}`),
  });

  const chatMutation = trpc.knowledgeBase.chat.useMutation({
    onSuccess: data => {
      setChatHistory(prev => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
      refetchConversations();
    },
    onError: e => {
      toast.error(`AIエラー: ${e.message}`);
      setChatHistory(prev => [
        ...prev,
        { role: "assistant", content: `エラーが発生しました: ${e.message}` },
      ]);
    },
  });

  const getLatestNumberMutation =
    trpc.knowledgeBase.getLatestInvoiceNumber.useMutation({
      onSuccess: data => {
        setLatestNumberResult(data);
        if (data.nextNumber) {
          toast.success(
            `最新番号: ${data.invoiceNumber} → 次の番号: ${data.nextNumber}`
          );
        } else {
          toast.info(data.message);
        }
      },
      onError: e => toast.error(`抽出エラー: ${e.message}`),
    });

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const readFile = useCallback(
    (file: File): Promise<Omit<PendingKnowledgeFile, "screenshotDate">> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = e => {
          const base64 = (e.target?.result as string).split(",")[1];
          resolve({
            name: file.name,
            base64,
            mimeType: file.type || "application/octet-stream",
            sizeKB: Math.round(file.size / 1024),
          });
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    },
    []
  );

  const handleFileSelect = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const items: PendingKnowledgeFile[] = [];
      for (const file of Array.from(files)) {
        if (file.size > 10 * 1024 * 1024) {
          toast.error(`${file.name} は10MBを超えています`);
          continue;
        }
        try {
          const data = await readFile(file);
          // 画像ファイルは今日の日付をデフォルトセット
          const screenshotDate = file.type.startsWith("image/")
            ? getTodayStr()
            : undefined;
          items.push({ ...data, screenshotDate });
        } catch (err) {
          toast.error(
            `${file.name} の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
      setPendingFiles(prev => [...prev, ...items]);
    },
    [readFile]
  );

  // Handle Ctrl/Cmd+V paste for screenshots
  useEffect(() => {
    if (!open) return;
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems = Array.from(items).filter(item =>
        item.type.startsWith("image/")
      );
      if (imageItems.length === 0) return;
      e.preventDefault();
      const newFiles: PendingKnowledgeFile[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const data = await readFile(file);
          const ts = new Date()
            .toISOString()
            .replace(/[:.]/g, "-")
            .slice(0, 19);
          newFiles.push({
            ...data,
            name: `screenshot-${ts}.png`,
            screenshotDate: getTodayStr(),
          });
        } catch {
          toast.error("画像の読み込みに失敗しました");
        }
      }
      if (newFiles.length > 0) {
        setPendingFiles(prev => [...prev, ...newFiles]);
        setActiveTab("upload");
        toast.success(`スクリーンショット ${newFiles.length}枚を追加しました`);
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [open, readFile]);

  const handleSendChat = () => {
    const msg = chatInput.trim();
    if (!msg || chatMutation.isPending) return;
    if (!activeConversationId) {
      toast.error("会話を選択するか「新規チャット」を作成してください");
      return;
    }
    setChatHistory(prev => [...prev, { role: "user", content: msg }]);
    setChatInput("");
    chatMutation.mutate({
      message: msg,
      conversationId: activeConversationId,
      history: chatHistory.slice(-10),
    });
  };

  return (
    <Dialog open={open} onOpenChange={o => !o && onClose()}>
      <DialogContent className="max-w-6xl w-[98vw] max-h-[95vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-6 h-6 bg-[#075E54] rounded-md flex items-center justify-center">
              <MessageSquare size={13} className="text-white" />
            </div>
            知識ベース
            <span className="ml-auto text-xs font-normal text-muted-foreground">
              {knowledgeList.length}件学習済み
            </span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            WhatsApp履歴・スクリーンショット・インボイスPDFをアップロードしてAIに学習させます
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex border-b border-border flex-shrink-0">
          {(["upload", "chat"] as const).map(tab => {
            const labels = { upload: "アップロード・管理", chat: "AIチャット" };
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2.5 text-xs font-semibold transition-colors border-b-2 ${
                  activeTab === tab
                    ? "border-[#075E54] text-[#075E54]"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {labels[tab]}
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── Upload & Management Tab ── */}
          {activeTab === "upload" && (
            <div className="p-4 space-y-4">
              {/* Drop zone */}
              <KnowledgeFilePicker
                isDragging={isDragging}
                setIsDragging={setIsDragging}
                handleFileSelect={handleFileSelect}
                fileInputRef={fileInputRef}
              />

              {/* Pending files */}
              <KnowledgePendingFiles
                pendingFiles={pendingFiles}
                setPendingFiles={setPendingFiles}
                editingNameIdx={editingNameIdx}
                editingNameValue={editingNameValue}
                setEditingNameIdx={setEditingNameIdx}
                setEditingNameValue={setEditingNameValue}
                onUpload={() =>
                  uploadMutation.mutate({
                    files: pendingFiles.map(f => ({
                      name: f.name,
                      base64: f.base64,
                      mimeType: f.mimeType,
                      screenshotDate: f.screenshotDate,
                    })),
                  })
                }
                isUploading={uploadMutation.isPending}
              />

              {/* Latest invoice number extraction */}
              <KnowledgeLatestNumber
                knowledgeCount={knowledgeList.length}
                isExtracting={getLatestNumberMutation.isPending}
                latestNumberResult={latestNumberResult}
                onExtract={() => getLatestNumberMutation.mutate()}
                onCreate={() => {
                  onNewWithNumber(String(latestNumberResult!.nextNumber));
                  onClose();
                }}
              />

              {/* Knowledge list */}
              <KnowledgeHistory
                knowledgeList={knowledgeList}
                onDelete={input => deleteMutation.mutate(input)}
              />
            </div>
          )}

          {/* ── AI Chat Tab ── */}
          {activeTab === "chat" && (
            <div className="flex" style={{ height: "480px" }}>
              {/* Left sidebar: conversation list */}
              <KnowledgeConversations
                conversations={conversations}
                activeConversationId={activeConversationId}
                isCreating={createConversationMutation.isPending}
                onCreate={() => createConversationMutation.mutate({})}
                onSelect={id => {
                  setActiveConversationId(id);
                  setChatHistory([]);
                }}
                onDelete={input => deleteConversationMutation.mutate(input)}
              />

              {/* Right: chat area */}
              <KnowledgeChat
                activeConversationId={activeConversationId}
                knowledgeCount={knowledgeList.length}
                chatHistory={chatHistory}
                chatPending={chatMutation.isPending}
                chatBottomRef={chatBottomRef}
                chatInput={chatInput}
                setChatInput={setChatInput}
                handleSendChat={handleSendChat}
              />
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
