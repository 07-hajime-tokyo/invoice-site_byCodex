/**
 * Home Page — ゲーム機取引データ 検索サイト
 * Design: Scandinavian BI Style
 * Features: Full-text search, column filters, sort, pagination, charts, KPI cards, mobile-first
 *           Tab navigation: 取引データ / 入出庫管理 / インボイス
 *           Data source: DB (tRPC) — spreadsheet write-back is kept in parallel
 */
import { lazy, Suspense, useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  TradeRecord,
  formatCurrency,
  formatNumber,
  SortDir,
  SortKey,
} from "@/lib/csvUtils";
import { KpiCard } from "@/components/KpiCard";
import {
  Search,
  TrendingUp,
  Package,
  Users,
  DollarSign,
  RefreshCw,
  AlertCircle,
  X,
  SlidersHorizontal,
  Warehouse,
  LogOut,
  FileText,
  Truck,
  Receipt,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc as trpcClient } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

type FilterableKey = "year" | "monthFrom" | "monthTo" | "partner" | "currency" | "status";
type ActiveTab = "trade" | "inventory" | "invoice";

const AddTradeDialog = lazy(() => import("@/components/AddTradeDialog").then((module) => ({ default: module.AddTradeDialog })));
const AddShipmentDialog = lazy(() => import("@/components/AddShipmentDialog").then((module) => ({ default: module.AddShipmentDialog })));
const ShipmentListDialog = lazy(() => import("@/components/ShipmentListDialog").then((module) => ({ default: module.ShipmentListDialog })));
const FilterPanel = lazy(() => import("@/components/FilterPanel").then((module) => ({ default: module.FilterPanel })));
const DataTable = lazy(() => import("@/components/DataTable").then((module) => ({ default: module.DataTable })));
const ChartSection = lazy(() => import("@/components/ChartSection").then((module) => ({ default: module.ChartSection })));
const InvoicePage = lazy(() => import("./InvoicePage"));
const InventoryApp = lazy(() => import("@/inventory/InventoryApp"));

function PanelLoading() {
  return (
    <div className="min-h-[240px] flex items-center justify-center gap-2 text-sm text-muted-foreground">
      <RefreshCw size={16} className="animate-spin" />
      <span>Loading...</span>
    </div>
  );
}

// DBレコードをフロントエンドのTradeRecord型に変換する
function dbRecordToTradeRecord(r: {
  id: number;
  month: string | null;
  partner: string | null;
  no: number | null;
  paymentDate: string | null;
  productName: string | null;
  quantity: string | null;
  unitPrice: string | null;
  currency: string | null;
  unitPriceJPY: string | null;
  status: string | null;
  procurement: string | null;
  shippingFromTokyo: string | null;
  totalSales: string | null;
  procurementTotal: string | null;
  refund: string | null;
  shippingCost: string | null;
  customsDuty?: string | null;
  profitWithRefund: string | null;
  cumulativeProfit: string | null;
}): TradeRecord & { customsDuty: number } {
  const paymentDate = r.paymentDate ?? "";
  // 年を抽出
  let year = "";
  if (paymentDate) {
    const m = paymentDate.match(/\b(20\d{2})\b/);
    if (m) year = m[1];
    else {
      try {
        const d = new Date(paymentDate);
        if (!isNaN(d.getTime())) year = String(d.getFullYear());
      } catch { /* ignore */ }
    }
  }
  const yearMonth = year && r.month ? `${year}-${String(r.month).padStart(2, "0")}` : "";
  const pf = (v: string | null, decimals = 0) => {
    const n = parseFloat(v ?? "0") || 0;
    return decimals === 0 ? Math.round(n) : Math.round(n * 10 ** decimals) / 10 ** decimals;
  };
  return {
    month: r.month ?? "",
    year,
    yearMonth,
    partner: r.partner ?? "",
    no: r.no ?? 0,
    paymentDate,
    productName: r.productName ?? "",
    quantity: pf(r.quantity, 2),
    unitPrice: pf(r.unitPrice, 2),
    currency: r.currency ?? "",
    unitPriceJPY: pf(r.unitPriceJPY),
    status: r.status ?? "",
    procurement: r.procurement ?? "",
    shippingFromTokyo: r.shippingFromTokyo ?? "",
    totalSales: pf(r.totalSales),
    procurementTotal: pf(r.procurementTotal),
    refund: pf(r.refund),
    shippingCost: pf(r.shippingCost),
    profitWithRefund: pf(r.profitWithRefund),
    cumulativeProfit: pf(r.cumulativeProfit),
    customsDuty: pf(r.customsDuty ?? null),
  };
}

// 入出庫管理タブ内の統合アプリ
function InventoryPanel() {
  return <InventoryApp />;
}

export default function Home() {
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [location, setLocation] = useLocation();
  const { user } = useAuth();
  const utils = trpc.useUtils();
  const logoutMutation = trpcClient.auth.logout.useMutation({
    onSuccess: () => { window.location.href = "/"; },
  });

  // URLクエリパラメータから初期状態を復元
  const getParams = () => new URLSearchParams(window.location.search);

  const [search, setSearchState] = useState(() => getParams().get("q") ?? "");
  // 入力中の値（まだ検索には反映しない）
  const [inputValue, setInputValue] = useState(() => getParams().get("q") ?? "");
  const [filters, setFiltersState] = useState<Partial<Record<FilterableKey, string>>>(() => {
    const p = getParams();
    const f: Partial<Record<FilterableKey, string>> = {};
    for (const key of ["year", "monthFrom", "monthTo", "partner", "currency", "status"] as FilterableKey[]) {
      const v = p.get(key);
      if (v) f[key] = v;
    }
    return f;
  });
  // デフォルトで未完了のみ表示（URLに ?incomplete=0 がある場合のみオフ）
  const [showIncompleteOnly, setShowIncompleteOnlyState] = useState(() => {
    const p = getParams();
    return p.get("incomplete") !== "0";
  });
  const [activeTab, setActiveTabState] = useState<ActiveTab>(() => {
    if (window.location.pathname.startsWith("/inventory")) return "inventory";
    const t = getParams().get("tab") as ActiveTab;
    const hasInvoiceId = !!getParams().get("invoiceId");
    return (t === "trade" || t === "inventory" || t === "invoice") ? t : hasInvoiceId ? "invoice" : "trade";
  });
  const [hasOpenedTrade, setHasOpenedTrade] = useState(() => activeTab === "trade");
  const [shouldLoadTradeFilterOptions, setShouldLoadTradeFilterOptions] = useState(false);
  const [shouldLoadTradeCharts, setShouldLoadTradeCharts] = useState(false);
  const [shouldLoadTradeActions, setShouldLoadTradeActions] = useState(false);
  const [tradePage, setTradePage] = useState(1);
  const [tradePageSize, setTradePageSize] = useState(20);
  const [tradeSortKey, setTradeSortKey] = useState<SortKey>("no");
  const [tradeSortDir, setTradeSortDir] = useState<SortDir>("asc");

  // 状態変更時にURLを更新するヘルパー
  const updateURL = useCallback((newSearch: string, newFilters: Partial<Record<FilterableKey, string>>, newIncomplete: boolean, newTab: ActiveTab) => {
    if (newTab === "inventory") {
      setLocation("/inventory/purchases", { replace: true });
      return;
    }
    const p = new URLSearchParams();
    if (newTab !== "trade") p.set("tab", newTab);
    if (newSearch) p.set("q", newSearch);
    for (const [k, v] of Object.entries(newFilters)) {
      if (v && v !== "__all__") p.set(k, v);
    }
    // incompleteOnly がオフのときのみURLに記録（デフォルトはオン）
    if (!newIncomplete) p.set("incomplete", "0");
    const qs = p.toString();
    setLocation(qs ? `/?${qs}` : "/", { replace: true });
  }, [setLocation]);

  // 検索を実行する（ボタン押下・Enter時のみ呼ぶ）
  const commitSearch = useCallback((v: string) => {
    setSearchState(v);
    setFiltersState(prev => { updateURL(v, prev, showIncompleteOnly, activeTab); return prev; });
  }, [showIncompleteOnly, activeTab, updateURL]);

  // クリアボタン用（入力値と検索値を両方リセット）
  const clearSearch = useCallback(() => {
    setInputValue("");
    setSearchState("");
    setFiltersState(prev => { updateURL("", prev, showIncompleteOnly, activeTab); return prev; });
  }, [showIncompleteOnly, activeTab, updateURL]);

  const setShowIncompleteOnly = useCallback((v: boolean) => {
    setShowIncompleteOnlyState(v);
    updateURL(search, filters, v, activeTab);
  }, [search, filters, activeTab, updateURL]);

  const setActiveTab = useCallback((v: ActiveTab) => {
    setActiveTabState(v);
    if (v === "inventory") {
      setLocation("/inventory/purchases");
      return;
    }
    if (v !== "invoice") {
      updateURL(search, filters, showIncompleteOnly, v);
    } else {
      const p = new URLSearchParams();
      p.set("tab", "invoice");
      setLocation(`/?${p.toString()}`, { replace: true });
    }
  }, [search, filters, showIncompleteOnly, updateURL, setLocation]);

  const handleFilterChange = useCallback((key: FilterableKey, value: string) => {
    setFiltersState(prev => {
      const next = { ...prev, [key]: value };
      updateURL(search, next, showIncompleteOnly, activeTab);
      return next;
    });
  }, [search, showIncompleteOnly, activeTab, updateURL]);

  const handleClearAll = useCallback(() => {
    setFiltersState({});
    setSearchState("");
    setInputValue("");
    setShowIncompleteOnlyState(true); // クリア後もデフォルト（未完了のみ）に戻す
    updateURL("", {}, true, activeTab);
  }, [activeTab, updateURL]);

  const tradeFilterInput = useMemo(() => ({
    search,
    year: filters.year && filters.year !== "__all__" ? filters.year : "",
    monthFrom: filters.monthFrom && filters.monthFrom !== "__all__" ? filters.monthFrom : "",
    monthTo: filters.monthTo && filters.monthTo !== "__all__" ? filters.monthTo : "",
    partner: filters.partner && filters.partner !== "__all__" ? filters.partner : "",
    currency: filters.currency && filters.currency !== "__all__" ? filters.currency : "",
    status: filters.status && filters.status !== "__all__" ? filters.status : "",
    incompleteOnly: showIncompleteOnly,
  }), [search, filters, showIncompleteOnly]);

  const tradeQueryInput = useMemo(() => ({
    ...tradeFilterInput,
    page: tradePage,
    pageSize: tradePageSize,
    sortKey: tradeSortKey,
    sortDir: tradeSortDir,
  }), [tradeFilterInput, tradePage, tradePageSize, tradeSortKey, tradeSortDir]);

  const tradeChartQueryInput = useMemo(() => ({
    ...tradeFilterInput,
    page: 1,
    pageSize: 5000,
    sortKey: "no",
    sortDir: "asc" as const,
  }), [tradeFilterInput]);

  useEffect(() => {
    setTradePage(1);
  }, [tradeFilterInput, tradePageSize, tradeSortKey, tradeSortDir]);

  useEffect(() => {
    if (activeTab === "trade") setHasOpenedTrade(true);
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== "inventory") return;
    const tradeTimer = window.setTimeout(() => {
      void utils.trade.listFromDb.prefetch(tradeQueryInput);
      void import("@/components/FilterPanel");
      void import("@/components/DataTable");
    }, 700);
    const filterTimer = window.setTimeout(() => {
      void utils.trade.getFilterOptions.prefetch();
    }, 1600);
    return () => {
      window.clearTimeout(tradeTimer);
      window.clearTimeout(filterTimer);
    };
  }, [activeTab, tradeQueryInput, utils]);

  useEffect(() => {
    if (activeTab !== "trade") return;
    const timer = window.setTimeout(() => {
      void import("@/inventory/InventoryApp");
      void import("@/inventory/pages/Purchases");
      void utils.inventory.zaico.getPurchasesWithCategoryPage.prefetch({
        page: 1,
        pageSize: 20,
        category: null,
        status: null,
        search: null,
      });
      void utils.inventory.zaico.getOperators.prefetch();
      void utils.inventory.zaico.getCategories.prefetch();
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [activeTab, utils]);

  useEffect(() => {
    if (activeTab !== "trade" && !hasOpenedTrade) return;
    const timer = window.setTimeout(() => setShouldLoadTradeFilterOptions(true), 900);
    return () => window.clearTimeout(timer);
  }, [activeTab, hasOpenedTrade]);

  // DB からデータを取得（フィルター・検索はサーバー側で処理）
  const { data: tradeData, isLoading, error, refetch } = trpc.trade.listFromDb.useQuery(tradeQueryInput, {
    enabled: activeTab === "trade" || hasOpenedTrade,
    staleTime: 5 * 60_000,
  });
  const dbRows = tradeData?.rows;

  const { data: tradeChartData } = trpc.trade.listFromDb.useQuery(tradeChartQueryInput, {
    enabled: shouldLoadTradeCharts && activeTab === "trade",
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (activeTab !== "trade" || !dbRows || shouldLoadTradeCharts) return;
    const timer = window.setTimeout(() => setShouldLoadTradeCharts(true), 6000);
    return () => window.clearTimeout(timer);
  }, [activeTab, dbRows, shouldLoadTradeCharts]);

  useEffect(() => {
    if (activeTab !== "trade" || !dbRows || shouldLoadTradeActions) return;
    const timer = window.setTimeout(() => setShouldLoadTradeActions(true), 2500);
    return () => window.clearTimeout(timer);
  }, [activeTab, dbRows, shouldLoadTradeActions]);

  // フィルターオプション用（全件から取得）
  const { data: filterOptions } = trpc.trade.getFilterOptions.useQuery(undefined, {
    enabled: shouldLoadTradeFilterOptions && (activeTab === "trade" || hasOpenedTrade),
    staleTime: 5 * 60_000,
  });

  // DBレコードをフロントエンド型に変換
  const filteredRecords = useMemo<TradeRecord[]>(() => {
    if (!dbRows) return [];
    return dbRows.map(dbRecordToTradeRecord);
  }, [dbRows]);

  const chartRecords = useMemo<TradeRecord[] | null>(() => {
    if (!tradeChartData?.rows) return null;
    return tradeChartData.rows.map(dbRecordToTradeRecord);
  }, [tradeChartData]);

  // FilterPanel用の全レコード（フィルターオプション表示用）
  const allRecordsForFilter = useMemo<TradeRecord[]>(() => {
    // フィルターパネルはallRecordsからユニーク値を抽出するが、
    // DBのgetFilterOptionsで代替できるため、filteredRecordsを渡す
    return filteredRecords;
  }, [filteredRecords]);

  const kpis = useMemo(() => {
    if (tradeData?.summary) return tradeData.summary;
    return {
      totalProfit: filteredRecords.reduce((s, r) => s + r.profitWithRefund, 0),
      totalSales: filteredRecords.reduce((s, r) => s + r.totalSales, 0),
      totalQty: filteredRecords.reduce((s, r) => s + r.quantity, 0),
      partners: new Set(filteredRecords.map((r) => r.partner)).size,
      totalRefund: filteredRecords.reduce((s, r) => s + (r.refund ?? 0), 0),
      totalShipping: filteredRecords.reduce((s, r) => s + (r.shippingCost ?? 0), 0),
      totalCustomsDuty: filteredRecords.reduce((s, r) => s + ((r as any).customsDuty ?? 0), 0),
    };
  }, [filteredRecords, tradeData]);

  const totalTradeRecords = tradeData?.totalCount ?? filteredRecords.length;

  const activeFilterCount = useMemo(() => {
    return Object.values(filters).filter((v) => v && v !== "__all__").length
      + (search ? 1 : 0)
      + (showIncompleteOnly ? 1 : 0);
  }, [filters, search, showIncompleteOnly]);

  const isInitialTradeLoading = activeTab === "trade" && isLoading && !dbRows;

  if (activeTab === "trade" && error && !dbRows) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F4F5F7] p-4">
        <div className="bg-white border border-border rounded-lg p-6 max-w-sm text-center shadow-sm w-full">
          <AlertCircle size={32} className="text-destructive mx-auto mb-3" />
          <p className="text-sm font-semibold text-foreground mb-1">読み込みエラー</p>
          <p className="text-xs text-muted-foreground">{error.message}</p>
          <Button className="mt-4" size="sm" onClick={() => refetch()}>
            再試行
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F4F5F7]">
      {/* Sticky Header */}
      <header className="sticky top-0 z-30 bg-[#1a2332] border-b border-[#2d3f55] shadow-md">
        <div className="container">
          <div className="flex items-center h-14 gap-3">
            {/* Logo */}
            <div className="flex items-center gap-2.5 flex-shrink-0">
              <div className="w-8 h-8 bg-primary rounded-md flex items-center justify-center shadow-sm">
                <Package size={15} className="text-primary-foreground" />
              </div>
              <div className="hidden sm:block">
                <h1 className="text-sm font-bold text-white leading-tight">ゲーム機取引データ</h1>
                <p className="text-[10px] text-slate-400 leading-tight">検索・分析ダッシュボード</p>
              </div>
            </div>

            {/* Tab navigation */}
            <nav className="flex items-center gap-1 flex-shrink-0">
              <div className="h-5 w-px bg-[#2d3f55] mx-1" />
              <button
                onClick={() => setActiveTab("trade")}
                className={`flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-semibold transition-all ${
                  activeTab === "trade"
                    ? "text-white bg-primary shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/10"
                }`}
              >
                <Package size={13} />
                <span>取引データ</span>
              </button>
              <button
                onClick={() => setActiveTab("inventory")}
                className={`flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-semibold transition-all ${
                  activeTab === "inventory"
                    ? "text-white bg-emerald-600 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/10"
                }`}
              >
                <Warehouse size={13} />
                <span>入出庫管理</span>
              </button>
              <button
                onClick={() => setActiveTab("invoice")}
                className={`flex items-center gap-1.5 px-3 h-8 rounded-md text-xs font-semibold transition-all ${
                  activeTab === "invoice"
                    ? "text-white bg-violet-600 shadow-sm"
                    : "text-slate-400 hover:text-slate-200 hover:bg-white/10"
                }`}
              >
                <FileText size={13} />
                <span>インボイス</span>
              </button>
            </nav>

            {/* Search bar — 取引データタブのみ表示 */}
            {activeTab === "trade" && (
              <div className="flex-1 relative">
                <Search
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <Input
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitSearch(inputValue); }}
                  placeholder="商品名・取引相手・状況などで検索..."
                  className="pl-8 pr-16 h-9 text-sm bg-white/10 border-white/20 text-white placeholder:text-slate-400 focus:bg-white/20 transition-colors"
                />
                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                  {inputValue && (
                    <button
                      onClick={clearSearch}
                      className="p-1 text-slate-400 hover:text-white"
                      title="クリア"
                    >
                      <X size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => commitSearch(inputValue)}
                    className="p-1 text-slate-300 hover:text-white"
                    title="検索"
                  >
                    <Search size={14} />
                  </button>
                </div>
              </div>
            )}

            {/* Mobile filter button — 取引データタブのみ表示 */}
            {activeTab === "trade" && (
              <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="md:hidden h-9 px-3 relative flex-shrink-0"
                  >
                    <SlidersHorizontal size={14} />
                    {activeFilterCount > 0 && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 bg-primary text-primary-foreground text-[10px] font-bold rounded-full flex items-center justify-center">
                        {activeFilterCount}
                      </span>
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-auto max-h-[80vh] rounded-t-xl">
                  <SheetHeader className="pb-2">
                    <SheetTitle className="text-sm">フィルター設定</SheetTitle>
                  </SheetHeader>
                  <div className="pb-4">
                    <Suspense fallback={<PanelLoading />}>
                      <FilterPanel
                        allRecords={allRecordsForFilter}
                        filters={filters}
                        onFilterChange={handleFilterChange}
                        onClearAll={handleClearAll}
                        activeCount={activeFilterCount}
                        showIncompleteOnly={showIncompleteOnly}
                        onToggleIncomplete={setShowIncompleteOnly}
                        filterOptions={filterOptions}
                      />
                    </Suspense>
                  </div>
                </SheetContent>
              </Sheet>
            )}

            {/* Record count (desktop) — 取引データタブのみ表示 */}
            {activeTab === "trade" && (
              <div className="flex-shrink-0 text-right hidden lg:block">
                <div className="text-xs text-slate-400">
                  <span className="font-bold text-white text-sm tabular-nums">
                    {totalTradeRecords.toLocaleString()}
                  </span>
                  <span className="ml-1">件</span>
                </div>
              </div>
            )}

            {/* 新規登録ボタン — 取引データタブのみ表示 */}
            {activeTab === "trade" && (
              <div className="flex items-center gap-2">
                {shouldLoadTradeActions ? (
                  <Suspense fallback={<div className="h-9 w-28" />}>
                    <ShipmentListDialog onUpdated={() => refetch()} />
                    <AddShipmentDialog onSuccess={() => refetch()} />
                    <AddTradeDialog onSuccess={() => refetch()} />
                  </Suspense>
                ) : (
                  <div className="hidden md:block h-9 w-28" aria-hidden />
                )}
              </div>
            )}

            {/* ログアウトボタン — 常時表示 */}
            <div className="flex items-center gap-2 ml-auto flex-shrink-0">
              {user && (
                <span className="hidden md:block text-xs text-slate-400 max-w-[120px] truncate">
                  {user.name}
                </span>
              )}
              <button
                onClick={() => logoutMutation.mutate()}
                disabled={logoutMutation.isPending}
                className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-white hover:bg-white/10 px-2.5 h-8 rounded-md font-medium transition-colors flex-shrink-0"
                title="ログアウト"
              >
                <LogOut size={13} />
                <span className="hidden sm:inline">ログアウト</span>
              </button>
            </div>

          </div>
        </div>
      </header>

      {/* 入出庫管理タブ（表示時だけ読み込む） */}
      {activeTab === "inventory" && (
        <Suspense fallback={<PanelLoading />}>
          <InventoryPanel />
        </Suspense>
      )}

      {/* インボイスタブ（表示時だけ読み込む） */}
      {activeTab === "invoice" && (
        <main className="container py-4">
          <Suspense fallback={<PanelLoading />}>
            <InvoicePage initialEditId={getParams().get("invoiceId") ? Number(getParams().get("invoiceId")) : null} />
          </Suspense>
        </main>
      )}

      {/* 取引データタブのコンテンツ（表示時だけ読み込む） */}
      {activeTab === "trade" && (
        <main className="container py-4 space-y-4">
          {/* KPI Cards — 1行目: 還付金合計・還付込み利益合計 */}
          <div className="grid grid-cols-2 gap-3">
            <KpiCard
              label="還付金合計"
              value={formatCurrency(kpis.totalRefund)}
              icon={<RotateCcw size={15} />}
              trend={kpis.totalRefund > 0 ? "positive" : "neutral"}
              sub="フィルター期間内"
            />
            <KpiCard
              label="還付込み利益合計"
              value={formatCurrency(kpis.totalProfit)}
              icon={<TrendingUp size={15} />}
              trend={kpis.totalProfit >= 0 ? "positive" : "negative"}
              sub={`${totalTradeRecords.toLocaleString()}件の取引`}
            />
          </div>

          {/* KPI Cards — 2行目: 売上・注文数・取引先・送料・関税 */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <KpiCard
              label="売上合計"
              value={formatCurrency(kpis.totalSales)}
              icon={<DollarSign size={15} />}
              trend="neutral"
            />
            <KpiCard
              label="総注文数"
              value={formatNumber(kpis.totalQty) + " 台"}
              icon={<Package size={15} />}
              trend="neutral"
            />
            <KpiCard
              label="取引相手数"
              value={kpis.partners + " 社"}
              icon={<Users size={15} />}
              trend="neutral"
              sub="ユニーク取引先"
            />
            <KpiCard
              label="送料合計"
              value={formatCurrency(kpis.totalShipping)}
              icon={<Truck size={15} />}
              trend="neutral"
            />
            <KpiCard
              label="関税合計"
              value={formatCurrency(kpis.totalCustomsDuty)}
              icon={<Receipt size={15} />}
              trend="neutral"
              sub="ドル取引のみ"
            />
          </div>

          {/* Filters (desktop) */}
          {!isInitialTradeLoading && (
            <div className="hidden md:block">
              <Suspense fallback={<div className="h-24 rounded-lg border border-border bg-card" />}>
                <FilterPanel
                  allRecords={allRecordsForFilter}
                  filters={filters}
                  onFilterChange={handleFilterChange}
                  onClearAll={handleClearAll}
                  activeCount={activeFilterCount}
                  showIncompleteOnly={showIncompleteOnly}
                  onToggleIncomplete={setShowIncompleteOnly}
                  filterOptions={filterOptions}
                />
              </Suspense>
            </div>
          )}

          {/* Active filter chips (mobile) */}
          {activeFilterCount > 0 && (
            <div className="flex md:hidden flex-wrap gap-2 items-center">
              <span className="text-xs text-muted-foreground">フィルター中:</span>
              {search && (
                <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full">
                  「{search}」
                  <button onClick={clearSearch}><X size={10} /></button>
                </span>
              )}
              {Object.entries(filters).map(([k, v]) =>
                v && v !== "__all__" ? (
                  <span key={k} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full">
                    {k === "monthFrom" ? `${v}月〜` : k === "monthTo" ? `〜${v}月` : v}
                    <button onClick={() => handleFilterChange(k as FilterableKey, "__all__")}><X size={10} /></button>
                  </span>
                ) : null
              )}
            </div>
          )}

          {/* Data Table */}
          {isInitialTradeLoading ? (
            <PanelLoading />
          ) : (
            <Suspense fallback={<PanelLoading />}>
              <DataTable
                records={filteredRecords}
                totalRecords={totalTradeRecords}
                page={tradePage}
                pageSize={tradePageSize}
                sortKey={tradeSortKey}
                sortDir={tradeSortDir}
                onPageChange={setTradePage}
                onPageSizeChange={setTradePageSize}
                onSortChange={(key, dir) => {
                  setTradeSortKey(key);
                  setTradeSortDir(dir);
                }}
                onRecordUpdated={() => refetch()}
              />
            </Suspense>
          )}

          {/* Charts */}
          {shouldLoadTradeCharts && (
            chartRecords ? (
              <Suspense fallback={<PanelLoading />}>
                <ChartSection records={chartRecords} />
              </Suspense>
            ) : <PanelLoading />
          )}

          {/* Footer */}
          <div className="text-center text-xs text-muted-foreground py-4 border-t border-border">
            データソース: DB（{totalTradeRecords.toLocaleString()} 件表示中）
          </div>
        </main>
      )}
    </div>
  );
}
