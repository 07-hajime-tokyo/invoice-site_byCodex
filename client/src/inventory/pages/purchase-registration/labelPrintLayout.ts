import type { LabelView } from "./viewTypes";
import { stockModelName, STOCK_MODEL_ORDER } from "./productPresentation";

export const LABELS_PER_SHEET = 24;

export function clampLabelStartPosition(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(Math.floor(value), 1), LABELS_PER_SHEET);
}

/** 開始位置から count 枚刷ったあとに、次に空いている面の番号。 */
export function nextLabelStartPosition(startPosition: number, count: number): number {
  return ((clampLabelStartPosition(startPosition) - 1 + count) % LABELS_PER_SHEET) + 1;
}

export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export function isWithinLabelScope(label: LabelView, fromDate: string): boolean {
  // 在庫から作ったラベルは、現物にもう貼り終えている。既定では見ない
  if (label.rowId < 0) return false;
  const purchaseDate = label.purchaseDate?.trim() ?? "";
  // 仕入日が空のものは、隠すと気づけなくなるので残す
  if (!purchaseDate) return true;
  return purchaseDate.slice(0, 10) >= fromDate;
}

export function buildLabelPrintGroups(labels: LabelView[]): { name: string; labels: LabelView[] }[] {
  const map = new Map<string, LabelView[]>();
  for (const label of labels) {
    const name = label.category || stockModelName(label.title) || "その他";
    const current = map.get(name) ?? [];
    current.push(label);
    map.set(name, current);
  }
  return Array.from(map.entries())
    .map(([name, groupLabels]) => ({ name, labels: groupLabels }))
    .sort((a, b) => {
      const orderA = STOCK_MODEL_ORDER.indexOf(a.name);
      const orderB = STOCK_MODEL_ORDER.indexOf(b.name);
      const normalizedA = orderA === -1 ? STOCK_MODEL_ORDER.length : orderA;
      const normalizedB = orderB === -1 ? STOCK_MODEL_ORDER.length : orderB;
      if (normalizedA !== normalizedB) return normalizedA - normalizedB;
      return a.name.localeCompare(b.name, "ja", { numeric: true });
    });
}

export function buildChecklistRows(labels: LabelView[]): { name: string; labels: LabelView[] }[] {
  return buildLabelPrintGroups(labels).map((group) => ({
    name: group.name,
    labels: [...group.labels].sort((a, b) =>
      a.legacyManagementNo.localeCompare(b.legacyManagementNo, "ja", { numeric: true }),
    ),
  }));
}
