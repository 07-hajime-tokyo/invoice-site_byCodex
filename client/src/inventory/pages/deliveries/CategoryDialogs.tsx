import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

/** カテゴリ管理ダイアログ + カテゴリ削除確認（Deliveries.tsx から逐語抽出） */
export function CategoryDialogs({
  showCategoryDialog,
  setShowCategoryDialog,
  newCategoryName,
  setNewCategoryName,
  handleAddCategory,
  addCategoryMutation,
  categoryOptions,
  categoryDeleteTarget,
  setCategoryDeleteTarget,
  handleDeleteCategory,
  deleteCategoryMutation,
}: {
  showCategoryDialog: boolean;
  setShowCategoryDialog: (open: boolean) => void;
  newCategoryName: string;
  setNewCategoryName: (v: string) => void;
  handleAddCategory: () => void;
  addCategoryMutation: { isPending: boolean };
  categoryOptions: string[];
  categoryDeleteTarget: string | null;
  setCategoryDeleteTarget: (v: string | null) => void;
  handleDeleteCategory: () => void;
  deleteCategoryMutation: { isPending: boolean };
}) {
  return (
    <>
      <Dialog open={showCategoryDialog} onOpenChange={setShowCategoryDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-primary" />
              カテゴリ管理
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAddCategory();
                }}
                placeholder="カテゴリ名"
              />
              <Button
                onClick={handleAddCategory}
                disabled={addCategoryMutation.isPending || !newCategoryName.trim()}
              >
                {addCategoryMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
            <div className="rounded-md border max-h-72 overflow-y-auto">
              {categoryOptions.length === 0 ? (
                <p className="px-3 py-6 text-sm text-muted-foreground text-center">カテゴリがありません</p>
              ) : (
                categoryOptions.map((cat) => (
                  <div key={cat} className="flex items-center justify-between gap-3 px-3 py-2 border-b last:border-0">
                    <span className="text-sm font-medium truncate">{cat}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      onClick={() => setCategoryDeleteTarget(cat)}
                      disabled={deleteCategoryMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCategoryDialog(false)}>閉じる</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!categoryDeleteTarget} onOpenChange={(open) => { if (!open) setCategoryDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>カテゴリを削除しますか？</AlertDialogTitle>
            <AlertDialogDescription>
              「{categoryDeleteTarget}」を在庫・入庫予定から外して未分類にします。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCategoryMutation.isPending}>キャンセル</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCategory}
              disabled={deleteCategoryMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteCategoryMutation.isPending ? "削除中..." : "削除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
