import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { detectCarrier, getCarrierColor, type Carrier } from "@/inventory/lib/tracking";
import { extractManagementHints, extractModel, extractPreferredModel, suggestCsvProduct } from "@shared/productMatching";
import { invoiceNoFromDeliveryNo } from "@shared/invoiceKey";
import { classifyOutboundScan, normalizeOutboundScan, OUTBOUND_BOX_CODE_PATTERN } from "@shared/outboundBoxes";
import { isInboundComplete, type InboundClass } from "@shared/inboundPipeline";
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
import {
  Boxes,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  ClipboardCopy,
  ClipboardList,
  ExternalLink,
  FileText,
  Loader2,
  PackageCheck,
  PackageMinus,
  PackagePlus,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Send,
  Tag,
  Trash2,
  Truck,
} from "lucide-react";

interface InventoryItemLabel {
  id?: number;
  labelId: string;
  status?: string | null;
  legacyManagementNo?: string | null;
  localInventoryId?: number | null;
}

interface PurchaseItem {
  id: number;
  inventory_id?: number | null;
  title: string;
  quantity: string;
  unit?: string;
  unit_price?: string | number | null;
  status?: string;
  purchase_date?: string | null;
  estimated_purchase_date?: string | null;
  etc?: string | null;
  category?: string | null;
  itemLabels?: InventoryItemLabel[];
  currentInventoryQuantity?: string | number | null;
}

interface PurchaseRow {
  id: number;
  num?: string | null;
  purchase_date?: string | null;
  purchaseDate?: string | Date | null;
  created_at?: string | null;
  createdAt?: string | Date | null;
  status?: string | null;
  inboundClass?: InboundClass | null;
  stage?: string | null;
  csvSupplierName?: string | null;
  csvSupplierUrl?: string | null;
  extra?: { shipDate?: string | null; trackingNumber?: string | null; carrier?: string | null; note?: string | null } | null;
  purchase_items: PurchaseItem[];
}

interface InventoryItem {
  id: number;
  title: string;
  quantity?: string | number | null;
  unit?: string | null;
  category?: string | null;
  categories?: string[] | null;
  place?: string | null;
  etc?: string | null;
  unit_price?: string | number | null;
  purchase_unit_price?: string | number | null;
  last_purchase_date?: string | null;
  updated_at?: string | null;
  supplierUrl?: string | null;
  supplierName?: string | null;
  itemLabels?: InventoryItemLabel[];
}

type StatusFilter = "all" | "ordered" | "received" | "missing_tracking";
type WorkflowTab = "order" | "labels" | "scan" | "stock" | "shipping" | "returns";
type StockViewMode = "list" | "proposal";
type TrackingFormState = { shipDate: string; trackingNumber: string; carrier: "auto" | Carrier };

type PurchaseEditFormState = {
  title: string;
  managementNo: string;
  category: string;
  quantity: string;
  unitPrice: string;
  estimatedDate: string;
  supplierName: string;
  supplierUrl: string;
  shipDate: string;
  trackingNumber: string;
  carrier: "auto" | Carrier;
};

type StockEditFormState = {
  title: string;
  managementNo: string;
  category: string;
  quantity: string;
  unit: string;
  place: string;
  unitPrice: string;
  supplierName: string;
  supplierUrl: string;
};

interface SupplierView {
  name: string;
  url: string;
}

interface LabelView {
  key: string;
  labelId: string;
  rawStatus: string;
  status: string;
  title: string;
  printTitle: string;
  category: string;
  legacyManagementNo: string;
  allocationLabel: string;
  unitPrice: number;
  supplier: SupplierView;
  purchaseDate: string;
  rowId: number;
  itemId: number;
  inventoryId?: number | null;
  trackingNumber?: string | null;
  carrier?: string | null;
}

type LabelPrintRequest = (labels: LabelView[]) => void;

interface StockItemView {
  key: string;
  inventoryId: number;
  labelId: string | null;
  status: string;
  title: string;
  category: string;
  legacyManagementNo: string;
  allocationLabel: string;
  unitPrice: number;
  quantity: number;
  supplier: SupplierView;
  purchaseDate: string;
}

interface StockProposalDetail {
  source: "stock" | "waiting";
  managementNo: string;
  labelId?: string | null;
  quantity: number;
  unitPrice: number;
  status: string;
  supplier: SupplierView;
  date: string;
}

interface StockProposalProduct {
  key: string;
  title: string;
  model: string;
  stockQuantity: number;
  waitingQuantity: number;
  totalQuantity: number;
  unitPriceTotal: number;
  unitPriceQuantity: number;
  minUnitPrice: number | null;
  maxUnitPrice: number | null;
  details: StockProposalDetail[];
  searchText: string;
}

interface StockProposalGroup {
  model: string;
  stockQuantity: number;
  waitingQuantity: number;
  totalQuantity: number;
  unitPriceTotal: number;
  unitPriceQuantity: number;
  products: StockProposalProduct[];
}

interface ShippingItemView {
  key: string;
  inventoryId: number;
  labelId: string | null;
  rawStatus: string;
  status: string;
  canShip: boolean;
  title: string;
  legacyManagementNo: string;
  allocationLabel: string;
  unitPrice: number;
  supplier: SupplierView;
  quantity: number;
  maxQuantity: number;
}

interface ProductSummary {
  key: string;
  title: string;
  managementNos?: string[];
  matchTexts?: string[];
  invoiceOrdered?: number;
  invoiceShipped?: number;
  required: number;
  secured: number;
  waiting: number;
  unitPriceTotal: number;
  unitPriceCount: number;
  sellingPrice?: number | null;
  sellingPriceJpy?: number | null;
  sellingCurrency?: string | null;
}

type InvoiceProductSummary = {
  productName: string;
  orderQty: number;
  deliveredQty: number;
  sellingPrice?: number | null;
  sellingPriceJpy?: number | null;
  currency?: string | null;
};

type PurchaseRegistrationInvoice = {
  invoiceNo: string;
  partner: string;
  totalOrderQty: number;
  totalDeliveredQty: number;
  remainingQty: number;
};

type ProductDetailFilter = {
  productKey?: string;
  productTitle: string;
  mode: "stock" | "waiting";
};

interface AllocationGroup {
  key: string;
  label: string;
  partner: string;
  rows: PurchaseRow[];
  products: ProductSummary[];
  labels: LabelView[];
  required: number;
  secured: number;
  waiting: number;
  purchaseTotal: number;
  invoiceOrderQty?: number;
  invoiceDeliveredQty?: number;
  invoiceRemainingQty?: number;
}

const workflowTabs: Array<{ value: WorkflowTab; label: string; icon: typeof PackagePlus }> = [
  { value: "order", label: "発注登録", icon: PackagePlus },
  { value: "labels", label: "ラベル印刷", icon: Printer },
  { value: "scan", label: "入庫スキャン", icon: ScanLine },
  { value: "stock", label: "在庫一覧", icon: Boxes },
  { value: "shipping", label: "出庫", icon: Truck },
  { value: "returns", label: "返品", icon: RotateCcw },
];

const fieldClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]";

const OTHER_INVOICE_KEY = "invoice-other";
const INVENTORY_LABEL_GROUP_KEY = "inventory-stock-labels";
const EBAY_GROUP_KEY = "invoice-ebay";
const EBAY_GROUP_LABEL = "eBay";
type ShipmentSheetName = "独発送管理" | "サミー発送管理" | "デボン発送管理" | "サイモン発送管理" | "ネレ発送管理";
const SHIPMENT_SHEET_NAMES: ShipmentSheetName[] = ["独発送管理", "サミー発送管理", "デボン発送管理", "サイモン発送管理", "ネレ発送管理"];
const TRACKING_CARRIER_LABELS: Record<Carrier, string> = {
  yamato: "ヤマト運輸",
  sagawa: "佐川急便",
  japanpost: "日本郵便",
  amazon: "Amazon",
  seino: "西濃運輸",
  fukuyama: "福山通運",
  ecohai: "エコ配",
  unknown: "追跡",
};

const TRACKING_CARRIER_KEYS = new Set<Carrier>([
  "yamato",
  "sagawa",
  "japanpost",
  "amazon",
  "seino",
  "fukuyama",
  "ecohai",
  "unknown",
]);

const TRACKING_CARRIER_OPTIONS: Array<{ value: "auto" | Carrier; label: string }> = [
  { value: "auto", label: "自動判別" },
  { value: "japanpost", label: "日本郵便" },
  { value: "yamato", label: "ヤマト運輸" },
  { value: "sagawa", label: "佐川急便" },
  { value: "amazon", label: "Amazon" },
  { value: "seino", label: "西濃運輸" },
  { value: "ecohai", label: "エコ配" },
  { value: "fukuyama", label: "福山通運" },
];

function todayInputDate(): string {
  return new Date().toLocaleDateString("sv-SE");
}

function normalizedTrackingNumber(trackingNumber: string): string {
  return trackingNumber.trim().replace(/[\s-]/g, "");
}

function openEcohaiTracking(trackingNumber: string) {
  if (typeof document === "undefined") return;
  const num = normalizedTrackingNumber(trackingNumber);
  if (!num) return;
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
}

function normalizeCarrierKey(value: string | null | undefined, fallback: Carrier): Carrier {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "auto") return fallback;
  if (TRACKING_CARRIER_KEYS.has(normalized as Carrier)) return normalized as Carrier;
  if (value?.includes("ヤマト")) return "yamato";
  if (value?.includes("佐川")) return "sagawa";
  if (value?.includes("日本郵便") || value?.includes("郵便")) return "japanpost";
  if (value?.includes("西濃")) return "seino";
  if (value?.includes("福山")) return "fukuyama";
  if (value?.includes("エコ配")) return "ecohai";
  return fallback;
}

function getTrackingUrlForCarrier(carrier: Carrier, trackingNumber: string, fallbackUrl: string | null): string | null {
  const num = normalizedTrackingNumber(trackingNumber);
  if (!num) return null;
  switch (carrier) {
    case "yamato":
      return `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${num}`;
    case "sagawa":
      return `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${num}`;
    case "japanpost":
      return `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${num}&searchKind=S002&locale=ja`;
    case "amazon":
      return `https://www.amazon.co.jp/progress-tracker/package/ref=pe_tracking?_encoding=UTF8&from=gp&nodeId=&orderId=&packageIndex=0&shipmentId=${num}`;
    case "seino":
      return `https://track.seino.co.jp/cgi-bin/gnpquery.pgm?GNPNO1=${num}`;
    case "fukuyama":
      return "https://corp.fukutsu.co.jp/situation/tracking_no_input.html";
    case "ecohai":
      return null;
    default:
      return fallbackUrl;
  }
}

function getPurchaseTrackingMeta(trackingNumber: string, savedCarrier?: string | null) {
  const autoInfo = detectCarrier(trackingNumber);
  const carrier = normalizeCarrierKey(savedCarrier, autoInfo.carrier);
  return {
    carrier,
    carrierName: TRACKING_CARRIER_LABELS[carrier] ?? autoInfo.carrierName,
    trackingUrl: getTrackingUrlForCarrier(carrier, trackingNumber, autoInfo.trackingUrl),
    isEcohai: carrier === "ecohai",
    normalizedNumber: normalizedTrackingNumber(trackingNumber),
  };
}

function purchaseTrackingNumber(row: PurchaseRow): string {
  return row.extra?.trackingNumber?.trim() ?? "";
}

function hasPurchaseTracking(row: PurchaseRow): boolean {
  return purchaseTrackingNumber(row).length > 0;
}

function cleanLegacyManagementNo(value?: string | null): string {
  const firstPart = (value ?? "").split(",")[0]?.trim() ?? "";
  return firstPart.split(/\s+\/\s+/)[0]?.trim() ?? firstPart;
}

function buildEtcWithManagementNo(
  managementNo: string,
  currentEtc?: string | null,
  supplierName?: string | null,
): string {
  const parts = (currentEtc ?? "").split(",").map((part) => part.trim());
  const nextManagementNo = cleanLegacyManagementNo(managementNo);
  const datePart = parts[1] ?? "";
  const supplierPart = supplierName === undefined ? parts[2] ?? "" : (supplierName ?? "").trim();
  if (!nextManagementNo && !datePart && !supplierPart) return "";
  if (datePart || supplierPart) return [nextManagementNo, datePart, supplierPart].join(", ");
  return nextManagementNo;
}

function parseEtc(etc?: string | null): { managementNo: string; supplierSite: string } {
  if (!etc) return { managementNo: "", supplierSite: "" };
  const parts = etc.split(",").map((part) => part.trim());
  return {
    managementNo: cleanLegacyManagementNo(parts[0]),
    supplierSite: parts[2] ?? "",
  };
}

function getInventoryManagementNo(etc?: string | null): string {
  if (!etc) return "";
  const firstPart = cleanLegacyManagementNo(etc);
  return firstPart.split(/\s+/)[0]?.trim() ?? "";
}

function getInventoryCategory(inventory: InventoryItem): string {
  return (inventory.categories?.[0] ?? inventory.category ?? "").trim();
}

function toNumber(value: unknown): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function formatCurrency(value: unknown): string {
  const numberValue = toNumber(value);
  return `¥${numberValue.toLocaleString()}`;
}

function formatEuro(value: unknown): string {
  const numberValue = toNumber(value);
  if (numberValue <= 0) return "-";
  return `€${numberValue.toLocaleString()}`;
}

function formatTradePrice(value: unknown, currency?: string | null): string {
  const numberValue = toNumber(value);
  if (numberValue <= 0) return "-";
  const normalizedCurrency = (currency ?? "").toLowerCase();
  if (normalizedCurrency.includes("eur") || normalizedCurrency.includes("ユーロ")) {
    return `€${numberValue.toLocaleString()}`;
  }
  if (normalizedCurrency.includes("usd") || normalizedCurrency.includes("ドル")) {
    return `$${numberValue.toLocaleString()}`;
  }
  return numberValue.toLocaleString();
}

function normalizeCurrencyLabel(currency?: string | null): string {
  const normalizedCurrency = (currency ?? "").toLowerCase();
  if (normalizedCurrency.includes("eur") || normalizedCurrency.includes("ユーロ")) return "EUR";
  if (normalizedCurrency.includes("usd") || normalizedCurrency.includes("ドル")) return "USD";
  return currency?.trim() || "";
}

function buildForecastSummary(products: ProductSummary[], purchaseTotal: number) {
  let originalTotal = 0;
  let jpyTotal = 0;
  let currency: string | null = null;
  let hasOriginalPrice = false;
  let hasJpyPrice = false;
  let hasMixedCurrency = false;

  for (const product of products) {
    const quantity = Math.max(0, product.required);
    if (quantity <= 0) continue;

    const sellingPrice = toNumber(product.sellingPrice);
    const sellingPriceJpy = toNumber(product.sellingPriceJpy);
    if (sellingPrice > 0) {
      hasOriginalPrice = true;
      originalTotal += sellingPrice * quantity;
      const productCurrency = normalizeCurrencyLabel(product.sellingCurrency);
      if (!currency) {
        currency = productCurrency;
      } else if (productCurrency && productCurrency !== currency) {
        hasMixedCurrency = true;
      }
    }
    if (sellingPriceJpy > 0) {
      hasJpyPrice = true;
      jpyTotal += sellingPriceJpy * quantity;
    }
  }

  const roundedJpyTotal = Math.round(jpyTotal);
  const salesValue = hasOriginalPrice && !hasMixedCurrency
    ? formatTradePrice(Math.round(originalTotal), currency)
    : hasJpyPrice
      ? formatCurrency(roundedJpyTotal)
      : "-";
  const salesSub = hasJpyPrice && hasOriginalPrice && !hasMixedCurrency ? formatCurrency(roundedJpyTotal) : undefined;
  const grossProfit = hasJpyPrice ? Math.round(jpyTotal - purchaseTotal) : null;
  const grossProfitRate = hasJpyPrice && jpyTotal > 0 && grossProfit != null
    ? `${Math.round((grossProfit / jpyTotal) * 100)}%`
    : undefined;

  return {
    salesValue,
    salesSub,
    grossValue: grossProfit == null ? "-" : formatCurrency(grossProfit),
    grossSub: grossProfitRate,
  };
}

function formatDate(value?: string | null): string {
  if (!value) return "-";
  return value.slice(0, 10);
}

function itemQuantity(item: PurchaseItem): number {
  return toNumber(item.quantity);
}

function itemStockQuantity(item: PurchaseItem): number {
  return Math.max(0, toNumber(item.currentInventoryQuantity));
}

function sumQuantity(items: PurchaseItem[]): number {
  return items.reduce((total, item) => total + itemQuantity(item), 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function getItemLabels(items: PurchaseItem[]): InventoryItemLabel[] {
  return items.flatMap((item) => item.itemLabels ?? []).filter((label) => label.labelId);
}

function preferredManagementNo(currentManagementNo?: string | null, labelManagementNo?: string | null, fallback = "-"): string {
  return cleanLegacyManagementNo(currentManagementNo ?? "") || cleanLegacyManagementNo(labelManagementNo ?? "") || fallback;
}

function getManagementNos(items: PurchaseItem[]): string[] {
  return unique(
    items.flatMap((item) => {
      const parsed = parseEtc(item.etc);
      const labelNos = parsed.managementNo
        ? []
        : (item.itemLabels ?? []).map((label) => label.legacyManagementNo ?? "");
      return [parsed.managementNo, ...extractManagementHints(item.etc, parsed.managementNo, ...labelNos), ...labelNos]
        .map(cleanLegacyManagementNo);
    }),
  );
}

function parseInvoiceFromManagementNo(managementNo: string): { invoiceNo: string; partner: string } | null {
  const trimmed = managementNo.trim();
  const match = trimmed.match(/^(\d{3})(?:_([^_,\s]+))?/);
  if (!match || !trimmed.startsWith(`${match[1]}_`)) return null;
  return {
    invoiceNo: match[1],
    partner: match[2] ?? "",
  };
}

function isEbayManagementNo(managementNo: string | null | undefined): boolean {
  return /^ebay(?:[_-]|$)/i.test(cleanLegacyManagementNo(managementNo ?? ""));
}

function getInvoiceInfo(row: PurchaseRow): { key: string; invoiceNo: string; partner: string } {
  const managementNos = getManagementNos(row.purchase_items);
  for (const managementNo of managementNos) {
    const parsed = parseInvoiceFromManagementNo(managementNo);
    if (parsed) {
      return {
        key: `invoice-${parsed.invoiceNo}`,
        invoiceNo: parsed.invoiceNo,
        partner: parsed.partner,
      };
    }
  }
  if (managementNos.some(isEbayManagementNo)) {
    return {
      key: EBAY_GROUP_KEY,
      invoiceNo: EBAY_GROUP_LABEL,
      partner: EBAY_GROUP_LABEL,
    };
  }
  return {
    key: OTHER_INVOICE_KEY,
    invoiceNo: "在庫",
    partner: "",
  };
}

function getSupplier(row: PurchaseRow): SupplierView {
  const firstItem = row.purchase_items[0];
  const parsed = parseEtc(firstItem?.etc);
  return {
    name: row.csvSupplierName?.trim() || parsed.supplierSite || "-",
    url: row.csvSupplierUrl?.trim() || "",
  };
}

function isReceived(row: PurchaseRow): boolean {
  return row.status === "purchased" || row.purchase_items.some((item) => item.status === "purchased");
}

function matchesStatus(row: PurchaseRow, filter: StatusFilter): boolean {
  if (filter === "all") return true;
  if (filter === "missing_tracking") return !hasPurchaseTracking(row);
  const kind = purchaseRowStatusKind(row);
  if (filter === "received") return kind === "received" || kind === "partial_shipped" || kind === "shipped";
  return kind === "ordered" || kind === "inbound_shipped";
}

type PurchaseRowCounts = {
  all: number;
  ordered: number;
  received: number;
  missingTracking: number;
  quantity: number;
};

function countPurchaseRows(rows: PurchaseRow[]): PurchaseRowCounts {
  return rows.reduce(
    (acc, row) => {
      acc.all += 1;
      const statusKind = purchaseRowStatusKind(row);
      if (statusKind === "ordered" || statusKind === "inbound_shipped") acc.ordered += 1;
      else acc.received += 1;
      if (!hasPurchaseTracking(row)) acc.missingTracking += 1;
      acc.quantity += sumQuantity(row.purchase_items);
      return acc;
    },
    { all: 0, ordered: 0, received: 0, missingTracking: 0, quantity: 0 },
  );
}

function visiblePurchaseItems(row: PurchaseRow): PurchaseItem[] {
  const kind = purchaseRowStatusKind(row);
  if (kind === "ordered" || kind === "inbound_shipped" || kind === "partial_shipped" || kind === "shipped") return row.purchase_items;
  return row.purchase_items.filter((item) => itemStockQuantity(item) > 0);
}

function withVisiblePurchaseItems(row: PurchaseRow): PurchaseRow | null {
  const purchaseItems = visiblePurchaseItems(row);
  if (purchaseItems.length === 0) return null;
  return purchaseItems.length === row.purchase_items.length ? row : { ...row, purchase_items: purchaseItems };
}

const PURCHASE_REGISTRATION_CUTOFF_DATE = "2026-06-20";

function normalizePurchaseRegistrationDate(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null;
}

function isPurchaseRegistrationCutoffVisible(row: PurchaseRow): boolean {
  const filterDate =
    normalizePurchaseRegistrationDate(row.purchaseDate) ??
    normalizePurchaseRegistrationDate(row.purchase_date) ??
    normalizePurchaseRegistrationDate(row.created_at) ??
    normalizePurchaseRegistrationDate(row.createdAt);
  return filterDate == null || filterDate >= PURCHASE_REGISTRATION_CUTOFF_DATE;
}

function isPurchaseRegistrationRowComplete(row: PurchaseRow): boolean {
  return isInboundComplete(row.inboundClass ?? null, row.stage ?? "received");
}

function normalizePurchaseRegistrationRows(rows: PurchaseRow[]): PurchaseRow[] {
  return rows.flatMap((row) => {
    if (row.status === "purchased") return [];
    if (!isPurchaseRegistrationCutoffVisible(row)) return [];
    if (isPurchaseRegistrationRowComplete(row)) return [];
    const visibleRow = withVisiblePurchaseItems(row);
    return visibleRow ? [visibleRow] : [];
  });
}

function purchaseRegistrationOrderValue(row: PurchaseRow): number {
  const rawDate = row.createdAt ?? row.created_at ?? row.purchaseDate ?? row.purchase_date ?? null;
  const time = rawDate ? new Date(rawDate).getTime() : Number.NaN;
  return Number.isFinite(time) ? time : row.id;
}

function comparePurchaseRegistrationOrder(a: PurchaseRow, b: PurchaseRow): number {
  const byDate = purchaseRegistrationOrderValue(b) - purchaseRegistrationOrderValue(a);
  return byDate || b.id - a.id;
}

function productKey(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

function compactProductText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, "").toLowerCase();
}

function hasAnyProductText(value: string, keywords: string[]): boolean {
  const compact = compactProductText(value);
  return keywords.some((keyword) => compact.includes(compactProductText(keyword)));
}

const LIMITED_EDITION_PRODUCT_KEYWORDS: Array<[string, string[]]> = [
  ["monster-ball", ["モンスターボール", "monster ball", "monsterball"]],
  ["minecraft", ["マインクラフト", "minecraft"]],
  ["animal-crossing", ["どうぶつの森", "animal crossing", "animalcrossing"]],
  ["pikachu", ["ピカチュウ", "pikachu"]],
  ["pokemon", ["ポケモン", "pokemon"]],
  ["mario", ["マリオ", "mario"]],
  ["luigi", ["ルイージ", "luigi"]],
  ["zelda", ["ゼルダ", "ハイラル", "zelda", "hyrule"]],
  ["limited", ["限定版", "限定", "limited edition", "limited"]],
];

function limitedEditionProductKey(value: string): string | null {
  const compact = compactProductText(value);
  for (const [key, keywords] of LIMITED_EDITION_PRODUCT_KEYWORDS) {
    if (keywords.some((keyword) => compact.includes(compactProductText(keyword)))) return key;
  }
  return null;
}

function isRandomColorProductTitle(value: string): boolean {
  return hasAnyProductText(value, ["ランダムカラー", "random color", "randomcolor"]);
}

function limitedEditionKeysCompatible(a: string | null, b: string | null): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a === b || a === "limited" || b === "limited";
}

function canMatchTargetProduct(candidateText: string, targetTitle?: string): boolean {
  if (!targetTitle) return true;
  const targetLimitedKey = limitedEditionProductKey(targetTitle);
  const candidateLimitedKey = limitedEditionProductKey(candidateText);
  if (targetLimitedKey || candidateLimitedKey) return limitedEditionKeysCompatible(targetLimitedKey, candidateLimitedKey);
  if (isRandomColorProductTitle(targetTitle) && candidateLimitedKey) return false;
  return true;
}

function displayProductTitle(item: PurchaseItem): string {
  const title = item.title?.trim() || "-";
  const managementNo = parseEtc(item.etc).managementNo;
  const text = `${managementNo} ${title}`;

  if (hasAnyProductText(text, ["モンスターボール", "monster ball", "monsterball"])) {
    if (hasAnyProductText(text, ["new 2ds ll", "new2dsll", "new 2ds xl", "new2dsxl"])) {
      return "New 2DS LL モンスターボール";
    }
    return title;
  }

  if (hasAnyProductText(text, ["どうぶつの森", "animal crossing"])) {
    if (hasAnyProductText(text, ["new 3ds ll", "new3dsll", "new 3ds xl", "new3dsxl"])) return "New 3DS LL どうぶつの森";
    return "3DS LL どうぶつの森";
  }
  if (hasAnyProductText(text, ["new 2ds ll", "new2dsll", "new 2ds xl", "new2dsxl"])) return "New 2DS LL ランダムカラー";
  if (hasAnyProductText(text, ["new 3ds ll", "new3dsll", "new 3ds xl", "new3dsxl"])) return "New 3DS LL ランダムカラー";
  if (hasAnyProductText(text, ["new 3ds", "new3ds"])) return "New 3DS ランダムカラー";
  if (hasAnyProductText(text, ["3ds ll", "3dsll", "3ds xl", "3dsxl"])) return "3DS LL ランダムカラー";
  if (hasAnyProductText(text, ["2ds"])) return "2DS ランダムカラー";
  if (hasAnyProductText(text, ["3ds"])) return "3DS ランダムカラー";

  if (
    hasAnyProductText(text, [
      "ps vita 1000",
      "psvita1000",
      "vita 1000",
      "vita1000",
      "ps vita 1100",
      "psvita1100",
      "vita 1100",
      "vita1100",
    ])
  ) {
    return hasAnyProductText(text, ["ブラック", "黒", "black", "ピアノ", "クリスタルブラック", "crystal black"])
      ? "PS Vita 1000 ブラック"
      : "PS Vita 1000 レッド・ブルー・ホワイト";
  }
  if (hasAnyProductText(text, ["ps vita 2000", "psvita2000", "vita 2000", "vita2000"])) {
    return "PS Vita 2000 ランダムカラー";
  }
  if (hasAnyProductText(text, ["psp go", "pspgo"])) return "PSP Go";
  if (hasAnyProductText(text, ["psp 3000", "psp3000"])) {
    return hasAnyProductText(text, ["ブラック", "黒", "black", "ピアノ"])
      ? "PSP 3000 ブラック"
      : "PSP 3000 ランダムカラー";
  }
  if (hasAnyProductText(text, ["psp 2000", "psp2000"])) {
    return hasAnyProductText(text, ["ホワイト", "白", "white", "セラミック"])
      ? "PSP 2000 ホワイト"
      : "PSP 2000 ランダムカラー";
  }

  return title;
}

function actualProductTitle(item: PurchaseItem): string {
  return item.title?.trim() || displayProductTitle(item);
}

function invoiceAlignedProductTitle(
  item: PurchaseItem,
  invoiceProducts: InvoiceProductSummary[],
): string {
  const fallbackTitle = displayProductTitle(item);
  if (invoiceProducts.length === 0) return fallbackTitle;

  const candidates = invoiceProducts.map((product) => ({
    name: product.productName,
    qty: product.orderQty,
  }));
  const managementNo = parseEtc(item.etc).managementNo;
  const managementHints = extractManagementHints(item.etc, managementNo);
  const rawTitle = actualProductTitle(item);
  const matchText = unique([
    rawTitle,
    item.title?.trim() ?? "",
    item.etc?.trim() ?? "",
    managementNo,
    ...managementHints,
  ]).join(" ");
  const suggestedName =
    suggestInvoiceProductNameFromHints(rawTitle, [item.etc, managementNo, ...managementHints], candidates) ??
    suggestInvoiceProductName(matchText, managementHints.join(" "), candidates);

  return suggestedName && canMatchTargetProduct(matchText, suggestedName)
    ? suggestedName
    : fallbackTitle;
}

type CsvProductCandidate = { name: string; qty: number };

function suggestAnimalCrossingInvoiceProduct(
  title: string,
  managementNo: string,
  candidates: CsvProductCandidate[],
): string | null {
  const text = `${title} ${managementNo}`;
  if (!hasAnyProductText(text, ["どうぶつの森", "animal crossing"])) return null;

  const animalCrossingCandidates = candidates.filter((candidate) =>
    hasAnyProductText(candidate.name, ["どうぶつの森", "animal crossing"]),
  );
  if (animalCrossingCandidates.length === 0) return null;

  const model = extractPreferredModel(title, managementNo);
  if (model) {
    const sameModelCandidates = animalCrossingCandidates.filter((candidate) => extractModel(candidate.name) === model);
    if (sameModelCandidates.length === 1) return sameModelCandidates[0].name;
  }

  return animalCrossingCandidates.length === 1 ? animalCrossingCandidates[0].name : null;
}

function suggestInvoiceProductName(
  title: string,
  managementNo: string,
  candidates: CsvProductCandidate[],
): string | null {
  const animalCrossingSuggestion = suggestAnimalCrossingInvoiceProduct(title, managementNo, candidates);
  if (animalCrossingSuggestion) return animalCrossingSuggestion;

  const suggestion = suggestCsvProduct(title, managementNo, candidates);
  if (suggestion) return suggestion.name;

  const model = extractPreferredModel(title, managementNo);
  if (!model) return null;

  const sameModelCandidates = candidates.filter((candidate) => extractModel(candidate.name) === model);
  return sameModelCandidates.length === 1 ? sameModelCandidates[0].name : null;
}

function suggestInvoiceProductNameFromHints(
  title: string,
  managementHints: Array<string | null | undefined>,
  candidates: CsvProductCandidate[],
): string | null {
  const managementText = unique(extractManagementHints(...managementHints)).join(" ");
  const titleText = String(title ?? "").trim();

  return (
    (managementText ? suggestInvoiceProductName("", managementText, candidates) : null) ??
    (titleText ? suggestInvoiceProductName(titleText, managementText, candidates) : null)
  );
}

function purchaseItemMatchTexts(item: PurchaseItem): string[] {
  const managementNo = parseEtc(item.etc).managementNo;
  const managementHints = extractManagementHints(item.etc, managementNo);
  return unique([
    item.title?.trim() ?? "",
    item.etc?.trim() ?? "",
    managementNo,
    ...managementHints,
    displayProductTitle(item),
  ]);
}

function purchaseItemMatchesProduct(item: PurchaseItem, targetKey: string, targetTitle?: string): boolean {
  const title = displayProductTitle(item);
  const candidateText = purchaseItemMatchTexts(item).join(" ");
  if (!canMatchTargetProduct(candidateText, targetTitle)) return false;
  if (productKey(title) === targetKey) return true;
  if (!targetTitle) return false;
  const managementNo = parseEtc(item.etc).managementNo;
  const managementHints = extractManagementHints(item.etc, managementNo);
  if (
    suggestInvoiceProductNameFromHints("", managementHints, [{ name: targetTitle, qty: 1 }]) ===
    targetTitle
  ) {
    return true;
  }
  const rawTitle = item.title?.trim() || title;
  return (
    suggestInvoiceProductNameFromHints(rawTitle, managementHints, [{ name: targetTitle, qty: 1 }]) === targetTitle ||
    suggestInvoiceProductNameFromHints(title, managementHints, [{ name: targetTitle, qty: 1 }]) === targetTitle ||
    suggestInvoiceProductName(candidateText, managementHints.join(" "), [{ name: targetTitle, qty: 1 }]) === targetTitle
  );
}

function stockItemMatchesProduct(item: StockItemView, targetKey: string, targetTitle?: string): boolean {
  const managementHints = extractManagementHints(item.legacyManagementNo, item.allocationLabel);
  const matchText = unique([
    item.title,
    item.category,
    item.legacyManagementNo,
    item.allocationLabel,
    item.supplier.name,
    ...managementHints,
  ]).join(" ");

  if (!canMatchTargetProduct(matchText, targetTitle)) return false;
  if (productKey(item.title) === targetKey) return true;
  if (!targetTitle) return false;

  return (
    suggestInvoiceProductNameFromHints(item.title, managementHints, [{ name: targetTitle, qty: 1 }]) === targetTitle ||
    suggestInvoiceProductName(matchText, managementHints.join(" "), [{ name: targetTitle, qty: 1 }]) === targetTitle
  );
}

function filterRowsByProductDetail(rows: PurchaseRow[], filter: ProductDetailFilter | null): PurchaseRow[] {
  if (!filter) return rows;
  return rows.flatMap((row) => {
    const rowStatus = purchaseRowStatusKind(row);
    const purchaseItems = row.purchase_items.filter((item) => {
      if (filter.productKey && !purchaseItemMatchesProduct(item, filter.productKey, filter.productTitle)) return false;
      if (filter.mode === "stock") {
        return rowStatus !== "ordered" && rowStatus !== "inbound_shipped" && itemStockQuantity(item) > 0;
      }
      return rowStatus === "ordered" || rowStatus === "inbound_shipped";
    });
    return purchaseItems.length > 0 ? [{ ...row, purchase_items: purchaseItems }] : [];
  });
}

function filterStockItemsByProductDetail(items: StockItemView[], filter: ProductDetailFilter | null): StockItemView[] {
  if (!filter || filter.mode !== "stock") return [];
  if (!filter.productKey) return items;
  return items.filter((item) => stockItemMatchesProduct(item, filter.productKey ?? "", filter.productTitle));
}

function productDetailFilterLabel(filter: ProductDetailFilter): string {
  if (!filter.productKey) return filter.mode === "stock" ? "現在庫すべて" : "入庫まちすべて";
  return `${filter.productTitle} / ${filter.mode === "stock" ? "現在庫" : "入庫まち"}`;
}

function buildSearchText(row: PurchaseRow): string {
  const labels = getItemLabels(row.purchase_items).map((label) => label.labelId);
  const managementNos = getManagementNos(row.purchase_items);
  const supplier = getSupplier(row);
  return [
    row.num ?? "",
    supplier.name,
    supplier.url,
    ...labels,
    ...managementNos,
    ...row.purchase_items.flatMap((item) => [item.title, item.category ?? "", item.etc ?? ""]),
  ]
    .join("\n")
    .toLowerCase();
}

type PurchaseRowStatusKind = "ordered" | "inbound_shipped" | "received" | "partial_shipped" | "shipped";

function normalizedLabelStatus(status?: string | null): string {
  return (status ?? "").trim().toLowerCase();
}

function purchaseRowStatusKind(row: PurchaseRow): PurchaseRowStatusKind {
  const labels = getItemLabels(row.purchase_items);
  if (labels.length > 0) {
    const statuses = labels.map((label) => normalizedLabelStatus(label.status));
    const shippedCount = statuses.filter((status) => status === "shipped").length;
    if (shippedCount === labels.length) return "shipped";
    if (shippedCount > 0) return "partial_shipped";
    if (statuses.some((status) => status === "received" || status === "stocked")) return "received";
  }
  if (isReceived(row)) return "received";
  if (row.status === "shipped" || hasPurchaseTracking(row)) return "inbound_shipped";
  return "ordered";
}

function statusLabel(row: PurchaseRow): string {
  switch (purchaseRowStatusKind(row)) {
    case "inbound_shipped":
      return "発送済み / 入庫待ち";
    case "shipped":
      return "出庫済み";
    case "partial_shipped":
      return "一部出庫済み";
    case "received":
      return "入庫済み";
    case "ordered":
    default:
      return "発注済み";
  }
}

function statusClass(row: PurchaseRow): string {
  switch (purchaseRowStatusKind(row)) {
    case "inbound_shipped":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "shipped":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "partial_shipped":
      return "border-indigo-200 bg-indigo-50 text-indigo-700";
    case "received":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "ordered":
    default:
      return "border-amber-200 bg-amber-50 text-amber-700";
  }
}

function labelStatusLabel(status?: string | null): string {
  switch ((status ?? "").toLowerCase()) {
    case "received":
      return "入庫済み";
    case "stocked":
      return "在庫";
    case "shipped":
      return "出庫済み";
    case "returned":
      return "返品";
    case "cancelled":
      return "取消";
    case "ordered":
      return "発注済み";
    default:
      return status || "未入庫";
  }
}

function labelAllocationLabel(managementNo: string): string {
  const parsed = parseInvoiceFromManagementNo(managementNo);
  if (!parsed) return "一般在庫";
  const orderTitle = labelOrderTitleFromManagementNo(managementNo);
  return orderTitle ? `No.${parsed.invoiceNo}-${orderTitle}` : `No.${parsed.invoiceNo}`;
}

function labelOrderTitleFromManagementNo(managementNo: string): string {
  const normalized = managementNo.normalize("NFKC");
  const parts = normalized.split(/[_\s*]+/).filter(Boolean);
  const hint = parts.find((part, index) => index >= 2 && !/^\d+\s*\/\s*\d+$/.test(part));
  return hint ? formatLabelOrderTitle(hint) : "";
}

function formatLabelOrderTitle(value: string): string {
  const compact = compactProductText(value);
  if (compact.includes("ホワイトベース") || compact.includes("whitebase")) return "3DSLL White base";
  if (compact.includes("モンスターボール") || compact.includes("monsterball")) return "New2DSLL Monster Ball";
  if (compact.includes("new3dsll") || compact.includes("new3dsxl")) return "New3DSLL Random color";
  if (compact.includes("new3ds")) return "New3DS Random color";
  if (compact.includes("new2dsll") || compact.includes("new2dsxl")) return "New2DSLL Random color";
  if (compact.includes("3dsll") || compact.includes("3dsxl")) return "3DSLL Random color";
  if (compact.includes("2ds")) return "2DS Random color";
  if (compact.includes("3ds")) return "3DS Random color";
  if (
    compact.includes("psvita1000") ||
    compact.includes("psvita1100") ||
    compact.includes("vita1000") ||
    compact.includes("vita1100")
  ) {
    return "Vita1000 Random color";
  }
  if (compact.includes("psvita2000") || compact.includes("vita2000")) return "Vita2000 Random color";
  if (compact.includes("psp3000")) return "PSP3000 Random color";
  if (compact.includes("psp2000")) return "PSP2000 Random color";
  if (compact.includes("pspgo")) return "PSP Go";
  return value
    .replace(/ランダムカラー/g, "Random color")
    .replace(/ホワイトベース/g, "White base")
    .replace(/[＿_]+/g, " ")
    .trim();
}

function formatLabelPrintTitleLegacy(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/ランダムカラー/g, "Random color"],
    [/ホワイトベース/g, "White base"],
    [/限定版/g, "Limited edition"],
    [/ミント\s*[×xXＸｘ]\s*ホワイト/g, "Mint x White"],
    [/ホワイト\s*[×xXＸｘ]\s*ミント/g, "White x Mint"],
    [/パール\s*ホワイト/g, "Pearl White"],
    [/クリア\s*ブラック/g, "Clear Black"],
    [/クリア\s*ブルー/g, "Clear Blue"],
    [/クリア\s*レッド/g, "Clear Red"],
    [/コスモ\s*ブラック/g, "Cosmo Black"],
    [/メタリック\s*ブラック/g, "Metallic Black"],
    [/メタリック\s*ブルー/g, "Metallic Blue"],
    [/メタリック\s*レッド/g, "Metallic Red"],
    [/アクア\s*[・･]?\s*ブルー/g, "Aqua Blue"],
    [/サファイア\s*[・･]?\s*ブルー/g, "Sapphire Blue"],
    [/クリスタル\s*[・･]?\s*ブラック/g, "Crystal Black"],
    [/クリスタル\s*[・･]?\s*ホワイト/g, "Crystal White"],
    [/ピアノ\s*[・･]?\s*ブラック/g, "Piano Black"],
    [/セラミック\s*[・･]?\s*ホワイト/g, "Ceramic White"],
    [/ミスティ\s*ピンク/g, "Misty Pink"],
    [/コズミック\s*[・･]?\s*ブラック/g, "Cosmic Black"],
    [/コズミック\s*[・･]?\s*レッド/g, "Cosmic Red"],
    [/ライム\s*[・･]?\s*グリーン/g, "Lime Green"],
    [/グレイシャー\s*[・･]?\s*ホワイト/g, "Glacier White"],
    [/バイブラント\s*[・･]?\s*ブルー/g, "Vibrant Blue"],
    [/ラディアント\s*[・･]?\s*レッド/g, "Radiant Red"],
    [/コバルト\s*[・･]?\s*ブルー/g, "Cobalt Blue"],
    [/ライト\s*[・･]?\s*ブルー/g, "Light Blue"],
    [/レッド\s*[・･]\s*ブルー\s*[・･]\s*ホワイト/g, "Red, Blue, White"],
    [/ブルー\s*[・･]\s*ホワイト/g, "Blue, White"],
    [/レッド\s*[・･]\s*ホワイト/g, "Red, White"],
    [/レッド\s*[・･]\s*ブルー/g, "Red, Blue"],
    [/コズミック/g, "Cosmic"],
    [/クリスタル/g, "Crystal"],
    [/ライム/g, "Lime"],
    [/グレイシャー/g, "Glacier"],
    [/バイブラント/g, "Vibrant"],
    [/ラディアント/g, "Radiant"],
    [/コバルト/g, "Cobalt"],
    [/ライト\s*ブルー/g, "Light Blue"],
    [/ブラック/g, "Black"],
    [/ホワイト/g, "White"],
    [/ブルー/g, "Blue"],
    [/レッド/g, "Red"],
    [/グリーン/g, "Green"],
    [/イエロー/g, "Yellow"],
    [/オレンジ/g, "Orange"],
    [/シルバー/g, "Silver"],
    [/ゴールド/g, "Gold"],
    [/ラベンダー/g, "Lavender"],
    [/ミント/g, "Mint"],
  ];

  return replacements
    .reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value.trim())
    .replace(/\s*×\s*/g, " x ")
    .replace(/[＿_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const LABEL_TITLE_OVERRIDE_STORAGE_KEY = "purchase-registration-label-title-overrides";

type LabelTitleOverrideState = {
  byLabelId: Record<string, string>;
  byTitleKey: Record<string, string>;
};

function replaceAllText(value: string, search: string, replacement: string): string {
  return value.split(search).join(replacement);
}

function formatLabelPrintTitle(value: string): string {
  const legacyFormatted = formatLabelPrintTitleLegacy(value);
  const replacements: Array<[RegExp, string]> = [
    [/\u30e9\u30f3\u30c0\u30e0\u30ab\u30e9\u30fc/g, "Random color"],
    [/\u30db\u30ef\u30a4\u30c8\u30d9\u30fc\u30b9/g, "White base"],
    [/\u9650\u5b9a\u7248/g, "Limited edition"],
    [/\u3069\u3046\u3076\u3064\u306e\u68ee/g, "Animal Crossing"],
    [/\u30df\u30f3\u30c8\s*[\u00d7xX\uFF38\uFF58]\s*\u30db\u30ef\u30a4\u30c8/g, "Mint x White"],
    [/\u30db\u30ef\u30a4\u30c8\s*[\u00d7xX\uFF38\uFF58]\s*\u30df\u30f3\u30c8/g, "White x Mint"],
    [/\u30df\u30f3\u30c8\s*\u30db\u30ef\u30a4\u30c8/g, "Mint x White"],
    [/\u30db\u30ef\u30a4\u30c8\s*\u30df\u30f3\u30c8/g, "White x Mint"],
    [/\u30d1\u30fc\u30eb\s*\u30db\u30ef\u30a4\u30c8/g, "Pearl White"],
    [/\u30af\u30ea\u30a2\s*\u30d6\u30e9\u30c3\u30af/g, "Clear Black"],
    [/\u30af\u30ea\u30a2\s*\u30d6\u30eb\u30fc/g, "Clear Blue"],
    [/\u30af\u30ea\u30a2\s*\u30ec\u30c3\u30c9/g, "Clear Red"],
    [/\u30b3\u30b9\u30e2\s*\u30d6\u30e9\u30c3\u30af/g, "Cosmo Black"],
    [/\u30e1\u30bf\u30ea\u30c3\u30af\s*\u30d6\u30e9\u30c3\u30af/g, "Metallic Black"],
    [/\u30e1\u30bf\u30ea\u30c3\u30af\s*\u30d6\u30eb\u30fc/g, "Metallic Blue"],
    [/\u30e1\u30bf\u30ea\u30c3\u30af\s*\u30ec\u30c3\u30c9/g, "Metallic Red"],
    [/\u30a2\u30af\u30a2\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Aqua Blue"],
    [/\u30b5\u30d5\u30a1\u30a4\u30a2\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Sapphire Blue"],
    [/\u30af\u30ea\u30b9\u30bf\u30eb\s*[\u30fb\u00b7]?\s*\u30d6\u30e9\u30c3\u30af/g, "Crystal Black"],
    [/\u30af\u30ea\u30b9\u30bf\u30eb\s*[\u30fb\u00b7]?\s*\u30db\u30ef\u30a4\u30c8/g, "Crystal White"],
    [/\u30d4\u30a2\u30ce\s*[\u30fb\u00b7]?\s*\u30d6\u30e9\u30c3\u30af/g, "Piano Black"],
    [/\u30bb\u30e9\u30df\u30c3\u30af\s*[\u30fb\u00b7]?\s*\u30db\u30ef\u30a4\u30c8/g, "Ceramic White"],
    [/\u30df\u30b9\u30c6\u30a3\s*\u30d4\u30f3\u30af/g, "Misty Pink"],
    [/\u30b3\u30ba\u30df\u30c3\u30af\s*[\u30fb\u00b7]?\s*\u30d6\u30e9\u30c3\u30af/g, "Cosmic Black"],
    [/\u30b3\u30ba\u30df\u30c3\u30af\s*[\u30fb\u00b7]?\s*\u30ec\u30c3\u30c9/g, "Cosmic Red"],
    [/\u30e9\u30a4\u30e0\s*[\u30fb\u00b7]?\s*\u30b0\u30ea\u30fc\u30f3/g, "Lime Green"],
    [/\u30b0\u30ec\u30a4\u30b7\u30e3\u30fc\s*[\u30fb\u00b7]?\s*\u30db\u30ef\u30a4\u30c8/g, "Glacier White"],
    [/\u30d0\u30a4\u30d6\u30e9\u30f3\u30c8\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Vibrant Blue"],
    [/\u30e9\u30c7\u30a3\u30a2\u30f3\u30c8\s*\u30ec\u30c3\u30c9/g, "Radiant Red"],
    [/\u30b3\u30d0\u30eb\u30c8\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Cobalt Blue"],
    [/\u30e9\u30a4\u30c8\s*[\u30fb\u00b7]?\s*\u30d6\u30eb\u30fc/g, "Light Blue"],
    [/\u30ec\u30c3\u30c9\s*[\u30fb\u00b7]\s*\u30d6\u30eb\u30fc\s*[\u30fb\u00b7]\s*\u30db\u30ef\u30a4\u30c8/g, "Red, Blue, White"],
    [/\u30d6\u30eb\u30fc\s*[\u30fb\u00b7]\s*\u30db\u30ef\u30a4\u30c8/g, "Blue, White"],
    [/\u30ec\u30c3\u30c9\s*[\u30fb\u00b7]\s*\u30db\u30ef\u30a4\u30c8/g, "Red, White"],
    [/\u30ec\u30c3\u30c9\s*[\u30fb\u00b7]\s*\u30d6\u30eb\u30fc/g, "Red, Blue"],
    [/\u30b3\u30ba\u30df\u30c3\u30af/g, "Cosmic"],
    [/\u30af\u30ea\u30b9\u30bf\u30eb/g, "Crystal"],
    [/\u30e9\u30a4\u30e0/g, "Lime"],
    [/\u30b0\u30ec\u30a4\u30b7\u30e3\u30fc/g, "Glacier"],
    [/\u30d0\u30a4\u30d6\u30e9\u30f3\u30c8/g, "Vibrant"],
    [/\u30e9\u30c7\u30a3\u30a2\u30f3\u30c8/g, "Radiant"],
    [/\u30b3\u30d0\u30eb\u30c8/g, "Cobalt"],
    [/\u30e9\u30a4\u30c8\s*\u30d6\u30eb\u30fc/g, "Light Blue"],
    [/\u30d6\u30e9\u30c3\u30af/g, "Black"],
    [/\u30db\u30ef\u30a4\u30c8/g, "White"],
    [/\u30d6\u30eb\u30fc/g, "Blue"],
    [/\u30ec\u30c3\u30c9/g, "Red"],
    [/\u30b0\u30ea\u30fc\u30f3/g, "Green"],
    [/\u30a4\u30a8\u30ed\u30fc/g, "Yellow"],
    [/\u30aa\u30ec\u30f3\u30b8/g, "Orange"],
    [/\u30b7\u30eb\u30d0\u30fc/g, "Silver"],
    [/\u30b4\u30fc\u30eb\u30c9/g, "Gold"],
    [/\u30e9\u30d9\u30f3\u30c0\u30fc/g, "Lavender"],
    [/\u30df\u30f3\u30c8/g, "Mint"],
  ];

  let formatted = replacements.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    legacyFormatted || value.trim(),
  );
  formatted = replaceAllText(formatted, "\u00d7", " x ");
  formatted = replaceAllText(formatted, "\uFF38", " x ");
  formatted = replaceAllText(formatted, "\uFF58", " x ");
  formatted = formatted
    .replace(/[・･_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return formatted || legacyFormatted;
}

function emptyLabelTitleOverrides(): LabelTitleOverrideState {
  return { byLabelId: {}, byTitleKey: {} };
}

function sanitizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, text]) => [key, text]),
  );
}

function normalizeLabelTitleKey(value: string): string {
  return compactProductText(value).replace(/\s+/g, "");
}

function loadLabelTitleOverrides(): LabelTitleOverrideState {
  if (typeof window === "undefined") return emptyLabelTitleOverrides();
  try {
    const raw = window.localStorage.getItem(LABEL_TITLE_OVERRIDE_STORAGE_KEY);
    if (!raw) return emptyLabelTitleOverrides();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyLabelTitleOverrides();
    if ("byLabelId" in parsed || "byTitleKey" in parsed) {
      return {
        byLabelId: sanitizeStringRecord((parsed as Partial<LabelTitleOverrideState>).byLabelId),
        byTitleKey: sanitizeStringRecord((parsed as Partial<LabelTitleOverrideState>).byTitleKey),
      };
    }
    return { byLabelId: sanitizeStringRecord(parsed), byTitleKey: {} };
  } catch {
    return emptyLabelTitleOverrides();
  }
}

function labelBadgeClass(status?: string | null): string {
  switch (normalizedLabelStatus(status)) {
    case "shipped":
      return "border-blue-200 bg-blue-50 text-blue-800";
    case "received":
    case "stocked":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "ordered":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "returned":
      return "border-purple-200 bg-purple-50 text-purple-800";
    case "cancelled":
      return "border-rose-200 bg-rose-50 text-rose-800";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function saveLabelTitleOverrides(overrides: LabelTitleOverrideState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LABEL_TITLE_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Local storage can be unavailable in private modes; printing still works with generated titles.
  }
}

function applyLabelTitleOverride(label: LabelView, overrides: LabelTitleOverrideState): LabelView {
  const rawTitle = label.title || label.printTitle;
  const titleKey = normalizeLabelTitleKey(rawTitle);
  const override = overrides.byLabelId[label.labelId]?.trim() || overrides.byTitleKey[titleKey]?.trim();
  const autoTitle = formatLabelPrintTitle(rawTitle);
  return {
    ...label,
    printTitle: override ? formatLabelPrintTitle(override) : autoTitle,
  };
}

const LABELS_PER_SHEET = 24;
const LABEL_START_POSITION_STORAGE_KEY = "purchase-registration-label-start-position";

function clampLabelStartPosition(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), LABELS_PER_SHEET);
}

function loadLabelStartPosition(): number {
  if (typeof window === "undefined") return 1;
  return clampLabelStartPosition(Number(window.localStorage.getItem(LABEL_START_POSITION_STORAGE_KEY)) || 1);
}

function saveLabelStartPosition(value: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LABEL_START_POSITION_STORAGE_KEY, String(clampLabelStartPosition(value)));
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

/** 開始位置から count 枚刷ったあとに、次に空いている面の番号。 */
function nextLabelStartPosition(startPosition: number, count: number): number {
  return ((clampLabelStartPosition(startPosition) - 1 + count) % LABELS_PER_SHEET) + 1;
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildLabelViews(rows: PurchaseRow[]): LabelView[] {
  return rows.flatMap((row) => {
    const supplier = getSupplier(row);
    return row.purchase_items.flatMap((item) => {
      const managementNo = parseEtc(item.etc).managementNo;
      const title = actualProductTitle(item);
      return (item.itemLabels ?? []).map((label) => {
        const legacyManagementNo = preferredManagementNo(managementNo, label.legacyManagementNo);
        return {
          key: `${row.id}-${item.id}-${label.id ?? label.labelId}`,
          labelId: label.labelId,
          rawStatus: label.status ?? "",
          status: labelStatusLabel(label.status),
          title,
          printTitle: formatLabelPrintTitle(title),
          category: (item.category ?? "").trim() || stockModelName(title),
          legacyManagementNo,
          allocationLabel: labelAllocationLabel(legacyManagementNo),
          unitPrice: toNumber(item.unit_price),
          supplier,
          purchaseDate: row.purchase_date ?? item.estimated_purchase_date ?? "",
          rowId: row.id,
          itemId: item.id,
          inventoryId: label.localInventoryId ?? item.inventory_id ?? null,
          trackingNumber: row.extra?.trackingNumber ?? null,
          carrier: row.extra?.carrier ?? null,
        };
      });
    });
  });
}

function isInventoryPrintableLabel(label: InventoryItemLabel): boolean {
  if (!label.labelId?.trim()) return false;
  const status = (label.status ?? "").trim().toLowerCase();
  return !status || status === "stocked" || status === "received";
}

function buildInventoryLabelViews(inventories: InventoryItem[]): LabelView[] {
  return inventories.flatMap((inventory) => {
    const stockQuantity = Math.max(0, Math.floor(toNumber(inventory.quantity)));
    if (stockQuantity <= 0) return [];
    const title = inventory.title;
    const managementNo = getInventoryManagementNo(inventory.etc) || "-";
    const supplier = {
      name: inventory.supplierName?.trim() || "-",
      url: inventory.supplierUrl?.trim() || "",
    };
    return (inventory.itemLabels ?? [])
      .filter(isInventoryPrintableLabel)
      .slice(0, stockQuantity)
      .map((label) => {
        const legacyManagementNo = preferredManagementNo(managementNo, label.legacyManagementNo);
        return {
          key: `inventory-${inventory.id}-${label.id ?? label.labelId}`,
          labelId: label.labelId,
          rawStatus: label.status || "stocked",
          status: labelStatusLabel(label.status || "stocked"),
          title,
          printTitle: formatLabelPrintTitle(title),
          category: getInventoryCategory(inventory) || stockModelName(title),
          legacyManagementNo,
          allocationLabel: "",
          unitPrice: toNumber(inventory.purchase_unit_price ?? inventory.unit_price),
          supplier,
          purchaseDate: inventory.last_purchase_date ?? inventory.updated_at ?? "",
          rowId: -inventory.id,
          itemId: -inventory.id,
          inventoryId: inventory.id,
          trackingNumber: null,
          carrier: null,
        };
      });
  });
}

function buildClosedInvoiceInventoryLabelViews(
  rows: PurchaseRow[],
  invoiceSummaries?: PurchaseRegistrationInvoice[],
): LabelView[] {
  if (invoiceSummaries === undefined) return [];
  const openInvoiceKeys = new Set(invoiceSummaries.map((summary) => `invoice-${summary.invoiceNo}`));
  return rows.flatMap((row) => {
    const invoiceInfo = getInvoiceInfo(row);
    if (invoiceInfo.key === OTHER_INVOICE_KEY || invoiceInfo.key === EBAY_GROUP_KEY) return [];
    if (openInvoiceKeys.has(invoiceInfo.key)) return [];

    const supplier = getSupplier(row);
    return row.purchase_items.flatMap((item) => {
      const stockQuantity = Math.max(0, Math.floor(itemStockQuantity(item)));
      if (stockQuantity <= 0) return [];
      const title = actualProductTitle(item);
      const managementNo = parseEtc(item.etc).managementNo;
      return (item.itemLabels ?? [])
        .filter(isInventoryPrintableLabel)
        .slice(0, stockQuantity)
        .map((label) => {
          const legacyManagementNo = preferredManagementNo(managementNo, label.legacyManagementNo);
          return {
            key: `closed-invoice-stock-${row.id}-${item.id}-${label.id ?? label.labelId}`,
            labelId: label.labelId,
            rawStatus: label.status || "stocked",
            status: labelStatusLabel(label.status || "stocked"),
            title,
            printTitle: formatLabelPrintTitle(title),
            category: (item.category ?? "").trim() || stockModelName(title),
            legacyManagementNo,
            allocationLabel: "",
            unitPrice: toNumber(item.unit_price),
            supplier,
            purchaseDate: row.purchase_date ?? item.estimated_purchase_date ?? "",
            rowId: row.id,
            itemId: item.id,
            inventoryId: label.localInventoryId ?? item.inventory_id ?? null,
            trackingNumber: row.extra?.trackingNumber ?? null,
            carrier: row.extra?.carrier ?? null,
          };
        });
    });
  });
}

function initQrTables(): { exp: number[]; log: number[] } {
  const exp = Array<number>(512).fill(0);
  const log = Array<number>(256).fill(0);
  let value = 1;
  for (let index = 0; index < 255; index++) {
    exp[index] = value;
    log[value] = index;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let index = 255; index < 512; index++) exp[index] = exp[index - 255];
  return { exp, log };
}

const QR_TABLES = initQrTables();

function qrMultiply(left: number, right: number): number {
  if (left === 0 || right === 0) return 0;
  return QR_TABLES.exp[QR_TABLES.log[left] + QR_TABLES.log[right]];
}

function qrGeneratorPolynomial(degree: number): number[] {
  let poly = [1];
  for (let index = 0; index < degree; index++) {
    const next = Array<number>(poly.length + 1).fill(0);
    for (let polyIndex = 0; polyIndex < poly.length; polyIndex++) {
      next[polyIndex] ^= poly[polyIndex];
      next[polyIndex + 1] ^= qrMultiply(poly[polyIndex], QR_TABLES.exp[index]);
    }
    poly = next;
  }
  return poly;
}

function qrEncodeBytes(value: string): number[] {
  const bytes = Array.from(value.trim().toUpperCase()).map((char) => char.charCodeAt(0) & 0xff);
  const bits: number[] = [];
  const pushBits = (data: number, length: number) => {
    for (let bit = length - 1; bit >= 0; bit--) bits.push((data >> bit) & 1);
  };

  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  bytes.forEach((byte) => pushBits(byte, 8));

  const capacityBits = 19 * 8;
  const terminatorLength = Math.min(4, capacityBits - bits.length);
  for (let index = 0; index < terminatorLength; index++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const dataCodewords: number[] = [];
  for (let index = 0; index < bits.length; index += 8) {
    dataCodewords.push(bits.slice(index, index + 8).reduce((sum, bit) => (sum << 1) | bit, 0));
  }
  const pads = [0xec, 0x11];
  let padIndex = 0;
  while (dataCodewords.length < 19) {
    dataCodewords.push(pads[padIndex % pads.length]);
    padIndex++;
  }

  const generator = qrGeneratorPolynomial(7);
  const ecc = Array<number>(7).fill(0);
  dataCodewords.forEach((codeword) => {
    const factor = codeword ^ ecc[0];
    ecc.shift();
    ecc.push(0);
    for (let index = 0; index < ecc.length; index++) {
      ecc[index] ^= qrMultiply(generator[index + 1], factor);
    }
  });

  return [...dataCodewords, ...ecc];
}

function createQrMatrix(value: string): boolean[][] {
  const size = 21;
  const matrix = Array.from({ length: size }, () => Array<boolean | null>(size).fill(null));
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const setModule = (x: number, y: number, dark: boolean, reserve = true) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    matrix[y][x] = dark;
    if (reserve) reserved[y][x] = true;
  };
  const drawFinder = (x: number, y: number) => {
    for (let dy = -1; dy <= 7; dy++) {
      for (let dx = -1; dx <= 7; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        const inPattern = dx >= 0 && dx <= 6 && dy >= 0 && dy <= 6;
        const dark =
          inPattern &&
          (dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4));
        setModule(xx, yy, dark);
      }
    }
  };

  drawFinder(0, 0);
  drawFinder(size - 7, 0);
  drawFinder(0, size - 7);
  for (let index = 8; index < size - 8; index++) {
    setModule(index, 6, index % 2 === 0);
    setModule(6, index, index % 2 === 0);
  }
  setModule(8, 13, true);

  const formatBits = "111011111000100";
  const formatCoords1 = [
    [8, 0],
    [8, 1],
    [8, 2],
    [8, 3],
    [8, 4],
    [8, 5],
    [8, 7],
    [8, 8],
    [7, 8],
    [5, 8],
    [4, 8],
    [3, 8],
    [2, 8],
    [1, 8],
    [0, 8],
  ];
  const formatCoords2 = [
    [8, 20],
    [8, 19],
    [8, 18],
    [8, 17],
    [8, 16],
    [8, 15],
    [8, 14],
    [13, 8],
    [14, 8],
    [15, 8],
    [16, 8],
    [17, 8],
    [18, 8],
    [19, 8],
    [20, 8],
  ];
  [...formatCoords1, ...formatCoords2].forEach(([x, y]) => {
    reserved[y][x] = true;
  });

  const codewords = qrEncodeBytes(value || "-");
  const dataBits = codewords.flatMap((codeword) =>
    Array.from({ length: 8 }, (_, index) => (codeword >> (7 - index)) & 1),
  );
  let bitIndex = 0;
  let upward = true;
  for (let x = size - 1; x > 0; x -= 2) {
    if (x === 6) x--;
    for (let row = 0; row < size; row++) {
      const y = upward ? size - 1 - row : row;
      for (let dx = 0; dx < 2; dx++) {
        const xx = x - dx;
        if (reserved[y][xx]) continue;
        const rawBit = bitIndex < dataBits.length ? dataBits[bitIndex] === 1 : false;
        bitIndex++;
        setModule(xx, y, rawBit !== ((xx + y) % 2 === 0), false);
      }
    }
    upward = !upward;
  }

  formatCoords1.forEach(([x, y], index) => setModule(x, y, formatBits[index] === "1"));
  formatCoords2.forEach(([x, y], index) => setModule(x, y, formatBits[index] === "1"));

  return matrix.map((row) => row.map(Boolean));
}

const QR_QUIET_ZONE = 2;

/**
 * 暗モジュールを1本のパスにまとめる。
 * モジュールごとに<rect>を出すとQR1枚で約200要素になり、ラベル印刷のように数百枚を
 * 並べる画面でブラウザが固まる（2026-08-15 本番で実測）。見た目は変えない。
 */
function buildQrPath(matrix: boolean[][]): string {
  let path = "";
  for (let y = 0; y < matrix.length; y += 1) {
    const row = matrix[y];
    for (let x = 0; x < row.length; x += 1) {
      if (row[x]) path += `M${x + QR_QUIET_ZONE} ${y + QR_QUIET_ZONE}h1v1h-1z`;
    }
  }
  return path;
}

function ProductQrCode({ value }: { value: string }) {
  const matrix = useMemo(() => createQrMatrix(value), [value]);
  const path = useMemo(() => buildQrPath(matrix), [matrix]);
  const size = matrix.length + QR_QUIET_ZONE * 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR ${value}`} className="h-full w-full bg-white">
      <rect width={size} height={size} fill="white" />
      {path ? <path d={path} fill="#0f172a" shapeRendering="crispEdges" /> : null}
    </svg>
  );
}

function stockModelName(title: string): string {
  const compact = compactProductText(title);
  const normalized = title.normalize("NFKC").toLowerCase();
  if (compact.includes("new3dsll") || compact.includes("new3dsxl")) return "New 3DS LL";
  if (compact.includes("new3ds")) return "New 3DS";
  if (compact.includes("new2dsll") || compact.includes("new2dsxl")) return "New 2DS LL";
  if (compact.includes("3dsll") || compact.includes("3dsxl")) return "3DS LL";
  if (compact.includes("2ds")) return "2DS";
  if (compact.includes("3ds")) return "3DS";
  if (compact.includes("dslite") || compact.includes("dsl")) return "DSLite";
  if (
    compact.includes("ゲームボーイプレーヤー") ||
    compact.includes("ゲームボーイプレイヤー") ||
    compact.includes("gameboyplayer")
  ) return "GC";
  if (compact.includes("gba") || compact.includes("gameboyadvance") || compact.includes("ゲームボーイアドバンス")) return "GBA";
  if (compact.includes("vita2000") || compact.includes("psvita2000")) return "PS Vita 2000";
  if (
    compact.includes("vita1000") ||
    compact.includes("psvita1000") ||
    compact.includes("vita1100") ||
    compact.includes("psvita1100")
  ) return "PS Vita 1000";
  if (compact.includes("psp3000")) return "PSP 3000";
  if (compact.includes("psp2000")) return "PSP 2000";
  if (compact.includes("psp1000")) return "PSP 1000";
  if (
    compact.includes("callaway") ||
    compact.includes("taylormade") ||
    compact.includes("キャロウェイ") ||
    compact.includes("テーラーメイド") ||
    /(^|[\s　])ping(?=($|[\s　a-z0-9]))/u.test(normalized) ||
    /(^|[\s　])ピン(?=($|[\s　a-z0-9]))/u.test(normalized)
  ) {
    return "ゴルフ";
  }
  if (compact.includes("switch") || compact.includes("スイッチ")) return "Switch";
  if (compact.includes("shaft") || compact.includes("シャフト")) return "シャフト";
  return "その他";
}

const STOCK_MODEL_ORDER = [
  "New 3DS LL",
  "New 3DS",
  "New 2DS LL",
  "3DS LL",
  "3DS",
  "2DS",
  "DSLite",
  "GBA",
  "GC",
  "PS Vita 2000",
  "PS Vita 1000",
  "PSP 3000",
  "PSP 2000",
  "PSP 1000",
  "Switch",
  "ゴルフ",
  "シャフト",
  "その他",
];

function buildStockItemViewsFromInventories(inventories: InventoryItem[]): StockItemView[] {
  return inventories.flatMap((inventory) => {
    const stockQuantity = Math.max(0, Math.floor(toNumber(inventory.quantity)));
    if (stockQuantity <= 0) return [];

    const managementNo = getInventoryManagementNo(inventory.etc) || "-";
    const category = getInventoryCategory(inventory);
    const supplier = {
      name: inventory.supplierName?.trim() || "-",
      url: inventory.supplierUrl?.trim() || "",
    };
    const unitPrice = toNumber(inventory.purchase_unit_price ?? inventory.unit_price);
    const purchaseDate = inventory.last_purchase_date ?? inventory.updated_at ?? "";
    const labels = (inventory.itemLabels ?? [])
      .filter((label) => {
        if (!label.labelId?.trim()) return false;
        const status = (label.status ?? "").trim().toLowerCase();
        return !status || status === "stocked" || status === "received";
      })
      .slice(0, stockQuantity)
      .map((label) => {
        const legacyManagementNo = preferredManagementNo(managementNo, label.legacyManagementNo);
        return {
          key: `inventory-label-${inventory.id}-${label.id ?? label.labelId}`,
          labelId: label.labelId,
          inventoryId: inventory.id,
          status: labelStatusLabel(label.status || "stocked"),
          title: inventory.title,
          category,
          legacyManagementNo,
          allocationLabel: labelAllocationLabel(legacyManagementNo),
          unitPrice,
          quantity: 1,
          supplier,
          purchaseDate,
        };
      });

    const missingLabelQuantity = Math.max(0, stockQuantity - labels.length);
    if (missingLabelQuantity <= 0) return labels;

    return [
      ...labels,
      {
        key: `inventory-unlabeled-${inventory.id}`,
        inventoryId: inventory.id,
        labelId: null,
        status: "\u5728\u5eab",
        title: inventory.title,
        category,
        legacyManagementNo: managementNo,
        allocationLabel: labelAllocationLabel(managementNo),
        unitPrice,
        quantity: missingLabelQuantity,
        supplier,
        purchaseDate,
      },
    ];
  });
}

function buildStockItemGroups(items: StockItemView[]): { name: string; items: StockItemView[]; quantity: number }[] {
  const map = new Map<string, StockItemView[]>();
  for (const item of items) {
    const name = item.category || stockModelName(item.title);
    const current = map.get(name) ?? [];
    current.push(item);
    map.set(name, current);
  }
  return Array.from(map.entries())
    .map(([name, groupItems]) => ({
      name,
      items: groupItems.sort((a, b) => {
        const titleCompare = a.title.localeCompare(b.title, "ja", { numeric: true });
        if (titleCompare !== 0) return titleCompare;
        return a.legacyManagementNo.localeCompare(b.legacyManagementNo, "ja", { numeric: true });
      }),
      quantity: groupItems.reduce((total, item) => total + item.quantity, 0),
    }))
    .sort((a, b) => {
      const orderA = STOCK_MODEL_ORDER.indexOf(a.name);
      const orderB = STOCK_MODEL_ORDER.indexOf(b.name);
      const normalizedA = orderA === -1 ? STOCK_MODEL_ORDER.length : orderA;
      const normalizedB = orderB === -1 ? STOCK_MODEL_ORDER.length : orderB;
      if (normalizedA !== normalizedB) return normalizedA - normalizedB;
      return a.name.localeCompare(b.name, "ja", { numeric: true });
    });
}

function normalizeStockProposalTitle(title: string): string {
  return title.replace(/^登録漏れ\s*/u, "").replace(/\s+/g, " ").trim() || "-";
}

function stockProposalModelName(title: string, category?: string | null): string {
  const fromTitle = stockModelName(title);
  if (fromTitle !== "その他") return fromTitle;
  const fromCategory = stockModelName(category ?? "");
  return fromCategory !== "その他" ? fromCategory : "その他";
}

const STOCK_PROPOSAL_EXCLUDED_MANAGEMENT_PREFIXES = ["403_ネレ"];
const STOCK_PROPOSAL_ACCESSORY_KEYWORDS = [
  "ケーブル",
  "バッテリー",
  "タッチペン",
  "充電器",
  "充電ケーブル",
  "acアダプタ",
  "acアダプター",
  "アダプタ",
  "アダプター",
  "電源",
  "ケース",
  "ポーチ",
  "カバー",
  "メモリーカード",
  "メモリースティック",
  "sdカード",
];

function isExcludedStockProposalManagementNo(managementNo?: string | null): boolean {
  const normalized = (managementNo ?? "").trim();
  return STOCK_PROPOSAL_EXCLUDED_MANAGEMENT_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function isUnfinishedInvoiceManagementNo(managementNo: string | null | undefined, unfinishedInvoiceNos: Set<string>): boolean {
  const parsed = parseInvoiceFromManagementNo(cleanLegacyManagementNo(managementNo ?? ""));
  return parsed ? unfinishedInvoiceNos.has(parsed.invoiceNo) : false;
}

function isStockProposalAccessory(title: string, category?: string | null): boolean {
  const text = `${title} ${category ?? ""}`;
  return hasAnyProductText(text, STOCK_PROPOSAL_ACCESSORY_KEYWORDS);
}

function isStockWaitingPurchaseRow(row: PurchaseRow, unfinishedInvoiceNos: Set<string>): boolean {
  const kind = purchaseRowStatusKind(row);
  if (kind !== "ordered" && kind !== "inbound_shipped") return false;
  return getManagementNos(row.purchase_items).some((managementNo) => {
    const normalized = managementNo.trim();
    if (isUnfinishedInvoiceManagementNo(normalized, unfinishedInvoiceNos)) return false;
    return normalized.startsWith("在庫") && !isExcludedStockProposalManagementNo(normalized);
  });
}

function addStockProposalPrice(product: StockProposalProduct, unitPrice: number, quantity: number) {
  if (unitPrice <= 0 || quantity <= 0) return;
  product.unitPriceTotal += unitPrice * quantity;
  product.unitPriceQuantity += quantity;
  product.minUnitPrice = product.minUnitPrice == null ? unitPrice : Math.min(product.minUnitPrice, unitPrice);
  product.maxUnitPrice = product.maxUnitPrice == null ? unitPrice : Math.max(product.maxUnitPrice, unitPrice);
}

function appendStockProposalDetail(product: StockProposalProduct, detail: StockProposalDetail) {
  product.details.push(detail);
  product.searchText = [
    product.searchText,
    detail.managementNo,
    detail.labelId ?? "",
    detail.supplier.name,
    detail.status,
  ]
    .join("\n")
    .toLowerCase();
}

function getOrCreateStockProposalProduct(
  map: Map<string, StockProposalProduct>,
  title: string,
  model: string,
): StockProposalProduct {
  const normalizedTitle = normalizeStockProposalTitle(title);
  const key = `${model}::${productKey(normalizedTitle)}`;
  const current = map.get(key);
  if (current) return current;
  const created: StockProposalProduct = {
    key,
    title: normalizedTitle,
    model,
    stockQuantity: 0,
    waitingQuantity: 0,
    totalQuantity: 0,
    unitPriceTotal: 0,
    unitPriceQuantity: 0,
    minUnitPrice: null,
    maxUnitPrice: null,
    details: [],
    searchText: [model, normalizedTitle].join("\n").toLowerCase(),
  };
  map.set(key, created);
  return created;
}

function buildStockProposalGroups(
  stockItems: StockItemView[],
  purchaseRows: PurchaseRow[],
  searchText: string,
  unfinishedInvoices: PurchaseRegistrationInvoice[] = [],
): StockProposalGroup[] {
  const productMap = new Map<string, StockProposalProduct>();
  const unfinishedInvoiceNos = new Set(unfinishedInvoices.map((invoice) => invoice.invoiceNo.trim()).filter(Boolean));

  for (const item of stockItems) {
    if (isUnfinishedInvoiceManagementNo(item.legacyManagementNo, unfinishedInvoiceNos)) continue;
    if (isExcludedStockProposalManagementNo(item.legacyManagementNo)) continue;
    if (isStockProposalAccessory(item.title, item.category)) continue;
    const model = stockProposalModelName(item.title, item.category);
    const product = getOrCreateStockProposalProduct(productMap, item.title, model);
    product.stockQuantity += item.quantity;
    product.totalQuantity += item.quantity;
    addStockProposalPrice(product, item.unitPrice, item.quantity);
    appendStockProposalDetail(product, {
      source: "stock",
      managementNo: item.legacyManagementNo,
      labelId: item.labelId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      status: item.status,
      supplier: item.supplier,
      date: item.purchaseDate,
    });
  }

  for (const row of purchaseRows) {
    if (!isStockWaitingPurchaseRow(row, unfinishedInvoiceNos)) continue;
    const supplier = getSupplier(row);
    const rowStatus = statusLabel(row);
    for (const item of row.purchase_items) {
      const quantity = itemQuantity(item);
      if (quantity <= 0) continue;
      const managementNo = parseEtc(item.etc).managementNo || getManagementNos([item])[0] || getManagementNos(row.purchase_items)[0] || "-";
      const title = actualProductTitle(item);
      if (isUnfinishedInvoiceManagementNo(managementNo, unfinishedInvoiceNos)) continue;
      if (isExcludedStockProposalManagementNo(managementNo)) continue;
      if (isStockProposalAccessory(title, item.category)) continue;
      const model = stockProposalModelName(title, item.category);
      const product = getOrCreateStockProposalProduct(productMap, title, model);
      const unitPrice = toNumber(item.unit_price);
      product.waitingQuantity += quantity;
      product.totalQuantity += quantity;
      addStockProposalPrice(product, unitPrice, quantity);
      appendStockProposalDetail(product, {
        source: "waiting",
        managementNo,
        quantity,
        unitPrice,
        status: rowStatus,
        supplier,
        date: row.purchase_date ?? item.purchase_date ?? item.estimated_purchase_date ?? "",
      });
    }
  }

  const normalizedSearch = searchText.trim().toLowerCase();
  const products = Array.from(productMap.values())
    .filter((product) => !normalizedSearch || product.searchText.includes(normalizedSearch))
    .sort((a, b) => {
      const modelCompare = a.model.localeCompare(b.model, "ja", { numeric: true });
      if (modelCompare !== 0) return modelCompare;
      return a.title.localeCompare(b.title, "ja", { numeric: true });
    });

  const groupMap = new Map<string, StockProposalProduct[]>();
  for (const product of products) {
    const current = groupMap.get(product.model) ?? [];
    current.push(product);
    groupMap.set(product.model, current);
  }

  return Array.from(groupMap.entries())
    .map(([model, groupProducts]) => ({
      model,
      products: groupProducts,
      stockQuantity: groupProducts.reduce((total, product) => total + product.stockQuantity, 0),
      waitingQuantity: groupProducts.reduce((total, product) => total + product.waitingQuantity, 0),
      totalQuantity: groupProducts.reduce((total, product) => total + product.totalQuantity, 0),
      unitPriceTotal: groupProducts.reduce((total, product) => total + product.unitPriceTotal, 0),
      unitPriceQuantity: groupProducts.reduce((total, product) => total + product.unitPriceQuantity, 0),
    }))
    .sort((a, b) => {
      const orderA = STOCK_MODEL_ORDER.indexOf(a.model);
      const orderB = STOCK_MODEL_ORDER.indexOf(b.model);
      const normalizedA = orderA === -1 ? STOCK_MODEL_ORDER.length : orderA;
      const normalizedB = orderB === -1 ? STOCK_MODEL_ORDER.length : orderB;
      if (normalizedA !== normalizedB) return normalizedA - normalizedB;
      return a.model.localeCompare(b.model, "ja", { numeric: true });
    });
}

function buildStockSearchText(item: StockItemView): string {
  return [
    item.labelId ?? "",
    item.title,
    item.category,
    item.legacyManagementNo,
    item.allocationLabel,
    item.supplier.name,
    item.status,
  ]
    .join("\n")
    .toLowerCase();
}

function buildProductSummaries(
  rows: PurchaseRow[],
  invoiceProducts: InvoiceProductSummary[] = [],
): ProductSummary[] {
  const map = new Map<string, ProductSummary>();
  for (const row of rows) {
    for (const item of row.purchase_items) {
      const title = invoiceAlignedProductTitle(item, invoiceProducts);
      const key = productKey(title);
      const current = map.get(key) ?? {
        key,
        title,
        managementNos: [],
        matchTexts: [],
        required: 0,
        secured: 0,
        waiting: 0,
        unitPriceTotal: 0,
        unitPriceCount: 0,
      };
      const quantity = itemQuantity(item);
      const managementNo = parseEtc(item.etc).managementNo;
      const managementHints = extractManagementHints(item.etc, managementNo);
      if (managementHints.length > 0) {
        current.managementNos = unique([...(current.managementNos ?? []), ...managementHints]);
      }
      current.matchTexts = unique([...(current.matchTexts ?? []), ...purchaseItemMatchTexts(item)]);
      current.required += quantity;
      const securedQuantity = Math.min(quantity, itemStockQuantity(item));
      current.secured += securedQuantity;
      if (!isReceived(row)) {
        current.waiting += Math.max(0, quantity - securedQuantity);
      }
      const unitPrice = toNumber(item.unit_price);
      if (unitPrice > 0) {
        current.unitPriceTotal += unitPrice;
        current.unitPriceCount += 1;
      }
      map.set(key, current);
    }
  }
  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, "ja"));
}

function buildInvoiceStockProductSummaries(
  stockItems: StockItemView[],
  invoiceNo: string | null,
  excludedInventoryIds: Set<number>,
): ProductSummary[] {
  if (!invoiceNo) return [];
  const map = new Map<string, ProductSummary>();

  for (const item of stockItems) {
    if (excludedInventoryIds.has(item.inventoryId)) continue;
    const parsed = parseInvoiceFromManagementNo(item.legacyManagementNo);
    if (parsed?.invoiceNo !== invoiceNo) continue;

    const title = item.title;
    const key = productKey(title);
    const current = map.get(key) ?? {
      key,
      title,
      managementNos: [],
      matchTexts: [],
      required: 0,
      secured: 0,
      waiting: 0,
      unitPriceTotal: 0,
      unitPriceCount: 0,
    };
    const quantity = Math.max(0, Math.floor(Number(item.quantity)) || 0);
    if (quantity <= 0) continue;

    current.secured += quantity;
    current.managementNos = unique([...(current.managementNos ?? []), item.legacyManagementNo]);
    current.matchTexts = unique([
      ...(current.matchTexts ?? []),
      item.title,
      item.category,
      item.legacyManagementNo,
      item.allocationLabel,
      item.supplier.name,
    ]);
    if (item.unitPrice > 0) {
      current.unitPriceTotal += item.unitPrice * quantity;
      current.unitPriceCount += quantity;
    }
    map.set(key, current);
  }

  return Array.from(map.values()).sort((a, b) => a.title.localeCompare(b.title, "ja"));
}

function filterInvoiceStockItems(
  stockItems: StockItemView[],
  invoiceNo: string | null,
  excludedInventoryIds: Set<number>,
): StockItemView[] {
  if (!invoiceNo) return [];
  return stockItems.filter((item) => {
    if (excludedInventoryIds.has(item.inventoryId)) return false;
    return parseInvoiceFromManagementNo(item.legacyManagementNo)?.invoiceNo === invoiceNo;
  });
}

function invoiceNoFromGroupKey(key?: string | null): string | null {
  const match = key?.match(/^invoice-(\d+)$/);
  return match?.[1] ?? null;
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

function isShippableLabelStatus(status?: string | null): boolean {
  const normalized = (status ?? "").trim().toLowerCase();
  return normalized === "received" || normalized === "stocked";
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

function mergeLabelViewsById(...groups: LabelView[][]): LabelView[] {
  const map = new Map<string, LabelView>();
  for (const labels of groups) {
    for (const label of labels) {
      const key = label.labelId.trim().toUpperCase();
      if (!key) continue;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, label);
        continue;
      }
      const existingShippable = isShippableLabelStatus(existing.rawStatus);
      const nextShippable = isShippableLabelStatus(label.rawStatus);
      if (existing.inventoryId && !label.inventoryId) {
        map.set(key, { ...label, ...existing });
        continue;
      }
      if (existingShippable && !nextShippable) {
        map.set(key, {
          ...label,
          inventoryId: label.inventoryId ?? existing.inventoryId,
          rawStatus: existing.rawStatus,
          status: existing.status,
        });
        continue;
      }
      map.set(key, {
        ...existing,
        ...label,
        inventoryId: label.inventoryId ?? existing.inventoryId,
      });
    }
  }
  return Array.from(map.values());
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

function withInvoiceProductCounts(
  products: ProductSummary[],
  invoiceProducts: InvoiceProductSummary[],
): ProductSummary[] {
  if (invoiceProducts.length === 0) return products;

  type InvoiceProductStats = InvoiceProductSummary & {
    sellingPriceTotal: number;
    sellingPriceQuantity: number;
    sellingPriceJpyTotal: number;
    sellingPriceJpyQuantity: number;
  };
  const statsByKey = new Map<string, InvoiceProductStats>();
  const statsOrder: string[] = [];
  for (const product of invoiceProducts) {
    const key = productKey(product.productName);
    const current = statsByKey.get(key);
    const orderQty = toNumber(product.orderQty);
    const deliveredQty = toNumber(product.deliveredQty);
    const sellingPrice = toNumber(product.sellingPrice);
    const sellingPriceJpy = toNumber(product.sellingPriceJpy);
    if (current) {
      current.orderQty += orderQty;
      current.deliveredQty += deliveredQty;
      if (sellingPrice > 0 && orderQty > 0) {
        current.sellingPriceTotal += sellingPrice * orderQty;
        current.sellingPriceQuantity += orderQty;
        current.sellingPrice = current.sellingPriceTotal / current.sellingPriceQuantity;
      }
      if (sellingPriceJpy > 0 && orderQty > 0) {
        current.sellingPriceJpyTotal += sellingPriceJpy * orderQty;
        current.sellingPriceJpyQuantity += orderQty;
        current.sellingPriceJpy = current.sellingPriceJpyTotal / current.sellingPriceJpyQuantity;
      }
    } else {
      statsOrder.push(key);
      statsByKey.set(key, {
        productName: product.productName,
        orderQty,
        deliveredQty,
        sellingPrice: sellingPrice > 0 ? sellingPrice : null,
        sellingPriceJpy: sellingPriceJpy > 0 ? sellingPriceJpy : null,
        currency: product.currency ?? null,
        sellingPriceTotal: sellingPrice > 0 && orderQty > 0 ? sellingPrice * orderQty : 0,
        sellingPriceQuantity: sellingPrice > 0 && orderQty > 0 ? orderQty : 0,
        sellingPriceJpyTotal: sellingPriceJpy > 0 && orderQty > 0 ? sellingPriceJpy * orderQty : 0,
        sellingPriceJpyQuantity: sellingPriceJpy > 0 && orderQty > 0 ? orderQty : 0,
      });
    }
  }

  const createInvoiceSummary = (key: string, product: InvoiceProductStats): ProductSummary => ({
    key,
    title: product.productName,
    managementNos: [],
    matchTexts: [],
    invoiceOrdered: product.orderQty,
    invoiceShipped: product.deliveredQty,
    required: Math.max(0, product.orderQty - product.deliveredQty),
    secured: 0,
    waiting: 0,
    unitPriceTotal: 0,
    unitPriceCount: 0,
    sellingPrice: product.sellingPrice ?? null,
    sellingPriceJpy: product.sellingPriceJpy ?? null,
    sellingCurrency: product.currency ?? null,
  });

  const summariesByInvoiceKey = new Map<string, ProductSummary>();
  for (const key of statsOrder) {
    const product = statsByKey.get(key);
    if (product) summariesByInvoiceKey.set(key, createInvoiceSummary(key, product));
  }

  const candidates = Array.from(statsByKey.values()).map((product) => ({
    name: product.productName,
    qty: product.orderQty,
  }));

  for (const product of products) {
    const direct = statsByKey.get(product.key);
    const managementHints = extractManagementHints(
      ...(product.managementNos ?? []),
      ...(product.matchTexts ?? []),
    );
    const matchText = unique([product.title, ...(product.matchTexts ?? []), ...managementHints]).join(" ");
    const titleSuggestion =
      suggestInvoiceProductNameFromHints(product.title, managementHints, candidates) ??
      (product.title.trim() ? suggestInvoiceProductName(product.title, managementHints.join(" "), candidates) : null);
    const suggestedName =
      suggestInvoiceProductNameFromHints("", managementHints, candidates) ??
      titleSuggestion ??
      (matchText.trim() ? suggestInvoiceProductName(matchText, managementHints.join(" "), candidates) : null);
    const suggestedKey = suggestedName && canMatchTargetProduct(matchText, suggestedName) ? productKey(suggestedName) : "";
    const directMatchesTarget = direct ? canMatchTargetProduct(matchText, direct.productName) : false;
    const matchedKey =
      suggestedKey && summariesByInvoiceKey.has(suggestedKey)
        ? suggestedKey
        : direct && directMatchesTarget
          ? product.key
          : "";
    const target = matchedKey ? summariesByInvoiceKey.get(matchedKey) : undefined;

    if (!target) {
      continue;
    }

    target.secured += product.secured;
    target.waiting += product.waiting;
    target.unitPriceTotal += product.unitPriceTotal;
    target.unitPriceCount += product.unitPriceCount;
    target.managementNos = unique([...(target.managementNos ?? []), ...managementHints, ...(product.managementNos ?? [])]);
    target.matchTexts = unique([...(target.matchTexts ?? []), ...(product.matchTexts ?? []), ...managementHints]);
  }

  return statsOrder
    .map((key) => summariesByInvoiceKey.get(key))
    .filter((product): product is ProductSummary => Boolean(product));
}

function hasOpenInvoiceQuantity(product: ProductSummary): boolean {
  if (product.invoiceOrdered == null) return true;
  return Math.max(0, product.invoiceOrdered - (product.invoiceShipped ?? 0)) > 0;
}

function buildAllocationGroups(
  rows: PurchaseRow[],
  invoiceSummaries?: PurchaseRegistrationInvoice[],
): AllocationGroup[] {
  const map = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    const key = getInvoiceInfo(row).key;
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  }

  const invoiceSummaryByKey = new Map<string, PurchaseRegistrationInvoice>(
    (invoiceSummaries ?? []).map((summary) => [`invoice-${summary.invoiceNo}`, summary]),
  );
  const shouldFilterClosedInvoices = invoiceSummaries !== undefined;

  const groups = Array.from(map.entries())
    .flatMap(([key, groupRows]) => {
      if (
        key !== OTHER_INVOICE_KEY &&
        key !== EBAY_GROUP_KEY &&
        shouldFilterClosedInvoices &&
        !invoiceSummaryByKey.has(key)
      ) return [];
      const first = groupRows[0];
      const supplier = getSupplier(first);
      const products = buildProductSummaries(groupRows);
      const labels = buildLabelViews(groupRows);
      const required = products.reduce((total, item) => total + item.required, 0);
      const secured = products.reduce((total, item) => total + item.secured, 0);
      const waiting = products.reduce((total, item) => total + item.waiting, 0);
      const purchaseTotal = groupRows.reduce(
        (total, row) =>
          total +
          row.purchase_items.reduce(
            (rowTotal, item) => rowTotal + toNumber(item.unit_price) * itemQuantity(item),
            0,
          ),
        0,
      );
      const invoiceInfo = getInvoiceInfo(first);
      const invoiceSummary = invoiceSummaryByKey.get(key);
      const partners = unique(groupRows.map((row) => getInvoiceInfo(row).partner).filter(Boolean));
      const partnerLabel = invoiceSummary?.partner || partners.join(" / ");
      const isEbayGroup = invoiceInfo.key === EBAY_GROUP_KEY;
      const label =
        invoiceInfo.key === OTHER_INVOICE_KEY
          ? "在庫"
          : isEbayGroup
            ? EBAY_GROUP_LABEL
            : `No.${invoiceInfo.invoiceNo}${partnerLabel ? ` ${partnerLabel}` : ""}`;
      return [{
        key,
        label,
        partner: invoiceInfo.key === OTHER_INVOICE_KEY ? "在庫" : partnerLabel || supplier.name,
        rows: groupRows,
        products,
        labels,
        required,
        secured,
        waiting,
        purchaseTotal,
        invoiceOrderQty: invoiceSummary?.totalOrderQty,
        invoiceDeliveredQty: invoiceSummary?.totalDeliveredQty,
        invoiceRemainingQty: invoiceSummary?.remainingQty,
      }];
    });

  for (const summary of invoiceSummaries ?? []) {
    const key = `invoice-${summary.invoiceNo}`;
    if (map.has(key)) continue;
    groups.push({
      key,
      label: `No.${summary.invoiceNo}${summary.partner ? ` ${summary.partner}` : ""}`,
      partner: summary.partner,
      rows: [],
      products: [],
      labels: [],
      required: 0,
      secured: 0,
      waiting: 0,
      purchaseTotal: 0,
      invoiceOrderQty: summary.totalOrderQty,
      invoiceDeliveredQty: summary.totalDeliveredQty,
      invoiceRemainingQty: summary.remainingQty,
    });
  }

  return groups.sort((a, b) => {
    if (a.key === OTHER_INVOICE_KEY) return 1;
    if (b.key === OTHER_INVOICE_KEY) return -1;
    if (a.key === EBAY_GROUP_KEY) return 1;
    if (b.key === EBAY_GROUP_KEY) return -1;
    return b.key.localeCompare(a.key, "ja", { numeric: true });
  });
}

function mergeAllocationGroupsByKey(groups: AllocationGroup[]): AllocationGroup[] {
  const result: AllocationGroup[] = [];
  const indexByKey = new Map<string, number>();
  for (const group of groups) {
    const index = indexByKey.get(group.key);
    if (index === undefined) {
      indexByKey.set(group.key, result.length);
      result.push(group);
      continue;
    }

    const current = result[index];
    const labels = mergeLabelViewsById(current.labels, group.labels);
    result[index] = {
      ...current,
      rows: [...current.rows, ...group.rows],
      products: [...current.products, ...group.products],
      labels,
      required: labels.length > 0 ? labels.length : current.required + group.required,
      secured: labels.length > 0 ? labels.length : current.secured + group.secured,
      waiting: current.waiting + group.waiting,
      purchaseTotal: current.purchaseTotal + group.purchaseTotal,
      invoiceOrderQty: current.invoiceOrderQty ?? group.invoiceOrderQty,
      invoiceDeliveredQty: current.invoiceDeliveredQty ?? group.invoiceDeliveredQty,
      invoiceRemainingQty: labels.length > 0 ? labels.length : (current.invoiceRemainingQty ?? group.invoiceRemainingQty),
    };
  }
  return result;
}

function getAllRowsFromGroup(group: AllocationGroup | null, fallbackRows: PurchaseRow[]): PurchaseRow[] {
  if (!group) return fallbackRows;
  return group.rows;
}

function purchaseRowInventoryId(row: PurchaseRow): number | null {
  for (const label of getItemLabels(row.purchase_items)) {
    const id = Number(label.localInventoryId);
    if (Number.isFinite(id) && id > 0) return id;
  }
  for (const item of row.purchase_items) {
    const id = Number(item.inventory_id);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return null;
}

function PurchaseRegistrationCard({
  row,
  onPrintLabels,
  onOpenEdit,
  onOpenTrackingDialog,
  onOpenShippingHistory,
  onDeleteRow,
  isDeleting,
  isSelected = false,
  onSelectChange,
}: {
  row: PurchaseRow;
  onPrintLabels: LabelPrintRequest;
  onOpenEdit: (row: PurchaseRow) => void;
  onOpenTrackingDialog: (row: PurchaseRow) => void;
  onOpenShippingHistory: (row: PurchaseRow) => void;
  onDeleteRow: (row: PurchaseRow) => void;
  isDeleting?: boolean;
  isSelected?: boolean;
  onSelectChange?: (row: PurchaseRow, checked: boolean) => void;
}) {
  const labels = getItemLabels(row.purchase_items);
  const managementNos = getManagementNos(row.purchase_items);
  const supplier = getSupplier(row);
  const totalQuantity = sumQuantity(row.purchase_items);
  const currentStockQuantity = row.purchase_items.reduce((total, item) => total + itemStockQuantity(item), 0);
  const firstItem = row.purchase_items[0];
  const displayItems = row.purchase_items.slice(0, 4);
  const hiddenItemCount = Math.max(0, row.purchase_items.length - displayItems.length);
  const unitPrice = firstItem?.unit_price;
  const trackingNumber = purchaseTrackingNumber(row);
  const trackingInfo = trackingNumber ? getPurchaseTrackingMeta(trackingNumber, row.extra?.carrier) : null;
  const rowLabels = buildLabelViews([row]);
  const deletableInventoryId = purchaseRowInventoryId(row);

  return (
    <section className={cn("rounded-lg border bg-background shadow-sm", isSelected && "border-emerald-400 ring-1 ring-emerald-300")}>
      <div className="flex flex-col gap-4 border-b p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 flex-1 gap-3">
          {onSelectChange ? (
            <Checkbox
              checked={isSelected}
              onCheckedChange={(checked) => onSelectChange(row, checked === true)}
              aria-label={`${actualProductTitle(firstItem) || firstItem?.title || "商品"}を選択`}
              className="mt-1 shrink-0"
            />
          ) : null}
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
            {labels.length > 0 ? (
              labels.slice(0, 8).map((label) => (
                <span
                  key={label.labelId}
                  className={cn(
                    "rounded-md border px-2.5 py-1 font-mono text-lg font-semibold tracking-wide",
                    labelBadgeClass(label.status),
                  )}
                >
                  {label.labelId}
                </span>
              ))
            ) : (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm font-medium text-slate-600">
                商品ID未発行
              </span>
            )}
            {labels.length > 8 ? <Badge variant="outline">他{labels.length - 8}件</Badge> : null}
            <Badge variant="outline" className={statusClass(row)}>
              {statusLabel(row)}
            </Badge>
            {trackingNumber && trackingInfo ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-900">
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
              </span>
            ) : null}
          </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>旧管理番号: {managementNos.length > 0 ? managementNos.join(" / ") : "-"}</span>
            <span>発注No: {row.num || "-"}</span>
            </div>
          </div>
        </div>
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 sm:w-fit"
            onClick={() => onOpenEdit(row)}
          >
            <Pencil className="h-4 w-4" />
            編集
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2 sm:w-fit"
            onClick={() => onOpenTrackingDialog(row)}
          >
            <Truck className="h-4 w-4" />
            {trackingNumber ? "追跡番号を編集" : "追跡番号を登録"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2 sm:w-fit"
            onClick={() => onOpenShippingHistory(row)}
          >
            <Truck className="h-4 w-4" />
            出庫履歴
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2 sm:w-fit"
            disabled={rowLabels.length === 0}
            onClick={() => onPrintLabels(rowLabels)}
          >
            <Printer className="h-4 w-4" />
            ラベル印刷
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full gap-2 border-rose-200 text-rose-700 hover:bg-rose-50 sm:w-fit"
            disabled={!deletableInventoryId || isDeleting}
            onClick={() => onDeleteRow(row)}
          >
            {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            削除
          </Button>
        </div>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="min-w-0 xl:col-span-2">
          <div className="text-xs text-muted-foreground">商品名</div>
          <div className="mt-1 space-y-1">
            {displayItems.map((item) => (
              <div key={`${row.id}-${item.id}`} className="truncate text-sm font-medium">
                {item.title || "-"}
              </div>
            ))}
            {hiddenItemCount > 0 ? <div className="text-xs text-muted-foreground">他{hiddenItemCount}件</div> : null}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">発注数</div>
          <div className="mt-1 text-sm font-semibold">{totalQuantity.toLocaleString()}個</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">在庫数</div>
          <div className="mt-1 text-sm font-semibold">{currentStockQuantity.toLocaleString()}個</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">仕入単価</div>
          <div className="mt-1 text-sm font-semibold">{formatCurrency(unitPrice)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">発注日</div>
          <div className="mt-1 flex items-center gap-1 text-sm font-medium">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDate(row.purchase_date ?? firstItem?.estimated_purchase_date)}
          </div>
        </div>
        <div className="min-w-0 md:col-span-2 xl:col-span-6">
          <div className="text-xs text-muted-foreground">仕入先</div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="truncate font-medium">{supplier.name}</span>
            {supplier.url ? (
              <a
                href={supplier.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-emerald-700 hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                開く
              </a>
            ) : null}
          </div>
        </div>
      </div>

    </section>
  );
}

function MissingTrackingOverview({
  rows,
  totalCount,
  selectedRowIds,
  onSelectRow,
  onSelectAllRows,
  onOpenBulkTracking,
  onPrintLabels,
  onOpenEdit,
  onOpenTrackingDialog,
  onOpenShippingHistory,
  onDeleteRow,
  deletingRowId,
}: {
  rows: PurchaseRow[];
  totalCount: number;
  selectedRowIds: Set<number>;
  onSelectRow: (row: PurchaseRow, checked: boolean) => void;
  onSelectAllRows: (rows: PurchaseRow[], checked: boolean) => void;
  onOpenBulkTracking: () => void;
  onPrintLabels: LabelPrintRequest;
  onOpenEdit: (row: PurchaseRow) => void;
  onOpenTrackingDialog: (row: PurchaseRow) => void;
  onOpenShippingHistory: (row: PurchaseRow) => void;
  onDeleteRow: (row: PurchaseRow) => void;
  deletingRowId?: number | null;
}) {
  const selectedRows = rows.filter((row) => selectedRowIds.has(row.id));
  const selectedCount = selectedRows.length;
  const allVisibleSelected = rows.length > 0 && selectedCount === rows.length;

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <Truck className="h-4 w-4 text-blue-700" />
              追跡番号未登録一覧
              <Badge variant="outline">表示 {rows.length.toLocaleString()}件</Badge>
              <Badge variant="secondary">全体 {totalCount.toLocaleString()}件</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              インボイスに関係なく、サイト登録順で追跡番号未登録の商品を表示しています。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(checked) => onSelectAllRows(rows, checked === true)}
                disabled={rows.length === 0}
                aria-label="表示中の商品をすべて選択"
              />
              全選択
            </label>
          </div>
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="追跡番号未登録の商品はありません"
          description="検索条件を変えると、別の商品が見つかる場合があります。"
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <PurchaseRegistrationCard
              key={row.id}
              row={row}
              onPrintLabels={onPrintLabels}
              onOpenEdit={onOpenEdit}
              onOpenTrackingDialog={onOpenTrackingDialog}
              onOpenShippingHistory={onOpenShippingHistory}
              onDeleteRow={onDeleteRow}
              isDeleting={deletingRowId === row.id}
              isSelected={selectedRowIds.has(row.id)}
              onSelectChange={onSelectRow}
            />
          ))}
        </div>
      )}

      {selectedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-[4.75rem] z-30 border-t bg-background/95 shadow-lg backdrop-blur lg:bottom-0 lg:right-[204px]">
          <div className="mx-auto max-w-5xl px-4 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selectedRows.map((row) => {
                const managementNos = getManagementNos(row.purchase_items).join(" / ");
                const labelIds = getItemLabels(row.purchase_items).map((label) => label.labelId).join(" / ");
                return (
                  <Badge key={row.id} variant="secondary" className="max-w-[220px] truncate text-xs">
                    {managementNos || labelIds || `#${row.id}`}
                  </Badge>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[140px] flex-1 text-sm text-muted-foreground">
                <Truck className="mr-1.5 inline h-4 w-4 text-blue-600" />
                {selectedCount.toLocaleString()}件選択中
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSelectAllRows(rows, false)}
              >
                選択解除
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                onClick={onOpenBulkTracking}
              >
                <Truck className="h-4 w-4" />
                追跡番号を一括登録
                <Badge className="bg-white/20 text-white hover:bg-white/20">{selectedCount}</Badge>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function StockDetailCard({
  item,
  onOpenEdit,
}: {
  item: StockItemView;
  onOpenEdit: (inventoryId: number) => void;
}) {
  return (
    <section className="rounded-lg border border-emerald-100 bg-emerald-50/30 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-emerald-100 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {item.labelId ? (
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-lg font-semibold tracking-wide text-emerald-800">
                {item.labelId}
              </span>
            ) : (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm font-medium text-slate-600">
                商品ID未発行
              </span>
            )}
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">現在庫</Badge>
            {item.quantity > 1 ? <Badge variant="outline">{item.quantity.toLocaleString()}点</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>旧管理番号: {item.legacyManagementNo || "-"}</span>
            <span>引当先: {item.allocationLabel || "-"}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 sm:w-fit"
          onClick={() => onOpenEdit(item.inventoryId)}
        >
          <Pencil className="h-4 w-4" />
          編集
        </Button>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-2">
          <div className="text-xs text-muted-foreground">商品名</div>
          <div className="mt-1 truncate text-sm font-medium">{item.title || "-"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">在庫数</div>
          <div className="mt-1 text-sm font-semibold">{item.quantity.toLocaleString()}個</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">仕入単価</div>
          <div className="mt-1 text-sm font-semibold">{formatCurrency(item.unitPrice)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">入庫日</div>
          <div className="mt-1 flex items-center gap-1 text-sm font-medium">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDate(item.purchaseDate)}
          </div>
        </div>
        <div className="min-w-0 md:col-span-2 xl:col-span-5">
          <div className="text-xs text-muted-foreground">仕入先</div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="truncate font-medium">{item.supplier.name}</span>
            {item.supplier.url ? (
              <a
                href={item.supplier.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
              >
                開く
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-background p-3 md:p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 break-words text-lg font-semibold tracking-tight md:text-xl">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function ProductFulfillmentTable({ products }: { products: ProductSummary[] }) {
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">充足状況</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">品目</th>
              <th className="px-4 py-3 text-right font-medium">必要</th>
              <th className="px-4 py-3 text-right font-medium">確保</th>
              <th className="px-4 py-3 text-right font-medium">仕入れ不足</th>
              <th className="px-4 py-3 text-right font-medium">平均仕入</th>
              <th className="px-4 py-3 text-right font-medium">売価</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  充足状況を表示できる商品がありません
                </td>
              </tr>
            ) : (
              products.map((product) => {
                const shortage = Math.max(product.required - product.secured, 0);
                const average = product.unitPriceCount > 0 ? product.unitPriceTotal / product.unitPriceCount : 0;
                return (
                  <tr key={product.key} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{product.title}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex min-w-7 justify-center rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                        {product.required.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{product.secured.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn("font-medium", shortage > 0 ? "text-rose-600" : "text-foreground")}>
                        {shortage.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{average > 0 ? formatCurrency(Math.round(average)) : "-"}</td>
                    <td className="px-4 py-3 text-right">
                      {formatTradePrice(product.sellingPrice, product.sellingCurrency)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProductFulfillmentTableV2({
  products,
  selectedFilter,
  onProductFilter,
  stockOnly = false,
}: {
  products: ProductSummary[];
  selectedFilter?: ProductDetailFilter | null;
  onProductFilter?: (filter: ProductDetailFilter) => void;
  stockOnly?: boolean;
}) {
  const stockHeaderActive = selectedFilter?.mode === "stock" && !selectedFilter.productKey;
  const waitingHeaderActive = selectedFilter?.mode === "waiting" && !selectedFilter.productKey;

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">充足状況</div>
      <div className="divide-y md:hidden">
        {products.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            表示できる商品がありません
          </div>
        ) : (
          products.map((product) => {
            const shortage = product.required - product.secured - product.waiting;
            const average = product.unitPriceCount > 0 ? product.unitPriceTotal / product.unitPriceCount : 0;
            const stockFilterActive = selectedFilter?.productKey === product.key && selectedFilter.mode === "stock";
            const waitingFilterActive = selectedFilter?.productKey === product.key && selectedFilter.mode === "waiting";
            return (
              <div key={product.key} className="p-4">
                <div className="font-medium">{product.title}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {!stockOnly ? (
                    <>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">インボイス発注数</div>
                        <div className="mt-1 font-semibold">{product.invoiceOrdered == null ? "-" : product.invoiceOrdered.toLocaleString()}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">出庫数</div>
                        <div className="mt-1 font-semibold">{product.invoiceShipped == null ? "-" : product.invoiceShipped.toLocaleString()}</div>
                      </div>
                      <div className="rounded-md bg-blue-50 p-2">
                        <div className="text-xs text-blue-700">必要</div>
                        <div className="mt-1 font-semibold text-blue-800">{product.required.toLocaleString()}</div>
                      </div>
                    </>
                  ) : null}
                  <div className="rounded-md bg-emerald-50 p-2">
                    <div className="text-xs text-emerald-700">現在庫</div>
                    {product.secured > 0 && onProductFilter ? (
                      <button
                        type="button"
                        className={cn(
                          "mt-1 inline-flex rounded px-2 py-1 text-sm font-semibold",
                          stockFilterActive ? "bg-emerald-100 text-emerald-900" : "text-emerald-800",
                        )}
                        onClick={() => onProductFilter({ productKey: product.key, productTitle: product.title, mode: "stock" })}
                      >
                        {product.secured.toLocaleString()}
                      </button>
                    ) : (
                      <div className="mt-1 font-semibold text-emerald-800">{product.secured.toLocaleString()}</div>
                    )}
                  </div>
                  <div className="rounded-md bg-amber-50 p-2">
                    <div className="text-xs text-amber-700">入庫まち</div>
                    {product.waiting > 0 && onProductFilter ? (
                      <button
                        type="button"
                        className={cn(
                          "mt-1 inline-flex rounded px-2 py-1 text-sm font-semibold",
                          waitingFilterActive ? "bg-amber-100 text-amber-900" : "text-amber-800",
                        )}
                        onClick={() => onProductFilter({ productKey: product.key, productTitle: product.title, mode: "waiting" })}
                      >
                        {product.waiting.toLocaleString()}
                      </button>
                    ) : (
                      <div className="mt-1 font-semibold text-amber-800">{product.waiting > 0 ? product.waiting.toLocaleString() : "-"}</div>
                    )}
                  </div>
                  {!stockOnly ? (
                    <>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">仕入れ不足</div>
                        <div className={cn("mt-1 font-semibold", shortage > 0 ? "text-rose-600" : "text-foreground")}>{shortage.toLocaleString()}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">平均仕入</div>
                        <div className="mt-1 font-semibold">{average > 0 ? formatCurrency(Math.round(average)) : "-"}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">売価</div>
                        <div className="mt-1 font-semibold">{formatTradePrice(product.sellingPrice, product.sellingCurrency)}</div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className={cn("w-full text-sm", stockOnly ? "min-w-[480px]" : "min-w-[960px]")}>
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">品目</th>
              {!stockOnly ? (
                <>
                  <th className="px-4 py-3 text-right font-medium">インボイス発注数</th>
                  <th className="px-4 py-3 text-right font-medium">出庫数</th>
                  <th className="px-4 py-3 text-right font-medium">必要</th>
                </>
              ) : null}
              <th
                className={cn(
                  "px-4 py-3 text-right font-medium",
                  onProductFilter && "cursor-pointer select-none transition hover:bg-emerald-50 hover:text-emerald-700",
                  stockHeaderActive && "bg-emerald-50 text-emerald-700",
                )}
                role={onProductFilter ? "button" : undefined}
                tabIndex={onProductFilter ? 0 : undefined}
                onClick={() => onProductFilter?.({ productTitle: "現在庫", mode: "stock" })}
                onKeyDown={(event) => {
                  if (!onProductFilter) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onProductFilter({ productTitle: "現在庫", mode: "stock" });
                  }
                }}
              >
                {onProductFilter ? (
                  <span className="inline-flex rounded px-2 py-1">現在庫</span>
                ) : (
                  "現在庫"
                )}
              </th>
              <th
                className={cn(
                  "px-4 py-3 text-right font-medium",
                  onProductFilter && "cursor-pointer select-none transition hover:bg-amber-50 hover:text-amber-700",
                  waitingHeaderActive && "bg-amber-50 text-amber-700",
                )}
                role={onProductFilter ? "button" : undefined}
                tabIndex={onProductFilter ? 0 : undefined}
                onClick={() => onProductFilter?.({ productTitle: "入庫まち", mode: "waiting" })}
                onKeyDown={(event) => {
                  if (!onProductFilter) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onProductFilter({ productTitle: "入庫まち", mode: "waiting" });
                  }
                }}
              >
                {onProductFilter ? (
                  <span className="inline-flex rounded px-2 py-1">入庫まち</span>
                ) : (
                  "入庫まち"
                )}
              </th>
              {!stockOnly ? (
                <>
                  <th className="px-4 py-3 text-right font-medium">仕入れ不足</th>
                  <th className="px-4 py-3 text-right font-medium">平均仕入</th>
                  <th className="px-4 py-3 text-right font-medium">売価</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={stockOnly ? 3 : 9} className="px-4 py-8 text-center text-muted-foreground">
                  表示できる商品がありません
                </td>
              </tr>
            ) : (
              products.map((product) => {
                const shortage = product.required - product.secured - product.waiting;
                const average = product.unitPriceCount > 0 ? product.unitPriceTotal / product.unitPriceCount : 0;
                const stockFilterActive = selectedFilter?.productKey === product.key && selectedFilter.mode === "stock";
                const waitingFilterActive = selectedFilter?.productKey === product.key && selectedFilter.mode === "waiting";
                return (
                  <tr key={product.key} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{product.title}</td>
                    {!stockOnly ? (
                      <>
                        <td className="px-4 py-3 text-right">
                          {product.invoiceOrdered == null ? "-" : product.invoiceOrdered.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {product.invoiceShipped == null ? "-" : product.invoiceShipped.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex min-w-7 justify-center rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                            {product.required.toLocaleString()}
                          </span>
                        </td>
                      </>
                    ) : null}
                    <td className="px-4 py-3 text-right">
                      {product.secured > 0 && onProductFilter ? (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex min-w-7 justify-center rounded px-2 py-1 text-xs font-semibold transition hover:bg-emerald-100",
                            stockFilterActive ? "bg-emerald-100 text-emerald-800" : "bg-emerald-50 text-emerald-700",
                          )}
                          onClick={() =>
                            onProductFilter({ productKey: product.key, productTitle: product.title, mode: "stock" })
                          }
                        >
                          {product.secured.toLocaleString()}
                        </button>
                      ) : (
                        product.secured.toLocaleString()
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {product.waiting > 0 ? (
                        onProductFilter ? (
                          <button
                            type="button"
                            className={cn(
                              "inline-flex min-w-7 justify-center rounded px-2 py-1 text-xs font-semibold transition hover:bg-amber-100",
                              waitingFilterActive ? "bg-amber-100 text-amber-800" : "bg-amber-50 text-amber-700",
                            )}
                            onClick={() =>
                              onProductFilter({ productKey: product.key, productTitle: product.title, mode: "waiting" })
                            }
                          >
                            {product.waiting.toLocaleString()}
                          </button>
                        ) : (
                          <span className="inline-flex min-w-7 justify-center rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                            {product.waiting.toLocaleString()}
                          </span>
                        )
                      ) : (
                        "-"
                      )}
                    </td>
                    {!stockOnly ? (
                      <>
                        <td className={cn("px-4 py-3 text-right font-medium", shortage > 0 ? "text-rose-600" : "text-foreground")}>
                          {shortage.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">{average > 0 ? formatCurrency(Math.round(average)) : "-"}</td>
                        <td className="px-4 py-3 text-right">
                          {formatTradePrice(product.sellingPrice, product.sellingCurrency)}
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function OrderDashboard({
  group,
  rows,
  products: productsOverride,
  detailRows,
  stockDetailItems = [],
  productFilter,
  onProductFilter,
  onClearProductFilter,
  onPrintLabels,
  onOpenEdit,
  onOpenStockEdit,
  onOpenTrackingDialog,
  onOpenShippingHistory,
  onDeleteRow,
  deletingRowId,
}: {
  group: AllocationGroup | null;
  rows: PurchaseRow[];
  products?: ProductSummary[];
  detailRows?: PurchaseRow[];
  stockDetailItems?: StockItemView[];
  productFilter?: ProductDetailFilter | null;
  onProductFilter?: (filter: ProductDetailFilter) => void;
  onClearProductFilter?: () => void;
  onPrintLabels: LabelPrintRequest;
  onOpenEdit: (row: PurchaseRow) => void;
  onOpenStockEdit: (inventoryId: number) => void;
  onOpenTrackingDialog: (row: PurchaseRow) => void;
  onOpenShippingHistory: (row: PurchaseRow) => void;
  onDeleteRow: (row: PurchaseRow) => void;
  deletingRowId?: number | null;
}) {
  const hideFulfillment = group?.key === EBAY_GROUP_KEY;
  const [showShippedRows, setShowShippedRows] = useState(false);
  const groupRows = getAllRowsFromGroup(group, rows);
  const displayRows = detailRows ?? groupRows;
  const shippedRows = displayRows.filter((row) => purchaseRowStatusKind(row) === "shipped");
  const visibleRows = showShippedRows
    ? displayRows
    : displayRows.filter((row) => purchaseRowStatusKind(row) !== "shipped");
  const products = productsOverride ?? group?.products ?? buildProductSummaries(groupRows);
  const required = products.reduce((total, item) => total + item.required, 0);
  const secured = products.reduce((total, item) => total + item.secured, 0);
  const purchaseTotal =
    group?.purchaseTotal ??
    displayRows.reduce(
      (total, row) =>
        total +
        row.purchase_items.reduce((rowTotal, item) => rowTotal + toNumber(item.unit_price) * itemQuantity(item), 0),
      0,
    );
  const forecast = buildForecastSummary(products, purchaseTotal);

  useEffect(() => {
    setShowShippedRows(false);
  }, [group?.key, productFilter?.productKey, productFilter?.productTitle, productFilter?.mode]);

  return (
    <div className="space-y-5">
      {!hideFulfillment ? (
        <>
      <section className="rounded-md border bg-background">
        <div className="border-b bg-muted/30 px-4 py-3 text-sm text-muted-foreground">引当先を選ぶ</div>
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <StatCard label="充足" value={`${secured.toLocaleString()} / ${required.toLocaleString()} 点`} />
          <StatCard label="仕入合計" value={formatCurrency(purchaseTotal)} />
          <StatCard label="想定売上" value={forecast.salesValue} sub={forecast.salesSub} />
          <StatCard label="想定粗利" value={forecast.grossValue} sub={forecast.grossSub} />
        </div>
      </section>

      <ProductFulfillmentTableV2
        products={products}
        selectedFilter={productFilter}
        onProductFilter={onProductFilter}
        stockOnly={group?.key === OTHER_INVOICE_KEY}
      />
        </>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <PackagePlus className="h-4 w-4 text-emerald-700" />
          仕入れ登録
          <Badge variant="outline">{visibleRows.length}件</Badge>
          {stockDetailItems.length > 0 ? (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
              現在庫 {stockDetailItems.reduce((total, item) => total + item.quantity, 0).toLocaleString()}点
            </Badge>
          ) : null}
          {shippedRows.length > 0 ? (
            <Button
              type="button"
              variant={showShippedRows ? "secondary" : "outline"}
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => setShowShippedRows((current) => !current)}
            >
              {showShippedRows ? "出庫済みを非表示" : "出庫済みを表示"}
              <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                {shippedRows.length}
              </Badge>
            </Button>
          ) : null}
          {productFilter ? (
            <>
              <Badge variant="secondary">{productDetailFilterLabel(productFilter)}</Badge>
              <Button type="button" variant="ghost" size="sm" onClick={onClearProductFilter}>
                絞り込み解除
              </Button>
            </>
          ) : null}
        </div>
        <div className="space-y-3">
          {visibleRows.length === 0 && stockDetailItems.length === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title="該当する仕入れ登録がありません"
              description={
                shippedRows.length > 0 && !showShippedRows
                  ? "出庫済みを表示すると確認できます。"
                  : "充足状況の絞り込みを解除すると、すべての仕入れ登録を確認できます。"
              }
            />
          ) : (
            <>
              {visibleRows.map((row) => (
                <PurchaseRegistrationCard
                  key={row.id}
                  row={row}
                  onPrintLabels={onPrintLabels}
                  onOpenEdit={onOpenEdit}
                  onOpenTrackingDialog={onOpenTrackingDialog}
                  onOpenShippingHistory={onOpenShippingHistory}
                  onDeleteRow={onDeleteRow}
                  isDeleting={deletingRowId === row.id}
                />
              ))}
              {stockDetailItems.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                    <Boxes className="h-4 w-4" />
                    現在庫
                    <Badge variant="outline">{stockDetailItems.length}件</Badge>
                  </div>
                  {stockDetailItems.map((item) => (
                    <StockDetailCard key={item.key} item={item} onOpenEdit={onOpenStockEdit} />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

// 既存の在庫はすべてラベルを発行して現物に貼り終えている。ラベル印刷と入庫スキャンで
// 見るのは、この日以降の仕入れだけでよい（村上さん指示・2026-08-18）。
// 貼り直しなど過去分が要るときは、画面のチェックを外すと全件に戻る。
const LABEL_SCOPE_FROM_DEFAULT = "2026-08-10";
const LABEL_SCOPE_FROM_KEY = "inventory.labelScopeFrom";
const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function loadLabelScopeFrom(): string {
  if (typeof window === "undefined") return LABEL_SCOPE_FROM_DEFAULT;
  try {
    const saved = window.localStorage.getItem(LABEL_SCOPE_FROM_KEY);
    return saved && ISO_DATE_PATTERN.test(saved) ? saved : LABEL_SCOPE_FROM_DEFAULT;
  } catch {
    return LABEL_SCOPE_FROM_DEFAULT;
  }
}

function isWithinLabelScope(label: LabelView, fromDate: string): boolean {
  // 在庫から作ったラベルは、現物にもう貼り終えている。既定では見ない
  if (label.rowId < 0) return false;
  const purchaseDate = label.purchaseDate?.trim() ?? "";
  // 仕入日が空のものは、隠すと気づけなくなるので残す
  if (!purchaseDate) return true;
  return purchaseDate.slice(0, 10) >= fromDate;
}

function buildLabelPrintGroups(labels: LabelView[]): { name: string; labels: LabelView[] }[] {
  const map = new Map<string, LabelView[]>();
  for (const label of labels) {
    const name = label.category || stockModelName(label.title) || "その他";
    const current = map.get(name) ?? [];
    current.push(label);
    map.set(name, current);
  }
  return Array.from(map.entries())
    .map(([name, groupLabels]) => ({ name, labels: groupLabels }))
    .sort((a, b) => {
      const orderA = STOCK_MODEL_ORDER.indexOf(a.name);
      const orderB = STOCK_MODEL_ORDER.indexOf(b.name);
      const normalizedA = orderA === -1 ? STOCK_MODEL_ORDER.length : orderA;
      const normalizedB = orderB === -1 ? STOCK_MODEL_ORDER.length : orderB;
      if (normalizedA !== normalizedB) return normalizedA - normalizedB;
      return a.name.localeCompare(b.name, "ja", { numeric: true });
    });
}

function LabelChecklistView({ labels }: { labels: LabelView[] }) {
  const groups = buildChecklistRows(labels);
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        付箋の旧管理番号から商品IDを引くための一覧です。チェックした商品IDだけを載せます（未選択なら表示中のすべて）。
      </p>
      <div className="overflow-hidden rounded-md border bg-background">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-3 py-2 text-left font-medium">✓</th>
                <th className="w-32 px-3 py-2 text-left font-medium">商品ID</th>
                <th className="px-3 py-2 text-left font-medium">旧管理番号</th>
                <th className="px-3 py-2 text-left font-medium">商品名</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => (
                <Fragment key={group.name}>
                  <tr className="border-b bg-slate-50">
                    <td colSpan={4} className="px-3 py-2 text-xs font-medium text-muted-foreground">
                      {group.name} - {group.labels.length}件
                    </td>
                  </tr>
                  {group.labels.map((label) => (
                    <tr key={label.key} className="border-b last:border-b-0">
                      <td className="px-3 py-2 text-muted-foreground">□</td>
                      <td className="px-3 py-2 font-mono font-semibold text-slate-950">{label.labelId}</td>
                      <td className="px-3 py-2">{label.legacyManagementNo}</td>
                      <td className="px-3 py-2">{label.title}</td>
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Asia/Tokyo の「今日」を YYYY-MM-DD で返す。ブラウザのタイムゾーンに引きずられないようにする。 */
function todayInTokyo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function LabelPrintPanel({
  labels,
  allLabels,
  onPrintLabels,
  onPrintChecklist,
  startPosition,
  onStartPositionChange,
}: {
  labels: LabelView[];
  allLabels: LabelView[];
  onPrintLabels: LabelPrintRequest;
  onPrintChecklist: LabelPrintRequest;
  startPosition: number;
  onStartPositionChange: (value: number) => void;
}) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [labelTitleOverrides, setLabelTitleOverrides] = useState<LabelTitleOverrideState>(() =>
    loadLabelTitleOverrides(),
  );
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const editableLabels = useMemo(
    () => labels.map((label) => applyLabelTitleOverride(label, labelTitleOverrides)),
    [labelTitleOverrides, labels],
  );
  const editableAllLabels = useMemo(
    () => allLabels.map((label) => applyLabelTitleOverride(label, labelTitleOverrides)),
    [allLabels, labelTitleOverrides],
  );
  const selectedLabels = useMemo(
    () => editableLabels.filter((label) => selectedKeySet.has(label.key)),
    [editableLabels, selectedKeySet],
  );
  const currentPrintLabels = selectedLabels.length > 0 ? selectedLabels : editableLabels;
  const selectedCount = selectedLabels.length;
  const labelPrintGroups = useMemo(() => buildLabelPrintGroups(editableLabels), [editableLabels]);
  const [showChecklist, setShowChecklist] = useState(false);
  // カテゴリ別ブロックは既定で閉じておく。開いたブロックのぶんだけQRを描く。
  // 在庫一覧グループは数百枚あり、全部を一度に描くとブラウザが固まるため（2026-08-15 実測）。
  const [openGroupNames, setOpenGroupNames] = useState<string[]>([]);
  const openGroupNameSet = useMemo(() => new Set(openGroupNames), [openGroupNames]);

  // 「今日の荷受分」。荷受日＝配送伝票のバーコードを読んだ時点で、入庫日とは別物。
  const [receivedDate, setReceivedDate] = useState<string>(() => todayInTokyo());
  const [excludeAccessories, setExcludeAccessories] = useState(true);
  const receivedQuery = trpc.inventory.inboundDesk.receivedLabelsOn.useQuery(
    { date: receivedDate },
    { enabled: /^\d{4}-\d{2}-\d{2}$/.test(receivedDate), staleTime: 30_000 },
  );
  // その日に届いたものは引当先をまたぐうえ、在庫用や、発注一覧のページから外れたものも混ざる。
  // 画面が持っているラベルから引き直すと取りこぼすので、サーバーが返した行から組み立てる。
  const receivedDateLabels = useMemo(() => {
    const rows = receivedQuery.data?.labels ?? [];
    if (rows.length === 0) return [];
    const knownByLabelId = new Map(
      editableAllLabels.map((label) => [label.labelId.trim().toUpperCase(), label]),
    );
    return rows.flatMap((row) => {
      // 消耗品（ケーブル・バッテリー等）はラベルを貼らない方針のため既定で外す
      if (excludeAccessories && isStockProposalAccessory(row.title, row.category)) return [];
      const known = knownByLabelId.get(row.labelId);
      if (known) return [known];
      // 画面に無いものは、印刷に要る項目だけを組み立てて出す
      const fallback: LabelView = {
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
      return [applyLabelTitleOverride(fallback, labelTitleOverrides)];
    });
  }, [editableAllLabels, excludeAccessories, labelTitleOverrides, receivedQuery.data]);

  const toggleGroupOpen = (name: string) => {
    setOpenGroupNames((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  const toggleGroup = (keys: string[], checked: boolean) => {
    setSelectedKeys((current) => {
      if (checked) return Array.from(new Set([...current, ...keys]));
      const removing = new Set(keys);
      return current.filter((key) => !removing.has(key));
    });
  };

  useEffect(() => {
    const visibleKeys = new Set(labels.map((label) => label.key));
    setSelectedKeys((current) => current.filter((key) => visibleKeys.has(key)));
  }, [labels]);

  useEffect(() => {
    saveLabelTitleOverrides(labelTitleOverrides);
  }, [labelTitleOverrides]);

  const toggleLabel = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      if (checked) return current.includes(key) ? current : [...current, key];
      return current.filter((item) => item !== key);
    });
  };

  const updateLabelTitle = (label: LabelView, value: string) => {
    const titleKey = normalizeLabelTitleKey(label.title || label.printTitle);
    setLabelTitleOverrides((current) => {
      const next: LabelTitleOverrideState = {
        byLabelId: { ...current.byLabelId },
        byTitleKey: { ...current.byTitleKey },
      };
      if (value.trim()) {
        next.byLabelId[label.labelId] = value;
        if (titleKey) next.byTitleKey[titleKey] = value;
      } else {
        delete next.byLabelId[label.labelId];
        if (titleKey) delete next.byTitleKey[titleKey];
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">ラベル印刷</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              チェックした商品IDだけを印刷できます。未選択の場合は表示中のラベルを印刷します。
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="label-start-position" className="text-sm font-medium">
                開始位置
              </label>
              <Input
                id="label-start-position"
                type="number"
                min={1}
                max={LABELS_PER_SHEET}
                value={startPosition}
                onChange={(event) => onStartPositionChange(Number(event.target.value))}
                // 既存の値が残ったまま打つと 1 -> 19 になる。触った時点で選択しておく。
                onFocus={(event) => event.currentTarget.select()}
                className="h-9 w-20"
              />
              <span className="text-xs text-muted-foreground">
                面目から（左上が1・右へ2・3、次の段が4）。使いかけのシートの続きから刷るときに変える
              </span>
            </div>
            <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="label-received-date" className="text-sm font-medium">
                  荷受日
                </label>
                <Input
                  id="label-received-date"
                  type="date"
                  value={receivedDate}
                  onChange={(event) => setReceivedDate(event.target.value)}
                  className="h-9 w-40"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-fit gap-2 border-emerald-300 bg-white"
                  disabled={receivedQuery.isLoading || receivedDateLabels.length === 0}
                  onClick={() => onPrintLabels(receivedDateLabels)}
                >
                  <Printer className="h-4 w-4" />
                  {receivedQuery.isLoading
                    ? "荷受分を確認中…"
                    : `この日の荷受分 ${receivedDateLabels.length}件を印刷`}
                </Button>
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={excludeAccessories}
                    onChange={(event) => setExcludeAccessories(event.target.checked)}
                    className="h-3.5 w-3.5 accent-emerald-700"
                  />
                  消耗品（ケーブル・バッテリー等）を除く
                </label>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                配送伝票のバーコードを読んだ日で数えます（動作確認の前後は問いません）。
                <strong>引当先の選択に関係なく、その日に届いたぶんを全部</strong>刷ります。
                貼るのは動作確認を通ってからで、不良になったぶんの紙は捨ててください。
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={editableLabels.length === 0}
              onClick={() => setSelectedKeys(editableLabels.map((label) => label.key))}
            >
              全選択
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={selectedCount === 0}
              onClick={() => setSelectedKeys([])}
            >
              選択解除
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-fit gap-2"
              disabled={currentPrintLabels.length === 0}
              onClick={() => onPrintLabels(currentPrintLabels)}
            >
              <Printer className="h-4 w-4" />
              ラベルを印刷
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-fit gap-2"
              disabled={editableAllLabels.length === 0}
              onClick={() => onPrintLabels(editableAllLabels)}
            >
              <Printer className="h-4 w-4" />
              全インボイスを印刷
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-fit gap-2"
              onClick={() => setShowChecklist((current) => !current)}
            >
              <ClipboardList className="h-4 w-4" />
              {showChecklist ? "ラベル表示に戻す" : "確認シート"}
            </Button>
            {showChecklist ? (
              <Button
                type="button"
                variant="outline"
                className="w-fit gap-2"
                disabled={currentPrintLabels.length === 0}
                onClick={() => onPrintChecklist(currentPrintLabels)}
              >
                <Printer className="h-4 w-4" />
                確認シートを印刷
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      {editableLabels.length === 0 ? (
        <EmptyState icon={Tag} title="印刷できる商品IDがありません" />
      ) : showChecklist ? (
        <LabelChecklistView labels={currentPrintLabels} />
      ) : (
        <div className="space-y-4">
          {labelPrintGroups.map((group) => {
            const groupKeys = group.labels.map((label) => label.key);
            const checkedCount = groupKeys.filter((key) => selectedKeySet.has(key)).length;
            const allChecked = checkedCount === groupKeys.length;
            const isOpen = openGroupNameSet.has(group.name);
            return (
              <section key={group.name} className="overflow-hidden rounded-md border bg-background">
                <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-4 py-3">
                  <input
                    type="checkbox"
                    aria-label={`${group.name} をまとめて選択`}
                    checked={allChecked}
                    ref={(node) => {
                      // 一部だけ選ばれている状態を見せる
                      if (node) node.indeterminate = !allChecked && checkedCount > 0;
                    }}
                    onChange={(event) => toggleGroup(groupKeys, event.target.checked)}
                    className="h-4 w-4 accent-emerald-700"
                  />
                  <button
                    type="button"
                    className="flex flex-1 flex-wrap items-center gap-2 text-left"
                    aria-expanded={isOpen}
                    onClick={() => toggleGroupOpen(group.name)}
                  >
                    <ChevronDown
                      className={cn("h-4 w-4 shrink-0 transition-transform", !isOpen && "-rotate-90")}
                    />
                    <span className="text-sm font-semibold">{group.name}</span>
                    <Badge variant="outline">{group.labels.length}枚</Badge>
                    {checkedCount > 0 ? <Badge variant="secondary">選択 {checkedCount}</Badge> : null}
                    {!isOpen ? (
                      <span className="text-xs text-muted-foreground">開くと1枚ずつ確認できます</span>
                    ) : null}
                  </button>
                </div>
                {!isOpen ? null : (
                <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                  {group.labels.map((label) => {
                    const checked = selectedKeySet.has(label.key);
                    return (
                      <div
                        key={label.key}
                        className={cn(
                          "rounded-md border bg-white p-4 shadow-sm",
                          checked && "border-emerald-500 ring-1 ring-emerald-500",
                        )}
                      >
                        <label className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(event) => toggleLabel(label.key, event.target.checked)}
                            className="h-4 w-4 accent-emerald-700"
                          />
                          印刷対象
                        </label>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="font-mono text-2xl font-bold tracking-wide text-slate-950">{label.labelId}</div>
                            {label.allocationLabel ? (
                              <div className="mt-1 text-sm font-semibold text-slate-700">{label.allocationLabel}</div>
                            ) : null}
                          </div>
                          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded border bg-white p-2">
                            <ProductQrCode value={label.labelId} />
                          </div>
                        </div>
                        <label
                          className="mt-3 block text-xs font-medium text-muted-foreground"
                          htmlFor={`label-title-${label.key}`}
                        >
                          ラベル商品名
                        </label>
                        <Input
                          id={`label-title-${label.key}`}
                          className="mt-1"
                          value={label.printTitle}
                          onChange={(event) => updateLabelTitle(label, event.target.value)}
                        />
                      </div>
                    );
                  })}
                </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LabelPrintStyles() {
  return (
    <style>{`
      .label-print-root {
        display: none;
      }

      .checklist-print-root {
        display: none;
      }

      @media print {
        @page {
          size: 210mm 297mm;
          margin: 0;
        }

        html,
        body {
          width: 210mm !important;
          min-width: 210mm !important;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }

        body {
          overflow: visible !important;
        }

        body > *:not(.label-print-root):not(.checklist-print-root):not(.docpack-print-root) {
          display: none !important;
        }

        .label-print-root {
          display: block !important;
          position: static !important;
          box-sizing: border-box;
          width: 210mm !important;
          min-height: 0;
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
          color: #0f172a !important;
        }

        .label-print-sheet {
          box-sizing: border-box;
          display: grid !important;
          grid-template-columns: repeat(3, 66mm);
          grid-template-rows: repeat(8, 33.9mm);
          column-gap: 3mm;
          row-gap: 0;
          width: 210mm !important;
          height: 297mm !important;
          min-height: 297mm !important;
          margin: 0 !important;
          padding: 12.9mm 3mm;
          align-content: start;
          justify-content: start;
          overflow: hidden;
        }

        .label-print-sheet:not(:last-child) {
          break-after: page;
          page-break-after: always;
        }

        .label-print-sheet:last-child {
          break-after: auto;
          page-break-after: auto;
        }

        .label-print-item {
          box-sizing: border-box;
          display: grid !important;
          grid-template-columns: minmax(0, 1fr) 20mm;
          column-gap: 2mm;
          align-items: center;
          width: 66mm;
          height: 33.9mm;
          overflow: hidden;
          padding: 2.4mm 2.8mm;
          break-inside: avoid;
          page-break-inside: avoid;
          color: #0f172a;
          background: #fff;
          font-family: Arial, sans-serif;
        }

        .label-print-box {
          border: 1.2mm solid #0f172a;
          padding: 1.4mm 1.8mm;
        }

        .label-print-box .label-print-id {
          font-size: 17pt;
          letter-spacing: 0.12em;
        }

        .label-print-id {
          margin-bottom: 1.2mm;
          font-family: Consolas, "Courier New", monospace;
          font-size: 13pt;
          font-weight: 700;
          line-height: 1.05;
          letter-spacing: 0.08em;
        }

        .label-print-ref {
          margin-bottom: 1mm;
          overflow: hidden;
          font-size: 6.6pt;
          line-height: 1.15;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .label-print-title {
          max-height: 11mm;
          overflow: hidden;
          font-size: 7.3pt;
          font-weight: 700;
          line-height: 1.18;
        }

        .label-print-qr {
          width: 20mm;
          height: 20mm;
          justify-self: end;
        }

        .label-print-qr svg {
          display: block !important;
          width: 100% !important;
          height: 100% !important;
        }

        .checklist-print-root {
          display: block !important;
          box-sizing: border-box;
          width: 210mm !important;
          padding: 10mm 8mm;
          color: #0f172a !important;
          background: #fff !important;
          font-family: Arial, sans-serif;
        }

        .checklist-print-head {
          margin-bottom: 4mm;
          font-size: 11pt;
          font-weight: 700;
        }

        .checklist-print-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 8.6pt;
        }

        .checklist-print-table th,
        .checklist-print-table td {
          border: 0.2mm solid #94a3b8;
          padding: 1.3mm 1.6mm;
          text-align: left;
        }

        /* ページをまたいでも見出し行を繰り返す */
        .checklist-print-table thead {
          display: table-header-group;
        }

        .checklist-print-table tr {
          break-inside: avoid;
          page-break-inside: avoid;
        }

        .checklist-print-group td {
          background: #e2e8f0;
          font-weight: 700;
        }

        .checklist-print-check {
          width: 9mm;
        }

        .checklist-print-idcol {
          width: 26mm;
          font-family: Consolas, "Courier New", monospace;
          font-weight: 700;
        }
      }
    `}</style>
  );
}

function PrintableLabelSheet({ labels, startPosition = 1 }: { labels: LabelView[]; startPosition?: number }) {
  const printableLabels = labels.filter((label) => label.labelId.trim());
  if (printableLabels.length === 0) return null;

  // 使いかけシートの手前の面は空送りする。
  const blankCount = clampLabelStartPosition(startPosition) - 1;
  const slots: Array<LabelView | null> = [...Array<null>(blankCount).fill(null), ...printableLabels];
  const labelPages = chunkArray(slots, LABELS_PER_SHEET);
  const sheet = (
    <div className="label-print-root" aria-hidden="true">
      {labelPages.map((pageSlots, pageIndex) => (
        <div key={`label-page-${pageIndex}`} className="label-print-sheet">
          {pageSlots.map((label, slotIndex) =>
            label ? (
              <div
                key={label.key}
                className={cn(
                  "label-print-item",
                  // 箱ID（B+6桁）だけ枠を付ける。商品IDは英字7文字なので B 始まりが普通にある
                  // （BARDNSY など）。startsWith("B") だと商品ラベルまで黒枠になっていた。
                  OUTBOUND_BOX_CODE_PATTERN.test(label.labelId) && "label-print-box",
                )}
              >
                <div>
                  <div className="label-print-id">{label.labelId}</div>
                  {label.allocationLabel ? <div className="label-print-ref">{label.allocationLabel}</div> : null}
                  <div className="label-print-title">{label.printTitle}</div>
                </div>
                <div className="label-print-qr">
                  <ProductQrCode value={label.labelId} />
                </div>
              </div>
            ) : (
              <div key={`label-blank-${pageIndex}-${slotIndex}`} className="label-print-item label-print-blank" />
            ),
          )}
        </div>
      ))}
    </div>
  );

  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
}

// 付箋の旧管理番号から商品IDを引くための一覧。棚を回る順に見られるようカテゴリごとにまとめ、
// その中は旧管理番号の順に並べる。
function buildChecklistRows(labels: LabelView[]): { name: string; labels: LabelView[] }[] {
  return buildLabelPrintGroups(labels).map((group) => ({
    name: group.name,
    labels: [...group.labels].sort((a, b) =>
      a.legacyManagementNo.localeCompare(b.legacyManagementNo, "ja", { numeric: true }),
    ),
  }));
}

function PrintableChecklistSheet({ labels }: { labels: LabelView[] }) {
  const groups = buildChecklistRows(labels);
  if (groups.length === 0) return null;
  const sheet = (
    <div className="checklist-print-root" aria-hidden="true">
      <div className="checklist-print-head">商品IDと旧管理番号の確認シート（{labels.length}件）</div>
      <table className="checklist-print-table">
        <thead>
          <tr>
            <th className="checklist-print-check">✓</th>
            <th className="checklist-print-idcol">商品ID</th>
            <th>旧管理番号</th>
            <th>商品名</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <Fragment key={group.name}>
              <tr className="checklist-print-group">
                <td colSpan={4}>
                  {group.name} - {group.labels.length}件
                </td>
              </tr>
              {group.labels.map((label) => (
                <tr key={label.key}>
                  <td className="checklist-print-check" />
                  <td className="checklist-print-idcol">{label.labelId}</td>
                  <td>{label.legacyManagementNo}</td>
                  <td>{label.title}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );

  return typeof document === "undefined" ? sheet : createPortal(sheet, document.body);
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

function proposalAveragePrice(total: number, quantity: number): number {
  return quantity > 0 ? Math.round(total / quantity) : 0;
}

function StockProposalPanel({ groups }: { groups: StockProposalGroup[] }) {
  const [averageModelFilter, setAverageModelFilter] = useState("all");
  const productCount = groups.reduce((total, group) => total + group.products.length, 0);
  const totalQuantity = groups.reduce((total, group) => total + group.totalQuantity, 0);
  const waitingQuantity = groups.reduce((total, group) => total + group.waitingQuantity, 0);
  const pricedQuantity = groups.reduce((total, group) => total + group.unitPriceQuantity, 0);
  const averagePrice = proposalAveragePrice(
    groups.reduce((total, group) => total + group.unitPriceTotal, 0),
    pricedQuantity,
  );
  const selectedAverageGroup = groups.find((group) => group.model === averageModelFilter) ?? null;
  const selectedAveragePrice = selectedAverageGroup
    ? proposalAveragePrice(selectedAverageGroup.unitPriceTotal, selectedAverageGroup.unitPriceQuantity)
    : averagePrice;
  const selectedAverageLabel = selectedAverageGroup?.model ?? "全体";

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">在庫提案サマリー</h2>
          <Badge variant="outline">{productCount.toLocaleString()}商品</Badge>
          <Badge variant="secondary">{totalQuantity.toLocaleString()}台</Badge>
          {waitingQuantity > 0 ? (
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">入庫待ち {waitingQuantity.toLocaleString()}台</Badge>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <div className="text-xs text-muted-foreground">現在庫</div>
            <div className="mt-1 font-semibold">{(totalQuantity - waitingQuantity).toLocaleString()}台</div>
          </div>
          <div className="rounded-md bg-amber-50 px-3 py-2">
            <div className="text-xs text-amber-700">入庫待ち</div>
            <div className="mt-1 font-semibold text-amber-800">{waitingQuantity.toLocaleString()}台</div>
          </div>
          <div className="rounded-md bg-emerald-50 px-3 py-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-emerald-700">平均仕入相場</div>
              <select
                className={cn(fieldClass, "h-8 min-w-0 bg-white px-2 text-xs sm:w-36")}
                value={selectedAverageGroup ? selectedAverageGroup.model : "all"}
                onChange={(event) => setAverageModelFilter(event.target.value)}
              >
                <option value="all">全体</option>
                {groups.map((group) => (
                  <option key={group.model} value={group.model}>
                    {group.model}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1 font-semibold text-emerald-800">
              {selectedAveragePrice > 0 ? formatCurrency(selectedAveragePrice) : "-"}
            </div>
            <div className="mt-1 text-xs text-emerald-700">{selectedAverageLabel}</div>
          </div>
        </div>
      </section>

      {groups.length === 0 ? (
        <EmptyState icon={Boxes} title="提案できる在庫がありません" />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <StockProposalGroupCard key={group.model} group={group} defaultOpen={false} />
          ))}
        </div>
      )}
    </div>
  );
}

function StockProposalGroupCard({ group, defaultOpen }: { group: StockProposalGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const averagePrice = proposalAveragePrice(group.unitPriceTotal, group.unitPriceQuantity);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-md border bg-background">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{group.model}</span>
              <Badge variant="secondary">{group.totalQuantity.toLocaleString()}台</Badge>
              {group.waitingQuantity > 0 ? (
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                  内 入庫待ち {group.waitingQuantity.toLocaleString()}台
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {group.products.length.toLocaleString()}商品 / 平均仕入相場 {averagePrice > 0 ? formatCurrency(averagePrice) : "-"}
            </div>
          </div>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t">
          <div className="divide-y md:hidden">
            {group.products.map((product) => (
              <StockProposalProductMobile key={product.key} product={product} />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">商品</th>
                  <th className="px-4 py-3 text-right font-medium">台数</th>
                  <th className="px-4 py-3 text-right font-medium">現在庫</th>
                  <th className="px-4 py-3 text-right font-medium">入庫待ち</th>
                  <th className="px-4 py-3 text-left font-medium">仕入相場</th>
                  <th className="px-4 py-3 text-left font-medium">管理番号</th>
                </tr>
              </thead>
              <tbody>
                {group.products.map((product) => (
                  <StockProposalProductRow key={product.key} product={product} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function stockProposalPriceLabel(product: StockProposalProduct): { main: string; sub: string } {
  const average = proposalAveragePrice(product.unitPriceTotal, product.unitPriceQuantity);
  if (average <= 0) return { main: "-", sub: "" };
  const min = product.minUnitPrice ?? average;
  const max = product.maxUnitPrice ?? average;
  return {
    main: `平均 ${formatCurrency(average)}`,
    sub: min === max ? "" : `${formatCurrency(min)} - ${formatCurrency(max)}`,
  };
}

function stockProposalManagementLabel(product: StockProposalProduct): string {
  const values = unique(product.details.map((detail) => detail.managementNo).filter((value) => value && value !== "-"));
  if (values.length === 0) return "-";
  const visible = values.slice(0, 4).join(" / ");
  return values.length > 4 ? `${visible} / ほか${values.length - 4}件` : visible;
}

function StockProposalProductRow({ product }: { product: StockProposalProduct }) {
  const price = stockProposalPriceLabel(product);
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3">
        <div className="font-medium">{product.title}</div>
        {product.waitingQuantity > 0 ? (
          <div className="mt-1 text-xs text-amber-700">内 入庫待ち {product.waitingQuantity.toLocaleString()}台</div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right font-semibold">{product.totalQuantity.toLocaleString()}台</td>
      <td className="px-4 py-3 text-right">{product.stockQuantity.toLocaleString()}台</td>
      <td className="px-4 py-3 text-right">{product.waitingQuantity > 0 ? `${product.waitingQuantity.toLocaleString()}台` : "-"}</td>
      <td className="px-4 py-3">
        <div className="font-medium">{price.main}</div>
        {price.sub ? <div className="mt-1 text-xs text-muted-foreground">{price.sub}</div> : null}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{stockProposalManagementLabel(product)}</td>
    </tr>
  );
}

function StockProposalProductMobile({ product }: { product: StockProposalProduct }) {
  const price = stockProposalPriceLabel(product);
  return (
    <div className="p-4">
      <div className="font-medium">{product.title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant="secondary">{product.totalQuantity.toLocaleString()}台</Badge>
        <Badge variant="outline">現在庫 {product.stockQuantity.toLocaleString()}台</Badge>
        {product.waitingQuantity > 0 ? (
          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">内 入庫待ち {product.waitingQuantity.toLocaleString()}台</Badge>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <div className="text-xs text-muted-foreground">仕入相場</div>
          <div className="mt-1 font-semibold">{price.main}</div>
          {price.sub ? <div className="mt-1 text-xs text-muted-foreground">{price.sub}</div> : null}
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <div className="text-xs text-muted-foreground">管理番号</div>
          <div className="mt-1 text-xs">{stockProposalManagementLabel(product)}</div>
        </div>
      </div>
    </div>
  );
}

function StockPanel({
  inventories,
  purchaseRows,
  unfinishedInvoices,
  searchText,
  viewMode,
  onOpenEdit,
}: {
  inventories: InventoryItem[];
  purchaseRows: PurchaseRow[];
  unfinishedInvoices?: PurchaseRegistrationInvoice[];
  searchText: string;
  viewMode: StockViewMode;
  onOpenEdit: (inventoryId: number) => void;
}) {
  const allStockItems = buildStockItemViewsFromInventories(inventories);
  const stockItems = searchText
    ? allStockItems.filter((item) => buildStockSearchText(item).includes(searchText))
    : allStockItems;
  const stockGroups = buildStockItemGroups(stockItems);
  const proposalGroups = buildStockProposalGroups(allStockItems, purchaseRows, searchText, unfinishedInvoices);
  const stockQuantityTotal = stockItems.reduce((total, item) => total + item.quantity, 0);

  if (viewMode === "proposal") {
    return <StockProposalPanel groups={proposalGroups} />;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">在庫一覧</h2>
          <Badge variant="outline">{stockItems.length.toLocaleString()}件</Badge>
          <Badge variant="secondary">{stockQuantityTotal.toLocaleString()}点</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          商品IDが未発行の在庫も含めて、機種ごとに表示します。
        </p>
      </section>
      {stockItems.length === 0 ? (
        <EmptyState icon={Boxes} title="在庫がありません" />
      ) : (
        <div className="overflow-hidden rounded-md border bg-background">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">ID</th>
                  <th className="px-4 py-3 text-left font-medium">商品</th>
                  <th className="px-4 py-3 text-left font-medium">引当先</th>
                  <th className="px-4 py-3 text-left font-medium">仕入先</th>
                  <th className="px-4 py-3 text-left font-medium">仕入単価</th>
                  <th className="px-4 py-3 text-left font-medium">状態</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {stockGroups.map((group) => (
                  <Fragment key={group.name}>
                    <tr key={`${group.name}-header`} className="border-b bg-slate-50">
                      <td colSpan={7} className="px-4 py-2 text-xs font-medium text-muted-foreground">
                        棚 {group.name} - {group.quantity.toLocaleString()}点
                      </td>
                    </tr>
                    {group.items.map((item) => (
                      <tr key={item.key} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          {item.labelId ? (
                            <span className="font-mono text-base font-semibold text-emerald-800">{item.labelId}</span>
                          ) : (
                            <Badge variant="outline">未発行</Badge>
                          )}
                          {item.quantity > 1 ? (
                            <div className="mt-1 text-xs text-muted-foreground">{item.quantity.toLocaleString()}点</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{item.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {item.legacyManagementNo}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant="secondary" className="font-mono">{item.allocationLabel}</Badge>
                        </td>
                        <td className="px-4 py-3">
                          {item.supplier.url ? (
                            <a
                              href={item.supplier.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-700 hover:underline"
                            >
                              {item.supplier.name}
                            </a>
                          ) : (
                            item.supplier.name
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div>{formatCurrency(item.unitPrice)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{formatDate(item.purchaseDate)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">{item.status}</Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
                            onClick={() => onOpenEdit(item.inventoryId)}
                          >
                            <Pencil className="h-4 w-4" />
                            編集
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
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
  const shippedBoxes = boxes.filter((box) => box.status === "shipped");
  const openBoxes = boxes.filter((box) => box.status === "open");
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
              <div key={item.id} className="flex items-center justify-between gap-2 rounded border p-2 text-sm">
                <div><span className="font-mono font-bold">{item.labelId}</span><span className="ml-2">{item.title}</span><span className="ml-2 text-xs text-muted-foreground">{item.legacyManagementNo}</span></div>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => removeItem.mutate({ boxCode: currentBox.boxCode, labelId: item.labelId })}>取り消す</Button>
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
          {linkBoxCode && sealedBoxes.some(box => box.boxCode === linkBoxCode) ? (
            <BoxDeclarationPanel boxCode={linkBoxCode} />
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

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof PackageCheck;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex min-h-[180px] flex-col items-center justify-center rounded-lg border bg-background p-6 text-center text-muted-foreground">
      <Icon className="mb-2 h-6 w-6" />
      <div className="font-medium text-foreground">{title}</div>
      {description ? <p className="mt-1 max-w-lg text-sm">{description}</p> : null}
    </div>
  );
}

export default function PurchaseRegistration() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showGlobalMissingTracking, setShowGlobalMissingTracking] = useState(false);
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

  const globalMissingTrackingRows = useMemo(() => {
    return normalizePurchaseRegistrationRows(allPurchaseRows)
      .filter((row) => !hasPurchaseTracking(row))
      .sort(comparePurchaseRegistrationOrder);
  }, [allPurchaseRows]);

  const visibleGlobalMissingTrackingRows = useMemo(() => {
    if (!searchText) return globalMissingTrackingRows;
    return globalMissingTrackingRows.filter((row) => buildSearchText(row).includes(searchText));
  }, [globalMissingTrackingRows, searchText]);

  const selectedBulkTrackingRows = useMemo(
    () => visibleGlobalMissingTrackingRows.filter((row) => selectedMissingTrackingRowIds.has(row.id)),
    [selectedMissingTrackingRowIds, visibleGlobalMissingTrackingRows],
  );

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
  const selectedShippingLabels = useMemo(() => {
    const selectedKey = selectedShippingGroup?.key;
    const receivedForGroup = selectedKey
      ? receivedShippingLabels.filter((label) => groupKeyFromLabel(label) === selectedKey)
      : receivedShippingLabels;
    return mergeLabelViewsById(receivedForGroup, selectedShippingGroup?.labels ?? []);
  }, [receivedShippingLabels, selectedShippingGroup]);
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
  const selectedEbayStockItems = useMemo(
    () => selectedIsEbayGroup
      ? allStockItems.filter((item) => (
        isEbayManagementNo(item.legacyManagementNo) &&
        (!searchText || buildStockSearchText(item).includes(searchText))
      ))
      : [],
    [allStockItems, searchText, selectedIsEbayGroup],
  );
  const selectedInvoiceStockItems = useMemo(
    () => filterInvoiceStockItems(allStockItems, selectedInvoiceNo, selectedRowInventoryIds),
    [allStockItems, selectedInvoiceNo, selectedRowInventoryIds],
  );
  const selectedInvoiceStockProducts = useMemo(
    () => buildInvoiceStockProductSummaries(selectedInvoiceStockItems, selectedInvoiceNo, selectedRowInventoryIds),
    [selectedInvoiceNo, selectedInvoiceStockItems, selectedRowInventoryIds],
  );
  const selectedBaseProducts = useMemo(
    () => [
      ...buildProductSummaries(selectedRows, selectedInvoiceProducts?.products ?? []),
      ...selectedInvoiceStockProducts,
    ],
    [selectedInvoiceProducts?.products, selectedInvoiceStockProducts, selectedRows],
  );
  const selectedProducts = withInvoiceProductCounts(selectedBaseProducts, selectedInvoiceProducts?.products ?? [])
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
      return filterStockItemsByProductDetail(selectedInvoiceStockItems, productDetailFilter);
    },
    [productDetailFilter, selectedEbayStockItems, selectedInvoiceStockItems, selectedIsEbayGroup],
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
      const validIds = new Set(globalMissingTrackingRows.map((row) => row.id));
      const next = new Set(Array.from(current).filter((id) => validIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [globalMissingTrackingRows]);

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
                      一覧 {globalMissingTrackingRows.length.toLocaleString()}
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
                    totalCount={globalMissingTrackingRows.length}
                    selectedRowIds={selectedMissingTrackingRowIds}
                    onSelectRow={handleSelectMissingTrackingRow}
                    onSelectAllRows={handleSelectAllMissingTrackingRows}
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


