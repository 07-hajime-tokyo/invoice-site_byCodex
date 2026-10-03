/**
 * WhatsApp会話履歴画面の型・定数・表示用純関数。
 * WhatsappHistory.tsx から逐語移動（画面の状態・クエリ・イベント配線は本体に残す）。
 */
export type ViewMode = "both" | "original" | "ja";

export const VIEW_MODES: Array<{ value: ViewMode; label: string }> = [
  { value: "both", label: "原文＋和訳" },
  { value: "ja", label: "和訳だけ" },
  { value: "original", label: "原文だけ" },
];

export const SELECTED_KEY = "invoice-site-whatsapp-selected-conversation";

/** サーバ側の既定の窓（server/whatsappChatsRouter.ts の WHATSAPP_* と揃える。表示文言にだけ使う） */
export const RECENT_DAYS = 14;
export const EXPAND_MONTHS = 3;

/**
 * sentAt には「WhatsAppの画面に出ていた時刻」がそのままUTCとして入っている
 * （取り込み元が壁時計の文字列なので、絶対時刻には変換していない）。
 * したがって表示も必ずUTCとして読む。ローカル時刻で解釈すると9時間ずれる。
 */
export const WALL_CLOCK_TZ = "UTC";

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("ja-JP", {
    timeZone: WALL_CLOCK_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleDateString("ja-JP", {
    timeZone: WALL_CLOCK_TZ,
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export function formatTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleTimeString("ja-JP", { timeZone: WALL_CLOCK_TZ, hour: "2-digit", minute: "2-digit" });
}

/**
 * WhatsAppの本文には空行が3つ4つ続くことがあり、そのまま出すとバブルが間延びする。
 * 表示のときだけ詰める。DBの原文は触らない（取り込みの重複判定キーが原文由来のため）。
 */
export function tidy(text: string): string {
  return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
