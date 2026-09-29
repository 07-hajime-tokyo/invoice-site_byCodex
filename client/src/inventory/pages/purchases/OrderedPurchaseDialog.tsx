import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PackageCheck, X, Loader2, Plus } from "lucide-react";
import { type PurchasePageModel } from "./usePurchasesPage";

export function OrderedPurchaseDialog({
  showOrderedDialog,
  setShowOrderedDialog,
  orderedInventorySearch,
  setOrderedInventorySearch,
  setOrderedForm,
  orderedForm,
  filteredInventoriesForOrder,
  handleSelectInventoryForOrder,
  operators,
  handleOperatorChange,
  selectedOperatorKey,
  isOrderedSubmitting,
  handleOrderedSubmit,
}: Pick<
  PurchasePageModel,
  | "showOrderedDialog"
  | "setShowOrderedDialog"
  | "orderedInventorySearch"
  | "setOrderedInventorySearch"
  | "setOrderedForm"
  | "orderedForm"
  | "filteredInventoriesForOrder"
  | "handleSelectInventoryForOrder"
  | "operators"
  | "handleOperatorChange"
  | "selectedOperatorKey"
  | "isOrderedSubmitting"
  | "handleOrderedSubmit"
>) {
  return (
    <>
      <Dialog
        open={showOrderedDialog}
        onOpenChange={open => {
          if (!open) setShowOrderedDialog(false);
        }}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-5 w-5 text-amber-600" />
              発注済み登録
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>
                商品を選択 <span className="text-destructive">*</span>
              </Label>
              <Input
                placeholder="商品名で検索..."
                value={orderedInventorySearch}
                onChange={e => {
                  setOrderedInventorySearch(e.target.value);
                  if (!e.target.value)
                    setOrderedForm(f => ({ ...f, inventoryId: "", title: "" }));
                }}
              />
              {orderedInventorySearch &&
                !orderedForm.inventoryId &&
                filteredInventoriesForOrder.length > 0 && (
                  <div className="border rounded-md max-h-40 overflow-y-auto bg-popover shadow-md">
                    {filteredInventoriesForOrder.map(inv => (
                      <button
                        key={inv.id}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 border-b last:border-0"
                        onClick={() =>
                          handleSelectInventoryForOrder(
                            inv as {
                              id: number;
                              title: string;
                              unit: string;
                              purchase_unit_price?: number;
                              unit_price?: number;
                              etc?: string;
                              supplierName?: string | null;
                              supplierUrl?: string | null;
                            }
                          )
                        }
                      >
                        <span className="font-medium">
                          {(inv as { title: string }).title}
                        </span>
                        {(inv as { etc?: string }).etc && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            {(inv as { etc?: string }).etc
                              ?.split(",")[0]
                              ?.trim()}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              {orderedForm.inventoryId && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-md">
                  <PackageCheck className="h-4 w-4 text-amber-600 flex-shrink-0" />
                  <span className="text-sm font-medium text-amber-800">
                    {orderedForm.title}
                  </span>
                  <button
                    type="button"
                    className="ml-auto text-amber-600 hover:text-amber-800"
                    onClick={() => {
                      setOrderedForm(f => ({
                        ...f,
                        inventoryId: "",
                        title: "",
                      }));
                      setOrderedInventorySearch("");
                    }}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ordered-qty">
                  発注数量 <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="ordered-qty"
                  type="number"
                  min={1}
                  value={orderedForm.quantity}
                  onChange={e =>
                    setOrderedForm(f => ({ ...f, quantity: e.target.value }))
                  }
                  placeholder="1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ordered-price">仕入単価（円）</Label>
                <Input
                  id="ordered-price"
                  type="number"
                  min={0}
                  value={orderedForm.unitPrice}
                  onChange={e =>
                    setOrderedForm(f => ({ ...f, unitPrice: e.target.value }))
                  }
                  placeholder="例: 1500"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="ordered-num">発注No</Label>
                <Input
                  id="ordered-num"
                  value={orderedForm.num}
                  onChange={e =>
                    setOrderedForm(f => ({ ...f, num: e.target.value }))
                  }
                  placeholder="例: PO-2024-001"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ordered-date">入庫予定日</Label>
                <Input
                  id="ordered-date"
                  type="date"
                  value={orderedForm.estimatedPurchaseDate}
                  onChange={e =>
                    setOrderedForm(f => ({
                      ...f,
                      estimatedPurchaseDate: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ordered-supplier">仕入先</Label>
              <Input
                id="ordered-supplier"
                value={orderedForm.customerName}
                onChange={e =>
                  setOrderedForm(f => ({ ...f, customerName: e.target.value }))
                }
                placeholder="仕入先名を入力"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="ordered-memo">メモ</Label>
              <Textarea
                id="ordered-memo"
                value={orderedForm.memo}
                onChange={e =>
                  setOrderedForm(f => ({ ...f, memo: e.target.value }))
                }
                placeholder="メモを入力"
                rows={2}
              />
            </div>

            {operators && operators.length > 1 && (
              <div className="pt-2 border-t">
                <p className="text-xs text-muted-foreground mb-2">
                  操作者（作業履歴に記録されます）
                </p>
                <div className="flex flex-wrap gap-2">
                  {operators.map(op => (
                    <button
                      key={op.key}
                      type="button"
                      onClick={() => handleOperatorChange(op.key)}
                      className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                        selectedOperatorKey === op.key
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-foreground border-border hover:bg-muted/50"
                      }`}
                    >
                      {op.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowOrderedDialog(false)}
              disabled={isOrderedSubmitting}
            >
              キャンセル
            </Button>
            <Button
              onClick={handleOrderedSubmit}
              disabled={isOrderedSubmitting || !orderedForm.inventoryId}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {isOrderedSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
              ) : (
                <Plus className="h-4 w-4 mr-1.5" />
              )}
              発注済みとして登録
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
