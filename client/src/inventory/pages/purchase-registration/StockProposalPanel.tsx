import { useState } from "react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Boxes } from "lucide-react";
import { formatCurrency } from "./format";
import { proposalAveragePrice } from "./stockProposalDisplay";
import { EmptyState } from "./EmptyState";
import type { StockProposalGroup } from "./viewTypes";
import { fieldClass } from "./fieldStyles";
import { StockProposalGroupCard } from "./StockProposalGroupCard";

export function StockProposalPanel({ groups }: { groups: StockProposalGroup[] }) {
  const [averageModelFilter, setAverageModelFilter] = useState("all");
  const productCount = groups.reduce((total, group) => total + group.products.length, 0);
  const totalQuantity = groups.reduce((total, group) => total + group.totalQuantity, 0);
  const waitingQuantity = groups.reduce((total, group) => total + group.waitingQuantity, 0);
  const pricedQuantity = groups.reduce((total, group) => total + group.unitPriceQuantity, 0);
  const averagePrice = proposalAveragePrice(
    groups.reduce((total, group) => total + group.unitPriceTotal, 0),
    pricedQuantity,
  );
  const selectedAverageGroup = groups.find((group) => group.model === averageModelFilter) ?? null;
  const selectedAveragePrice = selectedAverageGroup
    ? proposalAveragePrice(selectedAverageGroup.unitPriceTotal, selectedAverageGroup.unitPriceQuantity)
    : averagePrice;
  const selectedAverageLabel = selectedAverageGroup?.model ?? "全体";

  return (
    <div className="space-y-4">
      <section className="rounded-md border bg-background p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold">在庫提案サマリー</h2>
          <Badge variant="outline">{productCount.toLocaleString()}商品</Badge>
          <Badge variant="secondary">{totalQuantity.toLocaleString()}台</Badge>
          {waitingQuantity > 0 ? (
            <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">入庫待ち {waitingQuantity.toLocaleString()}台</Badge>
          ) : null}
        </div>
        <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
          <div className="rounded-md bg-slate-50 px-3 py-2">
            <div className="text-xs text-muted-foreground">現在庫</div>
            <div className="mt-1 font-semibold">{(totalQuantity - waitingQuantity).toLocaleString()}台</div>
          </div>
          <div className="rounded-md bg-amber-50 px-3 py-2">
            <div className="text-xs text-amber-700">入庫待ち</div>
            <div className="mt-1 font-semibold text-amber-800">{waitingQuantity.toLocaleString()}台</div>
          </div>
          <div className="rounded-md bg-emerald-50 px-3 py-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-emerald-700">平均仕入相場</div>
              <select
                className={cn(fieldClass, "h-8 min-w-0 bg-white px-2 text-xs sm:w-36")}
                value={selectedAverageGroup ? selectedAverageGroup.model : "all"}
                onChange={(event) => setAverageModelFilter(event.target.value)}
              >
                <option value="all">全体</option>
                {groups.map((group) => (
                  <option key={group.model} value={group.model}>
                    {group.model}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-1 font-semibold text-emerald-800">
              {selectedAveragePrice > 0 ? formatCurrency(selectedAveragePrice) : "-"}
            </div>
            <div className="mt-1 text-xs text-emerald-700">{selectedAverageLabel}</div>
          </div>
        </div>
      </section>

      {groups.length === 0 ? (
        <EmptyState icon={Boxes} title="提案できる在庫がありません" />
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <StockProposalGroupCard key={group.model} group={group} defaultOpen={false} />
          ))}
        </div>
      )}
    </div>
  );
}
