import { describe, expect, it } from "vitest";
import {
  buildPendingTaskDetail,
  buildCrawlFailedTaskDetail,
  buildStaleTaskDetail,
  collectReceiptAckFailedSites,
  isReceiptAckStale,
  resolveReceiptAckNoteFromCrawlItem,
  shouldRecheckReceiptAckCandidate,
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

  it("巡回で確定済みの行だけ再評価対象から外す", () => {
    expect(shouldRecheckReceiptAckCandidate({ receiptAckStatus: null, receiptAckSource: null })).toBe(true);
    expect(shouldRecheckReceiptAckCandidate({ receiptAckStatus: "done", receiptAckSource: "crawl" })).toBe(false);
    expect(shouldRecheckReceiptAckCandidate({ receiptAckStatus: "done", receiptAckSource: "manual" })).toBe(true);
    expect(shouldRecheckReceiptAckCandidate({ receiptAckStatus: "done", receiptAckSource: null })).toBe(true);
    expect(shouldRecheckReceiptAckCandidate({ receiptAckStatus: "unavailable", receiptAckSource: "crawl" })).toBe(true);
  });

  it("未対応タスク詳細に商品ID、旧管理番号、商品名、仕入先の開くリンクを出す", () => {
    const detail = buildPendingTaskDetail([
      {
        id: 1,
        title: "Nintendo 3DS LL ホワイト本体",
        managementNo: "401_マキシム_3DSLL_4/4",
        labelLegacyManagementNo: "401_マキシム_3DSLL_ラベル_4/4",
        supplierName: "ヤフオク ○○",
        supplierUrl: "https://page.auctions.yahoo.co.jp/jp/auction/h1242058001",
        receivedDate: "2026-08-29",
        receiptAckSource: "crawl",
        receiptAckNote: "shipped",
      } as any,
    ]);

    expect(detail).toContain("入庫済みですが受取連絡がまだです。（1件）");
    expect(detail).toContain("商品ID: h1242058001");
    expect(detail).toContain("旧管理番号: 401_マキシム_3DSLL_ラベル_4/4");
    expect(detail).toContain("商品名: Nintendo 3DS LL ホワイト本体");
    expect(detail).toContain("仕入先: ヤフオク ○○ [開く](https://page.auctions.yahoo.co.jp/jp/auction/h1242058001)");
  });

  it("ヤフオクのストア出品は専用の対象外理由を残す", () => {
    expect(resolveReceiptAckNoteFromCrawlItem("yahuoku", { status: "shipped", isStore: true }, "not_required")).toBe(
      "ヤフオクのストア出品のため受取評価不要"
    );
  });
});
