import { trpc } from "@/lib/trpc";
import { Loader2 } from "lucide-react";

/** 発注詳細パネル */
export function PurchaseDetailPanel({ purchaseId }: { purchaseId: number }) {
  const { data: allPurchases, isLoading } = trpc.inventory.zaico.getPurchasesWithCategory.useQuery();
  const purchase = allPurchases?.find((p: { id: number }) => p.id === purchaseId);
  if (isLoading) return <div className="px-4 py-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />読み込み中...</div>;
  if (!purchase) return <div className="px-4 py-2 text-xs text-muted-foreground">詳細情報を取得できませんでした</div>;
  const p = purchase as unknown as {
    id: number; num: string; status: string; purchase_date: string | null;
    purchase_items: Array<{ id: number; title: string; quantity: string; etc: string | null; unit_price: string | null; }>;
    extra?: { shipDate?: string | null; trackingNumber?: string | null; supplierName?: string | null; supplierUrl?: string | null; } | null;
    csvSupplierName?: string | null;
  };
  return (
    <div className="px-4 py-2.5 bg-blue-50/30 border-t border-blue-100 text-sm space-y-1.5">
      {(p.extra?.trackingNumber) && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">追跡番号</span>
          <span className="font-mono text-right">{p.extra?.trackingNumber}</span>
        </div>
      )}
      {p.purchase_date && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">発注日</span>
          <span className="text-right">{new Date(p.purchase_date).toLocaleDateString("ja-JP")}</span>
        </div>
      )}
      {(p.extra?.supplierName ?? p.csvSupplierName) && (
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入先</span>
          <span className="text-right">{p.extra?.supplierName ?? p.csvSupplierName}</span>
        </div>
      )}
      {p.purchase_items.map((item, i) => item.unit_price != null && (
        <div key={i} className="flex justify-between gap-2">
          <span className="text-muted-foreground flex-shrink-0">仕入単価</span>
          <span className="font-semibold text-right">¥{Number(item.unit_price).toLocaleString()}</span>
        </div>
      ))}
    </div>
  );
}
