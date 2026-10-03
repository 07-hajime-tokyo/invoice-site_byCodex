import { useState, useCallback, useRef, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MessageSquare, X, RefreshCw, Upload } from "lucide-react";
import { toast } from "sonner";
import type { InvoiceItem, InvoiceFormData } from "./types";
import { findClientByDetectedSender } from "./clientRules";
import { InvoicePreview } from "./InvoicePreview";
import { generateInvoicePdf } from "./generateInvoicePdf";
import {
  addInvoiceItem,
  updateInvoiceItem,
  removeInvoiceItem,
  resolveInvoiceClient,
  applyInvoiceClient,
} from "./editorItems";
import {
  buildInvoiceSavePayload,
  buildInvoiceSplitPayload,
} from "./editorPayload";
import { computeInvoiceSplits } from "./splitInvoices";
import { InvoiceMetadata } from "./InvoiceMetadata";
import { InvoiceItemsEditor } from "./InvoiceItemsEditor";
import { ScaledPreview } from "./ScaledPreview";
import { EditorToolbar } from "./EditorToolbar";
import { BackConfirmDialog } from "./BackConfirmDialog";
import { OverLimitDialog } from "./OverLimitDialog";
import { SplitPreviewDialog } from "./SplitPreviewDialog";
import { InvoiceContacts } from "./InvoiceContacts";

export function InvoiceEditor({
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
