import { fieldClass } from "./fieldStyles";
import { openEcohaiTracking } from "./trackingNavigation";
import { actualProductTitle } from "./productTitles";
import { getManagementNos } from "./managementNumbers";
import { getItemLabels } from "./purchaseItems";
import type { PurchaseRow } from "./dataTypes";
import type { TrackingFormState, PurchaseEditFormState } from "./formTypes";
import {
  TRACKING_CARRIER_LABELS,
  TRACKING_CARRIER_OPTIONS,
  getPurchaseTrackingMeta,
} from "./tracking";
import { getCarrierColor } from "@/inventory/lib/tracking";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ExternalLink, Loader2, Pencil, Truck } from "lucide-react";
import type {
  RegistrationEditing,
  RegistrationEditActions,
  useBulkTrackingForm,
} from "./registrationEditing";

export function RegistrationDialogs({
  editing,
  actions,
  bulkTracking,
  selectedBulkTrackingRows,
  trackingPreview,
  bulkTrackingPreview,
}: {
  editing: RegistrationEditing;
  actions: RegistrationEditActions;
  bulkTracking: ReturnType<typeof useBulkTrackingForm>;
  selectedBulkTrackingRows: PurchaseRow[];
  trackingPreview: ReturnType<typeof getPurchaseTrackingMeta> | null;
  bulkTrackingPreview: ReturnType<typeof getPurchaseTrackingMeta> | null;
}) {
  const {
    trackingDialogRow,
    setTrackingDialogRow,
    editingPurchaseRow,
    setEditingPurchaseRow,
    purchaseEditForm,
    setPurchaseEditForm,
    editingStockItem,
    setEditingStockItem,
    stockEditForm,
    setStockEditForm,
    trackingForm,
    setTrackingForm,
    upsertPurchaseExtraMutation,
    upsertPurchaseExtraBulkMutation,
    isPurchaseEditSaving,
    isStockEditSaving,
  } = editing;
  const {
    handleSubmitPurchaseEdit,
    handleSubmitStockEdit,
    handleSubmitTracking,
    handleSubmitBulkTracking,
  } = actions;
  const {
    showBulkTrackingDialog,
    setShowBulkTrackingDialog,
    bulkTrackingForm,
    setBulkTrackingForm,
  } = bulkTracking;
  return (
    <>
      <Dialog
        open={Boolean(editingPurchaseRow)}
        onOpenChange={open => {
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
              <span className="text-xs font-medium text-muted-foreground">
                商品名
              </span>
              <Input
                value={purchaseEditForm.title}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                autoFocus
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                旧管理番号
              </span>
              <Input
                value={purchaseEditForm.managementNo}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    managementNo: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                カテゴリ
              </span>
              <Input
                value={purchaseEditForm.category}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                発注数
              </span>
              <Input
                type="number"
                min={1}
                value={purchaseEditForm.quantity}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    quantity: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                仕入単価
              </span>
              <Input
                type="number"
                min={0}
                value={purchaseEditForm.unitPrice}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    unitPrice: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                入庫予定日
              </span>
              <Input
                type="date"
                value={purchaseEditForm.estimatedDate}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    estimatedDate: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                発送日
              </span>
              <Input
                type="date"
                value={purchaseEditForm.shipDate}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    shipDate: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                追跡番号
              </span>
              <Input
                value={purchaseEditForm.trackingNumber}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    trackingNumber: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                発送業者
              </span>
              <select
                className={fieldClass}
                value={purchaseEditForm.carrier}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    carrier: event.target
                      .value as PurchaseEditFormState["carrier"],
                  }))
                }
              >
                {TRACKING_CARRIER_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                仕入先名
              </span>
              <Input
                value={purchaseEditForm.supplierName}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    supplierName: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                仕入先URL
              </span>
              <Input
                value={purchaseEditForm.supplierUrl}
                onChange={event =>
                  setPurchaseEditForm(current => ({
                    ...current,
                    supplierUrl: event.target.value,
                  }))
                }
                type="url"
              />
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingPurchaseRow(null)}
              disabled={isPurchaseEditSaving}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={handleSubmitPurchaseEdit}
              disabled={isPurchaseEditSaving || !purchaseEditForm.title.trim()}
            >
              {isPurchaseEditSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="mr-2 h-4 w-4" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(editingStockItem)}
        onOpenChange={open => {
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
              <span className="text-xs font-medium text-muted-foreground">
                商品名
              </span>
              <Input
                value={stockEditForm.title}
                onChange={event =>
                  setStockEditForm(current => ({
                    ...current,
                    title: event.target.value,
                  }))
                }
                autoFocus
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                旧管理番号
              </span>
              <Input
                value={stockEditForm.managementNo}
                onChange={event =>
                  setStockEditForm(current => ({
                    ...current,
                    managementNo: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                カテゴリ
              </span>
              <Input
                value={stockEditForm.category}
                onChange={event =>
                  setStockEditForm(current => ({
                    ...current,
                    category: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                在庫数
              </span>
              <Input
                type="number"
                min={0}
                value={stockEditForm.quantity}
                onChange={event =>
                  setStockEditForm(current => ({
                    ...current,
                    quantity: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                単位
              </span>
              <Input
                value={stockEditForm.unit}
                onChange={event =>
                  setStockEditForm(current => ({
                    ...current,
                    unit: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                仕入単価
              </span>
              <Input
                type="number"
                min={0}
                value={stockEditForm.unitPrice}
                onChange={event =>
                  setStockEditForm(current => ({
                    ...current,
                    unitPrice: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                保管場所
              </span>
              <Input
                value={stockEditForm.place}
                onChange={event =>
                  setStockEditForm(current => ({
                    ...current,
                    place: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                仕入先名
              </span>
              <Input
                value={stockEditForm.supplierName}
                onChange={event =>
                  setStockEditForm(current => ({
                    ...current,
                    supplierName: event.target.value,
                  }))
                }
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                仕入先URL
              </span>
              <Input
                value={stockEditForm.supplierUrl}
                onChange={event =>
                  setStockEditForm(current => ({
                    ...current,
                    supplierUrl: event.target.value,
                  }))
                }
                type="url"
              />
            </label>
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditingStockItem(null)}
              disabled={isStockEditSaving}
            >
              キャンセル
            </Button>
            <Button
              type="button"
              onClick={handleSubmitStockEdit}
              disabled={isStockEditSaving || !stockEditForm.title.trim()}
            >
              {isStockEditSaving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Pencil className="mr-2 h-4 w-4" />
              )}
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(trackingDialogRow)}
        onOpenChange={open => {
          if (!open && !upsertPurchaseExtraMutation.isPending)
            setTrackingDialogRow(null);
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
                  {actualProductTitle(trackingDialogRow.purchase_items[0]) ||
                    trackingDialogRow.purchase_items[0]?.title ||
                    "商品"}
                </div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">
                  {getItemLabels(trackingDialogRow.purchase_items)
                    .map(label => label.labelId)
                    .join(" / ") || "商品ID未発行"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  旧管理番号:{" "}
                  {getManagementNos(trackingDialogRow.purchase_items).join(
                    " / "
                  ) || "-"}
                </div>
              </div>
            ) : null}

            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                発送日
              </span>
              <Input
                type="date"
                value={trackingForm.shipDate}
                onChange={event =>
                  setTrackingForm(current => ({
                    ...current,
                    shipDate: event.target.value,
                  }))
                }
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                追跡番号
              </span>
              <Input
                value={trackingForm.trackingNumber}
                onChange={event =>
                  setTrackingForm(current => ({
                    ...current,
                    trackingNumber: event.target.value,
                  }))
                }
                placeholder="追跡番号を入力"
                autoFocus
              />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium text-muted-foreground">
                発送業者
              </span>
              <select
                className={fieldClass}
                value={trackingForm.carrier}
                onChange={event =>
                  setTrackingForm(current => ({
                    ...current,
                    carrier: event.target.value as TrackingFormState["carrier"],
                  }))
                }
              >
                {TRACKING_CARRIER_OPTIONS.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            {trackingPreview ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${getCarrierColor(trackingPreview.carrier)}`}
                >
                  {TRACKING_CARRIER_LABELS[trackingPreview.carrier]}
                </span>
                <span className="font-mono font-semibold">
                  {trackingForm.trackingNumber.trim()}
                </span>
                {trackingPreview.isEcohai ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      openEcohaiTracking(trackingForm.trackingNumber)
                    }
                  >
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
              disabled={
                upsertPurchaseExtraMutation.isPending ||
                !trackingForm.trackingNumber.trim()
              }
            >
              {upsertPurchaseExtraMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Truck className="mr-2 h-4 w-4" />
              )}
              追跡番号を登録
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={showBulkTrackingDialog}
        onOpenChange={open => {
          if (!open && !upsertPurchaseExtraBulkMutation.isPending)
            setShowBulkTrackingDialog(false);
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
                <Badge variant="outline">
                  {selectedBulkTrackingRows.length.toLocaleString()}件
                </Badge>
              </div>
              <div className="max-h-48 overflow-y-auto p-3">
                {selectedBulkTrackingRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    商品が選択されていません。
                  </p>
                ) : (
                  <div className="space-y-2">
                    {selectedBulkTrackingRows.map(row => {
                      const firstItem = row.purchase_items[0];
                      const labels = getItemLabels(row.purchase_items)
                        .map(label => label.labelId)
                        .join(" / ");
                      const managementNos = getManagementNos(
                        row.purchase_items
                      ).join(" / ");
                      return (
                        <div
                          key={row.id}
                          className="rounded-md border bg-background p-2 text-sm"
                        >
                          <div className="font-medium">
                            {actualProductTitle(firstItem) ||
                              firstItem?.title ||
                              "商品"}
                          </div>
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
                <span className="text-xs font-medium text-muted-foreground">
                  発送日
                </span>
                <Input
                  type="date"
                  value={bulkTrackingForm.shipDate}
                  onChange={event =>
                    setBulkTrackingForm(current => ({
                      ...current,
                      shipDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-xs font-medium text-muted-foreground">
                  発送業者
                </span>
                <select
                  className={fieldClass}
                  value={bulkTrackingForm.carrier}
                  onChange={event =>
                    setBulkTrackingForm(current => ({
                      ...current,
                      carrier: event.target
                        .value as TrackingFormState["carrier"],
                    }))
                  }
                >
                  {TRACKING_CARRIER_OPTIONS.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm md:col-span-3">
                <span className="text-xs font-medium text-muted-foreground">
                  追跡番号
                </span>
                <Input
                  value={bulkTrackingForm.trackingNumber}
                  onChange={event =>
                    setBulkTrackingForm(current => ({
                      ...current,
                      trackingNumber: event.target.value,
                    }))
                  }
                  placeholder="追跡番号を入力"
                  autoFocus
                />
              </label>
            </div>

            {bulkTrackingPreview ? (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm">
                <span
                  className={`rounded px-2 py-0.5 text-xs ${getCarrierColor(bulkTrackingPreview.carrier)}`}
                >
                  {TRACKING_CARRIER_LABELS[bulkTrackingPreview.carrier]}
                </span>
                <span className="font-mono font-semibold">
                  {bulkTrackingForm.trackingNumber.trim()}
                </span>
                {bulkTrackingPreview.isEcohai ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      openEcohaiTracking(bulkTrackingForm.trackingNumber)
                    }
                  >
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
              {upsertPurchaseExtraBulkMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Truck className="mr-2 h-4 w-4" />
              )}
              {selectedBulkTrackingRows.length.toLocaleString()}件に登録
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
