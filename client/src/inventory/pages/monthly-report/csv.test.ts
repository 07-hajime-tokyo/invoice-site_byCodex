import { describe, expect, it } from "vitest";
import { buildPreviewReportCsv, buildSavedReportCsv } from "./csv";
import { inventoryCategoryTotal, resolveReportCost } from "./model";
import fixture from "./csv.fixture.json";
import expected from "./csv.expected.json";

describe("棚卸CSVの整理前出力との一致", () => {
  it("保存済みは保存値を使い、引用符・改行・BOMを維持する", () => {
    expect(
      buildSavedReportCsv({
        yearMonth: "2026-09",
        inventorySummaryJson: JSON.stringify(fixture.preview.inventorySummary),
        invoiceListJson: JSON.stringify(fixture.preview.invoiceList),
      })
    ).toBe(expected.saved.contents);
  });
  it("プレビューは解除・ゼロ単価・国内卸・手入力合計を反映する", () => {
    expect(
      buildPreviewReportCsv(
        fixture.preview,
        175,
        fixture.overrides,
        fixture.domestic,
        31
      )
    ).toBe(expected.preview.contents);
  });
  it("保存済みの壊れたJSONは空として扱い、末尾空行の違いを維持する", () => {
    expect(
      buildSavedReportCsv({
        yearMonth: "2026-09",
        inventorySummaryJson: "{",
        invoiceListJson: "{",
      })
    ).toBe(expected.emptySaved.contents);
    expect(
      buildPreviewReportCsv(
        { inventorySummary: [], invoiceList: [] },
        0,
        {},
        [],
        0
      )
    ).toBe(expected.emptyPreview.contents);
  });
  it("在庫金額は既存単価を優先し、カテゴリ内位置で未設定分を補完する", () => {
    expect(
      inventoryCategoryTotal(
        [
          {
            category: "架空",
            items: fixture.preview.inventorySummary.slice(0, 2),
            total: 25,
          },
        ],
        { '架空__架空,商品"A"\n改行__0': 999, 架空__単価未設定__1: 50 }
      )
    ).toBe(175);
    expect(resolveReportCost("missing", 12, {})).toBe(12);
    expect(resolveReportCost("value", 12, { value: null })).toBeNull();
    expect(resolveReportCost("value", 12, { value: 0 })).toBe(0);
  });
});
