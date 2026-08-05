export function isTradeStatusComplete(status: unknown) {
  const normalized = String(status ?? "").trim().toLowerCase();
  return normalized === "complete" || normalized === "完了";
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
  hasShipmentSignal: boolean;
}) {
  const currentStatus = input.status ?? "";
  if (isClosedTradeYear(input.paymentDate)) return currentStatus;

  const invoiceNo = Number(input.invoiceNo ?? 0);
  if (Number.isFinite(invoiceNo) && invoiceNo > 0 && invoiceNo <= 383) {
    return currentStatus;
  }
  if (!input.hasShipmentSignal || input.orderedQty <= 0) return currentStatus;

  const remaining = Math.max(0, input.orderedQty - input.registeredQty);
  if (remaining <= 0) return "complete";
  if (!isTradeStatusComplete(currentStatus)) return currentStatus;
  return remaining > 0
    ? `発送登録未完了（残${formatRemainingQty(remaining)}台）`
    : currentStatus;
}
