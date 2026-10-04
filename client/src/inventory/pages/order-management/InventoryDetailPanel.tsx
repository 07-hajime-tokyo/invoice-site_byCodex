import { trpc } from "@/lib/trpc";
import { Loader2, ExternalLink } from "lucide-react";

/** 在庫詳細パネル */
export function InventoryDetailPanel({ inventoryId, unitPrice: propUnitPrice, trackingNumber: propTracking, supplierUrl: propSupplierUrl, supplierName: propSupplierName }: {
  inventoryId: number; unitPrice?: string; trackingNumber?: string; supplierUrl?: string; supplierName?: string;
}) {
  const { data: detail, isLoading } = trpc.inventory.zaico.getInventoryById.useQuery({ inventoryId });
  if (isLoading) return <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />読み込み中...</div>;
  // Zaicoデータが取れない場合（削除済み商品等）はプロップスのデータだけで表示
  if (!detail) {
    if (!propUnitPrice && !propTracking && !propSupplierName) {
      return <div className="px-4 py-2 text-xs text-muted-foreground">詳細情報を取得できませんでした（削除済み商品）</div>;
    }
    return (
      <div className="px-4 py-2.5 bg-purple-50/30 border-t border-purple-100 text-sm space-y-1.5">
        {propTracking && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground flex-shrink-0">追跡番号</span>
            <span className="font-mono text-right">{propTracking}</span>
          </div>
        )}
        {propSupplierName && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground flex-shrink-0">仕入先</span>
            {propSupplierUrl ? (
              <a href={propSupplierUrl} target="_blank" rel="noopener noreferrer" className="text-right text-primary hover:underline flex items-center gap-1">
                <ExternalLink className="h-3 w-3 flex-shrink-0" />{propSupplierName}
              </a>
            ) : (
              <span className="text-right">{propSupplierName}</span>
            )}
          </div>
        )}
        {propUnitPrice && (
          <div className="flex justify-between gap-2">
            <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
            <span className="font-semibold text-right">¥{Number(propUnitPrice).toLocaleString()}</span>
          </div>
        )}
      </div>
    );
  }
  const inv = detail as {
    id: number; title: string; quantity: string; unit: string; place?: string | null;
    purchase_unit_price?: number | null; unit_price?: number | null;
    etc?: string | null; item_image?: { url: string } | null;
    optional_attributes?: Array<{ name: string; value: string | null }> | null;
    updated_at?: string | null;
  };
  // 仕入単価: props層渡し > Zaicoデータ
  const displayUnitPrice = propUnitPrice !== undefined && propUnitPrice !== "" ? Number(propUnitPrice) : (inv.purchase_unit_price ?? inv.unit_price);
  // 追跡番号・仕入先: props層渡しを優先
  const displayTracking = propTracking || null;
  const displaySupplierName = propSupplierName || null;
  const displaySupplierUrl = propSupplierUrl || null;
  return (
    <div className="px-4 py-2.5 bg-purple-50/30 border-t border-purple-100 text-sm space-y-1.5">
      {inv.item_image?.url && (
        <div className="flex justify-center pb-1">
          <img src={inv.item_image.url} alt={inv.title} loading="lazy" decoding="async" className="h-20 w-20 object-contain rounded border bg-muted/20" />
        </div>
      )}
      {displayTracking && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">追跡番号</span>
          <span className="font-mono text-right">{displayTracking}</span>
        </div>
      )}
      {displaySupplierName && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入先</span>
          {displaySupplierUrl ? (
            <a href={displaySupplierUrl} target="_blank" rel="noopener noreferrer" className="text-right text-primary hover:underline flex items-center gap-1">
              <ExternalLink className="h-3 w-3 flex-shrink-0" />{displaySupplierName}
            </a>
          ) : (
            <span className="text-right">{displaySupplierName}</span>
          )}
        </div>
      )}
      {displayUnitPrice != null && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
          <span className="font-semibold text-right">¥{displayUnitPrice.toLocaleString()}</span>
        </div>
      )}
      {inv.place && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">保管場所</span>
          <span className="text-right">{inv.place}</span>
        </div>
      )}
      {inv.optional_attributes?.map((attr) =>
        attr.value && attr.name !== "仕入単価" ? (
          <div key={attr.name} className="flex justify-between gap-2">
            <span className="text-muted-foreground flex-shrink-0">{attr.name}</span>
            <span className="text-right">{attr.value}</span>
          </div>
        ) : null
      )}
    </div>
  );
}
