import { describe, expect, it } from "vitest";
import { buildSnapshotBreakdown } from "@shared/inventorySnapshot";
import {
  buildTrendChartData,
  buildTrendTableRows,
  filterInventoryChangeLogs,
  type SnapshotRow,
  type ChangeLogRow,
} from "./model";
import { fmt as trendAmount, fmtDateTime } from "./presentation";
import {
  fmt as monthlyAmount,
  fmtForeign,
  parseDomesticNote,
  fmtDate,
} from "../monthly-report/presentation";

function snapshot(id: number, total: number | null): SnapshotRow {
  return {
    id,
    date: `2026-09-${String(id).padStart(2, "0")}`,
    label: null,
    createdBy: null,
    createdAt: new Date(0),
    breakdown:
      total === null
        ? null
        : buildSnapshotBreakdown(
            [
              {
                category: "test",
                quantity: 1,
                unitPrice: total,
                totalValue: total,
              },
            ],
            []
          ),
  };
}

describe("在庫推移の表示用モデル", () => {
  it("グラフは壊れた集計を除外し、丸めて古い順にする。元配列は保持する", () => {
    const rows = [snapshot(30, 20.6), snapshot(29, null), snapshot(28, 10.2)];
    const before = structuredClone(rows);
    expect(buildTrendChartData(rows)).toEqual([
      { date: "09-28", 売り先未定: 10, 売り先決定済み: 0, 合計: 10 },
      { date: "09-30", 売り先未定: 21, 売り先決定済み: 0, 合計: 21 },
    ]);
    expect(rows).toEqual(before);
  });
  it("差分は隣の記録とだけ比較し、nullを飛び越さない", () => {
    const rows = [
      snapshot(30, 10.5),
      snapshot(29, 20),
      snapshot(28, null),
      snapshot(27, 0),
    ];
    expect(buildTrendTableRows(rows).map(row => row.delta)).toEqual([
      -9.5,
      null,
      null,
      null,
    ]);
    expect(buildTrendTableRows([])).toEqual([]);
  });
  it("検索は商品・メモ・操作者・種類を対象にし、空検索は元配列を返す", () => {
    const rows = [
      {
        title: "Console",
        memo: null,
        operatorName: null,
        changeType: "created",
      },
      {
        title: null,
        memo: "Local CHECK",
        operatorName: "Suzuki",
        changeType: "set",
      },
    ] as ChangeLogRow[];
    expect(filterInventoryChangeLogs(rows, " ")).toBe(rows);
    for (const query of [" console ", "CREATED"])
      expect(filterInventoryChangeLogs(rows, query)).toEqual([rows[0]]);
    for (const query of ["check", "SUZUKI", "set"])
      expect(filterInventoryChangeLogs(rows, query)).toEqual([rows[1]]);
    expect(filterInventoryChangeLogs(rows, "missing")).toEqual([]);
  });
});

describe("月次と推移で異なる既存の表示規則", () => {
  it("推移の整数丸めと月次の小数表示を混同しない", () => {
    expect(trendAmount(1234.5)).toBe("¥1,235");
    expect(monthlyAmount(1234.5)).toBe("¥1,234.5");
    expect(monthlyAmount(12, "$ ")).toBe("$ 12");
    expect(trendAmount(null)).toBe("-");
    expect(monthlyAmount(undefined)).toBe("-");
    expect(fmtForeign(12.345, "EUR")).toBe("12.35ユーロ");
    expect(fmtForeign(0, "USD")).toBe("0ドル");
  });
  it("国内判定と未解釈の日付を維持する", () => {
    expect(parseDomesticNote("TOYNET local")).toEqual({
      isDomestic: true,
      detail: "TOYNET local",
    });
    expect(parseDomesticNote("overseas")).toEqual({
      isDomestic: false,
      detail: null,
    });
    expect(parseDomesticNote(null)).toEqual({
      isDomestic: false,
      detail: null,
    });
    expect(fmtDate("invalid-date")).toBe("invalid-date");
    expect(fmtDateTime("invalid-date")).toBe("invalid-date");
  });
});
