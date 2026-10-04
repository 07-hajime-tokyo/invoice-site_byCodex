import { useState, useMemo, useEffect } from "react";
import { type Purchase } from "./types";
import { type usePurchaseFilters } from "./usePurchaseFilters";
import { type usePurchaseListData } from "./usePurchaseListData";

export function usePurchaseSelection({
  debouncedSearchQuery,
  purchasePage,
  selectedCategory,
  selectedInboundTab,
  selectedStatusFilter,
  showCompletedPurchases,
  filteredPurchases,
}: {
  debouncedSearchQuery: ReturnType<
    typeof usePurchaseFilters
  >["debouncedSearchQuery"];
  purchasePage: ReturnType<typeof usePurchaseFilters>["purchasePage"];
  selectedCategory: ReturnType<typeof usePurchaseFilters>["selectedCategory"];
  selectedInboundTab: ReturnType<
    typeof usePurchaseFilters
  >["selectedInboundTab"];
  selectedStatusFilter: ReturnType<
    typeof usePurchaseFilters
  >["selectedStatusFilter"];
  showCompletedPurchases: ReturnType<
    typeof usePurchaseFilters
  >["showCompletedPurchases"];
  filteredPurchases: ReturnType<
    typeof usePurchaseListData
  >["filteredPurchases"];
}) {
  const [checkedPurchaseIds, setCheckedPurchaseIds] = useState<Set<number>>(
    new Set()
  );
  useEffect(() => {
    setCheckedPurchaseIds(new Set());
  }, [
    debouncedSearchQuery,
    purchasePage,
    selectedCategory,
    selectedInboundTab,
    selectedStatusFilter,
    showCompletedPurchases,
  ]);
  const checkedPurchases = useMemo(
    () =>
      (filteredPurchases as Purchase[]).filter(p =>
        checkedPurchaseIds.has(p.id)
      ),
    [filteredPurchases, checkedPurchaseIds]
  );
  function togglePurchaseCheck(purchaseId: number) {
    setCheckedPurchaseIds(prev => {
      const next = new Set(prev);
      if (next.has(purchaseId)) next.delete(purchaseId);
      else next.add(purchaseId);
      return next;
    });
  }
  return {
    checkedPurchaseIds,
    setCheckedPurchaseIds,
    checkedPurchases,
    togglePurchaseCheck,
  };
}
