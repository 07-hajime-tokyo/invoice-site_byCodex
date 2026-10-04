import type { LabelTitleOverrideState } from "./labelTitleOverrides";
import { emptyLabelTitleOverrides, sanitizeStringRecord } from "./labelTitleOverrides";
import { clampLabelStartPosition } from "./labelPrintLayout";

export const LABEL_TITLE_OVERRIDE_STORAGE_KEY = "purchase-registration-label-title-overrides";

export function loadLabelTitleOverrides(): LabelTitleOverrideState {
  if (typeof window === "undefined") return emptyLabelTitleOverrides();
  try {
    const raw = window.localStorage.getItem(LABEL_TITLE_OVERRIDE_STORAGE_KEY);
    if (!raw) return emptyLabelTitleOverrides();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return emptyLabelTitleOverrides();
    if ("byLabelId" in parsed || "byTitleKey" in parsed) {
      return {
        byLabelId: sanitizeStringRecord((parsed as Partial<LabelTitleOverrideState>).byLabelId),
        byTitleKey: sanitizeStringRecord((parsed as Partial<LabelTitleOverrideState>).byTitleKey),
      };
    }
    return { byLabelId: sanitizeStringRecord(parsed), byTitleKey: {} };
  } catch {
    return emptyLabelTitleOverrides();
  }
}

export function saveLabelTitleOverrides(overrides: LabelTitleOverrideState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LABEL_TITLE_OVERRIDE_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // Local storage can be unavailable in private modes; printing still works with generated titles.
  }
}

export const LABEL_START_POSITION_STORAGE_KEY = "purchase-registration-label-start-position";

export function loadLabelStartPosition(): number {
  if (typeof window === "undefined") return 1;
  return clampLabelStartPosition(Number(window.localStorage.getItem(LABEL_START_POSITION_STORAGE_KEY)) || 1);
}

export function saveLabelStartPosition(value: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LABEL_START_POSITION_STORAGE_KEY, String(clampLabelStartPosition(value)));
}

// 既存の在庫はすべてラベルを発行して現物に貼り終えている。ラベル印刷と入庫スキャンで
// 見るのは、この日以降の仕入れだけでよい（村上さん指示・2026-08-18）。
// 貼り直しなど過去分が要るときは、画面のチェックを外すと全件に戻る。
export const LABEL_SCOPE_FROM_DEFAULT = "2026-08-10";

export const LABEL_SCOPE_FROM_KEY = "inventory.labelScopeFrom";

export const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

export function loadLabelScopeFrom(): string {
  if (typeof window === "undefined") return LABEL_SCOPE_FROM_DEFAULT;
  try {
    const saved = window.localStorage.getItem(LABEL_SCOPE_FROM_KEY);
    return saved && ISO_DATE_PATTERN.test(saved) ? saved : LABEL_SCOPE_FROM_DEFAULT;
  } catch {
    return LABEL_SCOPE_FROM_DEFAULT;
  }
}

/** Asia/Tokyo の「今日」を YYYY-MM-DD で返す。ブラウザのタイムゾーンに引きずられないようにする。 */
export function todayInTokyo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
