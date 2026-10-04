export function fmt(n: number | null | undefined): string {
  if (n == null) return "-";
  return `¥${Math.round(n).toLocaleString("ja-JP")}`;
}

export function fmtDateTime(value: unknown): string {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const CHANGE_TYPE_LABELS: Record<string, string> = {
  created: "新規登録",
  updated: "変更",
  deleted: "削除",
  increase: "在庫増",
  decrease: "在庫減",
  set: "在庫数の修正",
};
