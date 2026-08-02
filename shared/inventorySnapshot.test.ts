import { describe, it, expect } from "vitest";
import {
  DAILY_SNAPSHOT_PREFIX,
  buildDailySnapshotLabel,
  buildSnapshotBreakdown,
  isDailySnapshotLabel,
  parseDailySnapshotDate,
  todayInJst,
  yearMonthOf,
} from "./inventorySnapshot";

describe("日次スナップショットのラベル", () => {
  it("ラベルを組み立てて日付を取り出せる", () => {
    const label = buildDailySnapshotLabel("2026-08-02");
    expect(label).toBe(`${DAILY_SNAPSHOT_PREFIX}2026-08-02`);
    expect(isDailySnapshotLabel(label)).toBe(true);
    expect(parseDailySnapshotDate(label)).toBe("2026-08-02");
  });

  it("月次レポートのラベルは日次と誤認しない", () => {
    expect(isDailySnapshotLabel("2026-07 月末スナップショット（入金反映後・実査前）")).toBe(false);
    expect(parseDailySnapshotDate("2026-03 棚卸しレポート")).toBeNull();
    expect(parseDailySnapshotDate(null)).toBeNull();
    // 接頭辞があっても日付形式でなければ日次とはみなさない
    expect(parseDailySnapshotDate(`${DAILY_SNAPSHOT_PREFIX}メモ`)).toBeNull();
  });

  it("JSTで日付を判定する（UTCの日付とずれる時間帯）", () => {
    // 2026-08-01T16:00Z は JST では 2026-08-02 01:00
    expect(todayInJst(new Date("2026-08-01T16:00:00Z"))).toBe("2026-08-02");
    expect(todayInJst(new Date("2026-08-01T14:59:00Z"))).toBe("2026-08-01");
  });

  it("年月を切り出せる", () => {
    expect(yearMonthOf("2026-08-02")).toBe("2026-08");
  });
});

describe("区分別サマリー", () => {
  const inventorySummary = [
    { category: "ゴルフ", quantity: 2, unitPrice: 35400, totalValue: 70800 },
    { category: "ゴルフ", quantity: 1, unitPrice: 0, totalValue: 0 },
    { category: "スイッチ", quantity: 5, unitPrice: 14000, totalValue: 70000 },
    { category: "", quantity: 1, unitPrice: null, totalValue: null },
  ];

  it("合計・点数・0円計上行を集計する", () => {
    const result = buildSnapshotBreakdown(inventorySummary, []);
    expect(result.totalAmount).toBe(140800);
    expect(result.rowCount).toBe(4);
    expect(result.itemCount).toBe(9);
    // 単価0とnullの2行
    expect(result.zeroPricedRowCount).toBe(2);
    // カテゴリ未設定は「未分類」に寄せる
    expect(result.categories.map((c) => c.category)).toContain("未分類");
    // 金額の大きい順。ゴルフは2行合計で70,800なのでスイッチ70,000より上にくる
    expect(result.categories[0]).toEqual({ category: "ゴルフ", amount: 70800, rowCount: 2, itemCount: 3 });
    expect(result.categories[1]).toEqual({ category: "スイッチ", amount: 70000, rowCount: 1, itemCount: 5 });
  });

  it("売り先決定済みを差し引いて売り先未定を出す", () => {
    const invoiceList = [
      {
        invoiceNo: "397",
        stockItems: [{ inventoryId: 1, quantity: 2, unitPrice: 35400 }],
        purchaseItems: [{ quantity: 1, unitPrice: 12000 }],
      },
    ];
    const result = buildSnapshotBreakdown(inventorySummary, invoiceList);
    expect(result.assignedAmount).toBe(70800);
    expect(result.unassignedAmount).toBe(140800 - 70800);
    // 発注済み・未到着は在庫金額に含めず別枠で持つ
    expect(result.onOrderAmount).toBe(12000);
    expect(result.totalAmount).toBe(140800);
  });

  it("同じ在庫が複数インボイスに現れても二重計上しない", () => {
    const invoiceList = [
      { invoiceNo: "397", stockItems: [{ inventoryId: 1, quantity: 2, unitPrice: 35400 }] },
      { invoiceNo: "398", stockItems: [{ inventoryId: 1, quantity: 2, unitPrice: 35400 }] },
    ];
    const result = buildSnapshotBreakdown(inventorySummary, invoiceList);
    expect(result.assignedAmount).toBe(70800);
  });

  it("在庫が空でも壊れない", () => {
    const result = buildSnapshotBreakdown([], []);
    expect(result.totalAmount).toBe(0);
    expect(result.unassignedAmount).toBe(0);
    expect(result.categories).toEqual([]);
  });
});
