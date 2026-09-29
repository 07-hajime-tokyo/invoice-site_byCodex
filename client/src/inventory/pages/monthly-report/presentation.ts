export function fmt(n: number | null | undefined, prefix = "¥"): string {
  if (n == null) return "-";
  return `${prefix}${n.toLocaleString("ja-JP")}`;
}

/** 通貨表示: 「2125ユーロ」「2125ドル」のように数値→通貨名の順 */
export function fmtForeign(price: number | null, currency: string): string {
  if (price == null) return "-";
  const formatted = price.toLocaleString("ja-JP", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  // 通貨コードを日本語表示に変換
  const currencyLabel =
    currency === "EUR" || currency === "€"
      ? "ユーロ"
      : currency === "USD" || currency === "$"
        ? "ドル"
        : currency === "GBP" || currency === "£"
          ? "ポンド"
          : currency === "ユーロ"
            ? "ユーロ"
            : currency === "ドル"
              ? "ドル"
              : currency || "";
  return `${formatted}${currencyLabel}`;
}

export function parseDomesticNote(note: string | null): {
  isDomestic: boolean;
  detail: string | null;
} {
  if (!note) return { isDomestic: false, detail: null };
  const lower = note.toLowerCase();
  if (
    lower.includes("toynet") ||
    lower.includes("益子") ||
    lower.includes("国内")
  ) {
    return { isDomestic: true, detail: note };
  }
  return { isDomestic: false, detail: null };
}

/** 日付文字列を「YYYY/MM/DD」形式にフォーマット */
export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  // 「Tue Mar 10 2026 09:00:00 GMT+0900 (Japan Standard Time)」のような形式を変換
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr; // パース失敗時はそのまま返す
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

export function getCurrentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
