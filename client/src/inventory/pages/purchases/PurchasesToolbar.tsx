import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RefreshCw, X, Loader2, Search, Download, Plus } from "lucide-react";
import { type PurchasePageModel } from "./usePurchasesPage";

export function PurchasesToolbar({
  purchaseTotalItems,
  purchasePageData,
  openOrderedDialog,
  setShowTotals,
  showTotals,
  handleExportPurchasesCSV,
  isExportingCsv,
  refetch,
  isFetching,
  searchQuery,
  setPurchasePage,
  setSearchQuery,
}: Pick<
  PurchasePageModel,
  | "purchaseTotalItems"
  | "purchasePageData"
  | "openOrderedDialog"
  | "setShowTotals"
  | "showTotals"
  | "handleExportPurchasesCSV"
  | "isExportingCsv"
  | "refetch"
  | "isFetching"
  | "searchQuery"
  | "setPurchasePage"
  | "setSearchQuery"
>) {
  return (
    <>
      <div className="-mx-4 px-4 pb-2 pt-1">
        <div className="rounded-xl border bg-card shadow-sm px-4 py-3 space-y-2">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-foreground">入庫管理</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                入庫データ一覧 ({purchaseTotalItems}/
                {purchasePageData?.allCount ?? purchaseTotalItems} 件)
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap justify-end">
              {/* PC用: 発注済み登録ボタン */}
              <Button
                variant="outline"
                size="sm"
                onClick={openOrderedDialog}
                className="hidden md:flex"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                発注済み登録
              </Button>
              <button
                onClick={() => setShowTotals(v => !v)}
                className={`hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors border ${
                  showTotals
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted/50"
                }`}
              >
                <span className="text-xs">
                  {showTotals ? "合計: ON" : "合計: OFF"}
                </span>
              </button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportPurchasesCSV}
                disabled={isExportingCsv}
                className="hidden md:flex"
              >
                {isExportingCsv ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1.5" />
                )}
                CSV
              </Button>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                <RefreshCw
                  className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`}
                />
                <span className="hidden md:inline">更新</span>
              </Button>
              {/* スマホ用: 発注済み登録ボタン */}
              <Button
                variant="outline"
                size="sm"
                onClick={openOrderedDialog}
                className="md:hidden"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>
          {/* 検索バー */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="管理番号・商品名・追跡番号で検索..."
              value={searchQuery}
              onChange={e => {
                setPurchasePage(1);
                setSearchQuery(e.target.value);
              }}
              className="pl-9 h-9 text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setPurchasePage(1);
                  setSearchQuery("");
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
