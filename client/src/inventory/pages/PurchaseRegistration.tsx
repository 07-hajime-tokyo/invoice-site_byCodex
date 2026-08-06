import { Fragment, useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { detectCarrier, getCarrierColor, type Carrier } from "@/inventory/lib/tracking";
import { extractManagementHints, extractModel, extractPreferredModel, suggestCsvProduct } from "@shared/productMatching";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Boxes,
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  PackageCheck,
  PackagePlus,
  Printer,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  Tag,
  Truck,
} from "lucide-react";

interface InventoryItemLabel {
  id?: number;
  labelId: string;
  status?: string | null;
  legacyManagementNo?: string | null;
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
  status?: string | null;
  csvSupplierName?: string | null;
  csvSupplierUrl?: string | null;
  extra?: { trackingNumber?: string | null; carrier?: string | null } | null;
  purchase_items: PurchaseItem[];
}

type StatusFilter = "all" | "ordered" | "received";
type WorkflowTab = "order" | "labels" | "scan" | "stock" | "shipping" | "returns";

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
  legacyManagementNo: string;
  allocationLabel: string;
  unitPrice: number;
  supplier: SupplierView;
  purchaseDate: string;
  rowId: number;
  itemId: number;
}

type LabelPrintRequest = (labels: LabelView[]) => void;

interface StockItemView {
  key: string;
  labelId: string | null;
  status: string;
  title: string;
  legacyManagementNo: string;
  allocationLabel: string;
  unitPrice: number;
  quantity: number;
  supplier: SupplierView;
  purchaseDate: string;
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
  const num = trackingNumber.trim().replace(/[\s-]/g, "");
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
  };
}

function parseEtc(etc?: string | null): { managementNo: string; supplierSite: string } {
  if (!etc) return { managementNo: "", supplierSite: "" };
  const parts = etc.split(",").map((part) => part.trim());
  return {
    managementNo: parts[0] ?? "",
    supplierSite: parts[2] ?? "",
  };
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

function getManagementNos(items: PurchaseItem[]): string[] {
  return unique(
    items.flatMap((item) => {
      const parsed = parseEtc(item.etc);
      const labelNos = (item.itemLabels ?? []).map((label) => label.legacyManagementNo ?? "");
      return [parsed.managementNo, ...labelNos];
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

function getInvoiceInfo(row: PurchaseRow): { key: string; invoiceNo: string; partner: string } {
  for (const managementNo of getManagementNos(row.purchase_items)) {
    const parsed = parseInvoiceFromManagementNo(managementNo);
    if (parsed) {
      return {
        key: `invoice-${parsed.invoiceNo}`,
        invoiceNo: parsed.invoiceNo,
        partner: parsed.partner,
      };
    }
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
  if (filter === "received") return isReceived(row);
  return !isReceived(row);
}

function visiblePurchaseItems(row: PurchaseRow): PurchaseItem[] {
  if (!isReceived(row)) return row.purchase_items;
  return row.purchase_items.filter((item) => itemStockQuantity(item) > 0);
}

function withVisiblePurchaseItems(row: PurchaseRow): PurchaseRow | null {
  const purchaseItems = visiblePurchaseItems(row);
  if (purchaseItems.length === 0) return null;
  return purchaseItems.length === row.purchase_items.length ? row : { ...row, purchase_items: purchaseItems };
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

function displayProductTitle(item: PurchaseItem): string {
  const title = item.title?.trim() || "-";
  const managementNo = parseEtc(item.etc).managementNo;
  const text = `${managementNo} ${title}`;

  if (hasAnyProductText(text, ["どうぶつの森", "animal crossing"])) return "New 3DS LL どうぶつの森";
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

type CsvProductCandidate = { name: string; qty: number };

function suggestInvoiceProductName(
  title: string,
  managementNo: string,
  candidates: CsvProductCandidate[],
): string | null {
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
  const matchText = purchaseItemMatchTexts(item).join(" ");
  const rawTitle = item.title?.trim() || title;
  return (
    suggestInvoiceProductNameFromHints(rawTitle, managementHints, [{ name: targetTitle, qty: 1 }]) === targetTitle ||
    suggestInvoiceProductNameFromHints(title, managementHints, [{ name: targetTitle, qty: 1 }]) === targetTitle ||
    suggestInvoiceProductName(matchText, managementHints.join(" "), [{ name: targetTitle, qty: 1 }]) === targetTitle
  );
}

function filterRowsByProductDetail(rows: PurchaseRow[], filter: ProductDetailFilter | null): PurchaseRow[] {
  if (!filter) return rows;
  return rows.flatMap((row) => {
    const purchaseItems = row.purchase_items.filter((item) => {
      if (filter.productKey && !purchaseItemMatchesProduct(item, filter.productKey, filter.productTitle)) return false;
      if (filter.mode === "stock") return isReceived(row) && itemStockQuantity(item) > 0;
      return !isReceived(row);
    });
    return purchaseItems.length > 0 ? [{ ...row, purchase_items: purchaseItems }] : [];
  });
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

function statusLabel(row: PurchaseRow): string {
  return isReceived(row) ? "入庫済み" : "発注済み / 未入庫";
}

function statusClass(row: PurchaseRow): string {
  return isReceived(row)
    ? "border-emerald-200 bg-emerald-50 text-emerald-700"
    : "border-amber-200 bg-amber-50 text-amber-700";
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

function formatLabelPrintTitle(value: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/ランダムカラー/g, "Random color"],
    [/ホワイトベース/g, "White base"],
    [/限定版/g, "Limited edition"],
    [/ミント\s*[×xX]\s*ホワイト/g, "Mint x White"],
    [/ホワイト\s*[×xX]\s*ミント/g, "White x Mint"],
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
    [/ピアノ\s*[・･]?\s*ブラック/g, "Piano Black"],
    [/セラミック\s*[・･]?\s*ホワイト/g, "Ceramic White"],
    [/ミスティ\s*ピンク/g, "Misty Pink"],
    [/レッド\s*[・･]\s*ブルー\s*[・･]\s*ホワイト/g, "Red, Blue, White"],
    [/ブルー\s*[・･]\s*ホワイト/g, "Blue, White"],
    [/レッド\s*[・･]\s*ホワイト/g, "Red, White"],
    [/レッド\s*[・･]\s*ブルー/g, "Red, Blue"],
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

function buildLabelViews(rows: PurchaseRow[]): LabelView[] {
  return rows.flatMap((row) => {
    const supplier = getSupplier(row);
    return row.purchase_items.flatMap((item) => {
      const managementNo = parseEtc(item.etc).managementNo;
      const title = actualProductTitle(item);
      return (item.itemLabels ?? []).map((label) => {
        const legacyManagementNo = label.legacyManagementNo || managementNo || "-";
        return {
          key: `${row.id}-${item.id}-${label.id ?? label.labelId}`,
          labelId: label.labelId,
          rawStatus: label.status ?? "",
          status: labelStatusLabel(label.status),
          title,
          printTitle: formatLabelPrintTitle(title),
          legacyManagementNo,
          allocationLabel: labelAllocationLabel(legacyManagementNo),
          unitPrice: toNumber(item.unit_price),
          supplier,
          purchaseDate: row.purchase_date ?? item.estimated_purchase_date ?? "",
          rowId: row.id,
          itemId: item.id,
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

function ProductQrCode({ value }: { value: string }) {
  const matrix = useMemo(() => createQrMatrix(value), [value]);
  const quietZone = 2;
  const size = matrix.length + quietZone * 2;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`QR ${value}`} className="h-full w-full bg-white">
      <rect width={size} height={size} fill="white" />
      {matrix.map((row, y) => (
        <g key={y}>
          {row.map((dark, x) =>
            dark ? (
              <rect key={x} x={x + quietZone} y={y + quietZone} width="1" height="1" fill="#0f172a" />
            ) : null,
          )}
        </g>
      ))}
    </svg>
  );
}

function isStockLabel(label: LabelView): boolean {
  const status = label.rawStatus.trim().toLowerCase();
  return status === "stocked" || status === "received";
}

function stockModelName(title: string): string {
  const compact = compactProductText(title);
  if (compact.includes("new3dsll") || compact.includes("new3dsxl")) return "New 3DS LL";
  if (compact.includes("new3ds")) return "New 3DS";
  if (compact.includes("new2dsll") || compact.includes("new2dsxl")) return "New 2DS LL";
  if (compact.includes("3dsll") || compact.includes("3dsxl")) return "3DS LL";
  if (compact.includes("2ds")) return "2DS";
  if (compact.includes("3ds")) return "3DS";
  if (compact.includes("vita2000") || compact.includes("psvita2000")) return "PS Vita 2000";
  if (compact.includes("vita1000") || compact.includes("psvita1000")) return "PS Vita 1000";
  if (compact.includes("psp3000")) return "PSP 3000";
  if (compact.includes("psp2000")) return "PSP 2000";
  if (compact.includes("psp1000")) return "PSP 1000";
  if (compact.includes("switch")) return "Switch";
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
  "PS Vita 2000",
  "PS Vita 1000",
  "PSP 3000",
  "PSP 2000",
  "PSP 1000",
  "Switch",
  "シャフト",
  "その他",
];

function buildStockItemViews(rows: PurchaseRow[]): StockItemView[] {
  return rows.flatMap((row) => {
    const supplier = getSupplier(row);
    return row.purchase_items.flatMap((item) => {
      const title = actualProductTitle(item);
      const managementNo = parseEtc(item.etc).managementNo;
      const purchaseDate = row.purchase_date ?? item.estimated_purchase_date ?? "";
      const labels = (item.itemLabels ?? [])
        .filter((label) => {
          const status = (label.status ?? "").trim().toLowerCase();
          return status === "stocked" || status === "received";
        })
        .map((label) => {
          const legacyManagementNo = label.legacyManagementNo || managementNo || "-";
          return {
            key: `label-${row.id}-${item.id}-${label.id ?? label.labelId}`,
            labelId: label.labelId,
            status: labelStatusLabel(label.status),
            title,
            legacyManagementNo,
            allocationLabel: labelAllocationLabel(legacyManagementNo),
            unitPrice: toNumber(item.unit_price),
            quantity: 1,
            supplier,
            purchaseDate,
          };
        });
      const missingLabelQuantity = Math.max(0, itemStockQuantity(item) - labels.length);
      if (missingLabelQuantity <= 0) return labels;
      const fallbackManagementNo = managementNo || "-";
      return [
        ...labels,
        {
          key: `unlabeled-${row.id}-${item.id}`,
          labelId: null,
          status: "在庫",
          title,
          legacyManagementNo: fallbackManagementNo,
          allocationLabel: labelAllocationLabel(fallbackManagementNo),
          unitPrice: toNumber(item.unit_price),
          quantity: missingLabelQuantity,
          supplier,
          purchaseDate,
        },
      ];
    });
  });
}

function buildStockItemGroups(items: StockItemView[]): { name: string; items: StockItemView[]; quantity: number }[] {
  const map = new Map<string, StockItemView[]>();
  for (const item of items) {
    const name = stockModelName(item.title);
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

function buildProductSummaries(rows: PurchaseRow[]): ProductSummary[] {
  const map = new Map<string, ProductSummary>();
  for (const row of rows) {
    for (const item of row.purchase_items) {
      const title = displayProductTitle(item);
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
      if (isReceived(row)) {
        current.secured += Math.min(quantity, itemStockQuantity(item));
      } else {
        current.waiting += quantity;
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

function invoiceNoFromGroupKey(key?: string | null): string | null {
  const match = key?.match(/^invoice-(\d+)$/);
  return match?.[1] ?? null;
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
    const matchText = unique([...(product.matchTexts ?? []), ...managementHints]).join(" ");
    const titleSuggestion =
      suggestInvoiceProductNameFromHints(product.title, managementHints, candidates) ??
      (product.title.trim() ? suggestInvoiceProductName(product.title, managementHints.join(" "), candidates) : null);
    const suggestedName =
      suggestInvoiceProductNameFromHints("", managementHints, candidates) ??
      titleSuggestion ??
      (matchText.trim() ? suggestInvoiceProductName(matchText, managementHints.join(" "), candidates) : null);
    const suggestedKey = suggestedName ? productKey(suggestedName) : "";
    const matchedKey =
      suggestedKey && summariesByInvoiceKey.has(suggestedKey)
        ? suggestedKey
        : direct
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

function filterRowsByProducts(rows: PurchaseRow[], products: ProductSummary[]): PurchaseRow[] {
  if (products.length === 0) return [];
  return rows.flatMap((row) => {
    const purchaseItems = row.purchase_items.filter((item) =>
      products.some((product) => purchaseItemMatchesProduct(item, product.key, product.title)),
    );
    return purchaseItems.length > 0 ? [{ ...row, purchase_items: purchaseItems }] : [];
  });
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
      if (key !== OTHER_INVOICE_KEY && shouldFilterClosedInvoices && !invoiceSummaryByKey.has(key)) return [];
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
      const label =
        invoiceInfo.key === OTHER_INVOICE_KEY
          ? "在庫"
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
    return b.key.localeCompare(a.key, "ja", { numeric: true });
  });
}

function getAllRowsFromGroup(group: AllocationGroup | null, fallbackRows: PurchaseRow[]): PurchaseRow[] {
  if (!group) return fallbackRows;
  return group.rows;
}

function PurchaseRegistrationCard({ row, onPrintLabels }: { row: PurchaseRow; onPrintLabels: LabelPrintRequest }) {
  const labels = getItemLabels(row.purchase_items);
  const managementNos = getManagementNos(row.purchase_items);
  const supplier = getSupplier(row);
  const totalQuantity = sumQuantity(row.purchase_items);
  const currentStockQuantity = row.purchase_items.reduce((total, item) => total + itemStockQuantity(item), 0);
  const firstItem = row.purchase_items[0];
  const displayItems = row.purchase_items.slice(0, 4);
  const hiddenItemCount = Math.max(0, row.purchase_items.length - displayItems.length);
  const unitPrice = firstItem?.unit_price;
  const trackingNumber = row.extra?.trackingNumber?.trim();
  const trackingInfo = trackingNumber ? getPurchaseTrackingMeta(trackingNumber, row.extra?.carrier) : null;
  const rowLabels = buildLabelViews([row]);

  return (
    <section className="rounded-lg border bg-background shadow-sm">
      <div className="flex flex-col gap-4 border-b p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {labels.length > 0 ? (
              labels.slice(0, 8).map((label) => (
                <span
                  key={label.labelId}
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-lg font-semibold tracking-wide text-emerald-800"
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
            {!isReceived(row) && trackingNumber && trackingInfo ? (
              <span className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-sm font-semibold text-blue-900">
                <span className={`rounded px-1.5 py-0.5 text-xs ${getCarrierColor(trackingInfo.carrier)}`}>
                  {TRACKING_CARRIER_LABELS[trackingInfo.carrier]}
                </span>
                <span className="text-xs text-blue-700">追跡番号</span>
                <span className="font-mono text-base font-bold text-slate-950">{trackingNumber}</span>
                {trackingInfo.trackingUrl ? (
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-fit gap-2"
          disabled={rowLabels.length === 0}
          onClick={() => onPrintLabels(rowLabels)}
        >
          <Printer className="h-4 w-4" />
          ラベル印刷
        </Button>
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

      {labels.length > 0 ? (
        <details className="border-t px-4 py-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">商品ID一覧</summary>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {labels.map((label) => (
              <div key={`${label.id ?? label.labelId}-${label.labelId}`} className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="font-mono text-base font-semibold text-emerald-800">{label.labelId}</div>
                <div className="mt-1 text-xs text-muted-foreground">{labelStatusLabel(label.status)}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </section>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold tracking-tight">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function ProductFulfillmentTable({ products }: { products: ProductSummary[] }) {
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">充足状況</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">品目</th>
              <th className="px-4 py-3 text-right font-medium">必要</th>
              <th className="px-4 py-3 text-right font-medium">確保</th>
              <th className="px-4 py-3 text-right font-medium">不足</th>
              <th className="px-4 py-3 text-right font-medium">平均仕入</th>
              <th className="px-4 py-3 text-right font-medium">売価</th>
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
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
                    <td className="px-4 py-3 text-right">{product.required.toLocaleString()}</td>
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
                    <td className="px-4 py-3 text-right">
                      <Button type="button" variant="outline" size="sm">
                        仕入れを追加
                      </Button>
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
      <div className="overflow-x-auto">
        <table className={cn("w-full text-sm", stockOnly ? "min-w-[560px]" : "min-w-[1040px]")}>
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
                  <th className="px-4 py-3 text-right font-medium">不足</th>
                  <th className="px-4 py-3 text-right font-medium">平均仕入</th>
                  <th className="px-4 py-3 text-right font-medium">売価</th>
                </>
              ) : null}
              <th className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={stockOnly ? 4 : 10} className="px-4 py-8 text-center text-muted-foreground">
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
                        <td className="px-4 py-3 text-right">{product.required.toLocaleString()}</td>
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
                    <td className="px-4 py-3 text-right">
                      <Button type="button" variant="outline" size="sm">
                        仕入れを追加
                      </Button>
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

function OrderDashboard({
  group,
  rows,
  products: productsOverride,
  detailRows,
  productFilter,
  onProductFilter,
  onClearProductFilter,
  onPrintLabels,
}: {
  group: AllocationGroup | null;
  rows: PurchaseRow[];
  products?: ProductSummary[];
  detailRows?: PurchaseRow[];
  productFilter?: ProductDetailFilter | null;
  onProductFilter?: (filter: ProductDetailFilter) => void;
  onClearProductFilter?: () => void;
  onPrintLabels: LabelPrintRequest;
}) {
  const groupRows = getAllRowsFromGroup(group, rows);
  const displayRows = detailRows ?? groupRows;
  const products = productsOverride ?? group?.products ?? buildProductSummaries(groupRows);
  const labels = group?.labels ?? buildLabelViews(displayRows);
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

  return (
    <div className="space-y-5">
      <section className="rounded-md border bg-background">
        <div className="border-b bg-muted/30 px-4 py-3 text-sm text-muted-foreground">引当先を選ぶ</div>
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <StatCard label="充足" value={`${secured.toLocaleString()} / ${required.toLocaleString()} 点`} />
          <StatCard label="仕入合計" value={formatCurrency(purchaseTotal)} sub={`商品ID ${labels.length.toLocaleString()}件`} />
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

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <PackagePlus className="h-4 w-4 text-emerald-700" />
          仕入れ登録
          <Badge variant="outline">{displayRows.length}件</Badge>
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
          {displayRows.length === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title="該当する仕入れ登録がありません"
              description="充足状況の絞り込みを解除すると、すべての仕入れ登録を確認できます。"
            />
          ) : (
            displayRows.map((row) => <PurchaseRegistrationCard key={row.id} row={row} onPrintLabels={onPrintLabels} />)
          )}
        </div>
      </section>
    </div>
  );
}

function LabelPrintPanel({
  labels,
  allLabels,
  onPrintLabels,
}: {
  labels: LabelView[];
  allLabels: LabelView[];
  onPrintLabels: LabelPrintRequest;
}) {
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const selectedLabels = useMemo(
    () => labels.filter((label) => selectedKeySet.has(label.key)),
    [labels, selectedKeySet],
  );
  const currentPrintLabels = selectedLabels.length > 0 ? selectedLabels : labels;
  const selectedCount = selectedLabels.length;

  useEffect(() => {
    const visibleKeys = new Set(labels.map((label) => label.key));
    setSelectedKeys((current) => current.filter((key) => visibleKeys.has(key)));
  }, [labels]);

  const toggleLabel = (key: string, checked: boolean) => {
    setSelectedKeys((current) => {
      if (checked) return current.includes(key) ? current : [...current, key];
      return current.filter((item) => item !== key);
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
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-fit"
              disabled={labels.length === 0}
              onClick={() => setSelectedKeys(labels.map((label) => label.key))}
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
              disabled={allLabels.length === 0}
              onClick={() => onPrintLabels(allLabels)}
            >
              <Printer className="h-4 w-4" />
              全インボイスを印刷
            </Button>
          </div>
        </div>
      </section>

      {labels.length === 0 ? (
        <EmptyState icon={Tag} title="印刷できる商品IDがありません" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {labels.map((label) => {
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
                    <div className="mt-1 text-sm font-semibold text-slate-700">{label.allocationLabel}</div>
                  </div>
                  <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded border bg-white p-2">
                    <ProductQrCode value={label.labelId} />
                  </div>
                </div>
                <div className="mt-3 line-clamp-2 text-sm font-medium">{label.printTitle}</div>
              </div>
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

      @media print {
        @page {
          size: A4 portrait;
          margin: 0;
        }

        html,
        body {
          margin: 0 !important;
          padding: 0 !important;
          background: #fff !important;
        }

        body * {
          visibility: hidden !important;
        }

        .label-print-root,
        .label-print-root * {
          visibility: visible !important;
        }

        .label-print-root {
          display: block !important;
          position: absolute;
          left: 0;
          top: 0;
          width: 210mm;
          min-height: 297mm;
          background: #fff;
        }

        .label-print-sheet {
          display: grid;
          grid-template-columns: repeat(4, 52.5mm);
          grid-auto-rows: 29.7mm;
          width: 210mm;
          min-height: 297mm;
          align-content: start;
          justify-content: start;
        }

        .label-print-item {
          box-sizing: border-box;
          display: grid;
          grid-template-columns: minmax(0, 1fr) 15mm;
          column-gap: 1.5mm;
          align-items: center;
          width: 52.5mm;
          height: 29.7mm;
          overflow: hidden;
          padding: 2mm 2.2mm;
          break-inside: avoid;
          page-break-inside: avoid;
          color: #0f172a;
          background: #fff;
          font-family: Arial, sans-serif;
        }

        .label-print-id {
          margin-bottom: 1.2mm;
          font-family: Consolas, "Courier New", monospace;
          font-size: 12pt;
          font-weight: 700;
          line-height: 1.1;
          letter-spacing: 0;
        }

        .label-print-ref {
          margin-bottom: 1mm;
          overflow: hidden;
          font-size: 6.8pt;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .label-print-title {
          max-height: 8.6mm;
          overflow: hidden;
          font-size: 7.2pt;
          font-weight: 700;
          line-height: 1.2;
        }

        .label-print-qr {
          width: 15mm;
          height: 15mm;
        }

        .label-print-qr svg {
          width: 100%;
          height: 100%;
        }
      }
    `}</style>
  );
}

function PrintableLabelSheet({ labels }: { labels: LabelView[] }) {
  return (
    <div className="label-print-root" aria-hidden="true">
      <div className="label-print-sheet">
        {labels.map((label) => (
          <div key={label.key} className="label-print-item">
            <div>
              <div className="label-print-id">{label.labelId}</div>
              <div className="label-print-ref">{label.allocationLabel}</div>
              <div className="label-print-title">{label.printTitle}</div>
            </div>
            <div className="label-print-qr">
              <ProductQrCode value={label.labelId} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScanPanel({ labels }: { labels: LabelView[] }) {
  const [scanValue, setScanValue] = useState("");
  const normalized = scanValue.trim().toLowerCase();
  const matched = normalized
    ? labels.find(
        (label) =>
          label.labelId.toLowerCase() === normalized || label.legacyManagementNo.toLowerCase().includes(normalized),
      )
    : null;

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <h2 className="text-lg font-semibold">入庫スキャン</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
          <Input
            value={scanValue}
            onChange={(event) => setScanValue(event.target.value)}
            placeholder="商品IDまたは旧管理番号をスキャン"
          />
          <Button type="button" className="gap-2" disabled={!matched}>
            <CheckCircle2 className="h-4 w-4" />
            入庫確定
          </Button>
        </div>
      </section>

      {matched ? (
        <section className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 className="h-4 w-4" />
            対象IDを確認しました
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <StatCard label="商品ID" value={matched.labelId} sub={`旧管理番号: ${matched.legacyManagementNo}`} />
            <StatCard label="商品" value={matched.title} />
            <StatCard label="状態" value={matched.status} sub={matched.supplier.name} />
          </div>
        </section>
      ) : (
        <EmptyState icon={ScanLine} title="スキャン待ちです" />
      )}
    </div>
  );
}

function StockPanel({ rows }: { rows: PurchaseRow[] }) {
  const stockItems = buildStockItemViews(rows);
  const stockGroups = buildStockItemGroups(stockItems);
  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <h2 className="text-lg font-semibold">在庫一覧</h2>
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
                </tr>
              </thead>
              <tbody>
                {stockGroups.map((group) => (
                  <Fragment key={group.name}>
                    <tr key={`${group.name}-header`} className="border-b bg-slate-50">
                      <td colSpan={6} className="px-4 py-2 text-xs font-medium text-muted-foreground">
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

function ShippingPanel({ products }: { products: ProductSummary[] }) {
  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <h2 className="text-lg font-semibold">出庫</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto]">
          <Input placeholder="出庫する商品IDをスキャン" />
          <Button type="button" className="gap-2">
            <Truck className="h-4 w-4" />
            出庫確認
          </Button>
        </div>
      </section>
      <ProductFulfillmentTableV2 products={products} />
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
        <div className="rounded-md border bg-background p-4 text-sm text-muted-foreground">返品対象 {labels.length}件</div>
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
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [workflowTab, setWorkflowTab] = useState<WorkflowTab>("order");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [productDetailFilter, setProductDetailFilter] = useState<ProductDetailFilter | null>(null);
  const [labelsToPrint, setLabelsToPrint] = useState<LabelView[]>([]);
  const [printJobId, setPrintJobId] = useState(0);

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
    refetchOnWindowFocus: false,
  });

  const rows = (data?.items ?? []) as PurchaseRow[];
  const searchText = normalizedSearch.toLowerCase();
  const { data: purchaseRegistrationInvoices } =
    trpc.inventory.orderManagement.getPurchaseRegistrationInvoices.useQuery(undefined, {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    });

  const filteredRows = useMemo(() => {
    return rows.flatMap((row) => {
      if (!matchesStatus(row, statusFilter)) return [];
      if (searchText && !buildSearchText(row).includes(searchText)) return [];
      const visibleRow = withVisiblePurchaseItems(row);
      return visibleRow ? [visibleRow] : [];
    });
  }, [rows, searchText, statusFilter]);

  const groups = useMemo(
    () => buildAllocationGroups(filteredRows, purchaseRegistrationInvoices),
    [filteredRows, purchaseRegistrationInvoices],
  );
  const invoiceGroups = useMemo(() => groups.filter((group) => group.key !== OTHER_INVOICE_KEY), [groups]);
  const selectedGroup = invoiceGroups.find((group) => group.key === selectedGroupKey) ?? invoiceGroups[0] ?? null;
  const selectedRows = getAllRowsFromGroup(selectedGroup, filteredRows);
  const selectedInvoiceNo = invoiceNoFromGroupKey(selectedGroup?.key);
  const { data: selectedInvoiceProducts } = trpc.inventory.orderManagement.getInvoiceProducts.useQuery(
    { invoiceNo: selectedInvoiceNo ?? "0" },
    {
      enabled: Boolean(selectedInvoiceNo),
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  );
  const selectedLabels = selectedGroup?.labels ?? buildLabelViews(selectedRows);
  const allLabels = useMemo(() => buildLabelViews(rows), [rows]);
  const allInvoiceLabels = useMemo(() => invoiceGroups.flatMap((group) => group.labels), [invoiceGroups]);
  const stockLabels = useMemo(() => allLabels.filter(isStockLabel), [allLabels]);
  const allStockItems = useMemo(() => buildStockItemViews(rows), [rows]);
  const selectedBaseProducts = selectedGroup?.products ?? buildProductSummaries(selectedRows);
  const selectedProducts = withInvoiceProductCounts(selectedBaseProducts, selectedInvoiceProducts?.products ?? []);
  const selectedOpenProducts = selectedProducts.filter(hasOpenInvoiceQuantity);
  const selectedOpenRows = filterRowsByProducts(selectedRows, selectedOpenProducts);
  const selectedDetailRows = filterRowsByProductDetail(selectedOpenRows, productDetailFilter);

  const counts = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc.all += 1;
        if (isReceived(row)) acc.received += 1;
        else acc.ordered += 1;
        acc.labels += getItemLabels(row.purchase_items).length;
        acc.quantity += sumQuantity(row.purchase_items);
        return acc;
      },
      { all: 0, ordered: 0, received: 0, labels: 0, quantity: 0 },
    );
  }, [rows]);

  const workflowCounts = useMemo(
    () => ({
      order: filteredRows.length,
      labels: allLabels.length,
      scan: selectedLabels.length,
      stock: allStockItems.reduce((total, item) => total + item.quantity, 0),
      shipping: selectedOpenProducts.length,
      returns: 0,
    }),
    [allLabels.length, allStockItems, filteredRows.length, selectedLabels.length, selectedOpenProducts.length],
  );

  const handlePrintLabels = (targetLabels: LabelView[]) => {
    if (targetLabels.length === 0) return;
    setLabelsToPrint(targetLabels);
    setPrintJobId((current) => current + 1);
  };

  useEffect(() => {
    if (printJobId === 0 || labelsToPrint.length === 0) return;
    const timer = window.setTimeout(() => window.print(), 100);
    return () => window.clearTimeout(timer);
  }, [labelsToPrint, printJobId]);

  const isStockWorkflow = workflowTab === "stock";

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50/60">
      <LabelPrintStyles />
      <PrintableLabelSheet labels={labelsToPrint} />
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_188px]">
        <main className="space-y-5 p-4 md:p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">発注登録</h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge variant="outline" className="gap-1">
                  <PackagePlus className="h-3 w-3" />
                  仕入れ {counts.all.toLocaleString()}件
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Tag className="h-3 w-3" />
                  商品ID {counts.labels.toLocaleString()}件
                </Badge>
                <Badge variant="outline" className="gap-1">
                  <Boxes className="h-3 w-3" />
                  数量 {counts.quantity.toLocaleString()}個
                </Badge>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => refetch()} disabled={isFetching} className="w-fit gap-2">
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              更新
            </Button>
          </div>

          <section className="rounded-md border bg-background">
            <div className="grid gap-4 p-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)]">
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
                    インボイス
                  </div>
                  <select
                    className={fieldClass}
                    value={selectedGroup?.key ?? ""}
                    onChange={(event) => {
                      setSelectedGroupKey(event.target.value);
                      setProductDetailFilter(null);
                    }}
                  >
                    {invoiceGroups.length === 0 ? (
                      <option value="">対象なし</option>
                    ) : (
                      invoiceGroups.map((group) => (
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
                    現在庫 {workflowCounts.stock.toLocaleString()}点
                  </Badge>
                ) : (
                  <Tabs
                    value={statusFilter}
                    onValueChange={(value) => {
                      setStatusFilter(value as StatusFilter);
                      setProductDetailFilter(null);
                    }}
                    className="max-w-full"
                  >
                    <TabsList className="h-auto flex-wrap justify-start gap-1">
                      <TabsTrigger value="all">すべて {counts.all}</TabsTrigger>
                      <TabsTrigger value="ordered">未入庫 {counts.ordered}</TabsTrigger>
                      <TabsTrigger value="received">入庫済み {counts.received}</TabsTrigger>
                    </TabsList>
                  </Tabs>
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
              </div>
            </div>
          </section>

          {isLoading ? (
            <div className="flex min-h-[220px] items-center justify-center rounded-lg border bg-background text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              読み込み中
            </div>
          ) : !isStockWorkflow && groups.length === 0 ? (
            <EmptyState icon={PackageCheck} title="表示できる発注登録がありません" />
          ) : (
            <Tabs value={workflowTab} onValueChange={(value) => setWorkflowTab(value as WorkflowTab)} className="gap-4">
              <TabsContent value="order">
                <OrderDashboard
                  group={selectedGroup}
                  rows={filteredRows}
                  products={selectedOpenProducts}
                  detailRows={selectedDetailRows}
                  productFilter={productDetailFilter}
                  onProductFilter={setProductDetailFilter}
                  onClearProductFilter={() => setProductDetailFilter(null)}
                  onPrintLabels={handlePrintLabels}
                />
              </TabsContent>
              <TabsContent value="labels">
                <LabelPrintPanel labels={selectedLabels} allLabels={allInvoiceLabels} onPrintLabels={handlePrintLabels} />
              </TabsContent>
              <TabsContent value="scan">
                <ScanPanel labels={selectedLabels} />
              </TabsContent>
              <TabsContent value="stock">
                <StockPanel rows={rows} />
              </TabsContent>
              <TabsContent value="shipping">
                <ShippingPanel products={selectedOpenProducts} />
              </TabsContent>
              <TabsContent value="returns">
                <ReturnPanel labels={selectedLabels} />
              </TabsContent>
            </Tabs>
          )}

        </main>

        <aside className="border-t bg-background p-2 lg:min-h-[calc(100vh-4rem)] lg:border-l lg:border-t-0">
          <nav className="grid gap-1">
            {workflowTabs.map((tab) => {
              const Icon = tab.icon;
              const active = workflowTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setWorkflowTab(tab.value)}
                  className={cn(
                    "flex h-11 items-center justify-between rounded-md px-3 text-left text-sm transition-colors",
                    active
                      ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
                      : "text-slate-700 hover:bg-slate-100",
                  )}
                >
                  <span className="inline-flex items-center gap-2">
                    <Icon className="h-4 w-4" />
                    {tab.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
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
