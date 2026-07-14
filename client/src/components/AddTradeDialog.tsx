/**
 * AddTradeDialog — 新規取引データ登録ダイアログ
 * - 支払日入力時にfrankfurter.appで為替レートを自動取得
 * - 通貨（ユーロ/ドル）選択で商品価格(円)をリアルタイムプレビュー
 * - 状況フィールドはドロップダウン選択 + 自由記述の両対応
 * - 登録時はサイト内DBへ保存
 * - 新規登録ボタンクリック時に最新インボイス（番号最大）の内容を確認ダイアログで提案
 */
import { useState, useEffect, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, RefreshCw, AlertCircle, CheckCircle2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";

interface FormState {
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
  shippingCost: string; // 送料（550×注文数で自動計算、手動編集可）
}

const DEFAULT_TRADE_PARTNERS = ["ルカ", "サミー", "デボン", "サイモン"] as const;

function getTodayDateString() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function createInitialForm(): FormState {
  const today = getTodayDateString();
  return {
    month: String(new Date(`${today}T00:00:00`).getMonth() + 1),
    partner: "",
    invoiceNo: "",
    paymentDate: today,
    productName: "",
    quantity: "",
    unitPrice: "",
    currency: "ユーロ",
    status: "",
    eurRate: "",
    usdRate: "",
    shippingCost: "",
  };
}

function getCurrencyForPartner(partner: string): FormState["currency"] {
  const normalized = partner.trim().toLowerCase();
  if (
    normalized.includes("ルカ") ||
    normalized.includes("luca") ||
    normalized.includes("サイモン") ||
    normalized.includes("simon")
  ) return "ユーロ";
  return "ドル";
}

function isHiddenTradePartner(name: string | null | undefined) {
  const normalized = String(name ?? "").normalize("NFKC").trim().toLowerCase();
  return normalized === "hennes kamusien";
}

// 取引相手名の英語→日本語マッピング
const PARTNER_MAP: Record<string, string> = {
  "luca": "ルカ",
  "luca neumann": "ルカ",
  "samee": "サミー",
  "sami": "サミー",
  "sammy": "サミー",
  "devon": "デボン",
  "devon brako": "デボン",
  "simon": "サイモン",
};

// 商品名・フレーズの英語→日本語変換マッピング（部分一致・置換）
const PRODUCT_WORD_MAP: Array<[RegExp, string]> = [
  [/random\s*color/gi, "ランダムカラー"],
  [/turquoise/gi, "ターコイズ"],
  [/white\s*base/gi, "ホワイトベース"],
  [/black/gi, "ブラック"],
  [/white/gi, "ホワイト"],
  [/red/gi, "レッド"],
  [/blue/gi, "ブルー"],
  [/yellow/gi, "イエロー"],
  [/green/gi, "グリーン"],
  [/pink/gi, "ピンク"],
  [/purple/gi, "パープル"],
  [/silver/gi, "シルバー"],
  [/gold/gi, "ゴールド"],
  [/coral\s*pink/gi, "コーラルピンク"],
  [/mint/gi, "ミント"],
  [/orange/gi, "オレンジ"],
];

// 部分一致マッピング（先頭の単語で判定）
const PARTNER_PREFIX_MAP: Array<[RegExp, string]> = [
  [/^luca\b/i, "ルカ"],
  [/^samee\b/i, "サミー"],
  [/^sami\b/i, "サミー"],
  [/^sammy\b/i, "サミー"],
  [/^devon\b/i, "デボン"],
  [/^simon\b/i, "サイモン"],
];

function toJapanesePartner(name: string): string {
  const trimmed = name.trim();
  const key = trimmed.toLowerCase();
  // 完全一致を優先
  if (PARTNER_MAP[key]) return PARTNER_MAP[key];
  // 前方部分一致（フルネーム対応）
  for (const [pattern, japanese] of PARTNER_PREFIX_MAP) {
    if (pattern.test(trimmed)) return japanese;
  }
  return trimmed;
}

function toJapaneseProductName(name: string): string {
  let result = name;
  for (const [pattern, replacement] of PRODUCT_WORD_MAP) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

// frankfurter.dev/v1 から指定日（または最新）の EUR/USD → JPY レートを取得
async function fetchFrankfurterRate(date?: string): Promise<{ eur: number; usd: number } | null> {
  try {
    const baseUrl = "https://api.frankfurter.dev/v1";
    const dateParam = date ?? "latest";
    const [eurRes, usdRes] = await Promise.all([
      fetch(`${baseUrl}/${dateParam}?from=EUR&to=JPY`),
      fetch(`${baseUrl}/${dateParam}?from=USD&to=JPY`),
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

const initialForm: FormState = createInitialForm();

export function AddTradeDialog({ onSuccess }: { onSuccess?: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [form, setForm] = useState<FormState>(initialForm);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [rateLoading, setRateLoading] = useState(false);
  const [rateSource, setRateSource] = useState<string | null>(null); // 取得元の説明
  const [statusMode, setStatusMode] = useState<"select" | "free">("select"); // 状況入力モード
  const [shippingManual, setShippingManual] = useState(false); // 送料を手動編集中かどうか
  const [rateQueryDate, setRateQueryDate] = useState<string>("latest");
  const [rateEnabled, setRateEnabled] = useState(false);

  const { data: customers } = trpc.inventory.customer.list.useQuery(undefined, {
    enabled: open,
  });

  // 最新インボイスを取得（ダイアログが開いたときのみ）
  const { data: latestInvoice, isLoading: latestLoading } = trpc.invoices.getLatest.useQuery(
    undefined,
    { enabled: confirmOpen }
  );

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

  const loadRate = useCallback((date?: string) => {
    setRateEnabled(false);
    setRateQueryDate(date ?? "latest");
    setRateSource(date ? `${date} のレート` : "本日のレート");
    setRateLoading(true);
    setTimeout(() => setRateEnabled(true), 0);
  }, []);

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

  // ダイアログが閉じたらレート取得を止める
  useEffect(() => {
    if (!open) setRateEnabled(false);
  }, [open]);

  // 支払日が変わったとき、その日のレートを自動取得
  useEffect(() => {
    if (!open) return;
    const normalized = normalizeDate(form.paymentDate);
    loadRate(normalized ?? undefined);
  }, [form.paymentDate, loadRate, open]);

  const addMutation = trpc.trade.addRecord.useMutation({
    onSuccess: () => {
      toast.success("登録完了", {
        description: "取引データを登録しました。",
      });
      setOpen(false);
      setForm(createInitialForm());
      setSubmitError(null);
      setRateSource(null);
      setStatusMode("select");
      setShippingManual(false);
      onSuccess?.();
    },
    onError: (err) => {
      setSubmitError(err.message);
    },
  });

  const set = (key: keyof FormState, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const partnerOptions = (() => {
    const options: string[] = [];
    const seen = new Set<string>();
    const add = (name: string | null | undefined) => {
      const trimmed = name?.trim();
      if (!trimmed || seen.has(trimmed) || isHiddenTradePartner(trimmed)) return;
      seen.add(trimmed);
      options.push(trimmed);
    };
    DEFAULT_TRADE_PARTNERS.forEach(add);
    (customers ?? []).forEach(customer => add(customer.displayName));
    add(form.partner);
    return options;
  })();

  const handlePartnerChange = (partner: string) => {
    setForm(prev => ({
      ...prev,
      partner,
      currency: getCurrencyForPartner(partner),
    }));
  };

  const handlePaymentDateChange = (value: string) => {
    const month = normalizeDate(value)?.slice(5, 7).replace(/^0/, "");
    setForm(prev => ({
      ...prev,
      paymentDate: value,
      ...(month ? { month } : {}),
    }));
  };

  // 注文数が変わったとき、手動編集中でなければ送料を自動計算
  useEffect(() => {
    if (shippingManual) return;
    const qty = parseInt(form.quantity);
    if (!isNaN(qty) && qty > 0) {
      setForm(prev => ({ ...prev, shippingCost: String(550 * qty) }));
    } else {
      setForm(prev => ({ ...prev, shippingCost: "" }));
    }
  }, [form.quantity, shippingManual]);

  // 商品価格(円)プレビュー計算
  const priceJpy = (() => {
    const price = parseFloat(form.unitPrice);
    const rate = form.currency === "ユーロ" ? parseFloat(form.eurRate) : parseFloat(form.usdRate);
    if (isNaN(price) || isNaN(rate) || rate === 0) return null;
    return Math.round(price * rate);
  })();

  const totalJpy = (() => {
    if (priceJpy === null) return null;
    const qty = parseFloat(form.quantity);
    if (isNaN(qty)) return null;
    return priceJpy * qty;
  })();

  const shippingNum = parseFloat(form.shippingCost) || 0;
  const profitPreview = (() => {
    if (totalJpy === null) return null;
    return totalJpy - shippingNum;
  })();

  const handleSubmit = () => {
    setSubmitError(null);
    const month = parseInt(form.month);
    const quantity = parseInt(form.quantity);
    const unitPrice = parseFloat(form.unitPrice);
    const eurRate = parseFloat(form.eurRate);
    const usdRate = parseFloat(form.usdRate);

    if (!form.partner || !form.invoiceNo || !form.productName) {
      setSubmitError("必須項目をすべて入力してください。");
      return;
    }
    if (isNaN(month) || isNaN(quantity) || isNaN(unitPrice)) {
      setSubmitError("数値項目を正しく入力してください。");
      return;
    }
    // 為替レートが未取得の場合は手動入力を促す
    if (isNaN(eurRate) || isNaN(usdRate)) {
      setSubmitError("為替レートを取得できませんでした。レート欄に手動で入力してください。");
      return;
    }

    const shippingCost = parseFloat(form.shippingCost) || 0;

    addMutation.mutate({
      month,
      partner: form.partner,
      invoiceNo: form.invoiceNo,
      paymentDate: form.paymentDate,
      productName: form.productName,
      quantity,
      unitPrice,
      currency: form.currency,
      status: form.status,
      eurRate,
      usdRate,
      shippingCost,
    });
  };

  // 最新インボイスの内容をフォームに自動入力して登録フォームを開く
  const handleApplyInvoice = () => {
    if (!latestInvoice) return;

    const numMatch = latestInvoice.invoiceNumber.match(/(\d+)$/);
    const invoiceNo = numMatch ? numMatch[1] : latestInvoice.invoiceNumber;

    const snapshot = latestInvoice.clientSnapshot as { name?: string } | null;
    const partner = toJapanesePartner(snapshot?.name ?? "");

    const currencyRaw = latestInvoice.currency ?? "EUR";
    const currency: "ユーロ" | "ドル" = partner ? getCurrencyForPartner(partner) : currencyRaw === "USD" ? "ドル" : "ユーロ";

    const firstItem = latestInvoice.items?.[0];
    const rawProductName = firstItem
      ? [firstItem.description, firstItem.variant].filter(Boolean).join(" ")
      : "";
    const productName = toJapaneseProductName(rawProductName);
    const quantity = firstItem ? String(Math.round(parseFloat(String(firstItem.quantity)))) : "";
    const unitPrice = firstItem ? String(parseFloat(String(firstItem.unitPrice))) : "";

    const baseForm = createInitialForm();

    setForm({
      ...baseForm,
      invoiceNo,
      partner,
      currency,
      productName,
      quantity,
      unitPrice,
      eurRate: "", // レートはダイアログ開いたときに自動取得
      usdRate: "",
    });

    setConfirmOpen(false);
    setOpen(true);
  };

  const handleNewClick = () => {
    setConfirmOpen(true);
  };

  const handleSkipInvoice = () => {
    setConfirmOpen(false);
    setForm(createInitialForm());
    setOpen(true);
  };

  const invoiceSummary = (() => {
    if (!latestInvoice) return null;
    const numMatch = latestInvoice.invoiceNumber.match(/(\d+)$/);
    const no = numMatch ? numMatch[1] : latestInvoice.invoiceNumber;
    const snapshot = latestInvoice.clientSnapshot as { name?: string } | null;
    const partner = snapshot?.name ?? "（取引相手不明）";
    const items = latestInvoice.items ?? [];
    const itemSummary = items.length > 0
      ? items.map(it => {
          const name = [it.description, it.variant].filter(Boolean).join(" ");
          return `${name} × ${Math.round(parseFloat(String(it.quantity)))}台`;
        }).join("、")
      : "（明細なし）";
    return { no, partner, itemSummary };
  })();

  return (
    <>
      {/* 確認ダイアログ */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <FileText size={16} className="text-primary" />
              最新インボイスから登録しますか？
            </DialogTitle>
            <DialogDescription className="text-sm pt-1">
              {latestLoading ? (
                <span className="flex items-center gap-2 text-muted-foreground">
                  <RefreshCw size={12} className="animate-spin" />
                  最新インボイスを取得中...
                </span>
              ) : invoiceSummary ? (
                <span>
                  インボイス <strong>No.{invoiceSummary.no}</strong>（{invoiceSummary.partner}）の内容を自動入力して登録フォームを開きますか？
                  <br />
                  <span className="text-xs text-muted-foreground mt-1 block">{invoiceSummary.itemSummary}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">インボイスが見つかりませんでした。手動で入力してください。</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 flex-col sm:flex-row">
            <Button
              variant="outline"
              size="sm"
              onClick={handleSkipInvoice}
              className="w-full sm:w-auto"
            >
              いいえ（手動入力）
            </Button>
            <Button
              size="sm"
              onClick={handleApplyInvoice}
              disabled={latestLoading || !latestInvoice}
              className="w-full sm:w-auto"
            >
              はい、自動入力する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 登録フォームダイアログ */}
      <Dialog open={open} onOpenChange={(v) => {
        setOpen(v);
        if (!v) { setRateSource(null); setStatusMode("select"); }
      }}>
        <DialogTrigger asChild>
          <Button
            size="sm"
            className="h-9 px-4 text-sm font-bold gap-1.5 flex-shrink-0 bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
            onClick={(e) => {
              e.preventDefault();
              handleNewClick();
            }}
          >
            <Plus size={15} />
            <span className="hidden sm:inline">新規登録</span>
          </Button>
        </DialogTrigger>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base">新規取引データ登録</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* 為替レート */}
            <div className="bg-muted/40 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-muted-foreground">為替レート</span>
                  {rateLoading && <Loader2 size={11} className="animate-spin text-primary" />}
                  {rateSource && !rateLoading && (
                    <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                      {rateSource}（自動取得）
                    </span>
                  )}
                </div>
                <button
                  onClick={() => {
                    const normalized = normalizeDate(form.paymentDate);
                    loadRate(normalized ?? undefined);
                  }}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                  disabled={rateLoading}
                >
                  <RefreshCw size={11} className={rateLoading ? "animate-spin" : ""} />
                  再取得
                </button>
              </div>
              <p className="text-[10px] text-muted-foreground">
                支払日を入力するとその日のレートを自動取得します。未入力の場合は本日のレートを使用します。
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">ユーロ (€) レート</Label>
                  <div className="flex items-center gap-1 mt-1">
                    <Input
                      value={form.eurRate}
                      onChange={e => set("eurRate", e.target.value)}
                      placeholder="自動取得中..."
                      className="h-8 text-sm"
                      type="number"
                      step="0.01"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">円/€</span>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">ドル ($) レート</Label>
                  <div className="flex items-center gap-1 mt-1">
                    <Input
                      value={form.usdRate}
                      onChange={e => set("usdRate", e.target.value)}
                      placeholder="自動取得中..."
                      className="h-8 text-sm"
                      type="number"
                      step="0.01"
                    />
                    <span className="text-xs text-muted-foreground whitespace-nowrap">円/$</span>
                  </div>
                </div>
              </div>
            </div>

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
                <Select value={form.partner || undefined} onValueChange={handlePartnerChange}>
                  <SelectTrigger className="h-8 text-sm mt-1">
                    <SelectValue placeholder="選択してください" />
                  </SelectTrigger>
                  <SelectContent>
                    {partnerOptions.map(partner => (
                      <SelectItem key={partner} value={partner}>{partner}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">No.（インボイスNo） <span className="text-destructive">*</span></Label>
                <Input
                  value={form.invoiceNo}
                  onChange={e => set("invoiceNo", e.target.value)}
                  placeholder="例: 369"
                  className="h-8 text-sm mt-1"
                />
              </div>
              <div>
                <Label className="text-xs">
                  支払い日
                  <span className="text-muted-foreground text-[10px] ml-1">（任意・入力でレート自動更新）</span>
                </Label>
                <Input
                  value={form.paymentDate}
                  onChange={e => handlePaymentDateChange(e.target.value)}
                  className="h-8 text-sm mt-1"
                  type="date"
                />
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

            {/* 円換算プレビュー */}
            {priceJpy !== null && (
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={14} className="text-primary flex-shrink-0" />
                  <div className="text-xs">
                    <span className="text-muted-foreground">1個あたり: </span>
                    <span className="font-semibold text-foreground">¥{priceJpy.toLocaleString()}</span>
                    {totalJpy !== null && (
                      <>
                        <span className="text-muted-foreground ml-3">合計: </span>
                        <span className="font-semibold text-foreground">¥{totalJpy.toLocaleString()}</span>
                      </>
                    )}
                    <span className="text-muted-foreground ml-2">
                      ({form.currency === "ユーロ" ? `€1 = ¥${form.eurRate}` : `$1 = ¥${form.usdRate}`})
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* 送料 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">送料（円）</Label>
                <span className="text-[10px] text-muted-foreground">
                  {shippingManual ? "手動入力中" : "550円 × 注文数で自動計算"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={form.shippingCost}
                  onChange={e => {
                    setShippingManual(true);
                    set("shippingCost", e.target.value);
                  }}
                  placeholder="自動計算されます"
                  className="h-8 text-sm"
                  type="number"
                  min="0"
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
                    自動に戻す
                  </button>
                )}
              </div>
              {profitPreview !== null && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  売上合計 ¥{totalJpy?.toLocaleString()} − 送料 ¥{shippingNum.toLocaleString()} = 概算利益 ¥{profitPreview.toLocaleString()}
                </p>
              )}
            </div>

            {/* 状況 — ドロップダウン選択 or 自由記述 */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <Label className="text-xs">状況</Label>
                <button
                  type="button"
                  onClick={() => {
                    setStatusMode(prev => prev === "select" ? "free" : "select");
                    set("status", "");
                  }}
                  className="text-[10px] text-primary hover:underline"
                >
                  {statusMode === "select" ? "自由記述に切り替え" : "選択肢に切り替え"}
                </button>
              </div>
              {statusMode === "select" ? (
                <Select value={form.status || "__none__"} onValueChange={v => set("status", v === "__none__" ? "" : v)}>
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
                  placeholder="例: 残3台、発送待ち、確認中..."
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
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              キャンセル
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={addMutation.isPending || rateLoading}
            >
              {addMutation.isPending ? (
                <>
                  <RefreshCw size={12} className="animate-spin mr-1" />
                  登録中...
                </>
              ) : rateLoading ? (
                <>
                  <Loader2 size={12} className="animate-spin mr-1" />
                  レート取得中...
                </>
              ) : "登録する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
