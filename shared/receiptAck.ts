export const RECEIPT_ACK_SITES = ["yahuoku", "mercari", "yahoo_fleamarket"] as const;

export const RECEIPT_ACK_STATUSES = ["done", "pending", "not_required", "unknown", "unavailable"] as const;

export const RECEIPT_ACK_SOURCES = ["crawl", "manual"] as const;

export const RECEIPT_ACK_CRAWL_ITEM_STATUSES = [
  "completed",
  "done",
  "receipt_done",
  "received_confirmed",
  "shipped",
  "awaiting_shipment",
  "awaiting_review",
  "bundled",
  "not_required",
] as const;

export type ReceiptAckSite = (typeof RECEIPT_ACK_SITES)[number];
export type ReceiptAckStatus = (typeof RECEIPT_ACK_STATUSES)[number];
export type ReceiptAckSource = (typeof RECEIPT_ACK_SOURCES)[number];
export type ReceiptAckCrawlItemStatus = (typeof RECEIPT_ACK_CRAWL_ITEM_STATUSES)[number];

export type ReceiptAckTarget = {
  site: ReceiptAckSite;
  itemId: string;
};

export type ReceiptAckUrlClassification =
  | { status: "target"; target: ReceiptAckTarget }
  | { status: "not_required" }
  | { status: "unknown" };

export type ReceiptAckCrawlItem = {
  itemId: string;
  status: ReceiptAckCrawlItemStatus | string;
  isStore?: boolean;
};

const URLISH_RE = /^(?:https?:\/\/|\/\/|[a-z0-9.-]+\.[a-z]{2,}(?:[/?#:].*)?$)/i;

function cleanText(value: unknown): string {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeUrlCandidate(value: unknown): string {
  const text = cleanText(value);
  if (!text) return "";
  if (/^[a-z][a-z\d+\-.]*:/i.test(text)) return text;
  if (text.startsWith("//")) return `https:${text}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/?#:].*)?$/i.test(text)) return `https://${text}`;
  return text;
}

function normalizeItemId(value: string): string {
  return cleanText(value).toLowerCase();
}

export function receiptAckItemKey(site: ReceiptAckSite, itemId: string): string {
  return `${site}:${normalizeItemId(itemId)}`;
}

export function parseReceiptAckTarget(supplierUrl: unknown): ReceiptAckTarget | null {
  const raw = cleanText(supplierUrl);
  if (!raw) return null;
  const url = normalizeUrlCandidate(raw);

  const yahooAuctionMatch = url.match(/\/jp\/auction\/([a-z]?\d+)(?:[/?#]|$)/i);
  if (yahooAuctionMatch?.[1] && /(?:^|\/\/|\.)(?:page\.)?auctions\.yahoo\.co\.jp/i.test(url)) {
    return { site: "yahuoku", itemId: normalizeItemId(yahooAuctionMatch[1]) };
  }

  const mercariMatch = url.match(/\/(?:item|transaction)\/(m\d+)(?:[/?#]|$)/i);
  if (mercariMatch?.[1] && /(?:^|\/\/|\.)mercari\.(?:com|jp)/i.test(url)) {
    return { site: "mercari", itemId: normalizeItemId(mercariMatch[1]) };
  }

  const yahooFleaMatch = url.match(/\/item\/([a-z]?\d+)(?:[/?#]|$)/i);
  if (
    yahooFleaMatch?.[1] &&
    /(?:^|\/\/|\.)(?:paypayfleamarket(?:-sec)?|paypayfleamarket\.yahoo|fleamarket\.yahoo)\./i.test(url)
  ) {
    return { site: "yahoo_fleamarket", itemId: normalizeItemId(yahooFleaMatch[1]) };
  }

  return null;
}

export function classifyReceiptAckUrl(supplierUrl: unknown): ReceiptAckUrlClassification {
  const raw = cleanText(supplierUrl);
  if (!raw) return { status: "unknown" };

  const target = parseReceiptAckTarget(raw);
  if (target) return { status: "target", target };

  return URLISH_RE.test(raw) ? { status: "not_required" } : { status: "unknown" };
}

export function receiptAckSiteCompletesMissingItems(site: ReceiptAckSite): boolean {
  return site === "mercari" || site === "yahoo_fleamarket";
}

export function resolveMissingReceiptAckTargetStatus(site: ReceiptAckSite, siteAvailable: boolean): ReceiptAckStatus {
  if (!siteAvailable) return "unavailable";
  return receiptAckSiteCompletesMissingItems(site) ? "done" : "unknown";
}

export function resolveReceiptAckStatusFromCrawlItem(
  site: ReceiptAckSite,
  item: ReceiptAckCrawlItem,
): ReceiptAckStatus {
  const status = cleanText(item.status).toLowerCase().replace(/[\s-]+/g, "_");
  if (status === "bundled" || status === "not_required") return "not_required";
  if (site === "yahuoku" && item.isStore) return "not_required";
  if (["completed", "done", "receipt_done", "received_confirmed"].includes(status)) return "done";
  if (["shipped", "awaiting_shipment", "awaiting_review"].includes(status)) return "pending";
  return "unknown";
}

export function receiptAckLabel(status: ReceiptAckStatus | null | undefined, source?: ReceiptAckSource | string | null) {
  if (status === "done") return source === "manual" ? "済（未確認）" : "済";
  if (status === "pending") return "未";
  if (status === "not_required") return "対象外";
  if (status === "unknown") return "判定不可";
  if (status === "unavailable") return "確認不可";
  return "";
}
