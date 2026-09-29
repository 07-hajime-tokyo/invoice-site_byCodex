import type { CsvProductCandidate } from "@shared/productMatching";
import { extractManagementHints, extractModel, extractPreferredModel, isInvoice407AnimalCrossingWhiteBaseMatch, suggestCsvProduct } from "@shared/productMatching";
import { hasAnyProductText } from "./productText";
import { unique } from "./stringValues";

export function suggestAnimalCrossingInvoiceProduct(
  title: string,
  managementNo: string,
  candidates: CsvProductCandidate[],
): string | null {
  const text = `${title} ${managementNo}`;
  if (!hasAnyProductText(text, ["どうぶつの森", "animal crossing"])) return null;

  const animalCrossingCandidates = candidates.filter((candidate) =>
    hasAnyProductText(candidate.name, ["どうぶつの森", "animal crossing"]),
  );
  if (animalCrossingCandidates.length === 0) return null;

  const model = extractPreferredModel(title, managementNo);
  if (model) {
    const sameModelCandidates = animalCrossingCandidates.filter((candidate) => extractModel(candidate.name) === model);
    if (sameModelCandidates.length === 1) return sameModelCandidates[0].name;
  }

  return animalCrossingCandidates.length === 1 ? animalCrossingCandidates[0].name : null;
}

export function suggestInvoice407WhiteBaseProduct(
  title: string,
  managementNo: string,
  candidates: CsvProductCandidate[],
): string | null {
  const text = `${title} ${managementNo}`;
  const match = candidates.find((candidate) =>
    isInvoice407AnimalCrossingWhiteBaseMatch(text, candidate.name),
  );
  return match?.name ?? null;
}

export function suggestInvoiceProductName(
  title: string,
  managementNo: string,
  candidates: CsvProductCandidate[],
): string | null {
  const animalCrossingSuggestion = suggestAnimalCrossingInvoiceProduct(title, managementNo, candidates);
  if (animalCrossingSuggestion) return animalCrossingSuggestion;

  const invoice407WhiteBaseSuggestion = suggestInvoice407WhiteBaseProduct(title, managementNo, candidates);
  if (invoice407WhiteBaseSuggestion) return invoice407WhiteBaseSuggestion;

  const suggestion = suggestCsvProduct(title, managementNo, candidates);
  if (suggestion) return suggestion.name;

  const model = extractPreferredModel(title, managementNo);
  if (!model) return null;

  const sameModelCandidates = candidates.filter((candidate) => extractModel(candidate.name) === model);
  return sameModelCandidates.length === 1 ? sameModelCandidates[0].name : null;
}

export function suggestInvoiceProductNameFromHints(
  title: string,
  managementHints: Array<string | null | undefined>,
  candidates: CsvProductCandidate[],
): string | null {
  const managementText = unique(extractManagementHints(...managementHints)).join(" ");
  const titleText = String(title ?? "").trim();

  return (
    (managementText ? suggestInvoiceProductName("", managementText, candidates) : null) ??
    (titleText ? suggestInvoiceProductName(titleText, managementText, candidates) : null)
  );
}
