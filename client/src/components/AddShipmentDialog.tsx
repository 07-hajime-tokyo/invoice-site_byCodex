/**
 * AddShipmentDialog — 発送記録登録ダイアログ
 * 発送日・FedEx追跡番号・実際の送料を入力し、
 * 複数のインボイス番号と発送台数を紐付けて登録する。
 * インボイスNoを入力すると発注数合計・発送済み・残数をリアルタイム表示。
 */
import { useEffect, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Truck, Plus, Trash2, Loader2, Package } from "lucide-react";
import { toast } from "sonner";

interface ShipmentItem {
  invoiceNo: string;
  tradeRecordId: string;
  quantity: string;
}

interface AddShipmentDialogProps {
  onSuccess?: () => void;
}

/** 単一インボイスの発注数サマリーを表示するサブコンポーネント */
function InvoiceSummaryBadge({ invoiceNo }: { invoiceNo: number }) {
  const { data, isLoading } = trpc.shipment.invoiceSummary.useQuery(
    { invoiceNo },
    { enabled: invoiceNo > 0 }
  );

  if (isLoading) return <span className="text-xs text-muted-foreground">読み込み中...</span>;
  if (!data || data.orderedQty === 0) return <span className="text-xs text-muted-foreground">（発注データなし）</span>;

  return (
    <span className={`inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded ${
      data.isComplete
        ? "bg-teal-50 text-teal-700 border border-teal-200"
        : "bg-amber-50 text-amber-700 border border-amber-200"
    }`}>
      <Package size={10} />
      発注{data.orderedQty}台 / 発送済{data.shippedQty}台 / 残{data.remainingQty}台
      {data.isComplete && " ✓完了"}
    </span>
  );
}

function InvoiceItemSelect({
  invoiceNo,
  value,
  onChange,
}: {
  invoiceNo: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const { data, isLoading } = trpc.shipment.invoiceSummary.useQuery(
    { invoiceNo },
    { enabled: invoiceNo > 0 }
  );
  const lines = data?.items ?? [];

  useEffect(() => {
    if (!value && lines.length === 1) {
      onChange(String(lines[0].tradeRecordId));
    }
  }, [lines, onChange, value]);

  if (isLoading || lines.length === 0) return null;

  const selected = lines.find((line) => String(line.tradeRecordId) === value);

  return (
    <div className="pl-1 space-y-1">
      {lines.length > 1 ? (
        <Select value={value || "__unassigned__"} onValueChange={(v) => onChange(v === "__unassigned__" ? "" : v)}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="商品を選択" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__unassigned__">No単位で登録</SelectItem>
            {lines.map((line) => (
              <SelectItem key={line.tradeRecordId} value={String(line.tradeRecordId)}>
                {line.productName || `商品行 ${line.tradeRecordId}`} / 残{line.remainingQty}台
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <p className="text-xs text-muted-foreground">
          商品: {lines[0].productName || `商品行 ${lines[0].tradeRecordId}`} / 残{lines[0].remainingQty}台
        </p>
      )}
      {selected && (
        <p className="text-[11px] text-muted-foreground">
          選択中: {selected.productName || `商品行 ${selected.tradeRecordId}`}（発送済み{selected.shippedQty}/{selected.orderedQty}台）
        </p>
      )}
      {data?.unassignedShippedQty ? (
        <p className="text-[11px] text-amber-700">
          旧形式のNo単位発送: {data.unassignedShippedQty}台
        </p>
      ) : null}
    </div>
  );
}

export function AddShipmentDialog({ onSuccess }: AddShipmentDialogProps) {
  const [open, setOpen] = useState(false);
  const [shippingDate, setShippingDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [trackingNumber, setTrackingNumber] = useState("");
  const [shippingCost, setShippingCost] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState<ShipmentItem[]>([{ invoiceNo: "", tradeRecordId: "", quantity: "" }]);

  const createMutation = trpc.shipment.create.useMutation({
    onSuccess: () => {
      toast.success("発送記録を登録しました");
      setOpen(false);
      resetForm();
      onSuccess?.();
    },
    onError: (err) => {
      toast.error(`登録に失敗しました: ${err.message}`);
    },
  });

  function resetForm() {
    const d = new Date();
    setShippingDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setTrackingNumber("");
    setShippingCost("");
    setNotes("");
    setItems([{ invoiceNo: "", tradeRecordId: "", quantity: "" }]);
  }

  function addItem() {
    setItems((prev) => [...prev, { invoiceNo: "", tradeRecordId: "", quantity: "" }]);
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  const updateItem = useCallback((index: number, field: keyof ShipmentItem, value: string) => {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item))
    );
  }, []);

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
        tradeRecordId: item.tradeRecordId ? parseInt(item.tradeRecordId, 10) : undefined,
        quantity: parseInt(item.quantity, 10),
      }));
    if (parsedItems.length === 0) {
      toast.error("インボイス番号と発送台数を1件以上入力してください");
      return;
    }
    if (parsedItems.some((i) => isNaN(i.invoiceNo) || isNaN(i.quantity) || i.quantity <= 0)) {
      toast.error("インボイス番号と発送台数は正の整数で入力してください");
      return;
    }
    createMutation.mutate({
      shippingDate,
      trackingNumber: trackingNumber.trim() || undefined,
      shippingCost: cost,
      notes: notes.trim() || undefined,
      items: parsedItems,
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2.5 text-xs gap-1 text-orange-600 border-orange-300 hover:bg-orange-50 flex-shrink-0"
        >
          <Truck size={12} />
          <span className="hidden sm:inline">発送登録</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Truck size={18} className="text-orange-600" />
            発送記録を登録
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 発送日 */}
          <div className="space-y-1.5">
            <Label htmlFor="shippingDate" className="text-sm font-medium">
              発送日 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="shippingDate"
              type="date"
              value={shippingDate}
              onChange={(e) => setShippingDate(e.target.value)}
              className="h-9"
            />
          </div>

          {/* FedEx追跡番号 */}
          <div className="space-y-1.5">
            <Label htmlFor="trackingNumber" className="text-sm font-medium">
              FedEx追跡番号
            </Label>
            <Input
              id="trackingNumber"
              type="text"
              placeholder="例: 7489 2345 6789"
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              className="h-9"
            />
          </div>

          {/* 実際の送料 */}
          <div className="space-y-1.5">
            <Label htmlFor="shippingCost" className="text-sm font-medium">
              実際の送料（円） <span className="text-destructive">*</span>
            </Label>
            <Input
              id="shippingCost"
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
                const validNo = !isNaN(parsedNo) && parsedNo > 0;
                return (
                  <div key={index} className="space-y-1.5">
                    <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                      <Input
                        type="number"
                        placeholder="例: 371"
                        value={item.invoiceNo}
                        onChange={(e) => {
                          updateItem(index, "invoiceNo", e.target.value);
                          updateItem(index, "tradeRecordId", "");
                        }}
                        className="h-8 text-sm"
                        min="1"
                      />
                      <Input
                        type="number"
                        placeholder="例: 5"
                        value={item.quantity}
                        onChange={(e) => updateItem(index, "quantity", e.target.value)}
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
                    {/* インボイスNoを入力したら発注数・残数を表示 */}
                    {validNo && (
                      <div className="pl-1">
                        <InvoiceSummaryBadge invoiceNo={parsedNo} />
                      </div>
                    )}
                    {validNo && (
                      <InvoiceItemSelect
                        invoiceNo={parsedNo}
                        value={item.tradeRecordId}
                        onChange={(value) => updateItem(index, "tradeRecordId", value)}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            {/* 送料按分プレビュー */}
            {items.filter((i) => i.invoiceNo && i.quantity).length > 0 && shippingCost && (
              <div className="bg-orange-50 border border-orange-200 rounded-md p-3 text-xs space-y-1">
                <p className="font-medium text-orange-800">送料按分プレビュー（この便の台数で按分）</p>
                {(() => {
                  const cost = parseFloat(shippingCost) || 0;
                  const validItems = items.filter((i) => i.invoiceNo && i.quantity && parseInt(i.quantity) > 0);
                  const totalQty = validItems.reduce((s, i) => s + parseInt(i.quantity), 0);
                  return validItems.map((item, i) => {
                    const qty = parseInt(item.quantity);
                    const allocated = totalQty > 0 ? Math.round((cost / totalQty) * qty) : 0;
                    return (
                      <p key={i} className="text-orange-700">
                        No.{item.invoiceNo}: {qty}台 → ¥{allocated.toLocaleString()}
                      </p>
                    );
                  });
                })()}
                <p className="text-orange-600 text-[11px] mt-1">
                  ※ 発注数分の発送が完了した時点で実送料に更新されます
                </p>
              </div>
            )}
          </div>

          {/* メモ */}
          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-sm font-medium">
              メモ（任意）
            </Label>
            <Input
              id="notes"
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
            disabled={createMutation.isPending}
          >
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            {createMutation.isPending ? (
              <>
                <Loader2 size={14} className="animate-spin mr-1" />
                登録中...
              </>
            ) : (
              "登録する"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
