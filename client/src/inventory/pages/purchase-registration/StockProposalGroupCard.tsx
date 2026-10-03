import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ChevronDown } from "lucide-react";
import { formatCurrency } from "./format";
import { proposalAveragePrice } from "./stockProposalDisplay";
import type { StockProposalGroup } from "./viewTypes";
import { StockProposalProductRow, StockProposalProductMobile } from "./StockProposalProducts";

export function StockProposalGroupCard({ group, defaultOpen }: { group: StockProposalGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const averagePrice = proposalAveragePrice(group.unitPriceTotal, group.unitPriceQuantity);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-md border bg-background">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-base font-semibold">{group.model}</span>
              <Badge variant="secondary">{group.totalQuantity.toLocaleString()}台</Badge>
              {group.waitingQuantity > 0 ? (
                <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">
                  内 入庫待ち {group.waitingQuantity.toLocaleString()}台
                </Badge>
              ) : null}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {group.products.length.toLocaleString()}商品 / 平均仕入相場 {averagePrice > 0 ? formatCurrency(averagePrice) : "-"}
            </div>
          </div>
          <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="border-t">
          <div className="divide-y md:hidden">
            {group.products.map((product) => (
              <StockProposalProductMobile key={product.key} product={product} />
            ))}
          </div>
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">商品</th>
                  <th className="px-4 py-3 text-right font-medium">台数</th>
                  <th className="px-4 py-3 text-right font-medium">現在庫</th>
                  <th className="px-4 py-3 text-right font-medium">入庫待ち</th>
                  <th className="px-4 py-3 text-left font-medium">仕入相場</th>
                  <th className="px-4 py-3 text-left font-medium">管理番号</th>
                </tr>
              </thead>
              <tbody>
                {group.products.map((product) => (
                  <StockProposalProductRow key={product.key} product={product} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
