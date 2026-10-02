import { describe, expect, it } from "vitest";
import {
  buildSiteResultMaps,
  buildPendingTaskDetail,
  buildCrawlFailedTaskDetail,
  buildStaleTaskDetail,
  collectReceiptAckFailedSites,
  deriveStatusFromIngest,
  isReceiptAckStale,
  resolveReceiptAckNoteFromCrawlItem,
  shouldRecheckReceiptAckCandidate,
} from "./receiptAck";

function makeReceiptAckRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    supplierUrl: "https://page.auctions.yahoo.co.jp/jp/auction/c1231839191",
    receiptAckStatus: null,
    receiptAckSource: null,
    receiptAckAt: null,
    receiptAckNote: null,
    ...overrides,
  } as any;
}

function deriveReceiptAckForTest(rowOverrides: Record<string, unknown>, payload: Parameters<typeof buildSiteResultMaps>[0]) {
  const row = makeReceiptAckRow(rowOverrides);
  return deriveStatusFromIngest(row, payload, buildSiteResultMaps(payload));
}

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

  it("ヤフオクの商品が巡回結果に無くても既に済なら据え置く", () => {
    const receiptAckAt = new Date("2026-09-24T10:00:00.000Z");
    const next = deriveReceiptAckForTest(
      {
        receiptAckStatus: "done",
        receiptAckSource: "crawl",
        receiptAckAt,
        receiptAckNote: "取引が完了しました",
      },
      {
        crawledAt: "2026-10-02T01:00:00.000Z",
        sites: [{ site: "yahuoku", ok: true, items: [] }],
      },
    );

    expect(next).toEqual({
      status: "done",
      source: "crawl",
      at: receiptAckAt,
      note: "取引が完了しました",
    });
  });

  it("ヤフオクの商品が巡回結果に無い手動済みはmanualのまま据え置く", () => {
    const receiptAckAt = new Date("2026-09-24T10:00:00.000Z");
    const next = deriveReceiptAckForTest(
      {
        receiptAckStatus: "done",
        receiptAckSource: "manual",
        receiptAckAt,
        receiptAckNote: "手動で済にした",
      },
      {
        crawledAt: "2026-10-02T01:00:00.000Z",
        sites: [{ site: "yahuoku", ok: true, items: [] }],
      },
    );

    expect(next).toEqual({
      status: "done",
      source: "manual",
      at: receiptAckAt,
      note: "手動で済にした",
    });
  });

  it("ヤフオクの商品が巡回結果に無くpendingなら従来通り判定不可にする", () => {
    const next = deriveReceiptAckForTest(
      { receiptAckStatus: "pending", receiptAckSource: "crawl" },
      {
        crawledAt: "2026-10-02T01:00:00.000Z",
        sites: [{ site: "yahuoku", ok: true, items: [] }],
      },
    );

    expect(next.status).toBe("unknown");
    expect(next.source).toBe("crawl");
    expect(next.note).toBe("落札一覧に見つかりません");
    expect(next.at.toISOString()).toBe("2026-10-02T01:00:00.000Z");
  });

  it("ヤフオクの商品が巡回結果に含まれると既存済みより巡回内容を優先する", () => {
    const next = deriveReceiptAckForTest(
      {
        receiptAckStatus: "done",
        receiptAckSource: "crawl",
        receiptAckAt: new Date("2026-09-24T10:00:00.000Z"),
        receiptAckNote: "取引が完了しました",
      },
      {
        crawledAt: "2026-10-02T01:00:00.000Z",
        sites: [{ site: "yahuoku", ok: true, items: [{ itemId: "c1231839191", status: "awaiting_review" }] }],
      },
    );

    expect(next).toEqual({
      status: "pending",
      source: "crawl",
      at: new Date("2026-10-02T01:00:00.000Z"),
      note: "awaiting_review",
    });
  });

  it("メルカリの商品が巡回結果に無い場合は従来通り完了扱いにする", () => {
    const next = deriveReceiptAckForTest(
      {
        supplierUrl: "https://jp.mercari.com/item/m12345678901",
        receiptAckStatus: "pending",
        receiptAckSource: "crawl",
      },
      {
        crawledAt: "2026-10-02T01:00:00.000Z",
        sites: [{ site: "mercari", ok: true, items: [] }],
      },
    );

    expect(next).toEqual({
      status: "done",
      source: "crawl",
      at: new Date("2026-10-02T01:00:00.000Z"),
      note: "未完了一覧に無いため完了扱い",
    });
  });
});
