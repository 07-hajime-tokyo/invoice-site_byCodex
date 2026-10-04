import { Badge } from "@/components/ui/badge";
import { Check, X } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  INBOUND_CLASS_ORDER,
  INBOUND_CLASS_LABEL,
  UNCLASSIFIED_LABEL,
} from "@shared/inboundPipeline";
import { type PurchasePageModel } from "./usePurchasesPage";

export function PurchaseFilters({
  categories,
  selectedCategory,
  handleSetSelectedCategory,
  purchasePageData,
  categoryCountMap,
  handleSetStatusFilter,
  selectedStatusFilter,
  showCompletedPurchases,
  setPurchasePage,
  setShowCompletedPurchases,
  completedPurchaseCount,
  selectedInboundTab,
  handleSetInboundTab,
  inboundTabCounts,
}: Pick<
  PurchasePageModel,
  | "categories"
  | "selectedCategory"
  | "handleSetSelectedCategory"
  | "purchasePageData"
  | "categoryCountMap"
  | "handleSetStatusFilter"
  | "selectedStatusFilter"
  | "showCompletedPurchases"
  | "setPurchasePage"
  | "setShowCompletedPurchases"
  | "completedPurchaseCount"
  | "selectedInboundTab"
  | "handleSetInboundTab"
  | "inboundTabCounts"
>) {
  return (
    <>
      {categories.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          <Select
            value={selectedCategory}
            onValueChange={handleSetSelectedCategory}
          >
            <SelectTrigger className="w-56">
              <SelectValue placeholder="カテゴリーを選択" />
            </SelectTrigger>
            <SelectContent>
              {categories.map(cat => {
                const count =
                  cat === "すべて"
                    ? (purchasePageData?.allCount ?? 0)
                    : (categoryCountMap.get(cat) ?? 0);
                return (
                  <SelectItem key={cat} value={cat}>
                    {cat} ({count})
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {selectedCategory !== "すべて" && (
            <button
              onClick={() => handleSetSelectedCategory("すべて")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <X className="h-3.5 w-3.5" />
              解除
            </button>
          )}
          {/* ステータスフィルターボタン */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => handleSetStatusFilter("ordered")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                selectedStatusFilter === "ordered"
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800"
              }`}
            >
              発注済み
              {selectedStatusFilter === "ordered" && (
                <span className="ml-1 opacity-70">×</span>
              )}
            </button>
            <button
              onClick={() => handleSetStatusFilter("shipped")}
              className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                selectedStatusFilter === "shipped"
                  ? "bg-orange-600 text-white border-orange-600"
                  : "bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800"
              }`}
            >
              発送済み / 入庫待ち
              {selectedStatusFilter === "shipped" && (
                <span className="ml-1 opacity-70">×</span>
              )}
            </button>
            <button
              type="button"
              aria-pressed={showCompletedPurchases}
              onClick={() => {
                setPurchasePage(1);
                setShowCompletedPurchases(shown => !shown);
              }}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                showCompletedPurchases
                  ? "bg-muted text-foreground border-border"
                  : "bg-background text-muted-foreground border-border hover:bg-muted/50"
              }`}
            >
              <Check
                className={`h-3.5 w-3.5 ${showCompletedPurchases ? "opacity-100" : "opacity-30"}`}
              />
              完了も表示
              {completedPurchaseCount > 0 && (
                <span className="opacity-70">({completedPurchaseCount})</span>
              )}
            </button>
          </div>
        </div>
      )}
      <Tabs value={selectedInboundTab} onValueChange={handleSetInboundTab}>
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="unclassified" className="text-xs">
            {UNCLASSIFIED_LABEL}
            {inboundTabCounts && inboundTabCounts.unclassified > 0 && (
              <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] bg-red-500 text-white">
                {inboundTabCounts.unclassified}
              </Badge>
            )}
          </TabsTrigger>
          {INBOUND_CLASS_ORDER.map(cls => (
            <TabsTrigger key={cls} value={cls} className="text-xs">
              {INBOUND_CLASS_LABEL[cls]}
              {inboundTabCounts && inboundTabCounts[cls] > 0 && (
                <Badge className="ml-1 h-4 min-w-4 px-1 text-[10px] bg-muted-foreground/70 text-white">
                  {inboundTabCounts[cls]}
                </Badge>
              )}
            </TabsTrigger>
          ))}
          <TabsTrigger value="all" className="text-xs">
            すべて
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </>
  );
}
