import { useState, useMemo, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Package, Send } from "lucide-react";
import type { FedexShipmentView, HistoryItem } from "./types";
import { type ShipmentSheetName, SHIPMENT_SHEET_NAMES, detectShipmentSheetName } from "./shipmentSheets";

/** FedEx発送登録ダイアログ */
export function FedexShipmentDialog({
  open,
  onClose,
  groupKey,
  groupItems,
  onSubmit,
  isPending,
  existingShipments,
}: {
  open: boolean;
  onClose: () => void;
  groupKey: string;
  groupItems: HistoryItem[];
  onSubmit: (data: {
    sheetName: ShipmentSheetName;
    shippingDate: string;
    trackingNumber: string;
    items: Array<{ productNameJa: string; productNameEn: string; quantity: number; managementNo?: string | null }>;
  }) => void;
  isPending: boolean;
  existingShipments: FedexShipmentView[];
}) {
  const today = new Date();
  const defaultDate = `${today.getMonth() + 1}/${today.getDate()}`;
  const autoSheetName = useMemo(
    () => detectShipmentSheetName(groupKey, ...groupItems.map((item) => item.managementNo)),
    [groupKey, groupItems]
  );
  const [sheetName, setSheetName] = useState<ShipmentSheetName>(autoSheetName);
  const [shippingDate, setShippingDate] = useState(defaultDate);
  const [trackingNumber, setTrackingNumber] = useState("");
  // 商品ごとの発送数（inventoryId -> quantity）
  const [itemQuantities, setItemQuantities] = useState<Record<number, number>>(() => {
    const init: Record<number, number> = {};
    for (const item of groupItems) {
      init[item.inventoryId] = item.quantity;
    }
    return init;
  });

  // グループアイテムが変わったら発送数を初期化
  useEffect(() => {
    const init: Record<number, number> = {};
    for (const item of groupItems) {
      init[item.inventoryId] = item.quantity;
    }
    setItemQuantities(init);
    if (open) setSheetName(autoSheetName);
  }, [groupItems, open, autoSheetName]);

  function handleSubmit() {
    if (!shippingDate.trim()) {
      return;
    }
    if (!trackingNumber.trim()) {
      return;
    }
    const items = groupItems
      .filter((item) => (itemQuantities[item.inventoryId] ?? 0) > 0)
      .map((item) => ({
        productNameJa: item.title,
        productNameEn: item.title, // 英語名は日本語名と同じ（スプシ側で対応）
        quantity: itemQuantities[item.inventoryId] ?? item.quantity,
        managementNo: item.managementNo ?? null,
      }));
    if (items.length === 0) {
      return;
    }
    onSubmit({ sheetName, shippingDate: shippingDate.trim(), trackingNumber: trackingNumber.trim(), items });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isPending) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="h-5 w-5 text-blue-600" />
            FedEx発送登録 — No.{groupKey}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* 既存の発送記録 */}
          {existingShipments.length > 0 && (
            <div className="rounded-md border bg-blue-50/50 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-blue-700 mb-1.5">登録済み発送記録</p>
              {existingShipments.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">{s.shippingDate}</span>
                  <span className="font-mono text-blue-700">{s.trackingNumber}</span>
                  <span className="text-muted-foreground">{s.sheetName}</span>
                  {s.spreadsheetStatus === "success" ? (
                    <Badge className="bg-green-100 text-green-700 border-green-200 text-xs px-1 py-0">書込済</Badge>
                  ) : s.spreadsheetStatus === "error" ? (
                    <Badge variant="destructive" className="text-xs px-1 py-0">エラー</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-xs px-1 py-0">保留</Badge>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* シート選択 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">書き込み先シート</Label>
            <Select value={sheetName} onValueChange={(v) => setSheetName(v as ShipmentSheetName)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHIPMENT_SHEET_NAMES.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 発送日 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">発送日</Label>
            <Input
              value={shippingDate}
              onChange={(e) => setShippingDate(e.target.value)}
              placeholder="例: 4/8"
              className="h-9"
            />
            <p className="text-xs text-muted-foreground">スプシのヘッダー行と同じ形式（例: 4/8）</p>
          </div>

          {/* 追跡番号 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">FedEx追跡番号</Label>
            <Input
              value={trackingNumber}
              onChange={(e) => setTrackingNumber(e.target.value)}
              placeholder="例: 7489 1234 5678"
              className="h-9 font-mono"
            />
          </div>

          {/* 商品ごとの発送数 */}
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">商品ごとの発送数</Label>
            <div className="rounded-md border divide-y">
              {groupItems.map((item) => (
                <div key={item.inventoryId} className="flex items-center gap-3 px-3 py-2">
                  <span className="text-sm flex-1 truncate">{item.title}</span>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <Input
                      type="number"
                      min={0}
                      max={item.quantity}
                      value={itemQuantities[item.inventoryId] ?? item.quantity}
                      onChange={(e) => setItemQuantities((prev) => ({ ...prev, [item.inventoryId]: Number(e.target.value) }))}
                      className="h-7 w-16 text-right text-sm"
                    />
                    <span className="text-xs text-muted-foreground">/ {item.quantity}台</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="gap-2 mt-2">
          <Button variant="outline" onClick={onClose} disabled={isPending} className="flex-1">
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !shippingDate.trim() || !trackingNumber.trim()}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isPending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />登録中...</>
            ) : (
              <><Send className="h-4 w-4 mr-1.5" />スプシに登録</>  
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
