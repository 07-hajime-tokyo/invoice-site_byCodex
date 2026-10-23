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

export const TRADE_SHIPMENT_CONFIRMATION_MEMO_KEY = "__trade_shipment_confirmation__";

export function isTradeShipmentConfirmed(
  row: { id: number; no: number | null; partner: string | null; productName: string | null; quantity: unknown },
  memo: string | undefined,
) {
  if (!memo) return false;
  try {
    const confirmation = JSON.parse(memo);
    const quantity = Number(row.quantity);
    return confirmation?.version === 1 && confirmation.confirmedShipped === true &&
      confirmation.tradeId === row.id && confirmation.invoiceNo === row.no &&
      confirmation.partner === row.partner && confirmation.productName === row.productName &&
      Number.isFinite(quantity) && quantity > 0 && confirmation.quantity === quantity;
  } catch {
    return false;
  }
}

export function deriveTradeShipmentRegistrationStatus(input: {
  status: string | null;
  invoiceNo: number | null;
  paymentDate?: string | null;
  orderedQty: number;
  registeredQty: number;
  fedexRegisteredQty?: number;
  shipmentConfirmed?: boolean;
}) {
  if (input.shipmentConfirmed) return "complete";
  const currentStatus = input.status ?? "";
  if (isClosedTradeYear(input.paymentDate)) return currentStatus;

  const invoiceNo = Number(input.invoiceNo ?? 0);
  if (input.orderedQty <= 0) return currentStatus;
  const effectiveRegisteredQty = Math.max(0, input.fedexRegisteredQty ?? input.registeredQty);
  const hasSiteShipmentQty = effectiveRegisteredQty > 0;
  if (Number.isFinite(invoiceNo) && invoiceNo > 0 && invoiceNo <= 399 && !hasSiteShipmentQty) {
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
