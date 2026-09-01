import { describe, expect, it } from "vitest";
import {
  buildCrawlFailedTaskDetail,
  buildStaleTaskDetail,
  collectReceiptAckFailedSites,
  isReceiptAckStale,
} from "./receiptAck";

describe("receiptAck server helpers", () => {
  it("対象商品が0件でも巡回失敗サイトをタスク詳細に残す", () => {
    const failedSites = Array.from(collectReceiptAckFailedSites([{ site: "mercari", ok: false, error: "login_required" }]).values());

    expect(failedSites).toEqual([{ site: "mercari", error: "login_required", affected: 0 }]);
    expect(buildCrawlFailedTaskDetail(failedSites)).toContain("mercari: 影響件数不明 / login_required");
  });

  it("最後の巡回が古い、未記録、不正な値の場合は途絶扱いにする", () => {
    const now = new Date("2026-09-01T12:00:00.000Z");

    expect(isReceiptAckStale("2026-08-30T23:59:59.000Z", 36, now)).toBe(true);
    expect(isReceiptAckStale("2026-08-31T01:00:01.000Z", 36, now)).toBe(false);
    expect(isReceiptAckStale(null, 36, now)).toBe(true);
    expect(isReceiptAckStale("not-a-date", 36, now)).toBe(true);
  });

  it("巡回途絶タスクの詳細に最後の巡回時刻を入れる", () => {
    expect(buildStaleTaskDetail("2026-09-01T01:23:45.000Z", 36)).toContain("最後に届いた巡回: 2026-09-01T01:23:45.000Z");
    expect(buildStaleTaskDetail(null, 36)).toContain("まだ一度も巡回結果が届いていません。");
  });
});
