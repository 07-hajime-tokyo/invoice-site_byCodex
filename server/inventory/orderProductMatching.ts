import {
  suggestCsvProduct,
  extractPreferredModel,
  extractModel,
  productNamesCanMatch,
  extractManagementHints,
  normalizeLooseText,
  isRandomColor,
  extractColor,
} from "@shared/productMatching";

type CsvProductCandidate = { name: string; qty: number };

function suggestCsvProductNameWithFallback(
  title: string,
  managementNo: string,
  candidates: CsvProductCandidate[]
): string | null {
  const suggestion = suggestCsvProduct(title, managementNo, candidates);
  if (suggestion) return suggestion.name;

  const model = extractPreferredModel(title, managementNo);
  if (!model) return null;

  const targetText = `${title} ${managementNo}`;
  const sameModelCandidates = candidates.filter(
    candidate =>
      extractModel(candidate.name) === model &&
      productNamesCanMatch(targetText, candidate.name)
  );
  return sameModelCandidates.length === 1 ? sameModelCandidates[0].name : null;
}

export function suggestCsvProductNameFromHints(
  title: string,
  managementHints: Array<string | null | undefined>,
  candidates: CsvProductCandidate[]
): string | null {
  const managementText = Array.from(
    new Set(extractManagementHints(...managementHints))
  ).join(" ");
  const titleText = String(title ?? "").trim();

  return (
    (managementText
      ? suggestCsvProductNameWithFallback("", managementText, candidates)
      : null) ??
    (titleText
      ? suggestCsvProductNameWithFallback(titleText, managementText, candidates)
      : null)
  );
}

function productNameKey(value: string | null | undefined): string {
  return normalizeLooseText(String(value ?? ""));
}

export function deliveryProductNameMatchesOrderProduct(
  deliveredName: string,
  orderProductName: string,
  candidates: CsvProductCandidate[]
): boolean {
  const delivered = deliveredName.trim();
  const order = orderProductName.trim();
  if (!delivered || !order) return false;
  if (!productNamesCanMatch(delivered, order)) return false;
  if (productNameKey(delivered) === productNameKey(order)) return true;

  const suggestion =
    suggestCsvProductNameWithFallback(delivered, "", candidates) ??
    suggestCsvProductNameFromHints(delivered, [delivered], candidates);
  if (suggestion && productNameKey(suggestion) === productNameKey(order))
    return true;
  const deliveredModel = extractModel(delivered);
  const orderModel = extractModel(order);
  if (!deliveredModel || deliveredModel !== orderModel) return false;
  if (isRandomColor(order) || isRandomColor(extractColor(order))) return true;
  const sameModelCandidates = candidates.filter(
    candidate =>
      extractModel(candidate.name) === orderModel &&
      productNamesCanMatch(delivered, candidate.name)
  );
  return (
    sameModelCandidates.length === 1 &&
    productNameKey(sameModelCandidates[0].name) === productNameKey(order)
  );
}
