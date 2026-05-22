/**
 * KnowledgeBasePage — WhatsApp履歴・インボイスPDF 知識ベース管理
 *
 * 機能:
 *  1. ファイルアップロード（テキスト・画像・PDF を一か所で）
 *  2. 知識ベース一覧（アップロード済みデータの確認・削除）
 *  3. AIチャット（知識ベースを参照して質問に回答）
 *  4. 抽出ボタン（注文抽出 / 支払い検知）
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  Trash2,
  MessageSquare,
  FileText,
  Image,
  File,
  Send,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Sparkles,
  PackageSearch,
  CreditCard,
  X,
  Database,
} from "lucide-react";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────
interface FileItem {
  name: string;
  base64: string;
  mimeType: string;
  sizeKB: number;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getFileIcon(mimeType: string, name: string) {
  if (mimeType.startsWith("image/")) return <Image size={14} className="text-blue-500" />;
  if (mimeType === "application/pdf" || name.toLowerCase().endsWith(".pdf"))
    return <FileText size={14} className="text-red-500" />;
  return <File size={14} className="text-green-500" />;
}

function getSourceTypeLabel(type: string) {
  switch (type) {
    case "chat_text": return { label: "テキスト", color: "bg-green-100 text-green-700" };
    case "screenshot": return { label: "スクショ", color: "bg-blue-100 text-blue-700" };
    case "invoice_pdf": return { label: "PDF", color: "bg-red-100 text-red-700" };
    default: return { label: type, color: "bg-gray-100 text-gray-700" };
  }
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function KnowledgeBasePage() {
  // Upload state
  const [pendingFiles, setPendingFiles] = useState<FileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  // Extraction results
  const [extractionResult, setExtractionResult] = useState<any>(null);
  const [extractionMode, setExtractionMode] = useState<"invoice_items" | "payment_detection" | null>(null);

  // tRPC
  const { data: knowledgeList = [], refetch: refetchList } = trpc.knowledgeBase.list.useQuery();
  const { data: savedChatHistory = [] } = trpc.knowledgeBase.getChatHistory.useQuery();

  const uploadMutation = trpc.knowledgeBase.upload.useMutation({
    onSuccess: (data) => {
      const ok = data.results.filter(r => r.status === "ok").length;
      const err = data.results.filter(r => r.status === "error").length;
      if (ok > 0) toast.success(`${ok}件のファイルを知識ベースに追加しました`);
      if (err > 0) toast.error(`${err}件のファイルでエラーが発生しました`);
      setPendingFiles([]);
      refetchList();
    },
    onError: (e) => toast.error(`アップロードエラー: ${e.message}`),
  });

  const deleteMutation = trpc.knowledgeBase.delete.useMutation({
    onSuccess: () => { toast.success("削除しました"); refetchList(); },
    onError: (e) => toast.error(`削除エラー: ${e.message}`),
  });

  const chatMutation = trpc.knowledgeBase.chat.useMutation({
    onSuccess: (data) => {
      setChatHistory(prev => [...prev, { role: "assistant", content: data.reply }]);
    },
    onError: (e) => {
      toast.error(`AIエラー: ${e.message}`);
      setChatHistory(prev => [...prev, { role: "assistant", content: `エラーが発生しました: ${e.message}` }]);
    },
  });

  const clearChatMutation = trpc.knowledgeBase.clearChatHistory.useMutation({
    onSuccess: () => { setChatHistory([]); toast.success("チャット履歴をクリアしました"); },
  });

  const extractMutation = trpc.knowledgeBase.extractFromKnowledge.useMutation({
    onSuccess: (data) => {
      setExtractionResult(data);
      toast.success("抽出が完了しました");
    },
    onError: (e) => toast.error(`抽出エラー: ${e.message}`),
  });

  // Load saved chat history on mount
  useEffect(() => {
    if (savedChatHistory.length > 0 && chatHistory.length === 0) {
      setChatHistory(savedChatHistory.map(m => ({ role: m.role as "user" | "assistant", content: m.content })));
    }
  }, [savedChatHistory]);

  // Auto-scroll chat
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  // File reading helper
  const readFile = useCallback((file: File): Promise<FileItem> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
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
  }, []);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const MAX_SIZE_MB = 10;
    const items: FileItem[] = [];
    for (const file of Array.from(files)) {
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        toast.error(`${file.name} は${MAX_SIZE_MB}MBを超えています`);
        continue;
      }
      try {
        const item = await readFile(file);
        items.push(item);
      } catch {
        toast.error(`${file.name} の読み込みに失敗しました`);
      }
    }
    setPendingFiles(prev => [...prev, ...items]);
  }, [readFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleUpload = () => {
    if (pendingFiles.length === 0) return;
    uploadMutation.mutate({ files: pendingFiles.map(f => ({ name: f.name, base64: f.base64, mimeType: f.mimeType })) });
  };

  const handleSendChat = () => {
    const msg = chatInput.trim();
    if (!msg) return;
    setChatHistory(prev => [...prev, { role: "user", content: msg }]);
    setChatInput("");
    chatMutation.mutate({
      message: msg,
      history: chatHistory.slice(-10), // last 10 messages as context
    });
  };

  const handleExtract = (mode: "invoice_items" | "payment_detection") => {
    setExtractionMode(mode);
    setExtractionResult(null);
    extractMutation.mutate({ mode });
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-border shadow-sm">
        <div className="container">
          <div className="flex items-center h-14 gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 bg-[#075E54] rounded-md flex items-center justify-center shadow-sm">
                <Database size={14} className="text-white" />
              </div>
              <div>
                <h1 className="text-sm font-bold text-foreground leading-tight">WhatsApp 知識ベース</h1>
                <p className="text-[10px] text-muted-foreground leading-tight">履歴学習・AI解析・チャット</p>
              </div>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                <Database size={10} className="mr-1" />
                {knowledgeList.length} 件学習済み
              </Badge>
            </div>
          </div>
        </div>
      </header>

      <main className="container py-4 space-y-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ─── Left: Upload + Knowledge List ─── */}
          <div className="space-y-4">
            {/* Upload Panel */}
            <div className="bg-white rounded-lg border border-border shadow-sm p-4">
              <h2 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                <Upload size={14} className="text-[#075E54]" />
                ファイルをアップロード
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                WhatsAppの履歴テキスト（_chat.txt）、スクリーンショット（画像）、インボイスPDFをまとめてアップロードできます。
                AIが内容を解析して知識ベースに保存します。
              </p>

              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  isDragging ? "border-[#075E54] bg-[#075E54]/5" : "border-border hover:border-[#075E54]/50 hover:bg-muted/30"
                }`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={24} className="mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">ファイルをドロップ または クリックして選択</p>
                <p className="text-xs text-muted-foreground mt-1">
                  .txt（チャット履歴）/ 画像（スクショ）/ .pdf（インボイス）対応 · 最大10MB
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept=".txt,.pdf,image/*"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e.target.files)}
                />
              </div>

              {/* Pending files */}
              {pendingFiles.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  <p className="text-xs font-semibold text-foreground">アップロード待ち ({pendingFiles.length}件)</p>
                  {pendingFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 bg-muted/40 rounded px-2 py-1.5">
                      {getFileIcon(f.mimeType, f.name)}
                      <span className="text-xs text-foreground flex-1 truncate">{f.name}</span>
                      <span className="text-[10px] text-muted-foreground">{f.sizeKB}KB</span>
                      <button onClick={() => setPendingFiles(prev => prev.filter((_, j) => j !== i))}>
                        <X size={12} className="text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                  <Button
                    className="w-full mt-2 bg-[#075E54] hover:bg-[#075E54]/90 text-white"
                    size="sm"
                    onClick={handleUpload}
                    disabled={uploadMutation.isPending}
                  >
                    {uploadMutation.isPending ? (
                      <><RefreshCw size={13} className="animate-spin mr-1.5" />AI解析中...</>
                    ) : (
                      <><Sparkles size={13} className="mr-1.5" />知識ベースに追加 ({pendingFiles.length}件)</>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Extraction Buttons */}
            <div className="bg-white rounded-lg border border-border shadow-sm p-4">
              <h2 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                <Sparkles size={14} className="text-[#075E54]" />
                知識ベースから抽出
              </h2>
              <p className="text-xs text-muted-foreground mb-3">
                学習済みデータをもとに、AIが注文内容や支払い情報を自動で抽出します。
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => handleExtract("invoice_items")}
                  disabled={extractMutation.isPending || knowledgeList.length === 0}
                >
                  {extractMutation.isPending && extractionMode === "invoice_items" ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <PackageSearch size={13} />
                  )}
                  注文・品目を抽出
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-1 gap-1.5"
                  onClick={() => handleExtract("payment_detection")}
                  disabled={extractMutation.isPending || knowledgeList.length === 0}
                >
                  {extractMutation.isPending && extractionMode === "payment_detection" ? (
                    <RefreshCw size={13} className="animate-spin" />
                  ) : (
                    <CreditCard size={13} />
                  )}
                  支払い検知
                </Button>
              </div>

              {/* Extraction Results */}
              {extractionResult && (
                <div className="mt-3 border border-border rounded-lg overflow-hidden">
                  <div className="bg-muted/40 px-3 py-2 flex items-center justify-between">
                    <span className="text-xs font-semibold">
                      {extractionMode === "invoice_items" ? "注文・品目 抽出結果" : "支払い検知 結果"}
                    </span>
                    <button onClick={() => setExtractionResult(null)}>
                      <X size={12} className="text-muted-foreground hover:text-foreground" />
                    </button>
                  </div>
                  <div className="p-3 max-h-64 overflow-y-auto">
                    {extractionMode === "invoice_items" && extractionResult.orders && (
                      extractionResult.orders.length === 0 ? (
                        <p className="text-xs text-muted-foreground">未作成の注文は見つかりませんでした</p>
                      ) : (
                        <div className="space-y-2">
                          {extractionResult.orders.map((order: any, i: number) => (
                            <div key={i} className="bg-muted/30 rounded p-2 text-xs">
                              <div className="font-semibold text-foreground">{order.description}</div>
                              <div className="text-muted-foreground mt-0.5">
                                {order.quantity}個 × {order.currency} {order.unitPrice}
                                {order.buyer && ` · 購入者: ${order.buyer}`}
                                {order.invoiceNumber && ` · Invoice: ${order.invoiceNumber}`}
                              </div>
                              {order.rawText && (
                                <div className="text-[10px] text-muted-foreground/70 mt-1 truncate">{order.rawText}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    )}
                    {extractionMode === "payment_detection" && extractionResult.payments && (
                      extractionResult.payments.length === 0 ? (
                        <p className="text-xs text-muted-foreground">支払い記録は見つかりませんでした</p>
                      ) : (
                        <div className="space-y-2">
                          {extractionResult.payments.map((p: any, i: number) => (
                            <div key={i} className="bg-muted/30 rounded p-2 text-xs">
                              <div className="flex items-center gap-2">
                                <CheckCircle2 size={12} className={p.confidence === "high" ? "text-green-500" : "text-yellow-500"} />
                                <span className="font-semibold">Invoice {p.invoiceNumber}</span>
                                {p.amount && <span className="text-muted-foreground">{p.currency} {p.amount}</span>}
                              </div>
                              {p.paidBy && <div className="text-muted-foreground mt-0.5">支払者: {p.paidBy}</div>}
                              {p.date && <div className="text-muted-foreground">日付: {p.date}</div>}
                              {p.rawText && (
                                <div className="text-[10px] text-muted-foreground/70 mt-1 truncate">{p.rawText}</div>
                              )}
                            </div>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Knowledge List */}
            <div className="bg-white rounded-lg border border-border shadow-sm p-4">
              <h2 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                <Database size={14} className="text-[#075E54]" />
                学習済みデータ一覧
                <span className="ml-auto text-xs font-normal text-muted-foreground">{knowledgeList.length}件</span>
              </h2>
              {knowledgeList.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Database size={32} className="mx-auto mb-2 opacity-30" />
                  <p className="text-sm">まだデータがありません</p>
                  <p className="text-xs mt-1">上のエリアからファイルをアップロードしてください</p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {knowledgeList.map((item) => {
                    const { label, color } = getSourceTypeLabel(item.sourceType);
                    return (
                      <div key={item.id} className="flex items-center gap-2 bg-muted/30 rounded px-2 py-1.5">
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${color}`}>{label}</span>
                        <span className="text-xs text-foreground flex-1 truncate">{item.sourceLabel ?? "不明"}</span>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">
                          {new Date(item.createdAt).toLocaleDateString("ja-JP")}
                        </span>
                        <button
                          onClick={() => {
                            if (confirm(`「${item.sourceLabel}」を削除しますか？`)) {
                              deleteMutation.mutate({ id: item.id });
                            }
                          }}
                          className="flex-shrink-0"
                        >
                          <Trash2 size={12} className="text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* ─── Right: AI Chat ─── */}
          <div className="bg-white rounded-lg border border-border shadow-sm flex flex-col" style={{ minHeight: "600px" }}>
            {/* Chat header */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <div className="w-6 h-6 bg-[#075E54] rounded-full flex items-center justify-center">
                <MessageSquare size={12} className="text-white" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">AIアシスタント</p>
                <p className="text-[10px] text-muted-foreground">知識ベースを参照して回答します</p>
              </div>
              <div className="ml-auto">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground"
                  onClick={() => clearChatMutation.mutate()}
                  disabled={chatHistory.length === 0}
                >
                  <Trash2 size={11} className="mr-1" />
                  クリア
                </Button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {chatHistory.length === 0 && (
                <div className="text-center py-12 text-muted-foreground">
                  <MessageSquare size={40} className="mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">AIに質問してみましょう</p>
                  <div className="mt-4 space-y-2">
                    {[
                      "Vita2000の価格について最近ルカさんとどんな会話をしましたか？",
                      "未払いのインボイスはありますか？",
                      "最近の注文内容を教えてください",
                    ].map((suggestion, i) => (
                      <button
                        key={i}
                        className="block w-full text-left text-xs bg-muted/40 hover:bg-muted/70 rounded-lg px-3 py-2 transition-colors"
                        onClick={() => setChatInput(suggestion)}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                  {knowledgeList.length === 0 && (
                    <p className="text-xs mt-4 text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
                      ⚠️ まだ知識ベースが空です。先にファイルをアップロードしてください。
                    </p>
                  )}
                </div>
              )}
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-[#075E54] text-white rounded-tr-sm"
                        : "bg-muted text-foreground rounded-tl-sm"
                    }`}
                  >
                    <p className="whitespace-pre-wrap text-xs leading-relaxed">{msg.content}</p>
                  </div>
                </div>
              ))}
              {chatMutation.isPending && (
                <div className="flex justify-start">
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-3 py-2">
                    <div className="flex gap-1 items-center">
                      <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]" />
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="border-t border-border p-3">
              <div className="flex gap-2">
                <Textarea
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  placeholder="質問を入力してください... (Enter で送信、Shift+Enter で改行)"
                  className="resize-none text-sm min-h-[60px] max-h-[120px]"
                  rows={2}
                />
                <Button
                  className="bg-[#075E54] hover:bg-[#075E54]/90 text-white px-3 self-end"
                  size="sm"
                  onClick={handleSendChat}
                  disabled={!chatInput.trim() || chatMutation.isPending}
                >
                  <Send size={14} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
