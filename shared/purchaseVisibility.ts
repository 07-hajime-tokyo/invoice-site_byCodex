import { isInboundComplete, type InboundClass } from "./inboundPipeline";

/** 一覧の表示判定に必要な最小限の状態。DBや画面の型には依存しない。 */
export type InboundPurchaseState = {
  status: string;
  purchaseDate?: string | null;
  purchase_date?: string | null;
  created_at?: string | null;
  createdAt?: string | Date | null;
  extra?: { trackingNumber?: string | null } | null;
  inboundClass?: InboundClass | null;
  stage?: string;
};

// 入庫ワークフロー刷新前（6/19以前）の旧運用データを非表示にする。
const INBOUND_CUTOFF_DATE = "2026-06-20";

function normalizeDateOnly(
  value: string | Date | null | undefined
): string | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}/.test(trimmed) ? trimmed.slice(0, 10) : null;
}

export function isInboundCutoffVisible(
  purchase: InboundPurchaseState
): boolean {
  const filterDate =
    normalizeDateOnly(purchase.purchaseDate) ??
    normalizeDateOnly(purchase.purchase_date) ??
    normalizeDateOnly(purchase.created_at) ??
    normalizeDateOnly(purchase.createdAt);
  return filterDate == null || filterDate >= INBOUND_CUTOFF_DATE;
}

export function isInboundActivePurchase(
  purchase: InboundPurchaseState
): boolean {
  return purchase.status !== "purchased" && isInboundCutoffVisible(purchase);
}

export function getEffectivePurchaseStatus(purchase: InboundPurchaseState) {
  if (purchase.status !== "purchased" && purchase.extra?.trackingNumber)
    return "shipped";
  return purchase.status;
}

export function isPurchaseInboundComplete(
  purchase: InboundPurchaseState
): boolean {
  return isInboundComplete(
    purchase.inboundClass ?? null,
    purchase.stage ?? "received"
  );
}
