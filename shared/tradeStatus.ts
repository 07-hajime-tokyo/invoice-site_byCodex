export function isTradeStatusComplete(status: unknown) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "complete" || normalized === "\u5b8c\u4e86";
}

export function isTradeProcurementMissing(procurementTotal: unknown) {
  const text = String(procurementTotal ?? "")
    .replace(/[,\s￥¥]/g, "")
    .trim();
  if (!text) return true;
  const value = Number(text);
  return !Number.isFinite(value) || value <= 0;
}

export function isTradeIncompleteForList(row: {
  status: unknown;
  procurementTotal?: unknown;
  paymentDate?: string | null;
}) {
  if (isTradeStatusComplete(row.status) && isClosedTradeYear(row.paymentDate)) {
    return false;
  }
  return !isTradeStatusComplete(row.status) || isTradeProcurementMissing(row.procurementTotal);
}

export function isTradeRemainingStatus(status: unknown) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return /^\u6b8b\s*[0-9\uff10-\uff19]/.test(normalized) || /^remaining\s*[0-9]/.test(normalized);
}

export function isClosedTradeYear(paymentDate?: string | null) {
  const text = String(paymentDate ?? "").trim();
  return /^2025[/-]/.test(text);
}

export function formatRemainingQty(value: number) {
  const rounded = Math.max(0, Math.round(value * 100) / 100);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * No.399以下のインボイスは発送登録なしでも完了として扱う。
 * これは出庫登録の仕組みができる前の取引に対する特別ルール。
 */
export function isLegacyCompleteInvoice(invoiceNo: number | null | undefined): boolean {
  const no = Number(invoiceNo ?? 0);
  return Number.isFinite(no) && no > 0 && no <= 399;
}

/**
 * No.400以降のインボイスで発送記録の取得が必要なものかどうか。
 * No.399以下は常にfalse（発送記録不要）。
 */
export function requiresShipmentTracking(invoiceNo: number | null | undefined): boolean {
  const no = Number(invoiceNo ?? 0);
  return Number.isFinite(no) && no > 399;
}

export function deriveTradeShipmentRegistrationStatus(input: {
  status: string | null;
  invoiceNo: number | null;
  paymentDate?: string | null;
  orderedQty: number;
  registeredQty: number;
  fedexRegisteredQty?: number;
}) {
  const currentStatus = input.status ?? "";
  if (isClosedTradeYear(input.paymentDate)) return currentStatus;

  if (input.orderedQty <= 0) return currentStatus;
  const effectiveRegisteredQty = Math.max(0, input.fedexRegisteredQty ?? input.registeredQty);
  const hasSiteShipmentQty = effectiveRegisteredQty > 0;
  if (isLegacyCompleteInvoice(input.invoiceNo) && !hasSiteShipmentQty) {
    return "complete";
  }
  if (!hasSiteShipmentQty) {
    if (isTradeStatusComplete(currentStatus)) {
      return `\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b${formatRemainingQty(input.orderedQty)}\u53f0\uff09`;
    }
    if (isTradeRemainingStatus(currentStatus)) return "";
    return currentStatus;
  }

  const registrationRemaining = Math.max(0, input.orderedQty - effectiveRegisteredQty);
  if (registrationRemaining <= 0) return "complete";
  return `\u6b8b${formatRemainingQty(registrationRemaining)}`;
}
