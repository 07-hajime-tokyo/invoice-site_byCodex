/**
 * EditShipmentDialog — 発送記録編集ダイアログ
 * 発送日・FedEx追跡番号・送料・メモを編集できる。
 * インボイス明細（台数）は変更不可（削除して再登録）。
 */
import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Pencil, Loader2, Truck } from "lucide-react";
import { toast } from "sonner";

interface ShipmentRecord {
  id: number;
  shippingDate: string;
  trackingNumber: string | null;
  shippingCost: string;
  notes: string | null;
  items: Array<{ invoiceNo: number; quantity: number }>;
}

interface EditShipmentDialogProps {
  shipment: ShipmentRecord;
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

export function EditShipmentDialog({ shipment, onSuccess, trigger }: EditShipmentDialogProps) {
  const [open, setOpen] = useState(false);
  const [shippingDate, setShippingDate] = useState(shipment.shippingDate);
  const [trackingNumber, setTrackingNumber] = useState(shipment.trackingNumber ?? "");
  const [shippingCost, setShippingCost] = useState(String(Number(shipment.shippingCost)));
  const [notes, setNotes] = useState(shipment.notes ?? "");

  // ダイアログを開くたびに最新データでリセット
  useEffect(() => {
    if (open) {
      setShippingDate(shipment.shippingDate);
      setTrackingNumber(shipment.trackingNumber ?? "");
      setShippingCost(String(Number(shipment.shippingCost)));
      setNotes(shipment.notes ?? "");
    }
  }, [open, shipment]);

  const updateMutation = trpc.shipment.update.useMutation({
    onSuccess: () => {
      toast.success("発送記録を更新しました");
      setOpen(false);
      onSuccess?.();
    },
    onError: (err) => {
      toast.error(`更新に失敗しました: ${err.message}`);
    },
  });

  function handleSubmit() {
    if (!shippingDate) {
      toast.error("発送日を入力してください");
      return;
    }
    const cost = parseFloat(shippingCost);
    if (isNaN(cost) || cost < 0) {
      toast.error("送料を正しく入力してください");
      return;
    }
    updateMutation.mutate({
      id: shipment.id,
      shippingDate,
      trackingNumber: trackingNumber.trim() || undefined,
      shippingCost: cost,
      notes: notes.trim() || undefined,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger ? (
        <div onClick={() => setOpen(true)}>{trigger}</div>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
          onClick={() => setOpen(true)}
          title="編集"
        >
          <Pencil size={11} />
        </Button>
      )}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck size={18} className="text-orange-600" />
            発送記録を編集
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* インボイス明細（読み取り専用） */}
          <div className="bg-muted/40 rounded-md p-3 text-xs space-y-1">
            <p className="font-medium text-muted-foreground mb-1">インボイス明細（変更不可）</p>
            {shipment.items.map((item, i) => (
              <p key={i} className="text-foreground">
                No.{item.invoiceNo}: {item.quantity}台
              </p>
            ))}
          </div>

          {/* 発送日 */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-shippingDate" className="text-sm font-medium">
              発送日 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-shippingDate"
              type="date"
              value={shippingDate}
              onChange={(e) => setShippingDate(e.target.value)}
              className="h-9"
            />
          </div>

          {/* FedEx追跡番号 */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-trackingNumber" className="text-sm font-medium">
              FedEx追跡番号
            </Label>
            <Input
              id="edit-trackingNumber"
              type="text"
              placeholder="例: 7489 2345 6789"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className="h-9"
            />
          </div>

          {/* 実際の送料 */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-shippingCost" className="text-sm font-medium">
              実際の送料（円） <span className="text-destructive">*</span>
            </Label>
            <Input
              id="edit-shippingCost"
              type="number"
              placeholder="例: 8000"
              value={shippingCost}
              onChange={(e) => setShippingCost(e.target.value)}
              className="h-9"
              min="0"
            />
          </div>

          {/* メモ */}
          <div className="space-y-1.5">
            <Label htmlFor="edit-notes" className="text-sm font-medium">
              メモ（任意）
            </Label>
            <Input
              id="edit-notes"
              type="text"
              placeholder="備考など"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="h-9"
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => setOpen(false)}
            disabled={updateMutation.isPending}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={updateMutation.isPending}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1" />
                更新中...
              </>
            ) : (
              "更新する"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
