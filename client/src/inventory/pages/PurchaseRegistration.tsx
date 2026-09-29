import { useBulkTrackingForm, useRegistrationEditing } from "./purchase-registration/registrationEditing";
import { RegistrationDialogs } from "./purchase-registration/RegistrationDialogs";
import { ScanPanel } from "./purchase-registration/InboundScan";
import { INVENTORY_LABEL_GROUP_KEY, groupKeyFromLabel, buildShippingItemsFromLabels } from "./purchase-registration/shippingRules";
import { ShippingPanel, ReturnPanel } from "./purchase-registration/ShippingPanels";
export { OutboundBoxIssuer } from "./purchase-registration/OutboundBoxes";
import { loadLabelStartPosition, saveLabelStartPosition, LABEL_SCOPE_FROM_KEY, ISO_DATE_PATTERN, loadLabelScopeFrom } from "./purchase-registration/labelPrintSettings";
import { LabelPrintPanel } from "./purchase-registration/LabelPrintPanel";
import { MissingTrackingOverview } from "./purchase-registration/MissingTrackingOverview";
import { LabelPrintStyles } from "./purchase-registration/LabelPrintStyles";
import { PrintableLabelSheet } from "./purchase-registration/PrintableLabelSheet";
import { PrintableChecklistSheet } from "./purchase-registration/LabelChecklists";
import { fieldClass } from "./purchase-registration/fieldStyles";
import { StockPanel } from "./purchase-registration/StockPanel";
import { EmptyState } from "./purchase-registration/EmptyState";
import { OrderDashboard } from "./purchase-registration/OrderDashboard";
import { mergeLabelViewsById } from "./purchase-registration/labelMerging";
import { hasOpenInvoiceQuantity, buildAllocationGroups, mergeAllocationGroupsByKey, getAllRowsFromGroup } from "./purchase-registration/allocationGroups";
import { buildLabelViews, buildClosedInvoiceInventoryLabelViews } from "./purchase-registration/registrationLabelViews";
import { filterRowsByProductDetail, filterStockItemsByProductDetail, filterStockItemsByInvoiceProductDetail } from "./purchase-registration/productDetailFilters";
import { buildProductSummaries, buildInvoiceStockProductSummaries, filterInvoiceStockItems, withInvoiceProductCounts, withInvoiceStockCountsFromItems } from "./purchase-registration/productSummaries";
import { buildStockItemViewsFromInventories } from "./purchase-registration/stockViews";
import { isFulfillmentStockItem } from "./purchase-registration/stockProposalRules";
import { formatLabelPrintTitle } from "./purchase-registration/labelTitles";
import { clampLabelStartPosition, nextLabelStartPosition, isWithinLabelScope } from "./purchase-registration/labelPrintLayout";
import { buildInventoryLabelViews } from "./purchase-registration/inventoryLabelViews";
import {
  OTHER_INVOICE_KEY,
  EBAY_GROUP_KEY,
  EBAY_GROUP_LABEL,
  parseInvoiceFromManagementNo,
  isEbayManagementNo,
  getInvoiceInfo,
  invoiceNoFromGroupKey,
} from "./purchase-registration/invoiceIdentity";
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
import { purchaseRowStatusKind } from "./purchase-registration/rowStatus";
import { comparePurchaseRegistrationOrder } from "./purchase-registration/rowOrder";
import type { PurchaseRow, InventoryItem } from "./purchase-registration/dataTypes";
import type { StatusFilter, WorkflowTab, StockViewMode } from "./purchase-registration/formTypes";
import type { LabelView, InvoiceProductSummary, ProductDetailFilter, AllocationGroup } from "./purchase-registration/viewTypes";
import { getPurchaseTrackingMeta, hasPurchaseTracking } from "./purchase-registration/tracking";
import { useEffect, useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Boxes, FileText, Loader2, PackageCheck, PackagePlus, Printer, RefreshCw, RotateCcw, ScanLine, Search, Tag, Truck } from "lucide-react";

const EMPTY_INVOICE_PRODUCTS: InvoiceProductSummary[] = [];

const workflowTabs: Array<{ value: WorkflowTab; label: string; icon: typeof PackagePlus }> = [
  { value: "order", label: "発注登録", icon: PackagePlus },
  { value: "labels", label: "ラベル印刷", icon: Printer },
  { value: "scan", label: "入庫スキャン", icon: ScanLine },
  { value: "stock", label: "在庫一覧", icon: Boxes },
  { value: "shipping", label: "出庫", icon: Truck },
  { value: "returns", label: "返品", icon: RotateCcw },
];

/**
 * その日に荷受けしたぶんのラベルを刷る。荷受けの画面から直接使えるように、
 * 発注登録のラベル印刷タブと同じ機能をここへ切り出している。
 * 画面が持っているラベル一覧に依存せず、サーバーが返した荷受け行だけで組み立てる。
 */
export { ReceivedDateLabelPrint } from "./purchase-registration/ReceivedDateLabelPrint";

export default function PurchaseRegistration() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [showGlobalMissingTracking, setShowGlobalMissingTracking] = useState(false);
  const [showTrackedGlobalRowsOnly, setShowTrackedGlobalRowsOnly] = useState(false);
  const [selectedMissingTrackingRowIds, setSelectedMissingTrackingRowIds] = useState<Set<number>>(() => new Set());
  const bulkTracking = useBulkTrackingForm();
  const { bulkTrackingForm } = bulkTracking;

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
  const editing = useRegistrationEditing(utils, bulkTracking);
  const { deletingRowId, trackingForm } = editing;

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

  const editActions = editing.bindData({
    inventoryItems,
    selectedBulkTrackingRows,
    setSelectedMissingTrackingRowIds,
    refetch,
    refetchAllPurchaseRegistrations,
    refetchInventories,
  });
  const {
    handleOpenTrackingDialog,
    handleOpenPurchaseEditDialog,
    handleOpenStockEditDialog,
    handleOpenBulkTrackingDialog,
    handleDeletePurchaseRow,
  } = editActions;

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

        <RegistrationDialogs
          editing={editing}
          actions={editActions}
          bulkTracking={bulkTracking}
          selectedBulkTrackingRows={selectedBulkTrackingRows}
          trackingPreview={trackingPreview}
          bulkTrackingPreview={bulkTrackingPreview}
        />

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

