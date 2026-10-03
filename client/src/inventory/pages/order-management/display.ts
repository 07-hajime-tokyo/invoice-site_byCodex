import type { ColorSummary } from "./types";

/** 進捗バーの色を返す */
export function progressColor(pct: number): string {
  if (pct >= 100) return "bg-green-500";
  if (pct >= 70) return "bg-blue-500";
  if (pct >= 40) return "bg-yellow-500";
  return "bg-red-500";
}

export function orderStockCoverage(cs: ColorSummary): number {
  return Math.min(cs.csvQty, cs.zaicoCount + cs.stockCount + cs.deliveredCount);
}

export function isOrderStockShort(cs: ColorSummary): boolean {
  return orderStockCoverage(cs) < cs.csvQty;
}

export function cleanDeliveryProductTitle(title: string): string {
  return title.replace(/\s*[（）()][^（）()]*[（）()]\s*/g, "").trim() || title.trim();
}

export function deliveryDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 10);
}

export function deliveryDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("ja-JP");
}

export function sameValueOrLabel(values: string[], label: string): string {
  const unique = Array.from(new Set(values.filter(Boolean)));
  return unique.length === 1 ? unique[0] : label;
}
