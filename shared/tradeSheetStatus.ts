import { normalizeLooseText, suggestCsvProduct } from "./productMatching";
import { isTradeStatusComplete } from "./tradeStatus";

export type SourceTradeSheetStatusEntry = {
  invoiceNo: string;
  productName: string;
  quantity: number;
  status: string;
};

export type TradeShipmentProgressEntry = {
  invoiceNo: string;
  productNameJa: string;
  productNameEn: string;
  orderedQty: number;
  shippedQty: number;
};

type TradeStatusTargetRow = {
  no: number | null;
  productName: string | null;
  status: string | null;
};

type ApplySourceTradeSheetStatusOptions = {
  completeOnly?: boolean;
};

function parseTradeSheetQuantity(value: unknown) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;
  const number = Number(text.replace(/[^\d.-]/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function shipmentEntryNames(entry: TradeShipmentProgressEntry) {
  return [entry.productNameJa, entry.productNameEn]
    .map((name) => name.trim())
    .filter(Boolean);
}

function exactProductNameMatch(a: string, b: string) {
  return normalizeLooseText(a) === normalizeLooseText(b);
}

export function parseSourceTradeStatusSheetRows(
  values: unknown[][],
  dataStartIndex = 3,
): Map<string, SourceTradeSheetStatusEntry[]> {
  const statusByInvoice = new Map<string, SourceTradeSheetStatusEntry[]>();
  let currentInvoiceNo = "";

  for (let rowIndex = dataStartIndex; rowIndex < values.length; rowIndex++) {
    const row = values[rowIndex] ?? [];
    const rawInvoiceNo = String(row[0] ?? "").trim();
    if (/^\d+$/.test(rawInvoiceNo)) {
      currentInvoiceNo = rawInvoiceNo;
    } else if (rawInvoiceNo) {
      currentInvoiceNo = "";
    }
    if (!currentInvoiceNo) continue;

    const productName = String(row[2] ?? "").trim();
    const quantity = parseTradeSheetQuantity(row[3]);
    const status = String(row[7] ?? "").trim();
    if (!productName && quantity <= 0 && !status) continue;

    const entries = statusByInvoice.get(currentInvoiceNo) ?? [];
    entries.push({ invoiceNo: currentInvoiceNo, productName, quantity, status });
    statusByInvoice.set(currentInvoiceNo, entries);
  }

  return statusByInvoice;
}

export function parseShipmentProgressSheetRows(
  valueRanges: Array<unknown[][] | undefined>,
): Map<string, TradeShipmentProgressEntry[]> {
  const progressByInvoice = new Map<string, TradeShipmentProgressEntry[]>();

  for (const values of valueRanges) {
    let currentInvoiceNo = "";
    for (const row of values ?? []) {
      const rawInvoiceNo = String(row?.[0] ?? "").trim();
      if (/^\d+$/.test(rawInvoiceNo)) {
        currentInvoiceNo = rawInvoiceNo;
      } else if (rawInvoiceNo) {
        currentInvoiceNo = "";
      }

      const invoiceNo = currentInvoiceNo;
      if (!invoiceNo) continue;

      const orderedQty = parseTradeSheetQuantity(row?.[4]);
      const shippedQty = parseTradeSheetQuantity(row?.[5]);
      if (orderedQty <= 0 && shippedQty <= 0) continue;

      const entries = progressByInvoice.get(invoiceNo) ?? [];
      entries.push({
        invoiceNo,
        productNameJa: String(row?.[2] ?? "").trim(),
        productNameEn: String(row?.[3] ?? "").trim(),
        orderedQty,
        shippedQty,
      });
      progressByInvoice.set(invoiceNo, entries);
    }
  }

  return progressByInvoice;
}

export function summarizeShipmentProgress(
  entries: TradeShipmentProgressEntry[] | undefined,
  fallbackOrderedQty = 0,
) {
  const orderedQty = entries?.reduce((sum, entry) => sum + entry.orderedQty, 0) ?? 0;
  const shippedQty = entries?.reduce((sum, entry) => sum + entry.shippedQty, 0) ?? 0;
  return {
    orderedQty: orderedQty || fallbackOrderedQty,
    shippedQty,
  };
}

export function resolveShipmentProgressProductName(
  entry: TradeShipmentProgressEntry,
  candidates: Array<{ name: string; qty: number }>,
): string | null {
  const names = shipmentEntryNames(entry);
  if (names.length === 0 || candidates.length === 0) return null;

  const exact = candidates.find((candidate) =>
    names.some((name) => exactProductNameMatch(name, candidate.name))
  );
  if (exact) return exact.name;

  const managementText = names.join(" ");
  for (const name of names) {
    const suggestion = suggestCsvProduct(name, managementText, candidates);
    if (suggestion) return suggestion.name;
  }

  return null;
}

export function buildShipmentProgressProductTotals(
  candidates: Array<{ name: string; qty: number }>,
  entries: TradeShipmentProgressEntry[] | undefined,
) {
  const totals = new Map<string, { orderedQty: number; shippedQty: number }>();
  if (!entries?.length || candidates.length === 0) return totals;

  entries.forEach((entry, index) => {
    const productName = resolveShipmentProgressProductName(entry, candidates) ??
      (shipmentEntryNames(entry).length === 0 ? candidates[index]?.name : null);
    if (!productName) return;

    const current = totals.get(productName) ?? { orderedQty: 0, shippedQty: 0 };
    current.orderedQty += entry.orderedQty;
    current.shippedQty += entry.shippedQty;
    totals.set(productName, current);
  });

  return totals;
}

export function allocateShipmentProgressToProducts<T extends { productName: string; orderQty: number }>(
  rows: T[],
  entries: TradeShipmentProgressEntry[] | undefined,
) {
  const candidates = rows.map((row) => ({ name: row.productName, qty: row.orderQty }));
  const totals = buildShipmentProgressProductTotals(candidates, entries);
  const remainingByProduct = new Map(
    Array.from(totals.entries()).map(([name, total]) => [name, total.shippedQty]),
  );

  const totalRowsByKey = new Map<string, number>();
  for (const row of rows) {
    const key = normalizeLooseText(row.productName);
    totalRowsByKey.set(key, (totalRowsByKey.get(key) ?? 0) + 1);
  }
  const seenRowsByKey = new Map<string, number>();

  return rows.map((row) => {
    const productName = row.productName;
    const key = normalizeLooseText(productName);
    const seen = (seenRowsByKey.get(key) ?? 0) + 1;
    seenRowsByKey.set(key, seen);

    const remaining = remainingByProduct.get(productName) ?? 0;
    const totalSameProductRows = totalRowsByKey.get(key) ?? 1;
    const isLastSameProductRow = seen >= totalSameProductRows;
    const shippedQty = totalSameProductRows > 1 && !isLastSameProductRow
      ? Math.min(row.orderQty, remaining)
      : remaining;
    if (remaining > 0) {
      remainingByProduct.set(productName, Math.max(0, remaining - shippedQty));
    }

    return { row, shippedQty };
  });
}

function getSourceTradeSheetStatus(
  row: TradeStatusTargetRow,
  entries: SourceTradeSheetStatusEntry[] | undefined,
  invoiceOccurrenceIndex: number,
  productOccurrenceIndex: number,
) {
  if (!entries?.length) return null;

  const productName = String(row.productName ?? "").trim();
  const productKey = normalizeLooseText(productName);
  const exactMatches = productKey
    ? entries.filter((entry) => normalizeLooseText(entry.productName) === productKey)
    : [];
  if (exactMatches.length > 0) {
    return exactMatches[productOccurrenceIndex]?.status ?? exactMatches[0].status;
  }

  const suggestion = productName
    ? suggestCsvProduct(
        productName,
        productName,
        entries
          .filter((entry) => entry.productName)
          .map((entry) => ({ name: entry.productName, qty: entry.quantity })),
      )
    : null;
  if (suggestion) {
    const suggestionKey = normalizeLooseText(suggestion.name);
    const suggestedMatches = entries.filter((entry) => normalizeLooseText(entry.productName) === suggestionKey);
    if (suggestedMatches.length > 0) {
      return suggestedMatches[productOccurrenceIndex]?.status ?? suggestedMatches[0].status;
    }
  }

  return entries[invoiceOccurrenceIndex]?.status ?? null;
}

export function applySourceTradeSheetStatuses<T extends TradeStatusTargetRow>(
  rows: T[],
  statusByInvoice: Map<string, SourceTradeSheetStatusEntry[]>,
  options: ApplySourceTradeSheetStatusOptions = {},
): T[] {
  if (statusByInvoice.size === 0) return rows;

  const invoiceOccurrences = new Map<string, number>();
  const productOccurrences = new Map<string, number>();

  return rows.map((row): T => {
    if (row.no == null) return row;
    const invoiceNo = String(row.no);
    const invoiceOccurrenceIndex = invoiceOccurrences.get(invoiceNo) ?? 0;
    invoiceOccurrences.set(invoiceNo, invoiceOccurrenceIndex + 1);

    const productKey = `${invoiceNo}:${normalizeLooseText(String(row.productName ?? ""))}`;
    const productOccurrenceIndex = productOccurrences.get(productKey) ?? 0;
    productOccurrences.set(productKey, productOccurrenceIndex + 1);

    const status = getSourceTradeSheetStatus(
      row,
      statusByInvoice.get(invoiceNo),
      invoiceOccurrenceIndex,
      productOccurrenceIndex,
    );
    if (status === null || !status) return row;
    if (options.completeOnly && !isTradeStatusComplete(status)) return row;
    return status === (row.status ?? "") ? row : { ...row, status };
  });
}
