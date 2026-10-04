import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, Package, Send, X } from "lucide-react";
import type { GroupedHistoryEntry, HistoryItem } from "./types";
import {
  type ShipmentSheetName,
  SHIPMENT_SHEET_NAMES,
  detectShipmentSheetName,
  detectShipmentSheetNameInText,
  sheetBadgeClass,
} from "./shipmentSheets";
import { getActiveHistoryItems } from "./display";
import { aggregateItemsByCsvProducts } from "./aggregateItems";
import { extractDeliveryGroup } from "./grouping";

// ============================================================
// FedExバッチ登録ダイアログ
// ============================================================

export function FedexBatchDialog({
  open,
  onClose,
  selectedHistoryIds,
  groupedHistories,
  csvProductsMap,
  shipmentSheetByInvoiceMap,
  inventoryManagementMap,
  initialShippingDate,
  initialTrackingNumber,
  onSubmit,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  selectedHistoryIds: number[];
  groupedHistories: GroupedHistoryEntry[];
  csvProductsMap: Map<string, Array<{ name: string; qty: number }>>;
  shipmentSheetByInvoiceMap: Map<string, ShipmentSheetName>;
  inventoryManagementMap: Map<number, string>;
  initialShippingDate?: string;
  initialTrackingNumber?: string;
  onSubmit: (shippingDate: string, shipments: Array<{ deliveryNo: string; sheetName: ShipmentSheetName; trackingNumber: string; historyId?: number; items: Array<{ productNameJa: string; productNameEn: string; quantity: number; managementNo?: string | null }> }>) => void;
  isPending: boolean;
}) {
  const today = new Date();
  const defaultDate = `${today.getMonth() + 1}/${today.getDate()}`;
  const [shippingDate, setShippingDate] = useState(initialShippingDate ?? defaultDate);
  const [trackingNumber, setTrackingNumber] = useState(initialTrackingNumber ?? "");

  // グループごとの編集可能な商品リスト
  type EditableItem = { productNameJa: string; productNameEn: string; quantity: number; managementNo?: string | null };
  type GroupItems = { rowKey: string; deliveryNo: string; sheetLabel: ShipmentSheetName; historyId?: number; createdAt?: string | Date; items: EditableItem[] };
  const [editableGroups, setEditableGroups] = useState<GroupItems[]>([]);

  // ダイアログが開くたびに初期値をセット
  useEffect(() => {
    if (!open) return;
    if (initialShippingDate !== undefined) setShippingDate(initialShippingDate);
    if (initialTrackingNumber !== undefined) setTrackingNumber(initialTrackingNumber);
    // 選択された出庫履歴ごとに商品集計を初期化
    const groups: GroupItems[] = [];
    const selectedIdSet = new Set(selectedHistoryIds);
    for (const [key, histories] of groupedHistories) {
      const csvProducts = csvProductsMap.get(key) ?? [];
      const groupDeliverySheetLabel = histories
        .map((history) => detectShipmentSheetNameInText(history.deliveryNo))
        .find((sheetName): sheetName is ShipmentSheetName => sheetName != null);
      for (const h of histories) {
        if (!selectedIdSet.has(h.id)) continue;
        const allItems: HistoryItem[] = getActiveHistoryItems(h).map((item) => ({
          ...item,
          managementNo: item.managementNo || inventoryManagementMap.get(item.inventoryId) || "",
        }));
        const aggregated = aggregateItemsByCsvProducts(csvProducts, allItems);
        const items: EditableItem[] = aggregated
          .filter((a) => a.deliveredQty > 0)
          .map((a) => ({ productNameJa: a.csvName, productNameEn: a.csvName, quantity: a.deliveredQty }));
        const invoiceKey = extractDeliveryGroup(h.deliveryNo);
        const explicitSheetLabel = detectShipmentSheetNameInText(h.deliveryNo);
        const sheetLabel = explicitSheetLabel ?? groupDeliverySheetLabel ?? shipmentSheetByInvoiceMap.get(invoiceKey) ?? detectShipmentSheetName(h.deliveryNo, ...allItems.map((item) => item.managementNo));
        groups.push({ rowKey: String(h.id), deliveryNo: h.deliveryNo, sheetLabel, historyId: h.id, createdAt: h.createdAt, items });
      }
    }
    setEditableGroups(groups);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selectedHistoryIds.join(","), initialShippingDate, initialTrackingNumber]);

  function updateItemQty(groupIdx: number, itemIdx: number, qty: number) {
    setEditableGroups((prev) => {
      const next = prev.map((g, gi) =>
        gi !== groupIdx ? g : {
          ...g,
          items: g.items.map((item, ii) => ii !== itemIdx ? item : { ...item, quantity: qty }),
        }
      );
      return next;
    });
  }

  function removeItem(groupIdx: number, itemIdx: number) {
    setEditableGroups((prev) =>
      prev.map((g, gi) =>
        gi !== groupIdx ? g : { ...g, items: g.items.filter((_, ii) => ii !== itemIdx) }
      )
    );
  }

  function updateGroupSheetName(groupIdx: number, sheetName: ShipmentSheetName) {
    setEditableGroups((prev) =>
      prev.map((g, gi) => (gi !== groupIdx ? g : { ...g, sheetLabel: sheetName }))
    );
  }

  function handleSubmit() {
    if (!shippingDate.trim() || !trackingNumber.trim()) return;
    const shipments = editableGroups
      .map((g) => ({
        deliveryNo: g.deliveryNo,
        sheetName: g.sheetLabel,
        trackingNumber: trackingNumber.trim(),
        historyId: g.historyId,
        items: g.items.filter((it) => it.quantity > 0),
      }))
      .filter((s) => s.items.length > 0);
    if (shipments.length === 0) return;
    onSubmit(shippingDate.trim(), shipments);
  }

  const totalItems = editableGroups.reduce((sum, g) => sum + g.items.length, 0);
  // 全体の合計個数（各商品の数量合計）
  const totalQty = editableGroups.reduce((sum, g) => sum + g.items.reduce((s, it) => s + it.quantity, 0), 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isPending) onClose(); }}>
      <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0">
        <div className="px-6 pt-5 pb-4 border-b flex-shrink-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Package className="h-5 w-5 text-blue-600" />
            FedEx発送登録 確認（{editableGroups.length}出庫No）
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-1">商品の数量を確認・編集してから登録してください</p>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* 発送日・追跡番号（編集可能） */}
          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
            <div className="space-y-1">
              <label className="text-xs font-medium text-blue-700">発送日</label>
              <Input
                value={shippingDate}
                onChange={(e) => setShippingDate(e.target.value)}
                placeholder="例: 4/9"
                className="h-8 text-sm bg-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-blue-700">FedEx追跡番号</label>
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="7489 1234 5678 9"
                className="h-8 text-sm font-mono bg-white"
              />
            </div>
          </div>

          {/* グループ別商品一覧（数量編集可能） */}
          {editableGroups.map((group, groupIdx) => {
            const groupQty = group.items.reduce((s, it) => s + it.quantity, 0);
            return (
            <div key={group.rowKey} className="rounded-lg border overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">No.{group.deliveryNo.split("_")[0]}</span>
                  {/* 出庫Noに日付が含まれる場合は日付を表示 */}
                  {(() => {
                    const m = group.deliveryNo.match(/(\d{4})(\d{2})(\d{2})$/);
                    return m ? (
                      <span className="text-xs text-muted-foreground font-mono">{parseInt(m[2])}/{parseInt(m[3])}出庫</span>
                    ) : (
                      <span className="text-xs text-muted-foreground font-mono">{group.deliveryNo}</span>
                    );
                  })()}
                  {group.createdAt && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(group.createdAt).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                  )}
                  <span className="text-xs font-bold text-foreground">{groupQty}台</span>
                </div>
                <Select
                  value={group.sheetLabel}
                  onValueChange={(value) => updateGroupSheetName(groupIdx, value as ShipmentSheetName)}
                >
                  <SelectTrigger className={`h-7 w-[138px] text-xs border ${sheetBadgeClass(group.sheetLabel)}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SHIPMENT_SHEET_NAMES.map((name) => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {group.items.length === 0 ? (
                <p className="text-xs text-muted-foreground px-3 py-3">集計できる商品がありません</p>
              ) : (
                <div className="divide-y">
                  {group.items.map((item, itemIdx) => (
                    <div key={itemIdx} className="flex items-center gap-2 px-3 py-2">
                      <span className="text-xs flex-1 truncate text-foreground">{item.productNameJa}</span>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => updateItemQty(groupIdx, itemIdx, Math.max(0, item.quantity - 1))}
                        >
                          <span className="text-base leading-none">−</span>
                        </Button>
                        <input
                          type="number"
                          min={0}
                          value={item.quantity}
                          onChange={(e) => updateItemQty(groupIdx, itemIdx, Math.max(0, parseInt(e.target.value) || 0))}
                          className="w-12 h-6 text-center text-sm border rounded bg-background text-foreground"
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                          onClick={() => updateItemQty(groupIdx, itemIdx, item.quantity + 1)}
                        >
                          <span className="text-base leading-none">＋</span>
                        </Button>
                        <span className="text-xs text-muted-foreground w-4">台</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-red-400 hover:text-red-600"
                          onClick={() => removeItem(groupIdx, itemIdx)}
                          title="この行を削除"
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            );
          })}

          {totalItems === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">登録できる商品がありません</p>
          )}
        </div>

        {/* 合計個数サマリー */}
        {totalQty > 0 && (
          <div className="px-6 py-2 border-t bg-muted/30 flex-shrink-0 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">全商品合計</span>
            <span className="text-sm font-bold text-foreground">{totalQty}台</span>
          </div>
        )}
        <div className="px-6 py-4 border-t flex-shrink-0 flex gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending} className="flex-1">
            キャンセル
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={isPending || !shippingDate.trim() || !trackingNumber.trim() || totalItems === 0}
            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isPending ? (
              <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" />登録中...</>
            ) : (
              <><Send className="h-4 w-4 mr-1.5" />{editableGroups.length}出庫Noをスプシに登録</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
