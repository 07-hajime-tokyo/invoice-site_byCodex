import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { type Purchase } from "./types";
import { filterPurchasesForView } from "./filters";
import { exportPurchasesCSV } from "./csv";
import { type usePurchaseFilters } from "./usePurchaseFilters";

export function usePurchaseCsv({
  utils,
  selectedCategory,
  selectedStatusFilter,
  debouncedSearchQuery,
  searchQuery,
}: {
  utils: ReturnType<typeof trpc.useUtils>;
  selectedCategory: ReturnType<typeof usePurchaseFilters>["selectedCategory"];
  selectedStatusFilter: ReturnType<
    typeof usePurchaseFilters
  >["selectedStatusFilter"];
  debouncedSearchQuery: ReturnType<
    typeof usePurchaseFilters
  >["debouncedSearchQuery"];
  searchQuery: ReturnType<typeof usePurchaseFilters>["searchQuery"];
}) {
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  async function handleExportPurchasesCSV() {
    if (isExportingCsv) return;
    setIsExportingCsv(true);
    try {
      const allPurchases =
        await utils.inventory.zaico.getPurchasesWithCategory.fetch();
      const rows = filterPurchasesForView(
        allPurchases as unknown as Purchase[],
        selectedCategory,
        selectedStatusFilter,
        debouncedSearchQuery || searchQuery
      );
      exportPurchasesCSV(rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "CSV出力に失敗しました";
      toast.error(msg);
    } finally {
      setIsExportingCsv(false);
    }
  }
  return { isExportingCsv, handleExportPurchasesCSV };
}
