import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  Activity,
  ArrowUpRight,
  Box,
  CheckCircle2,
  Clock3,
  ExternalLink,
  PackageCheck,
  RefreshCw,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  buildOrderMonitorSnapshot,
  extractInvoiceNo,
  quantityOf,
  type DeliveryRow,
  type DirectSummary,
  type InventoryRow,
  type PurchaseRow,
} from "@/inventory/lib/orderMonitor";

const REFRESH_INTERVAL = 60_000;

function formatTime(date: Date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function MetricCard({
  icon: Icon,
  label,
  value,
  note,
  color,
}: {
  icon: typeof ShoppingCart;
  label: string;
  value: number;
  note: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border border-slate-700/80 bg-slate-900/75 p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide text-slate-400">{label}</span>
        <Icon className={`h-4 w-4 ${color}`} />
      </div>
      <div className="mt-1 flex items-end gap-1.5">
        <span className="text-2xl font-bold tabular-nums text-white">{value.toLocaleString()}</span>
        <span className="pb-0.5 text-xs text-slate-400">台</span>
      </div>
      <p className="mt-1 truncate text-[10px] text-slate-500">{note}</p>
    </div>
  );
}

function StatusDot({ active }: { active: boolean }) {
  return <span className={`h-2 w-2 shrink-0 rounded-full ${active ? "bg-amber-400" : "bg-emerald-400"}`} />;
}

export default function OrderMonitor({ compact = false }: { compact?: boolean }) {
  const [, setLocation] = useLocation();
  const [updatedAt, setUpdatedAt] = useState(new Date());
  const directQuery = trpc.inventory.orderManagement.getSummary.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL,
    refetchOnWindowFocus: true,
  });
  const purchaseQuery = trpc.inventory.zaico.getPurchases.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL,
    refetchOnWindowFocus: true,
  });
  const inventoryQuery = trpc.inventory.zaico.getInventories.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL,
    refetchOnWindowFocus: true,
  });
  const deliveryQuery = trpc.inventory.deliveryHistory.list.useQuery({ limit: 500 }, {
    refetchInterval: REFRESH_INTERVAL,
    refetchOnWindowFocus: true,
  });

  const isLoading = directQuery.isLoading || purchaseQuery.isLoading || inventoryQuery.isLoading || deliveryQuery.isLoading;
  const isFetching = directQuery.isFetching || purchaseQuery.isFetching || inventoryQuery.isFetching || deliveryQuery.isFetching;
  const hasError = directQuery.isError || purchaseQuery.isError || inventoryQuery.isError || deliveryQuery.isError;

  const snapshot = useMemo(() => buildOrderMonitorSnapshot(
    (directQuery.data ?? []) as DirectSummary[],
    (purchaseQuery.data ?? []) as PurchaseRow[],
    (inventoryQuery.data ?? []) as InventoryRow[],
    (deliveryQuery.data ?? []) as unknown as DeliveryRow[],
  ), [directQuery.data, purchaseQuery.data, inventoryQuery.data, deliveryQuery.data]);

  useEffect(() => {
    if (!isFetching && !isLoading) setUpdatedAt(new Date());
  }, [isFetching, isLoading, directQuery.dataUpdatedAt, purchaseQuery.dataUpdatedAt, inventoryQuery.dataUpdatedAt, deliveryQuery.dataUpdatedAt]);

  const refresh = async () => {
    await Promise.all([
      directQuery.refetch(),
      purchaseQuery.refetch(),
      inventoryQuery.refetch(),
      deliveryQuery.refetch(),
    ]);
    setUpdatedAt(new Date());
  };

  const purchaseByInvoice = useMemo(() => {
    const map = new Map<string, { ordered: number; shipped: number }>();
    for (const purchase of snapshot.openPurchases) {
      const shipped = Boolean(purchase.extra?.trackingNumber?.trim());
      for (const item of purchase.purchase_items) {
        const invoiceNo = extractInvoiceNo(item.etc);
        if (!invoiceNo) continue;
        const current = map.get(invoiceNo) ?? { ordered: 0, shipped: 0 };
        const quantity = quantityOf(item.quantity);
        if (shipped) current.shipped += quantity;
        else current.ordered += quantity;
        map.set(invoiceNo, current);
      }
    }
    return map;
  }, [snapshot.openPurchases]);

  return (
    <div className={compact ? "min-h-screen bg-[#07101f] p-2 text-slate-100" : "mx-auto w-full max-w-6xl py-2"}>
      <div className={compact ? "mx-auto max-w-[430px]" : "grid gap-4 lg:grid-cols-[430px_1fr]"}>
        <section className="overflow-hidden rounded-2xl border border-slate-700 bg-[#0a1425] text-slate-100 shadow-xl shadow-slate-950/20">
          <header className="flex items-center justify-between border-b border-slate-700/80 px-4 py-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
                <h1 className="text-sm font-semibold tracking-wide">受注・発送 Monitor</h1>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">自動更新 60秒 · {formatTime(updatedAt)}</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={refresh}
                disabled={isFetching}
                className="rounded-lg border border-slate-700 p-2 text-slate-300 transition hover:bg-slate-800 disabled:opacity-50"
                aria-label="再読み込み"
                title="再読み込み"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              </button>
              {!compact && (
                <button
                  type="button"
                  onClick={() => window.open("/inventory/order-monitor?compact=1", "order-monitor", "width=450,height=820")}
                  className="rounded-lg border border-slate-700 p-2 text-slate-300 transition hover:bg-slate-800"
                  aria-label="小窓で開く"
                  title="小窓で開く"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </header>

          {hasError ? (
            <div className="m-3 rounded-lg border border-rose-800 bg-rose-950/50 p-3 text-xs text-rose-200">
              一部データを取得できませんでした。再読み込みしてください。
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-2 p-3">
            <MetricCard icon={ShoppingCart} label="直取 受注残" value={snapshot.directOutstanding} note={`${snapshot.openDirectRows.length}件 · 受注${snapshot.directOrdered} / 発送${snapshot.directDelivered}`} color="text-cyan-400" />
            <MetricCard icon={Box} label="eBay 受注残" value={snapshot.ebayOutstanding} note={`注文URL未登録 ${snapshot.ebayWithoutOrderUrl}台`} color="text-fuchsia-400" />
            <MetricCard icon={Clock3} label="仕入れ注文済み" value={snapshot.purchaseOrderedQuantity} note={`${snapshot.awaitingSupplier.length}件 · 追跡番号待ち`} color="text-amber-400" />
            <MetricCard icon={Truck} label="仕入先発送済み" value={snapshot.supplierShippedQuantity} note={`${snapshot.supplierShipped.length}件 · 未入庫`} color="text-blue-400" />
          </div>

          <div className="mx-3 mb-3 rounded-xl border border-slate-700/80 bg-slate-900/75 p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-medium text-slate-300">
                <PackageCheck className="h-4 w-4 text-emerald-400" />
                顧客へ発送済み
              </div>
              <span className="text-xl font-bold tabular-nums text-white">{snapshot.shippedThisMonth.toLocaleString()}台</span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
              <div className="h-full rounded-full bg-gradient-to-r from-cyan-400 via-emerald-400 to-lime-300" style={{ width: snapshot.shippedThisMonth > 0 ? "100%" : "0%" }} />
            </div>
            <div className="mt-2 flex justify-between text-[10px] text-slate-500">
              <span>今日 {snapshot.shippedToday}台</span>
              <span>今月 直取{snapshot.directShippedThisMonth} / eBay{snapshot.ebayShippedThisMonth}</span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 border-t border-slate-700/80 px-3 py-2 text-[10px] text-slate-500">
            <Activity className="h-3 w-3" />
            {isLoading ? "データ読込中…" : "直取・eBay・仕入れ・出庫の4データを突合済み"}
          </div>
        </section>

        {!compact && (
          <section className="grid content-start gap-4">
            <div className="rounded-xl border bg-card p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold">発送待ちの直取</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">受注数と、在庫・発注・仕入先発送の現在地</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setLocation("/inventory/order-management")}>
                  発注管理 <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="space-y-2">
                {snapshot.openDirectRows.slice().sort((a, b) => Number(b.key) - Number(a.key)).slice(0, 8).map((row) => {
                  const purchase = purchaseByInvoice.get(row.key) ?? { ordered: 0, shipped: 0 };
                  const remaining = Math.max(0, row.csvOrderQty - row.deliveredCount);
                  return (
                    <button key={row.key} type="button" onClick={() => setLocation(`/inventory/order-management?q=${encodeURIComponent(row.key)}`)} className="grid w-full grid-cols-[1fr_auto] items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition hover:bg-muted/50">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <StatusDot active={remaining > 0} />
                          <span className="font-semibold">No.{row.key}</span>
                          <span className="truncate text-xs text-muted-foreground">{row.partner}</span>
                        </div>
                        <p className="mt-1 text-[11px] text-muted-foreground">在庫 {row.stockCount} · 注文済 {purchase.ordered} · 仕入先発送 {purchase.shipped}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-lg font-bold tabular-nums">残 {remaining}</div>
                        <div className="text-[10px] text-muted-foreground">受注 {row.csvOrderQty}</div>
                      </div>
                    </button>
                  );
                })}
                {!isLoading && snapshot.openDirectRows.length === 0 ? (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> 発送待ちの直取はありません</div>
                ) : null}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">eBay 発送待ち</h2>
                  <Button variant="ghost" size="sm" onClick={() => setLocation("/inventory/ebay-inventory")}>一覧へ</Button>
                </div>
                <div className="space-y-2">
                  {snapshot.ebayOrderRows.slice(0, 6).map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{item.title}</p>
                        <p className="truncate text-[10px] text-muted-foreground">{item.etc?.split(",")[0] ?? "管理番号なし"}</p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">{quantityOf(item.quantity)}台</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">仕入れ進行中</h2>
                  <Button variant="ghost" size="sm" onClick={() => setLocation("/inventory/purchases")}>一覧へ</Button>
                </div>
                <div className="space-y-2">
                  {snapshot.openPurchases.slice(0, 6).map((purchase) => {
                    const item = purchase.purchase_items[0];
                    const shipped = Boolean(purchase.extra?.trackingNumber?.trim());
                    return (
                      <div key={purchase.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{item?.title || purchase.num || `#${purchase.id}`}</p>
                          <p className="truncate text-[10px] text-muted-foreground">{item?.etc?.split(",")[0] ?? purchase.num}</p>
                        </div>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-medium ${shipped ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>
                          {shipped ? "仕入先発送" : "注文済"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
