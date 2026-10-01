import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import type { InventoryItem } from "./types";

export interface StockChangeConfirmState {
  inv: InventoryItem;
  newQty: number;
  delta: number;
}

/** 在庫数変更確認ダイアログ（Deliveries.tsx から逐語抽出） */
export function StockChangeConfirmDialog({
  stockChangeConfirm,
  setStockChangeConfirm,
  stockChangeMemo,
  setStockChangeMemo,
  isStockChanging,
  handleStockChange,
}: {
  stockChangeConfirm: StockChangeConfirmState | null;
  setStockChangeConfirm: (v: StockChangeConfirmState | null) => void;
  stockChangeMemo: string;
  setStockChangeMemo: (v: string) => void;
  isStockChanging: boolean;
  handleStockChange: () => void;
}) {
  return (
      <Dialog open={!!stockChangeConfirm} onOpenChange={(open) => { if (!open) { setStockChangeConfirm(null); setStockChangeMemo(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>在庫数を変更しますか？</DialogTitle>
          </DialogHeader>
          {stockChangeConfirm && (
            <div className="space-y-3">
              <div className="rounded-md bg-muted/30 px-3 py-2 text-sm font-medium">
                {stockChangeConfirm.inv.title}
              </div>
              <div className="flex items-center justify-center gap-4 py-2">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">現在</p>
                  <p className="text-2xl font-bold">{Math.floor(parseFloat(stockChangeConfirm.inv.quantity ?? "0"))}</p>
                  <p className="text-xs text-muted-foreground">{stockChangeConfirm.inv.unit}</p>
                </div>
                <div className="text-muted-foreground">
                  {stockChangeConfirm.delta > 0 ? (
                    <span className="text-green-600 font-bold text-lg">+{stockChangeConfirm.delta} →</span>
                  ) : (
                    <span className="text-red-500 font-bold text-lg">{stockChangeConfirm.delta} →</span>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground mb-1">変更後</p>
                  <p className={`text-2xl font-bold ${stockChangeConfirm.newQty === 0 ? "text-muted-foreground" : ""}`}>{stockChangeConfirm.newQty}</p>
                  <p className="text-xs text-muted-foreground">{stockChangeConfirm.inv.unit}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground text-center">サイト内DBの在庫数が更新されます</p>
              {/* メモ入力欄 */}
              <div className="space-y-1">
                <Label htmlFor="stock-change-memo" className="text-sm">メモ（任意）</Label>
                <Textarea
                  id="stock-change-memo"
                  placeholder="変更理由や備考を入力..."
                  value={stockChangeMemo}
                  onChange={(e) => setStockChangeMemo(e.target.value)}
                  rows={2}
                  className="text-sm resize-none"
                />
              </div>
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setStockChangeConfirm(null); setStockChangeMemo(""); }} disabled={isStockChanging}>
              キャンセル
            </Button>
            <Button
              onClick={handleStockChange}
              disabled={isStockChanging}
              className={stockChangeConfirm?.delta && stockChangeConfirm.delta > 0 ? "bg-green-600 hover:bg-green-700 text-white" : "bg-red-500 hover:bg-red-600 text-white"}
            >
              {isStockChanging ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              変更する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
