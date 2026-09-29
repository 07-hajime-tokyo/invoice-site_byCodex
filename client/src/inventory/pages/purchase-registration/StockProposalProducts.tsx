import { Badge } from "@/components/ui/badge";
import { stockProposalPriceLabel, stockProposalManagementLabel } from "./stockProposalDisplay";
import type { StockProposalProduct } from "./viewTypes";

export function StockProposalProductRow({ product }: { product: StockProposalProduct }) {
  const price = stockProposalPriceLabel(product);
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-3">
        <div className="font-medium">{product.title}</div>
        {product.waitingQuantity > 0 ? (
          <div className="mt-1 text-xs text-amber-700">内 入庫待ち {product.waitingQuantity.toLocaleString()}台</div>
        ) : null}
      </td>
      <td className="px-4 py-3 text-right font-semibold">{product.totalQuantity.toLocaleString()}台</td>
      <td className="px-4 py-3 text-right">{product.stockQuantity.toLocaleString()}台</td>
      <td className="px-4 py-3 text-right">{product.waitingQuantity > 0 ? `${product.waitingQuantity.toLocaleString()}台` : "-"}</td>
      <td className="px-4 py-3">
        <div className="font-medium">{price.main}</div>
        {price.sub ? <div className="mt-1 text-xs text-muted-foreground">{price.sub}</div> : null}
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{stockProposalManagementLabel(product)}</td>
    </tr>
  );
}

export function StockProposalProductMobile({ product }: { product: StockProposalProduct }) {
  const price = stockProposalPriceLabel(product);
  return (
    <div className="p-4">
      <div className="font-medium">{product.title}</div>
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant="secondary">{product.totalQuantity.toLocaleString()}台</Badge>
        <Badge variant="outline">現在庫 {product.stockQuantity.toLocaleString()}台</Badge>
        {product.waitingQuantity > 0 ? (
          <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">内 入庫待ち {product.waitingQuantity.toLocaleString()}台</Badge>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 text-sm">
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <div className="text-xs text-muted-foreground">仕入相場</div>
          <div className="mt-1 font-semibold">{price.main}</div>
          {price.sub ? <div className="mt-1 text-xs text-muted-foreground">{price.sub}</div> : null}
        </div>
        <div className="rounded-md bg-slate-50 px-3 py-2">
          <div className="text-xs text-muted-foreground">管理番号</div>
          <div className="mt-1 text-xs">{stockProposalManagementLabel(product)}</div>
        </div>
      </div>
    </div>
  );
}
