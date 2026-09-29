import {
  isInboundActivePurchase,
  isPurchaseInboundComplete,
} from "@shared/purchaseVisibility";
import { useState, useMemo, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { type InboundClass } from "@shared/inboundPipeline";
import { PAGE_SIZE } from "@/inventory/hooks/usePagination";
import { type Purchase, type InboundTabCounts } from "./types";
import { countInboundTabsForClient } from "./filters";
import { type usePurchaseFilters } from "./usePurchaseFilters";
import { type usePurchaseEditorState } from "./usePurchaseEditorState";

export function usePurchaseListData({
  purchasePage,
  selectedCategory,
  selectedStatusFilter,
  debouncedSearchQuery,
  showCompletedPurchases,
  selectedInboundTab,
  editingId,
  utils,
}: {
  purchasePage: ReturnType<typeof usePurchaseFilters>["purchasePage"];
  selectedCategory: ReturnType<typeof usePurchaseFilters>["selectedCategory"];
  selectedStatusFilter: ReturnType<
    typeof usePurchaseFilters
  >["selectedStatusFilter"];
  debouncedSearchQuery: ReturnType<
    typeof usePurchaseFilters
  >["debouncedSearchQuery"];
  showCompletedPurchases: ReturnType<
    typeof usePurchaseFilters
  >["showCompletedPurchases"];
  selectedInboundTab: ReturnType<
    typeof usePurchaseFilters
  >["selectedInboundTab"];
  editingId: ReturnType<typeof usePurchaseEditorState>["editingId"];
  utils: ReturnType<typeof trpc.useUtils>;
}) {
  const { data: managedCategories } =
    trpc.inventory.zaico.getCategories.useQuery();
  const purchaseQueryInput = useMemo(
    () => ({
      page: purchasePage,
      pageSize: PAGE_SIZE,
      category: selectedCategory === "すべて" ? null : selectedCategory,
      status: selectedStatusFilter as "ordered" | "shipped" | null,
      search: debouncedSearchQuery || null,
      showCompleted: showCompletedPurchases,
      // T22: 分類タブ。"all"は全件のため未指定(null)にする
      inboundClass: (selectedInboundTab === "all"
        ? null
        : selectedInboundTab) as InboundClass | "unclassified" | null,
    }),
    [
      debouncedSearchQuery,
      purchasePage,
      selectedCategory,
      selectedStatusFilter,
      selectedInboundTab,
      showCompletedPurchases,
    ]
  );
  const {
    data: purchasePageData,
    isLoading,
    isFetching,
    refetch,
  } = trpc.inventory.zaico.getPurchasesWithCategoryPage.useQuery(
    purchaseQueryInput,
    {
      staleTime: 5_000,
      refetchInterval: editingId === null ? 5_000 : false,
      refetchIntervalInBackground: false,
      refetchOnWindowFocus: "always",
    }
  );
  const purchases = useMemo(
    () =>
      ((purchasePageData?.items ?? []) as Purchase[]).filter(
        isInboundActivePurchase
      ),
    [purchasePageData?.items]
  );
  const categoryTotals = useMemo(() => {
    return new Map(
      (purchasePageData?.categoryTotals ?? []).map(row => [
        row.category,
        row.total,
      ])
    );
  }, [purchasePageData?.categoryTotals]);
  const categoryCountMap = useMemo(() => {
    return new Map(
      (purchasePageData?.categoryTotals ?? []).map(row => [
        row.category,
        row.count,
      ])
    );
  }, [purchasePageData?.categoryTotals]);
  const grandTotal = purchasePageData?.grandTotal ?? 0;
  const categoryOptions = useMemo(() => {
    const cats = new Set<string>();
    if (selectedCategory !== "すべて" && selectedCategory !== "未分類")
      cats.add(selectedCategory);
    for (const cat of managedCategories ?? []) {
      if (cat && cat !== "すべて" && cat !== "未分類") cats.add(cat);
    }
    for (const row of purchasePageData?.categoryTotals ?? []) {
      const cat = row.category.trim();
      if (cat && cat !== "未分類") cats.add(cat);
    }
    return Array.from(cats).sort((a, b) => a.localeCompare(b, "ja"));
  }, [managedCategories, purchasePageData?.categoryTotals, selectedCategory]);
  const categories = useMemo(
    () => ["すべて", "未分類", ...categoryOptions],
    [categoryOptions]
  );
  const completedPurchaseCount = useMemo(
    () => purchases.filter(isPurchaseInboundComplete).length,
    [purchases]
  );
  const filteredPurchases = useMemo(
    () =>
      showCompletedPurchases
        ? purchases
        : purchases.filter(purchase => !isPurchaseInboundComplete(purchase)),
    [purchases, showCompletedPurchases]
  );
  const pagedPurchases = filteredPurchases;
  const rawInboundTabCounts = (
    purchasePageData as { tabCounts?: InboundTabCounts } | undefined
  )?.tabCounts;
  const rawInboundTabCountsSignature = useMemo(
    () => JSON.stringify(rawInboundTabCounts ?? {}),
    [rawInboundTabCounts]
  );
  const purchaseAllCountForTabCounts = purchasePageData?.allCount ?? null;
  const [cutoffInboundTabCounts, setCutoffInboundTabCounts] =
    useState<InboundTabCounts | null>(null);
  useEffect(() => {
    if (purchaseAllCountForTabCounts == null) return;
    let cancelled = false;

    async function loadCutoffInboundTabCounts() {
      try {
        const firstPage =
          await utils.inventory.zaico.getPurchasesWithCategoryPage.fetch({
            page: 1,
            pageSize: 100,
            inboundClass: null,
          });
        const allPurchases = [...((firstPage.items ?? []) as Purchase[])];
        const remainingPages = [];
        for (let page = 2; page <= firstPage.totalPages; page++) {
          remainingPages.push(
            utils.inventory.zaico.getPurchasesWithCategoryPage.fetch({
              page,
              pageSize: 100,
              inboundClass: null,
            })
          );
        }
        const restPages = await Promise.all(remainingPages);
        for (const pageData of restPages) {
          allPurchases.push(...((pageData.items ?? []) as Purchase[]));
        }
        if (!cancelled) {
          setCutoffInboundTabCounts(countInboundTabsForClient(allPurchases));
        }
      } catch {
        if (!cancelled) setCutoffInboundTabCounts(null);
      }
    }

    void loadCutoffInboundTabCounts();
    return () => {
      cancelled = true;
    };
  }, [purchaseAllCountForTabCounts, rawInboundTabCountsSignature, utils]);
  const inboundTabCounts = cutoffInboundTabCounts ?? rawInboundTabCounts;
  const displayedPurchasePage = purchasePageData?.page ?? purchasePage;
  const purchaseTotalItems =
    purchasePageData?.totalCount ?? filteredPurchases.length;
  const purchaseTotalPages =
    purchasePageData?.totalPages ??
    Math.max(1, Math.ceil(purchaseTotalItems / PAGE_SIZE));
  const purchaseStartIndex =
    purchaseTotalItems === 0 ? 0 : (displayedPurchasePage - 1) * PAGE_SIZE + 1;
  const purchaseEndIndex = Math.min(
    displayedPurchasePage * PAGE_SIZE,
    purchaseTotalItems
  );
  return {
    purchasePageData,
    isLoading,
    isFetching,
    refetch,
    categoryTotals,
    categoryCountMap,
    grandTotal,
    categoryOptions,
    categories,
    completedPurchaseCount,
    filteredPurchases,
    pagedPurchases,
    inboundTabCounts,
    displayedPurchasePage,
    purchaseTotalItems,
    purchaseTotalPages,
    purchaseStartIndex,
    purchaseEndIndex,
  };
}
