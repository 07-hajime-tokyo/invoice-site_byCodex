import { describe, expect, it } from "vitest";
import {
  initialForm,
  createPayloadFromForm,
  resolveCategory,
  initialSplitDraft,
  getDurationMinutes,
  summarizeCompletedLogs,
  formFromLog,
  parseDetails,
  hasDetails,
  type WorkLogRecord,
} from "./model";
const now = new Date("2026-09-30T03:00:00Z");
const log: WorkLogRecord = {
  id: 1,
  workerName: "架空",
  category: "入庫登録",
  status: "running",
  startedAt: "2026-09-30T01:00:00Z",
  endedAt: null,
  manualMinutes: null,
  quantity: 3,
  memo: null,
  sourceType: null,
  sourceId: null,
  detailsJson: null,
  createdBy: null,
  createdAt: now,
};
describe("作業管理の入力と集計", () => {
  it("その他のカテゴリ・空欄・丸め・負数・入力元を保存形式に変換する", () => {
    expect(
      createPayloadFromForm({
        ...initialForm(),
        workerName: " 架空 ",
        category: "その他",
        customCategory: " 検品 ",
        manualMinutes: "1.5",
        quantity: "-3",
        memo: " ",
        sourceId: "delivery-1",
      })
    ).toEqual({
      workerName: "架空",
      category: "検品",
      startedAt: undefined,
      endedAt: undefined,
      manualMinutes: 2,
      quantity: 0,
      memo: undefined,
      sourceType: undefined,
      sourceId: "delivery-1",
      detailsJson: undefined,
    });
    expect(
      createPayloadFromForm({
        ...initialForm(),
        manualMinutes: "invalid",
        quantity: "NaN",
      })
    ).toMatchObject({ manualMinutes: null, quantity: 0 });
    expect(
      resolveCategory({ category: " 入庫登録 ", customCategory: "無視" })
    ).toBe("入庫登録");
  });
  it("表示時間は手入力・完了日時・進行中の現在時刻の順で決まる", () => {
    expect(getDurationMinutes(log, now)).toBe(120);
    expect(
      getDurationMinutes({ ...log, endedAt: "2026-09-30T01:30:00Z" }, now)
    ).toBe(30);
    expect(getDurationMinutes({ ...log, manualMinutes: 0 }, now)).toBe(0);
    expect(getDurationMinutes({ ...log, status: "done" }, now)).toBe(0);
    expect(getDurationMinutes({ ...log, startedAt: "invalid" }, now)).toBe(0);
    expect(
      getDurationMinutes({ ...log, startedAt: "2026-09-30T04:00:00Z" }, now)
    ).toBe(0);
  });
  it("完了集計はカテゴリの出現順・数量を維持し、編集で入力元を落とさない", () => {
    expect(
      summarizeCompletedLogs(
        [
          { ...log, manualMinutes: 30 },
          { ...log, category: "出庫登録", manualMinutes: 60, quantity: 6 },
        ],
        now
      )
    ).toEqual({
      totalMinutes: 90,
      totalQuantity: 9,
      categoryRows: [
        { name: "入庫登録", count: 1, minutes: 30, quantity: 3 },
        { name: "出庫登録", count: 1, minutes: 60, quantity: 6 },
      ],
    });
    expect(
      formFromLog({
        ...log,
        sourceId: "a",
        sourceType: "delivery",
        manualMinutes: 0,
      })
    ).toMatchObject({
      sourceId: "a",
      sourceType: "delivery",
      manualMinutes: "0",
      status: "running",
    });
  });
  it("分割先の優先候補と明細の壊れたJSON・対象種別を維持する", () => {
    const options = ["その他", "入庫登録", "出庫登録"].map((name, id) => ({
      id,
      name,
      sortOrder: id,
    }));
    expect(initialSplitDraft(options).category).toBe("出庫登録");
    expect(initialSplitDraft(options.slice(0, 2)).category).toBe("入庫登録");
    expect(initialSplitDraft().category).toBe("その他");
    expect(parseDetails("{")).toBeNull();
    expect(
      hasDetails({
        ...log,
        sourceType: "delivery",
        detailsJson: '{"items":[{}]}',
      })
    ).toBe(true);
    expect(hasDetails({ ...log, detailsJson: '{"items":[{}]}' })).toBe(false);
  });
});
