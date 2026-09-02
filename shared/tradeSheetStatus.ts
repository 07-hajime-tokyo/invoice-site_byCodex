import { normalizeLooseText, suggestCsvProduct } from "./productMatching";
import { isTradeStatusComplete } from "./tradeStatus";

export type SourceTradeSheetStatusEntry = {
  invoiceNo: string;
  productName: string;
  quantity: number;
  status: string;
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
