/**
 * EditShipmentDialog — 発送記録編集ダイアログ
 * 発送日・FedEx追跡番号・送料・メモ・インボイス明細を編集できる。
 */
import { useCallback, useState, useEffect } from "react";
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
import { Pencil, Loader2, Truck, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { InvoiceItemSelect, InvoiceSummaryBadge } from "@/components/AddShipmentDialog";

interface ShipmentItemForm {
  invoiceNo: string;
  tradeRecordId: string;
  quantity: string;
}

interface ShipmentRecord {
  id: number;
  shippingDate: string;
  trackingNumber: string | null;
  shippingCost: string;
  notes: string | null;
  items: Array<{ invoiceNo: number; tradeRecordId?: number | null; quantity: number }>;
}

interface EditShipmentDialogProps {
  shipment: ShipmentRecord;
  onSuccess?: () => void;
  trigger?: React.ReactNode;
}

function shipmentItemsToForm(items: ShipmentRecord["items"]): ShipmentItemForm[] {
  const formItems = items.map((item) => ({
    invoiceNo: String(item.invoiceNo ?? ""),
    tradeRecordId: item.tradeRecordId ? String(item.tradeRecordId) : "",
    quantity: String(item.quantity ?? ""),
  }));
  return formItems.length > 0 ? formItems : [{ invoiceNo: "", tradeRecordId: "", quantity: "" }];
}

export function EditShipmentDialog({ shipment, onSuccess, trigger }: EditShipmentDialogProps) {
  const [open, setOpen] = useState(false);
  const [shippingDate, setShippingDate] = useState(shipment.shippingDate);
  const [trackingNumber, setTrackingNumber] = useState(shipment.trackingNumber ?? "");
  const [shippingCost, setShippingCost] = useState(String(Number(shipment.shippingCost)));
  const [notes, setNotes] = useState(shipment.notes ?? "");
  const [items, setItems] = useState<ShipmentItemForm[]>(() => shipmentItemsToForm(shipment.items));

  // ダイアログを開くたびに最新データでリセット
  useEffect(() => {
    if (open) {
      setShippingDate(shipment.shippingDate);
      setTrackingNumber(shipment.trackingNumber ?? "");
      setShippingCost(String(Number(shipment.shippingCost)));
      setNotes(shipment.notes ?? "");
      setItems(shipmentItemsToForm(shipment.items));
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
    const parsedItems = items
      .filter((item) => item.invoiceNo.trim() !== "" && item.quantity.trim() !== "")
      .map((item) => ({
        invoiceNo: parseInt(item.invoiceNo, 10),
        tradeRecordId: parseInt(item.tradeRecordId, 10),
        quantity: parseInt(item.quantity, 10),
      }));
    if (parsedItems.length === 0) {
      toast.error("インボイス番号と発送台数を1件以上入力してください");
      return;
    }
    if (parsedItems.some((item) => !Number.isFinite(item.invoiceNo) || !Number.isFinite(item.quantity) || item.quantity <= 0)) {
      toast.error("インボイス番号と発送台数は正の整数で入力してください");
      return;
    }
    if (parsedItems.some((item) => !Number.isFinite(item.tradeRecordId) || item.tradeRecordId <= 0)) {
      toast.error("発送登録する商品を選択してください");
      return;
    }
    updateMutation.mutate({
      id: shipment.id,
      shippingDate,
      trackingNumber: trackingNumber.trim() || undefined,
      shippingCost: cost,
      notes: notes.trim() || undefined,
      items: parsedItems,
    });
  }

  function addItem() {
    setItems((prev) => [...prev, { invoiceNo: "", tradeRecordId: "", quantity: "" }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const updateItem = useCallback((index: number, field: keyof ShipmentItemForm, value: string) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }, []);

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
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck size={18} className="text-orange-600" />
            発送記録を編集
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
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

          {/* インボイス明細 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">
                インボイス明細 <span className="text-destructive">*</span>
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={addItem}
              >
                <Plus size={12} />
                追加
              </Button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
                <span>インボイスNo.</span>
                <span>今回発送台数</span>
                <span className="w-7"></span>
              </div>
              {items.map((item, index) => {
                const parsedNo = parseInt(item.invoiceNo, 10);
                const validNo = !Number.isNaN(parsedNo) && parsedNo > 0;
                return (
                  <div key={index} className="space-y-1.5">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                      <Input
                        type="number"
                        placeholder="例: 414"
                        value={item.invoiceNo}
                        onChange={(event) => {
                          updateItem(index, "invoiceNo", event.target.value);
                          updateItem(index, "tradeRecordId", "");
                        }}
                        className="h-8 text-sm"
                        min="1"
                      />
                      <Input
                        type="number"
                        placeholder="例: 1"
                        value={item.quantity}
                        onChange={(event) => updateItem(index, "quantity", event.target.value)}
                        className="h-8 text-sm"
                        min="1"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => removeItem(index)}
                        disabled={items.length === 1}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    {validNo ? (
                      <div className="pl-1">
                        <InvoiceSummaryBadge invoiceNo={parsedNo} />
                      </div>
                    ) : null}
                    {validNo ? (
                      <InvoiceItemSelect
                        invoiceNo={parsedNo}
                        value={item.tradeRecordId}
                        onChange={(value) => updateItem(index, "tradeRecordId", value)}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
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
