import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Clock } from "lucide-react";
import type { InventoryItem } from "./types";

/** inventoryMemo.list の表示に必要な行の形（構造互換） */
export interface MemoHistoryEntry {
  id: number;
  changeType?: string | null;
  quantityDelta?: number | null;
  quantityBefore?: number | null;
  quantityAfter?: number | null;
  memo?: string | null;
  createdAt: string | number | Date;
  operatorName?: string | null;
}

/** 在庫数変更履歴（メモ）ダイアログ（Deliveries.tsx から逐語抽出） */
export function MemoHistoryDialog({
  memoHistoryItem,
  setMemoHistoryItem,
  memoHistoryData,
}: {
  memoHistoryItem: InventoryItem | null;
  setMemoHistoryItem: (v: InventoryItem | null) => void;
  memoHistoryData: MemoHistoryEntry[] | undefined;
}) {
  return (
      <Dialog open={!!memoHistoryItem} onOpenChange={(open) => { if (!open) setMemoHistoryItem(null); }}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-muted-foreground" />
              在庫数変更履歴
            </DialogTitle>
          </DialogHeader>
          {memoHistoryItem && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/30 px-3 py-2 text-sm font-medium">
                {memoHistoryItem.title}
              </div>
              {!memoHistoryData || memoHistoryData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  変更履歴がありません
                </div>
              ) : (
                <div className="space-y-2">
                  {memoHistoryData.map((memo) => {
                    const isIncrease = memo.changeType === "increase" || (memo.quantityDelta != null && memo.quantityDelta > 0);
                    const isDecrease = memo.changeType === "decrease" || (memo.quantityDelta != null && memo.quantityDelta < 0);
                    return (
                      <div key={memo.id} className="rounded-md border bg-card px-3 py-2 text-sm space-y-1">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            {isIncrease && <span className="text-green-600 font-bold text-xs">+{memo.quantityDelta}</span>}
                            {isDecrease && <span className="text-red-500 font-bold text-xs">{memo.quantityDelta}</span>}
                            {!isIncrease && !isDecrease && <span className="text-muted-foreground text-xs">変更</span>}
                            {memo.quantityBefore != null && memo.quantityAfter != null && (
                              <span className="text-muted-foreground text-xs">{memo.quantityBefore} → {memo.quantityAfter}</span>
                            )}
                          </div>
                          <span className="text-xs text-muted-foreground">
                            {new Date(memo.createdAt).toLocaleString("ja-JP", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        {memo.memo && (
                          <p className="text-xs text-foreground bg-muted/30 rounded px-2 py-1">{memo.memo}</p>
                        )}
                        {memo.operatorName && (
                          <p className="text-xs text-muted-foreground">操作者: {memo.operatorName}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setMemoHistoryItem(null)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
