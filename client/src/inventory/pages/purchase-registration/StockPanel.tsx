import { Fragment, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Boxes, ChevronDown, PackageCheck, Pencil, Tag } from "lucide-react";
import { normalizeExternalUrl } from "@/inventory/lib/supplier";
import { formatCurrency, formatDate } from "./format";
import { EmptyState } from "./EmptyState";
import { buildStockItemViewsFromInventories, buildStockItemGroups, stockItemStatusBadgeClass } from "./stockViews";
import { buildStockSearchText } from "./search";
import type { InventoryItem, PurchaseRow } from "./dataTypes";
import type { AllocationGroup, PurchaseRegistrationInvoice } from "./viewTypes";
import type { StockViewMode } from "./formTypes";
import { buildZeroStockPurchaseItemViewsFromRows, buildStockProposalGroups } from "./registrationStockBuilders";
import { invoiceDisplayLabel } from "./shippingRules";
import { BoxItemInvoiceField } from "./OutboundBoxes";
import { StockProposalPanel } from "./StockProposalPanel";

export function StockPanel({
  inventories,
  purchaseRows,
  unfinishedInvoices,
  invoiceOptions,
  searchText,
  viewMode,
  categoryOptions,
  onOpenCategoryDialog,
  onOpenEdit,
}: {
  inventories: InventoryItem[];
  purchaseRows: PurchaseRow[];
  unfinishedInvoices?: PurchaseRegistrationInvoice[];
  invoiceOptions: AllocationGroup[];
  searchText: string;
  viewMode: StockViewMode;
  categoryOptions: string[];
  onOpenCategoryDialog: () => void;
  onOpenEdit: (inventoryId: number) => void;
}) {
  const allStockItems = buildStockItemViewsFromInventories(inventories);
  const zeroStockPurchaseItems = buildZeroStockPurchaseItemViewsFromRows(purchaseRows, inventories);
  const zeroStockPurchaseQuantityTotal = zeroStockPurchaseItems.reduce((total, item) => total + item.quantity, 0);
  const [showZeroStockPurchaseItems, setShowZeroStockPurchaseItems] = useState(false);
  const displayStockItems = showZeroStockPurchaseItems
    ? [...allStockItems, ...zeroStockPurchaseItems]
    : allStockItems;
  const stockItems = searchText
    ? displayStockItems.filter((item) => buildStockSearchText(item).includes(searchText))
    : displayStockItems;
  const stockGroups = buildStockItemGroups(stockItems);
  const proposalGroups = buildStockProposalGroups(allStockItems, purchaseRows, searchText, unfinishedInvoices);
  const stockQuantityTotal = stockItems.reduce((total, item) => total + item.quantity, 0);
  const [openStockGroupNames, setOpenStockGroupNames] = useState<Set<string>>(() => new Set());

  const toggleStockGroup = (groupName: string) => {
    setOpenStockGroupNames((current) => {
      const next = new Set(current);
      if (next.has(groupName)) {
        next.delete(groupName);
      } else {
        next.add(groupName);
      }
      return next;
    });
  };

  if (viewMode === "proposal") {
    return <StockProposalPanel groups={proposalGroups} />;
  }

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">在庫一覧</h2>
          <Badge variant="outline">{stockItems.length.toLocaleString()}件</Badge>
          <Badge variant="secondary">{stockQuantityTotal.toLocaleString()}点</Badge>
          {zeroStockPurchaseItems.length > 0 ? (
            <Button
              type="button"
              variant={showZeroStockPurchaseItems ? "secondary" : "outline"}
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => setShowZeroStockPurchaseItems((current) => !current)}
            >
              <PackageCheck className="h-3.5 w-3.5" />
              {showZeroStockPurchaseItems ? "0在庫を隠す" : "0在庫を表示"}
              <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                {zeroStockPurchaseQuantityTotal.toLocaleString()}
              </Badge>
            </Button>
          ) : null}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={onOpenCategoryDialog}
          >
            <Tag className="h-3.5 w-3.5" />
            カテゴリ管理
            <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
              {categoryOptions.length.toLocaleString()}
            </Badge>
          </Button>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          商品IDが未発行の在庫も含めて、カテゴリごとに表示します。通常は在庫数が1以上の商品だけを表示します。
          0在庫を表示すると、出庫済み・入庫待ち・動作確認待ちの在庫数0商品だけを確認できます。
        </p>
      </section>
      {stockItems.length === 0 ? (
        <EmptyState icon={Boxes} title="在庫がありません" />
      ) : (
        <div className="overflow-hidden rounded-md border bg-background">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">ID</th>
                  <th className="px-4 py-3 text-left font-medium">商品</th>
                  <th className="px-4 py-3 text-left font-medium">引当先</th>
                  <th className="px-4 py-3 text-left font-medium">仕入先</th>
                  <th className="px-4 py-3 text-left font-medium">仕入単価</th>
                  <th className="px-4 py-3 text-left font-medium">状態</th>
                  <th className="px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {stockGroups.map((group) => (
                  <Fragment key={group.name}>
                    <tr key={`${group.name}-header`} className="border-b bg-slate-50">
                      <td colSpan={7} className="p-0">
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-slate-100"
                          onClick={() => toggleStockGroup(group.name)}
                        >
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 shrink-0 transition-transform",
                              !openStockGroupNames.has(group.name) && "-rotate-90",
                            )}
                          />
                          <span>棚 {group.name}</span>
                          <Badge variant="secondary" className="text-[11px]">
                            {group.quantity.toLocaleString()}点
                          </Badge>
                        </button>
                      </td>
                    </tr>
                    {openStockGroupNames.has(group.name) ? group.items.map((item) => (
                      <tr key={item.key} className="border-b last:border-0">
                        <td className="px-4 py-3">
                          {item.labelId ? (
                            <span className="font-mono text-base font-semibold text-emerald-800">{item.labelId}</span>
                          ) : item.inboundWaiting ? (
                            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">入庫待ち</Badge>
                          ) : item.zeroStockPurchase ? (
                            <Badge variant="outline">{item.status}</Badge>
                          ) : (
                            <Badge variant="outline">未発行</Badge>
                          )}
                          {item.quantity > 1 ? (
                            <div className="mt-1 text-xs text-muted-foreground">{item.quantity.toLocaleString()}点</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{item.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">旧管理番号: {item.legacyManagementNo}</div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1">
                            <Badge variant={item.assignedInvoiceNo ? "default" : "secondary"} className="w-fit font-mono">
                              {item.assignedInvoiceNo
                                ? `充当先 ${invoiceDisplayLabel(invoiceOptions, item.assignedInvoiceNo)}`
                                : item.allocationLabel}
                            </Badge>
                            {item.labelId ? (
                              <BoxItemInvoiceField
                                labelId={item.labelId}
                                assignedInvoiceNo={item.assignedInvoiceNo ?? null}
                                legacyManagementNo={item.legacyManagementNo}
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">商品ID発行後に指定できます</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {item.supplier.url ? (
                            <a
                              href={normalizeExternalUrl(item.supplier.url)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-emerald-700 hover:underline"
                            >
                              {item.supplier.name}
                            </a>
                          ) : (
                            item.supplier.name
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div>{formatCurrency(item.unitPrice)}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{formatDate(item.purchaseDate)}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={stockItemStatusBadgeClass(item)}>
                            {item.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
                            onClick={() => onOpenEdit(item.inventoryId)}
                          >
                            <Pencil className="h-4 w-4" />
                            編集
                          </Button>
                        </td>
                      </tr>
                    )) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
