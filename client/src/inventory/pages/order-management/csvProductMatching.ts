import { extractModel, suggestCsvProduct } from "@shared/productMatching";
import { extractColorFromCsvName, extractModelFromCsvName } from "./colorMatching";
import type { CsvProductCandidate, CsvProductSummary, DeliveryItem, SummaryItem } from "./types";

export function csvProductGroupKey(csvProductName: string): string {
  const colorOnly = extractColorFromCsvName(csvProductName);
  const model = extractModelFromCsvName(csvProductName);
  return model ? [model, colorOnly].filter(Boolean).join(" ") : colorOnly;
}

export function suggestCsvProductNameWithFallback(
  title: string,
  managementNo: string,
  candidates: CsvProductCandidate[],
): string | null {
  const suggestion = suggestCsvProduct(title, managementNo, candidates);
  if (suggestion) return suggestion.name;

  const model = extractModel(`${title} ${managementNo}`);
  if (!model) return null;

  const sameModelCandidates = candidates.filter((candidate) => extractModel(candidate.name) === model);
  return sameModelCandidates.length === 1 ? sameModelCandidates[0].name : null;
}

export function findDeliveryCsvProduct(item: SummaryItem, delivery: DeliveryItem): CsvProductSummary | null {
  if (delivery.csvProductName) {
    const exact = item.csvProducts.find((product) => product.name === delivery.csvProductName);
    if (exact) return exact;
  }

  const candidates = item.csvProducts.map((product) => ({ name: product.name, qty: product.qty }));
  const fromStoredName = delivery.csvProductName
    ? suggestCsvProductNameWithFallback(delivery.csvProductName, delivery.managementNo ?? "", candidates)
    : null;
  const fromTitle = suggestCsvProductNameWithFallback(delivery.title, delivery.managementNo ?? "", candidates);
  const suggestionName = fromStoredName ?? fromTitle;
  if (!suggestionName) return null;
  return item.csvProducts.find((product) => product.name === suggestionName) ?? null;
}

export function findCsvProductByTitleAndManagement(
  item: SummaryItem,
  title: string,
  managementNo?: string | null,
): CsvProductSummary | null {
  const candidates = item.csvProducts.map((product) => ({ name: product.name, qty: product.qty }));
  const suggestionName = suggestCsvProductNameWithFallback(title, managementNo ?? "", candidates);
  if (!suggestionName) return null;
  return item.csvProducts.find((product) => product.name === suggestionName) ?? null;
}
