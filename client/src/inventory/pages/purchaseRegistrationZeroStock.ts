export type ZeroStockPurchaseStatus =
  | "shipped"
  | "inbound_waiting"
  | "inspection_waiting";

export type ZeroStockPurchaseRowStatusKind =
  | "ordered"
  | "inbound_shipped"
  | "received"
  | "partial_shipped"
  | "shipped";

export interface ZeroStockPurchaseStatusResult {
  kind: ZeroStockPurchaseStatus;
  label: string;
  inboundWaiting: boolean;
}

export function normalizedZeroStockStatus(status?: string | null): string {
  return (status ?? "").trim().toLowerCase();
}

interface DeriveZeroStockPurchaseStatusInput {
  itemStatus?: string | null;
  labelStatuses: Array<string | null | undefined>;
  rowStatus: ZeroStockPurchaseRowStatusKind;
}

export function deriveZeroStockPurchaseStatusForItem({
  itemStatus,
  labelStatuses,
  rowStatus,
}: DeriveZeroStockPurchaseStatusInput): ZeroStockPurchaseStatusResult | null {
  const normalizedItemStatus = normalizedZeroStockStatus(itemStatus);
  const normalizedLabelStatuses = labelStatuses.map(status =>
    normalizedZeroStockStatus(status)
  );

  if (
    normalizedLabelStatuses.length > 0 &&
    normalizedLabelStatuses.every(status => status === "shipped")
  ) {
    return { kind: "shipped", label: "出庫済み", inboundWaiting: false };
  }

  if (
    normalizedItemStatus === "returned" ||
    normalizedItemStatus === "cancelled" ||
    normalizedLabelStatuses.some(
      status => status === "returned" || status === "cancelled"
    )
  ) {
    return null;
  }

  if (
    normalizedLabelStatuses.some(status => status === "received") ||
    normalizedItemStatus === "received"
  ) {
    return {
      kind: "inspection_waiting",
      label: "動作確認待ち",
      inboundWaiting: false,
    };
  }

  if (
    normalizedLabelStatuses.some(status => status === "stocked") ||
    normalizedItemStatus === "stocked"
  ) {
    return null;
  }

  if (
    rowStatus === "ordered" ||
    rowStatus === "inbound_shipped" ||
    normalizedItemStatus === "ordered"
  ) {
    return { kind: "inbound_waiting", label: "入庫待ち", inboundWaiting: true };
  }

  return null;
}
