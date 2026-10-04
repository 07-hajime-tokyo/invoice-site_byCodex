import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
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
  Eye,
  MessageSquare,
  Users,
  FileText,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Settings,
  Send,
  Sparkles,
  CheckCheck,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import type { InvoiceItem, InvoiceFormData } from "./types";
import { InvoicePreview } from "./InvoicePreview";
import { generateInvoicePdf } from "./generateInvoicePdf";
import { SenderSettingsDialog } from "./SenderSettingsDialog";
import { ClientManagerDialog } from "./ClientManagerDialog";
import { storedInvoiceToForm } from "./storedInvoiceForm";
import { invoiceListCurrencies, buildInvoiceRateMap } from "./listRules";
import { InvoiceCard } from "./InvoiceCard";
import { ScaledPreviewFit } from "./ScaledPreview";
import { KnowledgeBaseDialog } from "./KnowledgeBaseDialog";

export function InvoiceList({  onNew,
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
