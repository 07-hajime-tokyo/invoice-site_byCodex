/**
 * AI調査画面 localStorage入出力の基準テスト。
 * vitest はnode環境（windowなし）で走るため、window / localStorage をスタブして
 * 抽出前の AiInvestigation.tsx と同じ読み出し挙動を固定する。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_EXAMPLES,
  EXAMPLES_STORAGE_KEY,
  HISTORY_STORAGE_KEY,
  loadExamples,
  loadHistory,
} from "./storage";

function stubStorage(items: Record<string, string>) {
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items[key] ?? null,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("定数", () => {
  it("既定の質問候補とlocalStorageキーは既存のまま", () => {
    expect(DEFAULT_EXAMPLES).toEqual(["FedEx発送登録漏れがないか確認してください"]);
    expect(EXAMPLES_STORAGE_KEY).toBe("invoice-site-ai-investigation-examples");
    expect(HISTORY_STORAGE_KEY).toBe("invoice-site-ai-investigation-history");
  });
});

describe("loadExamples", () => {
  it("windowが無い環境では既定の候補", () => {
    expect(loadExamples()).toEqual(DEFAULT_EXAMPLES);
  });

  it("保存済みの候補を既定の後ろへ重複排除して足す", () => {
    stubStorage({
      [EXAMPLES_STORAGE_KEY]: JSON.stringify([
        "独自の質問",
        "FedEx発送登録漏れがないか確認してください", // 既定と重複
        "  ", // 空白のみは捨てる
        42, // 文字列以外は捨てる
      ]),
    });
    expect(loadExamples()).toEqual([...DEFAULT_EXAMPLES, "独自の質問"]);
  });

  it("配列以外・壊れたJSONは既定に戻す", () => {
    stubStorage({ [EXAMPLES_STORAGE_KEY]: JSON.stringify({ not: "array" }) });
    expect(loadExamples()).toEqual(DEFAULT_EXAMPLES);
    stubStorage({ [EXAMPLES_STORAGE_KEY]: "{broken" });
    expect(loadExamples()).toEqual(DEFAULT_EXAMPLES);
  });
});

describe("loadHistory", () => {
  const validItem = {
    id: "1",
    question: "q",
    includeEbay: true,
    createdAt: "2026-09-20T00:00:00.000Z",
    result: { answer: "a", evidence: [] },
  };

  it("windowが無い環境では空配列", () => {
    expect(loadHistory()).toEqual([]);
  });

  it("形の正しい項目だけを通す", () => {
    stubStorage({
      [HISTORY_STORAGE_KEY]: JSON.stringify([
        validItem,
        { id: 2, question: "型違い" },
        { ...validItem, result: { answer: 123 } },
        null,
        "text",
      ]),
    });
    expect(loadHistory()).toEqual([validItem]);
  });

  it("配列以外・壊れたJSONは空配列", () => {
    stubStorage({ [HISTORY_STORAGE_KEY]: JSON.stringify("not-array") });
    expect(loadHistory()).toEqual([]);
    stubStorage({ [HISTORY_STORAGE_KEY]: "{broken" });
    expect(loadHistory()).toEqual([]);
  });
});
