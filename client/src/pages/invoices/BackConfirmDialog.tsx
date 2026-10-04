import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { RefreshCw, Save } from "lucide-react";
export function BackConfirmDialog({
  open,
  onOpenChange,
  isSaving,
  onDiscard,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isSaving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>変更を保存しますか？</DialogTitle>
          <DialogDescription>
            未保存の変更があります。一覧に戻る前に保存しますか？
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={onDiscard}>
            保存せず戻る
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            {isSaving ? (
              <RefreshCw size={12} className="animate-spin mr-1" />
            ) : (
              <Save size={12} className="mr-1" />
            )}
            保存して戻る
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
