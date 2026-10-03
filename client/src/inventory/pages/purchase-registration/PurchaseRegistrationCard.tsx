import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { CalendarDays, ExternalLink, Pencil, Truck, Printer, Loader2, Trash2 } from "lucide-react";
import { normalizeExternalUrl } from "@/inventory/lib/supplier";
import { getCarrierColor } from "@/inventory/lib/tracking";
import { invoiceNoFromManagementNo } from "@shared/invoiceKey";
import { actualProductTitle } from "./productTitles";
import { getItemLabels, sumQuantity, itemStockQuantity } from "./purchaseItems";
import { getManagementNos, preferredManagementNo } from "./managementNumbers";
import { invoiceDisplayLabel } from "./shippingRules";
import { BoxItemInvoiceField } from "./OutboundBoxes";
import { getSupplier } from "./supplier";
import { purchaseTrackingNumber, getPurchaseTrackingMeta, TRACKING_CARRIER_LABELS } from "./tracking";
import { buildLabelViews } from "./registrationLabelViews";
import { labelBadgeClass } from "./labelStatus";
import { statusClass, statusLabel } from "./rowStatus";
import { formatCurrency, formatDate } from "./format";
import type { PurchaseRow } from "./dataTypes";
import type { AllocationGroup, LabelPrintRequest } from "./viewTypes";
import { openEcohaiTracking } from "./trackingNavigation";
import { purchaseRowInventoryId } from "./purchaseRowIdentity";

export function PurchaseRegistrationCard({
  row,
  invoiceOptions,
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
  invoiceOptions: AllocationGroup[];
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
  const visibleAssignmentLabels = labels.slice(0, 4).map((label) => {
    const legacyManagementNo = preferredManagementNo(label.legacyManagementNo, managementNos[0], "");
    const effectiveInvoiceNo = label.assignedInvoiceNo ?? invoiceNoFromManagementNo(legacyManagementNo);
    return { label, legacyManagementNo, effectiveInvoiceNo };
  });

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
            {labels.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-muted-foreground">充当先</span>
                {visibleAssignmentLabels.map(({ label, legacyManagementNo, effectiveInvoiceNo }) => (
                  <div
                    key={`${row.id}-${label.labelId}-assignment`}
                    className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border bg-slate-50 px-2 py-1"
                  >
                    <span className="font-mono text-[11px] font-semibold text-slate-700">{label.labelId}</span>
                    <Badge variant={label.assignedInvoiceNo ? "default" : "secondary"} className="h-5 px-1.5 text-[10px]">
                      {label.assignedInvoiceNo
                        ? `充当先 ${invoiceDisplayLabel(invoiceOptions, label.assignedInvoiceNo)}`
                        : effectiveInvoiceNo
                          ? `自動 ${invoiceDisplayLabel(invoiceOptions, effectiveInvoiceNo)}`
                          : "未定"}
                    </Badge>
                    <BoxItemInvoiceField
                      labelId={label.labelId}
                      assignedInvoiceNo={label.assignedInvoiceNo ?? null}
                      legacyManagementNo={legacyManagementNo || null}
                    />
                  </div>
                ))}
                {labels.length > visibleAssignmentLabels.length ? (
                  <Badge variant="outline">他{labels.length - visibleAssignmentLabels.length}件</Badge>
                ) : null}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">充当先: 商品ID発行後に指定できます</div>
            )}
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
                href={normalizeExternalUrl(supplier.url)}
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
