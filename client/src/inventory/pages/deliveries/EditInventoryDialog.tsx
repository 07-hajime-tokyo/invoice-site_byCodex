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
import { Loader2, Pencil } from "lucide-react";
import { getEbayStockType } from "@shared/ebayInventory";
import type { InventoryFormData } from "./form";
import type { InventoryItem } from "./types";

/** 在庫編集ダイアログ（Deliveries.tsx から逐語抽出） */
export function EditInventoryDialog({
  editingItem,
  setEditingItem,
  editForm,
  setEditForm,
  categoryOptions,
  isEditSubmitting,
  handleEditSubmit,
}: {
  editingItem: InventoryItem | null;
  setEditingItem: (v: InventoryItem | null) => void;
  editForm: InventoryFormData;
  setEditForm: Dispatch<SetStateAction<InventoryFormData>>;
  categoryOptions: string[];
  isEditSubmitting: boolean;
  handleEditSubmit: () => void;
}) {
  return (
      <Dialog open={!!editingItem} onOpenChange={(open) => { if (!open) setEditingItem(null); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-5 w-5 text-blue-600" />
              在庫情報を編集
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">商品名 <span className="text-destructive">*</span></Label>
              <Input
                id="edit-title"
                value={editForm.title}
                onChange={(e) => setEditForm(f => ({ ...f, title: e.target.value }))}
                placeholder="商品名を入力"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-quantity">在庫数</Label>
                <Input
                  id="edit-quantity"
                  type="number"
                  min={0}
                  value={editForm.quantity}
                  onChange={(e) => setEditForm(f => ({ ...f, quantity: e.target.value }))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-unit">単位</Label>
                <Input
                  id="edit-unit"
                  value={editForm.unit}
                  onChange={(e) => setEditForm(f => ({ ...f, unit: e.target.value }))}
                  placeholder="個"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-category">カテゴリ</Label>
              <Select
                value={editForm.category || "__none__"}
                onValueChange={(v) => setEditForm(f => ({ ...f, category: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger id="edit-category">
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
              <Label htmlFor="edit-price">仕入単価（円）</Label>
              <Input
                id="edit-price"
                type="number"
                min={0}
                value={editForm.purchase_unit_price}
                onChange={(e) => setEditForm(f => ({ ...f, purchase_unit_price: e.target.value }))}
                placeholder="例: 1500"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-place">保管場所</Label>
              <Input
                id="edit-place"
                value={editForm.place}
                onChange={(e) => setEditForm(f => ({ ...f, place: e.target.value }))}
                placeholder="保管場所を入力"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-etc">管理番号・備考</Label>
              <Textarea
                id="edit-etc"
                value={editForm.etc}
                onChange={(e) => setEditForm(f => ({ ...f, etc: e.target.value }))}
                placeholder="例: E0618_01_A00001, 2024-01-15, 仕入先メモ"
                rows={3}
              />
              <p className="text-xs text-muted-foreground">先頭（カンマ前）が管理番号として扱われます。</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-supplier-name">仕入先名</Label>
              <Input
                id="edit-supplier-name"
                value={editForm.supplierName}
                onChange={(e) => setEditForm(f => ({ ...f, supplierName: e.target.value }))}
                placeholder="例: 駿河屋 盛岡MOSSビル店"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-supplier-url">仕入先URL</Label>
              <Input
                id="edit-supplier-url"
                value={editForm.supplierUrl}
                onChange={(e) => setEditForm(f => ({ ...f, supplierUrl: e.target.value }))}
                placeholder="https://..."
                type="url"
              />
              {getEbayStockType(editForm.etc) === "stocked" && (
                <div className="space-y-1.5 pt-2">
                  <Label htmlFor="edit-ebay-listing-url">自社出品ページ</Label>
                  <Input
                    id="edit-ebay-listing-url"
                    value={editForm.ebayListingUrl}
                    onChange={(e) => setEditForm(f => ({ ...f, ebayListingUrl: e.target.value }))}
                    placeholder="https://www.ebay.com/itm/..."
                    type="url"
                  />
                </div>
              )}
              <p className="text-xs text-muted-foreground">サイト内DBに保存されます</p>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingItem(null)} disabled={isEditSubmitting}>
              キャンセル
            </Button>
            <Button
              onClick={handleEditSubmit}
              disabled={isEditSubmitting || !editForm.title.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {isEditSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Pencil className="h-4 w-4 mr-1.5" />
              )}
              更新する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
}
