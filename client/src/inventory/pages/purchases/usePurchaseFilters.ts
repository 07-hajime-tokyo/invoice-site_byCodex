import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { INBOUND_CLASS_ORDER } from "@shared/inboundPipeline";
import {
  PURCHASE_STATUS_FILTER_KEY,
  LEGACY_PURCHASE_STATUS_FILTER_KEY,
  PURCHASE_INBOUND_TAB_KEY,
} from "./constants";
import { useDebouncedValue } from "./useDebouncedValue";

export function usePurchaseFilters() {
  const [location, setLocation] = useLocation();
  const [purchasePage, setPurchasePage] = useState(1);
  const [selectedCategory, setSelectedCategory] = useState<string>(() => {
    return typeof window !== "undefined"
      ? (localStorage.getItem("purchases-selectedCategory") ?? "すべて")
      : "すべて";
  });
  const handleSetSelectedCategory = useCallback((cat: string) => {
    setPurchasePage(1);
    setSelectedCategory(cat);
    localStorage.setItem("purchases-selectedCategory", cat);
  }, []);
  const [selectedInboundTab, setSelectedInboundTab] = useState<string>(() => {
    if (typeof window === "undefined") return "unclassified";
    const stored = localStorage.getItem(PURCHASE_INBOUND_TAB_KEY);
    const valid = ["all", "unclassified", ...INBOUND_CLASS_ORDER];
    return stored && valid.includes(stored) ? stored : "unclassified";
  });
  const handleSetInboundTab = useCallback((tab: string) => {
    setPurchasePage(1);
    setSelectedInboundTab(tab);
    if (typeof window !== "undefined")
      localStorage.setItem(PURCHASE_INBOUND_TAB_KEY, tab);
  }, []);
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<
    string | null
  >(() => {
    if (typeof window === "undefined") return null;
    localStorage.removeItem(LEGACY_PURCHASE_STATUS_FILTER_KEY);
    const stored = localStorage.getItem(PURCHASE_STATUS_FILTER_KEY);
    return stored === "ordered" || stored === "shipped" ? stored : null;
  });
  const [showCompletedPurchases, setShowCompletedPurchases] = useState(false);
  const handleSetStatusFilter = useCallback((status: string | null) => {
    setSelectedStatusFilter(prev => {
      const next = prev === status ? null : status;
      if (next === null) {
        localStorage.removeItem(PURCHASE_STATUS_FILTER_KEY);
      } else {
        localStorage.setItem(PURCHASE_STATUS_FILTER_KEY, next);
      }
      setPurchasePage(1);
      return next;
    });
  }, []);
  const urlSearchQuery = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  }, [location]);
  const [searchQuery, setSearchQuery] = useState(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("q") ?? "";
  });
  useEffect(() => {
    if (!urlSearchQuery || urlSearchQuery === searchQuery) return;
    setPurchasePage(1);
    setSearchQuery(urlSearchQuery);
  }, [searchQuery, setPurchasePage, urlSearchQuery]);
  const debouncedSearchQuery = useDebouncedValue(searchQuery.trim(), 250);
  return {
    setLocation,
    purchasePage,
    setPurchasePage,
    selectedCategory,
    handleSetSelectedCategory,
    selectedInboundTab,
    handleSetInboundTab,
    selectedStatusFilter,
    setSelectedStatusFilter,
    showCompletedPurchases,
    setShowCompletedPurchases,
    handleSetStatusFilter,
    searchQuery,
    setSearchQuery,
    debouncedSearchQuery,
  };
}
