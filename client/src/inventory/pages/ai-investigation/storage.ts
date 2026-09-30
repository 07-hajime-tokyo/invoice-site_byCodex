/**
 * AI調査画面の質問候補・調査履歴のlocalStorage入出力。
 * AiInvestigation.tsx から逐語移動（保存側の saveExamples / saveHistory は
 * Reactのstate更新と絡むため画面本体に残す）。
 */
import type { InvestigationHistoryItem } from "./types";

export const DEFAULT_EXAMPLES = [
  "FedEx発送登録漏れがないか確認してください",
];
export const EXAMPLES_STORAGE_KEY = "invoice-site-ai-investigation-examples";
export const HISTORY_STORAGE_KEY = "invoice-site-ai-investigation-history";

export function loadExamples() {
  if (typeof window === "undefined") return DEFAULT_EXAMPLES;
  try {
    const saved = JSON.parse(localStorage.getItem(EXAMPLES_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return DEFAULT_EXAMPLES;
    const custom = saved.filter((value): value is string => typeof value === "string" && value.trim().length > 0);
    return Array.from(new Set([...DEFAULT_EXAMPLES, ...custom]));
  } catch {
    return DEFAULT_EXAMPLES;
  }
}

export function loadHistory(): InvestigationHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved.filter((item): item is InvestigationHistoryItem =>
      item &&
      typeof item === "object" &&
      typeof item.id === "string" &&
      typeof item.question === "string" &&
      typeof item.createdAt === "string" &&
      item.result &&
      typeof item.result === "object" &&
      typeof item.result.answer === "string",
    );
  } catch {
    return [];
  }
}
