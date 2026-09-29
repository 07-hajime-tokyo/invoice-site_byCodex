import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { PURCHASE_STATUS_FILTER_KEY } from "./constants";
import { statusLabel } from "./format";
import { usePurchaseOperator } from "./usePurchaseOperator";
import { usePurchaseFilters } from "./usePurchaseFilters";
import { usePurchaseEditorState } from "./usePurchaseEditorState";
import { usePurchaseListData } from "./usePurchaseListData";
import { usePurchaseSelection } from "./usePurchaseSelection";
import { useOrderedPurchase } from "./useOrderedPurchase";
import { usePurchaseEditor } from "./usePurchaseEditor";
import { usePurchaseCompletion } from "./usePurchaseCompletion";
import { usePurchaseDeletion } from "./usePurchaseDeletion";
import { usePurchaseStages } from "./usePurchaseStages";
import { usePurchaseBulkTracking } from "./usePurchaseBulkTracking";
import { usePurchaseCsv } from "./usePurchaseCsv";

export function usePurchasesPage() {
  const utils = trpc.useUtils();
  const today = new Date().toISOString().split("T")[0];
  const {
    operators,
    selectedOperatorKey,
    handleOperatorChange,
    selectedOperatorName,
  } = usePurchaseOperator();
  const {
    setLocation,
    purchasePage,
    setPurchasePage,
    selectedCategory,
    handleSetSelectedCategory,
    selectedInboundTab,
    handleSetInboundTab,
    selectedStatusFilter,
    setSelectedStatusFilter,
    showCompletedPurchases,
    setShowCompletedPurchases,
    handleSetStatusFilter,
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
  } = usePurchaseFilters();
  const { editingId, setEditingId, editState, setEditState } =
    usePurchaseEditorState();
  const {
    purchasePageData,
    isLoading,
    isFetching,
    refetch,
    categoryTotals,
    categoryCountMap,
    grandTotal,
    categoryOptions,
    categories,
    completedPurchaseCount,
    filteredPurchases,
    pagedPurchases,
    inboundTabCounts,
    displayedPurchasePage,
    purchaseTotalItems,
    purchaseTotalPages,
    purchaseStartIndex,
    purchaseEndIndex,
  } = usePurchaseListData({
    purchasePage,
    selectedCategory,
    selectedStatusFilter,
    debouncedSearchQuery,
    showCompletedPurchases,
    selectedInboundTab,
    editingId,
    utils,
  });
  const {
    checkedPurchaseIds,
    setCheckedPurchaseIds,
    checkedPurchases,
    togglePurchaseCheck,
  } = usePurchaseSelection({
    debouncedSearchQuery,
    purchasePage,
    selectedCategory,
    selectedInboundTab,
    selectedStatusFilter,
    showCompletedPurchases,
    filteredPurchases,
  });
  const {
    refetchInventories,
    showOrderedDialog,
    setShowOrderedDialog,
    orderedForm,
    setOrderedForm,
    isOrderedSubmitting,
    orderedInventorySearch,
    setOrderedInventorySearch,
    filteredInventoriesForOrder,
    openOrderedDialog,
    handleSelectInventoryForOrder,
    handleOrderedSubmit,
  } = useOrderedPurchase({ selectedOperatorKey, utils });
  const { upsertExtraMutation, startEdit, cancelEdit, saveEdit } =
    usePurchaseEditor({
      setEditingId,
      setEditState,
      editState,
      selectedOperatorKey,
      utils,
      refetch,
    });
  const {
    processingIds,
    confirmPurchase,
    setConfirmPurchase,
    showBulkConfirm,
    setShowBulkConfirm,
    bulkProcessing,
    handleComplete,
    executeComplete,
    handleBulkComplete,
  } = usePurchaseCompletion({
    today,
    selectedOperatorKey,
    selectedOperatorName,
    refetch,
    checkedPurchases,
    setCheckedPurchaseIds,
  });
  const {
    deletingIds,
    handleDeleteInventory,
    handleDeletePurchaseAndInventory,
  } = usePurchaseDeletion({
    selectedOperatorKey,
    refetch,
    refetchInventories,
    utils,
  });
  const {
    inboundBusyIds,
    handleSetInboundClass,
    handleAdvanceStage,
    handleSeparateShaft,
  } = usePurchaseStages({ refetch, selectedOperatorName });
  const {
    showBulkTrackingDialog,
    setShowBulkTrackingDialog,
    bulkTrackingForm,
    setBulkTrackingForm,
    isBulkTrackingSubmitting,
    handleBulkTrackingSubmit,
  } = usePurchaseBulkTracking({ checkedPurchases, refetch });
  const { isExportingCsv, handleExportPurchasesCSV } = usePurchaseCsv({
    utils,
    selectedCategory,
    selectedStatusFilter,
    debouncedSearchQuery,
    searchQuery,
  });
  const [isTrackingPanelOpen, setIsTrackingPanelOpen] = useState(false);
  const [showTotals, setShowTotals] = useState(true);
  const activeEmptyFilterChips: string[] = [];
  if (selectedCategory !== "すべて") {
    activeEmptyFilterChips.push(`カテゴリ: ${selectedCategory}`);
  }
  if (selectedStatusFilter) {
    activeEmptyFilterChips.push(
      selectedStatusFilter === "ordered"
        ? "発注済み"
        : selectedStatusFilter === "shipped"
          ? "発送済み / 入庫待ち"
          : (statusLabel[selectedStatusFilter] ?? selectedStatusFilter)
    );
  }
  if (searchQuery.trim()) {
    activeEmptyFilterChips.push(`検索: "${searchQuery.trim()}"`);
  }
  if (!showCompletedPurchases && completedPurchaseCount > 0) {
    activeEmptyFilterChips.push("完了を非表示");
  }
  const hasActiveEmptyFilters = activeEmptyFilterChips.length > 0;
  function clearPurchaseFilters() {
    setPurchasePage(1);
    handleSetSelectedCategory("すべて");
    setSelectedStatusFilter(null);
    localStorage.removeItem(PURCHASE_STATUS_FILTER_KEY);
    setSearchQuery("");
    if (!showCompletedPurchases && completedPurchaseCount > 0) {
      setShowCompletedPurchases(true);
    }

    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("q")) return;
    params.delete("q");
    const query = params.toString();
    setLocation(`${window.location.pathname}${query ? `?${query}` : ""}`, {
      replace: true,
    });
  }
  return {
    purchaseTotalItems,
    purchasePageData,
    openOrderedDialog,
    setShowTotals,
    showTotals,
    handleExportPurchasesCSV,
    isExportingCsv,
    refetch,
    isFetching,
    searchQuery,
    setPurchasePage,
    setSearchQuery,
    grandTotal,
    categoryTotals,
    selectedCategory,
    handleSetSelectedCategory,
    categories,
    categoryCountMap,
    handleSetStatusFilter,
    selectedStatusFilter,
    showCompletedPurchases,
    setShowCompletedPurchases,
    completedPurchaseCount,
    selectedInboundTab,
    handleSetInboundTab,
    inboundTabCounts,
    filteredPurchases,
    isTrackingPanelOpen,
    setIsTrackingPanelOpen,
    hasActiveEmptyFilters,
    activeEmptyFilterChips,
    clearPurchaseFilters,
    pagedPurchases,
    checkedPurchaseIds,
    togglePurchaseCheck,
    handleComplete,
    processingIds,
    deletingIds,
    handleDeleteInventory,
    inboundBusyIds,
    handleSetInboundClass,
    handleAdvanceStage,
    handleSeparateShaft,
    editingId,
    saveEdit,
    upsertExtraMutation,
    cancelEdit,
    startEdit,
    editState,
    setEditState,
    categoryOptions,
    handleDeletePurchaseAndInventory,
    displayedPurchasePage,
    purchaseTotalPages,
    purchaseStartIndex,
    purchaseEndIndex,
    confirmPurchase,
    today,
    operators,
    handleOperatorChange,
    selectedOperatorKey,
    setConfirmPurchase,
    executeComplete,
    checkedPurchases,
    setCheckedPurchaseIds,
    setBulkTrackingForm,
    setShowBulkTrackingDialog,
    bulkProcessing,
    setShowBulkConfirm,
    showBulkConfirm,
    handleBulkComplete,
    showBulkTrackingDialog,
    bulkTrackingForm,
    isBulkTrackingSubmitting,
    handleBulkTrackingSubmit,
    showOrderedDialog,
    setShowOrderedDialog,
    orderedInventorySearch,
    setOrderedInventorySearch,
    setOrderedForm,
    orderedForm,
    filteredInventoriesForOrder,
    handleSelectInventoryForOrder,
    isOrderedSubmitting,
    handleOrderedSubmit,
    isLoading,
  };
}
export type PurchasePageModel = ReturnType<typeof usePurchasesPage>;
