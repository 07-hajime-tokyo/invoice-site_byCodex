import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { detectCarrier, getCarrierColor, type Carrier } from "@/inventory/lib/tracking";
import { suggestCsvProduct } from "@shared/productMatching";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Barcode,
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
  status: string;
  title: string;
  legacyManagementNo: string;
  supplier: SupplierView;
  purchaseDate: string;
  rowId: number;
  itemId: number;
}

interface ProductSummary {
  key: string;
  title: string;
  invoiceOrdered?: number;
  invoiceShipped?: number;
  required: number;
  secured: number;
  waiting: number;
  unitPriceTotal: number;
  unitPriceCount: number;
  sellingPrice?: number | null;
  sellingCurrency?: string | null;
}

type InvoiceProductSummary = {
  productName: string;
  orderQty: number;
  deliveredQty: number;
  sellingPrice?: number | null;
  currency?: string | null;
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

function purchaseItemMatchesProduct(item: PurchaseItem, targetKey: string): boolean {
  return productKey(displayProductTitle(item)) === targetKey;
}

function filterRowsByProductDetail(rows: PurchaseRow[], filter: ProductDetailFilter | null): PurchaseRow[] {
  if (!filter) return rows;
  return rows.flatMap((row) => {
    const purchaseItems = row.purchase_items.filter((item) => {
      if (filter.productKey && !purchaseItemMatchesProduct(item, filter.productKey)) return false;
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

function buildLabelViews(rows: PurchaseRow[]): LabelView[] {
  return rows.flatMap((row) => {
    const supplier = getSupplier(row);
    return row.purchase_items.flatMap((item) => {
      const managementNo = parseEtc(item.etc).managementNo;
      return (item.itemLabels ?? []).map((label) => ({
        key: `${row.id}-${item.id}-${label.id ?? label.labelId}`,
        labelId: label.labelId,
        status: labelStatusLabel(label.status),
        title: item.title || "-",
        legacyManagementNo: label.legacyManagementNo || managementNo || "-",
        supplier,
        purchaseDate: row.purchase_date ?? item.estimated_purchase_date ?? "",
        rowId: row.id,
        itemId: item.id,
      }));
    });
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
        required: 0,
        secured: 0,
        waiting: 0,
        unitPriceTotal: 0,
        unitPriceCount: 0,
      };
      const quantity = itemQuantity(item);
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
  if (products.length === 0 || invoiceProducts.length === 0) return products;

  type InvoiceProductStats = InvoiceProductSummary & {
    sellingPriceTotal: number;
    sellingPriceQuantity: number;
  };
  const statsByKey = new Map<string, InvoiceProductStats>();
  for (const product of invoiceProducts) {
    const key = productKey(product.productName);
    const current = statsByKey.get(key);
    const orderQty = toNumber(product.orderQty);
    const deliveredQty = toNumber(product.deliveredQty);
    const sellingPrice = toNumber(product.sellingPrice);
    if (current) {
      current.orderQty += orderQty;
      current.deliveredQty += deliveredQty;
      if (sellingPrice > 0 && orderQty > 0) {
        current.sellingPriceTotal += sellingPrice * orderQty;
        current.sellingPriceQuantity += orderQty;
        current.sellingPrice = current.sellingPriceTotal / current.sellingPriceQuantity;
      }
    } else {
      statsByKey.set(key, {
        productName: product.productName,
        orderQty,
        deliveredQty,
        sellingPrice: sellingPrice > 0 ? sellingPrice : null,
        currency: product.currency ?? null,
        sellingPriceTotal: sellingPrice > 0 && orderQty > 0 ? sellingPrice * orderQty : 0,
        sellingPriceQuantity: sellingPrice > 0 && orderQty > 0 ? orderQty : 0,
      });
    }
  }

  const candidates = Array.from(statsByKey.values()).map((product) => ({
    name: product.productName,
    qty: product.orderQty,
  }));

  return products.map((product) => {
    const direct = statsByKey.get(product.key);
    const suggestedName = direct ? null : suggestCsvProduct(product.title, "", candidates)?.name;
    const matched = direct ?? (suggestedName ? statsByKey.get(productKey(suggestedName)) : undefined);
    if (!matched) return product;
    return {
      ...product,
      invoiceOrdered: matched.orderQty,
      invoiceShipped: matched.deliveredQty,
      sellingPrice: matched.sellingPrice ?? null,
      sellingCurrency: matched.currency ?? null,
    };
  });
}

function hasOpenInvoiceQuantity(product: ProductSummary): boolean {
  if (product.invoiceOrdered == null) return true;
  return Math.max(0, product.invoiceOrdered - (product.invoiceShipped ?? 0)) > 0;
}

function filterRowsByProductKeys(rows: PurchaseRow[], productKeys: Set<string>): PurchaseRow[] {
  if (productKeys.size === 0) return [];
  return rows.flatMap((row) => {
    const purchaseItems = row.purchase_items.filter((item) => productKeys.has(productKey(displayProductTitle(item))));
    return purchaseItems.length > 0 ? [{ ...row, purchase_items: purchaseItems }] : [];
  });
}

function buildAllocationGroups(rows: PurchaseRow[]): AllocationGroup[] {
  const map = new Map<string, PurchaseRow[]>();
  for (const row of rows) {
    const key = getInvoiceInfo(row).key;
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
  }

  return Array.from(map.entries())
    .map(([key, groupRows]) => {
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
      const partners = unique(groupRows.map((row) => getInvoiceInfo(row).partner).filter(Boolean));
      const label =
        invoiceInfo.key === OTHER_INVOICE_KEY
          ? "在庫"
          : `No.${invoiceInfo.invoiceNo}${partners.length ? ` ${partners.join(" / ")}` : ""}`;
      return {
        key,
        label,
        partner: invoiceInfo.key === OTHER_INVOICE_KEY ? "在庫" : partners.join(" / ") || supplier.name,
        rows: groupRows,
        products,
        labels,
        required,
        secured,
        waiting,
        purchaseTotal,
      };
    })
    .sort((a, b) => {
      if (a.key === OTHER_INVOICE_KEY) return 1;
      if (b.key === OTHER_INVOICE_KEY) return -1;
      return b.key.localeCompare(a.key, "ja", { numeric: true });
    });
}

function getAllRowsFromGroup(group: AllocationGroup | null, fallbackRows: PurchaseRow[]): PurchaseRow[] {
  return group?.rows.length ? group.rows : fallbackRows;
}

function PurchaseRegistrationCard({ row }: { row: PurchaseRow }) {
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
                個体ID未発行
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
        <Button type="button" variant="outline" size="sm" className="w-fit gap-2" onClick={() => window.print()}>
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
          <summary className="cursor-pointer text-muted-foreground">個体ID一覧</summary>
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
                      <span
                        className={cn(
                          "inline-flex min-w-7 justify-center rounded px-2 py-1 text-xs font-semibold",
                          shortage > 0 ? "bg-rose-100 text-rose-700" : "bg-emerald-50 text-emerald-700",
                        )}
                      >
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
                        <td className={cn("px-4 py-3 text-right font-medium", shortage < 0 ? "text-rose-600" : "text-foreground")}>
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
}: {
  group: AllocationGroup | null;
  rows: PurchaseRow[];
  products?: ProductSummary[];
  detailRows?: PurchaseRow[];
  productFilter?: ProductDetailFilter | null;
  onProductFilter?: (filter: ProductDetailFilter) => void;
  onClearProductFilter?: () => void;
}) {
  const groupRows = getAllRowsFromGroup(group, rows);
  const displayRows = detailRows ?? groupRows;
  const products = productsOverride ?? group?.products ?? buildProductSummaries(groupRows);
  const labels = group?.labels ?? buildLabelViews(displayRows);
  const required = group?.required ?? products.reduce((total, item) => total + item.required, 0);
  const secured = group?.secured ?? products.reduce((total, item) => total + item.secured, 0);
  const purchaseTotal =
    group?.purchaseTotal ??
    displayRows.reduce(
      (total, row) =>
        total +
        row.purchase_items.reduce((rowTotal, item) => rowTotal + toNumber(item.unit_price) * itemQuantity(item), 0),
      0,
    );

  return (
    <div className="space-y-5">
      <section className="rounded-md border bg-background">
        <div className="border-b bg-muted/30 px-4 py-3 text-sm text-muted-foreground">引当先を選ぶ</div>
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <StatCard label="充足" value={`${secured.toLocaleString()} / ${required.toLocaleString()} 点`} />
          <StatCard label="仕入合計" value={formatCurrency(purchaseTotal)} sub={`個体ID ${labels.length.toLocaleString()}件`} />
          <StatCard label="想定売上" value={formatEuro(0)} />
          <StatCard label="想定粗利" value={formatCurrency(0)} />
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
            displayRows.map((row) => <PurchaseRegistrationCard key={row.id} row={row} />)
          )}
        </div>
      </section>
    </div>
  );
}

function LabelPrintPanel({ labels }: { labels: LabelView[] }) {
  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">ラベル印刷</h2>
          </div>
          <Button type="button" variant="outline" className="w-fit gap-2" onClick={() => window.print()}>
            <Printer className="h-4 w-4" />
            選択分を印刷
          </Button>
        </div>
      </section>

      {labels.length === 0 ? (
        <EmptyState icon={Tag} title="印刷できる個体IDがありません" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {labels.map((label) => (
            <div key={label.key} className="rounded-md border bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-2xl font-bold tracking-wide text-slate-950">{label.labelId}</div>
                  <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {label.legacyManagementNo}</div>
                </div>
                <div className="flex h-16 w-16 items-center justify-center rounded border bg-slate-50">
                  <Barcode className="h-8 w-8 text-slate-600" />
                </div>
              </div>
              <div className="mt-3 line-clamp-2 text-sm font-medium">{label.title}</div>
              <div className="mt-2 text-xs text-muted-foreground">{label.supplier.name}</div>
            </div>
          ))}
        </div>
      )}
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
            placeholder="個体IDまたは旧管理番号をスキャン"
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
            <StatCard label="個体ID" value={matched.labelId} sub={`旧管理番号: ${matched.legacyManagementNo}`} />
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

function StockPanel({ labels, rows }: { labels: LabelView[]; rows: PurchaseRow[] }) {
  const stockRows = labels.length > 0 ? labels : buildLabelViews(rows);
  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <h2 className="text-lg font-semibold">在庫一覧</h2>
      </section>
      {stockRows.length === 0 ? (
        <EmptyState icon={Boxes} title="個体ID付き在庫がありません" />
      ) : (
        <div className="overflow-hidden rounded-md border bg-background">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">個体ID</th>
                  <th className="px-4 py-3 text-left font-medium">旧管理番号</th>
                  <th className="px-4 py-3 text-left font-medium">商品名</th>
                  <th className="px-4 py-3 text-left font-medium">状態</th>
                  <th className="px-4 py-3 text-left font-medium">仕入先</th>
                  <th className="px-4 py-3 text-left font-medium">発注日</th>
                </tr>
              </thead>
              <tbody>
                {stockRows.map((label) => (
                  <tr key={label.key} className="border-b last:border-0">
                    <td className="px-4 py-3 font-mono text-base font-semibold text-emerald-800">{label.labelId}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{label.legacyManagementNo}</td>
                    <td className="px-4 py-3 font-medium">{label.title}</td>
                    <td className="px-4 py-3">{label.status}</td>
                    <td className="px-4 py-3">{label.supplier.name}</td>
                    <td className="px-4 py-3">{formatDate(label.purchaseDate)}</td>
                  </tr>
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
          <Input placeholder="出庫する個体IDをスキャン" />
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
          <Input placeholder="返品する個体IDをスキャン" />
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
        <EmptyState icon={RotateCcw} title="返品対象の個体IDがありません" />
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

  const filteredRows = useMemo(() => {
    return rows.flatMap((row) => {
      if (!matchesStatus(row, statusFilter)) return [];
      if (searchText && !buildSearchText(row).includes(searchText)) return [];
      const visibleRow = withVisiblePurchaseItems(row);
      return visibleRow ? [visibleRow] : [];
    });
  }, [rows, searchText, statusFilter]);

  const groups = useMemo(() => buildAllocationGroups(filteredRows), [filteredRows]);
  const selectedGroup = groups.find((group) => group.key === selectedGroupKey) ?? groups[0] ?? null;
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
  const selectedBaseProducts = selectedGroup?.products ?? buildProductSummaries(selectedRows);
  const selectedProducts = withInvoiceProductCounts(selectedBaseProducts, selectedInvoiceProducts?.products ?? []);
  const selectedOpenProducts = selectedProducts.filter(hasOpenInvoiceQuantity);
  const selectedOpenProductKeys = new Set(selectedOpenProducts.map((product) => product.key));
  const selectedOpenRows = filterRowsByProductKeys(selectedRows, selectedOpenProductKeys);
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
      labels: buildLabelViews(filteredRows).length,
      scan: selectedLabels.length,
      stock: selectedLabels.length,
      shipping: selectedOpenProducts.length,
      returns: 0,
    }),
    [filteredRows, selectedLabels.length, selectedOpenProducts.length],
  );

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50/60">
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
                  個体ID {counts.labels.toLocaleString()}件
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
                  {groups.length === 0 ? (
                    <option value="">対象なし</option>
                  ) : (
                    groups.map((group) => (
                      <option key={group.key} value={group.key}>
                        {group.label}（{group.required.toLocaleString()}点）
                      </option>
                    ))
                  )}
                </select>
              </div>

              <div className="flex min-w-0 flex-col gap-3 xl:items-end">
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
                <div className="relative w-full xl:max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="商品名・個体ID・旧管理番号で検索"
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
          ) : filteredRows.length === 0 ? (
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
                />
              </TabsContent>
              <TabsContent value="labels">
                <LabelPrintPanel labels={selectedLabels} />
              </TabsContent>
              <TabsContent value="scan">
                <ScanPanel labels={selectedLabels} />
              </TabsContent>
              <TabsContent value="stock">
                <StockPanel labels={selectedLabels} rows={selectedRows} />
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
