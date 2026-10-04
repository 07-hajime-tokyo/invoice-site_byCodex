import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CalendarDays, ExternalLink, Pencil } from "lucide-react";
import { normalizeExternalUrl } from "@/inventory/lib/supplier";
import { formatCurrency, formatDate } from "./format";
import type { StockItemView } from "./viewTypes";

export function StockDetailCard({
  item,
  onOpenEdit,
}: {
  item: StockItemView;
  onOpenEdit: (inventoryId: number) => void;
}) {
  return (
    <section className="rounded-lg border border-emerald-100 bg-emerald-50/30 shadow-sm">
      <div className="flex flex-col gap-4 border-b border-emerald-100 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {item.labelId ? (
              <span className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-mono text-lg font-semibold tracking-wide text-emerald-800">
                {item.labelId}
              </span>
            ) : (
              <span className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm font-medium text-slate-600">
                商品ID未発行
              </span>
            )}
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">現在庫</Badge>
            {item.quantity > 1 ? <Badge variant="outline">{item.quantity.toLocaleString()}点</Badge> : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>旧管理番号: {item.legacyManagementNo || "-"}</span>
            <span>引当先: {item.allocationLabel || "-"}</span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2 border-blue-200 text-blue-700 hover:bg-blue-50 sm:w-fit"
          onClick={() => onOpenEdit(item.inventoryId)}
        >
          <Pencil className="h-4 w-4" />
          編集
        </Button>
      </div>

      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
        <div className="min-w-0 xl:col-span-2">
          <div className="text-xs text-muted-foreground">商品名</div>
          <div className="mt-1 truncate text-sm font-medium">{item.title || "-"}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">在庫数</div>
          <div className="mt-1 text-sm font-semibold">{item.quantity.toLocaleString()}個</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">仕入単価</div>
          <div className="mt-1 text-sm font-semibold">{formatCurrency(item.unitPrice)}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">入庫日</div>
          <div className="mt-1 flex items-center gap-1 text-sm font-medium">
            <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
            {formatDate(item.purchaseDate)}
          </div>
        </div>
        <div className="min-w-0 md:col-span-2 xl:col-span-5">
          <div className="text-xs text-muted-foreground">仕入先</div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-sm">
            <span className="truncate font-medium">{item.supplier.name}</span>
            {item.supplier.url ? (
              <a
                href={normalizeExternalUrl(item.supplier.url)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-emerald-700 hover:underline"
              >
                開く
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}
