import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Loader2,
  Trash2,
  Undo2,
  XCircle,
} from "lucide-react";
import type { InventoryDetail } from "./types";
import { formatDate, formatDateShort, formatPrice, getManagementNo, getSupplierSite } from "./display";

/** 商品詳細トグル（インライン展開） */
export function InventoryDetailToggle({
  historyId,
  inventoryId,
  title,
  quantity,
  unit,
  labelId,
  managementNo: historyManagementNo,
  isOpen,
  onToggle,
  onDeleted,
  onDeleteInventory,
  isBatchMode,
  isSelected,
  onSelectChange,
  isCancelled,
  cancelledAt,
  isDeleted: isDeletedProp,
  onCancelItem,
  isPendingCancel,
  historyStatus,
}: {
  historyId: number;
  inventoryId: number;
  title: string;
  quantity: number;
  unit: string;
  labelId?: string;
  managementNo?: string | null;
  isOpen: boolean;
  onToggle: () => void;
  onDeleted?: (historyId: number, id: number) => void;
  onDeleteInventory?: (inventoryId: number, title: string) => void;
  isBatchMode?: boolean;
  isSelected?: boolean;
  onSelectChange?: (checked: boolean) => void;
  isCancelled?: boolean;
  cancelledAt?: string;
  isDeleted?: boolean;
  onCancelItem?: () => void;
  isPendingCancel?: boolean;
  historyStatus?: string;
}) {
  const { data: detail, isLoading } = trpc.inventory.zaico.getInventoryById.useQuery(
    { inventoryId },
    { enabled: isOpen }
  );
  const inv = (detail ?? null) as InventoryDetail | null;
  const isFromLocalDb = inv?._fromLocalDb === true;
  // DBフォールバックデータがある場合はZaico削除扱いにしない
  const isDeletedFromZaico = isOpen && !isLoading && inv === null;
  if (isDeletedFromZaico && onDeleted) {
    onDeleted(historyId, inventoryId);
  }
  const inventoryManagementNo = getManagementNo(inv?.etc);
  const managementNo = inventoryManagementNo || historyManagementNo?.trim() || "";
  const supplierSite = getSupplierSite(inv?.etc);
  const unitPrice = inv?.purchase_unit_price ?? inv?.unit_price;
  const displayCategory = inv?.categories?.[0] ?? inv?.category ?? "-";
  const displayLabelId = labelId?.trim().toUpperCase() || inv?.itemLabels?.map((item) => item.labelId).filter(Boolean).join(" / ");

  if (isDeletedProp) {
    return (
      <div className="w-full">
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors cursor-pointer group w-full ${
            isOpen
              ? "bg-muted/30 border border-muted"
              : "bg-muted/20 hover:bg-muted/30 border border-muted/50 hover:border-muted"
          }`}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <span className="text-xs bg-muted-foreground/50 text-background rounded px-1 py-0.5 font-medium leading-none flex-shrink-0">削除済</span>
          <span className="line-through text-muted-foreground flex-1 truncate text-left">{title}</span>
          {managementNo && !isOpen && (
            <span className="text-xs text-muted-foreground flex-shrink-0">({managementNo})</span>
          )}
          <span className="text-muted-foreground/60 text-xs flex-shrink-0">x {quantity}</span>
        </button>
        {isOpen && (
          <div className="mt-1.5 ml-4 rounded-lg border bg-card/80 p-3 text-sm space-y-1.5 shadow-sm">
            {isLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-muted-foreground text-xs">読み込み中...</span>
              </div>
            ) : inv ? (
              <>
                {displayLabelId && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">商品ID</span>
                    <span className="font-mono font-bold text-right">{displayLabelId}</span>
                  </div>
                )}
                {managementNo && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">管理番号</span>
                    <span className="font-bold text-right">{managementNo}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">カテゴリ</span>
                  <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
                </div>
                {unitPrice != null && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
                    <span className="font-semibold text-right">{formatPrice(unitPrice)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">出庫数量</span>
                  <span className="font-medium text-right">{quantity} {unit}</span>
                </div>
                {supplierSite && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入先</span>
                    <span className="text-right">{supplierSite}</span>
                  </div>
                )}
                {inv.optional_attributes?.map((attr) =>
                  attr.value ? (
                    <div key={attr.name} className="flex justify-between gap-2">
                      <span className="text-muted-foreground flex-shrink-0">{attr.name}</span>
                      <span className="text-right">{attr.value}</span>
                    </div>
                  ) : null
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">最終更新日</span>
                  <span className="text-right">{formatDateShort(inv.updated_at)}</span>
                </div>
              </>
            ) : isFromLocalDb ? (
              <>
                <div className="mb-1.5 flex items-center gap-1.5 text-amber-600">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-xs font-medium">削除済み（DB情報）</span>
                </div>
                {displayLabelId && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">商品ID</span>
                    <span className="font-mono font-bold text-right">{displayLabelId}</span>
                  </div>
                )}
                {managementNo && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">管理番号</span>
                    <span className="font-bold text-right">{managementNo}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">カテゴリ</span>
                  <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
                </div>
                {unitPrice != null && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
                    <span className="font-semibold text-right">{formatPrice(unitPrice)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">出庫数量</span>
                  <span className="font-medium text-right">{quantity} {unit}</span>
                </div>
                {supplierSite && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入先</span>
                    <span className="text-right">{supplierSite}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">最終更新日</span>
                  <span className="text-right">{formatDateShort((inv as { updated_at?: string } | null)?.updated_at ?? "")}</span>
                </div>
              </>
            ) : (
              <div className="py-2 text-center space-y-1">
                <XCircle className="h-6 w-6 mx-auto text-destructive/60" />
                <p className="text-xs font-medium text-destructive">この商品は削除されています</p>
                <p className="text-xs text-muted-foreground">{title} x {quantity}</p>
                {managementNo && <p className="text-xs text-muted-foreground">管理番号: {managementNo}</p>}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (isCancelled) {
    return (
      <div className="w-full">
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors cursor-pointer group w-full ${
            isOpen
              ? "bg-blue-50/60 border border-blue-200"
              : "bg-blue-50/40 hover:bg-blue-50/60 border border-blue-200/50 hover:border-blue-200"
          }`}
          title={`取り消し済み: ${cancelledAt ? formatDate(cancelledAt) : ""}`}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-blue-400 flex-shrink-0" />
          )}
          <span className="text-xs bg-blue-500 text-white rounded px-1 py-0.5 font-medium leading-none flex-shrink-0">取消済</span>
          <span className="line-through text-muted-foreground flex-1 truncate text-left">{title}</span>
          <span className="text-muted-foreground/60 text-xs flex-shrink-0">x {quantity}</span>
        </button>
        {isOpen && (
          <div className="mt-1.5 ml-4 rounded-lg border bg-card/80 p-3 text-sm space-y-1.5 shadow-sm">
            {isLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span className="text-muted-foreground text-xs">読み込み中...</span>
              </div>
            ) : inv ? (
              <>
                <div className="mb-1.5 flex items-center gap-1.5 text-blue-600">
                  <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-xs font-medium">取り消し済み{cancelledAt ? ` (${formatDate(cancelledAt)})` : ""}</span>
                </div>
                {inv.item_image?.url && (
                  <div className="flex justify-center pb-1">
                    <img src={inv.item_image.url} alt={inv.title} loading="lazy" decoding="async" className="h-24 w-24 object-contain rounded-lg border bg-muted/20" />
                  </div>
                )}
                {displayLabelId && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">商品ID</span>
                    <span className="font-mono font-bold text-right">{displayLabelId}</span>
                  </div>
                )}
                {managementNo && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">管理番号</span>
                    <span className="font-bold text-right">{managementNo}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">カテゴリ</span>
                  <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
                </div>
                {unitPrice != null && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
                    <span className="font-semibold text-right">{formatPrice(unitPrice)}</span>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">出庫数量</span>
                  <span className="font-medium text-right">{quantity} {unit}</span>
                </div>
                {supplierSite && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">仕入先</span>
                    <span className="text-right">{supplierSite}</span>
                  </div>
                )}
                {inv.optional_attributes?.map((attr) =>
                  attr.value ? (
                    <div key={attr.name} className="flex justify-between gap-2">
                      <span className="text-muted-foreground flex-shrink-0">{attr.name}</span>
                      <span className="text-right">{attr.value}</span>
                    </div>
                  ) : null
                )}
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">最終更新日</span>
                  <span className="text-right">{formatDateShort(inv.updated_at)}</span>
                </div>
              </>
            ) : (
              <div className="py-2 text-center space-y-1">
                <p className="text-xs text-muted-foreground">詳細情報を取得できませんでした</p>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="flex items-center gap-1">
        {isBatchMode && (
          <Checkbox
            checked={!!isSelected}
            onCheckedChange={(checked) => onSelectChange?.(!!checked)}
            className="h-4 w-4"
          />
        )}
        <button
          onClick={onToggle}
          className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors cursor-pointer group flex-1 min-w-0 ${
            isOpen
              ? "bg-primary/10 border border-primary/30"
              : "bg-muted/40 hover:bg-primary/10 hover:border-primary/30 border border-transparent"
          }`}
        >
          {isOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-primary flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-primary flex-shrink-0" />
          )}
          <span className={`font-medium truncate ${isOpen ? "text-primary" : "group-hover:text-primary"} transition-colors`}>
            {title}
          </span>
          {managementNo && !isOpen && (
            <span className="text-xs text-muted-foreground flex-shrink-0">({managementNo})</span>
          )}
          <span className="text-muted-foreground flex-shrink-0">x {quantity}</span>
        </button>
        {!isBatchMode && historyStatus === "success" && (
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10 flex-shrink-0"
            title="この商品の出庫を取り消す"
            onClick={onCancelItem}
            disabled={isPendingCancel}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      {isOpen && (
        <div className="mt-1.5 ml-4 rounded-lg border bg-card/80 p-3 text-sm space-y-1.5 shadow-sm">
          {isLoading ? (
            <div className="flex items-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-muted-foreground text-xs">読み込み中...</span>
            </div>
          ) : isDeletedFromZaico ? (
            <div className="py-2 text-center space-y-1">
              <XCircle className="h-6 w-6 mx-auto text-destructive/60" />
              <p className="text-xs font-medium text-destructive">この商品は削除されています</p>
            </div>
          ) : inv ? (
            <>
              {inv.item_image?.url && (
                <div className="flex justify-center pb-1">
                  <img src={inv.item_image.url} alt={inv.title} loading="lazy" decoding="async" className="h-24 w-24 object-contain rounded-lg border bg-muted/20" />
                </div>
              )}
              {displayLabelId && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">商品ID</span>
                  <span className="font-mono font-bold text-right">{displayLabelId}</span>
                </div>
              )}
              {managementNo && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">管理番号</span>
                  <span className="font-bold text-right">{managementNo}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-shrink-0">カテゴリ</span>
                <Badge variant="outline" className="text-xs">{displayCategory}</Badge>
              </div>
              {unitPrice != null && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
                  <span className="font-semibold text-right">{formatPrice(unitPrice)}</span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-shrink-0">現在の在庫数</span>
                <span className="text-right">{Math.floor(parseFloat(inv.quantity ?? "0"))} {inv.unit}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-shrink-0">出庫数量</span>
                <span className="font-medium text-right">{quantity} {unit}</span>
              </div>
              {inv.place && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">保管場所</span>
                  <span className="text-right">{inv.place}</span>
                </div>
              )}
              {supplierSite && (
                <div className="flex justify-between gap-2">
                  <span className="text-muted-foreground flex-shrink-0">仕入先</span>
                  <span className="text-right">{supplierSite}</span>
                </div>
              )}
              {inv.optional_attributes?.map((attr) =>
                attr.value ? (
                  <div key={attr.name} className="flex justify-between gap-2">
                    <span className="text-muted-foreground flex-shrink-0">{attr.name}</span>
                    <span className="text-right">{attr.value}</span>
                  </div>
                ) : null
              )}
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground flex-shrink-0">最終更新日</span>
                <span className="text-right">{formatDateShort(inv.updated_at)}</span>
              </div>
              <div className="pt-1.5 border-t flex items-center justify-end gap-2">
                {onDeleteInventory && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-6 text-xs gap-1"
                    onClick={() => onDeleteInventory(inventoryId, title)}
                  >
                    <Trash2 className="h-3 w-3" />
                    在庫から削除
                  </Button>
                )}
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">詳細情報を取得できませんでした</p>
          )}
        </div>
      )}
    </div>
  );
}
