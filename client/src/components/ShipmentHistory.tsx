/**
 * ShipmentHistory — 特定インボイスの発送記録一覧
 * インボイスNoを受け取り、その発送記録を表示する。
 * 発送状況（何台/全台数）も表示する。
 */
import { trpc } from "@/lib/trpc";
import { Truck, Package, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { EditShipmentDialog } from "@/components/EditShipmentDialog";

interface ShipmentHistoryProps {
  invoiceNo: number;
  orderedQty: number;
  onDeleted?: () => void;
}

export function ShipmentHistory({ invoiceNo, orderedQty, onDeleted }: ShipmentHistoryProps) {
  const { data: shipments, isLoading, refetch } = trpc.shipment.byInvoice.useQuery(
    { invoiceNo },
    { enabled: invoiceNo > 0 }
  );
  const deleteMutation = trpc.shipment.delete.useMutation({
    onSuccess: () => {
      toast.success("発送記録を削除しました");
      refetch();
      onDeleted?.();
    },
    onError: (err) => {
      toast.error(`削除に失敗しました: ${err.message}`);
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
        <Loader2 size={12} className="animate-spin" />
        読み込み中...
      </div>
    );
  }

  if (!shipments || shipments.length === 0) {
    return (
      <div className="text-xs text-muted-foreground py-1">
        発送記録なし（仮送料: ¥{(550 * orderedQty).toLocaleString()}）
      </div>
    );
  }

  const shippedQty = shipments.reduce((sum, s) => {
    const thisQty = s.items
      .filter((i) => i.invoiceNo === invoiceNo)
      .reduce((s2, i) => s2 + i.quantity, 0);
    return sum + thisQty;
  }, 0);

  const isComplete = shippedQty >= orderedQty;

  return (
    <div className="space-y-2">
      {/* 発送状況サマリー */}
      <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded-md ${
        isComplete
          ? "bg-teal-50 text-teal-700 border border-teal-200"
          : "bg-amber-50 text-amber-700 border border-amber-200"
      }`}>
        <Package size={12} />
        <span>
          発送済み: <strong>{shippedQty}</strong> / {orderedQty} 台
          {isComplete ? " ✓ 完了" : " (未完了)"}
        </span>
      </div>

      {/* 発送記録リスト */}
      {shipments.map((s) => {
        const thisQty = s.items
          .filter((i) => i.invoiceNo === invoiceNo)
          .reduce((sum, i) => sum + i.quantity, 0);
        const totalQtyInShipment = s.items.reduce((sum, i) => sum + i.quantity, 0);
        const allocated = totalQtyInShipment > 0
          ? Math.round((Number(s.shippingCost) / totalQtyInShipment) * thisQty)
          : 0;

        return (
            <div
            key={s.id}
            className="border border-border rounded-md p-2 text-xs space-y-1 bg-white"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <Truck size={11} className="text-orange-600" />
                {s.shippingDate}
              </div>
              <div className="flex items-center gap-0.5">
                <EditShipmentDialog
                  shipment={s}
                  onSuccess={() => { refetch(); onDeleted?.(); }}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => deleteMutation.mutate({ id: s.id })}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 size={11} />
                </Button>
              </div>
            </div>
            {s.trackingNumber && (
              <div className="text-muted-foreground">
                追跡番号: <span className="font-mono text-foreground">{s.trackingNumber}</span>
              </div>
            )}
            <div className="text-muted-foreground">
              発送台数: <strong className="text-foreground">{thisQty}台</strong>
              {s.items.length > 1 && (
                <span className="ml-1">
                  （この便の合計: {totalQtyInShipment}台）
                </span>
              )}
            </div>
            <div className="text-muted-foreground">
              {s.items
                .filter((item) => item.invoiceNo === invoiceNo)
                .map((item) => (
                  <div key={item.id} className="text-[11px] text-muted-foreground">
                    {item.productName ? item.productName : `No.${item.invoiceNo}`} × {item.quantity}台
                  </div>
                ))}
              送料: ¥{Number(s.shippingCost).toLocaleString()}
              {s.items.length > 1 && (
                <span className="ml-1 text-orange-700">
                  → 按分: ¥{allocated.toLocaleString()}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
