import { describe, expect, it } from "vitest";
import {
  formatReceiptAckAt,
  getReceiptAckLabel,
  normalizeReceiptAckSource,
  normalizeReceiptAckStatus,
  receiptAckTitle,
} from "./receiptAck";
import type { PurchaseHistoryItem } from "./types";

function makeItem(patch: Partial<PurchaseHistoryItem> = {}): PurchaseHistoryItem {
  return {
    id: 1,
    zaicoId: 100,
    kanriNo: "PH-1",
    title: "テスト商品",
    category: null,
    supplier: null,
    quantity: "1",
    unitPrice: null,
    purchaseDate: "2026-09-01",
    inventoryId: null,
    cancelled: 0,
    operatorName: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    ...patch,
  };
}

describe("normalizeReceiptAckStatus", () => {
  it("有効なステータスはそのまま返す", () => {
    expect(normalizeReceiptAckStatus("done")).toBe("done");
    expect(normalizeReceiptAckStatus("pending")).toBe("pending");
    expect(normalizeReceiptAckStatus("not_required")).toBe("not_required");
    expect(normalizeReceiptAckStatus("unknown")).toBe("unknown");
    expect(normalizeReceiptAckStatus("unavailable")).toBe("unavailable");
  });

  it("前後の空白をトリムして判定する", () => {
    expect(normalizeReceiptAckStatus("  done  ")).toBe("done");
  });

  it("無効値・空値はnullを返す", () => {
    expect(normalizeReceiptAckStatus("invalid")).toBeNull();
    expect(normalizeReceiptAckStatus("")).toBeNull();
    expect(normalizeReceiptAckStatus("   ")).toBeNull();
    expect(normalizeReceiptAckStatus(null)).toBeNull();
    expect(normalizeReceiptAckStatus(undefined)).toBeNull();
  });
});

describe("normalizeReceiptAckSource", () => {
  it("crawl/manualのみ許可する", () => {
    expect(normalizeReceiptAckSource("crawl")).toBe("crawl");
    expect(normalizeReceiptAckSource("manual")).toBe("manual");
  });

  it("それ以外はnullを返す", () => {
    expect(normalizeReceiptAckSource("auto")).toBeNull();
    expect(normalizeReceiptAckSource("")).toBeNull();
    expect(normalizeReceiptAckSource(null)).toBeNull();
    expect(normalizeReceiptAckSource(undefined)).toBeNull();
  });
});

describe("getReceiptAckLabel", () => {
  it("done + manual は「済（手動）」", () => {
    expect(getReceiptAckLabel({ receiptAckStatus: "done", receiptAckSource: "manual" })).toBe("済（手動）");
  });

  it("done + crawl は「済」", () => {
    expect(getReceiptAckLabel({ receiptAckStatus: "done", receiptAckSource: "crawl" })).toBe("済");
  });

  it("各ステータスのラベル", () => {
    expect(getReceiptAckLabel({ receiptAckStatus: "pending", receiptAckSource: null })).toBe("未");
    expect(getReceiptAckLabel({ receiptAckStatus: "not_required", receiptAckSource: null })).toBe("対象外");
    expect(getReceiptAckLabel({ receiptAckStatus: "unknown", receiptAckSource: null })).toBe("判定不可");
    expect(getReceiptAckLabel({ receiptAckStatus: "unavailable", receiptAckSource: null })).toBe("確認不可");
  });

  it("ステータス不明時は空文字", () => {
    expect(getReceiptAckLabel({ receiptAckStatus: null, receiptAckSource: null })).toBe("");
    expect(getReceiptAckLabel({ receiptAckStatus: "invalid", receiptAckSource: "manual" })).toBe("");
  });
});

describe("formatReceiptAckAt", () => {
  it("Dateをja-JP形式でフォーマットする", () => {
    const formatted = formatReceiptAckAt(new Date(2026, 8, 15, 9, 5));
    expect(formatted).toBe("2026/09/15 09:05");
  });

  it("文字列日時も受け付ける", () => {
    const formatted = formatReceiptAckAt("2026-09-15T09:05:00");
    expect(formatted).toBe("2026/09/15 09:05");
  });

  it("空値・不正値は空文字を返す", () => {
    expect(formatReceiptAckAt(null)).toBe("");
    expect(formatReceiptAckAt(undefined)).toBe("");
    expect(formatReceiptAckAt("")).toBe("");
    expect(formatReceiptAckAt("not-a-date")).toBe("");
  });
});

describe("receiptAckTitle", () => {
  it("メモと最終確認日時を改行で結合する", () => {
    const item = makeItem({
      receiptAckNote: "巡回で確認",
      receiptAckAt: new Date(2026, 8, 15, 9, 5),
    });
    expect(receiptAckTitle(item)).toBe("巡回で確認\n最終確認: 2026/09/15 09:05");
  });

  it("メモのみの場合はメモだけ", () => {
    const item = makeItem({ receiptAckNote: "メモのみ", receiptAckAt: null });
    expect(receiptAckTitle(item)).toBe("メモのみ");
  });

  it("日時のみの場合は最終確認行だけ", () => {
    const item = makeItem({ receiptAckNote: null, receiptAckAt: new Date(2026, 8, 15, 9, 5) });
    expect(receiptAckTitle(item)).toBe("最終確認: 2026/09/15 09:05");
  });

  it("両方なければ空文字", () => {
    expect(receiptAckTitle(makeItem())).toBe("");
  });
});
