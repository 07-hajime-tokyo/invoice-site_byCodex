import type { Dispatch, SetStateAction } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Plus } from "lucide-react";
import type { InventoryFormData } from "./form";

/** 新規登録ダイアログ（Deliveries.tsx から逐語抽出） */
export function CreateInventoryDialog({
  showCreateDialog,
  setShowCreateDialog,
  createForm,
  setCreateForm,
  categoryOptions,
  isCreateSubmitting,
  handleCreateSubmit,
}: {
  showCreateDialog: boolean;
  setShowCreateDialog: (open: boolean) => void;
  createForm: InventoryFormData;
  setCreateForm: Dispatch<SetStateAction<InventoryFormData>>;
  categoryOptions: string[];
  isCreateSubmitting: boolean;
  handleCreateSubmit: () => void;
}) {
  return (
      <Dialog open={showCreateDialog} onOpenChange={(open) => { if (!open) setShowCreateDialog(false); }}><DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-green-600" />
              新規商品登録
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="create-title">商品名 <span className="text-destructive">*</span></Label>
              <Input
                id="create-title"
                value={createForm.title}
                onChange={(e) => setCreateForm(f => ({ ...f, title: e.target.value }))}
                placeholder="商品名を入力"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="create-quantity">在庫数</Label>
                <Input
                  id="create-quantity"
                  type="number"
                  min={0}
                  value={createForm.quantity}
                  onChange={(e) => setCreateForm(f => ({ ...f, quantity: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="create-unit">単位</Label>
                <Input
                  id="create-unit"
                  value={createForm.unit}
                  onChange={(e) => setCreateForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="個"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-category">カテゴリ</Label>
              <Select
                value={createForm.category || "__none__"}
                onValueChange={(v) => setCreateForm(f => ({ ...f, category: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="create-category">
                  <SelectValue placeholder="カテゴリを選択" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">未分類</SelectItem>
                  {categoryOptions.map((cat) => (
                    <SelectItem key={cat} value={cat}>{cat}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-price">仕入単価（円）</Label>
              <Input
                id="create-price"
                type="number"
                min={0}
                value={createForm.purchase_unit_price}
                onChange={(e) => setCreateForm(f => ({ ...f, purchase_unit_price: e.target.value }))}
                placeholder="例: 1500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-place">保管場所</Label>
              <Input
                id="create-place"
                value={createForm.place}
                onChange={(e) => setCreateForm(f => ({ ...f, place: e.target.value }))}
                placeholder="保管場所を入力"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-etc">備考欄</Label>
              <Textarea
                id="create-etc"
                value={createForm.etc}
                onChange={(e) => setCreateForm(f => ({ ...f, etc: e.target.value }))}
                placeholder="備考・管理番号など（例: 368-1, 2024-01-15, 株式会社ABC）"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">管理番号はカンマ区切りの先頭に記入（例: 368-1, ...）</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="create-supplier-url">仕入先URL</Label>
              <Input
                id="create-supplier-url"
                value={createForm.supplierUrl}
                onChange={(e) => setCreateForm(f => ({ ...f, supplierUrl: e.target.value }))}
                placeholder="https://..."
                type="url"
              />
              <p className="text-xs text-muted-foreground">サイト内DBに保存されます</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)} disabled={isCreateSubmitting}>
              キャンセル
            </Button>
            <Button
              onClick={handleCreateSubmit}
              disabled={isCreateSubmitting || !createForm.title.trim()}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              {isCreateSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" />
              )}
              登録する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
