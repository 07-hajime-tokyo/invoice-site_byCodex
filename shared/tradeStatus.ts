export function isTradeStatusComplete(status: unknown) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "complete" || normalized === "\u5b8c\u4e86";
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

export function deriveTradeShipmentRegistrationStatus(input: {
  status: string | null;
  invoiceNo: number | null;
  paymentDate?: string | null;
  orderedQty: number;
  registeredQty: number;
  actualShippedQty?: number;
  fedexRegisteredQty?: number;
  hasShipmentSignal: boolean;
}) {
  const currentStatus = input.status ?? "";
  if (isClosedTradeYear(input.paymentDate)) return currentStatus;

  const invoiceNo = Number(input.invoiceNo ?? 0);
  if (Number.isFinite(invoiceNo) && invoiceNo > 0 && invoiceNo <= 383) {
    return currentStatus;
  }
  if (input.orderedQty <= 0) return currentStatus;
  if (isTradeRemainingStatus(currentStatus)) return currentStatus;

  if (isTradeStatusComplete(currentStatus)) {
    const fedexRegisteredQty = input.fedexRegisteredQty ?? input.registeredQty;
    const fedexRemaining = Math.max(0, input.orderedQty - fedexRegisteredQty);
    return fedexRemaining <= 0
      ? "complete"
      : `\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b${formatRemainingQty(fedexRemaining)}\u53f0\uff09`;
  }

  if (!input.hasShipmentSignal) return currentStatus;

  const actualShippedQty =
    input.actualShippedQty ?? input.registeredQty;
  const actualRemaining = Math.max(0, input.orderedQty - actualShippedQty);
  if (actualRemaining > 0) {
    return `\u6b8b${formatRemainingQty(actualRemaining)}`;
  }

  const fedexRegisteredQty = input.fedexRegisteredQty ?? input.registeredQty;
  const fedexRemaining = Math.max(0, input.orderedQty - fedexRegisteredQty);
  if (fedexRemaining <= 0) return "complete";
  if (!isTradeStatusComplete(currentStatus) && !isTradeRemainingStatus(currentStatus)) return currentStatus;
  return `\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b${formatRemainingQty(fedexRemaining)}\u53f0\uff09`;
}
