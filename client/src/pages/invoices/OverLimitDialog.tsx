import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { AlertCircle, Save, Sparkles } from "lucide-react";
export function OverLimitDialog({
  open,
  onOpenChange,
  overLimitJpy,
  onSave,
  onSplit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  overLimitJpy: number;
  onSave: () => void;
  onSplit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle size={18} className="text-orange-500" />
            金額が100万円を超えています
          </DialogTitle>
          <DialogDescription>
            このインボイスの円換算合計は「¥{overLimitJpy.toLocaleString()}
            」で、100万円を超えています。分割しますか？
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onSave}>
            <Save size={12} className="mr-1" />
            そのまま保存
          </Button>
          <Button
            size="sm"
            onClick={onSplit}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            <Sparkles size={12} className="mr-1" />
            分割する
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
