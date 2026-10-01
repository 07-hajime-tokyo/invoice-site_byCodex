import { PurchaseRegistrationCard } from "./PurchaseRegistrationCard";
import { EmptyState } from "./EmptyState";
import { getManagementNos } from "./managementNumbers";
import { getItemLabels } from "./purchaseItems";
import type { PurchaseRow } from "./dataTypes";
import type { AllocationGroup, LabelPrintRequest } from "./viewTypes";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PackageCheck, Truck } from "lucide-react";

export function MissingTrackingOverview({
  rows,
  invoiceOptions,
  totalCount,
  trackingRegisteredOnly,
  trackingRegisteredCount,
  missingTrackingCount,
  selectedRowIds,
  onSelectRow,
  onSelectAllRows,
  onTrackingRegisteredOnlyChange,
  onOpenBulkTracking,
  onPrintLabels,
  onOpenEdit,
  onOpenTrackingDialog,
  onOpenShippingHistory,
  onDeleteRow,
  deletingRowId,
}: {
  rows: PurchaseRow[];
  invoiceOptions: AllocationGroup[];
  totalCount: number;
  trackingRegisteredOnly: boolean;
  trackingRegisteredCount: number;
  missingTrackingCount: number;
  selectedRowIds: Set<number>;
  onSelectRow: (row: PurchaseRow, checked: boolean) => void;
  onSelectAllRows: (rows: PurchaseRow[], checked: boolean) => void;
  onTrackingRegisteredOnlyChange: (checked: boolean) => void;
  onOpenBulkTracking: () => void;
  onPrintLabels: LabelPrintRequest;
  onOpenEdit: (row: PurchaseRow) => void;
  onOpenTrackingDialog: (row: PurchaseRow) => void;
  onOpenShippingHistory: (row: PurchaseRow) => void;
  onDeleteRow: (row: PurchaseRow) => void;
  deletingRowId?: number | null;
}) {
  const selectedRows = rows.filter((row) => selectedRowIds.has(row.id));
  const selectedCount = selectedRows.length;
  const allVisibleSelected = rows.length > 0 && selectedCount === rows.length;

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
              <Truck className="h-4 w-4 text-blue-700" />
              {trackingRegisteredOnly ? "追跡番号登録済み一覧" : "追跡番号未登録一覧"}
              <Badge variant="outline">表示 {rows.length.toLocaleString()}件</Badge>
              <Badge variant="secondary">全体 {totalCount.toLocaleString()}件</Badge>
              <Badge variant="outline">
                {trackingRegisteredOnly
                  ? `追跡登録済み ${trackingRegisteredCount.toLocaleString()}件`
                  : `追跡未登録 ${missingTrackingCount.toLocaleString()}件`}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {trackingRegisteredOnly
                ? "入庫待ちで追跡番号登録済みの商品を、インボイス選択に関係なくサイト登録順で表示しています。"
                : "インボイス選択に関係なく、追跡番号未登録の商品をサイト登録順で表示しています。"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={trackingRegisteredOnly ? "secondary" : "outline"}
              size="sm"
              className="h-9 gap-2"
              onClick={() => onTrackingRegisteredOnlyChange(!trackingRegisteredOnly)}
            >
              <PackageCheck className="h-4 w-4" />
              登録済みのみ表示
              <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                {trackingRegisteredCount.toLocaleString()}
              </Badge>
            </Button>
            <label className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm">
              <Checkbox
                checked={allVisibleSelected}
                onCheckedChange={(checked) => onSelectAllRows(rows, checked === true)}
                disabled={rows.length === 0}
                aria-label="表示中の商品をすべて選択"
              />
              全選択
            </label>
          </div>
        </div>
      </section>

      {rows.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="表示できる商品はありません"
          description="検索条件を変えると、別の商品が見つかる場合があります。"
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <PurchaseRegistrationCard
              key={row.id}
              row={row}
              invoiceOptions={invoiceOptions}
              onPrintLabels={onPrintLabels}
              onOpenEdit={onOpenEdit}
              onOpenTrackingDialog={onOpenTrackingDialog}
              onOpenShippingHistory={onOpenShippingHistory}
              onDeleteRow={onDeleteRow}
              isDeleting={deletingRowId === row.id}
              isSelected={selectedRowIds.has(row.id)}
              onSelectChange={onSelectRow}
            />
          ))}
        </div>
      )}

      {selectedCount > 0 ? (
        <div className="fixed inset-x-0 bottom-[4.75rem] z-30 border-t bg-background/95 shadow-lg backdrop-blur lg:bottom-0 lg:right-[204px]">
          <div className="mx-auto max-w-5xl px-4 py-3">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {selectedRows.map((row) => {
                const managementNos = getManagementNos(row.purchase_items).join(" / ");
                const labelIds = getItemLabels(row.purchase_items).map((label) => label.labelId).join(" / ");
                return (
                  <Badge key={row.id} variant="secondary" className="max-w-[220px] truncate text-xs">
                    {managementNos || labelIds || `#${row.id}`}
                  </Badge>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="min-w-[140px] flex-1 text-sm text-muted-foreground">
                <Truck className="mr-1.5 inline h-4 w-4 text-blue-600" />
                {selectedCount.toLocaleString()}件選択中
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onSelectAllRows(rows, false)}
              >
                選択解除
              </Button>
              <Button
                type="button"
                size="sm"
                className="gap-2 bg-blue-600 text-white hover:bg-blue-700"
                onClick={onOpenBulkTracking}
              >
                <Truck className="h-4 w-4" />
                追跡番号を一括登録/更新
                <Badge className="bg-white/20 text-white hover:bg-white/20">{selectedCount}</Badge>
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
