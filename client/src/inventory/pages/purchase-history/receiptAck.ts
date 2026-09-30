import {
  RECEIPT_ACK_STATUSES,
  receiptAckLabel,
  type ReceiptAckSource,
  type ReceiptAckStatus,
} from "@shared/receiptAck";
import type { PurchaseHistoryItem } from "./types";

const receiptAckStatusSet = new Set<string>(RECEIPT_ACK_STATUSES);

export function normalizeReceiptAckStatus(value: string | null | undefined): ReceiptAckStatus | null {
  const status = (value ?? "").trim();
  return receiptAckStatusSet.has(status) ? (status as ReceiptAckStatus) : null;
}

export function normalizeReceiptAckSource(value: string | null | undefined): ReceiptAckSource | null {
  return value === "crawl" || value === "manual" ? value : null;
}

export function getReceiptAckLabel(item: Pick<PurchaseHistoryItem, "receiptAckStatus" | "receiptAckSource">) {
  return receiptAckLabel(
    normalizeReceiptAckStatus(item.receiptAckStatus),
    normalizeReceiptAckSource(item.receiptAckSource),
  );
}

export function formatReceiptAckAt(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function receiptAckTitle(item: PurchaseHistoryItem) {
  return [
    item.receiptAckNote,
    item.receiptAckAt ? `最終確認: ${formatReceiptAckAt(item.receiptAckAt)}` : "",
  ].filter(Boolean).join("\n");
}
