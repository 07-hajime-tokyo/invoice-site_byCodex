import { PurchaseDesktopRows } from "./PurchaseDesktopRows";
import { isPurchaseInboundComplete } from "@shared/purchaseVisibility";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PackageCheck } from "lucide-react";
import { PaginationBar } from "@/inventory/components/PaginationBar";
import { type Purchase } from "./types";
import { CARRIER_OPTIONS } from "./constants";
import {
  parseEtc,
  statusLabel,
  getStatusClass,
  getEffectiveStatusLabel,
} from "./format";
import { PurchaseCardMobile } from "./PurchaseCardMobile";
import { InboundRowControls } from "./InboundRowControls";
import { type PurchasePageModel } from "./usePurchasesPage";

export function PurchaseList({
  filteredPurchases,
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
  setPurchasePage,
  purchaseTotalItems,
  purchaseStartIndex,
  purchaseEndIndex,
}: Pick<
  PurchasePageModel,
  | "filteredPurchases"
  | "hasActiveEmptyFilters"
  | "activeEmptyFilterChips"
  | "clearPurchaseFilters"
  | "pagedPurchases"
  | "checkedPurchaseIds"
  | "togglePurchaseCheck"
  | "handleComplete"
  | "processingIds"
  | "deletingIds"
  | "handleDeleteInventory"
  | "inboundBusyIds"
  | "handleSetInboundClass"
  | "handleAdvanceStage"
  | "handleSeparateShaft"
  | "editingId"
  | "saveEdit"
  | "upsertExtraMutation"
  | "cancelEdit"
  | "startEdit"
  | "editState"
  | "setEditState"
  | "categoryOptions"
  | "handleDeletePurchaseAndInventory"
  | "displayedPurchasePage"
  | "purchaseTotalPages"
  | "setPurchasePage"
  | "purchaseTotalItems"
  | "purchaseStartIndex"
  | "purchaseEndIndex"
>) {
  return (
    <>
      {!filteredPurchases || filteredPurchases.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <PackageCheck className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">
            {hasActiveEmptyFilters
              ? "この絞り込みでは0件です"
              : "入庫データはありません"}
          </p>
          {hasActiveEmptyFilters ? (
            <>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {activeEmptyFilterChips.map(chip => (
                  <Badge
                    key={chip}
                    variant="outline"
                    className="bg-muted/30 text-xs font-normal"
                  >
                    {chip}
                  </Badge>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearPurchaseFilters}
                className="mt-4 text-muted-foreground"
              >
                絞り込みを解除
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted-foreground mt-1">
              サイト内DBに登録した入庫データが表示されます
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* ===== スマホ用レイアウト ===== */}
          <div className="md:hidden space-y-3">
            {pagedPurchases.map(purchase => {
              const firstItem = purchase.purchase_items[0];
              const { managementNo, supplierSite } = parseEtc(firstItem?.etc);
              const inboundComplete = isPurchaseInboundComplete(purchase);
              return (
                <div
                  key={purchase.id}
                  className={inboundComplete ? "opacity-60" : ""}
                >
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
          <PurchaseDesktopRows
            pagedPurchases={pagedPurchases}
            checkedPurchaseIds={checkedPurchaseIds}
            togglePurchaseCheck={togglePurchaseCheck}
            handleComplete={handleComplete}
            processingIds={processingIds}
            deletingIds={deletingIds}
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
          />
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
    </>
  );
}
