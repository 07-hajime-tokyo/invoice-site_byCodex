import { cn } from "@/lib/utils";
import type { ProductSummary, ProductDetailFilter } from "./viewTypes";
import { formatCurrency, formatTradePrice } from "./format";

// The legacy table currently has no callers; preserve its distinct shortage formula.

export function ProductFulfillmentTable({ products }: { products: ProductSummary[] }) {
  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">充足状況</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">品目</th>
              <th className="px-4 py-3 text-right font-medium">必要</th>
              <th className="px-4 py-3 text-right font-medium">確保</th>
              <th className="px-4 py-3 text-right font-medium">仕入れ不足</th>
              <th className="px-4 py-3 text-right font-medium">平均仕入</th>
              <th className="px-4 py-3 text-right font-medium">売価</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  充足状況を表示できる商品がありません
                </td>
              </tr>
            ) : (
              products.map((product) => {
                const shortage = Math.max(product.required - product.secured, 0);
                const average = product.unitPriceCount > 0 ? product.unitPriceTotal / product.unitPriceCount : 0;
                return (
                  <tr key={product.key} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{product.title}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="inline-flex min-w-7 justify-center rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                        {product.required.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{product.secured.toLocaleString()}</td>
                    <td className="px-4 py-3 text-right">
                      <span className={cn("font-medium", shortage > 0 ? "text-rose-600" : "text-foreground")}>
                        {shortage.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">{average > 0 ? formatCurrency(Math.round(average)) : "-"}</td>
                    <td className="px-4 py-3 text-right">
                      {formatTradePrice(product.sellingPrice, product.sellingCurrency)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ProductFulfillmentTableV2({
  products,
  selectedFilter,
  onProductFilter,
  stockOnly = false,
}: {
  products: ProductSummary[];
  selectedFilter?: ProductDetailFilter | null;
  onProductFilter?: (filter: ProductDetailFilter) => void;
  stockOnly?: boolean;
}) {
  const stockHeaderActive = selectedFilter?.mode === "stock" && !selectedFilter.productKey;
  const waitingHeaderActive = selectedFilter?.mode === "waiting" && !selectedFilter.productKey;

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <div className="border-b bg-muted/30 px-4 py-3 text-sm font-medium">充足状況</div>
      <div className="divide-y md:hidden">
        {products.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            表示できる商品がありません
          </div>
        ) : (
          products.map((product) => {
            const shortage = product.required - product.secured - product.waiting;
            const average = product.unitPriceCount > 0 ? product.unitPriceTotal / product.unitPriceCount : 0;
            const stockFilterActive = selectedFilter?.productKey === product.key && selectedFilter.mode === "stock";
            const waitingFilterActive = selectedFilter?.productKey === product.key && selectedFilter.mode === "waiting";
            return (
              <div key={product.key} className="p-4">
                <div className="font-medium">{product.title}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  {!stockOnly ? (
                    <>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">インボイス発注数</div>
                        <div className="mt-1 font-semibold">{product.invoiceOrdered == null ? "-" : product.invoiceOrdered.toLocaleString()}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">出庫数</div>
                        <div className="mt-1 font-semibold">{product.invoiceShipped == null ? "-" : product.invoiceShipped.toLocaleString()}</div>
                      </div>
                      <div className="rounded-md bg-blue-50 p-2">
                        <div className="text-xs text-blue-700">必要</div>
                        <div className="mt-1 font-semibold text-blue-800">{product.required.toLocaleString()}</div>
                      </div>
                    </>
                  ) : null}
                  <div className="rounded-md bg-emerald-50 p-2">
                    <div className="text-xs text-emerald-700">現在庫</div>
                    {product.secured > 0 && onProductFilter ? (
                      <button
                        type="button"
                        className={cn(
                          "mt-1 inline-flex rounded px-2 py-1 text-sm font-semibold",
                          stockFilterActive ? "bg-emerald-100 text-emerald-900" : "text-emerald-800",
                        )}
                        onClick={() => onProductFilter({ productKey: product.key, productTitle: product.title, mode: "stock" })}
                      >
                        {product.secured.toLocaleString()}
                      </button>
                    ) : (
                      <div className="mt-1 font-semibold text-emerald-800">{product.secured.toLocaleString()}</div>
                    )}
                  </div>
                  <div className="rounded-md bg-amber-50 p-2">
                    <div className="text-xs text-amber-700">入庫まち</div>
                    {product.waiting > 0 && onProductFilter ? (
                      <button
                        type="button"
                        className={cn(
                          "mt-1 inline-flex rounded px-2 py-1 text-sm font-semibold",
                          waitingFilterActive ? "bg-amber-100 text-amber-900" : "text-amber-800",
                        )}
                        onClick={() => onProductFilter({ productKey: product.key, productTitle: product.title, mode: "waiting" })}
                      >
                        {product.waiting.toLocaleString()}
                      </button>
                    ) : (
                      <div className="mt-1 font-semibold text-amber-800">{product.waiting > 0 ? product.waiting.toLocaleString() : "-"}</div>
                    )}
                  </div>
                  {!stockOnly ? (
                    <>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">仕入れ不足</div>
                        <div className={cn("mt-1 font-semibold", shortage > 0 ? "text-rose-600" : "text-foreground")}>{shortage.toLocaleString()}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">平均仕入</div>
                        <div className="mt-1 font-semibold">{average > 0 ? formatCurrency(Math.round(average)) : "-"}</div>
                      </div>
                      <div className="rounded-md bg-slate-50 p-2">
                        <div className="text-xs text-muted-foreground">売価</div>
                        <div className="mt-1 font-semibold">{formatTradePrice(product.sellingPrice, product.sellingCurrency)}</div>
                      </div>
                    </>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className={cn("w-full text-sm", stockOnly ? "min-w-[480px]" : "min-w-[960px]")}>
          <thead className="border-b text-xs text-muted-foreground">
            <tr>
              <th className="px-4 py-3 text-left font-medium">品目</th>
              {!stockOnly ? (
                <>
                  <th className="px-4 py-3 text-right font-medium">インボイス発注数</th>
                  <th className="px-4 py-3 text-right font-medium">出庫数</th>
                  <th className="px-4 py-3 text-right font-medium">必要</th>
                </>
              ) : null}
              <th
                className={cn(
                  "px-4 py-3 text-right font-medium",
                  onProductFilter && "cursor-pointer select-none transition hover:bg-emerald-50 hover:text-emerald-700",
                  stockHeaderActive && "bg-emerald-50 text-emerald-700",
                )}
                role={onProductFilter ? "button" : undefined}
                tabIndex={onProductFilter ? 0 : undefined}
                onClick={() => onProductFilter?.({ productTitle: "現在庫", mode: "stock" })}
                onKeyDown={(event) => {
                  if (!onProductFilter) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onProductFilter({ productTitle: "現在庫", mode: "stock" });
                  }
                }}
              >
                {onProductFilter ? (
                  <span className="inline-flex rounded px-2 py-1">現在庫</span>
                ) : (
                  "現在庫"
                )}
              </th>
              <th
                className={cn(
                  "px-4 py-3 text-right font-medium",
                  onProductFilter && "cursor-pointer select-none transition hover:bg-amber-50 hover:text-amber-700",
                  waitingHeaderActive && "bg-amber-50 text-amber-700",
                )}
                role={onProductFilter ? "button" : undefined}
                tabIndex={onProductFilter ? 0 : undefined}
                onClick={() => onProductFilter?.({ productTitle: "入庫まち", mode: "waiting" })}
                onKeyDown={(event) => {
                  if (!onProductFilter) return;
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onProductFilter({ productTitle: "入庫まち", mode: "waiting" });
                  }
                }}
              >
                {onProductFilter ? (
                  <span className="inline-flex rounded px-2 py-1">入庫まち</span>
                ) : (
                  "入庫まち"
                )}
              </th>
              {!stockOnly ? (
                <>
                  <th className="px-4 py-3 text-right font-medium">仕入れ不足</th>
                  <th className="px-4 py-3 text-right font-medium">平均仕入</th>
                  <th className="px-4 py-3 text-right font-medium">売価</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={stockOnly ? 3 : 9} className="px-4 py-8 text-center text-muted-foreground">
                  表示できる商品がありません
                </td>
              </tr>
            ) : (
              products.map((product) => {
                const shortage = product.required - product.secured - product.waiting;
                const average = product.unitPriceCount > 0 ? product.unitPriceTotal / product.unitPriceCount : 0;
                const stockFilterActive = selectedFilter?.productKey === product.key && selectedFilter.mode === "stock";
                const waitingFilterActive = selectedFilter?.productKey === product.key && selectedFilter.mode === "waiting";
                return (
                  <tr key={product.key} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{product.title}</td>
                    {!stockOnly ? (
                      <>
                        <td className="px-4 py-3 text-right">
                          {product.invoiceOrdered == null ? "-" : product.invoiceOrdered.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {product.invoiceShipped == null ? "-" : product.invoiceShipped.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="inline-flex min-w-7 justify-center rounded bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                            {product.required.toLocaleString()}
                          </span>
                        </td>
                      </>
                    ) : null}
                    <td className="px-4 py-3 text-right">
                      {product.secured > 0 && onProductFilter ? (
                        <button
                          type="button"
                          className={cn(
                            "inline-flex min-w-7 justify-center rounded px-2 py-1 text-xs font-semibold transition hover:bg-emerald-100",
                            stockFilterActive ? "bg-emerald-100 text-emerald-800" : "bg-emerald-50 text-emerald-700",
                          )}
                          onClick={() =>
                            onProductFilter({ productKey: product.key, productTitle: product.title, mode: "stock" })
                          }
                        >
                          {product.secured.toLocaleString()}
                        </button>
                      ) : (
                        product.secured.toLocaleString()
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {product.waiting > 0 ? (
                        onProductFilter ? (
                          <button
                            type="button"
                            className={cn(
                              "inline-flex min-w-7 justify-center rounded px-2 py-1 text-xs font-semibold transition hover:bg-amber-100",
                              waitingFilterActive ? "bg-amber-100 text-amber-800" : "bg-amber-50 text-amber-700",
                            )}
                            onClick={() =>
                              onProductFilter({ productKey: product.key, productTitle: product.title, mode: "waiting" })
                            }
                          >
                            {product.waiting.toLocaleString()}
                          </button>
                        ) : (
                          <span className="inline-flex min-w-7 justify-center rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
                            {product.waiting.toLocaleString()}
                          </span>
                        )
                      ) : (
                        "-"
                      )}
                    </td>
                    {!stockOnly ? (
                      <>
                        <td className={cn("px-4 py-3 text-right font-medium", shortage > 0 ? "text-rose-600" : "text-foreground")}>
                          {shortage.toLocaleString()}
                        </td>
                        <td className="px-4 py-3 text-right">{average > 0 ? formatCurrency(Math.round(average)) : "-"}</td>
                        <td className="px-4 py-3 text-right">
                          {formatTradePrice(product.sellingPrice, product.sellingCurrency)}
                        </td>
                      </>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
