/**
 * EditTradeDialog — 取引データ編集ダイアログ
 * - 支払日入力時にfrankfurter.dev/v1で為替レートを自動取得
 * - 商品価格(円) = 単価 × レート（自動計算）
 * - 売上合計 = 注文数 × 商品価格(円)（自動計算）
 * - 仕入れ合計は手動入力
 * - 還付入力欄あり
 * - 還付込利益 = 売上合計 - 仕入れ合計 + 還付 - 送料（自動計算）
 * - 状況はドロップダウン + 自由記述の両対応
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pencil, RefreshCw, AlertCircle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { TradeRecord } from "@/lib/csvUtils";

// frankfurter.dev/v1 から指定日（または最新）の EUR/USD → JPY レートを取得
async function fetchFrankfurterRate(date?: string): Promise<{ eur: number; usd: number } | null> {
  try {
    const baseUrl = "https://api.frankfurter.dev/v1";
    const dateParam = date ?? "latest";
    const [eurRes, usdRes] = await Promise.all([
      fetch(`${baseUrl}/${dateParam}?base=EUR&symbols=JPY`),
      fetch(`${baseUrl}/${dateParam}?base=USD&symbols=JPY`),
    ]);
    if (!eurRes.ok || !usdRes.ok) return null;
    const [eurData, usdData] = await Promise.all([eurRes.json(), usdRes.json()]);
    const eurToJpy = eurData.rates?.JPY ? Math.round(eurData.rates.JPY * 100) / 100 : null;
    const usdToJpy = usdData.rates?.JPY ? Math.round(usdData.rates.JPY * 100) / 100 : null;
    if (!eurToJpy || !usdToJpy) return null;
    return { eur: eurToJpy, usd: usdToJpy };
  } catch {
    return null;
  }
}

// 日付文字列を YYYY-MM-DD 形式に正規化（例: 2025/3/15 → 2025-03-15）
function normalizeDate(input: string): string | null {
  const cleaned = input.trim().replace(/\//g, "-");
  const match = cleaned.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

const STATUS_PRESETS = ["complete", "途中", "残1台", "残2台", "残3台", "残5台", "残10台"];

interface EditFormState {
  month: string;
  partner: string;
  invoiceNo: string;
  paymentDate: string;
  productName: string;
  quantity: string;
  unitPrice: string;
  currency: "ユーロ" | "ドル";
  status: string;
  eurRate: string;
  usdRate: string;
  procurementTotal: string;
  refund: string;
  shippingCost: string;
  customsDuty: string;
}

interface EditTradeDialogProps {
  record: TradeRecord;
  onSuccess?: () => void;
}

type TradeCurrency = EditFormState["currency"];

function getCurrencyForPartner(partner: string): TradeCurrency | null {
  const normalized = partner.trim().toLowerCase();
  if (
    normalized.includes("ルカ") ||
    normalized.includes("luca") ||
    normalized.includes("サイモン") ||
    normalized.includes("simon") ||
    normalized.includes("マキシム") ||
    normalized.includes("maxim")
  ) {
    return "ユーロ";
  }
  if (normalized.includes("サミー") || normalized.includes("samee") || normalized.includes("デボン") || normalized.includes("devon")) {
    return "ドル";
  }
  return null;
}

function normalizeCurrency(c: string, partner?: string): TradeCurrency {
  const partnerCurrency = getCurrencyForPartner(partner ?? "");
  if (partnerCurrency) return partnerCurrency;
  if (c === "ドル") return "ドル";
  return "ユーロ";
}

export function EditTradeDialog({ record, onSuccess }: EditTradeDialogProps) {
  const [open, setOpen] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateSource, setRateSource] = useState<string | null>(null);
  const [statusMode, setStatusMode] = useState<"select" | "free">("select");
  const [shippingManual, setShippingManual] = useState(false); // 送料を手動編集中かどうか
  const [rateQueryDate, setRateQueryDate] = useState<string>("latest");
  const [rateEnabled, setRateEnabled] = useState(false);

  const buildInitialForm = useCallback((): EditFormState => ({
    month: String(record.month),
    partner: record.partner,
    invoiceNo: String(record.no),
    paymentDate: record.paymentDate ?? "",
    productName: record.productName,
    quantity: String(record.quantity),
    unitPrice: String(record.unitPrice),
    currency: normalizeCurrency(record.currency, record.partner),
    status: record.status ?? "",
    eurRate: "",
    usdRate: "",
    procurementTotal: record.procurementTotal ? String(record.procurementTotal) : "",
    refund: record.refund ? String(record.refund) : "",
    shippingCost: record.shippingCost ? String(record.shippingCost) : "",
    customsDuty: (record as any).customsDuty != null ? String((record as any).customsDuty) : "",
  }), [record]);

  const [form, setForm] = useState<EditFormState>(buildInitialForm);

  // ダイアログを開くたびに最新のrecordデータで初期化
  useEffect(() => {
    if (open) {
      const initial = buildInitialForm();
      // 既存の送料が0または未設定の場合は自動計算値を初期値にする
      const qty = parseInt(initial.quantity);
      if (!initial.shippingCost || initial.shippingCost === "0") {
        initial.shippingCost = !isNaN(qty) && qty > 0 ? String(550 * qty) : "";
        setShippingManual(false);
      } else {
        setShippingManual(true); // 既存の送料がある場合は手動扱い
      }
      setForm(initial);
      setSubmitError(null);
      setRateSource(null);
      // 状況が既存プリセットに含まれるかチェック
      const isPreset = STATUS_PRESETS.includes(record.status ?? "") || !record.status;
      setStatusMode(isPreset ? "select" : "free");
    }
  }, [open, record]);

  // tRPC経由でEURレートを取得
  const { data: eurRateData, isLoading: eurLoading } = trpc.trade.getRateByDate.useQuery(
    { date: rateQueryDate, currency: "EUR" },
    { enabled: rateEnabled }
  );
  // tRPC経由でUSDレートを取得
  const { data: usdRateData, isLoading: usdLoading } = trpc.trade.getRateByDate.useQuery(
    { date: rateQueryDate, currency: "USD" },
    { enabled: rateEnabled }
  );

  // レートデータが取得できたらフォームに反映
  useEffect(() => {
    if (eurRateData && usdRateData) {
      setForm(prev => ({
        ...prev,
        eurRate: String(Math.round(eurRateData.rate * 100) / 100),
        usdRate: String(Math.round(usdRateData.rate * 100) / 100),
      }));
      setRateLoading(false);
    }
  }, [eurRateData, usdRateData]);

  useEffect(() => {
    setRateLoading(eurLoading || usdLoading);
  }, [eurLoading, usdLoading]);

  // ダイアログが開いたとき、または支払日が変わったときにレートクエリを更新
  useEffect(() => {
    if (!open) return;
    const normalized = normalizeDate(form.paymentDate);
    const dateToUse = normalized ?? "latest";
    setRateQueryDate(dateToUse);
    setRateEnabled(true);
    setRateSource(normalized ? `${normalized} のレート` : "本日のレート");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const normalized = normalizeDate(form.paymentDate);
    const dateToUse = normalized ?? "latest";
    setRateQueryDate(dateToUse);
    setRateEnabled(true);
    setRateSource(normalized ? `${normalized} のレート` : "本日のレート");
  }, [form.paymentDate]);

  const set = (key: keyof EditFormState, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handlePartnerChange = (partner: string) => {
    const partnerCurrency = getCurrencyForPartner(partner);
    setForm(prev => ({
      ...prev,
      partner,
      ...(partnerCurrency ? { currency: partnerCurrency } : {}),
    }));
  };

  // 注文数が変わったとき、手動編集中でなければ送料を自動計算
  useEffect(() => {
    if (!open || shippingManual) return;
    const qty = parseInt(form.quantity);
    if (!isNaN(qty) && qty > 0) {
      setForm(prev => ({ ...prev, shippingCost: String(550 * qty) }));
    } else {
      setForm(prev => ({ ...prev, shippingCost: "" }));
    }
  }, [form.quantity, shippingManual, open]);

  // 商品価格(円)プレビュー計算
  const priceJpy = (() => {
    const price = parseFloat(form.unitPrice);
    const rate = form.currency === "ユーロ" ? parseFloat(form.eurRate) : parseFloat(form.usdRate);
    if (isNaN(price) || isNaN(rate) || rate === 0) return null;
    return Math.round(price * rate);
  })();

  // 売上合計 = 注文数 × 商品価格(円)
  const totalSales = (() => {
    if (priceJpy === null) return null;
    const qty = parseFloat(form.quantity);
    if (isNaN(qty)) return null;
    return Math.round(priceJpy * qty);
  })();

  // 還付込利益 = 売上合計 - 仕入れ合計 + 還付 - 送料 - 関税
  const profitWithRefund = (() => {
    if (totalSales === null) return null;
    const procurement = parseFloat(form.procurementTotal) || 0;
    const refund = parseFloat(form.refund) || 0;
    const shipping = parseFloat(form.shippingCost) || 0;
    const customs = parseFloat(form.customsDuty) || 0;
    return Math.round(totalSales - procurement + refund - shipping - customs);
  })();

  const updateMutation = trpc.trade.updateRecord.useMutation({
    onSuccess: () => {
      toast.success("更新完了", {
        description: `No.${form.invoiceNo} のデータを更新しました。`,
      });
      setOpen(false);
      setSubmitError(null);
      onSuccess?.();
    },
    onError: (err) => {
      setSubmitError(err.message);
    },
  });

  const deleteMutation = trpc.trade.deleteFromDb.useMutation({
    onSuccess: () => {
      toast.success("削除しました", {
        description: `No.${record.no} の取引データを削除しました。`,
      });
      setOpen(false);
      setSubmitError(null);
      onSuccess?.();
    },
    onError: (err) => {
      setSubmitError(err.message);
    },
  });

  const handleSubmit = () => {
    setSubmitError(null);
    const month = parseInt(form.month);
    const quantity = parseInt(form.quantity);
    const unitPrice = parseFloat(form.unitPrice);
    const eurRate = parseFloat(form.eurRate);
    const usdRate = parseFloat(form.usdRate);

    if (!form.partner || !form.invoiceNo || !form.productName) {
      setSubmitError("必須項目（取引相手・No.・商品名）をすべて入力してください。");
      return;
    }
    if (isNaN(month) || isNaN(quantity) || isNaN(unitPrice)) {
      setSubmitError("数値項目（月・注文数・商品価格）を正しく入力してください。");
      return;
    }

    const customsDutyVal = parseFloat(form.customsDuty);
    updateMutation.mutate({
      id: record.id,
      invoiceNo: form.invoiceNo,
      month,
      partner: form.partner,
      paymentDate: form.paymentDate,
      productName: form.productName,
      quantity,
      unitPrice,
      currency: form.currency,
      status: form.status,
      eurRate: isNaN(eurRate) ? undefined : eurRate,
      usdRate: isNaN(usdRate) ? undefined : usdRate,
      procurementTotal: parseFloat(form.procurementTotal) || 0,
      refund: parseFloat(form.refund) || 0,
      shippingCost: parseFloat(form.shippingCost) || 0,
      customsDuty: isNaN(customsDutyVal) ? 0 : customsDutyVal,
    });
  };

  const handleDelete = () => {
    setSubmitError(null);
    if (!record.id) {
      setSubmitError("Delete failed: record id is missing. Please reload the page and try again.");
      return;
    }
    const ok = window.confirm(`Delete No.${record.no} "${record.productName}"?\nThis action cannot be undone.`);
    if (!ok) return;
    deleteMutation.mutate({ id: record.id });
  };

  const formatJpy = (v: number) => `¥${v.toLocaleString()}`;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1 rounded hover:bg-primary/10 text-muted-foreground hover:text-primary transition-colors"
        title="編集"
      >
        <Pencil size={13} />
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">
              取引データ編集 — No.{record.no}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              編集した内容はサイト内DBに保存されます。
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 基本情報 */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">月 <span className="text-destructive">*</span></Label>
                <Select value={form.month} onValueChange={v => set("month", v)}>
                  <SelectTrigger className="h-8 text-sm mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                      <SelectItem key={m} value={String(m)}>{m}月</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">取引相手 <span className="text-destructive">*</span></Label>
                <Input
                  value={form.partner}
                  onChange={e => handlePartnerChange(e.target.value)}
                  placeholder="例: ルカ"
                  className="h-8 text-sm mt-1"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">No.（インボイスNo）</Label>
                <Input
                  value={form.invoiceNo}
                  className="h-8 text-sm mt-1"
                  readOnly
                  disabled
                  title="No.は変更できません"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">No.は変更できません</p>
              </div>
              <div>
                <Label className="text-xs">支払い日</Label>
                <Input
                  value={form.paymentDate}
                  onChange={e => set("paymentDate", e.target.value)}
                  placeholder="例: 2025/3/15（空欄可）"
                  className="h-8 text-sm mt-1"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">空欄のまま保存できます</p>
              </div>
            </div>

            <div>
              <Label className="text-xs">商品名 <span className="text-destructive">*</span></Label>
              <Input
                value={form.productName}
                onChange={e => set("productName", e.target.value)}
                placeholder="例: 3DSLL ブラック"
                className="h-8 text-sm mt-1"
              />
            </div>

            {/* 価格・数量 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">注文数 <span className="text-destructive">*</span></Label>
                <Input
                  value={form.quantity}
                  onChange={e => set("quantity", e.target.value)}
                  placeholder="例: 10"
                  className="h-8 text-sm mt-1"
                  type="number"
                  min="1"
                />
              </div>
              <div>
                <Label className="text-xs">商品価格 <span className="text-destructive">*</span></Label>
                <Input
                  value={form.unitPrice}
                  onChange={e => set("unitPrice", e.target.value)}
                  placeholder="例: 110"
                  className="h-8 text-sm mt-1"
                  type="number"
                  step="0.01"
                />
              </div>
              <div>
                <Label className="text-xs">通貨 <span className="text-destructive">*</span></Label>
                <Select value={form.currency} onValueChange={v => set("currency", v as "ユーロ" | "ドル")}>
                  <SelectTrigger className="h-8 text-sm mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ユーロ">ユーロ (€)</SelectItem>
                    <SelectItem value="ドル">ドル ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* 為替レート */}
            <div className="bg-muted/40 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">為替レート</span>
                {rateLoading ? (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 size={10} className="animate-spin" />取得中...
                  </span>
                ) : rateSource ? (
                  <span className="text-xs text-muted-foreground">{rateSource}</span>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">EUR/JPY レート</Label>
                  <Input
                    value={form.eurRate}
                    onChange={e => set("eurRate", e.target.value)}
                    placeholder="例: 163.5"
                    className="h-8 text-sm mt-1"
                    type="number"
                    step="0.01"
                  />
                </div>
                <div>
                  <Label className="text-xs">USD/JPY レート</Label>
                  <Input
                    value={form.usdRate}
                    onChange={e => set("usdRate", e.target.value)}
                    placeholder="例: 150.2"
                    className="h-8 text-sm mt-1"
                    type="number"
                    step="0.01"
                  />
                </div>
              </div>

              {/* 自動計算プレビュー */}
              {priceJpy !== null && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-border/50">
                  <div className="text-xs">
                    <span className="text-muted-foreground">商品価格(円):</span>
                    <span className="ml-1 font-semibold text-foreground">{formatJpy(priceJpy)}</span>
                  </div>
                  {totalSales !== null && (
                    <div className="text-xs">
                      <span className="text-muted-foreground">売上合計:</span>
                      <span className="ml-1 font-semibold text-foreground">{formatJpy(totalSales)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 関税（USD取引のみ表示） */}
            {form.currency === "ドル" && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">関税 (¥)</Label>
                  <span className="text-[10px] text-muted-foreground">ドル取引のみ適用 ・ 自動計算値を手動修正可</span>
                </div>
                <Input
                  value={form.customsDuty}
                  onChange={e => set("customsDuty", e.target.value)}
                  placeholder="フェデックス登録時に自動計算"
                  className="h-8 text-sm"
                  type="number"
                  step="1"
                />
                <p className="text-[10px] text-muted-foreground mt-0.5">商品価格(円换算) × 注文数 × 10%を発送日レートで計算</p>
              </div>
            )}

            {/* 仕入れ合計・還付・送料 */}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">仕入れ合計 (¥)</Label>
                <Input
                  value={form.procurementTotal}
                  onChange={e => set("procurementTotal", e.target.value)}
                  placeholder="例: 300000"
                  className="h-8 text-sm mt-1"
                  type="number"
                  step="1"
                />
              </div>
              <div>
                <Label className="text-xs">還付 (¥)</Label>
                <Input
                  value={form.refund}
                  onChange={e => set("refund", e.target.value)}
                  placeholder="例: 50000"
                  className="h-8 text-sm mt-1"
                  type="number"
                  step="1"
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs">送料 (¥)</Label>
                  <span className="text-[10px] text-muted-foreground">
                    {shippingManual ? "手動" : "550×注文数"}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <Input
                    value={form.shippingCost}
                    onChange={e => {
                      setShippingManual(true);
                      set("shippingCost", e.target.value);
                    }}
                    placeholder="自動計算"
                    className="h-8 text-sm"
                    type="number"
                    step="1"
                  />
                  {shippingManual && (
                    <button
                      type="button"
                      onClick={() => {
                        setShippingManual(false);
                        const qty = parseInt(form.quantity);
                        setForm(prev => ({ ...prev, shippingCost: !isNaN(qty) && qty > 0 ? String(550 * qty) : "" }));
                      }}
                      className="text-[10px] text-primary hover:underline whitespace-nowrap"
                    >
                      自動
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* 還付込利益プレビュー */}
            {profitWithRefund !== null && (
              <div className={`rounded-lg px-3 py-2 text-sm font-semibold flex items-center justify-between ${
                profitWithRefund >= 0
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  : "bg-red-50 text-red-700 border border-red-200"
              }`}>
                <span className="text-xs font-normal opacity-70">還付込利益（自動計算）</span>
                <span>{formatJpy(profitWithRefund)}</span>
              </div>
            )}

            {/* 状況 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">状況</Label>
                <button
                  type="button"
                  onClick={() => setStatusMode(m => m === "select" ? "free" : "select")}
                  className="text-[10px] text-primary hover:underline"
                >
                  {statusMode === "select" ? "自由記述に切り替え" : "選択肢に切り替え"}
                </button>
              </div>
              {statusMode === "select" ? (
                <Select
                  value={STATUS_PRESETS.includes(form.status) ? form.status : "__none__"}
                  onValueChange={v => set("status", v === "__none__" ? "" : v)}
                >
                  <SelectTrigger className="h-8 text-sm">
                    <SelectValue placeholder="選択してください" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">（未設定）</SelectItem>
                    {STATUS_PRESETS.map(s => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.status}
                  onChange={e => set("status", e.target.value)}
                  placeholder="例: 残3台（ルカ保管）"
                  className="h-8 text-sm"
                />
              )}
            </div>

            {/* エラー表示 */}
            {submitError && (
              <div className="flex items-start gap-2 bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                <AlertCircle size={14} className="text-destructive flex-shrink-0 mt-0.5" />
                <p className="text-xs text-destructive">{submitError}</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={updateMutation.isPending || deleteMutation.isPending}
            >
              {deleteMutation.isPending ? (
                <>
                  <RefreshCw size={12} className="animate-spin mr-1" />
                  削除中...
                </>
              ) : (
                <>
                  <Trash2 size={12} className="mr-1" />
                  削除
                </>
              )}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={updateMutation.isPending || deleteMutation.isPending}
            >
              {updateMutation.isPending ? (
                <>
                  <RefreshCw size={12} className="animate-spin mr-1" />
                  更新中...
                </>
              ) : "保存する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
