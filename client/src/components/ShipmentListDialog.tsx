/**
 * ShipmentListDialog — 全発送記録一覧ダイアログ
 * 全ての発送便を一覧表示し、編集・削除が可能。
 */
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Truck, Loader2, Trash2, Package, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { EditShipmentDialog } from "@/components/EditShipmentDialog";

interface ShipmentListDialogProps {
  onUpdated?: () => void;
}

export function ShipmentListDialog({ onUpdated }: ShipmentListDialogProps) {
  const [open, setOpen] = useState(false);

  const { data: shipments, isLoading, refetch } = trpc.shipment.list.useQuery(
    undefined,
    { enabled: open }
  );

  const deleteMutation = trpc.shipment.delete.useMutation({
    onSuccess: () => {
      toast.success("発送記録を削除しました");
      refetch();
      onUpdated?.();
    },
    onError: (err) => {
      toast.error(`削除に失敗しました: ${err.message}`);
    },
  });

  function handleDelete(id: number) {
    if (!confirm("この発送記録を削除しますか？\n送料が仮送料に戻ります。")) return;
    deleteMutation.mutate({ id });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs gap-1 text-muted-foreground hover:text-orange-600 hover:bg-orange-50 flex-shrink-0"
        >
          <ClipboardList size={12} />
          <span className="hidden sm:inline">発送一覧</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck size={18} className="text-orange-600" />
            発送記録一覧
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 gap-2 text-muted-foreground">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">読み込み中...</span>
          </div>
        ) : !shipments || shipments.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-muted-foreground">
            <Package size={32} className="opacity-30" />
            <p className="text-sm">発送記録がありません</p>
          </div>
        ) : (
          <div className="space-y-3 py-2">
            <p className="text-xs text-muted-foreground">
              合計 {shipments.length} 件の発送記録
            </p>
            {shipments.map((s) => {
              const totalQty = s.items.reduce((sum, i) => sum + i.quantity, 0);
              const invoiceNos = [...new Set(s.items.map((i) => i.invoiceNo))].sort((a, b) => a - b);
              return (
                <div
                  key={s.id}
                  className="border border-border rounded-lg p-4 bg-white space-y-3"
                >
                  {/* ヘッダー行 */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                        <Truck size={14} className="text-orange-600" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{s.shippingDate}</p>
                        <p className="text-xs text-muted-foreground">
                          {totalQty}台 · ¥{Number(s.shippingCost).toLocaleString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <EditShipmentDialog
                        shipment={s}
                        onSuccess={() => { refetch(); onUpdated?.(); }}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDelete(s.id)}
                        disabled={deleteMutation.isPending}
                        title="削除"
                      >
                        <Trash2 size={13} />
                      </Button>
                    </div>
                  </div>

                  {/* 詳細情報 */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    {s.trackingNumber && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">追跡番号: </span>
                        <span className="font-mono text-foreground">{s.trackingNumber}</span>
                      </div>
                    )}
                    {s.notes && (
                      <div className="col-span-2">
                        <span className="text-muted-foreground">メモ: </span>
                        <span className="text-foreground">{s.notes}</span>
                      </div>
                    )}
                  </div>

                  {/* インボイス明細 */}
                  <div className="bg-muted/30 rounded-md p-2 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground mb-1">インボイス明細</p>
                    <div className="flex flex-wrap gap-2">
                      {s.items.map((item, idx) => {
                        const allocated = totalQty > 0
                          ? Math.round((Number(s.shippingCost) / totalQty) * item.quantity)
                          : 0;
                        return (
                          <div
                            key={idx}
                            className="bg-white border border-border rounded px-2 py-1 text-xs"
                          >
                            <span className="font-medium">No.{item.invoiceNo}</span>
                            <span className="text-muted-foreground ml-1">{item.quantity}台</span>
                            {s.items.length > 1 && (
                              <span className="text-orange-600 ml-1">
                                (¥{allocated.toLocaleString()})
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
