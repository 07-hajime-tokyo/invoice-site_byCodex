import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PackagePlus, PackageCheck, Boxes } from "lucide-react";
import { itemQuantity } from "./purchaseItems";
import { purchaseRowStatusKind } from "./rowStatus";
import { formatCurrency, toNumber } from "./format";
import { getAllRowsFromGroup } from "./allocationGroups";
import { EBAY_GROUP_KEY, OTHER_INVOICE_KEY } from "./invoiceIdentity";
import { buildProductSummaries } from "./productSummaries";
import { buildForecastSummary } from "./stockForecast";
import { productDetailFilterLabel } from "./productDetailFilters";
import { StatCard } from "./StatCard";
import { ProductFulfillmentTableV2 } from "./ProductFulfillmentTable";
import type { PurchaseRow } from "./dataTypes";
import type { LabelPrintRequest, StockItemView, ProductSummary, ProductDetailFilter, AllocationGroup } from "./viewTypes";
import { PurchaseRegistrationCard } from "./PurchaseRegistrationCard";
import { StockDetailCard } from "./StockDetailCard";
import { EmptyState } from "./EmptyState";

export function OrderDashboard({
  group,
  rows,
  invoiceOptions,
  products: productsOverride,
  detailRows,
  stockDetailItems = [],
  productFilter,
  onProductFilter,
  onClearProductFilter,
  onPrintLabels,
  onOpenEdit,
  onOpenStockEdit,
  onOpenTrackingDialog,
  onOpenShippingHistory,
  onDeleteRow,
  deletingRowId,
}: {
  group: AllocationGroup | null;
  rows: PurchaseRow[];
  invoiceOptions: AllocationGroup[];
  products?: ProductSummary[];
  detailRows?: PurchaseRow[];
  stockDetailItems?: StockItemView[];
  productFilter?: ProductDetailFilter | null;
  onProductFilter?: (filter: ProductDetailFilter) => void;
  onClearProductFilter?: () => void;
  onPrintLabels: LabelPrintRequest;
  onOpenEdit: (row: PurchaseRow) => void;
  onOpenStockEdit: (inventoryId: number) => void;
  onOpenTrackingDialog: (row: PurchaseRow) => void;
  onOpenShippingHistory: (row: PurchaseRow) => void;
  onDeleteRow: (row: PurchaseRow) => void;
  deletingRowId?: number | null;
}) {
  const hideFulfillment = group?.key === EBAY_GROUP_KEY;
  const [showShippedRows, setShowShippedRows] = useState(false);
  const groupRows = getAllRowsFromGroup(group, rows);
  const displayRows = detailRows ?? groupRows;
  const shippedRows = displayRows.filter((row) => purchaseRowStatusKind(row) === "shipped");
  const visibleRows = showShippedRows
    ? displayRows
    : displayRows.filter((row) => purchaseRowStatusKind(row) !== "shipped");
  const products = productsOverride ?? group?.products ?? buildProductSummaries(groupRows);
  const required = products.reduce((total, item) => total + item.required, 0);
  const secured = products.reduce((total, item) => total + item.secured, 0);
  const purchaseTotal =
    group?.purchaseTotal ??
    displayRows.reduce(
      (total, row) =>
        total +
        row.purchase_items.reduce((rowTotal, item) => rowTotal + toNumber(item.unit_price) * itemQuantity(item), 0),
      0,
    );
  const forecast = buildForecastSummary(products, purchaseTotal);

  useEffect(() => {
    setShowShippedRows(false);
  }, [group?.key, productFilter?.productKey, productFilter?.productTitle, productFilter?.mode]);

  return (
    <div className="space-y-5">
      {!hideFulfillment ? (
        <>
      <section className="rounded-md border bg-background">
        <div className="border-b bg-muted/30 px-4 py-3 text-sm text-muted-foreground">引当先を選ぶ</div>
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <StatCard label="充足" value={`${secured.toLocaleString()} / ${required.toLocaleString()} 点`} />
          <StatCard label="仕入合計" value={formatCurrency(purchaseTotal)} />
          <StatCard label="想定売上" value={forecast.salesValue} sub={forecast.salesSub} />
          <StatCard label="想定粗利" value={forecast.grossValue} sub={forecast.grossSub} />
        </div>
      </section>

      <ProductFulfillmentTableV2
        products={products}
        selectedFilter={productFilter}
        onProductFilter={onProductFilter}
        stockOnly={group?.key === OTHER_INVOICE_KEY}
      />
        </>
      ) : null}

      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <PackagePlus className="h-4 w-4 text-emerald-700" />
          仕入れ登録
          <Badge variant="outline">{visibleRows.length}件</Badge>
          {stockDetailItems.length > 0 ? (
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">
              現在庫 {stockDetailItems.reduce((total, item) => total + item.quantity, 0).toLocaleString()}点
            </Badge>
          ) : null}
          {shippedRows.length > 0 ? (
            <Button
              type="button"
              variant={showShippedRows ? "secondary" : "outline"}
              size="sm"
              className="h-7 gap-1.5 px-2 text-xs"
              onClick={() => setShowShippedRows((current) => !current)}
            >
              {showShippedRows ? "出庫済みを非表示" : "出庫済みを表示"}
              <Badge variant="outline" className="h-5 px-1.5 text-[11px]">
                {shippedRows.length}
              </Badge>
            </Button>
          ) : null}
          {productFilter ? (
            <>
              <Badge variant="secondary">{productDetailFilterLabel(productFilter)}</Badge>
              <Button type="button" variant="ghost" size="sm" onClick={onClearProductFilter}>
                絞り込み解除
              </Button>
            </>
          ) : null}
        </div>
        <div className="space-y-3">
          {visibleRows.length === 0 && stockDetailItems.length === 0 ? (
            <EmptyState
              icon={PackageCheck}
              title="該当する仕入れ登録がありません"
              description={
                shippedRows.length > 0 && !showShippedRows
                  ? "出庫済みを表示すると確認できます。"
                  : "充足状況の絞り込みを解除すると、すべての仕入れ登録を確認できます。"
              }
            />
          ) : (
            <>
              {visibleRows.map((row) => (
                <PurchaseRegistrationCard
                  key={row.id}
                  row={row}
                  invoiceOptions={invoiceOptions}
                  onPrintLabels={onPrintLabels}
                  onOpenEdit={onOpenEdit}
                  onOpenTrackingDialog={onOpenTrackingDialog}
                  onOpenShippingHistory={onOpenShippingHistory}
                  onDeleteRow={onDeleteRow}
                  isDeleting={deletingRowId === row.id}
                />
              ))}
              {stockDetailItems.length > 0 ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-800">
                    <Boxes className="h-4 w-4" />
                    現在庫
                    <Badge variant="outline">{stockDetailItems.length}件</Badge>
                  </div>
                  {stockDetailItems.map((item) => (
                    <StockDetailCard key={item.key} item={item} onOpenEdit={onOpenStockEdit} />
                  ))}
                </div>
              ) : null}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
