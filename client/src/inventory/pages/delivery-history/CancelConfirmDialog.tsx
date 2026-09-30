import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertTriangle, Loader2, Undo2 } from "lucide-react";

/** 出庫取り消し確認ダイアログ */
export function CancelConfirmDialog({
  open,
  onClose,
  onConfirm,
  items,
  isPending,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  items: Array<{ title: string; quantity: number }>;
  isPending: boolean;
}) {
  const totalQty = items.reduce((sum, i) => sum + i.quantity, 0);
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !isPending) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            出庫取り消しの確認
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            以下の出庫を取り消します。サイト内DBの在庫数が戻ります。
          </p>
          <div className="rounded-md border bg-muted/30 p-3 space-y-1.5">
            {items.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between text-sm">
                <span className="font-medium truncate mr-2">{item.title}</span>
                <span className="text-muted-foreground flex-shrink-0">+{item.quantity}個 戻る</span>
              </div>
            ))}
          </div>
          <p className="text-sm font-semibold text-center">
            合計 {totalQty} 個の在庫が戻ります
          </p>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={isPending} className="flex-1">
            キャンセル
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
            className="flex-1"
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                取り消し中...
              </>
            ) : (
              <>
                <Undo2 className="h-4 w-4 mr-1.5" />
                取り消す
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
