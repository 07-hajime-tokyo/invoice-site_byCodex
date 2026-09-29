/**
 * InvoicePage — 請求書発行・管理ページ
 * Features:
 *   - WhatsAppチャット貼り付け → 自動解析 → 請求書生成
 *   - 請求書の編集・保存・削除
 *   - 宛先（クライアント）管理
 *   - freeinvoicebuilder風プレビュー
 *   - PDF出力（印刷ダイアログ）
 *   - 通貨/合計の表示/非表示切替
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Trash2,
  Pencil,
  Eye,
  Printer,
  MessageSquare,
  Users,
  FileText,
  X,
  GripVertical,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Save,
  Settings,
  Upload,
  Download,
  Send,
  Copy,
  Sparkles,
  CheckCheck,
  FileDown,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { InvoiceItem, InvoiceFormData } from "./invoices/types";
import { calcDueDate } from "./invoices/dates";
import { findClientByDetectedSender } from "./invoices/clientRules";
import { InvoicePreview } from "./invoices/InvoicePreview";
import { generateInvoicePdf } from "./invoices/generateInvoicePdf";
import { SenderSettingsDialog } from "./invoices/SenderSettingsDialog";
import { ClientManagerDialog } from "./invoices/ClientManagerDialog";
import { storedInvoiceToForm, storedInvoiceToEditForm } from "./invoices/storedInvoiceForm";
import { invoiceListCurrencies, buildInvoiceRateMap } from "./invoices/listRules";
import { InvoiceCard } from "./invoices/InvoiceCard";
import { addInvoiceItem, updateInvoiceItem, removeInvoiceItem, resolveInvoiceClient, applyInvoiceClient } from "./invoices/editorItems";
import { buildInvoiceSavePayload, buildInvoiceSplitPayload } from "./invoices/editorPayload";
import { computeInvoiceSplits } from "./invoices/splitInvoices";
import { InvoiceMetadata } from "./invoices/InvoiceMetadata";
import { InvoiceItemsEditor } from "./invoices/InvoiceItemsEditor";
import { ScaledPreview, ScaledPreviewFit } from "./invoices/ScaledPreview";
import { EditorToolbar } from "./invoices/EditorToolbar";
import { BackConfirmDialog } from "./invoices/BackConfirmDialog";
import { OverLimitDialog } from "./invoices/OverLimitDialog";
import { SplitPreviewDialog } from "./invoices/SplitPreviewDialog";
import { InvoiceContacts } from "./invoices/InvoiceContacts";
import { KnowledgeFilePicker } from "./invoices/KnowledgeFilePicker";
import { KnowledgePendingFiles } from "./invoices/KnowledgePendingFiles";
import { KnowledgeHistory } from "./invoices/KnowledgeHistory";
import { KnowledgeChat } from "./invoices/KnowledgeChat";
import type { KnowledgeChatMessage } from "./invoices/KnowledgeChat";
import type { PendingKnowledgeFile } from "./invoices/KnowledgePendingFiles";

// ─── Sender Settings Dialog ──────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10);

const EMPTY_FORM: InvoiceFormData = {
  invoiceNumber: "",
  clientId: null,
  invoiceDate: TODAY,
  dueDate: calcDueDate(TODAY),
  currency: "EUR",
  showAmounts: true,
  notes: "",
  rawChat: "",
  status: "draft",
  accentColor: "#db8b1a",
  items: [],
};

// ─── Status badge ─────────────────────────────────────────────────────────────


// ─── Client Manager Dialog ────────────────────────────────────────────────────
// ─── Invoice Preview (print-ready) ───────────────────────────────────────────
// ─── Invoice Editor ───────────────────────────────────────────────────────────
function InvoiceEditor({
  initialData,
  invoiceId,
  onSaved,
  onCancel,
}: {
  initialData: InvoiceFormData;
  invoiceId: number | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const utils = trpc.useUtils();
  const [form, setForm] = useState<InvoiceFormData>(initialData);
  const initialDataRef = useRef(initialData);
  const [showPreview, setShowPreview] = useState(false);
  const [chatText, setChatText] = useState(initialData.rawChat ?? "");
  const [showChatInput, setShowChatInput] = useState(!invoiceId && !initialData.items.length);
  const [chatImagePreview, setChatImagePreview] = useState<string | null>(null);
  const [chatImageBase64, setChatImageBase64] = useState<string | null>(null);
  const [chatImageMime, setChatImageMime] = useState<string>("image/png");
  const previewRef = useRef<HTMLDivElement>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [showBackConfirm, setShowBackConfirm] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [currentInvoiceId, setCurrentInvoiceId] = useState<number | null>(invoiceId);
  // ─── 100万円超過確認ダイアログ
  const [showOverLimitConfirm, setShowOverLimitConfirm] = useState(false);
  const [overLimitJpy, setOverLimitJpy] = useState<number>(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [pendingSavePayload, setPendingSavePayload] = useState<null | any>(null);

  const { data: clients = [] } = trpc.invoiceClients.list.useQuery();
  const { data: senderSettings } = trpc.invoiceSettings.get.useQuery();
  const { data: imageAnalysisStatus } = trpc.invoices.imageAnalysisStatus.useQuery(undefined, {
    staleTime: 10 * 60_000,
  });
  const imageAnalysisEnabled = imageAnalysisStatus?.enabled ?? false;

  // Screenshot analysis mutation for the chat input area
  const chatScreenshotMutation = trpc.invoices.analyzeScreenshot.useMutation({
    onSuccess: (data) => {
      if (data.items.length === 0) {
        toast.error("明細を読み取れませんでした。文字が見える範囲にトリミングして、もう一度試してください。");
        return;
      }
      const matchedClient = findClientByDetectedSender(clients, data.detectedSender);
      const autoClientId = matchedClient?.id ?? null;
      const resultWithExtra = data as typeof data & { totalAmount?: number | null; currency?: string | null };
      setForm(f => ({
        ...f,
        items: data.items.map((item, idx) => ({ ...item, sortOrder: idx })),
        ...(data.invoiceNumbers[0] ? { invoiceNumber: String(data.invoiceNumbers[0]).padStart(4, "0") } : {}),
        ...(resultWithExtra.currency ? { currency: resultWithExtra.currency } : {}),
        ...(autoClientId !== null ? { clientId: autoClientId } : {}),
      }));
      setChatImagePreview(null);
      setChatImageBase64(null);
      setShowChatInput(false);
      const msgs: string[] = [`${data.items.length}件の明細を解析しました`];
      if (matchedClient) msgs.push(`宛先: ${matchedClient.name}`);
      else if (data.detectedSender) msgs.push(`宛先候補: ${data.detectedSender}`);
      if (resultWithExtra.totalAmount) msgs.push(`合計: ${resultWithExtra.currency ?? "EUR"} ${resultWithExtra.totalAmount}`);
      toast.success(msgs.join(" / "));
    },
    onError: (e) => toast.error(e.message || "画像解析に失敗しました"),
  });

  const parseMutation = trpc.invoices.parseWhatsApp.useMutation({
    onSuccess: (data) => {
      const matchedClient = findClientByDetectedSender(clients, data.detectedSender);
      const autoClientId = matchedClient?.id ?? null;
      setForm(f => ({
        ...f,
        invoiceNumber: f.invoiceNumber || data.invoiceNumber,
        rawChat: chatText,
        items: data.items.map((item, idx) => ({ ...item, sortOrder: idx })),
        ...(autoClientId !== null ? { clientId: autoClientId } : {}),
      }));
      setShowChatInput(false);
      const senderMsg = matchedClient
        ? ` (宛先: ${matchedClient.name})`
        : data.detectedSender ? ` (宛先候補: ${data.detectedSender})` : "";
      toast.success(`${data.items.length}件の明細を解析しました${senderMsg}`);
    },
    onError: (e) => toast.error(e.message),
  });

  // ─── 分割インボイス関連の状態
  const [showSplitDialog, setShowSplitDialog] = useState(false);
  const [splitPreview, setSplitPreview] = useState<Array<{ invoiceNumber: string; items: InvoiceItem[]; totalJpy: number }>>([]);
  const [exchangeRateInfo, setExchangeRateInfo] = useState<{ rate: number; date: string } | null>(null);
  const [isFetchingRate, setIsFetchingRate] = useState(false);

  const getExchangeRateQuery = trpc.invoices.getExchangeRate.useQuery(
    { currency: form.currency },
    { enabled: false }
  );

  const createSplitMutation = trpc.invoices.createSplit.useMutation({
    onSuccess: (data) => {
      utils.invoices.list.invalidate();
      toast.success(`${data.count}枚のインボイスを作成しました`);
      setShowSplitDialog(false);
      onSaved();
    },
    onError: (e) => toast.error(e.message),
  });

  // 分割ロジック: 1回100万円以下になるようアイテムを分割する
  const computeSplits = (items: InvoiceItem[], rate: number, limitJpy = 1_000_000) => computeInvoiceSplits(form.invoiceNumber, items, rate, limitJpy);

  const handleOpenSplitDialog = async () => {
    if (!form.invoiceNumber.trim()) { toast.error("インボイス番号は必須です"); return; }
    if (form.items.length === 0) { toast.error("明細を1件以上追加してください"); return; }
    setIsFetchingRate(true);
    try {
      const result = await getExchangeRateQuery.refetch();
      if (!result.data) throw new Error("為替レートの取得に失敗しました");
      const { rate, date } = result.data;
      setExchangeRateInfo({ rate, date });
      const splits = computeSplits(form.items, rate);
      setSplitPreview(splits);
      setShowSplitDialog(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "為替レートの取得に失敗しました");
    } finally {
      setIsFetchingRate(false);
    }
  };

  const handleConfirmSplit = () => {
    const payload = buildInvoiceSplitPayload(form, clients, exchangeRateInfo, splitPreview);
    if (!payload) return;
    createSplitMutation.mutate(payload);
  };

  const createMutation = trpc.invoices.create.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate();
      utils.whatsappHistory.getNextNumber.invalidate();
      toast.success("請求書を保存しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateMutation = trpc.invoices.update.useMutation({
    onSuccess: async (_, variables) => {
      await Promise.all([
        utils.invoices.list.invalidate(),
        utils.invoices.get.invalidate({ id: variables.id }),
      ]);
      toast.success("請求書を更新しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const buildSavePayload = () => buildInvoiceSavePayload(form, clients);

  const persistInvoice = async (payload: ReturnType<typeof buildSavePayload>) => {
    if (currentInvoiceId !== null) {
      await updateMutation.mutateAsync({ id: currentInvoiceId, ...payload });
      return currentInvoiceId;
    }

    const result = await createMutation.mutateAsync(payload);
    const newId = Number(result.id);
    if (Number.isFinite(newId)) {
      setCurrentInvoiceId(newId);
      await utils.invoices.get.invalidate({ id: newId });
    }
    return newId;
  };

  const handleSave = async (skipOverLimitCheck = false, options: { stayOnPage?: boolean } = {}) => {
    if (!form.invoiceNumber.trim()) { toast.error("インボイス番号は必須です"); return; }
    if (form.items.length === 0) { toast.error("明細を1件以上追加してください"); return; }

    const payload = buildSavePayload();

    // ─── 100万円超過チェック（新規作成時のみ・skipフラグなし時）
    if (!skipOverLimitCheck && currentInvoiceId === null) {
      try {
        let totalJpy = 0;
        if (form.currency === "JPY") {
          totalJpy = form.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
        } else {
          const result = await getExchangeRateQuery.refetch();
          if (result.data) {
            totalJpy = form.items.reduce((sum, item) => sum + item.quantity * item.unitPrice * result.data.rate, 0);
          }
        }
        if (totalJpy > 1_000_000) {
          setOverLimitJpy(Math.round(totalJpy));
          setPendingSavePayload(payload);
          setShowOverLimitConfirm(true);
          return;
        }
      } catch {
        // 為替取得失敗時はそのまま保存を続行
      }
    }

    try {
      await persistInvoice(payload);
      initialDataRef.current = form;
      setIsDirty(false);
      if (!options.stayOnPage) onSaved();
      return true;
    } catch {
      return false;
    }
  };

  const addItem = () => { setForm(f => addInvoiceItem(f)); };

  // Track dirty state whenever form changes
  useEffect(() => {
    const orig = JSON.stringify(initialDataRef.current);
    const curr = JSON.stringify(form);
    setIsDirty(orig !== curr);
  }, [form]);

  const updateItem = (idx: number, field: keyof InvoiceItem, value: string | number) => { setForm(f => updateInvoiceItem(f, idx, field, value)); };

  const removeItem = (idx: number) => { setForm(f => removeInvoiceItem(f, idx)); };

  const handleClientChange = useCallback((value: string) => {
    const selection = resolveInvoiceClient(clients, value);
    setForm(f => applyInvoiceClient(f, selection));
  }, [clients]);

  const handlePrint = () => {
    // Set document title to control PDF filename: "Invoice - 0373.pdf"
    const numMatch = form.invoiceNumber.match(/(\d+)$/);
    const numStr = numMatch ? numMatch[1].padStart(4, "0") : form.invoiceNumber;
    const prevTitle = document.title;
    document.title = `Invoice - ${numStr}`;

    // Clone the invoice preview and attach directly to body for printing
    // This bypasses ScaledPreview's transform/overflow constraints
    const previewEl = previewRef.current?.querySelector(".invoice-preview");
    let printRoot: HTMLDivElement | null = null;
    if (previewEl) {
      printRoot = document.createElement("div");
      printRoot.className = "invoice-print-root";
      const cloned = previewEl.cloneNode(true) as HTMLElement;
      // Ensure the cloned element fills the page properly
      cloned.style.transform = "none";
      cloned.style.width = "100%";
      cloned.style.height = "auto";
      cloned.style.overflow = "visible";
      printRoot.appendChild(cloned);
      document.body.appendChild(printRoot);
    }

    const cleanup = () => {
      document.title = prevTitle;
      if (printRoot && document.body.contains(printRoot)) {
        document.body.removeChild(printRoot);
      }
      window.removeEventListener("afterprint", cleanup);
    };

    window.addEventListener("afterprint", cleanup);
    // Fallback cleanup in case afterprint doesn't fire
    setTimeout(cleanup, 5000);

    window.print();
  };

  const selectedClient = clients.find(c => c.id === form.clientId) ?? null;

  // oklch()などhtml2canvasが解析できないカラー関数をRGBに変換するヘルパー
  const inlineComputedStyles = (el: HTMLElement) => {
    const allEls = [el, ...Array.from(el.querySelectorAll("*"))] as HTMLElement[];
    const colorProps = [
      "color", "backgroundColor", "borderColor",
      "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
      "outlineColor", "boxShadow", "textDecorationColor",
    ];
    for (const node of allEls) {
      if (!(node instanceof HTMLElement)) continue;
      const cs = window.getComputedStyle(node);
      for (const prop of colorProps) {
        const val = cs.getPropertyValue(prop);
        if (val && (val.includes("oklch") || val.includes("oklab") || val.includes("color("))) {
          // computedStyleはブラウザがRGBに変換済みのはずだが、念のためセット
          (node.style as unknown as Record<string, string>)[prop] = val;
        }
      }
    }
  };

  const handleSavePdf = async () => {
    setIsPdfLoading(true);
    try {
      const saved = await handleSave(false, { stayOnPage: true });
      if (!saved) return;
      const selectedClient = clients.find(c => c.id === form.clientId) ?? null;
      await generateInvoicePdf(form, selectedClient, senderSettings ?? null);
    } catch (err) {
      console.error("PDF error:", err);
      toast.error(`PDF生成エラー: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsPdfLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <EditorToolbar
        showPreview={showPreview}
        isPdfLoading={isPdfLoading}
        isFetchingRate={isFetchingRate}
        isSaving={createMutation.isPending || updateMutation.isPending}
        onBack={() => {
          if (isDirty) {
            setShowBackConfirm(true);
          } else {
            onCancel();
          }
        }}
        onTogglePreview={() => setShowPreview(!showPreview)}
        onPdf={handleSavePdf}
        onSplit={handleOpenSplitDialog}
        onSave={() => handleSave()}
      >
        <BackConfirmDialog
          open={showBackConfirm}
          onOpenChange={setShowBackConfirm}
          isSaving={createMutation.isPending || updateMutation.isPending}
          onDiscard={() => {
            setShowBackConfirm(false);
            onCancel();
          }}
          onSave={() => {
            setShowBackConfirm(false);
            handleSave();
          }}
        />
      </EditorToolbar>

      {/* 100万円超過確認ダイアログ */}
      <OverLimitDialog
        open={showOverLimitConfirm}
        onOpenChange={setShowOverLimitConfirm}
        overLimitJpy={overLimitJpy}
        onSave={async () => {
          setShowOverLimitConfirm(false);
          if (pendingSavePayload) {
            try {
              await persistInvoice(pendingSavePayload);
              setPendingSavePayload(null);
              onSaved();
            } catch {
              // mutation error toast is handled by tRPC callbacks
            }
          }
        }}
        onSplit={() => {
          setShowOverLimitConfirm(false);
          setPendingSavePayload(null);
          handleOpenSplitDialog();
        }}
      />

      {/* 分割インボイスプレビューダイアログ */}
      <SplitPreviewDialog
        open={showSplitDialog}
        onOpenChange={setShowSplitDialog}
        currency={form.currency}
        exchangeRateInfo={exchangeRateInfo}
        splitPreview={splitPreview}
        isCreating={createMutation.isPending}
        isSplitting={createSplitMutation.isPending}
        onCancel={() => setShowSplitDialog(false)}
        onSave={() => {
          setShowSplitDialog(false);
          handleSave();
        }}
        onConfirm={handleConfirmSplit}
      />

      {/* 常時レンダリング（PDF生成用）：編集モードでは非表示だが DOMに存在 */}      <div
        ref={previewRef}
        className="rounded-lg overflow-hidden shadow-sm"
        style={showPreview ? { display: "inline-block", width: "100%" } : { position: "absolute", left: "-9999px", top: 0, width: "794px", pointerEvents: "none", zIndex: -1 }}
      >
        <ScaledPreview>
          <InvoicePreview form={form} clientData={selectedClient} senderSettings={senderSettings ?? null} />
        </ScaledPreview>
      </div>
      {!showPreview ? (
        /* ── Edit mode ── */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: form */}
          <div className="space-y-4">
            {/* WhatsApp chat input */}
            {showChatInput ? (
              <div
                className="bg-[#075E54]/5 border border-[#075E54]/20 rounded-lg p-4 space-y-3"
                onPaste={e => {
                  const items = Array.from(e.clipboardData?.items ?? []);
                  const imgItem = items.find(it => it.type.startsWith("image/"));
                  if (imgItem) {
                    e.preventDefault();
                    const file = imgItem.getAsFile();
                    if (!file) return;
                    const mime = file.type || "image/png";
                    const reader = new FileReader();
                    reader.onload = ev => {
                      const dataUrl = ev.target?.result as string;
                      const base64 = dataUrl.split(",")[1];
                      setChatImagePreview(dataUrl);
                      setChatImageBase64(base64);
                      setChatImageMime(mime);
                    };
                    reader.readAsDataURL(file);
                  }
                }}
              >
                <div className="flex items-center gap-2 text-sm font-semibold text-[#075E54]">
                  <MessageSquare size={14} />
                  WhatsAppチャット貼り付け
                </div>

                {/* Image mode */}
                {chatImagePreview ? (
                  <div className="space-y-2">
                    <div className="relative">
                      <img src={chatImagePreview} alt="preview" className="w-full max-h-48 object-contain rounded border border-border" />
                      <button
                        className="absolute top-1 right-1 bg-background/80 rounded-full p-0.5 text-destructive hover:bg-destructive/10"
                        onClick={() => { setChatImagePreview(null); setChatImageBase64(null); }}
                      >
                        <X size={12} />
                      </button>
                    </div>
                    {!imageAnalysisEnabled && (
                      <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        画像解析APIが未設定です。無料枠で使う場合は Vercel に GEMINI_API_KEY を設定してください。
                      </p>
                    )}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-8 gap-1 bg-[#075E54] hover:bg-[#075E54]/90"
                        disabled={chatScreenshotMutation.isPending || !imageAnalysisEnabled}
                        onClick={() => {
                          if (!chatImageBase64) return;
                          chatScreenshotMutation.mutate({ base64: chatImageBase64, mimeType: chatImageMime });
                        }}
                      >
                        {chatScreenshotMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <Upload size={12} />}
                        {imageAnalysisEnabled ? "画像を解析して明細を生成" : "画像解析API未設定"}
                      </Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => { setChatImagePreview(null); setChatImageBase64(null); }}>
                        テキストに切替
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* Drop zone for image paste hint */}
                    <div
                      className="border-2 border-dashed border-[#075E54]/30 rounded-lg p-2 text-center cursor-pointer hover:bg-[#075E54]/5 transition-colors"
                      onClick={() => {
                        const input = document.createElement("input");
                        input.type = "file";
                        input.accept = "image/*";
                        input.onchange = () => {
                          const file = input.files?.[0];
                          if (!file) return;
                          const mime = file.type || "image/png";
                          const reader = new FileReader();
                          reader.onload = ev => {
                            const dataUrl = ev.target?.result as string;
                            const base64 = dataUrl.split(",")[1];
                            setChatImagePreview(dataUrl);
                            setChatImageBase64(base64);
                            setChatImageMime(mime);
                          };
                          reader.readAsDataURL(file);
                        };
                        input.click();
                      }}
                    >
                      <p className="text-[10px] text-muted-foreground">📷 スクショを <strong>Ctrl+V</strong> で貼り付け、またはクリックして画像を選択</p>
                    </div>
                    <Textarea
                      value={chatText}
                      onChange={e => setChatText(e.target.value)}
                      placeholder={"[10:52, 2026/3/23] 村上さん: ...\n[21:45, 2026/3/23] +49 177...: Hey, please invoice me\n20 PSVita 2 random color\n10 3DS XL White base\n..."}
                      className="min-h-[140px] text-xs font-mono resize-y"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => parseMutation.mutate({ chatText })} disabled={!chatText.trim() || parseMutation.isPending} className="h-8 gap-1 bg-[#075E54] hover:bg-[#075E54]/90">
                        {parseMutation.isPending ? <RefreshCw size={12} className="animate-spin" /> : <MessageSquare size={12} />}
                        テキストを解析
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setShowChatInput(false)} className="h-8">スキップ</Button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <Button variant="outline" size="sm" onClick={() => setShowChatInput(true)} className="h-8 gap-1 text-[#075E54] border-[#075E54]/30 hover:bg-[#075E54]/5">
                <MessageSquare size={12} /> WhatsAppから再解析
              </Button>
            )}

            {/* Invoice metadata */}
            <InvoiceMetadata form={form} setForm={setForm} />

            {/* Client selection */}
            <InvoiceContacts
              form={form}
              setForm={setForm}
              clients={clients}
              selectedClient={selectedClient}
              handleClientChange={handleClientChange}
            />

            {/* Notes */}

          </div>

          {/* Right: items */}
          <InvoiceItemsEditor form={form} addItem={addItem} updateItem={updateItem} removeItem={removeItem} />
        </div>
      ) : null}

      {/* Print styles */}
      <style>{`
        @page {
          size: A4 portrait;
          margin: 0;
        }
        @media print {
          html, body {
            zoom: 100% !important;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
          }
          body > * { display: none !important; }
          body > .invoice-print-root { display: block !important; }
          .invoice-print-root {
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
            z-index: 9999 !important;
            background: white !important;
          }
          .invoice-print-root .invoice-preview {
            box-shadow: none !important;
            border: none !important;
            transform: none !important;
            width: 100% !important;
            height: auto !important;
            overflow: visible !important;
          }
          .invoice-print-root .scaled-preview-container {
            height: auto !important;
            overflow: visible !important;
          }
          .invoice-print-root .scaled-preview-inner {
            transform: none !important;
            width: 100% !important;
          }
        }
      `}</style>
    </div>
  );
}


// ─── Knowledge Base Dialog (知識ベース・AIチャット) ──────────────────────────────────────────────────────
const getTodayStr = () => new Date().toISOString().slice(0, 10);

function KnowledgeBaseDialog({
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
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [chatHistory, setChatHistory] = useState<KnowledgeChatMessage[]>([]);
  const [latestNumberResult, setLatestNumberResult] = useState<{ invoiceNumber: number | null; nextNumber: number | null; message: string } | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const { data: knowledgeList = [], refetch: refetchList } = trpc.knowledgeBase.list.useQuery();

  // Conversations list
  const { data: conversations = [], refetch: refetchConversations } = trpc.knowledgeBase.listConversations.useQuery();

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
      setChatHistory(persistedHistory.map((m: any) => ({ role: m.role as "user" | "assistant", content: m.content })));
    }
  }, [persistedHistory, activeConversationId]);

  const createConversationMutation = trpc.knowledgeBase.createConversation.useMutation({
    onSuccess: (data) => {
      setActiveConversationId(data.id);
      setChatHistory([]);
      refetchConversations();
      setActiveTab("chat");
    },
    onError: (e) => toast.error(`作成エラー: ${e.message}`),
  });

  const deleteConversationMutation = trpc.knowledgeBase.deleteConversation.useMutation({
    onSuccess: (_, variables) => {
      if (activeConversationId === variables.id) {
        setActiveConversationId(null);
        setChatHistory([]);
      }
      refetchConversations();
      toast.success("会話を削除しました");
    },
    onError: (e) => toast.error(`削除エラー: ${e.message}`),
  });

  const uploadMutation = trpc.knowledgeBase.upload.useMutation({
    onSuccess: (data) => {
      const ok = data.results.filter((r: any) => r.status === "ok").length;
      const err = data.results.filter((r: any) => r.status === "error").length;
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
      refetchConversations();
    },
    onError: (e) => {
      toast.error(`AIエラー: ${e.message}`);
      setChatHistory(prev => [...prev, { role: "assistant", content: `エラーが発生しました: ${e.message}` }]);
    },
  });

  const getLatestNumberMutation = trpc.knowledgeBase.getLatestInvoiceNumber.useMutation({
    onSuccess: (data) => {
      setLatestNumberResult(data);
      if (data.nextNumber) {
        toast.success(`最新番号: ${data.invoiceNumber} → 次の番号: ${data.nextNumber}`);
      } else {
        toast.info(data.message);
      }
    },
    onError: (e) => toast.error(`抽出エラー: ${e.message}`),
  });

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatHistory]);

  const readFile = useCallback((file: File): Promise<Omit<PendingKnowledgeFile, "screenshotDate">> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = (e.target?.result as string).split(",")[1];
        resolve({ name: file.name, base64, mimeType: file.type || "application/octet-stream", sizeKB: Math.round(file.size / 1024) });
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items: PendingKnowledgeFile[] = [];
    for (const file of Array.from(files)) {
      if (file.size > 10 * 1024 * 1024) { toast.error(`${file.name} は10MBを超えています`); continue; }
      try {
        const data = await readFile(file);
        // 画像ファイルは今日の日付をデフォルトセット
        const screenshotDate = file.type.startsWith("image/") ? getTodayStr() : undefined;
        items.push({ ...data, screenshotDate });
      } catch (err) { toast.error(`${file.name} の読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`); }
    }
    setPendingFiles(prev => [...prev, ...items]);
  }, [readFile]);

  // Handle Ctrl/Cmd+V paste for screenshots
  useEffect(() => {
    if (!open) return;
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageItems = Array.from(items).filter(item => item.type.startsWith("image/"));
      if (imageItems.length === 0) return;
      e.preventDefault();
      const newFiles: PendingKnowledgeFile[] = [];
      for (const item of imageItems) {
        const file = item.getAsFile();
        if (!file) continue;
        try {
          const data = await readFile(file);
          const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
          newFiles.push({ ...data, name: `screenshot-${ts}.png`, screenshotDate: getTodayStr() });
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
    chatMutation.mutate({ message: msg, conversationId: activeConversationId, history: chatHistory.slice(-10) });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl w-[98vw] max-h-[95vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 py-4 border-b border-border flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <div className="w-6 h-6 bg-[#075E54] rounded-md flex items-center justify-center">
              <MessageSquare size={13} className="text-white" />
            </div>
            知識ベース
            <span className="ml-auto text-xs font-normal text-muted-foreground">{knowledgeList.length}件学習済み</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            WhatsApp履歴・スクリーンショット・インボイスPDFをアップロードしてAIに学習させます
          </DialogDescription>
        </DialogHeader>

        {/* Tab navigation */}
        <div className="flex border-b border-border flex-shrink-0">
          {(["upload", "chat"] as const).map((tab) => {
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
              <div className="bg-muted/30 rounded-lg p-3 space-y-2">
                <p className="text-xs font-semibold">最新インボイス番号を抽出</p>
                <p className="text-xs text-muted-foreground">知識ベースの学習データからAIが最新のインボイス番号を抽出し、次の番号でインボイスを作成できます。</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-1.5"
                  onClick={() => getLatestNumberMutation.mutate()}
                  disabled={getLatestNumberMutation.isPending || knowledgeList.length === 0}
                >
                  {getLatestNumberMutation.isPending ? (
                    <><RefreshCw size={13} className="animate-spin" />AI解析中...</>
                  ) : (
                    <><Download size={13} />最新インボイス番号を抽出</>
                  )}
                </Button>
                {latestNumberResult && (
                  <div className="bg-background border border-border rounded p-2.5 space-y-1.5">
                    <p className="text-xs text-muted-foreground">{latestNumberResult.message}</p>
                    {latestNumberResult.nextNumber && (
                      <Button
                        size="sm"
                        className="w-full bg-[#075E54] hover:bg-[#075E54]/90 text-white gap-1.5"
                        onClick={() => {
                          onNewWithNumber(String(latestNumberResult.nextNumber));
                          onClose();
                        }}
                      >
                        <Plus size={13} />
                        No.{latestNumberResult.nextNumber} でインボイスを作成
                      </Button>
                    )}
                  </div>
                )}
              </div>

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
              <div className="w-52 flex-shrink-0 border-r border-border flex flex-col bg-muted/20">
                <div className="p-2 border-b border-border">
                  <Button
                    size="sm"
                    className="w-full bg-[#075E54] hover:bg-[#075E54]/90 text-white gap-1.5 text-xs h-8"
                    onClick={() => createConversationMutation.mutate({})}
                    disabled={createConversationMutation.isPending}
                  >
                    <Plus size={13} />
                    新規チャット
                  </Button>
                </div>
                <div className="flex-1 overflow-y-auto p-1 space-y-0.5">
                  {conversations.length === 0 && (
                    <p className="text-[10px] text-muted-foreground text-center py-4">会話がありません</p>
                  )}
                  {conversations.map((conv: any) => (
                    <div
                      key={conv.id}
                      className={`group flex items-center gap-1 rounded px-2 py-1.5 cursor-pointer transition-colors ${
                        activeConversationId === conv.id
                          ? "bg-[#075E54]/10 border border-[#075E54]/20"
                          : "hover:bg-muted/60"
                      }`}
                      onClick={() => {
                        setActiveConversationId(conv.id);
                        setChatHistory([]);
                      }}
                    >
                      <MessageSquare size={11} className="flex-shrink-0 text-muted-foreground" />
                      <span className="text-[11px] flex-1 truncate leading-tight">{conv.title}</span>
                      <button
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`「${conv.title}」を削除しますか？`)) {
                            deleteConversationMutation.mutate({ id: conv.id });
                          }
                        }}
                      >
                        <Trash2 size={10} className="text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

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


// ─// ─── Scaled Preview Wrapper ──────────────────────────────────────────────────────────────────────────────────
// Scales A4 (794px wide) to fit the available container width


// 幅・高さ両方を考慮してモーダル内に収めるプレビューコンポーネント


// ─── Invoice List ──────────────────────────────────────────────────────────────────────────────────────
function InvoiceList({  onNew,
  onNewWithNumber,
  onEdit,
}: {
  onNew: () => void;
  onNewWithNumber: (num: string, items?: InvoiceItem[]) => void;
  onEdit: (id: number) => void;
}) {
  const utils = trpc.useUtils();
  const { data: invoiceList = [], isLoading } = trpc.invoices.list.useQuery();
  const { data: clients = [] } = trpc.invoiceClients.list.useQuery();
  const [showClientManager, setShowClientManager] = useState(false);
  const [showSenderSettings, setShowSenderSettings] = useState(false);
  const [showWhatsAppUpload, setShowWhatsAppUpload] = useState(false);
  const [showDetectDialog, setShowDetectDialog] = useState(false);
  const [detectResult, setDetectResult] = useState<{
    sent: Array<{ invoiceNumber: number; confidence: string; evidence: string }>;
    paid: Array<{ invoiceNumber: number; confidence: string; evidence: string }>;
    message: string;
  } | null>(null);
  const [applyingIds, setApplyingIds] = useState<Set<number>>(new Set());
  const [pdfLoadingId, setPdfLoadingId] = useState<number | null>(null);
  const [showDeletedList, setShowDeletedList] = useState(false);
  const { data: deletedList = [] } = trpc.invoices.listDeleted.useQuery(
    undefined,
    { enabled: showDeletedList }
  );
  const restoreMutation = trpc.invoices.restore.useMutation({
    onSuccess: () => {
      toast.success("インボイスを復元しました");
      utils.invoices.list.invalidate();
      utils.invoices.listDeleted.invalidate();
    },
    onError: () => toast.error("復元に失敗しました"),
  });
  const permanentDeleteMutation = trpc.invoices.permanentDelete.useMutation({
    onSuccess: (data) => {
      toast.success(`${data.invoiceNumber} を完全削除しました（番号は再利用可能になりました）`);
      utils.invoices.list.invalidate();
      utils.invoices.listDeleted.invalidate();
    },
    onError: (e) => toast.error(`完全削除に失敗しました: ${e.message}`),
  });
  const [confirmPermanentDeleteId, setConfirmPermanentDeleteId] = useState<number | null>(null);
  const [previewInvId, setPreviewInvId] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewData, setPreviewData] = useState<{
    form: InvoiceFormData;
    client: { name: string; company?: string | null; email?: string | null; phone?: string | null; address?: string | null; city?: string | null; country?: string | null; notes?: string | null; extraInfo?: string | null } | null;
  } | null>(null);
  const { data: senderSettings } = trpc.invoiceSettings.get.useQuery();

  // 為替レート取得（インボイス一覧に使用する通貨を収集して一括取得）
  const currencies = useMemo(() => invoiceListCurrencies(invoiceList), [invoiceList]);

  // 通貨ごとに為替レートを取得（EUR, USD, GBP等）
  const { data: eurRate } = trpc.invoices.getExchangeRate.useQuery(
    { currency: "EUR" },
    { enabled: currencies.includes("EUR"), staleTime: 5 * 60 * 1000 }
  );
  const { data: usdRate } = trpc.invoices.getExchangeRate.useQuery(
    { currency: "USD" },
    { enabled: currencies.includes("USD"), staleTime: 5 * 60 * 1000 }
  );
  const { data: gbpRate } = trpc.invoices.getExchangeRate.useQuery(
    { currency: "GBP" },
    { enabled: currencies.includes("GBP"), staleTime: 5 * 60 * 1000 }
  );
  const { data: chfRate } = trpc.invoices.getExchangeRate.useQuery(
    { currency: "CHF" },
    { enabled: currencies.includes("CHF"), staleTime: 5 * 60 * 1000 }
  );

  // 通貨→レートのマップ
  const rateMap = useMemo(() => buildInvoiceRateMap(eurRate, usdRate, gbpRate, chfRate), [eurRate, usdRate, gbpRate, chfRate]);

  const handlePreviewOpen = async (invId: number) => {
    setPreviewInvId(invId);
    setPreviewLoading(true);
    try {
      const inv = await utils.invoices.get.fetch({ id: invId });
      if (!inv) { toast.error("請求書データが取得できませんでした"); return; }
      const form: InvoiceFormData = storedInvoiceToForm(inv);
      const selectedClient = inv.clientId
        ? clients.find(c => c.id === inv.clientId) ?? null
        : null;
      setPreviewData({ form, client: selectedClient });
    } catch (e) {
      toast.error("プレビューの読み込みに失敗しました");
      console.error(e);
      setPreviewInvId(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleListPdf = async (invId: number, invNumber: string) => {
    setPdfLoadingId(invId);
    try {
      // 請求書の詳細データを取得
      const inv = await utils.invoices.get.fetch({ id: invId });
      if (!inv) { toast.error("請求書データが取得できませんでした"); return; }

      const form: InvoiceFormData = storedInvoiceToForm(inv);

      const selectedClient = inv.clientId
        ? clients.find(c => c.id === inv.clientId) ?? null
        : null;

      await generateInvoicePdf(form, selectedClient, senderSettings ?? null);
    } catch (e) {
      console.error(e);
      toast.error(`PDF生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPdfLoadingId(null);
    }
  };

  const deleteMutation = trpc.invoices.delete.useMutation({
    onSuccess: () => {
      utils.invoices.list.invalidate();
      toast.success("請求書を削除しました");
    },
    onError: (e) => toast.error(e.message),
  });

  const updateStatusMutation = trpc.invoices.updateStatus.useMutation({
    onSuccess: () => utils.invoices.list.invalidate(),
    onError: (e) => toast.error(e.message),
  });

  const cloneMutation = trpc.invoices.clone.useMutation({
    onSuccess: (data) => {
      utils.invoices.list.invalidate();
      toast.success(`クローンしました: ${data.invoiceNumber}`);
    },
    onError: (e) => toast.error(`クローンエラー: ${e.message}`),
  });

  const detectMutation = trpc.knowledgeBase.detectStatusFromKnowledge.useMutation({
    onSuccess: (data) => {
      setDetectResult(data);
      setShowDetectDialog(true);
    },
    onError: (e) => toast.error(`検知エラー: ${e.message}`),
  });

  const applyStatusMutation = trpc.invoices.updateStatus.useMutation({
    onSuccess: () => utils.invoices.list.invalidate(),
    onError: (e) => toast.error(`ステータス更新エラー: ${e.message}`),
  });

  const handleApplyDetected = async (invoiceNumber: number, status: "sent" | "paid") => {
    // Find matching invoice by number suffix
    const matched = invoiceList.filter(inv => {
      const m = inv.invoiceNumber.match(/(\d+)$/);
      return m && parseInt(m[1], 10) === invoiceNumber;
    });
    if (matched.length === 0) {
      toast.error(`インボイス ${invoiceNumber} が見つかりません`);
      return;
    }
    setApplyingIds(prev => {
      const s = new Set(prev);
      s.add(invoiceNumber);
      return s;
    });
    for (const inv of matched) {
      await applyStatusMutation.mutateAsync({ id: inv.id, status });
    }
    setApplyingIds(prev => { const s = new Set(prev); s.delete(invoiceNumber); return s; });
    toast.success(`${invoiceNumber} を「${status === "sent" ? "送信済み" : "支払済み"}」に変更しました`);
  };

  const clientMap = new Map(clients.map(c => [c.id, c]));

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-2 gap-2 sm:flex sm:items-center">
          <Button size="sm" onClick={onNew} className="h-8 gap-1">
            <Plus size={13} /> 新規請求書
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowClientManager(true)} className="h-8 gap-1">
            <Users size={13} /> 宛先管理
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowSenderSettings(true)} className="h-8 gap-1">
            <Settings size={13} /> 差出人設定
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowWhatsAppUpload(true)} className="h-8 gap-1">
            <MessageSquare size={13} /> 履歴アップロード
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => detectMutation.mutate()}
            disabled={detectMutation.isPending}
            className="h-8 gap-1 text-primary border-primary/30 hover:bg-primary/5"
            title="知識ベースの学習データから送信済み・支払済みを自動検知"
          >
            {detectMutation.isPending ? <RefreshCw size={13} className="animate-spin" /> : <Sparkles size={13} />}
            ステータス自動検知
          </Button>
        </div>
        <div className="flex items-center justify-between gap-2 sm:justify-end">
          <p className="text-xs text-muted-foreground">{invoiceList.length}件</p>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowDeletedList(true)}
            className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive"
            title="削除済みインボイス一覧"
          >
            <Trash2 size={12} />
            削除済み
          </Button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw size={18} className="animate-spin text-muted-foreground" />
        </div>
      ) : invoiceList.length === 0 ? (
        <div className="text-center py-16 space-y-3">
          <FileText size={40} className="mx-auto text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">請求書がまだありません</p>
          <Button size="sm" onClick={onNew} className="h-8 gap-1">
            <Plus size={12} /> 最初の請求書を作成
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {invoiceList.map((inv) => (
            <InvoiceCard
              key={inv.id}
              inv={inv}
              client={inv.clientId ? clientMap.get(inv.clientId) : null}
              rateMap={rateMap}
              previewBusy={previewLoading && previewInvId === inv.id}
              pdfBusy={pdfLoadingId === inv.id}
              clonePending={cloneMutation.isPending}
              actions={{
                onStatusChange: input => updateStatusMutation.mutate(input),
                onPreview: handlePreviewOpen,
                onEdit,
                onPdf: handleListPdf,
                onClone: input => cloneMutation.mutate(input),
                onDelete: input => deleteMutation.mutate(input),
              }}
            />
          ))}
        </div>
      )}

      <ClientManagerDialog open={showClientManager} onClose={() => setShowClientManager(false)} />
      <SenderSettingsDialog open={showSenderSettings} onClose={() => setShowSenderSettings(false)} />
      <KnowledgeBaseDialog open={showWhatsAppUpload} onClose={() => setShowWhatsAppUpload(false)} onNewWithNumber={onNewWithNumber} />

      {/* ステータス自動検知ダイアログ */}
      <Dialog open={showDetectDialog} onOpenChange={setShowDetectDialog}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Sparkles size={16} className="text-primary" />
              ステータス自動検知結果
            </DialogTitle>
            <DialogDescription>{detectResult?.message}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* 送信済み */}
            {detectResult && detectResult.sent.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1">
                  <Send size={13} className="text-blue-500" /> 送信済みと検知されたインボイス
                </h4>
                <div className="space-y-2">
                  {detectResult.sent.map((item) => (
                    <div key={item.invoiceNumber} className="flex items-start justify-between gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">#{item.invoiceNumber}</span>
                          <Badge variant="outline" className={`text-[10px] h-4 ${
                            item.confidence === "high" ? "border-green-500 text-green-600" :
                            item.confidence === "medium" ? "border-yellow-500 text-yellow-600" :
                            "border-gray-400 text-gray-500"
                          }`}>{item.confidence}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.evidence}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs flex-shrink-0 border-blue-400 text-blue-600 hover:bg-blue-50"
                        disabled={applyingIds.has(item.invoiceNumber)}
                        onClick={() => handleApplyDetected(item.invoiceNumber, "sent")}
                      >
                        {applyingIds.has(item.invoiceNumber) ? <RefreshCw size={11} className="animate-spin" /> : <CheckCheck size={11} />}
                        適用
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* 支払済み */}
            {detectResult && detectResult.paid.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-foreground mb-2 flex items-center gap-1">
                  <CheckCircle2 size={13} className="text-green-500" /> 支払済みと検知されたインボイス
                </h4>
                <div className="space-y-2">
                  {detectResult.paid.map((item) => (
                    <div key={item.invoiceNumber} className="flex items-start justify-between gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg border border-green-200 dark:border-green-800">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold">#{item.invoiceNumber}</span>
                          <Badge variant="outline" className={`text-[10px] h-4 ${
                            item.confidence === "high" ? "border-green-500 text-green-600" :
                            item.confidence === "medium" ? "border-yellow-500 text-yellow-600" :
                            "border-gray-400 text-gray-500"
                          }`}>{item.confidence}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.evidence}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs flex-shrink-0 border-green-400 text-green-600 hover:bg-green-50"
                        disabled={applyingIds.has(item.invoiceNumber)}
                        onClick={() => handleApplyDetected(item.invoiceNumber, "paid")}
                      >
                        {applyingIds.has(item.invoiceNumber) ? <RefreshCw size={11} className="animate-spin" /> : <CheckCheck size={11} />}
                        適用
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {detectResult && detectResult.sent.length === 0 && detectResult.paid.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <AlertCircle size={32} className="mx-auto mb-2 opacity-40" />
                <p className="text-sm">送信済み・支払済みのインボイスが検知されませんでした</p>
                <p className="text-xs mt-1">履歴アップロードから知識ベースを充実させてください</p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDetectDialog(false)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* インボイスプレビューモーダル */}
      <Dialog open={previewInvId !== null} onOpenChange={(o) => { if (!o) { setPreviewInvId(null); setPreviewData(null); } }}>
        <DialogContent className="max-w-3xl w-[95vw] flex flex-col p-0" style={{ height: "92vh", maxHeight: "92vh" }}>
          <DialogHeader className="px-4 pt-4 pb-2 flex-shrink-0 border-b border-border">
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Eye size={15} />
              インボイスプレビュー
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-hidden flex items-center justify-center p-4 bg-muted/30">
            {previewLoading ? (
              <div className="flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">読み込み中...</span>
              </div>
            ) : previewData ? (
              <ScaledPreviewFit>
                <InvoicePreview
                  form={previewData.form}
                  clientData={previewData.client}
                  senderSettings={senderSettings ?? null}
                />
              </ScaledPreviewFit>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* 削除済みインボイス一覧モーダル */}
      <Dialog open={showDeletedList} onOpenChange={setShowDeletedList}>
        <DialogContent className="max-w-2xl w-[95vw] max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm">
              <Trash2 size={15} />
              削除済みインボイス
            </DialogTitle>
          </DialogHeader>
          {deletedList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Trash2 size={32} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">削除済みのインボイスはありません</p>
            </div>
          ) : (
            <div className="space-y-2">
              {deletedList.map((inv) => {
                const invWithExtras = inv as typeof inv & { itemCount?: number; totalAmount?: number };
                const deletedAt = inv.deletedAt ? new Date(inv.deletedAt).toLocaleDateString("ja-JP") : "";
                return (
                  <div key={inv.id} className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-lg">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-muted-foreground">{inv.invoiceNumber}</span>
                        <span className="text-xs text-muted-foreground">{inv.currency}</span>
                        {invWithExtras.totalAmount != null && invWithExtras.totalAmount > 0 && (
                          <span className="text-xs text-muted-foreground">{invWithExtras.totalAmount.toLocaleString()} {inv.currency}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground">{inv.invoiceDate}</span>
                        {deletedAt && <span className="text-xs text-destructive/70">削除日: {deletedAt}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => restoreMutation.mutate({ id: inv.id })}
                        disabled={restoreMutation.isPending || permanentDeleteMutation.isPending}
                      >
                        <RotateCcw size={12} />
                        復元
                      </Button>
                      {confirmPermanentDeleteId === inv.id ? (
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-destructive">本当に？</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 gap-1 text-xs"
                            onClick={() => {
                              permanentDeleteMutation.mutate({ id: inv.id });
                              setConfirmPermanentDeleteId(null);
                            }}
                            disabled={permanentDeleteMutation.isPending}
                          >
                            完全削除
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setConfirmPermanentDeleteId(null)}
                          >
                            キャンセル
                          </Button>
                        </div>
                      ) : (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                          onClick={() => setConfirmPermanentDeleteId(inv.id)}
                          disabled={permanentDeleteMutation.isPending}
                          title="完全削除（番号が再利用可能になります）"
                        >
                          <Trash2 size={12} />
                          完全削除
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDeletedList(false)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// // ─── Main InvoicePage ─────────────────────────────────────────────────
type View = "list" | "new" | { editId: number } | { newWithNumber: string; items?: InvoiceItem[] };

export default function InvoicePage({ initialEditId }: { initialEditId?: number | null }) {
  const [view, setView] = useState<View>(() => {
    if (initialEditId) return { editId: initialEditId };
    return "list";
  });
  const utils = trpc.useUtils();

  // Load invoice for editing
  const editId = typeof view === "object" && "editId" in view ? view.editId : null;
  const { data: editInvoice, isLoading: editLoading } = trpc.invoices.get.useQuery(
    { id: editId! },
    { enabled: editId !== null }
  );

  // Fetch next invoice number (used when creating new invoice)
  const isNewView = view === "new";
  const { data: nextNumberData, isLoading: nextNumberLoading, isFetching: nextNumberFetching } = trpc.whatsappHistory.getNextNumber.useQuery(
    undefined,
    { enabled: isNewView, staleTime: 0, refetchOnMount: "always" }
  );

  const handleEdit = useCallback((id: number) => setView({ editId: id }), []);
  const handleNew = useCallback(() => {
    void utils.whatsappHistory.getNextNumber.invalidate();
    setView("new");
  }, [utils]);
  const handleNewWithNumber = useCallback((num: string, items?: InvoiceItem[]) => setView({ newWithNumber: num, items }), []);
  const handleBack = useCallback(() => {
    setView("list");
    utils.invoices.list.invalidate();
    utils.whatsappHistory.getNextNumber.invalidate();
  }, [utils]);

  if (view === "list") {
    return <InvoiceList onNew={handleNew} onNewWithNumber={handleNewWithNumber} onEdit={handleEdit} />;
  }

  if (view === "new") {
    // Wait for next number to load before rendering the editor
    if (nextNumberLoading || nextNumberFetching || !nextNumberData) {
      return (
        <div className="flex items-center justify-center py-16">
          <RefreshCw size={18} className="animate-spin text-muted-foreground" />
        </div>
      );
    }
    const autoNumber = nextNumberData?.nextFormatted ?? "";
    const newForm: InvoiceFormData = { ...EMPTY_FORM, invoiceNumber: autoNumber };
    return (
      <InvoiceEditor
        key={newForm.invoiceNumber || "new"}
        initialData={newForm}
        invoiceId={null}
        onSaved={handleBack}
        onCancel={handleBack}
      />
    );
  }

  if (typeof view === "object" && "newWithNumber" in view) {
    const newForm: InvoiceFormData = {
      ...EMPTY_FORM,
      invoiceNumber: view.newWithNumber,
      ...(view.items && view.items.length > 0
        ? { items: view.items.map((item, idx) => ({ ...item, sortOrder: idx })) }
        : {}),
    };
    return (
      <InvoiceEditor
        initialData={newForm}
        invoiceId={null}
        onSaved={handleBack}
        onCancel={handleBack}
      />
    );
  }

  // Edit mode
  if (editLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <RefreshCw size={18} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!editInvoice) {
    return (
      <div className="text-center py-16 space-y-3">
        <AlertCircle size={32} className="mx-auto text-destructive" />
        <p className="text-sm text-muted-foreground">請求書が見つかりませんでした</p>
        <Button size="sm" onClick={handleBack}>一覧に戻る</Button>
      </div>
    );
  }

  const editForm: InvoiceFormData = storedInvoiceToEditForm(editInvoice);

  return (
    <InvoiceEditor
      initialData={editForm}
      invoiceId={editInvoice.id}
      onSaved={handleBack}
      onCancel={handleBack}
    />
  );
}
