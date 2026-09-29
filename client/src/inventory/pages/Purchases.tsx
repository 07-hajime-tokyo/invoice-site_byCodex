import { Loader2 } from "lucide-react";
import { TrackingNumberPanel } from "./purchases/TrackingNumberPanel";
import { usePurchasesPage } from "./purchases/usePurchasesPage";
import { PurchasesToolbar } from "./purchases/PurchasesToolbar";
import { PurchaseTotals } from "./purchases/PurchaseTotals";
import { PurchaseFilters } from "./purchases/PurchaseFilters";
import { PurchaseList } from "./purchases/PurchaseList";
import { PurchaseReceiptDialog } from "./purchases/PurchaseReceiptDialog";
import { PurchaseSelectionBar } from "./purchases/PurchaseSelectionBar";
import { BulkReceiptDialog } from "./purchases/BulkReceiptDialog";
import { BulkTrackingDialog } from "./purchases/BulkTrackingDialog";
import { OrderedPurchaseDialog } from "./purchases/OrderedPurchaseDialog";

export default function Purchases() {
  const {
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
  } = usePurchasesPage();
  if (isLoading && !purchasePageData) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <span className="ml-2 text-muted-foreground">
          入庫予定を読み込み中...
        </span>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {/* ヘッダー（スクロール固定） */}
      <PurchasesToolbar
        purchaseTotalItems={purchaseTotalItems}
        purchasePageData={purchasePageData}
        openOrderedDialog={openOrderedDialog}
        setShowTotals={setShowTotals}
        showTotals={showTotals}
        handleExportPurchasesCSV={handleExportPurchasesCSV}
        isExportingCsv={isExportingCsv}
        refetch={refetch}
        isFetching={isFetching}
        searchQuery={searchQuery}
        setPurchasePage={setPurchasePage}
        setSearchQuery={setSearchQuery}
      />

      {/* 合計金額サマリー（PC用） */}
      <PurchaseTotals
        showTotals={showTotals}
        grandTotal={grandTotal}
        categoryTotals={categoryTotals}
        selectedCategory={selectedCategory}
        handleSetSelectedCategory={handleSetSelectedCategory}
      />

      {/* カテゴリタブ */}
      <PurchaseFilters
        categories={categories}
        selectedCategory={selectedCategory}
        handleSetSelectedCategory={handleSetSelectedCategory}
        purchasePageData={purchasePageData}
        categoryCountMap={categoryCountMap}
        handleSetStatusFilter={handleSetStatusFilter}
        selectedStatusFilter={selectedStatusFilter}
        showCompletedPurchases={showCompletedPurchases}
        setPurchasePage={setPurchasePage}
        setShowCompletedPurchases={setShowCompletedPurchases}
        completedPurchaseCount={completedPurchaseCount}
        selectedInboundTab={selectedInboundTab}
        handleSetInboundTab={handleSetInboundTab}
        inboundTabCounts={inboundTabCounts}
      />

      <TrackingNumberPanel
        purchases={filteredPurchases}
        isOpen={isTrackingPanelOpen}
        onToggle={() => setIsTrackingPanelOpen(open => !open)}
      />

      {/* 入庫予定なし */}
      <PurchaseList
        filteredPurchases={filteredPurchases}
        hasActiveEmptyFilters={hasActiveEmptyFilters}
        activeEmptyFilterChips={activeEmptyFilterChips}
        clearPurchaseFilters={clearPurchaseFilters}
        pagedPurchases={pagedPurchases}
        checkedPurchaseIds={checkedPurchaseIds}
        togglePurchaseCheck={togglePurchaseCheck}
        handleComplete={handleComplete}
        processingIds={processingIds}
        deletingIds={deletingIds}
        handleDeleteInventory={handleDeleteInventory}
        inboundBusyIds={inboundBusyIds}
        handleSetInboundClass={handleSetInboundClass}
        handleAdvanceStage={handleAdvanceStage}
        handleSeparateShaft={handleSeparateShaft}
        editingId={editingId}
        saveEdit={saveEdit}
        upsertExtraMutation={upsertExtraMutation}
        cancelEdit={cancelEdit}
        startEdit={startEdit}
        editState={editState}
        setEditState={setEditState}
        categoryOptions={categoryOptions}
        handleDeletePurchaseAndInventory={handleDeletePurchaseAndInventory}
        displayedPurchasePage={displayedPurchasePage}
        purchaseTotalPages={purchaseTotalPages}
        setPurchasePage={setPurchasePage}
        purchaseTotalItems={purchaseTotalItems}
        purchaseStartIndex={purchaseStartIndex}
        purchaseEndIndex={purchaseEndIndex}
      />
      {/* 入庫確認ダイアログ */}
      <PurchaseReceiptDialog
        confirmPurchase={confirmPurchase}
        today={today}
        operators={operators}
        handleOperatorChange={handleOperatorChange}
        selectedOperatorKey={selectedOperatorKey}
        setConfirmPurchase={setConfirmPurchase}
        executeComplete={executeComplete}
        processingIds={processingIds}
      />

      {/* まとめて入庫フッター（固定） */}
      <PurchaseSelectionBar
        checkedPurchases={checkedPurchases}
        setCheckedPurchaseIds={setCheckedPurchaseIds}
        setBulkTrackingForm={setBulkTrackingForm}
        setShowBulkTrackingDialog={setShowBulkTrackingDialog}
        bulkProcessing={bulkProcessing}
        setShowBulkConfirm={setShowBulkConfirm}
      />

      {/* まとめて入庫確認ダイアログ */}
      <BulkReceiptDialog
        showBulkConfirm={showBulkConfirm}
        checkedPurchases={checkedPurchases}
        today={today}
        operators={operators}
        handleOperatorChange={handleOperatorChange}
        selectedOperatorKey={selectedOperatorKey}
        setShowBulkConfirm={setShowBulkConfirm}
        bulkProcessing={bulkProcessing}
        handleBulkComplete={handleBulkComplete}
      />

      {/* 一括追跡番号登録ダイアログ */}
      <BulkTrackingDialog
        showBulkTrackingDialog={showBulkTrackingDialog}
        checkedPurchases={checkedPurchases}
        bulkTrackingForm={bulkTrackingForm}
        setBulkTrackingForm={setBulkTrackingForm}
        setShowBulkTrackingDialog={setShowBulkTrackingDialog}
        isBulkTrackingSubmitting={isBulkTrackingSubmitting}
        handleBulkTrackingSubmit={handleBulkTrackingSubmit}
      />

      {/* 発注済み登録ダイアログ */}
      <OrderedPurchaseDialog
        showOrderedDialog={showOrderedDialog}
        setShowOrderedDialog={setShowOrderedDialog}
        orderedInventorySearch={orderedInventorySearch}
        setOrderedInventorySearch={setOrderedInventorySearch}
        setOrderedForm={setOrderedForm}
        orderedForm={orderedForm}
        filteredInventoriesForOrder={filteredInventoriesForOrder}
        handleSelectInventoryForOrder={handleSelectInventoryForOrder}
        operators={operators}
        handleOperatorChange={handleOperatorChange}
        selectedOperatorKey={selectedOperatorKey}
        isOrderedSubmitting={isOrderedSubmitting}
        handleOrderedSubmit={handleOrderedSubmit}
      />
    </div>
  );
}
