import { detectCarrier, getCarrierColor } from "@/inventory/lib/tracking";
import { type Purchase } from "./types";
import { CARRIER_OPTIONS } from "./constants";

export type CarrierKey = Parameters<typeof getCarrierColor>[0];

export const TRACKING_CARRIER_KEYS = new Set<string>([
  "yamato",
  "sagawa",
  "japanpost",
  "amazon",
  "seino",
  "fukuyama",
  "ecohai",
  "unknown",
]);

export function normalizeCarrierKey(
  value: string | null | undefined,
  fallback: CarrierKey
): CarrierKey {
  return value && TRACKING_CARRIER_KEYS.has(value)
    ? (value as CarrierKey)
    : fallback;
}

export function getPurchaseCarrierMeta(
  purchase: Purchase,
  trackingNumber: string
) {
  const autoInfo = detectCarrier(trackingNumber);
  const carrierKey = normalizeCarrierKey(
    purchase.extra?.carrier && purchase.extra.carrier !== "auto"
      ? purchase.extra.carrier
      : null,
    autoInfo.carrier
  );
  const carrierName =
    CARRIER_OPTIONS.find(option => option.value === carrierKey)?.label ??
    autoInfo.carrierName;
  return {
    carrierKey,
    carrierName,
    colorClass: getCarrierColor(carrierKey),
  };
}

export function getPurchaseTrackingInfo(
  purchase: Purchase,
  carrierOptions = CARRIER_OPTIONS
) {
  if (!purchase.extra?.trackingNumber) return null;
  const manualCarrier = purchase.extra?.carrier;
  const autoInfo = detectCarrier(purchase.extra.trackingNumber);
  const carrierKey =
    manualCarrier && manualCarrier !== "auto"
      ? manualCarrier
      : autoInfo.carrier;
  const carrierName =
    carrierOptions.find(o => o.value === carrierKey)?.label ??
    autoInfo.carrierName;
  const num = purchase.extra.trackingNumber.trim().replace(/[\s-]/g, "");
  let url = autoInfo.trackingUrl;
  if (manualCarrier && manualCarrier !== "auto") {
    switch (manualCarrier) {
      case "japanpost":
        url = `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${num}&searchKind=S002&locale=ja`;
        break;
      case "yamato":
        url = `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${num}`;
        break;
      case "sagawa":
        url = `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${num}`;
        break;
      case "seino":
        url = `https://track.seino.co.jp/cgi-bin/gnpquery.pgm?GNPNO1=${num}`;
        break;
      case "fukuyama":
        url = `https://corp.fukutsu.co.jp/situation/tracking_no_input.html`;
        break;
      case "ecohai":
        url = null;
        break;
      case "amazon":
        url = `https://www.amazon.co.jp/progress-tracker/package/ref=pe_tracking?shipmentId=${num}`;
        break;
    }
  }
  return {
    carrierKey,
    carrierName,
    url,
    num,
    isEcohai: carrierKey === "ecohai",
  };
}
