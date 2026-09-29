import { ScanPanel } from "./purchase-registration/InboundScan";
import { INVENTORY_LABEL_GROUP_KEY, groupKeyFromLabel, buildShippingItemsFromLabels } from "./purchase-registration/shippingRules";
import { ShippingPanel, ReturnPanel } from "./purchase-registration/ShippingPanels";
export { OutboundBoxIssuer } from "./purchase-registration/OutboundBoxes";
import { loadLabelStartPosition, saveLabelStartPosition, LABEL_SCOPE_FROM_KEY, ISO_DATE_PATTERN, loadLabelScopeFrom, todayInTokyo } from "./purchase-registration/labelPrintSettings";
import { LabelPrintPanel } from "./purchase-registration/LabelPrintPanel";
import { MissingTrackingOverview } from "./purchase-registration/MissingTrackingOverview";
import { LabelPrintStyles } from "./purchase-registration/LabelPrintStyles";
import { PrintableLabelSheet } from "./purchase-registration/PrintableLabelSheet";
import { PrintableChecklistSheet } from "./purchase-registration/LabelChecklists";
import { fieldClass } from "./purchase-registration/fieldStyles";
import { StockPanel } from "./purchase-registration/StockPanel";
import { openEcohaiTracking } from "./purchase-registration/trackingNavigation";
import { purchaseRowInventoryId } from "./purchase-registration/purchaseRowIdentity";
import { EmptyState } from "./purchase-registration/EmptyState";
import { OrderDashboard } from "./purchase-registration/OrderDashboard";
import { mergeLabelViewsById } from "./purchase-registration/labelMerging";
import { hasOpenInvoiceQuantity, buildAllocationGroups, mergeAllocationGroupsByKey, getAllRowsFromGroup } from "./purchase-registration/allocationGroups";
import { buildLabelViews, buildClosedInvoiceInventoryLabelViews } from "./purchase-registration/registrationLabelViews";
import { actualProductTitle } from "./purchase-registration/productTitles";
import { filterRowsByProductDetail, filterStockItemsByProductDetail, filterStockItemsByInvoiceProductDetail } from "./purchase-registration/productDetailFilters";
import { buildProductSummaries, buildInvoiceStockProductSummaries, filterInvoiceStockItems, withInvoiceProductCounts, withInvoiceStockCountsFromItems } from "./purchase-registration/productSummaries";
import { buildStockItemViewsFromInventories } from "./purchase-registration/stockViews";
import { isStockProposalAccessory, isFulfillmentStockItem } from "./purchase-registration/stockProposalRules";
import { getInventoryCategory, stockModelName } from "./purchase-registration/productPresentation";
import { labelStatusLabel } from "./purchase-registration/labelStatus";
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
import { purchaseRowStatusKind } from "./purchase-registration/rowStatus";
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
import type { LabelView, InvoiceProductSummary, ProductDetailFilter, AllocationGroup } from "./purchase-registration/viewTypes";
import { TRACKING_CARRIER_LABELS, TRACKING_CARRIER_KEYS, TRACKING_CARRIER_OPTIONS, getPurchaseTrackingMeta, hasPurchaseTracking } from "./purchase-registration/tracking";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { getCarrierColor, type Carrier } from "@/inventory/lib/tracking";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Boxes, ExternalLink, FileText, Loader2, PackageCheck, PackagePlus, Pencil, Printer, RefreshCw, RotateCcw, ScanLine, Search, Tag, Truck } from "lucide-react";

const EMPTY_INVOICE_PRODUCTS: InvoiceProductSummary[] = [];

const workflowTabs: Array<{ value: WorkflowTab; label: string; icon: typeof PackagePlus }> = [
  { value: "order", label: "発注登録", icon: PackagePlus },
  { value: "labels", label: "ラベル印刷", icon: Printer },
  { value: "scan", label: "入庫スキャン", icon: ScanLine },
  { value: "stock", label: "在庫一覧", icon: Boxes },
  { value: "shipping", label: "出庫", icon: Truck },
  { value: "returns", label: "返品", icon: RotateCcw },
];

function todayInputDate(): string {
  return new Date().toLocaleDateString("sv-SE");
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


