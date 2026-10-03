// Registration-specific carrier aliases and URLs differ from the purchases list.
// Keep detectCarrier as the shared source for automatic detection.
import { detectCarrier, type Carrier } from "@/inventory/lib/tracking";
import type { PurchaseRow } from "./dataTypes";

export const TRACKING_CARRIER_LABELS: Record<Carrier, string> = {
  yamato: "ヤマト運輸",
  sagawa: "佐川急便",
  japanpost: "日本郵便",
  amazon: "Amazon",
  seino: "西濃運輸",
  fukuyama: "福山通運",
  ecohai: "エコ配",
  unknown: "追跡",
};

export const TRACKING_CARRIER_KEYS = new Set<Carrier>([
  "yamato",
  "sagawa",
  "japanpost",
  "amazon",
  "seino",
  "fukuyama",
  "ecohai",
  "unknown",
]);

export const TRACKING_CARRIER_OPTIONS: Array<{ value: "auto" | Carrier; label: string }> = [
  { value: "auto", label: "自動判別" },
  { value: "japanpost", label: "日本郵便" },
  { value: "yamato", label: "ヤマト運輸" },
  { value: "sagawa", label: "佐川急便" },
  { value: "amazon", label: "Amazon" },
  { value: "seino", label: "西濃運輸" },
  { value: "ecohai", label: "エコ配" },
  { value: "fukuyama", label: "福山通運" },
];

export function normalizedTrackingNumber(trackingNumber: string): string {
  return trackingNumber.trim().replace(/[\s-]/g, "");
}

export function normalizeCarrierKey(value: string | null | undefined, fallback: Carrier): Carrier {
  const normalized = (value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "auto") return fallback;
  if (TRACKING_CARRIER_KEYS.has(normalized as Carrier)) return normalized as Carrier;
  if (value?.includes("ヤマト")) return "yamato";
  if (value?.includes("佐川")) return "sagawa";
  if (value?.includes("日本郵便") || value?.includes("郵便")) return "japanpost";
  if (value?.includes("西濃")) return "seino";
  if (value?.includes("福山")) return "fukuyama";
  if (value?.includes("エコ配")) return "ecohai";
  return fallback;
}

export function getTrackingUrlForCarrier(carrier: Carrier, trackingNumber: string, fallbackUrl: string | null): string | null {
  const num = normalizedTrackingNumber(trackingNumber);
  if (!num) return null;
  switch (carrier) {
    case "yamato":
      return `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${num}`;
    case "sagawa":
      return `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${num}`;
    case "japanpost":
      return `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${num}&searchKind=S002&locale=ja`;
    case "amazon":
      return `https://www.amazon.co.jp/progress-tracker/package/ref=pe_tracking?_encoding=UTF8&from=gp&nodeId=&orderId=&packageIndex=0&shipmentId=${num}`;
    case "seino":
      return `https://track.seino.co.jp/cgi-bin/gnpquery.pgm?GNPNO1=${num}`;
    case "fukuyama":
      return "https://corp.fukutsu.co.jp/situation/tracking_no_input.html";
    case "ecohai":
      return null;
    default:
      return fallbackUrl;
  }
}

export function getPurchaseTrackingMeta(trackingNumber: string, savedCarrier?: string | null) {
  const autoInfo = detectCarrier(trackingNumber);
  const carrier = normalizeCarrierKey(savedCarrier, autoInfo.carrier);
  return {
    carrier,
    carrierName: TRACKING_CARRIER_LABELS[carrier] ?? autoInfo.carrierName,
    trackingUrl: getTrackingUrlForCarrier(carrier, trackingNumber, autoInfo.trackingUrl),
    isEcohai: carrier === "ecohai",
    normalizedNumber: normalizedTrackingNumber(trackingNumber),
  };
}

export function purchaseTrackingNumber(row: PurchaseRow): string {
  return row.extra?.trackingNumber?.trim() ?? "";
}

export function hasPurchaseTracking(row: PurchaseRow): boolean {
  return purchaseTrackingNumber(row).length > 0;
}
