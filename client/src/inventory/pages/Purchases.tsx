import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  RefreshCw,
  PackageCheck,
  Edit2,
  Check,
  X,
  Loader2,
  Truck,
  Trash2,
  ExternalLink,
  TrendingUp,
  Search,
  Download,
  Plus,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { detectCarrier, getCarrierColor } from "@/inventory/lib/tracking";
import { formatSupplier, combineSupplierInfo, buildSupplierDisplay } from "@/inventory/lib/supplier";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  INBOUND_CLASS_ORDER,
  INBOUND_CLASS_LABEL,
  UNCLASSIFIED_LABEL,
  getStagesForClass,
  getStageLabel,
  getStageIndex,
  nextStage,
  isInboundComplete,
  type InboundClass,
} from "@shared/inboundPipeline";
import { PAGE_SIZE } from "@/inventory/hooks/usePagination";
import { PaginationBar } from "@/inventory/components/PaginationBar";
import { EbayListingUrlEditor } from "@/inventory/components/EbayListingUrlEditor";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";

interface PurchaseItem {
  id: number;
  inventory_id: number;
  title: string;
  quantity: string;
  unit: string;
  unit_price: string;
  status: string;
  purchase_date: string | null;
  estimated_purchase_date: string | null;
  etc?: string;
  category: string;
  ebayListingUrl?: string | null;
}

interface Purchase {
  id: number;
  num: string;
  customer_name: string;
  status: string;
  purchaseDate?: string | null;
  purchase_date: string | null;
  estimated_purchase_date: string | null;
  created_at?: string | null;
  createdAt?: string | Date | null;
  csvSupplierName?: string | null;
  csvSupplierUrl?: string | null;
  // T22: 入庫仕訳・工程
  inboundClass?: InboundClass | null;
  classSource?: "auto" | "manual";
  stage?: string;
  stageUpdatedBy?: string | null;
  shaftParentPurchaseId?: number | null;
  purchase_items: PurchaseItem[];
  extra: {
    id: number;
    zaicoId: number;
    shipDate: string | null;
    trackingNumber: string | null;
    carrier: string | null;
    note: string | null;
  } | null;
}

interface EditState {
  shipDate: string;
  trackingNumber: string;
  carrier: string;
  note: string;
  supplierName: string;
  supplierUrl: string;
  // 商品別編集: inventory_id -> { title, unitPrice, managementNo, estimatedDate, category }
  itemEdits: Record<number, { title: string; unitPrice: string; quantity: string; managementNo: string; estimatedDate: string; category: string }>;
}

const CARRIER_OPTIONS = [
  { value: "auto", label: "自動判別" },
  { value: "japanpost", label: "日本郵便" },
  { value: "yamato", label: "ヤマト運輸" },
  { value: "sagawa", label: "佐川急便" },
  { value: "amazon", label: "Amazon" },
  { value: "seino", label: "西激運輸" },
  { value: "ecohai", label: "エコ配" },
  { value: "fukuyama", label: "福山通運" },
];

const PURCHASE_STATUS_FILTER_KEY = "purchases-statusFilter-v2";
const LEGACY_PURCHASE_STATUS_FILTER_KEY = "purchases-statusFilter";
// T22: 分類タブの選択状態
const PURCHASE_INBOUND_TAB_KEY = "purchases-inboundTab-v1";
// 2026-06-18の入庫ワークフロー刷新以前（6/19以前）の旧運用データを非表示にする
const INBOUND_CUTOFF_DATE = "2026-06-20";

/** 入庫管理CSVエクスポート */
function exportPurchasesCSV(purchases: Purchase[]) {
  const rows: string[][] = [
    ["発注No", "商品名", "管理番号", "カテゴリ", "仕入先", "発注日", "入庫予定日", "入庫日", "発送日", "追跡番号", "配送業者", "ステータス"],
  ];
  for (const p of purchases) {
    for (const item of p.purchase_items) {
      const { managementNo, supplierSite } = parseEtc(item.etc);
      const manualCarrier = p.extra?.carrier;
      const autoInfo = p.extra?.trackingNumber ? detectCarrier(p.extra.trackingNumber) : null;
      const carrierKey = (manualCarrier && manualCarrier !== "auto") ? manualCarrier : (autoInfo?.carrier ?? "");
      const carrierName = CARRIER_OPTIONS.find((o) => o.value === carrierKey)?.label ?? autoInfo?.carrierName ?? "";
      rows.push([
        p.num,
        item.title,
        managementNo,
        item.category ?? "",
        supplierSite,
        p.purchase_date ?? "",
        p.estimated_purchase_date ?? "",
        p.status === "purchased" ? (p.purchase_date ?? "") : "",
        p.extra?.shipDate ?? "",
        p.extra?.trackingNumber ?? "",
        carrierName,
        p.status,
      ]);
    }
  }
  const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
  const bom = "\uFEFF";
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `入庫管理_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * purchase_items[].etc をカンマ区切りでパースして管理番号・仕入先サイトを抽出する
 * フォーマット: "管理番号, 日付, 仕入先サイト"
 */
function parseEtc(etc?: string | null): { managementNo: string; supplierSite: string } {
  if (!etc) return { managementNo: "", supplierSite: "" };
  const parts = etc.split(",").map((p) => p.trim());
  return {
    managementNo: parts[0] ?? "",
    supplierSite: parts[2] ?? "",
  };
}

function hasUnitPrice(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function formatUnitPrice(value: unknown): string {
  return hasUnitPrice(value) ? `¥${Number(value).toLocaleString()}` : "-";
}

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

function normalizeDateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null;
}

function isInboundCutoffVisible(purchase: Purchase): boolean {
  const filterDate =
    normalizeDateOnly(purchase.purchaseDate) ??
    normalizeDateOnly(purchase.purchase_date) ??
    normalizeDateOnly(purchase.created_at) ??
    normalizeDateOnly(purchase.createdAt);
  return filterDate == null || filterDate >= INBOUND_CUTOFF_DATE;
}

function isInboundActivePurchase(purchase: Purchase): boolean {
  return purchase.status !== "purchased" && isInboundCutoffVisible(purchase);
}

function getEffectivePurchaseStatusKey(purchase: Purchase) {
  if (purchase.status !== "purchased" && purchase.extra?.trackingNumber) return "shipped";
  return purchase.status;
}

function isPurchaseInboundComplete(purchase: Purchase): boolean {
  return isInboundComplete(purchase.inboundClass ?? null, purchase.stage ?? "received");
}

type InboundTabCountKey = "unclassified" | InboundClass;
type InboundTabCounts = Record<InboundTabCountKey, number>;

function createEmptyInboundTabCounts(): InboundTabCounts {
  return {
    unclassified: 0,
    ebay: 0,
    oregon: 0,
    direct: 0,
    domestic: 0,
  };
}

function countInboundTabsForClient(purchases: Purchase[]): InboundTabCounts {
  const counts = createEmptyInboundTabCounts();
  for (const purchase of purchases) {
    if (!isInboundActivePurchase(purchase) || isPurchaseInboundComplete(purchase)) continue;
    const key = purchase.inboundClass ?? "unclassified";
    counts[key] += 1;
  }
  return counts;
}

type CarrierKey = Parameters<typeof getCarrierColor>[0];
const TRACKING_CARRIER_KEYS = new Set<string>([
  "yamato",
  "sagawa",
  "japanpost",
  "amazon",
  "seino",
  "fukuyama",
  "ecohai",
  "unknown",
]);

function normalizeCarrierKey(value: string | null | undefined, fallback: CarrierKey): CarrierKey {
  return value && TRACKING_CARRIER_KEYS.has(value) ? (value as CarrierKey) : fallback;
}

function getPurchaseCarrierMeta(purchase: Purchase, trackingNumber: string) {
  const autoInfo = detectCarrier(trackingNumber);
  const carrierKey = normalizeCarrierKey(
    purchase.extra?.carrier && purchase.extra.carrier !== "auto" ? purchase.extra.carrier : null,
    autoInfo.carrier,
  );
  const carrierName = CARRIER_OPTIONS.find((option) => option.value === carrierKey)?.label ?? autoInfo.carrierName;
  return {
    carrierKey,
    carrierName,
    colorClass: getCarrierColor(carrierKey),
  };
}

function filterPurchasesForView(
  purchases: Purchase[],
  selectedCategory: string,
  selectedStatusFilter: string | null,
  searchQuery: string,
) {
  let result = purchases.filter(isInboundActivePurchase);
  if (selectedCategory !== "すべて") {
    result = result.filter((purchase) =>
      purchase.purchase_items.some((item) => (item.category || "未分類") === selectedCategory)
    );
  }
  if (selectedStatusFilter) {
    result = result.filter((purchase) => getEffectivePurchaseStatusKey(purchase) === selectedStatusFilter);
  }
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    result = result.filter((purchase) => {
      const trackingNo = (purchase.extra?.trackingNumber ?? "").toLowerCase();
      return purchase.purchase_items.some((item) => {
        const itemTitle = (item.title ?? "").toLowerCase();
        const etcField = (item.etc ?? "").toLowerCase();
        const kanriNo = etcField.split(",")[0].trim();
        const invoiceNo = etcField.split(",")[2]?.trim() ?? "";
        return (
          kanriNo.includes(q) ||
          invoiceNo.includes(q) ||
          itemTitle.includes(q) ||
          trackingNo.includes(q)
        );
      });
    });
  }
  return result;
}

function TrackingNumberPanel({
  purchases,
  isOpen,
  onToggle,
}: {
  purchases: Purchase[];
  isOpen: boolean;
  onToggle: () => void;
}) {
  const trackingRows = useMemo(() => {
    return purchases
      .map((purchase) => {
        const trackingNumber = purchase.extra?.trackingNumber?.trim();
        if (!trackingNumber) return null;
        const firstItem = purchase.purchase_items[0];
        const { managementNo } = parseEtc(firstItem?.etc);
        const carrierMeta = getPurchaseCarrierMeta(purchase, trackingNumber);
        return {
          purchaseId: purchase.id,
          trackingNumber,
          managementNo: managementNo || purchase.num || `#${purchase.id}`,
          title: firstItem?.title ?? "-",
          itemCount: purchase.purchase_items.length,
          carrierMeta,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [purchases]);
  const missingTrackingCount = purchases.length - trackingRows.length;

  async function copyTrackingNumbers(numbers: string[], successMessage: string) {
    if (numbers.length === 0) return;
    try {
      await navigator.clipboard.writeText(numbers.join("\n"));
      toast.success(successMessage);
    } catch {
      toast.error("追跡番号のコピーに失敗しました");
    }
  }

  return (
    <div className="rounded-lg border bg-card shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors"
      >
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-semibold text-foreground">📦 追跡番号一覧（{trackingRows.length}件）</span>
          {missingTrackingCount > 0 && (
            <span className="hidden sm:inline text-xs text-muted-foreground">追跡番号なし: {missingTrackingCount}件</span>
          )}
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        )}
      </button>
      {isOpen && (
        <div className="border-t bg-muted/10">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <p className="text-xs text-muted-foreground">
              追跡番号あり: {trackingRows.length}件
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={trackingRows.length === 0}
              onClick={() =>
                copyTrackingNumbers(
                  trackingRows.map((row) => row.trackingNumber),
                  `${trackingRows.length}件の追跡番号をコピーしました`,
                )
              }
              className="h-8"
            >
              まとめてコピー
            </Button>
          </div>
          {trackingRows.length > 0 ? (
            <div className="max-h-[360px] overflow-y-auto divide-y">
              {trackingRows.map((row) => (
                <div key={row.purchaseId} className="px-4 py-3 space-y-2 sm:space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-xs font-medium ${row.carrierMeta.colorClass}`}>
                      {row.carrierMeta.carrierName}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyTrackingNumbers([row.trackingNumber], "追跡番号をコピーしました")
                      }
                      className="font-mono text-lg font-bold text-foreground hover:text-primary transition-colors"
                    >
                      {row.trackingNumber}
                    </button>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {row.managementNo} / {row.title}
                    {row.itemCount > 1 ? ` ほか${row.itemCount - 1}点` : ""}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">
              追跡番号が登録された荷物はありません
            </div>
          )}
          {missingTrackingCount > 0 && (
            <div className="px-4 py-2 border-t text-xs text-muted-foreground">
              追跡番号なし: {missingTrackingCount}件
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface OrderedPurchaseForm {
  inventoryId: string;
  title: string;
  quantity: string;
  unitPrice: string;
  customerName: string;
  num: string;
  estimatedPurchaseDate: string;
  memo: string;
  managementNo: string;
}

const emptyOrderedForm: OrderedPurchaseForm = {
  inventoryId: "",
  title: "",
  quantity: "1",
  unitPrice: "",
  customerName: "",
  num: "",
  estimatedPurchaseDate: "",
  memo: "",
  managementNo: "",
};

// ============================================================
// スマホ用発注カードコンポーネント
// ============================================================
interface PurchaseCardMobileProps {
  purchase: Purchase;
  managementNo: string;
  supplierSite: string;
  checked: boolean;
  onToggleCheck: () => void;
  onComplete: () => void;
  processing: boolean;
  deleting: Set<number>;
  onDeleteInventory: (inventoryId: number, title: string) => void;
  statusLabel: Record<string, string>;
  CARRIER_OPTIONS: { value: string; label: string }[];
  getStatusClass: (purchase: Purchase) => string;
  getEffectiveStatusLabel: (purchase: Purchase) => string;
}
function PurchaseCardMobile({
  purchase,
  managementNo,
  supplierSite,
  checked,
  onToggleCheck,
  onComplete,
  processing,
  deleting,
  onDeleteInventory,
  statusLabel,
  CARRIER_OPTIONS,
  getStatusClass,
  getEffectiveStatusLabel,
}: PurchaseCardMobileProps) {
  const [showDetail, setShowDetail] = useState(false);
  const firstItem = purchase.purchase_items[0];

  const trackingInfo = useMemo(() => {
    if (!purchase.extra?.trackingNumber) return null;
    const manualCarrier = purchase.extra?.carrier;
    const autoInfo = detectCarrier(purchase.extra.trackingNumber);
    const carrierKey = (manualCarrier && manualCarrier !== "auto") ? manualCarrier : autoInfo.carrier;
    const carrierName = CARRIER_OPTIONS.find((o) => o.value === carrierKey)?.label ?? autoInfo.carrierName;
    const num = purchase.extra.trackingNumber.trim().replace(/[\s-]/g, "");
    let url = autoInfo.trackingUrl;
    if (manualCarrier && manualCarrier !== "auto") {
      switch (manualCarrier) {
        case "japanpost": url = `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${num}&searchKind=S002&locale=ja`; break;
        case "yamato": url = `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${num}`; break;
        case "sagawa": url = `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${num}`; break;
        case "seino": url = `https://track.seino.co.jp/cgi-bin/gnpquery.pgm?GNPNO1=${num}`; break;
        case "fukuyama": url = `https://corp.fukutsu.co.jp/situation/tracking_no_input.html`; break;
        case "ecohai": url = null; break;
        case "amazon": url = `https://www.amazon.co.jp/progress-tracker/package/ref=pe_tracking?shipmentId=${num}`; break;
      }
    }
    return { carrierKey, carrierName, url, num, isEcohai: carrierKey === "ecohai" };
  }, [purchase.extra, CARRIER_OPTIONS]);

  return (
    <div className={`rounded-xl border bg-card shadow-sm overflow-hidden transition-all ${checked ? "border-primary ring-1 ring-primary/30" : ""}`}>
      {/* カードヘッダー */}
      <div className={`px-4 pt-4 pb-3 ${checked ? "bg-primary/5" : ""}`}>
        <div className="flex items-start gap-3">
          <Checkbox
            checked={checked}
            onCheckedChange={onToggleCheck}
            className="mt-0.5 flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-bold text-base text-foreground truncate">
                {managementNo || purchase.num || `#${purchase.id}`}
              </span>
              <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium flex-shrink-0 ${getStatusClass(purchase)}`}>
                {getEffectiveStatusLabel(purchase)}
              </span>
            </div>
            {(purchase.csvSupplierName || purchase.csvSupplierUrl || supplierSite || purchase.customer_name) && (
              <p className="text-sm text-muted-foreground truncate">
                仕入先:{" "}
                {purchase.csvSupplierUrl ? (
                  <a
                    href={purchase.csvSupplierUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="text-primary hover:underline inline-flex items-center gap-0.5"
                  >
                    🔗 {buildSupplierDisplay(purchase.csvSupplierUrl, purchase.csvSupplierName, purchase.customer_name)}
                  </a>
                ) : (
                  combineSupplierInfo(supplierSite, purchase.csvSupplierName, purchase.customer_name)
                )}
              </p>
            )}
          </div>
        </div>

        {/* 商品一覧（コンパクト） */}
        <div className="mt-3 space-y-2">
          {purchase.purchase_items.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between gap-2 bg-muted/30 rounded-lg px-3 py-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{item.title}</p>
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  <Badge variant="outline" className="text-xs py-0">{item.category || "未分類"}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {item.quantity} {item.unit}
                    {hasUnitPrice(item.unit_price) ? ` · ${formatUnitPrice(item.unit_price)}` : ""}
                  </span>
                  {item.estimated_purchase_date && (
                    <span className="text-xs text-muted-foreground">予定: {item.estimated_purchase_date}</span>
                  )}
                </div>
                <EbayListingUrlEditor
                  inventoryId={item.inventory_id}
                  managementNo={parseEtc(item.etc).managementNo}
                  value={item.ebayListingUrl}
                  compact
                  className="mt-1"
                />
              </div>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    disabled={deleting.has(item.inventory_id)}
                    className="text-muted-foreground/50 hover:text-destructive transition-colors p-1 flex-shrink-0"
                  >
                    {deleting.has(item.inventory_id) ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>商品を削除しますか？</AlertDialogTitle>
                    <AlertDialogDescription>
                      「{item.title}」を削除します。この操作は元に戻せません。
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => onDeleteInventory(item.inventory_id, item.title)}
                    >
                      削除する
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          ))}
        </div>

        {/* 追跡番号（あれば表示） */}
        {purchase.extra?.trackingNumber && trackingInfo && (
          <div className="mt-2 flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${getCarrierColor(trackingInfo.carrierKey as Parameters<typeof getCarrierColor>[0])}`}>
              {trackingInfo.carrierName}
            </span>
            <span className="text-foreground text-base font-bold truncate">{purchase.extra.trackingNumber}</span>
            {trackingInfo.isEcohai ? (
              <button
                type="button"
                onClick={() => {
                  const form = document.createElement("form");
                  form.method = "POST";
                  form.action = "https://www.ecohai.co.jp/cargo_tracking/search";
                  form.target = "_blank";
                  const input = document.createElement("input");
                  input.type = "hidden";
                  input.name = "slip[]";
                  input.value = trackingInfo.num;
                  form.appendChild(input);
                  document.body.appendChild(form);
                  form.submit();
                  document.body.removeChild(form);
                }}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground"
              >
                <ExternalLink className="h-3 w-3" />追跡
              </button>
            ) : trackingInfo.url ? (
              <a
                href={trackingInfo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground"
              >
                <ExternalLink className="h-3 w-3" />追跡
              </a>
            ) : null}
          </div>
        )}
      </div>

      {/* 入庫ボタン（スマホ用・大きく） */}
      <div className="px-4 pb-4">
        <Button
          className="w-full h-12 text-base font-bold bg-green-600 hover:bg-green-700 text-white rounded-xl shadow-sm active:scale-[0.98] transition-transform"
          onClick={onComplete}
          disabled={processing}
        >
          {processing ? (
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
          ) : (
            <PackageCheck className="h-5 w-5 mr-2" />
          )}
          入庫する
        </Button>
      </div>

      {/* 詳細情報（折りたたみ） */}
      <div className="border-t">
        <button
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-muted-foreground hover:bg-muted/20 transition-colors"
          onClick={() => setShowDetail((v) => !v)}
        >
          <span className="flex items-center gap-1.5">
            <Truck className="h-3.5 w-3.5" />
            発送情報
            {purchase.extra?.shipDate && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block" />
            )}
          </span>
          {showDetail ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {showDetail && (
          <div className="px-4 pb-3 space-y-1.5 text-sm bg-muted/10">
            <div className="flex gap-2">
              <span className="text-muted-foreground w-16 flex-shrink-0">発送日:</span>
              <span>{purchase.extra?.shipDate ?? <span className="italic text-muted-foreground/60">未設定</span>}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * T22: 1行分の入庫仕訳・工程コントロール。
 * - 分類セレクト（未仕訳/eBay/オレゴン/直取/国内）＋ 自動/手動バッジ
 * - 工程チップ（現工程ハイライト）＋「次工程へ進む」ボタン
 * - eBay/オレゴンの登録工程で「シャフト分離」
 * - 未仕訳はクイック分類ボタンを主導線に
 * - 完了行はバッジのみ（グレー）
 */
function InboundRowControls({
  purchase,
  busy,
  onSetClass,
  onAdvance,
  onSeparateShaft,
}: {
  purchase: Purchase;
  busy: boolean;
  onSetClass: (purchase: Purchase, cls: InboundClass | null) => void;
  onAdvance: (purchase: Purchase) => void;
  onSeparateShaft: (purchase: Purchase) => void;
}) {
  const inboundClass = purchase.inboundClass ?? null;
  const classSource = purchase.classSource ?? "auto";
  const stage = purchase.stage ?? "received";
  const stages = getStagesForClass(inboundClass);
  const currentIndex = getStageIndex(inboundClass, stage);
  const complete = isInboundComplete(inboundClass, stage);
  const upcoming = nextStage(inboundClass, stage);
  const canSeparateShaft =
    (inboundClass === "ebay" || inboundClass === "oregon") && stage === "registered" && !complete;

  return (
    <div className="mt-2 rounded-md border border-dashed bg-muted/30 px-3 py-2 space-y-2">
      {/* 分類行 */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] text-muted-foreground">分類:</span>
        <Select
          value={inboundClass ?? "unclassified"}
          onValueChange={(v) => onSetClass(purchase, v === "unclassified" ? null : (v as InboundClass))}
          disabled={busy}
        >
          <SelectTrigger className="h-7 w-[168px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unclassified">{UNCLASSIFIED_LABEL}</SelectItem>
            {INBOUND_CLASS_ORDER.map((cls) => (
              <SelectItem key={cls} value={cls}>{INBOUND_CLASS_LABEL[cls]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {inboundClass && (
          <Badge
            variant="outline"
            className={`text-[10px] ${classSource === "manual" ? "border-purple-300 text-purple-700 dark:text-purple-300" : "border-blue-300 text-blue-700 dark:text-blue-300"}`}
          >
            {classSource === "manual" ? "手動" : "自動"}
          </Badge>
        )}
        {complete && (
          <Badge className="text-[10px] bg-muted text-muted-foreground border">完了</Badge>
        )}
      </div>

      {/* 未仕訳: クイック分類ボタン（入庫作業前ゲート） */}
      {!inboundClass && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[11px] text-muted-foreground">仕訳:</span>
          {INBOUND_CLASS_ORDER.map((cls) => (
            <Button
              key={cls}
              size="sm"
              variant="outline"
              className="h-7 px-2 text-[11px]"
              disabled={busy}
              onClick={() => onSetClass(purchase, cls)}
            >
              {INBOUND_CLASS_LABEL[cls]}
            </Button>
          ))}
        </div>
      )}

      {/* 分類済み: 工程チップ ＋ 次工程ボタン */}
      {inboundClass && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            {stages.map((s, i) => {
              const done = complete || i <= currentIndex;
              const isCurrent = !complete && i === currentIndex;
              return (
                <span key={s} className="flex items-center gap-1">
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] border ${
                      isCurrent
                        ? "bg-blue-100 text-blue-700 border-blue-300 dark:bg-blue-900/40 dark:text-blue-200"
                        : done
                          ? "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-900/30 dark:text-teal-200"
                          : "bg-background text-muted-foreground border-border"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${done ? "bg-teal-500" : "bg-muted-foreground/30"}`} />
                    {getStageLabel(s)}
                  </span>
                  {i < stages.length - 1 && <span className="text-muted-foreground/40 text-[10px]">–</span>}
                </span>
              );
            })}
          </div>
          {!complete && upcoming && (
            <Button
              size="sm"
              className="h-7 px-2.5 text-[11px]"
              disabled={busy}
              onClick={() => onAdvance(purchase)}
            >
              {busy ? <Loader2 size={12} className="animate-spin" /> : `${getStageLabel(upcoming)}へ進む ▶`}
            </Button>
          )}
          {canSeparateShaft && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-[11px] border-amber-300 text-amber-700 dark:text-amber-300"
              disabled={busy}
              onClick={() => onSeparateShaft(purchase)}
            >
              シャフト分離
            </Button>
          )}
        </div>
      )}
      {purchase.shaftParentPurchaseId != null && (
        <div className="text-[10px] text-muted-foreground">
          ↳ シャフト分離で生成（元発注 #{purchase.shaftParentPurchaseId}）
        </div>
      )}
    </div>
  );
}

export default function Purchases() {
  const [location] = useLocation();
  const utils = trpc.useUtils();
  const { data: inventories, refetch: refetchInventories } = trpc.inventory.zaico.getInventories.useQuery(undefined, {
    enabled: false,
    staleTime: 5 * 60_000,
  });
  const completeMutation = trpc.inventory.zaico.completePurchase.useMutation();
  const upsertExtraMutation = trpc.inventory.purchaseExtra.upsert.useMutation();
  const upsertExtraBulkMutation = trpc.inventory.purchaseExtra.upsertBulk.useMutation();
  const deleteInventoryMutation = trpc.inventory.zaico.deleteInventory.useMutation();
  const deletePurchaseOnlyMutation = trpc.inventory.zaico.deletePurchaseOnly.useMutation();
  const updatePurchaseDataMutation = trpc.inventory.zaico.updatePurchaseData.useMutation();
  const createOrderedPurchaseMutation = trpc.inventory.zaico.createOrderedPurchase.useMutation();
  const { data: operators } = trpc.inventory.zaico.getOperators.useQuery();
  const { data: currentUser } = trpc.auth.me.useQuery();
  const { data: managedCategories } = trpc.inventory.zaico.getCategories.useQuery();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [editState, setEditState] = useState<EditState>({ shipDate: "", trackingNumber: "", carrier: "auto", note: "", supplierName: "", supplierUrl: "", itemEdits: {} });
  const updateSupplierNameOnlyMutation = trpc.inventory.zaico.updateSupplierNameOnly.useMutation();
  // T22: 分類・工程・シャフト分離のmutations
  const setInboundClassMutation = trpc.inventory.zaico.setInboundClass.useMutation();
  const advanceStageMutation = trpc.inventory.zaico.advanceStage.useMutation();
  const separateShaftMutation = trpc.inventory.zaico.separateShaft.useMutation();
  const [inboundBusyIds, setInboundBusyIds] = useState<Set<number>>(new Set());
  const [processingIds, setProcessingIds] = useState<Set<number>>(new Set());
  const [deletingIds, setDeletingIds] = useState<Set<number>>(new Set());
  const [purchasePage, setPurchasePage] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    return typeof window !== 'undefined' ? (localStorage.getItem('purchases-selectedCategory') ?? 'すべて') : 'すべて';
  });
  const handleSetSelectedCategory = useCallback((cat: string) => {
    setPurchasePage(1);
    setSelectedCategory(cat);
    localStorage.setItem('purchases-selectedCategory', cat);
  }, []);
  // T22: 分類タブ（"all"=全件 / "unclassified"=未仕訳 / ebay|oregon|direct|domestic）
  const [selectedInboundTab, setSelectedInboundTab] = useState<string>(() => {
    if (typeof window === "undefined") return "unclassified";
    const stored = localStorage.getItem(PURCHASE_INBOUND_TAB_KEY);
    const valid = ["all", "unclassified", ...INBOUND_CLASS_ORDER];
    return stored && valid.includes(stored) ? stored : "unclassified";
  });
  const handleSetInboundTab = useCallback((tab: string) => {
    setPurchasePage(1);
    setSelectedInboundTab(tab);
    if (typeof window !== "undefined") localStorage.setItem(PURCHASE_INBOUND_TAB_KEY, tab);
  }, []);
  // ステータスフィルター（null=すべて）
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    localStorage.removeItem(LEGACY_PURCHASE_STATUS_FILTER_KEY);
    const stored = localStorage.getItem(PURCHASE_STATUS_FILTER_KEY);
    return stored === "ordered" || stored === "shipped" ? stored : null;
  });
  const [showCompletedPurchases, setShowCompletedPurchases] = useState(false);
  const [isTrackingPanelOpen, setIsTrackingPanelOpen] = useState(false);
  const handleSetStatusFilter = useCallback((status: string | null) => {
    setSelectedStatusFilter(prev => {
      const next = prev === status ? null : status;
      if (next === null) {
        localStorage.removeItem(PURCHASE_STATUS_FILTER_KEY);
      } else {
        localStorage.setItem(PURCHASE_STATUS_FILTER_KEY, next);
      }
      setPurchasePage(1);
      return next;
    });
  }, []);
  const urlSearchQuery = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  }, [location]);
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  useEffect(() => {
    if (!urlSearchQuery || urlSearchQuery === searchQuery) return;
    setPurchasePage(1);
    setSearchQuery(urlSearchQuery);
  }, [searchQuery, setPurchasePage, urlSearchQuery]);
  const debouncedSearchQuery = useDebouncedValue(searchQuery.trim(), 250);
  const purchaseQueryInput = useMemo(() => ({
    page: purchasePage,
    pageSize: PAGE_SIZE,
    category: selectedCategory === "すべて" ? null : selectedCategory,
    status: selectedStatusFilter as "ordered" | "shipped" | null,
    search: debouncedSearchQuery || null,
    // T22: 分類タブ。"all"は全件のため未指定(null)にする
    inboundClass: (selectedInboundTab === "all"
      ? null
      : selectedInboundTab) as InboundClass | "unclassified" | null,
  }), [debouncedSearchQuery, purchasePage, selectedCategory, selectedStatusFilter, selectedInboundTab]);
  const { data: purchasePageData, isLoading, isFetching, refetch } = trpc.inventory.zaico.getPurchasesWithCategoryPage.useQuery(purchaseQueryInput, {
    staleTime: 5_000,
    refetchInterval: editingId === null ? 5_000 : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: "always",
  });
  const purchases = useMemo(
    () => ((purchasePageData?.items ?? []) as Purchase[]).filter(isInboundActivePurchase),
    [purchasePageData?.items],
  );
  const [showTotals, setShowTotals] = useState(true);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  // 入庫確認ダイアログ
  const [confirmPurchase, setConfirmPurchase] = useState<Purchase | null>(null);
  // 複数選択まとめ入庫
  const [checkedPurchaseIds, setCheckedPurchaseIds] = useState<Set<number>>(new Set());
  const [showBulkConfirm, setShowBulkConfirm] = useState(false);
  const [bulkProcessing, setBulkProcessing] = useState(false);
  // 一括追跡番号登録ダイアログ
  const [showBulkTrackingDialog, setShowBulkTrackingDialog] = useState(false);
  const [bulkTrackingForm, setBulkTrackingForm] = useState({ trackingNumber: "", shipDate: "", carrier: "auto" });
  const [isBulkTrackingSubmitting, setIsBulkTrackingSubmitting] = useState(false);
  // 発注済み登録ダイアログ
  const [showOrderedDialog, setShowOrderedDialog] = useState(false);
  const [orderedForm, setOrderedForm] = useState<OrderedPurchaseForm>(emptyOrderedForm);
  const [isOrderedSubmitting, setIsOrderedSubmitting] = useState(false);
  const [orderedInventorySearch, setOrderedInventorySearch] = useState("");
  // 操作者選択（localStorageで保持）
  const [selectedOperatorKey, setSelectedOperatorKey] = useState<string>(
    () => localStorage.getItem("zaico_operator_key") ?? "default"
  );
  function handleOperatorChange(key: string) {
    setSelectedOperatorKey(key);
    localStorage.setItem("zaico_operator_key", key);
  }
  // ログインユーザーのメールアドレスに基づいて操作者を自動選択
  useEffect(() => {
    if (!operators || !currentUser?.email) return;
    const matched = operators.find(
      (op) => op.email && op.email.toLowerCase() === currentUser.email!.toLowerCase()
    );
    if (matched) {
      setSelectedOperatorKey(matched.key);
      localStorage.setItem("zaico_operator_key", matched.key);
    }
  }, [operators, currentUser?.email]);
  // 選択中オペレーターの表示名
  const selectedOperatorName = operators?.find((o) => o.key === selectedOperatorKey)?.name ?? "野田";

  const today = new Date().toISOString().split("T")[0];

  // 発注済み登録: 在庫検索フィルター
  const filteredInventoriesForOrder = useMemo(() => {
    if (!inventories) return [];
    const q = orderedInventorySearch.toLowerCase();
    if (!q) return inventories.slice(0, 50);
    return (inventories as Array<{ id: number; title: string; quantity: string; unit: string; etc?: string; purchase_unit_price?: number }>)
      .filter((inv) =>
        inv.title.toLowerCase().includes(q) ||
        (inv.etc ?? "").toLowerCase().includes(q)
      )
      .slice(0, 50);
  }, [inventories, orderedInventorySearch]);

  function openOrderedDialog() {
    setOrderedForm(emptyOrderedForm);
    setOrderedInventorySearch("");
    setShowOrderedDialog(true);
    void refetchInventories();
  }

  function handleSelectInventoryForOrder(inv: { id: number; title: string; unit: string; purchase_unit_price?: number; etc?: string }) {
    const managementNo = inv.etc ? inv.etc.split(",")[0].trim() : "";
    setOrderedForm(f => ({
      ...f,
      inventoryId: String(inv.id),
      title: inv.title,
      unitPrice: inv.purchase_unit_price != null ? String(inv.purchase_unit_price) : "",
      managementNo,
    }));
    setOrderedInventorySearch(inv.title);
  }

  async function handleOrderedSubmit() {
    if (isOrderedSubmitting) return;
    if (!orderedForm.inventoryId) { toast.error("商品を選択してください"); return; }
    if (!orderedForm.title.trim()) { toast.error("商品名を入力してください"); return; }
    const qty = parseFloat(orderedForm.quantity);
    if (!qty || qty <= 0) { toast.error("数量は1以上を入力してください"); return; }
    setIsOrderedSubmitting(true);
    try {
      await createOrderedPurchaseMutation.mutateAsync({
        inventoryId: parseInt(orderedForm.inventoryId, 10),
        title: orderedForm.title.trim(),
        quantity: qty,
        unitPrice: orderedForm.unitPrice.trim() !== "" ? parseFloat(orderedForm.unitPrice) : undefined,
        customerName: orderedForm.customerName || undefined,
        num: orderedForm.num || undefined,
        estimatedPurchaseDate: orderedForm.estimatedPurchaseDate || undefined,
        memo: orderedForm.memo || undefined,
        managementNo: orderedForm.managementNo || undefined,
        operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
      });
      toast.success(`「${orderedForm.title}」を発注済みとして登録しました`);
      setShowOrderedDialog(false);
      setOrderedForm(emptyOrderedForm);
      await Promise.all([
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "登録に失敗しました";
      toast.error(msg);
    } finally {
      setIsOrderedSubmitting(false);
    }
  }

  const categoryTotals = useMemo(() => {
    return new Map((purchasePageData?.categoryTotals ?? []).map((row) => [row.category, row.total]));
  }, [purchasePageData?.categoryTotals]);

  const categoryCountMap = useMemo(() => {
    return new Map((purchasePageData?.categoryTotals ?? []).map((row) => [row.category, row.count]));
  }, [purchasePageData?.categoryTotals]);

  const grandTotal = purchasePageData?.grandTotal ?? 0;

  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    if (selectedCategory !== "すべて" && selectedCategory !== "未分類") cats.add(selectedCategory);
    for (const cat of managedCategories ?? []) {
      if (cat && cat !== "すべて" && cat !== "未分類") cats.add(cat);
    }
    for (const row of purchasePageData?.categoryTotals ?? []) {
      const cat = row.category.trim();
      if (cat && cat !== "未分類") cats.add(cat);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b, "ja"));
  }, [managedCategories, purchasePageData?.categoryTotals, selectedCategory]);

  const categories = useMemo(() => ["すべて", "未分類", ...categoryOptions], [categoryOptions]);

  const completedPurchaseCount = useMemo(
    () => purchases.filter(isPurchaseInboundComplete).length,
    [purchases],
  );
  const filteredPurchases = useMemo(
    () => showCompletedPurchases ? purchases : purchases.filter((purchase) => !isPurchaseInboundComplete(purchase)),
    [purchases, showCompletedPurchases],
  );
  const pagedPurchases = filteredPurchases;
  // T22: タブ見出しの未完了件数バッジ
  const rawInboundTabCounts = (purchasePageData as { tabCounts?: InboundTabCounts } | undefined)?.tabCounts;
  const rawInboundTabCountsSignature = useMemo(
    () => JSON.stringify(rawInboundTabCounts ?? {}),
    [rawInboundTabCounts],
  );
  const purchaseAllCountForTabCounts = purchasePageData?.allCount ?? null;
  const [cutoffInboundTabCounts, setCutoffInboundTabCounts] = useState<InboundTabCounts | null>(null);
  useEffect(() => {
    if (purchaseAllCountForTabCounts == null) return;
    let cancelled = false;

    async function loadCutoffInboundTabCounts() {
      try {
        const firstPage = await utils.inventory.zaico.getPurchasesWithCategoryPage.fetch({
          page: 1,
          pageSize: 100,
          inboundClass: null,
        });
        const allPurchases = [...((firstPage.items ?? []) as Purchase[])];
        const remainingPages = [];
        for (let page = 2; page <= firstPage.totalPages; page++) {
          remainingPages.push(
            utils.inventory.zaico.getPurchasesWithCategoryPage.fetch({
              page,
              pageSize: 100,
              inboundClass: null,
            }),
          );
        }
        const restPages = await Promise.all(remainingPages);
        for (const pageData of restPages) {
          allPurchases.push(...((pageData.items ?? []) as Purchase[]));
        }
        if (!cancelled) {
          setCutoffInboundTabCounts(countInboundTabsForClient(allPurchases));
        }
      } catch {
        if (!cancelled) setCutoffInboundTabCounts(null);
      }
    }

    void loadCutoffInboundTabCounts();
    return () => {
      cancelled = true;
    };
  }, [purchaseAllCountForTabCounts, rawInboundTabCountsSignature, utils]);
  const inboundTabCounts = cutoffInboundTabCounts ?? rawInboundTabCounts;
  const displayedPurchasePage = purchasePageData?.page ?? purchasePage;
  const purchaseTotalItems = purchasePageData?.totalCount ?? filteredPurchases.length;
  const purchaseTotalPages = purchasePageData?.totalPages ?? Math.max(1, Math.ceil(purchaseTotalItems / PAGE_SIZE));
  const purchaseStartIndex = purchaseTotalItems === 0 ? 0 : (displayedPurchasePage - 1) * PAGE_SIZE + 1;
  const purchaseEndIndex = Math.min(displayedPurchasePage * PAGE_SIZE, purchaseTotalItems);

  useEffect(() => {
    setCheckedPurchaseIds(new Set());
  }, [debouncedSearchQuery, purchasePage, selectedCategory, selectedInboundTab, selectedStatusFilter, showCompletedPurchases]);

  async function handleExportPurchasesCSV() {
    if (isExportingCsv) return;
    setIsExportingCsv(true);
    try {
      const allPurchases = await utils.inventory.zaico.getPurchasesWithCategory.fetch();
      const rows = filterPurchasesForView(
        allPurchases as unknown as Purchase[],
        selectedCategory,
        selectedStatusFilter,
        debouncedSearchQuery || searchQuery,
      );
      exportPurchasesCSV(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "CSV出力に失敗しました";
      toast.error(msg);
    } finally {
      setIsExportingCsv(false);
    }
  }

  function startEdit(purchase: Purchase) {
    setEditingId(purchase.id);
    const itemEdits: EditState["itemEdits"] = {};
    for (const item of purchase.purchase_items) {
      const { managementNo } = parseEtc(item.etc);
      itemEdits[item.inventory_id] = {
        title: item.title ?? "",
        unitPrice: hasUnitPrice(item.unit_price) ? String(item.unit_price) : "",
        quantity: String(item.quantity ?? "1"),
        managementNo,
        estimatedDate: item.estimated_purchase_date ?? "",
        category: item.category ?? "",
      };
    }
    // 発送日が未設定の場合は当日日付を自動セット
    const today = new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD形式
    setEditState({
      shipDate: purchase.extra?.shipDate ?? today,
      trackingNumber: purchase.extra?.trackingNumber ?? "",
      carrier: purchase.extra?.carrier ?? "auto",
      note: purchase.extra?.note ?? "",
      supplierName: purchase.csvSupplierName ?? "",
      supplierUrl: purchase.csvSupplierUrl ?? "",
      itemEdits,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditState({ shipDate: "", trackingNumber: "", carrier: "auto", note: "", supplierName: "", supplierUrl: "", itemEdits: {} });
  }

  async function saveEdit(purchaseId: number, purchase: Purchase) {
    try {
      const blankTitle = purchase.purchase_items.find((item) => {
        const edit = editState.itemEdits[item.inventory_id];
        return edit && edit.title.trim() === "";
      });
      if (blankTitle) {
        toast.error("商品名は空欄にできません");
        return;
      }
      const invalidQuantity = purchase.purchase_items.find((item) => {
        const edit = editState.itemEdits[item.inventory_id];
        if (!edit) return false;
        const quantity = Number.parseInt(edit.quantity, 10);
        return !Number.isFinite(quantity) || quantity < 1;
      });
      if (invalidQuantity) {
        toast.error("発注数量は1以上で入力してください");
        return;
      }

      // 入庫補足情報（発送日・追跡番号・備考）を保存
      await upsertExtraMutation.mutateAsync({
        zaicoId: purchaseId,
        shipDate: editState.shipDate || undefined,
        trackingNumber: editState.trackingNumber || undefined,
        carrier: editState.carrier === "auto" ? undefined : editState.carrier,
        note: editState.note || undefined,
      });
      // 発注データ（単価・管理番号・入庫予定日）を更新
      const itemEditsEntries = Object.entries(editState.itemEdits);
      if (itemEditsEntries.length > 0) {
        const purchaseItems = purchase.purchase_items.map((item) => {
          const edit = editState.itemEdits[item.inventory_id];
          if (!edit) return null;
          // etcフィールド: "管理番号, 日付, 仕入先" のカンマ区切りフォーマットを維持
          const parts = (item.etc ?? "").split(",").map((p) => p.trim());
          const newManagementNo = edit.managementNo.trim();
          const newEtc = newManagementNo
            ? [newManagementNo, parts[1] ?? "", parts[2] ?? ""].join(", ")
            : item.etc ?? "";
          const nextCategory = edit.category.trim();
          const currentCategory = item.category || "";
          const nextTitle = edit.title.trim();
          const currentTitle = item.title || "";
          const nextQuantity = Math.max(1, Number.parseInt(edit.quantity, 10));
          const currentQuantity = Math.max(1, Number.parseInt(String(item.quantity ?? "1"), 10) || 1);
          return {
            ...(item.id > 0 && { id: item.id }),
            inventoryId: item.inventory_id,
            ...(nextTitle !== currentTitle && { title: nextTitle }),
            ...(edit.unitPrice !== "" && { unitPrice: parseFloat(edit.unitPrice) }),
            ...(nextQuantity !== currentQuantity && { quantity: nextQuantity }),
            ...(edit.estimatedDate !== "" && { estimatedPurchaseDate: edit.estimatedDate }),
            ...(newManagementNo !== parseEtc(item.etc).managementNo && { etc: newEtc }),
            ...(nextCategory !== currentCategory && { category: nextCategory || null }),
          };
        }).filter((x): x is NonNullable<typeof x> => x !== null);
        if (purchaseItems.length > 0) {
          await updatePurchaseDataMutation.mutateAsync({
            purchaseId,
            purchaseItems,
            operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
          });
        }
      }
      // 仕入先名を更新（local_inventoriesのsupplierNameを更新）
      if (editState.supplierName !== (purchase.csvSupplierName ?? "")) {
        const firstItem = purchase.purchase_items[0];
        if (firstItem?.inventory_id) {
          await updateSupplierNameOnlyMutation.mutateAsync({
            purchaseId,
            inventoryId: firstItem.inventory_id,
            supplierName: editState.supplierName || null,
            supplierUrl: editState.supplierUrl.trim() || null,
          });
        }
      }
      if (
        editState.supplierName === (purchase.csvSupplierName ?? "") &&
        editState.supplierUrl !== (purchase.csvSupplierUrl ?? "")
      ) {
        const firstItem = purchase.purchase_items[0];
        if (firstItem?.inventory_id) {
          await updateSupplierNameOnlyMutation.mutateAsync({
            purchaseId,
            inventoryId: firstItem.inventory_id,
            supplierName: editState.supplierName || null,
            supplierUrl: editState.supplierUrl.trim() || null,
          });
        }
      }
      toast.success("保存しました");
      setEditingId(null);
      await Promise.all([
        utils.inventory.zaico.getCategories.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      ]);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "保存に失敗しました";
      toast.error(msg);
    }
  }

  async function handleComplete(purchase: Purchase) {
    if (processingIds.has(purchase.id)) return;
    setConfirmPurchase(purchase);
  }

  async function executeComplete(purchase: Purchase) {
    setConfirmPurchase(null);
    if (processingIds.has(purchase.id)) return;
    setProcessingIds((prev) => new Set(prev).add(purchase.id));
    const firstItem = purchase.purchase_items[0];
    const { managementNo, supplierSite } = parseEtc(firstItem?.etc);
    try {
      await completeMutation.mutateAsync({
        purchaseId: purchase.id,
        purchaseDate: today,
        purchaseItems: purchase.purchase_items.map((item) => ({
          inventory_id: item.inventory_id,
          quantity: String(item.quantity),
          unit_price: String(item.unit_price),
        })),
        historyData: {
          kanriNo: managementNo || undefined,
          title: firstItem?.title ?? "",
          category: firstItem?.category || undefined,
          supplier: supplierSite || purchase.customer_name || undefined,
          unitPrice: hasUnitPrice(firstItem?.unit_price) ? String(firstItem?.unit_price) : undefined,
          inventoryId: firstItem?.inventory_id || undefined,
        },
        operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
        operatorName: getCurrentWorkWorkerName(selectedOperatorName),
      });
      toast.success(`「${managementNo || purchase.num || purchase.id}」を入庫済みにしました`);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "入庫処理に失敗しました";
      toast.error(msg);
    } finally {
      setProcessingIds((prev) => {
        const next = new Set(prev);
        next.delete(purchase.id);
        return next;
      });
    }
  }

  // ── T22: 分類の手動上書き ──
  async function handleSetInboundClass(purchase: Purchase, inboundClass: InboundClass | null) {
    if (inboundBusyIds.has(purchase.id)) return;
    setInboundBusyIds((prev) => new Set(prev).add(purchase.id));
    try {
      await setInboundClassMutation.mutateAsync({ purchaseId: purchase.id, inboundClass });
      toast.success(
        inboundClass
          ? `分類を「${INBOUND_CLASS_LABEL[inboundClass]}」にしました`
          : "未仕訳に戻しました",
      );
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "分類の変更に失敗しました");
    } finally {
      setInboundBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(purchase.id);
        return next;
      });
    }
  }

  // ── T22: 工程を1つ進める ──
  async function handleAdvanceStage(purchase: Purchase) {
    if (inboundBusyIds.has(purchase.id)) return;
    setInboundBusyIds((prev) => new Set(prev).add(purchase.id));
    try {
      const res = await advanceStageMutation.mutateAsync({
        purchaseId: purchase.id,
        operatorName: getCurrentWorkWorkerName(selectedOperatorName),
        expectedStage: purchase.stage,
      });
      toast.success(`「${getStageLabel(res.stage)}」に進めました`);
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "工程を進められませんでした");
    } finally {
      setInboundBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(purchase.id);
        return next;
      });
    }
  }

  // ── T22: シャフト分離（国内出品・発送待ちの在庫行を生成） ──
  async function handleSeparateShaft(purchase: Purchase) {
    if (inboundBusyIds.has(purchase.id)) return;
    setInboundBusyIds((prev) => new Set(prev).add(purchase.id));
    try {
      await separateShaftMutation.mutateAsync({
        purchaseId: purchase.id,
        operatorName: getCurrentWorkWorkerName(selectedOperatorName),
      });
      toast.success("シャフトを分離し、国内出品・発送待ちに追加しました");
      refetch();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "シャフト分離に失敗しました");
    } finally {
      setInboundBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(purchase.id);
        return next;
      });
    }
  }

  async function handleDeleteInventory(inventoryId: number, title: string) {
    if (deletingIds.has(inventoryId)) return;
    setDeletingIds((prev) => new Set(prev).add(inventoryId));
    try {
      await deleteInventoryMutation.mutateAsync({ inventoryId });
      toast.success(`「${title}」を削除しました`);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "削除に失敗しました";
      toast.error(msg);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(inventoryId);
        return next;
      });
    }
  }

  async function handleDeletePurchaseOnly(purchaseId: number, title: string, inventoryId?: number) {
    if (deletingIds.has(purchaseId)) return;
    setDeletingIds((prev) => new Set(prev).add(purchaseId));
    try {
      await deletePurchaseOnlyMutation.mutateAsync({
        purchaseId,
        operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
        inventoryId,
      });
      const msg = `「${title}」の発注データと在庫データを削除しました`;
      toast.success(msg);
      refetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "削除に失敗しました";
      toast.error(msg);
    } finally {
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.delete(purchaseId);
        return next;
      });
    }
  }

  const checkedPurchases = useMemo(
    () => (filteredPurchases as Purchase[]).filter((p) => checkedPurchaseIds.has(p.id)),
    [filteredPurchases, checkedPurchaseIds]
  );

  function togglePurchaseCheck(purchaseId: number) {
    setCheckedPurchaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(purchaseId)) next.delete(purchaseId);
      else next.add(purchaseId);
      return next;
    });
  }

  async function handleBulkComplete() {
    if (bulkProcessing || checkedPurchases.length === 0) return;
    setShowBulkConfirm(false);
    setBulkProcessing(true);
    let successCount = 0;
    let failCount = 0;
    for (const purchase of checkedPurchases) {
      try {
        const firstItem = purchase.purchase_items[0];
        const { managementNo, supplierSite } = parseEtc(firstItem?.etc);
        await completeMutation.mutateAsync({
          purchaseId: purchase.id,
          purchaseDate: today,
          purchaseItems: purchase.purchase_items.map((item) => ({
            inventory_id: item.inventory_id,
            quantity: String(item.quantity),
            unit_price: String(item.unit_price),
          })),
          historyData: {
            kanriNo: managementNo || undefined,
            title: firstItem?.title ?? "",
            category: firstItem?.category || undefined,
            supplier: supplierSite || purchase.customer_name || undefined,
            unitPrice: hasUnitPrice(firstItem?.unit_price) ? String(firstItem?.unit_price) : undefined,
            inventoryId: firstItem?.inventory_id || undefined,
          },
          operatorKey: (selectedOperatorKey as "default" | "A" | "B"),
          operatorName: getCurrentWorkWorkerName(selectedOperatorName),
        });
        successCount++;
      } catch {
        failCount++;
      }
    }
    setBulkProcessing(false);
    setCheckedPurchaseIds(new Set());
    refetch();
    if (failCount === 0) {
      toast.success(`${successCount}件の入庫登録が完了しました`);
    } else {
      toast.warning(`${successCount}件成功、${failCount}件失敗`);
    }
  }

  async function handleBulkTrackingSubmit() {
    if (isBulkTrackingSubmitting || checkedPurchases.length === 0) return;
    if (!bulkTrackingForm.trackingNumber.trim()) {
      toast.error("追跡番号を入力してください");
      return;
    }
    setIsBulkTrackingSubmitting(true);
    try {
      await upsertExtraBulkMutation.mutateAsync({
        zaicoIds: checkedPurchases.map((p) => p.id),
        trackingNumber: bulkTrackingForm.trackingNumber.trim() || undefined,
        shipDate: bulkTrackingForm.shipDate || undefined,
        carrier: bulkTrackingForm.carrier === "auto" ? undefined : bulkTrackingForm.carrier,
      });
      toast.success(`${checkedPurchases.length}件に追跡番号を登録しました`);
      setShowBulkTrackingDialog(false);
      setBulkTrackingForm({ trackingNumber: "", shipDate: "", carrier: "auto" });
      refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "登録に失敗しました";
      toast.error(msg);
    } finally {
      setIsBulkTrackingSubmitting(false);
    }
  }

  const statusLabel: Record<string, string> = {
    none: "なし",
    not_ordered: "発注前",
    ordered: "発注済み",
    shipped: "発送済み",
    purchased: "入庫済み",
    quotation_requested: "見積依頼済み",
  };

  /** ステータスに対応するBadgeのCSSクラスを返す
   * 追跡番号があれば「発送済み」として扮う */
  function getStatusClass(purchase: Purchase): string {
    const effectiveStatus = (purchase.status !== "purchased" && purchase.extra?.trackingNumber)
      ? "shipped"
      : purchase.status;
    switch (effectiveStatus) {
      case "not_ordered": return "bg-muted text-muted-foreground border border-border";
      case "ordered": return "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300";
      case "shipped": return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300";
      case "purchased": return "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300";
      case "quotation_requested": return "bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300";
      default: return "bg-muted text-muted-foreground";
    }
  }

  function getEffectiveStatusLabel(purchase: Purchase): string {
    if (purchase.status !== "purchased" && purchase.extra?.trackingNumber) return statusLabel["shipped"];
    return statusLabel[purchase.status] ?? purchase.status;
  }

  if (isLoading && !purchasePageData) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">入庫予定を読み込み中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ヘッダー（スクロール固定） */}
      <div className="-mx-4 px-4 pb-2 pt-1">
      <div className="rounded-xl border bg-card shadow-sm px-4 py-3 space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">入庫管理</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              入庫データ一覧 ({purchaseTotalItems}/{purchasePageData?.allCount ?? purchaseTotalItems} 件)
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {/* PC用: 発注済み登録ボタン */}
            <Button
              variant="outline"
              size="sm"
              onClick={openOrderedDialog}
              className="hidden md:flex"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              発注済み登録
            </Button>
            <button
              onClick={() => setShowTotals((v) => !v)}
              className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                showTotals
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted/50"
              }`}
            >
              <span className="text-xs">{showTotals ? "合計: ON" : "合計: OFF"}</span>
            </button>
            <Button variant="outline" size="sm" onClick={handleExportPurchasesCSV} disabled={isExportingCsv} className="hidden md:flex">
              {isExportingCsv ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Download className="h-4 w-4 mr-1.5" />}
              CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              <span className="hidden md:inline">更新</span>
            </Button>
            {/* スマホ用: 発注済み登録ボタン */}
            <Button
              variant="outline"
              size="sm"
              onClick={openOrderedDialog}
              className="md:hidden"
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {/* 検索バー */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="管理番号・商品名・追跡番号で検索..."
            value={searchQuery}
            onChange={(e) => {
              setPurchasePage(1);
              setSearchQuery(e.target.value);
            }}
            className="pl-9 h-9 text-sm"
          />
          {searchQuery && (
            <button
              onClick={() => {
                setPurchasePage(1);
                setSearchQuery("");
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      </div>

      {/* 合計金額サマリー（PC用） */}
      {showTotals && grandTotal > 0 && (
        <div className="hidden md:block rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">入庫予定 合計金額</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Array.from(categoryTotals.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([cat, total]) => {
                const isActive = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() => handleSetSelectedCategory(isActive ? "すべて" : cat)}
                    className={`rounded-md px-3 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground ring-2 ring-primary"
                        : "bg-muted/30 hover:bg-muted/60"
                    }`}
                  >
                    <p className={`text-xs truncate ${isActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}>{cat}</p>
                    <p className={`text-sm font-semibold ${isActive ? "text-primary-foreground" : "text-foreground"}`}>¥{total.toLocaleString()}</p>
                  </button>
                );
              })}
          </div>
          <div className="mt-3 pt-3 border-t flex items-center justify-between">
            <span className="text-sm text-muted-foreground">全カテゴリ合計</span>
            <span className="text-lg font-bold text-primary">¥{grandTotal.toLocaleString()}</span>
          </div>
        </div>
      )}

      {/* スマホ用: 合計金額コンパクト表示 */}
      {grandTotal > 0 && (
        <div className="md:hidden flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 border">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">入庫予定合計</span>
          </div>
          <span className="text-sm font-bold text-primary">¥{grandTotal.toLocaleString()}</span>
        </div>
      )}

      {/* カテゴリタブ */}
      {categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <Select value={selectedCategory} onValueChange={handleSetSelectedCategory}>
            <SelectTrigger className="w-56">
              <SelectValue placeholder="カテゴリーを選択" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((cat) => {
                const count = cat === "すべて"
                  ? purchasePageData?.allCount ?? 0
                  : categoryCountMap.get(cat) ?? 0;
                return (
                  <SelectItem key={cat} value={cat}>
                    {cat} ({count})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {selectedCategory !== "すべて" && (
            <button
              onClick={() => handleSetSelectedCategory("すべて")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" />
              解除
            </button>
          )}
          {/* ステータスフィルターボタン */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleSetStatusFilter('ordered')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                selectedStatusFilter === 'ordered'
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800'
              }`}
            >
              未発送（発注済み）
              {selectedStatusFilter === 'ordered' && (
                <span className="ml-1 opacity-70">×</span>
              )}
            </button>
            <button
              onClick={() => handleSetStatusFilter('shipped')}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                selectedStatusFilter === 'shipped'
                  ? 'bg-orange-600 text-white border-orange-600'
                  : 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800'
              }`}
            >
              入庫待ち（発送済み）
              {selectedStatusFilter === 'shipped' && (
                <span className="ml-1 opacity-70">×</span>
              )}
            </button>
            <button
              type="button"
              aria-pressed={showCompletedPurchases}
              onClick={() => {
                setPurchasePage(1);
                setShowCompletedPurchases((shown) => !shown);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                showCompletedPurchases
                  ? 'bg-muted text-foreground border-border'
                  : 'bg-background text-muted-foreground border-border hover:bg-muted/50'
              }`}
            >
              <Check className={`h-3.5 w-3.5 ${showCompletedPurchases ? "opacity-100" : "opacity-30"}`} />
              完了も表示
              {completedPurchaseCount > 0 && (
                <span className="opacity-70">({completedPurchaseCount})</span>
              )}
            </button>
          </div>
        </div>
      )}

      {/* T22: 入庫分類タブ（表示フィルタ層） */}
      <Tabs value={selectedInboundTab} onValueChange={handleSetInboundTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="unclassified" className="text-xs">
            {UNCLASSIFIED_LABEL}
            {inboundTabCounts && inboundTabCounts.unclassified > 0 && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] bg-red-500 text-white">
                {inboundTabCounts.unclassified}
              </Badge>
            )}
          </TabsTrigger>
          {INBOUND_CLASS_ORDER.map((cls) => (
            <TabsTrigger key={cls} value={cls} className="text-xs">
              {INBOUND_CLASS_LABEL[cls]}
              {inboundTabCounts && inboundTabCounts[cls] > 0 && (
                <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] bg-muted-foreground/70 text-white">
                  {inboundTabCounts[cls]}
                </Badge>
              )}
            </TabsTrigger>
          ))}
          <TabsTrigger value="all" className="text-xs">すべて</TabsTrigger>
        </TabsList>
      </Tabs>

      <TrackingNumberPanel
        purchases={filteredPurchases}
        isOpen={isTrackingPanelOpen}
        onToggle={() => setIsTrackingPanelOpen((open) => !open)}
      />

      {/* 入庫予定なし */}
      {!filteredPurchases || filteredPurchases.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <PackageCheck className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">入庫データはありません</p>
          <p className="text-sm text-muted-foreground mt-1">
            サイト内DBに登録した入庫データが表示されます
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* ===== スマホ用レイアウト ===== */}
          <div className="md:hidden space-y-3">
            {pagedPurchases.map((purchase) => {
              const firstItem = purchase.purchase_items[0];
              const { managementNo, supplierSite } = parseEtc(firstItem?.etc);
              const inboundComplete = isPurchaseInboundComplete(purchase);
              return (
                <div key={purchase.id} className={inboundComplete ? "opacity-60" : ""}>
                  <PurchaseCardMobile
                    purchase={purchase as Purchase}
                    managementNo={managementNo}
                    supplierSite={supplierSite}
                    checked={checkedPurchaseIds.has(purchase.id)}
                    onToggleCheck={() => togglePurchaseCheck(purchase.id)}
                    onComplete={() => handleComplete(purchase as Purchase)}
                    processing={processingIds.has(purchase.id)}
                    deleting={deletingIds}
                    onDeleteInventory={handleDeleteInventory}
                    statusLabel={statusLabel}
                    CARRIER_OPTIONS={CARRIER_OPTIONS}
                    getStatusClass={getStatusClass}
                    getEffectiveStatusLabel={getEffectiveStatusLabel}
                  />
                  <div className="mt-1 px-1">
                    <InboundRowControls
                      purchase={purchase as Purchase}
                      busy={inboundBusyIds.has(purchase.id)}
                      onSetClass={handleSetInboundClass}
                      onAdvance={handleAdvanceStage}
                      onSeparateShaft={handleSeparateShaft}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* ===== PC用レイアウト（既存） ===== */}
          <div className="hidden md:block space-y-3">
            {pagedPurchases.map((purchase) => {
              const firstItem = purchase.purchase_items[0];
              const { managementNo, supplierSite } = parseEtc(firstItem?.etc);
              const inboundComplete = isPurchaseInboundComplete(purchase);
              return (
              <div key={purchase.id} className={`rounded-lg border bg-card shadow-sm overflow-hidden ${inboundComplete ? "opacity-60" : ""}`}>
                {/* 入庫ヘッダー */}
                <div className={`flex items-center justify-between px-4 py-3 border-b ${checkedPurchaseIds.has(purchase.id) ? "bg-primary/10" : "bg-muted/30"}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Checkbox
                      checked={checkedPurchaseIds.has(purchase.id)}
                      onCheckedChange={() => togglePurchaseCheck(purchase.id)}
                      className="flex-shrink-0"
                    />
                    <span className="font-semibold text-sm">
                      管理番号: {managementNo || purchase.num || `#${purchase.id}`}
                    </span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClass(purchase)}`}>
                      {getEffectiveStatusLabel(purchase)}
                    </span>
                    {(purchase.csvSupplierName || purchase.csvSupplierUrl || supplierSite || purchase.customer_name) && (
                      <span className="text-sm text-muted-foreground">
                        仕入先:{" "}
                        {purchase.csvSupplierUrl ? (
                          <a
                            href={purchase.csvSupplierUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-primary hover:underline inline-flex items-center gap-0.5"
                          >
                            🔗 {buildSupplierDisplay(purchase.csvSupplierUrl, purchase.csvSupplierName, purchase.customer_name)}
                          </a>
                        ) : (
                          combineSupplierInfo(supplierSite, purchase.csvSupplierName, purchase.customer_name)
                        )}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {editingId === purchase.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="default"
                          onClick={() => saveEdit(purchase.id, purchase)}
                          disabled={upsertExtraMutation.isPending}
                        >
                          {upsertExtraMutation.isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Check className="h-3.5 w-3.5" />
                          )}
                          <span className="ml-1">保存</span>
                        </Button>
                        <Button size="sm" variant="ghost" onClick={cancelEdit}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => startEdit(purchase as Purchase)}>
                        <Edit2 className="h-3.5 w-3.5 mr-1" />
                        編集
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => handleComplete(purchase as Purchase)}
                      disabled={processingIds.has(purchase.id)}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      {processingIds.has(purchase.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : (
                        <PackageCheck className="h-3.5 w-3.5 mr-1" />
                      )}
                      入庫
                    </Button>
                  </div>
                </div>

                {/* T22: 分類・工程コントロール */}
                <div className="px-4 pt-2">
                  <InboundRowControls
                    purchase={purchase as Purchase}
                    busy={inboundBusyIds.has(purchase.id)}
                    onSetClass={handleSetInboundClass}
                    onAdvance={handleAdvanceStage}
                    onSeparateShaft={handleSeparateShaft}
                  />
                </div>

                {/* 商品一覧テーブル */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm mobile-card-table">
                    <thead>
                      <tr className="border-b bg-muted/20">
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">商品名</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">カテゴリ</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">仕入単価</th>
                        <th className="text-right px-4 py-2 font-medium text-muted-foreground">発注数量</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">入庫予定日</th>
                        <th className="text-left px-4 py-2 font-medium text-muted-foreground">ステータス</th>
                        <th className="text-center px-4 py-2 font-medium text-muted-foreground">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {purchase.purchase_items.map((item, idx) => {
                        const isEditing = editingId === purchase.id;
                        const itemEdit = editState.itemEdits[item.inventory_id];
                        return (
                          <tr key={idx} className="border-b last:border-0 hover:bg-muted/10">
                            <td data-label="商品名" className="px-4 py-2">
                              {isEditing && itemEdit && (
                                <div className="space-y-1.5">
                                  <div>
                                    <label className="text-xs text-muted-foreground">商品名</label>
                                    <Input
                                      type="text"
                                      value={itemEdit.title}
                                      onChange={(e) => setEditState((s) => ({
                                        ...s,
                                        itemEdits: { ...s.itemEdits, [item.inventory_id]: { ...itemEdit, title: e.target.value } }
                                      }))}
                                      className="h-7 text-xs mt-0.5 min-w-[220px]"
                                      placeholder="商品名"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-xs text-muted-foreground">管理番号</label>
                                    <Input
                                      type="text"
                                      value={itemEdit.managementNo}
                                      onChange={(e) => setEditState((s) => ({
                                        ...s,
                                        itemEdits: { ...s.itemEdits, [item.inventory_id]: { ...itemEdit, managementNo: e.target.value } }
                                      }))}
                                      className="h-7 text-xs mt-0.5 min-w-[220px]"
                                      placeholder="管理番号"
                                    />
                                  </div>
                                </div>
                              )}
                              {!isEditing && (
                                <div>{item.title}</div>
                              )}
                              <EbayListingUrlEditor
                                inventoryId={item.inventory_id}
                                managementNo={parseEtc(item.etc).managementNo}
                                value={item.ebayListingUrl}
                                compact
                                className="mt-1"
                              />
                            </td>
                            <td data-label="カテゴリ" className="px-4 py-2">
                              {isEditing && itemEdit ? (
                                <Select
                                  value={itemEdit.category || "__none__"}
                                  onValueChange={(v) => setEditState((s) => ({
                                    ...s,
                                    itemEdits: {
                                      ...s.itemEdits,
                                      [item.inventory_id]: { ...itemEdit, category: v === "__none__" ? "" : v }
                                    }
                                  }))}
                                >
                                  <SelectTrigger className="h-7 min-w-[140px] text-xs">
                                    <SelectValue placeholder="カテゴリ" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">未分類</SelectItem>
                                    {categoryOptions.map((cat) => (
                                      <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              ) : (
                                <Badge variant="outline" className="text-xs">
                                  {item.category || "未分類"}
                                </Badge>
                              )}
                            </td>
                            <td data-label="仕入単価" className="px-4 py-2 text-right">
                              {isEditing && itemEdit ? (
                                <Input
                                  type="number"
                                  value={itemEdit.unitPrice}
                                  onChange={(e) => setEditState((s) => ({
                                    ...s,
                                    itemEdits: { ...s.itemEdits, [item.inventory_id]: { ...itemEdit, unitPrice: e.target.value } }
                                  }))}
                                  className="h-7 text-xs text-right w-24 ml-auto"
                                  placeholder="単価"
                                />
                              ) : (
                                formatUnitPrice(item.unit_price)
                              )}
                            </td>
                            <td data-label="発注数量" className="px-4 py-2 text-right">
                              {isEditing && itemEdit ? (
                                <div className="flex items-center justify-end gap-1">
                                  <Input
                                    type="number"
                                    min={1}
                                    step={1}
                                    value={itemEdit.quantity}
                                    onChange={(e) => setEditState((s) => ({
                                      ...s,
                                      itemEdits: { ...s.itemEdits, [item.inventory_id]: { ...itemEdit, quantity: e.target.value } }
                                    }))}
                                    className="h-7 w-20 text-right text-xs"
                                    placeholder="数量"
                                  />
                                  <span className="text-xs text-muted-foreground">{item.unit}</span>
                                </div>
                              ) : (
                                <>{item.quantity} {item.unit}</>
                              )}
                            </td>
                            <td data-label="入庫予定日" className="px-4 py-2">
                              {isEditing && itemEdit ? (
                                <Input
                                  type="date"
                                  value={itemEdit.estimatedDate}
                                  onChange={(e) => setEditState((s) => ({
                                    ...s,
                                    itemEdits: { ...s.itemEdits, [item.inventory_id]: { ...itemEdit, estimatedDate: e.target.value } }
                                  }))}
                                  className="h-7 text-xs"
                                />
                              ) : (
                                item.estimated_purchase_date ?? "-"
                              )}
                            </td>
                            <td data-label="ステータス" className="px-4 py-2">
                              <Badge variant={item.status === "purchased" ? "default" : "secondary"} className="text-xs">
                                {statusLabel[item.status] ?? item.status}
                              </Badge>
                            </td>
                            <td data-label="操作" className="px-4 py-2 text-center">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    disabled={deletingIds.has(purchase.id)}
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                  >
                                    {deletingIds.has(purchase.id) ? (
                                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3.5 w-3.5" />
                                    )}
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>発注データを削除しますか？</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      「{item.title}」の発注データと在庫データを同時に削除します。この操作は元に戻せません。
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>キャンセル</AlertDialogCancel>
                                    <AlertDialogAction
                                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                      onClick={() => handleDeletePurchaseOnly(purchase.id, item.title, item.inventory_id)}
                                    >
                                      削除する
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* 補足情報（発送日・追跡番号） */}
                <div className="px-4 py-3 border-t bg-muted/10">
                  {editingId === purchase.id ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                          <Truck className="h-3.5 w-3.5 inline mr-1" />
                          仕入先発送日
                        </label>
                        <Input
                          type="date"
                          value={editState.shipDate}
                          onChange={(e) => setEditState((s) => ({ ...s, shipDate: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                          追跡番号
                        </label>
                        <Input
                          type="text"
                          placeholder="追跡番号を入力"
                          value={editState.trackingNumber}
                          onChange={(e) => setEditState((s) => ({ ...s, trackingNumber: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                          配送業者
                        </label>
                        <Select
                          value={editState.carrier}
                          onValueChange={(v) => setEditState((s) => ({ ...s, carrier: v }))}
                        >
                          <SelectTrigger className="h-8 text-sm">
                            <SelectValue placeholder="自動判別" />
                          </SelectTrigger>
                          <SelectContent>
                            {CARRIER_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                          備考
                        </label>
                        <Input
                          type="text"
                          placeholder="備考を入力"
                          value={editState.note}
                          onChange={(e) => setEditState((s) => ({ ...s, note: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                          仕入先名
                        </label>
                        <Input
                          type="text"
                          placeholder="例: 駿河屋 盛岡MOSSビル店"
                          value={editState.supplierName}
                          onChange={(e) => setEditState((s) => ({ ...s, supplierName: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-medium text-muted-foreground block mb-1">
                          仕入先URL
                        </label>
                        <Input
                          type="text"
                          placeholder="https://example.com/item"
                          value={editState.supplierUrl}
                          onChange={(e) => setEditState((s) => ({ ...s, supplierUrl: e.target.value }))}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-4 text-sm">
                      <span className="text-muted-foreground">
                        <span className="font-medium">発送日:</span>{" "}
                        {purchase.extra?.shipDate ?? <span className="italic text-muted-foreground/60">未設定</span>}
                      </span>
                      <span className="text-muted-foreground flex items-center gap-2">
                        <span className="font-medium">追跡番号:</span>{" "}
                        {purchase.extra?.trackingNumber ? (
                          <>
                            <span className="text-foreground font-bold">{purchase.extra.trackingNumber}</span>
                            {(() => {
                              const manualCarrier = purchase.extra?.carrier;
                              const autoInfo = detectCarrier(purchase.extra.trackingNumber);
                              const carrierKey = (manualCarrier && manualCarrier !== "auto") ? manualCarrier : autoInfo.carrier;
                              const carrierName = CARRIER_OPTIONS.find((o) => o.value === carrierKey)?.label ?? autoInfo.carrierName;
                              const trackingUrl = autoInfo.trackingUrl;
                              const finalUrl = (() => {
                                if (!manualCarrier || manualCarrier === "auto") return trackingUrl;
                                const num = purchase.extra!.trackingNumber!.trim().replace(/[\s-]/g, "");
                                switch (manualCarrier) {
                                  case "japanpost": return `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${num}&searchKind=S002&locale=ja`;
                                  case "yamato": return `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${num}`;
                                  case "sagawa": return `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${num}`;
                                  case "seino": return `https://track.seino.co.jp/cgi-bin/gnpquery.pgm?GNPNO1=${num}`;
                                  case "fukuyama": return `https://corp.fukutsu.co.jp/situation/tracking_no_input.html`;
                                  case "ecohai": return null;
                                  case "amazon": return `https://www.amazon.co.jp/progress-tracker/package/ref=pe_tracking?shipmentId=${num}`;
                                  default: return trackingUrl;
                                }
                              })();
                              const colorClass = getCarrierColor(carrierKey as Parameters<typeof getCarrierColor>[0]);
                              return (
                                <>
                                  <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${colorClass}`}>
                                    {carrierName}
                                    {manualCarrier && manualCarrier !== "auto" && (
                                      <span className="ml-1 opacity-70">（手動）</span>
                                    )}
                                  </span>
                                  {(finalUrl || carrierKey === "ecohai") && (
                                    carrierKey === "ecohai" ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const num = purchase.extra!.trackingNumber!.trim().replace(/[\s-]/g, "");
                                          const form = document.createElement("form");
                                          form.method = "POST";
                                          form.action = "https://www.ecohai.co.jp/cargo_tracking/search";
                                          form.target = "_blank";
                                          const input = document.createElement("input");
                                          input.type = "hidden";
                                          input.name = "slip[]";
                                          input.value = num;
                                          form.appendChild(input);
                                          document.body.appendChild(form);
                                          form.submit();
                                          document.body.removeChild(form);
                                        }}
                                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-colors cursor-pointer ${getCarrierColor("ecohai")}`}
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        追跡
                                      </button>
                                    ) : (
                                      <a
                                        href={finalUrl!}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                                      >
                                        <ExternalLink className="h-3 w-3" />
                                        追跡
                                      </a>
                                    )
                                  )}
                                </>
                              );
                            })()}
                          </>
                        ) : (
                          <span className="italic text-muted-foreground/60">未設定</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
          <PaginationBar
            page={displayedPurchasePage}
            totalPages={purchaseTotalPages}
            onPageChange={setPurchasePage}
            totalItems={purchaseTotalItems}
            startIndex={purchaseStartIndex}
            endIndex={purchaseEndIndex}
          />
        </div>
      )}
      {/* 入庫確認ダイアログ */}
      {confirmPurchase && (() => {
        const firstItem = confirmPurchase.purchase_items[0];
        const { managementNo, supplierSite } = parseEtc(firstItem?.etc);
        return (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-card rounded-t-2xl sm:rounded-xl shadow-2xl border max-w-md w-full overflow-hidden">
              <div className="px-6 py-4 border-b bg-muted/30">
                <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                  <PackageCheck className="h-5 w-5 text-green-600" />
                  入庫確認
                </h2>
                <p className="text-sm text-muted-foreground mt-0.5">以下の内容で入庫登録しますか？</p>
              </div>
              <div className="px-6 py-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">管理番号</p>
                    <p className="font-medium">{managementNo || "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">入庫日</p>
                    <p className="font-medium">{today}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">商品名</p>
                    <p className="font-medium">{firstItem?.title ?? "-"}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">仕入れ単価</p>
                    <p className="font-medium">
                      {formatUnitPrice(firstItem?.unit_price)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">数量</p>
                    <p className="font-medium">{firstItem?.quantity ?? "-"} {firstItem?.unit ?? ""}</p>
                  </div>
                  {(confirmPurchase.csvSupplierName || supplierSite || confirmPurchase.customer_name) && (
                    <div className="col-span-2">
                      <p className="text-xs text-muted-foreground">仕入先</p>
                      <p className="font-medium">{combineSupplierInfo(supplierSite, confirmPurchase.csvSupplierName, confirmPurchase.customer_name)}</p>
                    </div>
                  )}
                  {firstItem?.category && (
                    <div>
                      <p className="text-xs text-muted-foreground">カテゴリー</p>
                      <p className="font-medium">{firstItem.category}</p>
                    </div>
                  )}
                </div>
                {/* 操作者選択 */}
                {operators && operators.length > 1 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground mb-2">操作者（作業履歴に記録されます）</p>
                    <div className="flex flex-wrap gap-2">
                      {operators.map((op) => (
                        <button
                          key={op.key}
                          onClick={() => handleOperatorChange(op.key)}
                          className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                            selectedOperatorKey === op.key
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-background text-foreground border-border hover:bg-muted/50"
                          }`}
                        >
                          {op.name}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="px-6 py-4 border-t flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setConfirmPurchase(null)}
                >
                  キャンセル
                </Button>
                <Button
                  className="flex-1 h-12 text-base font-bold bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => executeComplete(confirmPurchase)}
                  disabled={processingIds.has(confirmPurchase.id)}
                >
                  {processingIds.has(confirmPurchase.id) ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                  ) : (
                    <PackageCheck className="h-4 w-4 mr-1.5" />
                  )}
                  入庫登録する
                </Button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* まとめて入庫フッター（固定） */}
      {checkedPurchases.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-card border-t shadow-lg z-10">
          <div className="max-w-5xl mx-auto px-4 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {checkedPurchases.map((p) => {
                const fi = p.purchase_items[0];
                const { managementNo: mn } = parseEtc(fi?.etc);
                return (
                  <Badge key={p.id} variant="secondary" className="text-xs">
                    {mn || p.num || `#${p.id}`}
                  </Badge>
                );
              })}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 text-sm text-muted-foreground">
                <PackageCheck className="h-4 w-4 inline mr-1.5 text-green-600" />
                {checkedPurchases.length}件選択中
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCheckedPurchaseIds(new Set())}
              >
                選択解除
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setBulkTrackingForm({ trackingNumber: "", shipDate: new Date().toLocaleDateString("sv-SE"), carrier: "auto" });
                  setShowBulkTrackingDialog(true);
                }}
                disabled={bulkProcessing}
                className="border-blue-500 text-blue-600 hover:bg-blue-50"
              >
                <Truck className="h-4 w-4 mr-1.5" />
                追跡番号を一括登録
              </Button>
              <Button
                onClick={() => setShowBulkConfirm(true)}
                disabled={bulkProcessing}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                {bulkProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <PackageCheck className="h-4 w-4 mr-1.5" />
                )}
                まとめて入庫
                <Badge className="ml-1.5 bg-white/20 text-white text-xs">{checkedPurchases.length}</Badge>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* まとめて入庫確認ダイアログ */}
      {showBulkConfirm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-t-2xl sm:rounded-xl shadow-2xl border max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b bg-muted/30">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <PackageCheck className="h-5 w-5 text-green-600" />
                まとめて入庫確認
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">以下 {checkedPurchases.length} 件をまとめて入庫登録しますか？</p>
            </div>
            <div className="px-6 py-4">
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">管理番号</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">商品名</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkedPurchases.map((p) => {
                      const fi = p.purchase_items[0];
                      const { managementNo: mn } = parseEtc(fi?.etc);
                      return (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{mn || p.num || `#${p.id}`}</td>
                          <td className="px-3 py-2 text-muted-foreground">{fi?.title ?? "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-3">入庫日: {today}（今日）</p>
              {operators && operators.length > 1 && (
                <div className="mt-3 pt-3 border-t">
                  <p className="text-xs text-muted-foreground mb-2">操作者（作業履歴に記録されます）</p>
                  <div className="flex flex-wrap gap-2">
                    {operators.map((op) => (
                      <button
                        key={op.key}
                        onClick={() => handleOperatorChange(op.key)}
                        className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                          selectedOperatorKey === op.key
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-background text-foreground border-border hover:bg-muted/50"
                        }`}
                      >
                        {op.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-6 py-4 border-t flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setShowBulkConfirm(false)} disabled={bulkProcessing}>
                キャンセル
              </Button>
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={handleBulkComplete}
                disabled={bulkProcessing}
              >
                {bulkProcessing ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <PackageCheck className="h-4 w-4 mr-1.5" />
                )}
                まとめて入庫登録する
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 一括追跡番号登録ダイアログ */}
      {showBulkTrackingDialog && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-card rounded-t-2xl sm:rounded-xl shadow-2xl border max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b bg-muted/30">
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                <Truck className="h-5 w-5 text-blue-600" />
                追跡番号を一括登録
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">以下 {checkedPurchases.length} 件に同じ追跡番号を登録します</p>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* 対象一覧 */}
              <div className="border rounded-md overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/30 border-b">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">管理番号</th>
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground">商品名</th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkedPurchases.map((p) => {
                      const fi = p.purchase_items[0];
                      const { managementNo: mn } = parseEtc(fi?.etc);
                      return (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium">{mn || p.num || `#${p.id}`}</td>
                          <td className="px-3 py-2 text-muted-foreground">{fi?.title ?? "-"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* 入力フォーム */}
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">追跡番号 <span className="text-destructive">*</span></label>
                  <Input
                    type="text"
                    placeholder="追跡番号を入力"
                    value={bulkTrackingForm.trackingNumber}
                    onChange={(e) => setBulkTrackingForm((f) => ({ ...f, trackingNumber: e.target.value }))}
                    className="h-9"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">発送日</label>
                  <Input
                    type="date"
                    value={bulkTrackingForm.shipDate}
                    onChange={(e) => setBulkTrackingForm((f) => ({ ...f, shipDate: e.target.value }))}
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground block mb-1">配送業者</label>
                  <Select
                    value={bulkTrackingForm.carrier}
                    onValueChange={(v) => setBulkTrackingForm((f) => ({ ...f, carrier: v }))}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue placeholder="自動判別" />
                    </SelectTrigger>
                    <SelectContent>
                      {CARRIER_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t flex gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setShowBulkTrackingDialog(false)}
                disabled={isBulkTrackingSubmitting}
              >
                キャンセル
              </Button>
              <Button
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleBulkTrackingSubmit}
                disabled={isBulkTrackingSubmitting || !bulkTrackingForm.trackingNumber.trim()}
              >
                {isBulkTrackingSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <Truck className="h-4 w-4 mr-1.5" />
                )}
                {checkedPurchases.length}件に一括登録
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 発注済み登録ダイアログ */}
      <Dialog open={showOrderedDialog} onOpenChange={(open) => { if (!open) setShowOrderedDialog(false); }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-amber-600" />
              発注済み登録
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>商品を選択 <span className="text-destructive">*</span></Label>
              <Input
                placeholder="商品名で検索..."
                value={orderedInventorySearch}
                onChange={(e) => {
                  setOrderedInventorySearch(e.target.value);
                  if (!e.target.value) setOrderedForm(f => ({ ...f, inventoryId: "", title: "" }));
                }}
              />
              {orderedInventorySearch && !orderedForm.inventoryId && filteredInventoriesForOrder.length > 0 && (
                <div className="border rounded-md max-h-40 overflow-y-auto bg-popover shadow-md">
                  {filteredInventoriesForOrder.map((inv) => (
                    <button
                      key={inv.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-0"
                      onClick={() => handleSelectInventoryForOrder(inv as { id: number; title: string; unit: string; purchase_unit_price?: number; etc?: string })}
                    >
                      <span className="font-medium">{(inv as { title: string }).title}</span>
                      {(inv as { etc?: string }).etc && (
                        <span className="ml-2 text-xs text-muted-foreground">{(inv as { etc?: string }).etc?.split(",")[0]?.trim()}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              {orderedForm.inventoryId && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                  <PackageCheck className="h-4 w-4 text-amber-600 flex-shrink-0" />
                  <span className="text-sm font-medium text-amber-800">{orderedForm.title}</span>
                  <button
                    type="button"
                    className="ml-auto text-amber-600 hover:text-amber-800"
                    onClick={() => { setOrderedForm(f => ({ ...f, inventoryId: "", title: "" })); setOrderedInventorySearch(""); }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ordered-qty">発注数量 <span className="text-destructive">*</span></Label>
                <Input
                  id="ordered-qty"
                  type="number"
                  min={1}
                  value={orderedForm.quantity}
                  onChange={(e) => setOrderedForm(f => ({ ...f, quantity: e.target.value }))}
                  placeholder="1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ordered-price">仕入単価（円）</Label>
                <Input
                  id="ordered-price"
                  type="number"
                  min={0}
                  value={orderedForm.unitPrice}
                  onChange={(e) => setOrderedForm(f => ({ ...f, unitPrice: e.target.value }))}
                  placeholder="例: 1500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ordered-num">発注No</Label>
                <Input
                  id="ordered-num"
                  value={orderedForm.num}
                  onChange={(e) => setOrderedForm(f => ({ ...f, num: e.target.value }))}
                  placeholder="例: PO-2024-001"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ordered-date">入庫予定日</Label>
                <Input
                  id="ordered-date"
                  type="date"
                  value={orderedForm.estimatedPurchaseDate}
                  onChange={(e) => setOrderedForm(f => ({ ...f, estimatedPurchaseDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ordered-supplier">仕入先</Label>
              <Input
                id="ordered-supplier"
                value={orderedForm.customerName}
                onChange={(e) => setOrderedForm(f => ({ ...f, customerName: e.target.value }))}
                placeholder="仕入先名を入力"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ordered-memo">メモ</Label>
              <Textarea
                id="ordered-memo"
                value={orderedForm.memo}
                onChange={(e) => setOrderedForm(f => ({ ...f, memo: e.target.value }))}
                placeholder="メモを入力"
                rows={2}
              />
            </div>

            {operators && operators.length > 1 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-2">操作者（作業履歴に記録されます）</p>
                <div className="flex flex-wrap gap-2">
                  {operators.map((op) => (
                    <button
                      key={op.key}
                      type="button"
                      onClick={() => handleOperatorChange(op.key)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        selectedOperatorKey === op.key
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-foreground border-border hover:bg-muted/50"
                      }`}
                    >
                      {op.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowOrderedDialog(false)} disabled={isOrderedSubmitting}>
              キャンセル
            </Button>
            <Button
              onClick={handleOrderedSubmit}
              disabled={isOrderedSubmitting || !orderedForm.inventoryId}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isOrderedSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" />
              )}
              発注済みとして登録
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
