export type ListingKind = "junk" | "surplus";
export type TopEdge = "top" | "right" | "bottom" | "left";

export const TOP_EDGE_LABELS: Record<TopEdge, string> = {
  top: "そのまま",
  right: "右を上へ",
  bottom: "上下反転",
  left: "左を上へ",
};

export const DEFECT_TAG_OPTIONS = [
  "通電せず", "起動しない", "画面不良", "バッテリー不良", "充電不可",
  "ボタン・スティック不良", "外装破損", "付属品欠品", "その他",
] as const;

export const KIND_LABELS: Record<ListingKind, string> = {
  junk: "ジャンク",
  surplus: "不要在庫（動作品）",
};

export const KIND_BADGE: Record<ListingKind, string> = {
  junk: "border-amber-200 bg-amber-50 text-amber-800",
  surplus: "border-sky-200 bg-sky-50 text-sky-800",
};
