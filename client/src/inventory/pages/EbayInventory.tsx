import { useMemo, useState } from "react";
import { ExternalLink, PackageSearch, RefreshCw, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { EbayListingUrlEditor } from "@/inventory/components/EbayListingUrlEditor";
import {
  extractManagementNo,
  getEbayStockType,
  getEbayStockTypeLabel,
  type EbayStockType,
} from "@shared/ebayInventory";

type InventoryItem = {
  id: number;
  title: string;
  quantity: string;
  unit?: string | null;
  category?: string | null;
  categories?: string[];
  place?: string | null;
  etc?: string | null;
  unit_price?: number | null;
  purchase_unit_price?: number | null;
  supplierUrl?: string | null;
  supplierName?: string | null;
  ebayListingUrl?: string | null;
};

const stockTypeOptions: Array<{ value: EbayStockType; label: string }> = [
  { value: "stocked", label: "有在庫" },
  { value: "dropship", label: "無在庫" },
];

function formatYen(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return "-";
  return `¥${value.toLocaleString()}`;
}

export default function EbayInventory() {
  const [stockType, setStockType] = useState<EbayStockType>("stocked");
  const [query, setQuery] = useState("");
  const { data, isLoading, refetch, isFetching } = trpc.inventory.zaico.getInventories.useQuery();

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return ((data ?? []) as InventoryItem[])
      .map((item) => ({
        ...item,
        managementNo: extractManagementNo(item.etc),
        ebayStockType: getEbayStockType(item.etc),
      }))
      .filter((item) => item.ebayStockType === stockType)
      .filter((item) => {
        if (!q) return true;
        return (
          item.title.toLowerCase().includes(q) ||
          item.managementNo.toLowerCase().includes(q) ||
          (item.category ?? item.categories?.[0] ?? "").toLowerCase().includes(q)
        );
      });
  }, [data, query, stockType]);

  const counts = useMemo(() => {
    const result: Record<EbayStockType, number> = { stocked: 0, dropship: 0 };
    for (const item of (data ?? []) as InventoryItem[]) {
      const type = getEbayStockType(item.etc);
      if (type) result[type] += 1;
    }
    return result;
  }, [data]);

  const totalQuantity = items.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">eBay在庫</h1>
          <p className="text-sm text-muted-foreground mt-1">
            E始まりの管理番号だけを表示します。E0618形式は有在庫、それ以外は無在庫です。
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
          更新
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border bg-card p-3 md:flex-row md:items-center md:justify-between">
        <div className="inline-flex rounded-md border bg-background p-1 w-fit">
          {stockTypeOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStockType(option.value)}
              className={`px-3 py-1.5 text-sm rounded transition-colors ${
                stockType === option.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {option.label}
              <span className="ml-1 opacity-80">{counts[option.value]}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="商品名・管理番号で検索"
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">表示件数</p>
          <p className="text-2xl font-semibold">{items.length}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">在庫数合計</p>
          <p className="text-2xl font-semibold">{totalQuantity}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">種別</p>
          <p className="text-2xl font-semibold">{getEbayStockTypeLabel(stockType)}</p>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border bg-card p-12 text-center text-muted-foreground">読み込み中...</div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <PackageSearch className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="font-medium">該当するeBay在庫はありません</p>
          <p className="text-sm text-muted-foreground mt-1">管理番号がE始まりの商品が対象です。</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => {
            const category = item.category ?? item.categories?.[0] ?? "未分類";
            const unitPrice = item.purchase_unit_price ?? item.unit_price ?? null;
            return (
              <div key={item.id} className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline">{item.managementNo}</Badge>
                      <Badge className={stockType === "stocked" ? "bg-emerald-600" : "bg-sky-600"}>
                        {getEbayStockTypeLabel(stockType)}
                      </Badge>
                      <Badge variant="secondary">{category}</Badge>
                    </div>
                    <div>
                      <h2 className="font-semibold text-base">{item.title}</h2>
                      <p className="text-sm text-muted-foreground">
                        在庫 {item.quantity ?? 0}{item.unit ?? ""} ・ 仕入単価 {formatYen(unitPrice)}
                      </p>
                    </div>
                    {(item.supplierName || item.supplierUrl) && (
                      <p className="text-xs text-muted-foreground">
                        仕入先:{" "}
                        {item.supplierUrl ? (
                          <a href={item.supplierUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                            {item.supplierName || item.supplierUrl}
                          </a>
                        ) : (
                          item.supplierName
                        )}
                      </p>
                    )}
                  </div>
                  <EbayListingUrlEditor
                    inventoryId={item.id}
                    managementNo={item.managementNo}
                    value={item.ebayListingUrl}
                    className="lg:justify-end"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

