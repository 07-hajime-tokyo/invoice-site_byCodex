/**
 * AI調査画面の表示用純関数（日付・セル値・リンク組み立て・eBay状態の整形）。
 * AiInvestigation.tsx から逐語移動。
 */
import { invoiceGroupKeyFromDeliveryNo } from "@shared/invoiceKey";
import type { EvidenceRow, InvestigationResult } from "./types";

export function formatHistoryDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCellValue(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "あり" : "なし";
  return String(value);
}

export function toNumber(value: unknown) {
  const num = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(num) ? num : 0;
}

export function invoiceNoFromDeliveryNo(value: unknown) {
  return invoiceGroupKeyFromDeliveryNo(String(value ?? "")) || "-";
}

export function displayDate(value: unknown) {
  const text = String(value ?? "").trim();
  if (!text) return "-";
  return text.replaceAll("-", "/");
}

export function buildDeliveryHistoryUrl(row: EvidenceRow) {
  const params = new URLSearchParams();
  const group = invoiceNoFromDeliveryNo(row.deliveryNo);
  const historyId = String(row.historyId ?? "").trim();
  if (group && group !== "-") params.set("group", group);
  if (historyId) params.set("historyId", historyId);
  const query = params.toString();
  return `/inventory/delivery-history${query ? `?${query}` : ""}`;
}

export function buildSearchUrl(path: string, query: string) {
  const params = new URLSearchParams();
  params.set("q", query);
  return `${path}?${params.toString()}`;
}

export function firstSearchTerm(value: string) {
  return value.split(/\s+\/\s+|,/)[0]?.trim() ?? value;
}

export function formatEbayStatus(value: string | null | undefined) {
  const status = String(value ?? "").trim();
  if (!status) return "-";
  const labels: Record<string, string> = {
    FULFILLED: "発送済み",
    IN_PROGRESS: "処理中",
    NOT_STARTED: "未発送",
    PAID: "支払い済み",
    PENDING: "保留",
    NOT_PAID: "未払い",
    NONE: "なし",
    NONE_REQUESTED: "キャンセル申請なし",
    NOT_CANCELED: "キャンセルなし",
    CANCELED: "キャンセル済み",
    CANCELLED: "キャンセル済み",
    CANCEL_REQUESTED: "キャンセル申請中",
    CANCEL_REJECTED: "キャンセル却下",
    REFUNDED: "返金済み",
    PARTIALLY_REFUNDED: "一部返金",
  };
  return labels[status] ?? status;
}

export function getEbayStatusCode(value: string | null | undefined) {
  return String(value ?? "").trim().toUpperCase();
}

export function formatEbayOrderSummary(order: NonNullable<InvestigationResult["ebayOrders"]>[number]) {
  if (!order.ok) return order.error ?? "eBay APIで確認できませんでした";
  const refunded = (order.status?.refundCount ?? 0) > 0 ||
    getEbayStatusCode(order.status?.refundStatus).includes("REFUND");
  const cancelState = getEbayStatusCode(order.status?.cancelState);
  const canceled = (order.status?.cancelRequestCount ?? 0) > 0 ||
    (!!cancelState && cancelState !== "NONE" && cancelState !== "NONE_REQUESTED" && cancelState !== "NOT_CANCELED");
  const fulfillment = getEbayStatusCode(order.status?.orderFulfillmentStatus);
  const payment = getEbayStatusCode(order.status?.orderPaymentStatus);

  if (canceled && refunded) return "キャンセル返金済み";
  if (canceled) return "キャンセル済み";
  if (refunded) return "返金済み";
  if (fulfillment === "FULFILLED") return payment === "PAID" ? "発送済み・支払い済み" : "発送済み";
  if (fulfillment === "NOT_STARTED") return "未発送";
  return [
    formatEbayStatus(order.status?.orderFulfillmentStatus),
    formatEbayStatus(order.status?.orderPaymentStatus),
    formatEbayStatus(order.status?.cancelState),
  ].filter((value) => value && value !== "-").join(" / ") || "確認済み";
}

export function getEvidenceCellLink(sectionTitle: string, key: string, row: EvidenceRow, text: string) {
  if (!text || text === "-") return null;
  if (key === "deliveryNo") return buildDeliveryHistoryUrl(row);
  if (key === "managementNo" || key === "managementNos") {
    const query = firstSearchTerm(text);
    if (!query || query === "-") return null;
    if (sectionTitle === "入庫管理 発注") return buildSearchUrl("/inventory/purchases", query);
    return buildSearchUrl("/inventory/deliveries", query);
  }
  return null;
}

export function splitInvestigationAnswer(answer: string) {
  const trimmed = answer.trim();
  const detailsStart = trimmed.search(/\n##\s*(?:詳細|数量サマリー|次に見るところ|原因候補|次にするべき行動)/);
  if (detailsStart <= 0) return { summary: trimmed, details: "" };
  return {
    summary: trimmed.slice(0, detailsStart).trim(),
    details: trimmed.slice(detailsStart).trim(),
  };
}

export function summarizeProducts(rows: EvidenceRow[]) {
  const map = new Map<string, number>();
  for (const row of rows) {
    const title = String(row.title ?? row.productName ?? "-").trim() || "-";
    map.set(title, (map.get(title) ?? 0) + (toNumber(row.quantity) || 1));
  }
  return Array.from(map.entries()).map(([title, quantity]) => `${title} x${quantity}`);
}
