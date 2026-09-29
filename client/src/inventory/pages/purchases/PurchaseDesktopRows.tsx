import { PurchaseShipmentSummary } from "./PurchaseShipmentSummary";
import { PurchaseShippingEditor } from "./PurchaseShippingEditor";
import { PurchaseItemsTable } from "./PurchaseItemsTable";
import { isPurchaseInboundComplete } from "@shared/purchaseVisibility";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PackageCheck, Edit2, Check, X, Loader2 } from "lucide-react";
import {
  combineSupplierInfo,
  buildSupplierDisplay,
} from "@/inventory/lib/supplier";
import { type Purchase } from "./types";
import { parseEtc, getStatusClass, getEffectiveStatusLabel } from "./format";
import { InboundRowControls } from "./InboundRowControls";
import { type PurchasePageModel } from "./usePurchasesPage";

export function PurchaseDesktopRows({
  pagedPurchases,
  checkedPurchaseIds,
  togglePurchaseCheck,
  handleComplete,
  processingIds,
  deletingIds,
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
}: Pick<
  PurchasePageModel,
  | "pagedPurchases"
  | "checkedPurchaseIds"
  | "togglePurchaseCheck"
  | "handleComplete"
  | "processingIds"
  | "deletingIds"
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
>) {
  return (
    <div className="hidden md:block space-y-3">
      {pagedPurchases.map(purchase => {
        const firstItem = purchase.purchase_items[0];
        const { managementNo, supplierSite } = parseEtc(firstItem?.etc);
        const inboundComplete = isPurchaseInboundComplete(purchase);
        return (
          <div
            key={purchase.id}
            className={`rounded-lg border bg-card shadow-sm overflow-hidden ${inboundComplete ? "opacity-60" : ""}`}
          >
            {/* 入庫ヘッダー */}
            <div
              className={`flex items-center justify-between px-4 py-3 border-b ${checkedPurchaseIds.has(purchase.id) ? "bg-primary/10" : "bg-muted/30"}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <Checkbox
                  checked={checkedPurchaseIds.has(purchase.id)}
                  onCheckedChange={() => togglePurchaseCheck(purchase.id)}
                  className="flex-shrink-0"
                />
                <span className="font-semibold text-sm">
                  管理番号: {managementNo || purchase.num || `#${purchase.id}`}
                </span>
                <span
                  className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${getStatusClass(purchase)}`}
                >
                  {getEffectiveStatusLabel(purchase)}
                </span>
                {(purchase.csvSupplierName ||
                  purchase.csvSupplierUrl ||
                  supplierSite ||
                  purchase.customer_name) && (
                  <span className="text-sm text-muted-foreground">
                    仕入先:{" "}
                    {purchase.csvSupplierUrl ? (
                      <a
                        href={purchase.csvSupplierUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="text-primary hover:underline inline-flex items-center gap-0.5"
                      >
                        🔗{" "}
                        {buildSupplierDisplay(
                          purchase.csvSupplierUrl,
                          purchase.csvSupplierName,
                          purchase.customer_name
                        )}
                      </a>
                    ) : (
                      combineSupplierInfo(
                        supplierSite,
                        purchase.csvSupplierName,
                        purchase.customer_name
                      )
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
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => startEdit(purchase as Purchase)}
                  >
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
              <PurchaseItemsTable
                purchase={purchase}
                deletingIds={deletingIds}
                editingId={editingId}
                editState={editState}
                setEditState={setEditState}
                categoryOptions={categoryOptions}
                handleDeletePurchaseAndInventory={
                  handleDeletePurchaseAndInventory
                }
              />
            </div>

            {/* 補足情報（発送日・追跡番号） */}
            <div className="px-4 py-3 border-t bg-muted/10">
              {editingId === purchase.id ? (
                <PurchaseShippingEditor
                  editState={editState}
                  setEditState={setEditState}
                />
              ) : (
                <PurchaseShipmentSummary purchase={purchase} />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
