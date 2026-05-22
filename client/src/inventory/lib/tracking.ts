/**
 * 追跡番号から配送業者を自動判別して追跡URLを返すユーティリティ
 *
 * 12桁の先頭数字による業者判別（一般的な割り当て）:
 * - 先頭「9」 → ヤマト運輸（宅急便）
 * - 先頭「4」 → 佐川急便（飛脚宅配便）
 * - 先頭「0」「3」「5」「6」 → 日本郵便（ゆうパック等）
 * - 11桁・13桁 → 日本郵便
 * - 国際郵便（英数字13桁）→ 日本郵便
 */

export type Carrier =
  | "yamato"
  | "sagawa"
  | "japanpost"
  | "amazon"
  | "seino"
  | "fukuyama"
  | "ecohai"
  | "unknown";

export interface TrackingInfo {
  carrier: Carrier;
  carrierName: string;
  trackingUrl: string | null;
}

/** 日本郵便の追跡URL */
function japanPostUrl(num: string): string {
  return `https://trackings.post.japanpost.jp/services/srv/search/direct?reqCodeNo1=${num}&searchKind=S002&locale=ja`;
}

/**
 * 追跡番号から配送業者を判別して追跡URLを返す
 */
export function detectCarrier(trackingNumber: string): TrackingInfo {
  const num = trackingNumber.trim().replace(/[\s\-]/g, "");

  if (!num) {
    return { carrier: "unknown", carrierName: "不明", trackingUrl: null };
  }

  // Amazon: TBA/TBM/TBC で始まる
  if (/^(TBA|TBM|TBC)\d+$/i.test(num)) {
    return {
      carrier: "amazon",
      carrierName: "Amazon",
      trackingUrl: `https://www.amazon.co.jp/progress-tracker/package/ref=pe_tracking?_encoding=UTF8&from=gp&nodeId=&orderId=&packageIndex=0&shipmentId=${num}`,
    };
  }

  // 国際郵便: 先頭2文字アルファベット + 8桁数字 + 2文字アルファベット（例: RH123456789JP）
  if (/^[A-Z]{2}\d{8}[A-Z]{2}$/i.test(num)) {
    return {
      carrier: "japanpost",
      carrierName: "日本郵便（国際）",
      trackingUrl: japanPostUrl(num),
    };
  }

  // 11桁数字 → 日本郵便（ゆうパック・書留等のハイフンなし形式）
  if (/^\d{11}$/.test(num)) {
    return {
      carrier: "japanpost",
      carrierName: "日本郵便",
      trackingUrl: japanPostUrl(num),
    };
  }

  // 12桁数字 → 先頭1桁で業者を判別
  if (/^\d{12}$/.test(num)) {
    const first = num.charAt(0);
    const prefix2 = num.substring(0, 2);
    const prefix4 = num.substring(0, 4);

    // ヤマト運輸: 先頭が「9」
    if (first === "9") {
      return {
        carrier: "yamato",
        carrierName: "ヤマト運輸",
        trackingUrl: `https://jizen.kuronekoyamato.co.jp/jizen/servlet/crjz.b.NQ0010?id=${num}`,
      };
    }

    // 佐川急便: 先頭が「4」
    if (first === "4") {
      return {
        carrier: "sagawa",
        carrierName: "佐川急便",
        trackingUrl: `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${num}`,
      };
    }

    // 西濃運輸: 先頭4桁が 1111〜1113
    if (["1111", "1112", "1113"].includes(prefix4)) {
      return {
        carrier: "seino",
        carrierName: "西濃運輸",
        trackingUrl: `https://track.seino.co.jp/cgi-bin/gnpquery.pgm?GNPNO1=${num}`,
      };
    }

    // 福山通運: 先頭が「7」
    if (first === "7") {
      return {
        carrier: "fukuyama",
        carrierName: "福山通運",
        trackingUrl: `https://corp.fukutsu.co.jp/situation/tracking_no_input.html`,
      };
    }

    // 佐川急便（追加パターン）: 先頭が「1」「2」「3」
    if (["1", "2", "3"].includes(first)) {
      return {
        carrier: "sagawa",
        carrierName: "佐川急便",
        trackingUrl: `https://k2k.sagawa-exp.co.jp/p/web/okurijosearch.do?okurijoNo=${num}`,
      };
    }

    // 日本郵便ゆうパック: 先頭が「0」「5」「6」「8」
    if (["0", "5", "6", "8"].includes(first)) {
      return {
        carrier: "japanpost",
        carrierName: "日本郵便",
        trackingUrl: japanPostUrl(num),
      };
    }

    // 上記以外の12桁 → 日本郵便として試みる（ゆうパックは多様な番号帯を使用）
    return {
      carrier: "japanpost",
      carrierName: "日本郵便",
      trackingUrl: japanPostUrl(num),
    };
  }

  // 13桁数字 → 日本郵便（ゆうパケット等）
  if (/^\d{13}$/.test(num)) {
    return {
      carrier: "japanpost",
      carrierName: "日本郵便",
      trackingUrl: japanPostUrl(num),
    };
  }

  // 判別不能
  return {
    carrier: "unknown",
    carrierName: "不明",
    trackingUrl: null,
  };
}

/**
 * 配送業者のバッジカラーを返す
 */
export function getCarrierColor(carrier: Carrier): string {
  switch (carrier) {
    case "yamato":
      return "bg-black text-white";
    case "sagawa":
      return "bg-green-600 text-white";
    case "japanpost":
      return "bg-red-600 text-white";
    case "amazon":
      return "bg-orange-500 text-white";
    case "seino":
      return "bg-blue-600 text-white";
    case "fukuyama":
      return "bg-purple-600 text-white";
    case "ecohai":
      return "bg-cyan-600 text-white";
    default:
      return "bg-muted text-muted-foreground";
  }
}
