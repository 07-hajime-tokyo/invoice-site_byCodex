import { TrendingUp } from "lucide-react";
import { type PurchasePageModel } from "./usePurchasesPage";

export function PurchaseTotals({
  showTotals,
  grandTotal,
  categoryTotals,
  selectedCategory,
  handleSetSelectedCategory,
}: Pick<
  PurchasePageModel,
  | "showTotals"
  | "grandTotal"
  | "categoryTotals"
  | "selectedCategory"
  | "handleSetSelectedCategory"
>) {
  return (
    <>
      {showTotals && grandTotal > 0 && (
        <div className="hidden md:block rounded-lg border bg-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium text-foreground">
              入庫予定 合計金額
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {Array.from(categoryTotals.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([cat, total]) => {
                const isActive = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    onClick={() =>
                      handleSetSelectedCategory(isActive ? "すべて" : cat)
                    }
                    className={`rounded-md px-3 py-2 text-left transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground ring-2 ring-primary"
                        : "bg-muted/30 hover:bg-muted/60"
                    }`}
                  >
                    <p
                      className={`text-xs truncate ${isActive ? "text-primary-foreground/80" : "text-muted-foreground"}`}
                    >
                      {cat}
                    </p>
                    <p
                      className={`text-sm font-semibold ${isActive ? "text-primary-foreground" : "text-foreground"}`}
                    >
                      ¥{total.toLocaleString()}
                    </p>
                  </button>
                );
              })}
          </div>
          <div className="mt-3 pt-3 border-t flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              全カテゴリ合計
            </span>
            <span className="text-lg font-bold text-primary">
              ¥{grandTotal.toLocaleString()}
            </span>
          </div>
        </div>
      )}
      {grandTotal > 0 && (
        <div className="md:hidden flex items-center justify-between px-3 py-2 rounded-lg bg-muted/30 border">
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs text-muted-foreground">入庫予定合計</span>
          </div>
          <span className="text-sm font-bold text-primary">
            ¥{grandTotal.toLocaleString()}
          </span>
        </div>
      )}
    </>
  );
}
