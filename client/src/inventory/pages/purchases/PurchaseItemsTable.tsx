import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EbayListingUrlEditor } from "@/inventory/components/EbayListingUrlEditor";
import { type Purchase } from "./types";
import { parseEtc, formatUnitPrice, statusLabel } from "./format";
import { ItemLabelsBlock } from "./ItemLabelsBlock";
import { type PurchasePageModel } from "./usePurchasesPage";

export function PurchaseItemsTable({
  purchase,
  deletingIds,
  editingId,
  editState,
  setEditState,
  categoryOptions,
  handleDeletePurchaseAndInventory,
}: Pick<
  PurchasePageModel,
  | "deletingIds"
  | "editingId"
  | "editState"
  | "setEditState"
  | "categoryOptions"
  | "handleDeletePurchaseAndInventory"
> & { purchase: Purchase }) {
  return (
    <table className="w-full text-sm mobile-card-table">
      <thead>
        <tr className="border-b bg-muted/20">
          <th className="text-left px-4 py-2 font-medium text-muted-foreground">
            商品名
          </th>
          <th className="text-left px-4 py-2 font-medium text-muted-foreground">
            カテゴリ
          </th>
          <th className="text-right px-4 py-2 font-medium text-muted-foreground">
            仕入単価
          </th>
          <th className="text-right px-4 py-2 font-medium text-muted-foreground">
            発注数量
          </th>
          <th className="text-left px-4 py-2 font-medium text-muted-foreground">
            入庫予定日
          </th>
          <th className="text-left px-4 py-2 font-medium text-muted-foreground">
            ステータス
          </th>
          <th className="text-center px-4 py-2 font-medium text-muted-foreground">
            操作
          </th>
        </tr>
      </thead>
      <tbody>
        {purchase.purchase_items.map((item, idx) => {
          const isEditing = editingId === purchase.id;
          const itemEdit = editState.itemEdits[item.inventory_id];
          return (
            <tr key={idx} className="border-b last:border-0 hover:bg-muted/10">
              <td data-label="商品名" className="px-4 py-2">
                {isEditing && itemEdit && (
                  <div className="space-y-1.5">
                    <div>
                      <label className="text-xs text-muted-foreground">
                        商品名
                      </label>
                      <Input
                        type="text"
                        value={itemEdit.title}
                        onChange={e =>
                          setEditState(s => ({
                            ...s,
                            itemEdits: {
                              ...s.itemEdits,
                              [item.inventory_id]: {
                                ...itemEdit,
                                title: e.target.value,
                              },
                            },
                          }))
                        }
                        className="h-7 text-xs mt-0.5 min-w-[220px]"
                        placeholder="商品名"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">
                        管理番号
                      </label>
                      <Input
                        type="text"
                        value={itemEdit.managementNo}
                        onChange={e =>
                          setEditState(s => ({
                            ...s,
                            itemEdits: {
                              ...s.itemEdits,
                              [item.inventory_id]: {
                                ...itemEdit,
                                managementNo: e.target.value,
                              },
                            },
                          }))
                        }
                        className="h-7 text-xs mt-0.5 min-w-[220px]"
                        placeholder="管理番号"
                      />
                    </div>
                  </div>
                )}
                {!isEditing && (
                  <div>
                    <div>{item.title}</div>
                    <ItemLabelsBlock item={item} />
                  </div>
                )}
                <EbayListingUrlEditor
                  inventoryId={item.inventory_id}
                  managementNo={parseEtc(item.etc).managementNo}
                  value={item.ebayListingUrl}
                  compact
                  className="mt-1"
                />
              </td>
              <td data-label="カテゴリ" className="px-4 py-2">
                {isEditing && itemEdit ? (
                  <Select
                    value={itemEdit.category || "__none__"}
                    onValueChange={v =>
                      setEditState(s => ({
                        ...s,
                        itemEdits: {
                          ...s.itemEdits,
                          [item.inventory_id]: {
                            ...itemEdit,
                            category: v === "__none__" ? "" : v,
                          },
                        },
                      }))
                    }
                  >
                    <SelectTrigger className="h-7 min-w-[140px] text-xs">
                      <SelectValue placeholder="カテゴリ" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">未分類</SelectItem>
                      {categoryOptions.map(cat => (
                        <SelectItem key={cat} value={cat}>
                          {cat}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Badge variant="outline" className="text-xs">
                    {item.category || "未分類"}
                  </Badge>
                )}
              </td>
              <td data-label="仕入単価" className="px-4 py-2 text-right">
                {isEditing && itemEdit ? (
                  <Input
                    type="number"
                    value={itemEdit.unitPrice}
                    onChange={e =>
                      setEditState(s => ({
                        ...s,
                        itemEdits: {
                          ...s.itemEdits,
                          [item.inventory_id]: {
                            ...itemEdit,
                            unitPrice: e.target.value,
                          },
                        },
                      }))
                    }
                    className="h-7 text-xs text-right w-24 ml-auto"
                    placeholder="単価"
                  />
                ) : (
                  formatUnitPrice(item.unit_price)
                )}
              </td>
              <td data-label="発注数量" className="px-4 py-2 text-right">
                {isEditing && itemEdit ? (
                  <div className="flex items-center justify-end gap-1">
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={itemEdit.quantity}
                      onChange={e =>
                        setEditState(s => ({
                          ...s,
                          itemEdits: {
                            ...s.itemEdits,
                            [item.inventory_id]: {
                              ...itemEdit,
                              quantity: e.target.value,
                            },
                          },
                        }))
                      }
                      className="h-7 w-20 text-right text-xs"
                      placeholder="数量"
                    />
                    <span className="text-xs text-muted-foreground">
                      {item.unit}
                    </span>
                  </div>
                ) : (
                  <>
                    {item.quantity} {item.unit}
                  </>
                )}
              </td>
              <td data-label="入庫予定日" className="px-4 py-2">
                {isEditing && itemEdit ? (
                  <Input
                    type="date"
                    value={itemEdit.estimatedDate}
                    onChange={e =>
                      setEditState(s => ({
                        ...s,
                        itemEdits: {
                          ...s.itemEdits,
                          [item.inventory_id]: {
                            ...itemEdit,
                            estimatedDate: e.target.value,
                          },
                        },
                      }))
                    }
                    className="h-7 text-xs"
                  />
                ) : (
                  (item.estimated_purchase_date ?? "-")
                )}
              </td>
              <td data-label="ステータス" className="px-4 py-2">
                <Badge
                  variant={
                    item.status === "purchased" ? "default" : "secondary"
                  }
                  className="text-xs"
                >
                  {statusLabel[item.status] ?? item.status}
                </Badge>
              </td>
              <td data-label="操作" className="px-4 py-2 text-center">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deletingIds.has(purchase.id)}
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      {deletingIds.has(purchase.id) ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>商品を削除しますか？</AlertDialogTitle>
                      <AlertDialogDescription>
                        「{item.title}
                        」の発注データと在庫データを削除し、在庫一覧からも非表示にします。この操作は元に戻せません。
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>キャンセル</AlertDialogCancel>
                      <AlertDialogAction
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        onClick={() =>
                          handleDeletePurchaseAndInventory(
                            purchase as Purchase,
                            item.title
                          )
                        }
                      >
                        削除する
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
