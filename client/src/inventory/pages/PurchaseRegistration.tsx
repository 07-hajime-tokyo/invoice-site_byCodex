import { loadLabelStartPosition, saveLabelStartPosition, LABEL_SCOPE_FROM_KEY, ISO_DATE_PATTERN, loadLabelScopeFrom, todayInTokyo } from "./purchase-registration/labelPrintSettings";
import { LabelPrintPanel } from "./purchase-registration/LabelPrintPanel";
import { MissingTrackingOverview } from "./purchase-registration/MissingTrackingOverview";
import { ProductQrCode } from "./purchase-registration/ProductQrCode";
import { LabelPrintStyles } from "./purchase-registration/LabelPrintStyles";
import { PrintableLabelSheet } from "./purchase-registration/PrintableLabelSheet";
import { PrintableChecklistSheet } from "./purchase-registration/LabelChecklists";
import { fieldClass } from "./purchase-registration/fieldStyles";
import { StockPanel } from "./purchase-registration/StockPanel";
import { openEcohaiTracking } from "./purchase-registration/trackingNavigation";
import { purchaseRowInventoryId } from "./purchase-registration/purchaseRowIdentity";
import { EmptyState } from "./purchase-registration/EmptyState";
import { OrderDashboard } from "./purchase-registration/OrderDashboard";
import { isShippableLabelStatus, mergeLabelViewsById } from "./purchase-registration/labelMerging";
import { hasOpenInvoiceQuantity, buildAllocationGroups, mergeAllocationGroupsByKey, getAllRowsFromGroup } from "./purchase-registration/allocationGroups";
import { ProductFulfillmentTableV2 } from "./purchase-registration/ProductFulfillmentTable";
import { buildLabelViews, buildClosedInvoiceInventoryLabelViews } from "./purchase-registration/registrationLabelViews";
import { actualProductTitle } from "./purchase-registration/productTitles";
import { filterRowsByProductDetail, filterStockItemsByProductDetail, filterStockItemsByInvoiceProductDetail } from "./purchase-registration/productDetailFilters";
import { buildProductSummaries, buildInvoiceStockProductSummaries, filterInvoiceStockItems, withInvoiceProductCounts, withInvoiceStockCountsFromItems } from "./purchase-registration/productSummaries";
import { unique } from "./purchase-registration/stringValues";
import { buildStockItemViewsFromInventories } from "./purchase-registration/stockViews";
import { isStockProposalAccessory, isFulfillmentStockItem } from "./purchase-registration/stockProposalRules";
import { getInventoryCategory, stockModelName } from "./purchase-registration/productPresentation";
import {
  labelStatusLabel,
  labelBadgeClass,
} from "./purchase-registration/labelStatus";
import {
  labelAllocationLabel,
  formatLabelPrintTitle,
} from "./purchase-registration/labelTitles";
import { LABELS_PER_SHEET, clampLabelStartPosition, nextLabelStartPosition, isWithinLabelScope } from "./purchase-registration/labelPrintLayout";
import { buildInventoryLabelViews } from "./purchase-registration/inventoryLabelViews";
import { cleanLegacyManagementNo, parsePurchaseEtc as parseEtc } from "@shared/purchaseMetadata";
import { getManagementNos } from "./purchase-registration/managementNumbers";
import { buildEtcWithManagementNo } from "./purchase-registration/purchaseEtc";
import {
  OTHER_INVOICE_KEY,
  EBAY_GROUP_KEY,
  EBAY_GROUP_LABEL,
  parseInvoiceFromManagementNo,
  isEbayManagementNo,
  getInvoiceInfo,
  invoiceNoFromGroupKey,
} from "./purchase-registration/invoiceIdentity";
import { getSupplier } from "./purchase-registration/supplier";
import {
  buildSearchText,
  buildStockSearchText,
} from "./purchase-registration/search";
import {
  matchesStatus,
  countPurchaseRows,
  withVisiblePurchaseItems,
  normalizePurchaseRegistrationRows,
} from "./purchase-registration/rowFilters";
import { getItemLabels } from "./purchase-registration/purchaseItems";
import { normalizedLabelStatus, purchaseRowStatusKind } from "./purchase-registration/rowStatus";
import { comparePurchaseRegistrationOrder } from "./purchase-registration/rowOrder";
import type { PurchaseRow, InventoryItem } from "./purchase-registration/dataTypes";
import type {
  StatusFilter,
  WorkflowTab,
  StockViewMode,
  TrackingFormState,
  PurchaseEditFormState,
  StockEditFormState,
} from "./purchase-registration/formTypes";
import type { LabelView, ShippingItemView, ProductSummary, InvoiceProductSummary, ProductDetailFilter, AllocationGroup } from "./purchase-registration/viewTypes";
import { formatCurrency } from "./purchase-registration/format";
import { TRACKING_CARRIER_LABELS, TRACKING_CARRIER_KEYS, TRACKING_CARRIER_OPTIONS, normalizedTrackingNumber, getPurchaseTrackingMeta, hasPurchaseTracking } from "./purchase-registration/tracking";
import { useEffect, useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { getCarrierColor, type Carrier } from "@/inventory/lib/tracking";
import { invoiceNoFromDeliveryNo, invoiceNoFromManagementNo } from "@shared/invoiceKey";
import { classifyOutboundScan, normalizeOutboundScan } from "@shared/outboundBoxes";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { FedexShipmentDialog, type HistoryItem } from "@/inventory/pages/DeliveryHistory";
import { getCurrentWorkWorkerName } from "@/inventory/lib/currentWorker";
import { Boxes, Check, CheckCircle2, ChevronDown, ClipboardCheck, ClipboardCopy, ExternalLink, FileText, Loader2, PackageCheck, PackageMinus, PackagePlus, Pencil, Printer, RefreshCw, RotateCcw, ScanLine, Search, Send, Tag, Trash2, Truck } from "lucide-react";

const EMPTY_INVOICE_PRODUCTS: InvoiceProductSummary[] = [];

const workflowTabs: Array<{ value: WorkflowTab; label: string; icon: typeof PackagePlus }> = [
  { value: "order", label: "発注登録", icon: PackagePlus },
  { value: "labels", label: "ラベル印刷", icon: Printer },
  { value: "scan", label: "入庫スキャン", icon: ScanLine },
  { value: "stock", label: "在庫一覧", icon: Boxes },
  { value: "shipping", label: "出庫", icon: Truck },
  { value: "returns", label: "返品", icon: RotateCcw },
];

const INVENTORY_LABEL_GROUP_KEY = "inventory-stock-labels";
type ShipmentSheetName = "独発送管理" | "サミー発送管理" | "デボン発送管理" | "サイモン発送管理" | "ネレ発送管理";
const SHIPMENT_SHEET_NAMES: ShipmentSheetName[] = ["独発送管理", "サミー発送管理", "デボン発送管理", "サイモン発送管理", "ネレ発送管理"];

function todayInputDate(): string {
  return new Date().toLocaleDateString("sv-SE");
}

/** 入庫スキャンの履歴。QR印刷や動作確認ページへ移動して戻っても残るよう端末に保存する。 */
const SCAN_HISTORY_STORAGE_KEY = "purchase-registration-scan-history-v1";
const SCAN_HISTORY_LIMIT = 50;

type ScanHistoryEntry = {
  labelId: string;
  title: string;
  legacyManagementNo: string;
  allocationLabel: string;
  supplierName: string;
  scannedAt: string;
};

function loadScanHistory(): ScanHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SCAN_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is ScanHistoryEntry => {
      return Boolean(entry) && typeof (entry as ScanHistoryEntry).labelId === "string";
    });
  } catch {
    return [];
  }
}

function saveScanHistory(entries: ScanHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SCAN_HISTORY_STORAGE_KEY, JSON.stringify(entries.slice(0, SCAN_HISTORY_LIMIT)));
  } catch {
    // 保存できなくてもスキャン作業自体は続けられるので握りつぶす
  }
}

function formatScanTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function todayCompact(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
}

function todayShortCompact(): string {
  const compact = todayCompact();
  return `${compact.slice(2, 4)}${compact.slice(4)}`;
}

function todayShipmentDate(): string {
  const now = new Date();
  return `${now.getMonth() + 1}/${now.getDate()}`;
}

function deliveryPartnerCode(group: AllocationGroup | null): string {
  const text = `${group?.partner ?? ""} ${group?.label ?? ""}`.normalize("NFKC").toLowerCase();
  if (text.includes("maxim") || text.includes("マキシム")) return "Maxim";
  if (text.includes("samee") || text.includes("sami") || text.includes("sammy") || text.includes("サミー")) return "samee";
  if (text.includes("simon") || text.includes("サイモン")) return "Simon";
  if (text.includes("nele") || text.includes("ネレ")) return "Nele";
  if (text.includes("devon") || text.includes("デボン")) return "devon";
  if (text.includes("luca") || text.includes("ルカ")) return "luca";
  if (text.includes("ebay")) return "ebay";
  const ascii = text.match(/[a-z0-9]+/g)?.join("") ?? "";
  return ascii || "stock";
}

function generatePurchaseRegistrationDeliveryNo(group: AllocationGroup | null, invoiceNoOverride?: string | null): string {
  const invoiceNo = invoiceNoOverride || invoiceNoFromGroupKey(group?.key);
  const code = deliveryPartnerCode(group);
  const datePart = ["Maxim", "Simon", "Nele"].includes(code) ? todayShortCompact() : todayCompact();
  const deliveryNo = `${code}${datePart}`;
  return invoiceNo ? `${invoiceNo}_${deliveryNo}` : `stock_${deliveryNo}`;
}



function commonInvoiceNoFromShippingItems(items: Array<Pick<ShippingItemView, "legacyManagementNo">>): string | null {
  const invoiceNos = unique(
    items
      .map((item) => parseInvoiceFromManagementNo(item.legacyManagementNo)?.invoiceNo ?? "")
      .filter(Boolean),
  );
  return invoiceNos.length === 1 ? invoiceNos[0] : null;
}

function detectShipmentSheetNameForText(text: string | null | undefined): ShipmentSheetName | null {
  const haystack = text?.normalize("NFKC").toLowerCase() ?? "";
  if (!haystack) return null;
  if (haystack.includes("devon") || haystack.includes("デボン")) return "デボン発送管理";
  if (haystack.includes("simon") || haystack.includes("サイモン")) return "サイモン発送管理";
  if (haystack.includes("nele") || haystack.includes("ネレ")) return "ネレ発送管理";
  if (haystack.includes("samee") || haystack.includes("sami") || haystack.includes("sammy") || haystack.includes("サミー")) return "サミー発送管理";
  if (haystack.includes("maxim") || haystack.includes("マキシム") || haystack.includes("luca") || haystack.includes("ルカ")) return "独発送管理";
  return null;
}

function detectShipmentSheetNameForGroup(
  group: AllocationGroup | null,
  items: Array<Pick<ShippingItemView, "legacyManagementNo" | "title">>,
): ShipmentSheetName {
  return (
    detectShipmentSheetNameForText(group?.partner) ??
    detectShipmentSheetNameForText(group?.label) ??
    items.map((item) => detectShipmentSheetNameForText(`${item.legacyManagementNo} ${item.title}`)).find(Boolean) ??
    "独発送管理"
  );
}

function isReceivableScanCandidate(label: LabelView): boolean {
  const status = normalizedLabelStatus(label.rawStatus);
  return (
    Boolean(label.labelId.trim()) &&
    !isShippableLabelStatus(status) &&
    status !== "shipped" &&
    status !== "returned" &&
    status !== "cancelled"
  );
}

function isShippableLabel(label: LabelView): boolean {
  return Boolean(label.labelId.trim()) && isShippableLabelStatus(label.rawStatus);
}

function groupKeyFromLabel(label: LabelView): string {
  const parsed = parseInvoiceFromManagementNo(label.legacyManagementNo);
  if (!parsed && isEbayManagementNo(label.legacyManagementNo)) return EBAY_GROUP_KEY;
  return parsed ? `invoice-${parsed.invoiceNo}` : INVENTORY_LABEL_GROUP_KEY;
}

function buildShippingItemsFromLabels(labels: LabelView[]): ShippingItemView[] {
  const used = new Set<string>();
  return labels.flatMap((label) => {
    const inventoryId = Number(label.inventoryId);
    const labelId = label.labelId.trim().toUpperCase();
    const canShip = isShippableLabelStatus(label.rawStatus);
    const isShipped = normalizedLabelStatus(label.rawStatus) === "shipped";
    if (!labelId || !Number.isFinite(inventoryId) || inventoryId <= 0 || (!canShip && !isShipped)) {
      return [];
    }
    const key = `${inventoryId}-${labelId}`;
    if (used.has(key)) return [];
    used.add(key);
    return [{
      key,
      inventoryId,
      labelId,
      rawStatus: label.rawStatus,
      status: label.status,
      canShip,
      title: label.title,
      legacyManagementNo: label.legacyManagementNo,
      allocationLabel: label.allocationLabel,
      unitPrice: label.unitPrice,
      supplier: label.supplier,
      quantity: 1,
      maxQuantity: 1,
    }];
  });
}

function selectedShippingItems(
  items: ShippingItemView[],
  keys: Set<string>,
  quantities: Record<string, number>,
): ShippingItemView[] {
  return items
    .filter((item) => item.canShip && keys.has(item.key))
    .map((item) => {
      const quantity = Math.min(item.maxQuantity, Math.max(1, Math.floor(quantities[item.key] ?? item.quantity)));
      return { ...item, quantity };
    });
}

function historyItemsToFedexItems(
  items: HistoryItem[],
): Array<{ productNameJa: string; productNameEn: string; quantity: number; managementNo?: string | null }> {
  return items
    .map((item) => ({
      productNameJa: item.title,
      productNameEn: item.title,
      quantity: Math.max(0, Math.floor(Number(item.quantity))),
      managementNo: item.managementNo ?? null,
    }))
    .filter((item) => item.quantity > 0);
}

function ScannedLabelPreview({ label }: { label: LabelView }) {
  const trackingNumber = label.trackingNumber?.trim();
  const trackingInfo = trackingNumber ? getPurchaseTrackingMeta(trackingNumber, label.carrier) : null;

  return (
    <div className="mt-3 flex flex-col gap-4 rounded-md border border-emerald-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
      <div className="min-w-0">
        <div className="font-mono text-3xl font-bold tracking-wide text-slate-950">{label.labelId}</div>
        {label.allocationLabel ? (
          <div className="mt-2 text-sm font-semibold text-slate-700">{label.allocationLabel}</div>
        ) : null}
        <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {label.legacyManagementNo}</div>
        <div className="mt-3 text-base font-semibold text-slate-950">{label.title}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{label.status}</Badge>
          <Badge variant="outline">{label.supplier.name}</Badge>
        </div>
        {trackingNumber && trackingInfo ? (
          <div className="mt-3 inline-flex max-w-full flex-wrap items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-900">
            <span className={`rounded px-1.5 py-0.5 text-xs ${getCarrierColor(trackingInfo.carrier)}`}>
              {TRACKING_CARRIER_LABELS[trackingInfo.carrier]}
            </span>
            <span className="text-xs text-blue-700">追跡番号</span>
            <span className="font-mono text-base font-bold text-slate-950">{trackingNumber}</span>
            {trackingInfo.isEcohai ? (
              <button
                type="button"
                onClick={() => openEcohaiTracking(trackingNumber)}
                className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <ExternalLink className="h-3 w-3" />
                追跡
              </button>
            ) : trackingInfo.trackingUrl ? (
              <a
                href={trackingInfo.trackingUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-blue-700"
              >
                <ExternalLink className="h-3 w-3" />
                追跡
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded border bg-white p-2">
        <ProductQrCode value={label.labelId} />
      </div>
    </div>
  );
}

type BarcodeDetectorResult = { rawValue?: string };
type BarcodeDetectorLike = { detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]> };
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

function getBarcodeDetectorConstructor(): BarcodeDetectorConstructor | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector ?? null;
}

function useQrCameraScanner(onDetected: (rawValue: string) => void) {
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanAnimationRef = useRef<number | null>(null);
  const scannerRunningRef = useRef(false);
  const lastDetectedRef = useRef<{ value: string; time: number } | null>(null);
  const onDetectedRef = useRef(onDetected);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  function stopCamera() {
    scannerRunningRef.current = false;
    if (scanAnimationRef.current != null) {
      window.cancelAnimationFrame(scanAnimationRef.current);
      scanAnimationRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }

  async function startCamera() {
    if (cameraActive) return;
    setCameraError("");
    const Detector = getBarcodeDetectorConstructor();
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("このブラウザではカメラQR読み取りが使えません。商品IDを入力してください。");
      return;
    }

    // iOS Safari は BarcodeDetector を持たないので、jsQR でフレームを自前デコードする
    let decodeFrame: (video: HTMLVideoElement) => Promise<string>;
    if (Detector) {
      const detector = new Detector({ formats: ["qr_code"] });
      decodeFrame = async (video) => {
        const codes = await detector.detect(video);
        return codes.find((code) => code.rawValue?.trim())?.rawValue?.trim() ?? "";
      };
    } else {
      const { default: jsQR } = await import("jsqr");
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      decodeFrame = async (video) => {
        if (!ctx || !video.videoWidth) return "";
        // 長辺640pxに落として毎フレームのデコード負荷を下げる
        const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
        canvas.width = Math.round(video.videoWidth * scale);
        canvas.height = Math.round(video.videoHeight * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return jsQR(image.data, image.width, image.height, { inversionAttempts: "dontInvert" })?.data?.trim() ?? "";
      };
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) throw new Error("Camera preview is not ready");

      streamRef.current = stream;
      video.srcObject = stream;
      setCameraActive(true);
      await video.play();

      scannerRunningRef.current = true;
      const scanFrame = async () => {
        if (!scannerRunningRef.current) return;
        const currentVideo = videoRef.current;
        if (currentVideo && currentVideo.readyState >= 2) {
          try {
            const rawValue = await decodeFrame(currentVideo);
            if (rawValue) {
              const now = Date.now();
              const previous = lastDetectedRef.current;
              if (!previous || previous.value !== rawValue || now - previous.time > 1600) {
                lastDetectedRef.current = { value: rawValue, time: now };
                stopCamera();
                onDetectedRef.current(rawValue);
                return;
              }
            }
          } catch (error) {
            setCameraError(error instanceof Error ? error.message : "QR読み取りに失敗しました");
            stopCamera();
            return;
          }
        }
        scanAnimationRef.current = window.requestAnimationFrame(scanFrame);
      };
      scanAnimationRef.current = window.requestAnimationFrame(scanFrame);
    } catch (error) {
      setCameraError(error instanceof Error ? error.message : "カメラを起動できませんでした");
      stopCamera();
    }
  }

  useEffect(() => {
    return () => {
      scannerRunningRef.current = false;
      if (scanAnimationRef.current != null) window.cancelAnimationFrame(scanAnimationRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return { cameraActive, cameraError, videoRef, startCamera, stopCamera };
}

function extractScannedLabelId(value: string): string {
  const normalized = value.normalize("NFKC").toUpperCase();
  const exact = normalized.trim().match(/^[A-Z]{7}$/)?.[0];
  if (exact) return exact;
  const tokens = normalized
    .split(/[^A-Z]+/)
    .flatMap((token) => token.match(/[A-Z]{7}/g) ?? []);
  return tokens.at(-1) ?? "";
}

function normalizeProductLabelInput(value: string): string {
  return (extractScannedLabelId(value) || value).trim().normalize("NFKC").toUpperCase();
}

function ScanPanel({
  labels,
  onReceivedLabel,
}: {
  labels: LabelView[];
  onReceivedLabel?: (label: LabelView) => void;
}) {
  const utils = trpc.useUtils();
  const [scanValue, setScanValue] = useState("");
  const [confirmValue, setConfirmValue] = useState("");
  const [selectedCandidateIds, setSelectedCandidateIds] = useState<Set<string>>(() => new Set());
  const [bulkReceivePending, setBulkReceivePending] = useState(false);
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>(() => loadScanHistory());
  const resumeCameraAfterConfirmRef = useRef(false);

  function pushScanHistory(entry: ScanHistoryEntry) {
    setScanHistory((current) => {
      // 同じ商品IDを読み直したときは最新の1件だけ残す
      const next = [entry, ...current.filter((item) => item.labelId !== entry.labelId)].slice(0, SCAN_HISTORY_LIMIT);
      saveScanHistory(next);
      return next;
    });
  }

  function clearScanHistory() {
    if (scanHistory.length === 0) return;
    if (!window.confirm("スキャン履歴を消しますか？")) return;
    setScanHistory([]);
    saveScanHistory([]);
  }
  // バーコードリーダーはキーボードとして打ち込むので、入力欄に常にフォーカスを戻す
  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const focusScanInput = () => {
    if (window.matchMedia("(hover: none)").matches) return; // スマホでキーボードが出るのを防ぐ
    window.setTimeout(() => scanInputRef.current?.focus(), 0);
  };
  const receiveMutation = trpc.inventory.orderManagement.receivePurchaseLabel.useMutation();
  type ReceivePurchaseLabelResult = Awaited<ReturnType<typeof receiveMutation.mutateAsync>>;
  const qrScanner = useQrCameraScanner((rawValue) => {
    openReceiveConfirm(rawValue, { resumeCameraAfterSuccess: true });
  });
  const scanSearchValue = scanValue.trim();
  const { data: serverScanData } = trpc.inventory.zaico.getPurchasesWithCategoryPage.useQuery(
    {
      page: 1,
      pageSize: 100,
      category: null,
      status: null,
      search: scanSearchValue || null,
      inboundClass: null,
    },
    {
      enabled: scanSearchValue.length >= 4,
      staleTime: 10_000,
      refetchOnWindowFocus: false,
    },
  );
  const serverScanLabels = useMemo(
    () => buildLabelViews((serverScanData?.items ?? []) as PurchaseRow[]),
    [serverScanData?.items],
  );
  const scanLabels = useMemo(() => mergeLabelViewsById(labels, serverScanLabels), [labels, serverScanLabels]);

  function getScanTarget(value: string) {
    const normalizedValue = value.trim().normalize("NFKC").toLowerCase();
    const scannedId = extractScannedLabelId(value);
    const normalizedTrackingValue = normalizedTrackingNumber(value).toLowerCase();
    const exactLabel = normalizedValue
      ? scanLabels.find(
          (candidate) =>
            candidate.labelId.toLowerCase() === normalizedValue ||
            (scannedId && candidate.labelId.toLowerCase() === scannedId.toLowerCase()),
        )
      : null;
    const candidates = normalizedValue
      ? mergeLabelViewsById(
          scanLabels.filter((candidate) => {
            const labelId = candidate.labelId.trim().toLowerCase();
            const managementNo = candidate.legacyManagementNo.toLowerCase();
            const trackingNumber = normalizedTrackingNumber(candidate.trackingNumber ?? "").toLowerCase();
            return (
              labelId === normalizedValue ||
              (scannedId && labelId === scannedId.toLowerCase()) ||
              managementNo.includes(normalizedValue) ||
              (normalizedTrackingValue.length >= 4 &&
                trackingNumber.length > 0 &&
                (trackingNumber.includes(normalizedTrackingValue) || normalizedTrackingValue.includes(trackingNumber)))
            );
          }),
        )
      : null;
    return {
      matched: exactLabel ?? null,
      candidates: (candidates ?? []).sort((a, b) => {
        const aReceived = isShippableLabelStatus(a.rawStatus) ? 1 : 0;
        const bReceived = isShippableLabelStatus(b.rawStatus) ? 1 : 0;
        if (aReceived !== bReceived) return aReceived - bReceived;
        return a.labelId.localeCompare(b.labelId, "ja", { numeric: true });
      }),
      receiveLabelId: exactLabel?.labelId ?? scannedId,
    };
  }

  const scanTarget = getScanTarget(scanValue);
  const confirmTarget = getScanTarget(confirmValue);
  const matched = scanTarget.matched;
  const candidateLabels = scanTarget.candidates;
  const receiveLabelId = scanTarget.receiveLabelId;
  const receivableCandidateLabels = candidateLabels.filter(isReceivableScanCandidate);
  const selectedCandidateLabels = candidateLabels.filter(
    (label) => selectedCandidateIds.has(label.labelId) && isReceivableScanCandidate(label),
  );
  const selectedCandidateCount = selectedCandidateLabels.length;
  const allReceivableCandidatesSelected =
    receivableCandidateLabels.length > 0 &&
    receivableCandidateLabels.every((label) => selectedCandidateIds.has(label.labelId));
  const isReceiving = receiveMutation.isPending || bulkReceivePending;

  useEffect(() => {
    setSelectedCandidateIds((current) => (current.size === 0 ? current : new Set()));
  }, [scanSearchValue]);

  // リーダーによってはEnterを付けずに打ち込むので、商品ID（英字7文字）が末尾に揃った時点で
  // 入庫確認を自動で開く。打ち込みは一瞬で終わるため、短い猶予を置いてから判定する。
  const autoConfirmedScanRef = useRef("");
  useEffect(() => {
    const trimmed = scanValue.trim();
    const scannedId = extractScannedLabelId(trimmed);
    if (!scannedId || !trimmed.normalize("NFKC").toUpperCase().endsWith(scannedId)) {
      autoConfirmedScanRef.current = "";
      return;
    }
    if (confirmValue || isReceiving) return;
    // 一度自動で開いたものを閉じた直後に開き直さないよう、同じ入力では二度発火させない
    if (autoConfirmedScanRef.current === trimmed) return;
    const timer = window.setTimeout(() => {
      autoConfirmedScanRef.current = trimmed;
      openReceiveConfirm(trimmed);
    }, 120);
    return () => window.clearTimeout(timer);
  }, [scanValue, confirmValue, isReceiving]);

  function markReceivedLabel(label: LabelView | null | undefined, result: ReceivePurchaseLabelResult) {
    if (!label) return;
    pushScanHistory({
      labelId: result.labelId ?? label.labelId,
      title: result.title ?? label.title,
      legacyManagementNo: result.legacyManagementNo ?? label.legacyManagementNo,
      allocationLabel: label.allocationLabel,
      supplierName: label.supplier.name,
      scannedAt: new Date().toISOString(),
    });
    onReceivedLabel?.({
      ...label,
      rawStatus: "received",
      status: labelStatusLabel("received"),
      title: result.title ?? label.title,
      legacyManagementNo: result.legacyManagementNo ?? label.legacyManagementNo,
      inventoryId: result.localInventoryId ?? label.inventoryId ?? null,
    });
  }

  async function refreshPurchaseRegistrationData() {
    await Promise.all([
      utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
      utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
      utils.inventory.zaico.getInventories.invalidate(),
      utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
    ]);
  }

  function toggleCandidateSelection(labelId: string, checked: boolean | "indeterminate") {
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (checked === true) {
        next.add(labelId);
      } else {
        next.delete(labelId);
      }
      return next;
    });
  }

  function toggleAllReceivableCandidates() {
    setSelectedCandidateIds((current) => {
      const next = new Set(current);
      if (allReceivableCandidatesSelected) {
        for (const label of receivableCandidateLabels) next.delete(label.labelId);
      } else {
        for (const label of receivableCandidateLabels) next.add(label.labelId);
      }
      return next;
    });
  }

  function openReceiveConfirm(
    value: string,
    options?: { resumeCameraAfterSuccess?: boolean; preserveSearchValue?: boolean },
  ) {
    const nextValue = value.trim();
    if (!nextValue) return;
    if (!options?.preserveSearchValue) {
      setScanValue(nextValue);
    }
    const target = getScanTarget(nextValue);
    if (!target.receiveLabelId) return;
    resumeCameraAfterConfirmRef.current = Boolean(options?.resumeCameraAfterSuccess);
    setConfirmValue(nextValue);
  }

  function closeReceiveConfirm() {
    resumeCameraAfterConfirmRef.current = false;
    setConfirmValue("");
    focusScanInput();
  }

  async function receiveMatchedLabel(targetValue = scanValue) {
    const target = getScanTarget(targetValue);
    if (!target.receiveLabelId || isReceiving) return;
    const shouldResumeCamera = resumeCameraAfterConfirmRef.current;
    const shouldKeepSearchValue = targetValue.trim() !== scanValue.trim();
    try {
      const result = await receiveMutation.mutateAsync({ labelId: target.receiveLabelId });
      if (result.alreadyReceived) {
        toast.info(`${result.labelId} はすでに入庫済みです`);
      } else {
        toast.success("登録しました。");
      }
      markReceivedLabel(target.matched, result);
      setSelectedCandidateIds((current) => {
        if (!current.has(result.labelId)) return current;
        const next = new Set(current);
        next.delete(result.labelId);
        return next;
      });
      if (!shouldKeepSearchValue) {
        setScanValue("");
      }
      closeReceiveConfirm();
      await refreshPurchaseRegistrationData();
      if (shouldResumeCamera) {
        window.setTimeout(() => {
          void qrScanner.startCamera();
        }, 250);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "入庫登録に失敗しました");
    }
  }

  async function receiveSelectedCandidates() {
    if (isReceiving || selectedCandidateLabels.length === 0) return;
    const targets = selectedCandidateLabels;
    const completedIds = new Set<string>();
    let receivedCount = 0;
    let alreadyReceivedCount = 0;
    let failedCount = 0;
    let firstErrorMessage: string | null = null;

    setBulkReceivePending(true);
    try {
      for (const label of targets) {
        try {
          const result = await receiveMutation.mutateAsync({ labelId: label.labelId });
          completedIds.add(result.labelId);
          if (result.alreadyReceived) {
            alreadyReceivedCount += 1;
          } else {
            receivedCount += 1;
          }
          markReceivedLabel(label, result);
        } catch (error) {
          failedCount += 1;
          firstErrorMessage ??= error instanceof Error ? error.message : null;
        }
      }

      if (receivedCount > 0) {
        toast.success(`${receivedCount.toLocaleString()}件を入庫登録しました`);
      }
      if (alreadyReceivedCount > 0) {
        toast.info(`${alreadyReceivedCount.toLocaleString()}件はすでに入庫済みです`);
      }
      if (failedCount > 0) {
        toast.error(
          firstErrorMessage
            ? `${failedCount.toLocaleString()}件の入庫登録に失敗しました: ${firstErrorMessage}`
            : `${failedCount.toLocaleString()}件の入庫登録に失敗しました`,
        );
      }

      setSelectedCandidateIds((current) => {
        if (completedIds.size === 0) return current;
        const next = new Set(current);
        for (const labelId of completedIds) next.delete(labelId);
        return next;
      });
      await refreshPurchaseRegistrationData();
    } finally {
      setBulkReceivePending(false);
    }
  }

  return (
    <div className="grid gap-3 md:gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="space-y-3 md:space-y-4">
      <section className="rounded-md border bg-background p-3 md:p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <h2 className="text-lg font-semibold">入庫スキャン</h2>
          <div className={cn("grid gap-2 md:flex md:flex-wrap", qrScanner.cameraActive ? "grid-cols-2" : "grid-cols-1")}>
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 md:h-9"
              onClick={qrScanner.startCamera}
              disabled={qrScanner.cameraActive}
            >
              <ScanLine className="h-4 w-4" />
              QR読取
            </Button>
            {qrScanner.cameraActive ? (
              <Button type="button" variant="outline" className="h-11 md:h-9" onClick={qrScanner.stopCamera}>
                停止
              </Button>
            ) : null}
          </div>
        </div>

        <div className={cn("mt-3 overflow-hidden rounded-md border bg-black", qrScanner.cameraActive ? "block" : "hidden")}>
          <video
            ref={qrScanner.videoRef}
            className="h-[58vh] min-h-[260px] max-h-[520px] w-full object-cover md:h-80 md:min-h-0"
            muted
            playsInline
          />
        </div>
        {qrScanner.cameraError ? <p className="mt-2 text-sm text-destructive">{qrScanner.cameraError}</p> : null}

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            ref={scanInputRef}
            value={scanValue}
            onChange={(event) => {
              setScanValue(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") openReceiveConfirm(scanValue);
            }}
            placeholder="商品ID・旧管理番号・追跡番号をスキャン/入力"
            autoComplete="off"
            className="h-12 font-mono text-base sm:h-9 sm:text-sm"
          />
          <Button
            type="button"
            className="h-12 gap-2 sm:h-9"
            disabled={!receiveLabelId || isReceiving}
            onClick={() => openReceiveConfirm(scanValue)}
          >
            {receiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            入庫確認
          </Button>
        </div>
      </section>

      <Dialog
        open={Boolean(confirmValue)}
        onOpenChange={(open) => {
          if (!open && !isReceiving) closeReceiveConfirm();
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-emerald-700" />
              入庫しますか？
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <div className="text-xs text-muted-foreground">読み取りID</div>
              <div className="font-mono text-lg font-bold">{confirmTarget.receiveLabelId || confirmValue}</div>
            </div>
            {confirmTarget.matched ? (
              <ScannedLabelPreview label={confirmTarget.matched} />
            ) : (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                画面上の候補には一致していません。商品IDとしてサーバーで確認して入庫します。
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isReceiving}
              onClick={() => closeReceiveConfirm()}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              className="gap-2"
              disabled={!confirmTarget.receiveLabelId || isReceiving}
              onClick={() => receiveMatchedLabel(confirmValue)}
            >
              {receiveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
              入庫する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {matched ? (
        <section className="rounded-md border border-emerald-200 bg-emerald-50 p-3 md:p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            対象IDを確認しました
          </div>
          <ScannedLabelPreview label={matched} />
        </section>
      ) : candidateLabels.length > 0 ? (
        <section className="rounded-md border border-blue-200 bg-blue-50 p-3 md:p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold text-blue-900">
              <Search className="h-4 w-4" />
              追跡番号の候補 {candidateLabels.length.toLocaleString()}件
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-2 bg-white"
                disabled={receivableCandidateLabels.length === 0 || isReceiving}
                onClick={toggleAllReceivableCandidates}
              >
                <Checkbox checked={allReceivableCandidatesSelected} className="pointer-events-none h-4 w-4" aria-hidden />
                {allReceivableCandidatesSelected ? "選択解除" : "全選択"}
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-2"
                disabled={selectedCandidateCount === 0 || isReceiving}
                onClick={receiveSelectedCandidates}
              >
                {bulkReceivePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />}
                {selectedCandidateCount > 0
                  ? `選択した${selectedCandidateCount.toLocaleString()}件を入庫`
                  : "選択した商品を入庫"}
              </Button>
            </div>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            {candidateLabels.map((label) => {
              const disabled = !isReceivableScanCandidate(label);
              const isSelected = selectedCandidateIds.has(label.labelId) && !disabled;
              return (
                <div
                  key={label.labelId}
                  className={cn(
                    "rounded-md border bg-white p-3 shadow-sm",
                    isSelected && "border-blue-500 bg-blue-50/70 ring-1 ring-blue-200",
                    disabled && "opacity-70",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <Checkbox
                      checked={isSelected}
                      disabled={disabled || isReceiving}
                      onCheckedChange={(checked) => toggleCandidateSelection(label.labelId, checked)}
                      aria-label={`${label.labelId}を選択`}
                      className="mt-1"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="break-all font-mono text-xl font-bold text-slate-950">{label.labelId}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{label.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {label.legacyManagementNo}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <Badge className={labelBadgeClass(label.rawStatus)}>{label.status}</Badge>
                        {label.trackingNumber ? <Badge variant="outline" className="font-mono">{label.trackingNumber}</Badge> : null}
                      </div>
                    </div>
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border bg-white p-1.5">
                      <ProductQrCode value={label.labelId} />
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-3 w-full gap-2"
                    disabled={disabled || isReceiving}
                    onClick={() => openReceiveConfirm(label.labelId, { preserveSearchValue: true })}
                  >
                    <PackageCheck className="h-4 w-4" />
                    この商品を入庫
                  </Button>
                </div>
              );
            })}
          </div>
        </section>
      ) : scanValue.trim() ? (
        <section className="rounded-md border bg-amber-50 p-4 text-sm text-amber-900">
          画面上では一致候補が見つかっていません。7文字の商品IDとして読めている場合は、サーバー側で確認して入庫登録します。
        </section>
      ) : (
        <EmptyState icon={ScanLine} title="スキャン待ちです" />
      )}
      </div>

      <ScanHistorySidebar entries={scanHistory} onClear={clearScanHistory} />
    </div>
  );
}

/** スキャンした商品を右側にためておくサイドバー。QR印刷や動作確認へ移動しても残る。 */
function ScanHistorySidebar({ entries, onClear }: { entries: ScanHistoryEntry[]; onClear: () => void }) {
  return (
    <aside className="space-y-3 xl:sticky xl:top-4 xl:self-start">
      <section className="rounded-md border bg-background p-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">スキャンしたデータ</h3>
          <Badge variant="outline">{entries.length.toLocaleString()}件</Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          この端末に保存されます。QR印刷や動作確認ページへ移動しても残ります。
        </p>
        <a
          href="/inventory/inbound"
          className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ClipboardCheck className="h-4 w-4" />
          動作確認に移る
        </a>
        {entries.length > 0 ? (
          <Button type="button" variant="ghost" size="sm" className="mt-2 w-full" onClick={onClear}>
            履歴を消す
          </Button>
        ) : null}
      </section>

      {entries.length === 0 ? (
        <div className="rounded-md border border-dashed p-4 text-center text-xs text-muted-foreground">
          まだスキャンしていません
        </div>
      ) : (
        <section className="space-y-2">
          {entries.map((entry) => (
            <div key={`${entry.labelId}-${entry.scannedAt}`} className="rounded-md border bg-card p-2.5 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono text-base font-bold tracking-wide text-slate-950">{entry.labelId}</div>
                  <div className="mt-0.5 truncate text-xs font-medium text-slate-700">{entry.title}</div>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatScanTime(entry.scannedAt)}</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {entry.allocationLabel ? (
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {entry.allocationLabel}
                  </Badge>
                ) : null}
                {entry.supplierName ? (
                  <Badge variant="outline" className="text-[11px]">
                    {entry.supplierName}
                  </Badge>
                ) : null}
              </div>
            </div>
          ))}
        </section>
      )}
    </aside>
  );
}

type OutboundBoxView = {
  id: number;
  boxCode: string;
  status: "open" | "sealed" | "shipped";
  deliveryHistoryId: number | null;
  trackingNumber: string | null;
  fedexShipmentId: number | null;
  openedAt: string | Date;
  sealedAt: string | Date | null;
  linkedAt: string | Date | null;
  items: Array<{
    id: number;
    labelId: string;
    title: string;
    status: string;
    legacyManagementNo: string | null;
    localInventoryId: number | null;
    assignedInvoiceNo: string | null;
  }>;
};

function localDateInputValue(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function outboundBoxPrintLabel(boxCode: string): LabelView {
  return {
    key: `outbound-box-${boxCode}`,
    labelId: boxCode,
    rawStatus: "open",
    status: "箱",
    title: "海外直取 出庫箱",
    printTitle: "海外直取 出庫箱",
    category: "出庫箱",
    legacyManagementNo: "",
    allocationLabel: "箱ID / OUTBOUND BOX",
    unitPrice: 0,
    supplier: { name: "", url: "" },
    purchaseDate: localDateInputValue(),
    rowId: 0,
    itemId: 0,
  };
}

/**
 * その日に荷受けしたぶんのラベルを刷る。荷受けの画面から直接使えるように、
 * 発注登録のラベル印刷タブと同じ機能をここへ切り出している。
 * 画面が持っているラベル一覧に依存せず、サーバーが返した荷受け行だけで組み立てる。
 */
export function ReceivedDateLabelPrint() {
  const [receivedDate, setReceivedDate] = useState<string>(() => todayInTokyo());
  const [excludeAccessories, setExcludeAccessories] = useState(true);
  const [startPosition, setStartPosition] = useState<number>(() => loadLabelStartPosition());
  const [labelsToPrint, setLabelsToPrint] = useState<LabelView[]>([]);
  const [printedStartPosition, setPrintedStartPosition] = useState(1);
  const [printJobId, setPrintJobId] = useState(0);

  const receivedQuery = trpc.inventory.inboundDesk.receivedLabelsOn.useQuery(
    { date: receivedDate },
    { enabled: /^\d{4}-\d{2}-\d{2}$/.test(receivedDate), staleTime: 30_000 },
  );

  const labels = useMemo<LabelView[]>(() => {
    const rows = receivedQuery.data?.labels ?? [];
    return rows.flatMap((row) => {
      // 消耗品（ケーブル・バッテリー等）はラベルを貼らない方針のため既定で外す
      if (excludeAccessories && isStockProposalAccessory(row.title, row.category)) return [];
      const view: LabelView = {
        key: `received-${row.labelId}`,
        labelId: row.labelId,
        rawStatus: row.status,
        status: labelStatusLabel(row.status),
        title: row.title,
        printTitle: formatLabelPrintTitle(row.title),
        category: row.category || stockModelName(row.title),
        legacyManagementNo: row.legacyManagementNo || "-",
        allocationLabel: labelAllocationLabel(row.legacyManagementNo || ""),
        unitPrice: 0,
        supplier: { name: "", url: "" },
        purchaseDate: "",
        rowId: 0,
        itemId: 0,
        inventoryId: null,
        trackingNumber: null,
        carrier: null,
      };
      return [view];
    });
  }, [excludeAccessories, receivedQuery.data]);

  useEffect(() => {
    if (printJobId === 0 || labelsToPrint.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, [labelsToPrint, printJobId]);

  // 刷り終わったら印刷ルートを空にする。残しておくと次の印刷に混ざる。
  useEffect(() => {
    const clear = () => setLabelsToPrint([]);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  const changeStartPosition = (value: number) => {
    const next = clampLabelStartPosition(value);
    setStartPosition(next);
    saveLabelStartPosition(next);
  };

  const print = () => {
    if (labels.length === 0) return;
    const start = clampLabelStartPosition(startPosition);
    setPrintedStartPosition(start);
    setLabelsToPrint(labels);
    setPrintJobId((current) => current + 1);
    const nextStart = nextLabelStartPosition(start, labels.length);
    changeStartPosition(nextStart);
    toast.success(`${labels.length}枚を${start}面目から印刷します。次回の開始位置を${nextStart}面目にしました`);
  };

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
      <LabelPrintStyles />
      <PrintableLabelSheet labels={labelsToPrint} startPosition={printedStartPosition} />
      <h2 className="font-semibold text-emerald-950">ラベル印刷</h2>
      <p className="mt-1 text-sm text-emerald-900">
        配送伝票のバーコードを読んだ日で数えます。引当先に関係なく、その日に届いたぶんを全部刷ります。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label htmlFor="inbound-label-date" className="text-sm font-medium">荷受日</label>
        <Input
          id="inbound-label-date"
          type="date"
          value={receivedDate}
          onChange={(event) => setReceivedDate(event.target.value)}
          className="h-9 w-40 bg-white"
        />
        <label htmlFor="inbound-label-start" className="text-sm font-medium">開始位置</label>
        <Input
          id="inbound-label-start"
          type="number"
          min={1}
          max={LABELS_PER_SHEET}
          value={startPosition}
          onChange={(event) => changeStartPosition(Number(event.target.value))}
          onFocus={(event) => event.currentTarget.select()}
          className="h-9 w-20 bg-white"
        />
        <Button
          type="button"
          variant="outline"
          className="gap-2 border-emerald-300 bg-white"
          disabled={receivedQuery.isLoading || labels.length === 0}
          onClick={print}
        >
          <Printer className="h-4 w-4" />
          {receivedQuery.isLoading ? "荷受分を確認中…" : `この日の荷受分 ${labels.length}件を印刷`}
        </Button>
        <label className="flex items-center gap-1.5 text-xs text-emerald-900">
          <input
            type="checkbox"
            checked={excludeAccessories}
            onChange={(event) => setExcludeAccessories(event.target.checked)}
            className="h-3.5 w-3.5 accent-emerald-700"
          />
          消耗品（ケーブル・バッテリー等）を除く
        </label>
      </div>
      <p className="mt-2 text-xs text-emerald-900">
        印刷ダイアログは「用紙 A4・倍率 100%・余白なし」で刷ってください。倍率が既定のままだと縮んで面がずれます。
      </p>
    </section>
  );
}

export function OutboundBoxIssuer({
  onCreated,
  operatorRole = "出荷担当",
}: {
  onCreated?: (boxes: OutboundBoxView[]) => void;
  operatorRole?: string;
}) {
  const utils = trpc.useUtils();
  const [boxCount, setBoxCount] = useState(1);
  const [printLabels, setPrintLabels] = useState<LabelView[]>([]);
  const [printJobId, setPrintJobId] = useState(0);
  // 発番は成功したのに印刷が失敗する（プリンタ未接続など）ことがある。
  // 番号は戻らないので、発番済みで中身が空の箱を刷り直せるようにしておく。
  const boxListQuery = trpc.inventory.outboundBoxes.list.useQuery(undefined, {
    staleTime: 10_000,
  });
  const unusedBoxes = useMemo(
    () =>
      ((boxListQuery.data ?? []) as OutboundBoxView[]).filter(
        box => box.status === "open" && box.items.length === 0
      ),
    [boxListQuery.data]
  );
  const createBoxes = trpc.inventory.outboundBoxes.create.useMutation({
    onSuccess: created => {
      void utils.inventory.outboundBoxes.list.invalidate();
      const createdBoxes = created as OutboundBoxView[];
      setPrintLabels(createdBoxes.map(box => outboundBoxPrintLabel(box.boxCode)));
      setPrintJobId(value => value + 1);
      onCreated?.(createdBoxes);
      toast.success(`${createdBoxes.length}箱を発番しました。印刷画面を開きます`);
    },
    onError: error => toast.error(`箱の発番に失敗しました: ${error.message}`),
  });

  useEffect(() => {
    const clear = () => setPrintLabels([]);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  useEffect(() => {
    if (printJobId === 0 || printLabels.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, [printJobId, printLabels]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <LabelPrintStyles />
      <PrintableLabelSheet labels={printLabels} />
      <Input
        type="number"
        min={1}
        max={20}
        value={boxCount}
        onChange={event => setBoxCount(Math.min(20, Math.max(1, Number(event.target.value) || 1)))}
        className="h-11 w-20"
        aria-label="作る箱数"
      />
      <Button
        type="button"
        className="min-h-11 gap-2 bg-indigo-700 text-white hover:bg-indigo-800"
        disabled={createBoxes.isPending}
        onClick={() => createBoxes.mutate({ count: boxCount, operatorName: getCurrentWorkWorkerName(operatorRole) })}
      >
        {createBoxes.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
        箱を作る・{boxCount}枚印刷
      </Button>
      <Button
        type="button"
        variant="outline"
        className="min-h-11 gap-2"
        disabled={unusedBoxes.length === 0}
        title="発番済みで中身が空の箱を刷り直します。新しい番号は増えません"
        onClick={() => {
          setPrintLabels(unusedBoxes.map(box => outboundBoxPrintLabel(box.boxCode)));
          setPrintJobId(value => value + 1);
        }}
      >
        <Printer className="h-4 w-4" />
        発番済みの空箱 {unusedBoxes.length}枚を刷り直す
      </Button>
      {/* 箱番号の羅列は毎回読む必要がないので出さない。番号ごとの刷り直しは「開いたままの箱」から行える。 */}
      {unusedBoxes.length > 0 ? (
        <span className="w-full text-xs text-muted-foreground">
          印刷が失敗しても番号は戻りません。新しく作らず、ここから刷り直してください。
        </span>
      ) : null}
    </div>
  );
}

function formatDeclarationAmount(value: number): string {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * 在庫から充てた個体の引当先インボイスを指定する。
 * 同じ箱に入っている他インボイスを候補に出しつつ、手入力も受ける
 * （別インボイス宛の在庫を回したときは候補に無い番号になる）。
 */
function AssignInvoiceControl({
  labelId,
  candidates,
  onDone,
}: {
  labelId: string;
  candidates: string[];
  onDone: () => void;
}) {
  const [manual, setManual] = useState("");
  const utils = trpc.useUtils();
  const assign = trpc.inventory.outboundBoxes.assignInvoice.useMutation({
    onSuccess: (result) => {
      toast.success(`${result.labelId} を No.${result.invoiceNo} 宛にしました`);
      setManual("");
      void utils.inventory.outboundBoxes.list.invalidate();
      onDone();
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = (invoiceNo: string) => {
    if (!invoiceNo.trim() || assign.isPending) return;
    assign.mutate({ labelId, invoiceNo: invoiceNo.trim(), operatorName: getCurrentWorkWorkerName("出荷担当") });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {candidates.map((invoiceNo) => (
        <Button
          key={invoiceNo}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 px-2"
          disabled={assign.isPending}
          onClick={() => submit(invoiceNo)}
        >
          No.{invoiceNo} 宛にする
        </Button>
      ))}
      <Input
        className="h-7 w-24 font-mono"
        placeholder="他のNo."
        value={manual}
        onChange={(event) => setManual(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") submit(manual);
        }}
      />
    </span>
  );
}

/**
 * 箱の中身一覧から、個体の引当先インボイスNoを直接直す。
 *
 * 別インボイス宛に仕入れた在庫を流用して発送することがあるため、
 * 管理番号から番号が読めている個体でも人が上書きできる必要がある。
 * 空にして確定すると指定が外れ、自動判定（出庫No→管理番号）へ戻る。
 */
function BoxItemInvoiceField({
  labelId,
  assignedInvoiceNo,
  legacyManagementNo,
}: {
  labelId: string;
  assignedInvoiceNo: string | null;
  legacyManagementNo: string | null;
}) {
  const utils = trpc.useUtils();
  const [value, setValue] = useState(assignedInvoiceNo ?? "");
  // 申告明細側や別端末で変わったときに追従する
  useEffect(() => setValue(assignedInvoiceNo ?? ""), [assignedInvoiceNo]);
  const autoInvoiceNo = invoiceNoFromManagementNo(legacyManagementNo);
  const assign = trpc.inventory.outboundBoxes.assignInvoice.useMutation({
    onSuccess: (result) => {
      if (result.changed) {
        toast.success(
          result.invoiceNo
            ? `${result.labelId} を No.${result.invoiceNo} 宛にしました`
            : `${result.labelId} の指定を外しました（管理番号からの自動判定に戻ります）`,
        );
      }
      void utils.inventory.outboundBoxes.list.invalidate();
      void utils.inventory.orderManagement.boxDeclaration.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
      setValue(assignedInvoiceNo ?? "");
    },
  });

  const commit = () => {
    const next = value.trim();
    if (assign.isPending || next === (assignedInvoiceNo ?? "")) return;
    assign.mutate({
      labelId,
      invoiceNo: next === "" ? null : next,
      operatorName: getCurrentWorkWorkerName("出荷担当"),
    });
  };

  const effectiveInvoiceNo = assignedInvoiceNo ?? autoInvoiceNo;
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <span className="text-xs text-muted-foreground">宛先No.</span>
      <Input
        className="h-8 w-20 font-mono"
        value={value}
        placeholder={autoInvoiceNo ?? "未定"}
        disabled={assign.isPending}
        aria-label={`${labelId} の引当先インボイスNo`}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
      />
      {assign.isPending ? <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" /> : null}
      {assignedInvoiceNo && assignedInvoiceNo !== autoInvoiceNo ? (
        <span
          className="rounded bg-amber-100 px-1 text-[10px] font-semibold text-amber-900"
          title={`管理番号からは No.${autoInvoiceNo ?? "不明"}。人の指定で上書きしています`}
        >
          流用
        </span>
      ) : !effectiveInvoiceNo ? (
        <span className="text-[10px] font-semibold text-destructive">未定</span>
      ) : null}
    </span>
  );
}

/**
 * FedExの送り状に手打ちする申告内容を、箱の中身から組み立てて出す。
 * 品名・数量・単価・通貨は取引データ（インボイス）の値をそのまま使う。
 */
function BoxDeclarationPanel({ boxCode }: { boxCode: string }) {
  const [copied, setCopied] = useState(false);
  const declaration = trpc.inventory.orderManagement.boxDeclaration.useQuery(
    { boxCode },
    { enabled: Boolean(boxCode), staleTime: 5_000 },
  );

  const copyText = useMemo(() => {
    const data = declaration.data;
    if (!data) return "";
    const lines: string[] = [`${data.boxCode}${data.trackingNumber ? ` / ${data.trackingNumber}` : ""}`];
    let currentInvoice: string | null | undefined;
    for (const line of data.lines) {
      if (line.invoiceNo !== currentInvoice) {
        currentInvoice = line.invoiceNo;
        lines.push("", `[No.${line.invoiceNo} ${line.partner}]`);
      }
      const unit = line.unitPrice == null ? "単価なし" : `${line.currency} ${formatDeclarationAmount(line.unitPrice)}`;
      const subtotal = line.subtotal == null ? "" : ` = ${line.currency} ${formatDeclarationAmount(line.subtotal)}`;
      const estimated = line.estimatedQuantity > 0 ? `（うち${line.estimatedQuantity}点は推定）` : "";
      lines.push(`${line.productName}\t${line.quantity}\t${unit}${subtotal}${estimated}`);
    }
    if (data.totals.length > 0) {
      lines.push("");
      for (const total of data.totals) {
        lines.push(
          `合計 ${total.quantity}点 ${total.currency} ${formatDeclarationAmount(total.amount)}${total.incomplete ? "（単価なしの行あり）" : ""}`,
        );
      }
    }
    return lines.join("\n");
  }, [declaration.data]);

  async function copyDeclaration() {
    if (!copyText) return;
    try {
      await navigator.clipboard.writeText(copyText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("コピーできませんでした。テキストを選択して手動でコピーしてください");
    }
  }

  if (declaration.isLoading) {
    return <p className="mt-3 text-sm text-muted-foreground">申告明細を計算中…</p>;
  }
  if (declaration.error) {
    return <p className="mt-3 text-sm text-destructive">申告明細を出せませんでした: {declaration.error.message}</p>;
  }
  const data = declaration.data;
  if (!data) return null;

  return (
    <section className="mt-4 rounded-md border-2 border-slate-300 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">FedEx申告明細</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            取引データの品名・単価・通貨をそのまま出しています。送り状の入力欄へ貼れます。
            「推定」は旧管理番号にインボイスNoが無く、この箱の他インボイスから引き当てたぶんです。
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={!copyText} onClick={() => void copyDeclaration()}>
          {copied ? <Check className="mr-2 h-4 w-4" /> : <ClipboardCopy className="mr-2 h-4 w-4" />}
          {copied ? "コピーしました" : "コピー"}
        </Button>
      </div>

      {data.lines.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">申告できる行がありません。</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded border bg-white">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="bg-muted/60 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2">インボイス</th>
                <th className="px-3 py-2">品名</th>
                <th className="px-3 py-2 text-right">数量</th>
                <th className="px-3 py-2 text-right">単価</th>
                <th className="px-3 py-2 text-right">小計</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.lines.map((line) => (
                <tr key={line.key}>
                  <td className="px-3 py-2 whitespace-nowrap">No.{line.invoiceNo} {line.partner}</td>
                  <td className="px-3 py-2">
                    {line.productName}
                    {line.estimatedQuantity > 0 ? (
                      <Badge variant="outline" className="ml-2 border-amber-400 text-amber-700">
                        うち{line.estimatedQuantity}点は推定
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{line.quantity}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {line.unitPrice == null ? <span className="text-destructive">単価なし</span> : `${line.currency} ${formatDeclarationAmount(line.unitPrice)}`}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {line.subtotal == null ? "—" : `${line.currency} ${formatDeclarationAmount(line.subtotal)}`}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 bg-muted/40">
              {data.totals.map((total) => (
                <tr key={total.currency}>
                  <td className="px-3 py-2 font-semibold" colSpan={2}>合計</td>
                  <td className="px-3 py-2 text-right tabular-nums">{total.quantity}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right font-bold tabular-nums">
                    {total.currency} {formatDeclarationAmount(total.amount)}
                    {total.incomplete ? <span className="ml-1 text-xs font-normal text-destructive">※単価なしの行あり</span> : null}
                  </td>
                </tr>
              ))}
            </tfoot>
          </table>
        </div>
      )}

      {data.unmatched.length > 0 ? (
        <div className="mt-3 rounded border border-amber-400 bg-amber-50 p-2 text-sm text-amber-950">
          <div className="font-semibold">引当先が決まっていない個体 {data.unmatched.length}点</div>
          <p className="mt-1 text-xs">
            この分は上の合計に入っていません。在庫から充てたものは、どのインボイス宛かを選んでください。
          </p>
          <ul className="mt-2 space-y-2 text-xs">
            {data.unmatched.map((item) => (
              <li key={item.labelId} className="flex flex-wrap items-center gap-2">
                <span className="font-mono font-bold">{item.labelId}</span>
                <span>{item.title}</span>
                <span className="text-amber-800">— {item.reason}</span>
                <AssignInvoiceControl
                  labelId={item.labelId}
                  candidates={item.invoiceCandidates}
                  onDone={() => void declaration.refetch()}
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function OutboundBoxPanel({ onOpenBoxChange }: { onOpenBoxChange?: (boxCode: string | null) => void } = {}) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.inventory.outboundBoxes.list.useQuery(undefined, {
    staleTime: 10_000,
    refetchOnMount: "always",
  });
  const boxes = (data ?? []) as OutboundBoxView[];
  const [currentBoxCode, setCurrentBoxCode] = useState("");
  // 発番済みの箱シールの刷り直し用（印刷が失敗しても番号は戻らないため）
  const [boxPrintLabels, setBoxPrintLabels] = useState<LabelView[]>([]);
  const [boxPrintJobId, setBoxPrintJobId] = useState(0);
  // 箱モードを使わずに従来経路で出庫してしまったぶんを、後から箱へ紐づける
  const [attachBoxCode, setAttachBoxCode] = useState<string | null>(null);
  const [attachDeliveryNo, setAttachDeliveryNo] = useState("");
  const attachDelivery = trpc.inventory.outboundBoxes.attachDelivery.useMutation({
    onSuccess: (result) => {
      void utils.inventory.outboundBoxes.list.invalidate();
      setAttachBoxCode(null);
      setAttachDeliveryNo("");
      toast.success(
        `${result.boxCode} に 出庫No ${result.deliveryNos.join("・")} を紐づけました（個体${result.attachedLabels}件${
          result.trackingNumber ? ` / 追跡 ${result.trackingNumber}` : " / 追跡番号は未登録"
        }）`,
      );
    },
    onError: (error) => toast.error(`紐付けに失敗しました: ${error.message}`),
  });
  const [scanValue, setScanValue] = useState("");
  const [linkBoxCode, setLinkBoxCode] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shippingDate, setShippingDate] = useState(todayShipmentDate());
  const [traceLabelId, setTraceLabelId] = useState("");
  const currentBox = boxes.find((box) => box.boxCode === currentBoxCode) ?? null;
  const sealedBoxes = boxes.filter((box) => box.status === "sealed");
  // 封をすると currentBox から外れるため、追跡番号を待っている箱の中身はここから見せる
  // （宛先No.を直せる最後の機会。紐付けの時点で発送管理シートが取引先ごとに割れる）
  const shippedBoxes = boxes.filter((box) => box.status === "shipped");
  const openBoxes = boxes.filter((box) => box.status === "open");
  const linkSelectedBox = sealedBoxes.find((box) => box.boxCode === linkBoxCode) ?? null;
  const normalizedTraceLabel = normalizeOutboundScan(traceLabelId);
  const traceQuery = trpc.inventory.outboundBoxes.traceByLabel.useQuery(
    { labelId: normalizedTraceLabel },
    { enabled: /^[ABCDEFGHJKLMNPQRSTUVWXYZ]{7}$/.test(normalizedTraceLabel) },
  );

  const refreshBoxes = () => void utils.inventory.outboundBoxes.list.invalidate();
  const mutationError = (label: string) => (error: { message: string }) => toast.error(`${label}: ${error.message}`);
  const openBox = trpc.inventory.outboundBoxes.open.useMutation({
    onSuccess: (box) => {
      refreshBoxes();
      if (box) setCurrentBoxCode(box.boxCode);
      toast.success(`${box?.boxCode ?? "箱"}を開きました`);
    },
    onError: mutationError("箱を開けませんでした"),
  });
  const addItem = trpc.inventory.outboundBoxes.addItem.useMutation({
    onSuccess: (box) => {
      refreshBoxes();
      if (box) setCurrentBoxCode(box.boxCode);
      toast.success("個体を箱に追加しました");
    },
    onError: mutationError("個体を追加できませんでした"),
  });
  const removeItem = trpc.inventory.outboundBoxes.removeItem.useMutation({
    onSuccess: refreshBoxes,
    onError: mutationError("個体を取り消せませんでした"),
  });
  const discardBox = trpc.inventory.outboundBoxes.discard.useMutation({
    onSuccess: () => {
      refreshBoxes();
      setCurrentBoxCode("");
      toast.success("未使用の箱を破棄しました");
    },
    onError: mutationError("箱を破棄できませんでした"),
  });
  const sealBox = trpc.inventory.outboundBoxes.seal.useMutation({
    onSuccess: (box) => {
      refreshBoxes();
      void utils.inventory.zaico.getInventories.invalidate();
      void utils.inventory.deliveryHistory.list.invalidate();
      setLinkBoxCode(box?.boxCode ?? "");
      setCurrentBoxCode("");
      toast.success(`${box?.boxCode ?? "箱"}を封じ、出庫登録しました`);
    },
    onError: mutationError("封箱に失敗しました"),
  });
  const linkTracking = trpc.inventory.outboundBoxes.linkTracking.useMutation({
    onSuccess: (box) => {
      refreshBoxes();
      void utils.inventory.fedex.getAll.invalidate();
      setTrackingNumber("");
      setLinkBoxCode("");
      if (box.spreadsheetSuccess) toast.success(`${box.boxCode}に追跡番号を登録し、スプレッドシートへ書き込みました`);
      else toast.warning(`${box.boxCode}への紐付けは完了しました。スプレッドシート: ${"spreadsheetError" in box ? box.spreadsheetError ?? "要確認" : "要確認"}`);
    },
    onError: mutationError("追跡番号を紐付けできませんでした"),
  });
  const unlinkTracking = trpc.inventory.outboundBoxes.unlinkTracking.useMutation({
    onSuccess: box => {
      refreshBoxes();
      void utils.inventory.fedex.getAll.invalidate();
      toast.success(`${box?.boxCode ?? "箱"} の追跡番号を解除しました。続けて「封を解く」を実行してください`);
    },
    onError: mutationError("追跡番号を解除できませんでした"),
  });
  const unsealBox = trpc.inventory.outboundBoxes.unseal.useMutation({
    onSuccess: result => {
      refreshBoxes();
      void utils.inventory.zaico.getInventories.invalidate();
      void utils.inventory.deliveryHistory.list.invalidate();
      if (result.boxCode) setCurrentBoxCode(result.boxCode);
      toast.success(`${result.boxCode} の封を解き、${result.restoredCount}点を在庫へ戻しました`);
    },
    onError: mutationError("封を解けませんでした"),
  });

  const handleScan = (rawValue: string) => {
    const normalized = normalizeOutboundScan(rawValue);
    setScanValue(normalized);
    const kind = classifyOutboundScan(normalized);
    if (kind === "box") {
      const found = boxes.find((box) => box.boxCode === normalized);
      if (found?.status === "sealed") {
        setLinkBoxCode(found.boxCode);
        toast.info(`${found.boxCode}を追跡番号待ちとして選択しました`);
      } else if (found?.status === "shipped") {
        toast.info(`${found.boxCode}は${found.trackingNumber ?? "追跡番号登録済み"}で発送済みです`);
      } else {
        openBox.mutate({ boxCode: normalized, operatorName: getCurrentWorkWorkerName("出荷担当") });
      }
    } else if (kind === "label") {
      if (!currentBoxCode) {
        toast.error("先に箱IDをスキャンしてください");
      } else {
        addItem.mutate({ boxCode: currentBoxCode, labelId: normalized });
      }
    } else if (kind === "tracking") {
      if (!linkBoxCode) toast.error("先に封済みの箱IDをスキャンしてください");
      else setTrackingNumber(normalized);
    } else {
      toast.error("箱ID・個体ラベル・追跡番号のどれにも判定できませんでした");
    }
    setScanValue("");
  };
  const qrScanner = useQrCameraScanner(handleScan);

  const busy = openBox.isPending || addItem.isPending || sealBox.isPending || linkTracking.isPending || unlinkTracking.isPending || unsealBox.isPending;

  useEffect(() => {
    if (boxPrintJobId === 0 || boxPrintLabels.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, [boxPrintJobId, boxPrintLabels]);

  useEffect(() => {
    const clear = () => setBoxPrintLabels([]);
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  // 開いている箱を親へ伝える。従来の出庫パネルを伏せるため。
  useEffect(() => {
    onOpenBoxChange?.(currentBoxCode || null);
  }, [currentBoxCode, onOpenBoxChange]);

  return (
    <section className="rounded-md border-2 border-indigo-300 bg-indigo-50/40 p-3 sm:p-4">
      <LabelPrintStyles />
      <PrintableLabelSheet labels={boxPrintLabels} />
      {attachBoxCode ? (
        <div className="mb-3 rounded-md border-2 border-indigo-400 bg-white p-3">
          <h4 className="text-sm font-semibold">{attachBoxCode} に登録済みの出庫を紐づける</h4>
          <p className="mt-1 text-xs text-muted-foreground">
            箱モードを使わずに出庫してしまったぶんを、後からこの箱に結び付けます。
            <strong>在庫は動かしません</strong>（出庫はもう済んでいるため）。
            追跡番号がFedExに登録済みならそれも取り込みます。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Input
              className="h-9 w-72 font-mono"
              placeholder="出庫No（複数可・スペースや読点で区切る）"
              value={attachDeliveryNo}
              onChange={(event) => setAttachDeliveryNo(event.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={attachDelivery.isPending || attachDeliveryNo.trim().length === 0}
              onClick={() => attachDelivery.mutate({ boxCode: attachBoxCode, deliveryNos: attachDeliveryNo.split(/[\s,、・]+/).map(v => v.trim()).filter(Boolean), operatorName: getCurrentWorkWorkerName("出荷担当") })}
            >
              {attachDelivery.isPending ? "紐付け中…" : "紐づける"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAttachBoxCode(null)}>
              やめる
            </Button>
          </div>
        </div>
      ) : null}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">海外直取：箱モード</h2>
            <Badge className="bg-indigo-700 text-white hover:bg-indigo-700">FedEx</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">箱ID→個体ラベル→封箱。後日、箱ID→FedExラベルの2スキャンで紐付けます。</p>
        </div>
        <OutboundBoxIssuer onCreated={created => {
          if (created[0]) setCurrentBoxCode(created[0].boxCode);
        }} />
      </div>

      <div className="mt-4 rounded-md border bg-white p-3">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className="gap-2" disabled={qrScanner.cameraActive} onClick={qrScanner.startCamera}><ScanLine className="h-4 w-4" />QR読取</Button>
          {qrScanner.cameraActive ? <Button type="button" variant="outline" onClick={qrScanner.stopCamera}>停止</Button> : null}
          <Badge variant="outline">選択箱: {currentBoxCode || "なし"}</Badge>
          <Badge variant="outline">追跡待ち: {linkBoxCode || "なし"}</Badge>
        </div>
        <div className={cn("mt-3 overflow-hidden rounded-md border bg-black", qrScanner.cameraActive ? "block" : "hidden")}>
          <video ref={qrScanner.videoRef} className="h-[50vh] min-h-[260px] max-h-[480px] w-full object-cover" muted playsInline />
        </div>
        {qrScanner.cameraError ? <p className="mt-2 text-sm text-destructive">{qrScanner.cameraError}</p> : null}
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input value={scanValue} onChange={(event) => setScanValue(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") handleScan(scanValue); }} placeholder="箱ID・個体ラベル・FedEx追跡番号をスキャン／入力" autoComplete="off" className="h-11 font-mono" />
          <Button type="button" disabled={!scanValue.trim() || busy} onClick={() => handleScan(scanValue)}>自動判定</Button>
        </div>
      </div>

      {currentBox ? (
        <div className="mt-4 rounded-md border border-indigo-300 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div><span className="font-mono text-xl font-bold">{currentBox.boxCode}</span><Badge variant="secondary" className="ml-2">{currentBox.items.length}点</Badge></div>
            <Button type="button" className="bg-emerald-700 text-white hover:bg-emerald-800" disabled={currentBox.items.length === 0 || sealBox.isPending} onClick={() => sealBox.mutate({ boxCode: currentBox.boxCode, deliveryDate: localDateInputValue(), operatorName: getCurrentWorkWorkerName("出荷担当") })}>
              {sealBox.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}封をする
            </Button>
          </div>
          <div className="mt-3 space-y-2">
            {currentBox.items.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                <div className="min-w-0"><span className="font-mono font-bold">{item.labelId}</span><span className="ml-2">{item.title}</span><span className="ml-2 text-xs text-muted-foreground">{item.legacyManagementNo}</span></div>
                <div className="flex items-center gap-1">
                  <BoxItemInvoiceField labelId={item.labelId} assignedInvoiceNo={item.assignedInvoiceNo} legacyManagementNo={item.legacyManagementNo} />
                  <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => removeItem.mutate({ boxCode: currentBox.boxCode, labelId: item.labelId })}>取り消す</Button>
                </div>
              </div>
            ))}
          </div>
          <BoxDeclarationPanel boxCode={currentBox.boxCode} />
        </div>
      ) : null}

      {sealedBoxes.length > 0 ? (
        <div className="mt-4 rounded-md border-2 border-amber-400 bg-amber-50 p-3">
          <h3 className="font-semibold text-amber-950">発送登録待ちの箱（{sealedBoxes.length}箱）</h3>
          <div className="mt-2 space-y-2">{sealedBoxes.map(box => (
            <div key={box.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-amber-300 bg-white p-2">
              <Button type="button" variant={linkBoxCode === box.boxCode ? "default" : "outline"} onClick={() => setLinkBoxCode(box.boxCode)}>
                <span className="font-mono">{box.boxCode}</span><Badge variant="secondary" className="ml-2">{box.items.length}点</Badge>
              </Button>
              <Button type="button" variant="outline" disabled={unsealBox.isPending} onClick={() => {
                const ids = box.items.map(item => item.labelId).join(", ");
                if (window.confirm(`${box.boxCode} の封を解きます。\n戻る在庫: ${box.items.length}点\n対象個体ID: ${ids}\n出庫履歴は削除せず取消として残します。`)) {
                  unsealBox.mutate({ boxCode: box.boxCode, operatorName: getCurrentWorkWorkerName("出荷担当") });
                }
              }}><RotateCcw className="mr-2 h-4 w-4" />封を解く</Button>
            </div>
          ))}</div>
          <div className="mt-3 grid gap-2 lg:grid-cols-[150px_minmax(0,1fr)_110px_auto]">
            <Input value={linkBoxCode} onChange={(event) => setLinkBoxCode(normalizeOutboundScan(event.target.value))} placeholder="B000001" className="font-mono" />
            <Input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="FedEx追跡番号（手入力可）" className="font-mono" />
            <Input value={shippingDate} onChange={(event) => setShippingDate(event.target.value)} placeholder="M/D" />
            <Button type="button" className="bg-blue-700 text-white hover:bg-blue-800" disabled={!linkBoxCode || !trackingNumber.trim() || linkTracking.isPending} onClick={() => linkTracking.mutate({ boxCode: linkBoxCode, trackingNumber, shippingDate, operatorName: getCurrentWorkWorkerName("出荷担当") })}>{linkTracking.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}追跡番号を紐付け</Button>
          </div>
          <p className="mt-2 text-xs text-amber-900">送信先シートはインボイスNoの取引先から自動決定します。不明な取引先は登録を止めます。</p>
          {linkSelectedBox ? (
            <>
              <div className="mt-3 rounded border border-amber-300 bg-white p-2">
                <div className="text-sm font-semibold">{linkSelectedBox.boxCode} の中身（{linkSelectedBox.items.length}点）</div>
                <p className="mt-1 text-xs text-muted-foreground">
                  別インボイス宛の在庫を流用した個体は、紐付ける前に宛先No.を直してください。
                </p>
                <div className="mt-2 space-y-1">
                  {linkSelectedBox.items.map((item) => (
                    <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-2 text-sm">
                      <div className="min-w-0"><span className="font-mono font-bold">{item.labelId}</span><span className="ml-2">{item.title}</span><span className="ml-2 text-xs text-muted-foreground">{item.legacyManagementNo}</span></div>
                      <BoxItemInvoiceField labelId={item.labelId} assignedInvoiceNo={item.assignedInvoiceNo} legacyManagementNo={item.legacyManagementNo} />
                    </div>
                  ))}
                </div>
              </div>
              <BoxDeclarationPanel boxCode={linkSelectedBox.boxCode} />
            </>
          ) : null}
        </div>
      ) : null}

      {shippedBoxes.length > 0 ? (
        <div className="mt-4 rounded-md border border-sky-300 bg-sky-50 p-3">
          <h3 className="font-semibold text-sky-950">追跡番号紐付け済みの箱</h3>
          <div className="mt-2 space-y-2">{shippedBoxes.map(box => (
            <div key={box.id} className="flex flex-wrap items-center justify-between gap-2 rounded border bg-white p-2">
              <div><span className="font-mono font-bold">{box.boxCode}</span><span className="ml-2 font-mono text-sm">{box.trackingNumber}</span><Badge variant="secondary" className="ml-2">{box.items.length}点</Badge></div>
              <Button type="button" variant="outline" disabled={unlinkTracking.isPending} onClick={() => {
                if (window.confirm(`${box.boxCode} の追跡番号を解除します。\nGoogleスプレッドシートの該当行も消えます。\nこの操作後、別途「封を解く」の確認が必要です。`)) {
                  unlinkTracking.mutate({ boxCode: box.boxCode, operatorName: getCurrentWorkWorkerName("出荷担当") });
                }
              }}><RotateCcw className="mr-2 h-4 w-4" />追跡番号を解除</Button>
            </div>
          ))}</div>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border bg-white p-3">
          <h3 className="font-semibold">開いたままの箱</h3>
          {isLoading ? <p className="mt-2 text-sm text-muted-foreground">読み込み中…</p> : openBoxes.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">ありません</p> : <div className="mt-2 space-y-2">{openBoxes.map((box) => <div key={box.id} className="flex items-center justify-between gap-2 rounded border p-2"><Button type="button" variant="ghost" className="font-mono" onClick={() => setCurrentBoxCode(box.boxCode)}>{box.boxCode}（{box.items.length}点）</Button><div className="flex items-center gap-1"><Button type="button" size="sm" variant="outline" title="この箱のシールを刷り直します。新しい番号は増えません" onClick={() => { setBoxPrintLabels([outboundBoxPrintLabel(box.boxCode)]); setBoxPrintJobId((value) => value + 1); }}><Printer className="mr-1 h-4 w-4" />刷り直す</Button>{box.items.length === 0 ? <Button type="button" size="sm" variant="outline" title="箱を使わずに登録済みの出庫を、この箱へ後から紐づけます" onClick={() => { setAttachBoxCode(box.boxCode); setAttachDeliveryNo(""); }}>出庫を紐づけ</Button> : null}{box.items.length === 0 ? <Button type="button" size="sm" variant="outline" className="text-destructive" onClick={() => { if (window.confirm(`${box.boxCode}を破棄しますか？`)) discardBox.mutate({ boxCode: box.boxCode }); }}><Trash2 className="mr-1 h-4 w-4" />破棄</Button> : null}</div></div>)}</div>}
        </div>
        <div className="rounded-md border bg-white p-3">
          <h3 className="font-semibold">個体IDから発送を追跡</h3>
          <Input className="mt-2 font-mono" value={traceLabelId} onChange={(event) => setTraceLabelId(event.target.value)} placeholder="英字7文字の個体ID" />
          {traceQuery.data?.label ? <div className="mt-2 rounded border p-2 text-sm"><div><span className="font-mono font-bold">{traceQuery.data.label.labelId}</span> / {traceQuery.data.label.title}</div><div className="mt-1">箱: <span className="font-mono font-semibold">{traceQuery.data.box?.boxCode ?? "未割当"}</span> → 追跡番号: <span className="font-mono font-semibold">{traceQuery.data.box?.trackingNumber ?? "未登録"}</span></div></div> : normalizedTraceLabel.length === 7 && !traceQuery.isFetching ? <p className="mt-2 text-sm text-muted-foreground">個体が見つかりません</p> : null}
        </div>
      </div>
    </section>
  );
}

function ShippingPanel({
  group,
  invoiceOptions,
  labels,
  allLabels,
  products,
  onDeliverySuccess,
}: {
  group: AllocationGroup | null;
  invoiceOptions: AllocationGroup[];
  labels: LabelView[];
  allLabels: LabelView[];
  products: ProductSummary[];
  onDeliverySuccess: (labelIds: string[]) => void;
}) {
  const utils = trpc.useUtils();
  const createDeliveryMutation = trpc.inventory.zaico.createDelivery.useMutation();
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [confirmKeys, setConfirmKeys] = useState<Set<string>>(new Set());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [deliveryNo, setDeliveryNo] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [showConfirm, setShowConfirm] = useState(false);
  const [fedexDialog, setFedexDialog] = useState<{ deliveryNo: string; historyId: number; items: HistoryItem[] } | null>(null);
  const [expandedHistoryNos, setExpandedHistoryNos] = useState<Set<string>>(new Set());
  // 箱モードで箱を開いている間は、こちらの従来出庫を伏せて取り違えを防ぐ
  const [openBoxCode, setOpenBoxCode] = useState<string | null>(null);
  const [forceLegacyShipping, setForceLegacyShipping] = useState(false);
  useEffect(() => {
    if (!openBoxCode) setForceLegacyShipping(false);
  }, [openBoxCode]);
  const [deleteHistoryConfirm, setDeleteHistoryConfirm] = useState<{
    historyId: number;
    deliveryNo: string;
    inventoryIds: number[];
    titles: string[];
  } | null>(null);
  const invoiceNo = invoiceNoFromGroupKey(group?.key);
  const [selectedDeliveryInvoiceKey, setSelectedDeliveryInvoiceKey] = useState("");
  const [manualLabelValue, setManualLabelValue] = useState("");
  const [manualShippingLabels, setManualShippingLabels] = useState<LabelView[]>([]);
  const [manualLookupPending, setManualLookupPending] = useState(false);
  const shippingQrScanner = useQrCameraScanner((rawValue) => {
    setManualLabelValue(rawValue);
    void addLabelForShipping(rawValue, { openConfirmAfterAdd: true });
  });
  const manualLabelId = normalizeProductLabelInput(manualLabelValue);
  const availableLabels = useMemo(() => mergeLabelViewsById(labels, manualShippingLabels), [labels, manualShippingLabels]);
  const searchableLabels = useMemo(() => mergeLabelViewsById(availableLabels, allLabels), [allLabels, availableLabels]);
  const manualMatchedLabel = useMemo(
    () => (manualLabelId ? searchableLabels.find((label) => label.labelId.trim().toUpperCase() === manualLabelId) ?? null : null),
    [manualLabelId, searchableLabels],
  );
  const shippingItems = useMemo(() => buildShippingItemsFromLabels(availableLabels), [availableLabels]);
  const shippableItems = useMemo(() => shippingItems.filter((item) => item.canShip), [shippingItems]);
  const pendingInventoryLabels = availableLabels.filter((label) => label.labelId.trim() && !label.inventoryId && isShippableLabel(label));
  const confirmItems = useMemo(
    () => selectedShippingItems(shippingItems, confirmKeys, quantities),
    [confirmKeys, quantities, shippingItems],
  );
  const checkedItems = useMemo(
    () => selectedShippingItems(shippingItems, selectedKeys, quantities),
    [quantities, selectedKeys, shippingItems],
  );
  function resolveDeliveryInvoiceNo(items: ShippingItemView[], overrideKey = selectedDeliveryInvoiceKey): string | null {
    const selectedNo = invoiceNoFromGroupKey(overrideKey);
    return selectedNo ?? invoiceNo ?? commonInvoiceNoFromShippingItems(items);
  }

  function resolveDeliveryGroup(items: ShippingItemView[], overrideKey = selectedDeliveryInvoiceKey): AllocationGroup | null {
    const selectedGroup = invoiceOptions.find((option) => option.key === overrideKey) ?? null;
    if (selectedGroup) return selectedGroup;
    if (invoiceNo) return group;
    const inferredInvoiceNo = commonInvoiceNoFromShippingItems(items);
    if (inferredInvoiceNo) {
      return invoiceOptions.find((option) => invoiceNoFromGroupKey(option.key) === inferredInvoiceNo) ?? group;
    }
    return group;
  }

  function resolveAutoDeliveryNo(items: ShippingItemView[], overrideKey = selectedDeliveryInvoiceKey): string {
    const nextInvoiceNo = resolveDeliveryInvoiceNo(items, overrideKey);
    const nextGroup = resolveDeliveryGroup(items, overrideKey);
    return generatePurchaseRegistrationDeliveryNo(nextGroup, nextInvoiceNo);
  }

  const autoDeliveryNo = useMemo(
    () => resolveAutoDeliveryNo(checkedItems),
    [checkedItems, group, invoiceNo, invoiceOptions, selectedDeliveryInvoiceKey],
  );
  const autoSheetName = useMemo(() => detectShipmentSheetNameForGroup(group, shippingItems), [group, shippingItems]);
  const [shipmentSheetName, setShipmentSheetName] = useState<ShipmentSheetName>(autoSheetName);
  const [invoiceFedexTrackingNumber, setInvoiceFedexTrackingNumber] = useState("");
  const [invoiceFedexSheetName, setInvoiceFedexSheetName] = useState<ShipmentSheetName>(autoSheetName);
  const hasTrackingNumber = trackingNumber.trim().length > 0;
  /**
   * FedEx追跡番号を聞くのは海外直取だけ。
   * eBay・ヤフオク・在庫の出庫（ebay_1709 / stock_... など）では要らないので出さない。
   */
  const isOverseasDelivery = Boolean(
    invoiceNoFromDeliveryNo(deliveryNo.trim() || autoDeliveryNo),
  );
  const allSelected = shippableItems.length > 0 && shippableItems.every((item) => selectedKeys.has(item.key));
  const isSubmitting = createDeliveryMutation.isPending;

  const { data: histories, isLoading: historiesLoading, refetch: refetchHistories } =
    trpc.inventory.deliveryHistory.listByInvoicePrefix.useQuery(
      { invoiceNo: invoiceNo ?? "0" },
      { enabled: Boolean(invoiceNo), staleTime: 30_000 },
    );
  const { data: fedexShipmentsData, refetch: refetchFedex } = trpc.inventory.fedex.getAll.useQuery(undefined, {
    staleTime: 30_000,
  });
  const createFedexMutation = trpc.inventory.fedex.create.useMutation({
    onSuccess: (data) => {
      void refetchFedex();
      if (data.success) {
        toast.success(data.message ?? "FedEx発送情報を登録しました");
      } else {
        toast.warning(data.message ?? "FedEx発送情報をDBに保存しました。スプレッドシート反映は確認してください");
      }
      setFedexDialog(null);
    },
    onError: (error) => {
      toast.error(`FedEx発送登録に失敗しました: ${error.message}`);
    },
  });
  const createFedexBatchMutation = trpc.inventory.fedex.createBatch.useMutation({
    onSuccess: (data) => {
      void refetchFedex();
      void refetchHistories();
      void utils.inventory.fedex.getAll.invalidate();
      void utils.inventory.deliveryHistory.list.invalidate();
      void utils.inventory.deliveryHistory.listByInvoicePrefix.invalidate();
      if (data.success) {
        toast.success(data.message ?? "FedEx発送登録をまとめて登録しました");
        setInvoiceFedexTrackingNumber("");
      } else {
        toast.warning(data.message ?? "FedEx発送登録の一部に失敗しました");
      }
    },
    onError: (error) => {
      toast.error(`FedEx一括登録に失敗しました: ${error.message}`);
    },
  });
  const deleteHistoryMutation = trpc.inventory.deliveryHistory.deleteGroup.useMutation({
    onSuccess: (data) => {
      void refetchHistories();
      void refetchFedex();
      void utils.inventory.deliveryHistory.list.invalidate();
      void utils.inventory.deliveryHistory.listByInvoicePrefix.invalidate();
      void utils.inventory.zaico.getInventories.invalidate();
      void utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate();
      void utils.inventory.zaico.getPurchasesWithCategory.invalidate();
      void utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate();
      if (data.failCount > 0) {
        toast.warning(`出庫履歴を削除しました（在庫削除: ${data.successCount}件成功, ${data.failCount}件失敗）`);
      } else {
        toast.success("出庫履歴とサイト内在庫を削除しました");
      }
      setDeleteHistoryConfirm(null);
    },
    onError: (error) => {
      toast.error(`出庫履歴の削除に失敗しました: ${error.message}`);
    },
  });

  const fedexShipmentsMap = useMemo(() => {
    const map = new Map<string, Array<{ id: number; sheetName: string; shippingDate: string; trackingNumber: string; spreadsheetStatus: string }>>();
    for (const shipment of (fedexShipmentsData ?? []) as Array<{
      id: number;
      deliveryNo: string;
      sheetName: string;
      shippingDate: string;
      trackingNumber: string;
      spreadsheetStatus: string;
    }>) {
      const current = map.get(shipment.deliveryNo) ?? [];
      current.push({
        id: shipment.id,
        sheetName: shipment.sheetName,
        shippingDate: shipment.shippingDate,
        trackingNumber: shipment.trackingNumber,
        spreadsheetStatus: shipment.spreadsheetStatus,
      });
      map.set(shipment.deliveryNo, current);
    }
    return map;
  }, [fedexShipmentsData]);

  const historyGroups = useMemo(() => {
    const grouped = new Map<string, { historyId: number; deliveryNo: string; createdAt: Date; items: HistoryItem[] }>();
    for (const history of (histories ?? []) as Array<{ id: number; deliveryNo: string; createdAt: string | Date; items: HistoryItem[] }>) {
      const existing = grouped.get(history.deliveryNo);
      const nextItems = history.items ?? [];
      if (existing) {
        existing.items.push(...nextItems);
        existing.createdAt = new Date(Math.max(existing.createdAt.getTime(), new Date(history.createdAt).getTime()));
      } else {
        grouped.set(history.deliveryNo, {
          historyId: history.id,
          deliveryNo: history.deliveryNo,
          createdAt: new Date(history.createdAt),
          items: [...nextItems],
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }, [histories]);

  useEffect(() => {
    setDeliveryNo(autoDeliveryNo);
  }, [autoDeliveryNo]);

  useEffect(() => {
    setSelectedDeliveryInvoiceKey(invoiceNo ? `invoice-${invoiceNo}` : "");
  }, [invoiceNo]);

  useEffect(() => {
    setShipmentSheetName(autoSheetName);
    setInvoiceFedexSheetName(autoSheetName);
  }, [autoSheetName]);

  useEffect(() => {
    setManualLabelValue("");
    setManualShippingLabels([]);
    setInvoiceFedexTrackingNumber("");
  }, [group?.key]);

  useEffect(() => {
    setSelectedKeys((current) => {
      const validKeys = new Set(shippableItems.map((item) => item.key));
      const next = new Set(Array.from(current).filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
    setConfirmKeys((current) => {
      const validKeys = new Set(shippableItems.map((item) => item.key));
      const next = new Set(Array.from(current).filter((key) => validKeys.has(key)));
      return next.size === current.size ? current : next;
    });
  }, [shippableItems]);

  function toggleSelected(key: string) {
    if (!shippableItems.some((item) => item.key === key)) return;
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleAllSelected() {
    setSelectedKeys(allSelected ? new Set() : new Set(shippableItems.map((item) => item.key)));
  }

  function setItemQuantity(item: ShippingItemView, quantity: number) {
    const nextQuantity = Math.min(item.maxQuantity, Math.max(1, Math.floor(quantity)));
    setQuantities((current) => ({ ...current, [item.key]: nextQuantity }));
  }

  async function lookupShippingLabel(targetLabelId: string): Promise<LabelView | null> {
    const localLabel = searchableLabels.find((label) => label.labelId.trim().toUpperCase() === targetLabelId) ?? null;
    if (localLabel && isShippableLabel(localLabel) && localLabel.inventoryId) return localLabel;
    if (targetLabelId.length < 4) return localLabel;
    const result = await utils.inventory.zaico.getPurchasesWithCategoryPage.fetch({
      page: 1,
      pageSize: 100,
      category: null,
      status: null,
      search: targetLabelId,
      inboundClass: null,
    });
    const fetchedLabel = buildLabelViews((result?.items ?? []) as PurchaseRow[])
      .find((label) => label.labelId.trim().toUpperCase() === targetLabelId) ?? null;
    return fetchedLabel ?? localLabel;
  }

  async function addLabelForShipping(rawValue: string, options?: { openConfirmAfterAdd?: boolean }) {
    const targetLabelId = normalizeProductLabelInput(rawValue);
    if (!targetLabelId) {
      toast.error("商品IDを入力してください");
      return false;
    }
    if (manualLookupPending) return false;
    setManualLookupPending(true);
    let targetLabel: LabelView | null = null;
    try {
      targetLabel = await lookupShippingLabel(targetLabelId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "商品IDの確認に失敗しました");
      setManualLookupPending(false);
      return false;
    }
    setManualLookupPending(false);
    if (!targetLabel) {
      toast.error(`商品ID ${targetLabelId} が見つかりません`);
      return false;
    }
    if (!isShippableLabel(targetLabel)) {
      toast.error(`${targetLabelId} は未入庫のため出庫できません`);
      return false;
    }
    const [item] = buildShippingItemsFromLabels([targetLabel]);
    if (!item) {
      toast.error(`${targetLabelId} は在庫IDの反映待ちです。更新後に出庫してください`);
      return false;
    }
    setManualShippingLabels((current) => mergeLabelViewsById(current, [targetLabel]));
    setSelectedKeys((current) => {
      const next = new Set(current);
      next.add(item.key);
      return next;
    });
    setManualLabelValue("");
    if (options?.openConfirmAfterAdd) {
      setConfirmKeys(new Set([item.key]));
      setDeliveryNo(resolveAutoDeliveryNo([item]));
      setShowConfirm(true);
    }
    toast.success(`${targetLabelId} を出庫対象に追加しました`);
    return true;
  }

  function addManualLabelForShipping() {
    void addLabelForShipping(manualLabelValue);
  }

  function openConfirm(keys: Set<string>) {
    const targets = selectedShippingItems(shippingItems, keys, quantities);
    if (targets.length === 0) {
      toast.error("出庫する商品を選択してください");
      return;
    }
    setConfirmKeys(new Set(keys));
    setDeliveryNo(resolveAutoDeliveryNo(targets));
    setShowConfirm(true);
  }

  async function submitDelivery() {
    if (confirmItems.length === 0 || isSubmitting) return;
    const nextDeliveryNo = deliveryNo.trim() || autoDeliveryNo;
    const nextInvoiceNo = invoiceNoFromDeliveryNo(nextDeliveryNo) ?? resolveDeliveryInvoiceNo(confirmItems) ?? undefined;
    const nextTrackingNumber = trackingNumber.trim();
    try {
      const result = await createDeliveryMutation.mutateAsync({
        deliveryNo: nextDeliveryNo,
        deliveryDate: new Date().toISOString().slice(0, 10),
        operatorName: getCurrentWorkWorkerName("野田"),
        invoiceNo: nextInvoiceNo,
        sheetName: nextTrackingNumber ? shipmentSheetName : undefined,
        trackingNumber: nextTrackingNumber || undefined,
        items: confirmItems.map((item) => ({
          inventoryId: item.inventoryId,
          title: item.title,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          labelId: item.labelId ?? undefined,
        })),
      });
      toast.success(`${nextDeliveryNo} の出庫登録が完了しました`);
      if (nextTrackingNumber && result.fedexResult) {
        if (result.fedexResult.success) {
          toast.success(result.fedexResult.message);
        } else {
          toast.warning(result.fedexResult.message);
        }
      }
      const shippedLabelIds = confirmItems.flatMap((item) => (item.labelId ? [item.labelId] : []));
      onDeliverySuccess(shippedLabelIds);
      setSelectedKeys((current) => {
        const next = new Set(current);
        for (const item of confirmItems) next.delete(item.key);
        return next;
      });
      setConfirmKeys(new Set());
      setTrackingNumber("");
      setShowConfirm(false);
      void Promise.all([
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
        utils.inventory.deliveryHistory.list.invalidate(),
        utils.inventory.deliveryHistory.listByInvoicePrefix.invalidate(),
        utils.inventory.fedex.getAll.invalidate(),
      ]);
      void refetchHistories();
      void refetchFedex();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "出庫登録に失敗しました");
    }
  }

  function submitInvoiceFedexBatch() {
    const tracking = invoiceFedexTrackingNumber.trim();
    if (!tracking) {
      toast.error("FedEx追跡番号を入力してください");
      return;
    }
    const shipments = historyGroups
      .map((history) => ({
        deliveryNo: history.deliveryNo,
        sheetName: invoiceFedexSheetName,
        trackingNumber: tracking,
        historyId: history.historyId,
        items: historyItemsToFedexItems(history.items),
      }))
      .filter((shipment) => shipment.items.length > 0);
    if (shipments.length === 0) {
      toast.error("FedEx登録できる出庫履歴がありません");
      return;
    }
    createFedexBatchMutation.mutate({
      shippingDate: todayShipmentDate(),
      shipments,
      operatorName: getCurrentWorkWorkerName("驥守伐"),
    });
  }

  return (
    <div className="space-y-4">
      <OutboundBoxPanel onOpenBoxChange={setOpenBoxCode} />
      {openBoxCode ? (
        <section className="rounded-md border-2 border-amber-400 bg-amber-50 p-3 sm:p-4">
          <p className="text-sm font-semibold text-amber-900">
            箱モードで {openBoxCode} を開いています。個体IDは上の共通スキャン欄で読んでください。
          </p>
          <p className="mt-1 text-xs text-amber-900">
            下の「出庫」で登録すると、箱に紐づかないまま出庫が確定します（2026-08-16に実際に起きました）。
            箱を閉じるか「封をする」まで、こちらは使えません。
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2 bg-white"
            onClick={() => setForceLegacyShipping(true)}
          >
            それでも箱を使わずに出庫する
          </Button>
        </section>
      ) : null}
      <section
        className={cn(
          "rounded-md border bg-background p-3 sm:p-4",
          openBoxCode && !forceLegacyShipping && "pointer-events-none opacity-40"
        )}
        aria-hidden={openBoxCode && !forceLegacyShipping ? true : undefined}
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">出庫（箱を使わない）</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              選択中のインボイス/在庫から、商品IDラベル単位で出庫できます。海外直取で箱IDを使うときは上のパネルで行ってください。
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 sm:w-auto"
              onClick={shippingQrScanner.startCamera}
              disabled={shippingQrScanner.cameraActive}
            >
              <ScanLine className="h-4 w-4" />
              QR読取
            </Button>
            {shippingQrScanner.cameraActive ? (
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={shippingQrScanner.stopCamera}>
                停止
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={toggleAllSelected} disabled={shippableItems.length === 0}>
              {allSelected ? "全解除" : "全選択"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2 sm:w-auto"
              onClick={() => openConfirm(new Set(shippableItems.map((item) => item.key)))}
              disabled={shippableItems.length === 0}
            >
              <PackageMinus className="h-4 w-4" />
              すべて出庫
            </Button>
            <Button
              type="button"
              className="w-full gap-2 bg-orange-600 text-white hover:bg-orange-700 sm:w-auto"
              onClick={() => openConfirm(selectedKeys)}
              disabled={checkedItems.length === 0}
            >
              <Truck className="h-4 w-4" />
              選択を出庫
              {checkedItems.length > 0 ? <Badge className="ml-1 bg-white/20 text-white">{checkedItems.length}</Badge> : null}
            </Button>
          </div>
        </div>

        <div className="mt-3 rounded-md border bg-slate-50 p-3">
          <div className={cn("mb-3 overflow-hidden rounded-md border bg-black", shippingQrScanner.cameraActive ? "block" : "hidden")}>
            <video
              ref={shippingQrScanner.videoRef}
              className="h-[58vh] min-h-[260px] max-h-[520px] w-full object-cover md:h-80 md:min-h-0"
              muted
              playsInline
            />
          </div>
          {shippingQrScanner.cameraError ? <p className="mb-3 text-sm text-destructive">{shippingQrScanner.cameraError}</p> : null}
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
            <Input
              value={manualLabelValue}
              onChange={(event) => setManualLabelValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addManualLabelForShipping();
              }}
              placeholder="商品IDを入力して出庫対象に追加"
              autoComplete="off"
              className="h-11 font-mono text-base sm:h-9 sm:text-sm"
            />
            <Button
              type="button"
              className="h-11 w-full gap-2 bg-orange-600 text-white hover:bg-orange-700 sm:h-9 sm:w-auto"
              onClick={addManualLabelForShipping}
              disabled={!manualLabelId || manualLookupPending}
            >
              {manualLookupPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Truck className="h-4 w-4" />}
              追加
            </Button>
          </div>
          {manualLabelId && manualMatchedLabel && !isShippableLabel(manualMatchedLabel) ? (
            <p className="mt-2 text-sm text-amber-700">この商品IDはまだ入庫されていないため、出庫できません。</p>
          ) : null}
        </div>

        {pendingInventoryLabels.length > 0 ? (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            {pendingInventoryLabels.length}件のラベルは在庫IDの反映待ちです。更新後に出庫できます。
          </div>
        ) : null}

        {shippingItems.length === 0 ? (
          <div className="mt-4">
            <EmptyState icon={Truck} title="出庫できるラベルがありません" description="入庫済みの商品IDラベル、または在庫一覧を選択してください。" />
          </div>
        ) : (
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {shippingItems.map((item) => {
              const checked = selectedKeys.has(item.key);
              const quantity = quantities[item.key] ?? item.quantity;
              return (
                <div
                  key={item.key}
                  className={cn(
                    "rounded-md border bg-card p-3 shadow-sm transition-colors",
                    checked && "border-orange-300 bg-orange-50",
                    !item.canShip && "bg-slate-50 opacity-80",
                  )}
                >
                  <div className="flex gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSelected(item.key)}
                      disabled={!item.canShip}
                      className="mt-1 h-4 w-4 shrink-0 accent-orange-600"
                      aria-label={`${item.labelId ?? item.title} を出庫選択`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-lg font-bold tracking-wide text-slate-950 sm:text-xl">{item.labelId}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-950">{item.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {item.legacyManagementNo}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        {item.allocationLabel ? <Badge variant="secondary" className="font-mono">{item.allocationLabel}</Badge> : null}
                        <Badge className={labelBadgeClass(item.rawStatus)}>{item.status}</Badge>
                        <Badge variant="outline">{formatCurrency(item.unitPrice)}</Badge>
                      </div>
                    </div>
                    {item.labelId ? (
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border bg-white p-1.5 sm:h-20 sm:w-20">
                        <ProductQrCode value={item.labelId} />
                      </div>
                    ) : null}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="h-7 w-7 rounded border text-orange-600 disabled:opacity-40"
                        onClick={() => setItemQuantity(item, quantity - 1)}
                        disabled={quantity <= 1}
                      >
                        -
                      </button>
                      <Input
                        type="number"
                        min={1}
                        max={item.maxQuantity}
                        value={quantity}
                        onChange={(event) => setItemQuantity(item, Number(event.target.value))}
                        className="h-7 w-14 px-1 text-center"
                      />
                      <button
                        type="button"
                        className="h-7 w-7 rounded border text-orange-600 disabled:opacity-40"
                        onClick={() => setItemQuantity(item, quantity + 1)}
                        disabled={quantity >= item.maxQuantity}
                      >
                        +
                      </button>
                    </div>
                    <Button type="button" size="sm" variant="outline" className="w-full sm:w-auto" onClick={() => openConfirm(new Set([item.key]))} disabled={!item.canShip}>
                      この商品を出庫
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section id="purchase-shipping-history" className="rounded-md border bg-background p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">出庫履歴 / FedEx発送登録</h3>
            <p className="mt-1 text-sm text-muted-foreground">このインボイスの出庫履歴からFedEx登録できます。</p>
          </div>
          {invoiceNo ? <Badge variant="outline">No.{invoiceNo}</Badge> : <Badge variant="secondary">在庫</Badge>}
        </div>
        {!invoiceNo ? (
          <p className="mt-3 text-sm text-muted-foreground">在庫一覧はインボイス番号がないため、履歴からのFedEx登録は対象外です。</p>
        ) : historiesLoading ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            出庫履歴を読み込み中
          </div>
        ) : historyGroups.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">まだ出庫履歴がありません。</p>
        ) : (
          <>
            <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 p-3">
              <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_180px_auto]">
                <Input
                  value={invoiceFedexTrackingNumber}
                  onChange={(event) => setInvoiceFedexTrackingNumber(event.target.value)}
                  placeholder="FedEx追跡番号を入力..."
                  autoComplete="off"
                />
                <select
                  className={fieldClass}
                  value={invoiceFedexSheetName}
                  onChange={(event) => setInvoiceFedexSheetName(event.target.value as ShipmentSheetName)}
                >
                  {SHIPMENT_SHEET_NAMES.map((sheetName) => (
                    <option key={sheetName} value={sheetName}>{sheetName}</option>
                  ))}
                </select>
                <Button
                  type="button"
                  className="w-full gap-2 bg-blue-600 text-white hover:bg-blue-700 lg:w-auto"
                  onClick={submitInvoiceFedexBatch}
                  disabled={createFedexBatchMutation.isPending || !invoiceFedexTrackingNumber.trim()}
                >
                  {createFedexBatchMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  インボイスまとめてFedEx登録
                </Button>
              </div>
              <p className="mt-2 text-xs text-blue-800">
                このインボイスの出庫履歴 {historyGroups.length.toLocaleString()} 件をまとめてFedEx発送登録します。
              </p>
            </div>
            <div className="mt-3 divide-y rounded-md border">
            {historyGroups.map((history) => {
              const existingShipments = fedexShipmentsMap.get(history.deliveryNo) ?? [];
              const itemCount = history.items.reduce((total, item) => total + item.quantity, 0);
              const isHistoryExpanded = expandedHistoryNos.has(history.deliveryNo);
              return (
                <Collapsible
                  key={history.deliveryNo}
                  open={isHistoryExpanded}
                  onOpenChange={(open) => {
                    setExpandedHistoryNos((prev) => {
                      const next = new Set(prev);
                      if (open) next.add(history.deliveryNo);
                      else next.delete(history.deliveryNo);
                      return next;
                    });
                  }}
                  className="p-3"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                    <CollapsibleTrigger asChild>
                      <button type="button" className="min-w-0 flex-1 text-left">
                        <div className="flex flex-wrap items-center gap-2">
                          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isHistoryExpanded ? "rotate-0" : "-rotate-90")} />
                          <span className="font-mono text-sm font-semibold">{history.deliveryNo}</span>
                          <Badge variant="outline">{itemCount}点</Badge>
                          {existingShipments.length > 0 ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100">FedEx登録済み</Badge> : null}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {isHistoryExpanded ? "詳細を閉じる" : "詳細を表示"}
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <div className="flex flex-wrap gap-2 md:justify-end">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-50"
                        onClick={() => setFedexDialog({ deliveryNo: history.deliveryNo, historyId: history.historyId, items: history.items })}
                      >
                        <Send className="h-3.5 w-3.5" />
                        FedEx登録
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="gap-2 border-rose-200 text-rose-700 hover:bg-rose-50"
                        onClick={() => setDeleteHistoryConfirm({
                          historyId: history.historyId,
                          deliveryNo: history.deliveryNo,
                          inventoryIds: Array.from(new Set(history.items.map((item) => item.inventoryId).filter((id) => Number.isFinite(id)))),
                          titles: history.items.map((item) => item.title).filter(Boolean),
                        })}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        削除
                      </Button>
                    </div>
                  </div>
                  <CollapsibleContent>
                    <div className="mt-3 overflow-hidden rounded-md border bg-muted/20">
                      {history.items.map((item, index) => (
                        <div
                          key={`${history.deliveryNo}-${item.inventoryId}-${index}`}
                          className="grid gap-1 border-b px-3 py-2 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_80px_minmax(160px,220px)] md:items-center"
                        >
                          <div className="min-w-0 font-medium text-foreground">{item.title}</div>
                          <div className="text-xs text-muted-foreground md:text-right">{item.quantity}点</div>
                          <div className="font-mono text-xs text-muted-foreground md:text-right">
                            {item.managementNo ? `管理番号: ${item.managementNo}` : "管理番号: -"}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              );
              })}
            </div>
          </>
        )}
      </section>
      <ProductFulfillmentTableV2 products={products} />

      <Dialog open={showConfirm} onOpenChange={(open) => !isSubmitting && setShowConfirm(open)}>
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageMinus className="h-5 w-5 text-orange-600" />
              出庫確認
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className={cn("grid gap-3", hasTrackingNumber ? "md:grid-cols-[1fr_1fr_1fr_180px]" : "md:grid-cols-3")}>
              <label className="space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">インボイスNo / 取引先</span>
                <select
                  className={fieldClass}
                  value={selectedDeliveryInvoiceKey || "__auto__"}
                  onChange={(event) => {
                    const nextKey = event.target.value === "__auto__" ? "" : event.target.value;
                    setSelectedDeliveryInvoiceKey(nextKey);
                    const targets = confirmItems.length > 0 ? confirmItems : checkedItems;
                    setDeliveryNo(resolveAutoDeliveryNo(targets, nextKey));
                  }}
                >
                  <option value="__auto__">自動判定</option>
                  {invoiceOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs text-muted-foreground">出庫No</span>
                <Input value={deliveryNo} onChange={(event) => setDeliveryNo(event.target.value)} placeholder={autoDeliveryNo} />
              </label>
              {isOverseasDelivery ? (
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">FedEx追跡番号（任意）</span>
                  <Input value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} placeholder="追跡番号を入力..." />
                </label>
              ) : null}
              {hasTrackingNumber ? (
                <label className="space-y-1 text-sm">
                  <span className="text-xs text-muted-foreground">発送管理</span>
                  <select className={fieldClass} value={shipmentSheetName} onChange={(event) => setShipmentSheetName(event.target.value as ShipmentSheetName)}>
                    {SHIPMENT_SHEET_NAMES.map((sheetName) => (
                      <option key={sheetName} value={sheetName}>{sheetName}</option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            <div className="space-y-2 md:hidden">
              {confirmItems.map((item) => (
                <div key={item.key} className="rounded-md border bg-background p-3">
                  <div className="font-medium">{item.title}</div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{item.labelId} / {item.legacyManagementNo}</div>
                  <div className="mt-2 text-xs text-muted-foreground">{item.allocationLabel || "自動判定"}</div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">出庫数量</span>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="h-8 w-8 rounded border text-orange-600 disabled:opacity-40"
                        onClick={() => setItemQuantity(item, item.quantity - 1)}
                        disabled={item.quantity <= 1}
                      >
                        -
                      </button>
                      <Input
                        type="number"
                        min={1}
                        max={item.maxQuantity}
                        value={item.quantity}
                        onChange={(event) => setItemQuantity(item, Number(event.target.value))}
                        className="h-8 w-16 px-1 text-center"
                      />
                      <button
                        type="button"
                        className="h-8 w-8 rounded border text-orange-600 disabled:opacity-40"
                        onClick={() => setItemQuantity(item, item.quantity + 1)}
                        disabled={item.quantity >= item.maxQuantity}
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="hidden overflow-hidden rounded-md border md:block">
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  <div className="grid grid-cols-[minmax(0,1fr)_150px_120px] border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                    <div>商品名</div>
                    <div>注文行</div>
                    <div className="text-right">出庫数量</div>
                  </div>
                  <div className="divide-y">
                    {confirmItems.map((item) => (
                      <div key={item.key} className="grid grid-cols-[minmax(0,1fr)_150px_120px] items-center gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{item.title}</div>
                          <div className="mt-0.5 font-mono text-xs text-muted-foreground">{item.labelId} / {item.legacyManagementNo}</div>
                        </div>
                        <div className="truncate text-xs text-muted-foreground">{item.allocationLabel || "自動判定"}</div>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            type="button"
                            className="h-7 w-7 rounded border text-orange-600 disabled:opacity-40"
                            onClick={() => setItemQuantity(item, item.quantity - 1)}
                            disabled={item.quantity <= 1}
                          >
                            -
                          </button>
                          <Input
                            type="number"
                            min={1}
                            max={item.maxQuantity}
                            value={item.quantity}
                            onChange={(event) => setItemQuantity(item, Number(event.target.value))}
                            className="h-7 w-14 px-1 text-center"
                          />
                          <button
                            type="button"
                            className="h-7 w-7 rounded border text-orange-600 disabled:opacity-40"
                            onClick={() => setItemQuantity(item, item.quantity + 1)}
                            disabled={item.quantity >= item.maxQuantity}
                          >
                            +
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <p className="text-sm text-muted-foreground">上記 {confirmItems.length} 件の商品を出庫処理します。この操作は元に戻せません。</p>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => setShowConfirm(false)} disabled={isSubmitting}>
              キャンセル
            </Button>
            <Button type="button" className="gap-2 bg-orange-600 text-white hover:bg-orange-700" onClick={submitDelivery} disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageMinus className="h-4 w-4" />}
              出庫する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(deleteHistoryConfirm)}
        onOpenChange={(open) => {
          if (!open && !deleteHistoryMutation.isPending) setDeleteHistoryConfirm(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-1rem)] overflow-y-auto sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-5 w-5 text-destructive" />
              出庫履歴を削除
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <strong>{deleteHistoryConfirm?.deliveryNo}</strong> の出庫履歴とサイト内在庫の商品を削除します。この操作は元に戻せません。
            </p>
            {deleteHistoryConfirm?.titles.length ? (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-muted/30 p-3">
                {deleteHistoryConfirm.titles.map((title, index) => (
                  <p key={`${title}-${index}`} className="text-sm">{title}</p>
                ))}
              </div>
            ) : null}
            <p className="rounded bg-amber-50 p-2 text-xs text-amber-700">
              ※ 出庫履歴のDBレコードとサイト内在庫が両方削除されます。
            </p>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDeleteHistoryConfirm(null)}
              disabled={deleteHistoryMutation.isPending}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="gap-1.5"
              disabled={deleteHistoryMutation.isPending || !deleteHistoryConfirm}
              onClick={() => {
                if (!deleteHistoryConfirm) return;
                deleteHistoryMutation.mutate({
                  historyId: deleteHistoryConfirm.historyId,
                  inventoryIds: deleteHistoryConfirm.inventoryIds,
                });
              }}
            >
              {deleteHistoryMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {fedexDialog ? (
        <FedexShipmentDialog
          open={Boolean(fedexDialog)}
          onClose={() => setFedexDialog(null)}
          groupKey={fedexDialog.deliveryNo}
          groupItems={fedexDialog.items}
          onSubmit={(data) =>
            createFedexMutation.mutate({
              deliveryNo: fedexDialog.deliveryNo,
              sheetName: data.sheetName,
              shippingDate: data.shippingDate,
              trackingNumber: data.trackingNumber,
              items: data.items,
              historyId: fedexDialog.historyId,
              operatorName: getCurrentWorkWorkerName("野田"),
            })
          }
          isPending={createFedexMutation.isPending}
          existingShipments={fedexShipmentsMap.get(fedexDialog.deliveryNo) ?? []}
        />
      ) : null}
    </div>
  );
}

function ReturnPanel({ labels }: { labels: LabelView[] }) {
  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <h2 className="text-lg font-semibold">返品</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <Input placeholder="返品する商品IDをスキャン" />
          <select className={fieldClass} defaultValue="sale">
            <option value="sale">販売済みとして出庫</option>
            <option value="supplier">仕入先返品</option>
            <option value="disposal">処分</option>
            <option value="customer">顧客返品</option>
          </select>
          <Button type="button" variant="outline" className="gap-2">
            <RotateCcw className="h-4 w-4" />
            返品登録
          </Button>
        </div>
      </section>
      {labels.length === 0 ? (
        <EmptyState icon={RotateCcw} title="返品対象の商品IDがありません" />
      ) : (
        <section className="rounded-md border bg-background p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">返品対象</h3>
            <Badge variant="outline">{labels.length.toLocaleString()}件</Badge>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {labels.map((label) => (
              <div key={label.labelId} className="rounded-md border bg-card p-3 shadow-sm">
                <div className="flex gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="font-mono text-lg font-bold tracking-wide text-slate-950">{label.labelId}</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950">{label.title}</div>
                    <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {label.legacyManagementNo}</div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {label.allocationLabel ? <Badge variant="secondary" className="font-mono">{label.allocationLabel}</Badge> : null}
                      <Badge className={labelBadgeClass(label.rawStatus)}>{label.status}</Badge>
                      <Badge variant="outline">{label.supplier.name}</Badge>
                    </div>
                  </div>
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded border bg-white p-1.5 sm:h-20 sm:w-20">
                    <ProductQrCode value={label.labelId} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default function PurchaseRegistration() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showGlobalMissingTracking, setShowGlobalMissingTracking] = useState(false);
  const [showTrackedGlobalRowsOnly, setShowTrackedGlobalRowsOnly] = useState(false);
  const [selectedMissingTrackingRowIds, setSelectedMissingTrackingRowIds] = useState<Set<number>>(() => new Set());
  const [showBulkTrackingDialog, setShowBulkTrackingDialog] = useState(false);
  const [bulkTrackingForm, setBulkTrackingForm] = useState<TrackingFormState>({
    shipDate: todayInputDate(),
    trackingNumber: "",
    carrier: "auto",
  });
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) return "scan";
    return "order";
  });
  const [stockViewMode, setStockViewMode] = useState<StockViewMode>("list");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [productDetailFilter, setProductDetailFilter] = useState<ProductDetailFilter | null>(null);
  const [labelsToPrint, setLabelsToPrint] = useState<LabelView[]>([]);
  const [printJobId, setPrintJobId] = useState(0);
  const [checklistToPrint, setChecklistToPrint] = useState<LabelView[]>([]);
  const [checklistJobId, setChecklistJobId] = useState(0);
  const [labelStartPosition, setLabelStartPosition] = useState<number>(() => loadLabelStartPosition());
  const [printedStartPosition, setPrintedStartPosition] = useState(1);
  const [receivedShippingLabels, setReceivedShippingLabels] = useState<LabelView[]>([]);
  const [deletingRowId, setDeletingRowId] = useState<number | null>(null);
  const [trackingDialogRow, setTrackingDialogRow] = useState<PurchaseRow | null>(null);
  const [editingPurchaseRow, setEditingPurchaseRow] = useState<PurchaseRow | null>(null);
  const [purchaseEditForm, setPurchaseEditForm] = useState<PurchaseEditFormState>({
    title: "",
    managementNo: "",
    category: "",
    quantity: "1",
    unitPrice: "",
    estimatedDate: "",
    supplierName: "",
    supplierUrl: "",
    shipDate: todayInputDate(),
    trackingNumber: "",
    carrier: "auto",
  });
  const [editingStockItem, setEditingStockItem] = useState<InventoryItem | null>(null);
  const [stockEditForm, setStockEditForm] = useState<StockEditFormState>({
    title: "",
    managementNo: "",
    category: "",
    quantity: "0",
    unit: "個",
    place: "",
    unitPrice: "",
    supplierName: "",
    supplierUrl: "",
  });
  const [trackingForm, setTrackingForm] = useState<TrackingFormState>({
    shipDate: todayInputDate(),
    trackingNumber: "",
    carrier: "auto",
  });
  const deleteInventoryMutation = trpc.inventory.zaico.deleteInventory.useMutation();
  const updatePurchaseDataMutation = trpc.inventory.zaico.updatePurchaseData.useMutation();
  const updateInventoryMutation = trpc.inventory.zaico.updateInventory.useMutation();
  const updateSupplierNameOnlyMutation = trpc.inventory.zaico.updateSupplierNameOnly.useMutation();
  const upsertPurchaseExtraMutation = trpc.inventory.purchaseExtra.upsert.useMutation();
  const upsertPurchaseExtraBulkMutation = trpc.inventory.purchaseExtra.upsertBulk.useMutation();

  const normalizedSearch = search.trim();

  const queryInput = useMemo(
    () => ({
      page: 1,
      pageSize: 100,
      category: null,
      status: null,
      search: normalizedSearch || null,
      inboundClass: null,
    }),
    [normalizedSearch],
  );

  const { data, isLoading, isFetching, refetch } = trpc.inventory.zaico.getPurchasesWithCategoryPage.useQuery(queryInput, {
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const {
    data: allPurchaseRegistrationData,
    isLoading: isAllPurchaseRegistrationLoading,
    isFetching: isAllPurchaseRegistrationFetching,
    refetch: refetchAllPurchaseRegistrations,
  } = trpc.inventory.zaico.getPurchasesWithCategory.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  const {
    data: inventoryData,
    isLoading: isInventoryLoading,
    isFetching: isInventoryFetching,
    refetch: refetchInventories,
  } = trpc.inventory.zaico.getInventories.useQuery(undefined, {
    staleTime: 30_000,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });

  const rows = (data?.items ?? []) as PurchaseRow[];
  const allPurchaseRows = useMemo(
    () => (allPurchaseRegistrationData ?? rows) as PurchaseRow[],
    [allPurchaseRegistrationData, rows],
  );
  const searchText = normalizedSearch.toLowerCase();
  const { data: purchaseRegistrationInvoices } =
    trpc.inventory.orderManagement.getPurchaseRegistrationInvoices.useQuery(undefined, {
      staleTime: 30_000,
      refetchOnMount: "always",
      refetchOnWindowFocus: false,
    });

  const countableRows = useMemo(() => {
    return rows.flatMap((row) => {
      if (searchText && !buildSearchText(row).includes(searchText)) return [];
      const visibleRow = withVisiblePurchaseItems(row);
      return visibleRow ? [visibleRow] : [];
    });
  }, [rows, searchText]);

  const globalPurchaseListRows = useMemo(() => {
    return normalizePurchaseRegistrationRows(allPurchaseRows)
      .sort(comparePurchaseRegistrationOrder);
  }, [allPurchaseRows]);

  const searchedGlobalPurchaseListRows = useMemo(() => {
    if (!searchText) return globalPurchaseListRows;
    return globalPurchaseListRows.filter((row) => buildSearchText(row).includes(searchText));
  }, [globalPurchaseListRows, searchText]);

  const trackedInboundWaitingGlobalPurchaseRows = useMemo(
    () =>
      searchedGlobalPurchaseListRows.filter(
        (row) => hasPurchaseTracking(row) && purchaseRowStatusKind(row) === "inbound_shipped",
      ),
    [searchedGlobalPurchaseListRows],
  );

  const missingTrackingGlobalPurchaseRows = useMemo(
    () => searchedGlobalPurchaseListRows.filter((row) => !hasPurchaseTracking(row)),
    [searchedGlobalPurchaseListRows],
  );

  const visibleGlobalMissingTrackingRows = showTrackedGlobalRowsOnly
    ? trackedInboundWaitingGlobalPurchaseRows
    : missingTrackingGlobalPurchaseRows;

  const searchedGlobalPurchaseMissingTrackingCount = missingTrackingGlobalPurchaseRows.length;

  const selectedBulkTrackingRows = useMemo(
    () => visibleGlobalMissingTrackingRows.filter((row) => selectedMissingTrackingRowIds.has(row.id)),
    [selectedMissingTrackingRowIds, visibleGlobalMissingTrackingRows],
  );

  useEffect(() => {
    setSelectedMissingTrackingRowIds((current) => {
      if (current.size === 0) return current;
      const visibleIds = new Set(visibleGlobalMissingTrackingRows.map((row) => row.id));
      const next = new Set(Array.from(current).filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visibleGlobalMissingTrackingRows]);

  const filteredRows = useMemo(() => {
    return countableRows.filter((row) => matchesStatus(row, statusFilter));
  }, [countableRows, statusFilter]);

  const groups = useMemo(
    () => buildAllocationGroups(filteredRows, purchaseRegistrationInvoices),
    [filteredRows, purchaseRegistrationInvoices],
  );
  const invoiceGroups = useMemo(() => groups.filter((group) => group.key !== OTHER_INVOICE_KEY), [groups]);
  const inventoryItems = useMemo(() => (inventoryData ?? []) as InventoryItem[], [inventoryData]);
  const inventoryLabels = useMemo(() => buildInventoryLabelViews(inventoryItems), [inventoryItems]);
  const closedInvoiceInventoryLabels = useMemo(
    () => buildClosedInvoiceInventoryLabelViews(countableRows, purchaseRegistrationInvoices),
    [countableRows, purchaseRegistrationInvoices],
  );
  const ebayInventoryLabels = useMemo(
    () => mergeLabelViewsById(inventoryLabels, closedInvoiceInventoryLabels).filter((label) => isEbayManagementNo(label.legacyManagementNo)),
    [closedInvoiceInventoryLabels, inventoryLabels],
  );
  const regularInventoryLabels = useMemo(
    () => mergeLabelViewsById(inventoryLabels, closedInvoiceInventoryLabels).filter((label) => !isEbayManagementNo(label.legacyManagementNo)),
    [closedInvoiceInventoryLabels, inventoryLabels],
  );
  const ebayInventoryLabelGroup = useMemo<AllocationGroup | null>(() => {
    if (ebayInventoryLabels.length === 0) return null;
    return {
      key: EBAY_GROUP_KEY,
      label: EBAY_GROUP_LABEL,
      partner: EBAY_GROUP_LABEL,
      rows: [],
      products: [],
      labels: ebayInventoryLabels,
      required: ebayInventoryLabels.length,
      secured: ebayInventoryLabels.length,
      waiting: 0,
      purchaseTotal: ebayInventoryLabels.reduce((total, label) => total + label.unitPrice, 0),
      invoiceOrderQty: ebayInventoryLabels.length,
      invoiceDeliveredQty: 0,
      invoiceRemainingQty: ebayInventoryLabels.length,
    };
  }, [ebayInventoryLabels]);
  const inventoryLabelGroup = useMemo<AllocationGroup | null>(() => {
    if (regularInventoryLabels.length === 0) return null;
    return {
      key: INVENTORY_LABEL_GROUP_KEY,
      label: "在庫一覧",
      partner: "在庫",
      rows: [],
      products: [],
      labels: regularInventoryLabels,
      required: regularInventoryLabels.length,
      secured: regularInventoryLabels.length,
      waiting: 0,
      purchaseTotal: regularInventoryLabels.reduce((total, label) => total + label.unitPrice, 0),
      invoiceOrderQty: regularInventoryLabels.length,
      invoiceDeliveredQty: 0,
      invoiceRemainingQty: regularInventoryLabels.length,
    };
  }, [regularInventoryLabels]);
  const labelPrintGroups = useMemo(
    () =>
      mergeAllocationGroupsByKey([
        ...invoiceGroups,
        ...(ebayInventoryLabelGroup ? [ebayInventoryLabelGroup] : []),
        ...(inventoryLabelGroup ? [inventoryLabelGroup] : []),
      ]),
    [ebayInventoryLabelGroup, inventoryLabelGroup, invoiceGroups],
  );
  const deliveryInvoiceOptions = useMemo(
    () =>
      mergeAllocationGroupsByKey([
        ...invoiceGroups,
        ...(ebayInventoryLabelGroup ? [ebayInventoryLabelGroup] : []),
      ]),
    [ebayInventoryLabelGroup, invoiceGroups],
  );
  const selectedGroup =
    invoiceGroups.find((group) => group.key === selectedGroupKey) ??
    (selectedGroupKey === EBAY_GROUP_KEY ? ebayInventoryLabelGroup : null) ??
    invoiceGroups[0] ??
    null;
  const selectedIsEbayGroup = selectedGroupKey === EBAY_GROUP_KEY || selectedGroup?.key === EBAY_GROUP_KEY;
  const selectedLabelPrintGroup = labelPrintGroups.find((group) => group.key === selectedGroupKey) ?? labelPrintGroups[0] ?? null;
  const selectedShippingGroup = labelPrintGroups.find((group) => group.key === selectedGroupKey) ?? labelPrintGroups[0] ?? null;
  const selectedReturnGroup = labelPrintGroups.find((group) => group.key === selectedGroupKey) ?? labelPrintGroups[0] ?? null;
  const selectedRows = getAllRowsFromGroup(selectedGroup, filteredRows);
  const selectedInvoiceNo = invoiceNoFromGroupKey(selectedGroup?.key);
  const selectedRowInventoryIds = useMemo(() => new Set(
    selectedRows.flatMap((row) =>
      row.purchase_items
        .map((item) => Number(item.inventory_id))
        .filter((inventoryId) => Number.isFinite(inventoryId) && inventoryId > 0),
    ),
  ), [selectedRows]);
  const { data: selectedInvoiceProducts } = trpc.inventory.orderManagement.getInvoiceProducts.useQuery(
    { invoiceNo: selectedInvoiceNo ?? "0" },
    {
      enabled: Boolean(selectedInvoiceNo),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );
  const selectedLabelPrintLabels = selectedLabelPrintGroup?.labels ?? [];
  const selectedReturnLabels = selectedReturnGroup?.labels ?? [];
  const selectedShippingInventoryLabels = useMemo(
    () => {
      if (!selectedInvoiceNo) return [];
      return inventoryLabels.filter((label) => {
        if (!label.inventoryId || selectedRowInventoryIds.has(label.inventoryId)) return false;
        return parseInvoiceFromManagementNo(label.legacyManagementNo)?.invoiceNo === selectedInvoiceNo;
      });
    },
    [inventoryLabels, selectedInvoiceNo, selectedRowInventoryIds],
  );
  const selectedShippingLabels = useMemo(() => {
    const selectedKey = selectedShippingGroup?.key;
    const receivedForGroup = selectedKey
      ? receivedShippingLabels.filter((label) => groupKeyFromLabel(label) === selectedKey)
      : receivedShippingLabels;
    return mergeLabelViewsById(
      mergeLabelViewsById(receivedForGroup, selectedShippingGroup?.labels ?? []),
      selectedShippingInventoryLabels,
    );
  }, [receivedShippingLabels, selectedShippingGroup, selectedShippingInventoryLabels]);
  const allLabels = useMemo(() => buildLabelViews(rows), [rows]);
  const allScannableLabels = useMemo(() => mergeLabelViewsById(allLabels, inventoryLabels), [allLabels, inventoryLabels]);
  const allInvoiceLabels = useMemo(() => invoiceGroups.flatMap((group) => group.labels), [invoiceGroups]);
  const allPrintableLabels = useMemo(() => [...allInvoiceLabels, ...inventoryLabels], [allInvoiceLabels, inventoryLabels]);
  const [narrowLabelScope, setNarrowLabelScope] = useState(true);
  const [labelScopeFrom, setLabelScopeFrom] = useState<string>(() => loadLabelScopeFrom());
  const changeLabelScopeFrom = (value: string) => {
    setLabelScopeFrom(value);
    // 次に開いたときも同じ基準日で見たいので覚えておく
    if (!ISO_DATE_PATTERN.test(value)) return;
    try {
      window.localStorage.setItem(LABEL_SCOPE_FROM_KEY, value);
    } catch {
      // 保存できなくても動作には影響しない
    }
  };
  const scopeLabels = (labels: LabelView[]) =>
    narrowLabelScope
      ? labels.filter((label) => isWithinLabelScope(label, labelScopeFrom))
      : labels;
  const scopedLabelPrintLabels = useMemo(
    () => scopeLabels(selectedLabelPrintLabels),
    [labelScopeFrom, narrowLabelScope, selectedLabelPrintLabels],
  );
  const scopedInvoiceLabels = useMemo(
    () => scopeLabels(allInvoiceLabels),
    [allInvoiceLabels, labelScopeFrom, narrowLabelScope],
  );
  const scopedScannableLabels = useMemo(
    () => scopeLabels(allScannableLabels),
    [allScannableLabels, labelScopeFrom, narrowLabelScope],
  );
  const scopedPrintableLabels = useMemo(
    () => scopeLabels(allPrintableLabels),
    [allPrintableLabels, labelScopeFrom, narrowLabelScope],
  );
  const allStockItems = useMemo(() => buildStockItemViewsFromInventories(inventoryItems), [inventoryItems]);
  const allFulfillmentStockItems = useMemo(
    () => allStockItems.filter(isFulfillmentStockItem),
    [allStockItems],
  );
  const selectedEbayStockItems = useMemo(
    () => selectedIsEbayGroup
      ? allFulfillmentStockItems.filter((item) => (
        isEbayManagementNo(item.legacyManagementNo) &&
        (!searchText || buildStockSearchText(item).includes(searchText))
      ))
      : [],
    [allFulfillmentStockItems, searchText, selectedIsEbayGroup],
  );
  const selectedInvoiceProductList = selectedInvoiceProducts?.products ?? EMPTY_INVOICE_PRODUCTS;
  const selectedInvoiceStockItems = useMemo(
    () => selectedInvoiceNo
      ? filterInvoiceStockItems(allFulfillmentStockItems, selectedInvoiceProductList, selectedRowInventoryIds)
      : [],
    [allFulfillmentStockItems, selectedInvoiceNo, selectedInvoiceProductList, selectedRowInventoryIds],
  );
  const selectedInvoiceStockProducts = useMemo(
    () => buildInvoiceStockProductSummaries(selectedInvoiceStockItems, selectedInvoiceProductList, selectedRowInventoryIds),
    [selectedInvoiceProductList, selectedInvoiceStockItems, selectedRowInventoryIds],
  );
  const selectedBaseProducts = useMemo(
    () => [
      ...buildProductSummaries(selectedRows, selectedInvoiceProductList),
      ...selectedInvoiceStockProducts,
    ],
    [selectedInvoiceProductList, selectedInvoiceStockProducts, selectedRows],
  );
  const selectedProducts = withInvoiceStockCountsFromItems(
    withInvoiceProductCounts(selectedBaseProducts, selectedInvoiceProductList),
    selectedInvoiceStockItems,
    selectedInvoiceProductList,
  )
    .filter((product) => !selectedInvoiceNo || product.invoiceOrdered != null);
  const selectedOpenProducts = selectedProducts.filter(hasOpenInvoiceQuantity);
  const selectedDetailRows = filterRowsByProductDetail(selectedRows, productDetailFilter);
  const selectedDetailStockItems = useMemo(
    () => {
      if (selectedIsEbayGroup) {
        return productDetailFilter
          ? filterStockItemsByProductDetail(selectedEbayStockItems, productDetailFilter)
          : selectedEbayStockItems;
      }
      return productDetailFilter
        ? filterStockItemsByInvoiceProductDetail(selectedInvoiceStockItems, productDetailFilter, selectedInvoiceProductList)
        : selectedInvoiceStockItems;
    },
    [
      productDetailFilter,
      selectedEbayStockItems,
      selectedInvoiceProductList,
      selectedInvoiceStockItems,
      selectedIsEbayGroup,
    ],
  );

  const counts = useMemo(() => countPurchaseRows(countableRows), [countableRows]);
  const selectedStatusRows = useMemo(() => {
    const currentGroupKey = selectedGroupKey || selectedGroup?.key;
    if (!currentGroupKey) return countableRows;
    return countableRows.filter((row) => getInvoiceInfo(row).key === currentGroupKey);
  }, [countableRows, selectedGroup?.key, selectedGroupKey]);
  const statusCounts = useMemo(() => countPurchaseRows(selectedStatusRows), [selectedStatusRows]);
  const statusFilterOptions: Array<{ value: StatusFilter; label: string; count: number }> = [
    { value: "all", label: "すべて", count: statusCounts.all },
    { value: "ordered", label: "未入庫", count: statusCounts.ordered },
    { value: "received", label: "入庫済み", count: statusCounts.received },
    { value: "missing_tracking", label: "追跡番号未登録", count: statusCounts.missingTracking },
  ];

  const trackingPreview = useMemo(() => {
    const trackingNumber = trackingForm.trackingNumber.trim();
    return trackingNumber ? getPurchaseTrackingMeta(trackingNumber, trackingForm.carrier) : null;
  }, [trackingForm.carrier, trackingForm.trackingNumber]);

  const bulkTrackingPreview = useMemo(() => {
    const trackingNumber = bulkTrackingForm.trackingNumber.trim();
    return trackingNumber ? getPurchaseTrackingMeta(trackingNumber, bulkTrackingForm.carrier) : null;
  }, [bulkTrackingForm.carrier, bulkTrackingForm.trackingNumber]);

  useEffect(() => {
    setSelectedMissingTrackingRowIds((current) => {
      if (current.size === 0) return current;
      const validIds = new Set(globalPurchaseListRows.map((row) => row.id));
      const next = new Set(Array.from(current).filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [globalPurchaseListRows]);

  const workflowCounts = useMemo(
    () => ({
      order: filteredRows.length,
      labels: scopedPrintableLabels.length,
      scan: scopedPrintableLabels.length,
      stock: allStockItems.length,
      shipping: buildShippingItemsFromLabels(selectedShippingLabels).length,
      returns: allPrintableLabels.length,
    }),
    [allPrintableLabels.length, allStockItems.length, filteredRows.length, scopedPrintableLabels.length, selectedShippingLabels],
  );

  const changeLabelStartPosition = (value: number) => {
    const next = clampLabelStartPosition(value);
    setLabelStartPosition(next);
    saveLabelStartPosition(next);
  };

  const handlePrintLabels = (targetLabels: LabelView[]) => {
    const printableLabels = targetLabels.filter((label) => label.labelId.trim());
    // ラベル面付けと確認シートは同時に刷らない
    setChecklistToPrint([]);
    if (printableLabels.length === 0) return;
    const startPosition = clampLabelStartPosition(labelStartPosition);
    setPrintedStartPosition(startPosition);
    setLabelsToPrint(
      printableLabels.map((label) => ({
        ...label,
        printTitle: formatLabelPrintTitle(label.printTitle || label.title),
      })),
    );
    setPrintJobId((current) => current + 1);

    // 次に空いている面へ送っておく。シートを最後まで使い切れるようにするため。
    const nextStart = nextLabelStartPosition(startPosition, printableLabels.length);
    changeLabelStartPosition(nextStart);
    toast.success(
      `${printableLabels.length}枚を${startPosition}面目から印刷します。次回の開始位置を${nextStart}面目にしました`,
    );
  };

  const handlePrintChecklist = (targetLabels: LabelView[]) => {
    const rows = targetLabels.filter((label) => label.labelId.trim());
    if (rows.length === 0) return;
    setLabelsToPrint([]);
    setChecklistToPrint(rows);
    setChecklistJobId((current) => current + 1);
    toast.success(`確認シート${rows.length}件を印刷します`);
  };

  const handleReceivedLabelForShipping = (label: LabelView) => {
    setReceivedShippingLabels((current) => mergeLabelViewsById(current, [label]));
    const nextGroupKey = groupKeyFromLabel(label);
    if (labelPrintGroups.some((group) => group.key === nextGroupKey)) {
      setSelectedGroupKey(nextGroupKey);
    }
  };

  const handleDeliverySuccess = (labelIds: string[]) => {
    if (labelIds.length === 0) return;
    const shipped = new Set(labelIds.map((labelId) => labelId.trim().toUpperCase()));
    setReceivedShippingLabels((current) => current.filter((label) => !shipped.has(label.labelId.trim().toUpperCase())));
  };

  const handleOpenShippingHistory = (row: PurchaseRow) => {
    const nextKey = getInvoiceInfo(row).key;
    if (labelPrintGroups.some((group) => group.key === nextKey)) {
      setSelectedGroupKey(nextKey);
    }
    setWorkflowTab("shipping");
    window.setTimeout(() => {
      document.getElementById("purchase-shipping-history")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const handleOpenTrackingDialog = (row: PurchaseRow) => {
    const savedCarrier = row.extra?.carrier?.trim().toLowerCase();
    setTrackingForm({
      shipDate: row.extra?.shipDate?.slice(0, 10) || todayInputDate(),
      trackingNumber: row.extra?.trackingNumber ?? "",
      carrier:
        savedCarrier && savedCarrier !== "auto" && TRACKING_CARRIER_KEYS.has(savedCarrier as Carrier)
          ? (savedCarrier as Carrier)
          : "auto",
    });
    setTrackingDialogRow(row);
  };

  const handleOpenPurchaseEditDialog = (row: PurchaseRow) => {
    const firstItem = row.purchase_items[0];
    const parsed = parseEtc(firstItem?.etc);
    const supplier = getSupplier(row);
    const savedCarrier = row.extra?.carrier?.trim().toLowerCase();
    setPurchaseEditForm({
      title: firstItem ? firstItem.title?.trim() || actualProductTitle(firstItem) : "",
      managementNo: parsed.managementNo,
      category: firstItem?.category ?? "",
      quantity: String(firstItem?.quantity ?? "1"),
      unitPrice: firstItem?.unit_price != null ? String(firstItem.unit_price) : "",
      estimatedDate: firstItem?.estimated_purchase_date?.slice(0, 10) ?? "",
      supplierName: supplier.name === "-" ? "" : supplier.name,
      supplierUrl: supplier.url,
      shipDate: row.extra?.shipDate?.slice(0, 10) || todayInputDate(),
      trackingNumber: row.extra?.trackingNumber ?? "",
      carrier:
        savedCarrier && savedCarrier !== "auto" && TRACKING_CARRIER_KEYS.has(savedCarrier as Carrier)
          ? (savedCarrier as Carrier)
          : "auto",
    });
    setEditingPurchaseRow(row);
  };

  const handleSubmitPurchaseEdit = async () => {
    if (!editingPurchaseRow || updatePurchaseDataMutation.isPending || updateSupplierNameOnlyMutation.isPending || upsertPurchaseExtraMutation.isPending) return;
    const firstItem = editingPurchaseRow.purchase_items[0];
    if (!firstItem) {
      toast.error("編集できる商品明細がありません");
      return;
    }
    const inventoryId = Number(firstItem.inventory_id ?? purchaseRowInventoryId(editingPurchaseRow));
    if (!Number.isFinite(inventoryId) || inventoryId <= 0) {
      toast.error("在庫IDが見つからないため編集できません");
      return;
    }
    const title = purchaseEditForm.title.trim();
    if (!title) {
      toast.error("商品名を入力してください");
      return;
    }
    const quantity = Math.max(1, Number.parseInt(purchaseEditForm.quantity, 10) || 1);
    const unitPrice =
      purchaseEditForm.unitPrice.trim() === "" ? undefined : Number.parseFloat(purchaseEditForm.unitPrice);
    if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      toast.error("仕入単価は0以上の数字で入力してください");
      return;
    }

    const nextEtc = buildEtcWithManagementNo(
      purchaseEditForm.managementNo,
      firstItem.etc,
      purchaseEditForm.supplierName,
    );
    const trackingNumber = purchaseEditForm.trackingNumber.trim();
    const currentCarrier = editingPurchaseRow.extra?.carrier?.trim() || "auto";
    const nextCarrier = purchaseEditForm.carrier === "auto" ? undefined : purchaseEditForm.carrier;
    const shouldUpdateTracking =
      trackingNumber !== (editingPurchaseRow.extra?.trackingNumber ?? "") ||
      purchaseEditForm.shipDate !== (editingPurchaseRow.extra?.shipDate?.slice(0, 10) || "") ||
      (nextCarrier ?? "auto") !== currentCarrier;
    const purchaseItemPayload = {
      ...(firstItem.id > 0 && { id: firstItem.id }),
      inventoryId,
      title,
      quantity,
      estimatedPurchaseDate: purchaseEditForm.estimatedDate || undefined,
      etc: nextEtc || undefined,
      category: purchaseEditForm.category.trim() || null,
      ...(unitPrice !== undefined && { unitPrice }),
    };

    try {
      await updatePurchaseDataMutation.mutateAsync({
        purchaseId: editingPurchaseRow.id,
        purchaseItems: [purchaseItemPayload],
      });
      await updateSupplierNameOnlyMutation.mutateAsync({
        purchaseId: editingPurchaseRow.id,
        inventoryId,
        supplierName: purchaseEditForm.supplierName.trim() || null,
        supplierUrl: purchaseEditForm.supplierUrl.trim() || null,
      });
      if (shouldUpdateTracking) {
        await upsertPurchaseExtraMutation.mutateAsync({
          zaicoId: editingPurchaseRow.id,
          shipDate: purchaseEditForm.shipDate || undefined,
          trackingNumber: trackingNumber || undefined,
          carrier: nextCarrier,
          note: editingPurchaseRow.extra?.note ?? undefined,
          inventoryId,
          managementNo: cleanLegacyManagementNo(purchaseEditForm.managementNo || firstItem.etc),
          labelId: firstItem.itemLabels?.[0]?.labelId,
        });
      }
      toast.success("商品情報を更新しました");
      setEditingPurchaseRow(null);
      await Promise.all([
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
        utils.inventory.purchaseHistory.list.invalidate(),
      ]);
      void refetch();
      void refetchAllPurchaseRegistrations();
      void refetchInventories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "商品情報の更新に失敗しました");
    }
  };

  const handleOpenStockEditDialog = (inventoryId: number) => {
    const inventory = inventoryItems.find((item) => item.id === inventoryId);
    if (!inventory) {
      toast.error("在庫情報が見つかりません");
      return;
    }
    const parsed = parseEtc(inventory.etc);
    setStockEditForm({
      title: inventory.title ?? "",
      managementNo: parsed.managementNo,
      category: getInventoryCategory(inventory),
      quantity: String(inventory.quantity ?? "0"),
      unit: inventory.unit ?? "個",
      place: inventory.place ?? "",
      unitPrice:
        inventory.purchase_unit_price != null
          ? String(inventory.purchase_unit_price)
          : inventory.unit_price != null
            ? String(inventory.unit_price)
            : "",
      supplierName: inventory.supplierName ?? parsed.supplierSite ?? "",
      supplierUrl: inventory.supplierUrl ?? "",
    });
    setEditingStockItem(inventory);
  };

  const handleSubmitStockEdit = async () => {
    if (!editingStockItem || updateInventoryMutation.isPending) return;
    const title = stockEditForm.title.trim();
    if (!title) {
      toast.error("商品名を入力してください");
      return;
    }
    const quantity = Math.max(0, Number.parseInt(stockEditForm.quantity, 10) || 0);
    const unitPrice = stockEditForm.unitPrice.trim() === "" ? undefined : Number.parseFloat(stockEditForm.unitPrice);
    if (unitPrice !== undefined && (!Number.isFinite(unitPrice) || unitPrice < 0)) {
      toast.error("仕入単価は0以上の数字で入力してください");
      return;
    }
    try {
      await updateInventoryMutation.mutateAsync({
        inventoryId: editingStockItem.id,
        title,
        quantity: String(quantity),
        unit: stockEditForm.unit || undefined,
        category: stockEditForm.category.trim() || undefined,
        place: stockEditForm.place.trim() || undefined,
        etc: buildEtcWithManagementNo(stockEditForm.managementNo, editingStockItem.etc, stockEditForm.supplierName) || undefined,
        purchase_unit_price: unitPrice,
        supplierName: stockEditForm.supplierName.trim() || undefined,
        supplierUrl: stockEditForm.supplierUrl.trim() || undefined,
      });
      toast.success("在庫情報を更新しました");
      setEditingStockItem(null);
      await Promise.all([
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
      ]);
      void refetchInventories();
      void refetch();
      void refetchAllPurchaseRegistrations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "在庫情報の更新に失敗しました");
    }
  };

  const handleSubmitTracking = async () => {
    if (!trackingDialogRow || upsertPurchaseExtraMutation.isPending) return;
    const trackingNumber = trackingForm.trackingNumber.trim();
    if (!trackingNumber) {
      toast.error("追跡番号を入力してください");
      return;
    }
    try {
      await upsertPurchaseExtraMutation.mutateAsync({
        zaicoId: trackingDialogRow.id,
        shipDate: trackingForm.shipDate || undefined,
        trackingNumber,
        carrier: trackingForm.carrier === "auto" ? undefined : trackingForm.carrier,
        note: trackingDialogRow.extra?.note ?? undefined,
        inventoryId: purchaseRowInventoryId(trackingDialogRow) ?? undefined,
        managementNo: getManagementNos(trackingDialogRow.purchase_items)[0],
        labelId: getItemLabels(trackingDialogRow.purchase_items)[0]?.labelId,
      });
      toast.success("追跡番号を登録しました");
      setTrackingDialogRow(null);
      await Promise.all([
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
        utils.inventory.purchaseHistory.list.invalidate(),
      ]);
      void refetch();
      void refetchAllPurchaseRegistrations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "追跡番号の登録に失敗しました");
    }
  };

  const handleSelectMissingTrackingRow = (row: PurchaseRow, checked: boolean) => {
    setSelectedMissingTrackingRowIds((current) => {
      const next = new Set(current);
      if (checked) next.add(row.id);
      else next.delete(row.id);
      return next;
    });
  };

  const handleSelectAllMissingTrackingRows = (targetRows: PurchaseRow[], checked: boolean) => {
    const targetIds = new Set(targetRows.map((row) => row.id));
    setSelectedMissingTrackingRowIds((current) => {
      const next = new Set(current);
      if (checked) {
        for (const id of targetIds) next.add(id);
      } else {
        for (const id of targetIds) next.delete(id);
      }
      return next;
    });
  };

  const handleOpenBulkTrackingDialog = () => {
    if (selectedBulkTrackingRows.length === 0) {
      toast.error("追跡番号を登録する商品を選択してください");
      return;
    }
    setBulkTrackingForm({
      shipDate: todayInputDate(),
      trackingNumber: "",
      carrier: "auto",
    });
    setShowBulkTrackingDialog(true);
  };

  const handleSubmitBulkTracking = async () => {
    if (upsertPurchaseExtraBulkMutation.isPending || selectedBulkTrackingRows.length === 0) return;
    const trackingNumber = bulkTrackingForm.trackingNumber.trim();
    if (!trackingNumber) {
      toast.error("追跡番号を入力してください");
      return;
    }

    try {
      await upsertPurchaseExtraBulkMutation.mutateAsync({
        zaicoIds: selectedBulkTrackingRows.map((row) => row.id),
        shipDate: bulkTrackingForm.shipDate || undefined,
        trackingNumber,
        carrier: bulkTrackingForm.carrier === "auto" ? undefined : bulkTrackingForm.carrier,
      });
      toast.success(`${selectedBulkTrackingRows.length}件に追跡番号を登録しました`);
      setShowBulkTrackingDialog(false);
      setSelectedMissingTrackingRowIds(new Set());
      setBulkTrackingForm({
        shipDate: todayInputDate(),
        trackingNumber: "",
        carrier: "auto",
      });
      await Promise.all([
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
        utils.inventory.purchaseHistory.list.invalidate(),
      ]);
      void refetch();
      void refetchAllPurchaseRegistrations();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "追跡番号の一括登録に失敗しました");
    }
  };

  const handleDeletePurchaseRow = async (row: PurchaseRow) => {
    const inventoryId = purchaseRowInventoryId(row);
    if (!inventoryId) {
      toast.error("削除できる在庫IDが見つかりません");
      return;
    }
    const title = actualProductTitle(row.purchase_items[0]) || row.purchase_items[0]?.title || "商品";
    if (!window.confirm(`${title} を削除しますか？\n削除済み商品に保存されます。`)) return;
    setDeletingRowId(row.id);
    try {
      await deleteInventoryMutation.mutateAsync({
        inventoryId,
        alsoDeletePurchaseIds: [row.id],
      });
      toast.success(`${title} を削除済み商品に移動しました`);
      await Promise.all([
        utils.inventory.zaico.getPurchasesWithCategoryPage.invalidate(),
        utils.inventory.zaico.getPurchasesWithCategory.invalidate(),
        utils.inventory.zaico.getInventories.invalidate(),
        utils.inventory.orderManagement.getPurchaseRegistrationInvoices.invalidate(),
        utils.inventory.deletedItems.list.invalidate(),
      ]);
      void refetch();
      void refetchAllPurchaseRegistrations();
      void refetchInventories();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "削除に失敗しました");
    } finally {
      setDeletingRowId(null);
    }
  };

  useEffect(() => {
    if (printJobId === 0 || labelsToPrint.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, [labelsToPrint, printJobId]);

  useEffect(() => {
    if (checklistJobId === 0 || checklistToPrint.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, [checklistToPrint, checklistJobId]);

  // 刷り終わったら印刷ルートを空にする。残しておくと次の印刷に混ざる。
  useEffect(() => {
    const clear = () => {
      setLabelsToPrint([]);
      setChecklistToPrint([]);
    };
    window.addEventListener("afterprint", clear);
    return () => window.removeEventListener("afterprint", clear);
  }, []);

  const isScanWorkflow = workflowTab === "scan";
  const isStockWorkflow = workflowTab === "stock";
  const isLabelWorkflow = workflowTab === "labels";
  const isShippingWorkflow = workflowTab === "shipping";
  const isReturnWorkflow = workflowTab === "returns";
  const groupedWorkflowUsesInventory = isLabelWorkflow || isShippingWorkflow || isReturnWorkflow;
  const groupSelectOptions = groupedWorkflowUsesInventory ? labelPrintGroups : invoiceGroups;
  const selectedGroupOption = groupSelectOptions.find((group) => group.key === selectedGroupKey) ?? groupSelectOptions[0] ?? null;
  const hasWorkflowTargets = showGlobalMissingTracking || (groupedWorkflowUsesInventory ? labelPrintGroups.length > 0 : groups.length > 0);
  const isPageLoading = isLoading || (isStockWorkflow && isInventoryLoading) || (showGlobalMissingTracking && isAllPurchaseRegistrationLoading);
  const isRefreshing = isFetching || isInventoryFetching || isAllPurchaseRegistrationFetching;
  const refreshCurrentData = () => void Promise.all([refetch(), refetchInventories(), refetchAllPurchaseRegistrations()]);
  const isPurchaseEditSaving =
    updatePurchaseDataMutation.isPending ||
    updateSupplierNameOnlyMutation.isPending ||
    upsertPurchaseExtraMutation.isPending ||
    upsertPurchaseExtraBulkMutation.isPending;
  const isStockEditSaving = updateInventoryMutation.isPending;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50/60">
      <LabelPrintStyles />
      <PrintableLabelSheet labels={labelsToPrint} startPosition={printedStartPosition} />
      <PrintableChecklistSheet labels={checklistToPrint} />
      <div className="grid gap-0 lg:block lg:pr-[204px]">
        <main className="space-y-4 p-3 pb-24 md:space-y-5 md:p-6 lg:pb-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-xl font-semibold tracking-tight md:text-2xl">発注登録</h1>
              <div className="mt-2 flex flex-wrap gap-2 md:mt-3">
                <Badge variant="outline" className="gap-1">
                  <PackagePlus className="h-3 w-3" />
                  仕入れ {counts.all.toLocaleString()}件
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Boxes className="h-3 w-3" />
                  数量 {counts.quantity.toLocaleString()}個
                </Badge>
              </div>
            </div>
            <div className="flex w-full flex-col gap-2 md:w-fit md:flex-row md:items-center">
              {isStockWorkflow ? (
                <div className="inline-flex rounded-md border bg-background p-1 shadow-xs">
                  <Button
                    type="button"
                    variant={stockViewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setStockViewMode("list")}
                  >
                    <Boxes className="h-4 w-4" />
                    通常一覧
                  </Button>
                  <Button
                    type="button"
                    variant={stockViewMode === "proposal" ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 gap-1.5"
                    onClick={() => setStockViewMode("proposal")}
                  >
                    <Tag className="h-4 w-4" />
                    提案用
                  </Button>
                </div>
              ) : null}
              <Button type="button" variant="outline" onClick={refreshCurrentData} disabled={isRefreshing} className="h-10 w-full gap-2 md:w-fit">
                {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                更新
              </Button>
            </div>
          </div>

          <section className={cn("rounded-md border bg-background", isScanWorkflow && "hidden md:block")}>
            <div className="grid gap-4 p-3 md:p-4 xl:grid-cols-[minmax(320px,1fr)_minmax(560px,max-content)]">
              {isStockWorkflow ? (
                <div className="rounded-md border bg-slate-50 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <Boxes className="h-4 w-4 text-emerald-700" />
                    在庫一覧
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    現状サイトに登録されている在庫ありの商品をすべて表示します。
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                    <FileText className="h-4 w-4" />
                    {groupedWorkflowUsesInventory ? "インボイス / 在庫" : "インボイス"}
                  </div>
                  <select
                    className={fieldClass}
                    value={selectedGroupOption?.key ?? ""}
                    onChange={(event) => {
                      setSelectedGroupKey(event.target.value);
                      setProductDetailFilter(null);
                      setShowGlobalMissingTracking(false);
                    }}
                  >
                    {groupSelectOptions.length === 0 ? (
                      <option value="">対象なし</option>
                    ) : (
                      groupSelectOptions.map((group) => (
                        <option key={group.key} value={group.key}>
                          {group.label}（{(group.invoiceRemainingQty ?? group.required).toLocaleString()}点）
                        </option>
                      ))
                    )}
                  </select>
                </div>
              )}

              <div className="flex min-w-0 flex-col gap-3 xl:items-end">
                {isStockWorkflow ? (
                  <Badge variant="outline" className="w-fit gap-1 px-3 py-1.5">
                    <Boxes className="h-3.5 w-3.5" />
                    現在庫 {workflowCounts.stock.toLocaleString()}件
                  </Badge>
                ) : (
                  <div className="flex w-full max-w-full flex-wrap items-center justify-start gap-1 rounded-md bg-muted p-1 xl:w-fit xl:justify-end">
                    {statusFilterOptions.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        variant={!showGlobalMissingTracking && statusFilter === option.value ? "secondary" : "ghost"}
                        size="sm"
                        className="h-8 whitespace-nowrap rounded-sm px-3 text-sm"
                        aria-pressed={!showGlobalMissingTracking && statusFilter === option.value}
                        onClick={() => {
                          setStatusFilter(option.value);
                          setProductDetailFilter(null);
                          setShowGlobalMissingTracking(false);
                        }}
                      >
                        {option.label} {option.count.toLocaleString()}
                      </Button>
                    ))}
                    <Button
                      type="button"
                      variant={showGlobalMissingTracking ? "secondary" : "ghost"}
                      size="sm"
                      className="h-8 whitespace-nowrap rounded-sm px-3 text-sm"
                      aria-pressed={showGlobalMissingTracking}
                      onClick={() => {
                        setProductDetailFilter(null);
                        setShowGlobalMissingTracking(true);
                      }}
                    >
                      一覧 {globalPurchaseListRows.length.toLocaleString()}
                    </Button>
                  </div>
                )}
                <div className="relative w-full xl:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="商品名・商品ID・旧管理番号で検索"
                    className="pl-9"
                  />
                </div>
                {isLabelWorkflow || isScanWorkflow ? (
                  <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={narrowLabelScope}
                      onChange={(event) => setNarrowLabelScope(event.target.checked)}
                      className="h-3.5 w-3.5 accent-emerald-700"
                    />
                    この日以降の仕入れだけ
                  </label>
                ) : null}
                {(isLabelWorkflow || isScanWorkflow) && narrowLabelScope ? (
                  <Input
                    type="date"
                    value={labelScopeFrom}
                    onChange={(event) => changeLabelScopeFrom(event.target.value)}
                    aria-label="ラベルを見る対象の開始日"
                    className="h-8 w-36"
                  />
                ) : null}
              </div>
            </div>
          </section>

          {isPageLoading ? (
            <div className="flex min-h-[220px] items-center justify-center rounded-lg border bg-background text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              読み込み中
            </div>
          ) : !isStockWorkflow && !isScanWorkflow && !hasWorkflowTargets ? (
            <EmptyState icon={PackageCheck} title="表示できる発注登録がありません" />
          ) : (
            <Tabs
              value={workflowTab}
              onValueChange={(value) => {
                const nextWorkflow = value as WorkflowTab;
                setWorkflowTab(nextWorkflow);
                if (nextWorkflow !== "order") setShowGlobalMissingTracking(false);
              }}
              className="gap-4"
            >
              <TabsContent value="order">
                {showGlobalMissingTracking ? (
                  <MissingTrackingOverview
                    rows={visibleGlobalMissingTrackingRows}
                    totalCount={globalPurchaseListRows.length}
                    trackingRegisteredOnly={showTrackedGlobalRowsOnly}
                    trackingRegisteredCount={trackedInboundWaitingGlobalPurchaseRows.length}
                    missingTrackingCount={searchedGlobalPurchaseMissingTrackingCount}
                    selectedRowIds={selectedMissingTrackingRowIds}
                    onSelectRow={handleSelectMissingTrackingRow}
                    onSelectAllRows={handleSelectAllMissingTrackingRows}
                    onTrackingRegisteredOnlyChange={setShowTrackedGlobalRowsOnly}
                    onOpenBulkTracking={handleOpenBulkTrackingDialog}
                    onPrintLabels={handlePrintLabels}
                    onOpenEdit={handleOpenPurchaseEditDialog}
                    onOpenTrackingDialog={handleOpenTrackingDialog}
                    onOpenShippingHistory={handleOpenShippingHistory}
                    onDeleteRow={handleDeletePurchaseRow}
                    deletingRowId={deletingRowId}
                  />
                ) : (
                  <OrderDashboard
                    group={selectedGroup}
                    rows={filteredRows}
                    products={selectedProducts}
                    detailRows={selectedDetailRows}
                    stockDetailItems={selectedDetailStockItems}
                    productFilter={productDetailFilter}
                    onProductFilter={setProductDetailFilter}
                    onClearProductFilter={() => setProductDetailFilter(null)}
                    onPrintLabels={handlePrintLabels}
                    onOpenEdit={handleOpenPurchaseEditDialog}
                    onOpenStockEdit={handleOpenStockEditDialog}
                    onOpenTrackingDialog={handleOpenTrackingDialog}
                    onOpenShippingHistory={handleOpenShippingHistory}
                    onDeleteRow={handleDeletePurchaseRow}
                    deletingRowId={deletingRowId}
                  />
                )}
              </TabsContent>
              <TabsContent value="labels">
                <LabelPrintPanel
                  labels={scopedLabelPrintLabels}
                  allLabels={scopedInvoiceLabels}
                  onPrintChecklist={handlePrintChecklist}
                  onPrintLabels={handlePrintLabels}
                  startPosition={labelStartPosition}
                  onStartPositionChange={changeLabelStartPosition}
                />
              </TabsContent>
              <TabsContent value="scan">
                <ScanPanel labels={scopedScannableLabels} onReceivedLabel={handleReceivedLabelForShipping} />
              </TabsContent>
              <TabsContent value="stock">
                <StockPanel
                  inventories={inventoryItems}
                  purchaseRows={countableRows}
                  unfinishedInvoices={purchaseRegistrationInvoices}
                  searchText={searchText}
                  viewMode={stockViewMode}
                  onOpenEdit={handleOpenStockEditDialog}
                />
              </TabsContent>
              <TabsContent value="shipping">
                <ShippingPanel
                  group={selectedShippingGroup}
                  invoiceOptions={deliveryInvoiceOptions}
                  labels={selectedShippingLabels}
                  allLabels={allScannableLabels}
                  products={selectedOpenProducts}
                  onDeliverySuccess={handleDeliverySuccess}
                />
              </TabsContent>
              <TabsContent value="returns">
                <ReturnPanel labels={selectedReturnLabels} />
              </TabsContent>
            </Tabs>
          )}

        </main>

        <Dialog
          open={Boolean(editingPurchaseRow)}
          onOpenChange={(open) => {
            if (!open && !isPurchaseEditSaving) setEditingPurchaseRow(null);
          }}
        >
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-blue-600" />
                商品詳細を編集
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">商品名</span>
                <Input
                  value={purchaseEditForm.title}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, title: event.target.value }))}
                  autoFocus
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">旧管理番号</span>
                <Input
                  value={purchaseEditForm.managementNo}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, managementNo: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">カテゴリ</span>
                <Input
                  value={purchaseEditForm.category}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, category: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">発注数</span>
                <Input
                  type="number"
                  min={1}
                  value={purchaseEditForm.quantity}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, quantity: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">仕入単価</span>
                <Input
                  type="number"
                  min={0}
                  value={purchaseEditForm.unitPrice}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, unitPrice: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">入庫予定日</span>
                <Input
                  type="date"
                  value={purchaseEditForm.estimatedDate}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, estimatedDate: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">発送日</span>
                <Input
                  type="date"
                  value={purchaseEditForm.shipDate}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, shipDate: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">追跡番号</span>
                <Input
                  value={purchaseEditForm.trackingNumber}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, trackingNumber: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">発送業者</span>
                <select
                  className={fieldClass}
                  value={purchaseEditForm.carrier}
                  onChange={(event) =>
                    setPurchaseEditForm((current) => ({ ...current, carrier: event.target.value as PurchaseEditFormState["carrier"] }))
                  }
                >
                  {TRACKING_CARRIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">仕入先名</span>
                <Input
                  value={purchaseEditForm.supplierName}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, supplierName: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">仕入先URL</span>
                <Input
                  value={purchaseEditForm.supplierUrl}
                  onChange={(event) => setPurchaseEditForm((current) => ({ ...current, supplierUrl: event.target.value }))}
                  type="url"
                />
              </label>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingPurchaseRow(null)} disabled={isPurchaseEditSaving}>
                キャンセル
              </Button>
              <Button type="button" onClick={handleSubmitPurchaseEdit} disabled={isPurchaseEditSaving || !purchaseEditForm.title.trim()}>
                {isPurchaseEditSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(editingStockItem)}
          onOpenChange={(open) => {
            if (!open && !isStockEditSaving) setEditingStockItem(null);
          }}
        >
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Pencil className="h-5 w-5 text-blue-600" />
                在庫商品を編集
              </DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-xs font-medium text-muted-foreground">商品名</span>
                <Input
                  value={stockEditForm.title}
                  onChange={(event) => setStockEditForm((current) => ({ ...current, title: event.target.value }))}
                  autoFocus
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">旧管理番号</span>
                <Input
                  value={stockEditForm.managementNo}
                  onChange={(event) => setStockEditForm((current) => ({ ...current, managementNo: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">カテゴリ</span>
                <Input
                  value={stockEditForm.category}
                  onChange={(event) => setStockEditForm((current) => ({ ...current, category: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">在庫数</span>
                <Input
                  type="number"
                  min={0}
                  value={stockEditForm.quantity}
                  onChange={(event) => setStockEditForm((current) => ({ ...current, quantity: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">単位</span>
                <Input
                  value={stockEditForm.unit}
                  onChange={(event) => setStockEditForm((current) => ({ ...current, unit: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">仕入単価</span>
                <Input
                  type="number"
                  min={0}
                  value={stockEditForm.unitPrice}
                  onChange={(event) => setStockEditForm((current) => ({ ...current, unitPrice: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">保管場所</span>
                <Input
                  value={stockEditForm.place}
                  onChange={(event) => setStockEditForm((current) => ({ ...current, place: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">仕入先名</span>
                <Input
                  value={stockEditForm.supplierName}
                  onChange={(event) => setStockEditForm((current) => ({ ...current, supplierName: event.target.value }))}
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">仕入先URL</span>
                <Input
                  value={stockEditForm.supplierUrl}
                  onChange={(event) => setStockEditForm((current) => ({ ...current, supplierUrl: event.target.value }))}
                  type="url"
                />
              </label>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingStockItem(null)} disabled={isStockEditSaving}>
                キャンセル
              </Button>
              <Button type="button" onClick={handleSubmitStockEdit} disabled={isStockEditSaving || !stockEditForm.title.trim()}>
                {isStockEditSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={Boolean(trackingDialogRow)}
          onOpenChange={(open) => {
            if (!open && !upsertPurchaseExtraMutation.isPending) setTrackingDialogRow(null);
          }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-blue-600" />
                追跡番号を登録
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              {trackingDialogRow ? (
                <div className="rounded-md border bg-muted/30 p-3 text-sm">
                  <div className="font-medium">
                    {actualProductTitle(trackingDialogRow.purchase_items[0]) || trackingDialogRow.purchase_items[0]?.title || "商品"}
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">
                    {getItemLabels(trackingDialogRow.purchase_items).map((label) => label.labelId).join(" / ") || "商品ID未発行"}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    旧管理番号: {getManagementNos(trackingDialogRow.purchase_items).join(" / ") || "-"}
                  </div>
                </div>
              ) : null}

              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">発送日</span>
                <Input
                  type="date"
                  value={trackingForm.shipDate}
                  onChange={(event) => setTrackingForm((current) => ({ ...current, shipDate: event.target.value }))}
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">追跡番号</span>
                <Input
                  value={trackingForm.trackingNumber}
                  onChange={(event) => setTrackingForm((current) => ({ ...current, trackingNumber: event.target.value }))}
                  placeholder="追跡番号を入力"
                  autoFocus
                />
              </label>

              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">発送業者</span>
                <select
                  className={fieldClass}
                  value={trackingForm.carrier}
                  onChange={(event) => setTrackingForm((current) => ({ ...current, carrier: event.target.value as TrackingFormState["carrier"] }))}
                >
                  {TRACKING_CARRIER_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {trackingPreview ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
                  <span className={`rounded px-2 py-0.5 text-xs ${getCarrierColor(trackingPreview.carrier)}`}>
                    {TRACKING_CARRIER_LABELS[trackingPreview.carrier]}
                  </span>
                  <span className="font-mono font-semibold">{trackingForm.trackingNumber.trim()}</span>
                  {trackingPreview.isEcohai ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => openEcohaiTracking(trackingForm.trackingNumber)}>
                      <ExternalLink className="mr-1 h-3 w-3" />
                      追跡を開く
                    </Button>
                  ) : trackingPreview.trackingUrl ? (
                    <a
                      href={trackingPreview.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                    >
                      <ExternalLink className="h-3 w-3" />
                      追跡を開く
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setTrackingDialogRow(null)}
                disabled={upsertPurchaseExtraMutation.isPending}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                onClick={handleSubmitTracking}
                disabled={upsertPurchaseExtraMutation.isPending || !trackingForm.trackingNumber.trim()}
              >
                {upsertPurchaseExtraMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
                追跡番号を登録
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog
          open={showBulkTrackingDialog}
          onOpenChange={(open) => {
            if (!open && !upsertPurchaseExtraBulkMutation.isPending) setShowBulkTrackingDialog(false);
          }}
        >
          <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-blue-600" />
                追跡番号を一括登録
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/30">
                <div className="flex items-center justify-between border-b px-3 py-2 text-sm">
                  <span className="font-medium">登録対象</span>
                  <Badge variant="outline">{selectedBulkTrackingRows.length.toLocaleString()}件</Badge>
                </div>
                <div className="max-h-48 overflow-y-auto p-3">
                  {selectedBulkTrackingRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">商品が選択されていません。</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedBulkTrackingRows.map((row) => {
                        const firstItem = row.purchase_items[0];
                        const labels = getItemLabels(row.purchase_items).map((label) => label.labelId).join(" / ");
                        const managementNos = getManagementNos(row.purchase_items).join(" / ");
                        return (
                          <div key={row.id} className="rounded-md border bg-background p-2 text-sm">
                            <div className="font-medium">{actualProductTitle(firstItem) || firstItem?.title || "商品"}</div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              <span>商品ID: {labels || "未発行"}</span>
                              <span>旧管理番号: {managementNos || "-"}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">発送日</span>
                  <Input
                    type="date"
                    value={bulkTrackingForm.shipDate}
                    onChange={(event) => setBulkTrackingForm((current) => ({ ...current, shipDate: event.target.value }))}
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-xs font-medium text-muted-foreground">発送業者</span>
                  <select
                    className={fieldClass}
                    value={bulkTrackingForm.carrier}
                    onChange={(event) =>
                      setBulkTrackingForm((current) => ({ ...current, carrier: event.target.value as TrackingFormState["carrier"] }))
                    }
                  >
                    {TRACKING_CARRIER_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1 text-sm md:col-span-3">
                  <span className="text-xs font-medium text-muted-foreground">追跡番号</span>
                  <Input
                    value={bulkTrackingForm.trackingNumber}
                    onChange={(event) => setBulkTrackingForm((current) => ({ ...current, trackingNumber: event.target.value }))}
                    placeholder="追跡番号を入力"
                    autoFocus
                  />
                </label>
              </div>

              {bulkTrackingPreview ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
                  <span className={`rounded px-2 py-0.5 text-xs ${getCarrierColor(bulkTrackingPreview.carrier)}`}>
                    {TRACKING_CARRIER_LABELS[bulkTrackingPreview.carrier]}
                  </span>
                  <span className="font-mono font-semibold">{bulkTrackingForm.trackingNumber.trim()}</span>
                  {bulkTrackingPreview.isEcohai ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => openEcohaiTracking(bulkTrackingForm.trackingNumber)}>
                      <ExternalLink className="mr-1 h-3 w-3" />
                      追跡を開く
                    </Button>
                  ) : bulkTrackingPreview.trackingUrl ? (
                    <a
                      href={bulkTrackingPreview.trackingUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded border bg-background px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100"
                    >
                      <ExternalLink className="h-3 w-3" />
                      追跡を開く
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowBulkTrackingDialog(false)}
                disabled={upsertPurchaseExtraBulkMutation.isPending}
              >
                キャンセル
              </Button>
              <Button
                type="button"
                onClick={handleSubmitBulkTracking}
                disabled={
                  upsertPurchaseExtraBulkMutation.isPending ||
                  selectedBulkTrackingRows.length === 0 ||
                  !bulkTrackingForm.trackingNumber.trim()
                }
              >
                {upsertPurchaseExtraBulkMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Truck className="mr-2 h-4 w-4" />}
                {selectedBulkTrackingRows.length.toLocaleString()}件に登録
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <aside className="fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur lg:inset-x-auto lg:bottom-4 lg:right-4 lg:top-20 lg:z-30 lg:h-auto lg:w-[188px] lg:overflow-y-auto lg:border-l lg:border-t-0 lg:bg-background lg:pb-2 lg:shadow-none lg:backdrop-blur-none">
          <nav className="grid grid-cols-6 gap-1 lg:grid-cols-1">
            {workflowTabs.map((tab) => {
              const Icon = tab.icon;
              const active = workflowTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => {
                    setWorkflowTab(tab.value);
                    if (tab.value !== "order") setShowGlobalMissingTracking(false);
                  }}
                  className={cn(
                    "flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-center text-[11px] leading-tight transition-colors lg:h-11 lg:flex-row lg:justify-between lg:px-3 lg:text-left lg:text-sm",
                    active
                      ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "text-slate-700 hover:bg-slate-100",
                  )}
                >
                  <span className="inline-flex min-w-0 flex-col items-center gap-0.5 lg:flex-row lg:gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="max-w-full truncate">{tab.label}</span>
                  </span>
                  <span className="hidden text-xs text-muted-foreground lg:inline">
                    {workflowCounts[tab.value as keyof typeof workflowCounts]}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>
      </div>
    </div>
  );
}


