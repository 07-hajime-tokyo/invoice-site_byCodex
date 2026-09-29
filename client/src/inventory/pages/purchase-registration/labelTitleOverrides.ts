import type { LabelView } from "./viewTypes";
import { compactProductText } from "./productText";
import { formatLabelPrintTitle } from "./labelTitles";

export type LabelTitleOverrideState = {
  byLabelId: Record<string, string>;
  byTitleKey: Record<string, string>;
};

export function emptyLabelTitleOverrides(): LabelTitleOverrideState {
  return { byLabelId: {}, byTitleKey: {} };
}

export function sanitizeStringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, text]) => [key, text]),
  );
}

export function normalizeLabelTitleKey(value: string): string {
  return compactProductText(value).replace(/\s+/g, "");
}

export function applyLabelTitleOverride(label: LabelView, overrides: LabelTitleOverrideState): LabelView {
  const rawTitle = label.title || label.printTitle;
  const titleKey = normalizeLabelTitleKey(rawTitle);
  const override = overrides.byLabelId[label.labelId]?.trim() || overrides.byTitleKey[titleKey]?.trim();
  const autoTitle = formatLabelPrintTitle(rawTitle);
  return {
    ...label,
    printTitle: override ? formatLabelPrintTitle(override) : autoTitle,
  };
}
