import { describe, expect, it } from "vitest";
import {
  classifyReceiptAckUrl,
  parseReceiptAckTarget,
  receiptAckItemKey,
  receiptAckLabel,
  receiptAckSiteCompletesMissingItems,
  resolveMissingReceiptAckTargetStatus,
  resolveReceiptAckStatusFromCrawlItem,
} from "./receiptAck";

describe("receiptAck", () => {
  it("ヤフオクの落札URLから商品IDを抜き出す", () => {
    expect(parseReceiptAckTarget("https://page.auctions.yahoo.co.jp/jp/auction/n1234567890")).toEqual({
      site: "yahuoku",
      itemId: "n1234567890",
    });
    expect(classifyReceiptAckUrl("https://page.auctions.yahoo.co.jp/jp/auction/g1242383118")).toEqual({
      status: "target",
      target: { site: "yahuoku", itemId: "g1242383118" },
    });
  });

  it("ヤフオク取引ナビURLから商品IDを抜き出す", () => {
    expect(parseReceiptAckTarget("https://contact.auctions.yahoo.co.jp/trade/top?aid=g1242383118&oid=12345")).toEqual({
      site: "yahuoku",
      itemId: "g1242383118",
    });
    expect(parseReceiptAckTarget("https://contact.auctions.yahoo.co.jp/trade/top?aID=g1242383118&oid=12345")).toEqual({
      site: "yahuoku",
      itemId: "g1242383118",
    });
    expect(classifyReceiptAckUrl("https://contact.auctions.yahoo.co.jp/trade/top?aid=abc&oid=12345")).toEqual({
      status: "not_required",
    });
  });

  it("メルカリの取引URLと商品URLを対象にする", () => {
    expect(parseReceiptAckTarget("https://jp.mercari.com/item/m12345678901")).toEqual({
      site: "mercari",
      itemId: "m12345678901",
    });
    expect(parseReceiptAckTarget("https://jp.mercari.com/transaction/m98765432109")).toEqual({
      site: "mercari",
      itemId: "m98765432109",
    });
  });

  it("ペイペイフリマのURLから商品IDを抜き出す", () => {
    expect(parseReceiptAckTarget("https://paypayfleamarket.yahoo.co.jp/item/z123456789")).toEqual({
      site: "yahoo_fleamarket",
      itemId: "z123456789",
    });
    expect(parseReceiptAckTarget("https://paypayfleamarket-sec.yahoo.co.jp/item/z123456789/trade/buyer")).toEqual({
      site: "yahoo_fleamarket",
      itemId: "z123456789",
    });
  });

  it("対象外サイトとURL不明を分ける", () => {
    expect(classifyReceiptAckUrl("https://www.suruga-ya.jp/product/detail/123")).toEqual({ status: "not_required" });
    expect(classifyReceiptAckUrl("https://www.suruga-ya.jp/pcmypage/action_sell_search/detail?foo=bar")).toEqual({ status: "not_required" });
    expect(classifyReceiptAckUrl("https://www.amazon.co.jp/your-orders/order-details?orderID=123-4567890-1234567")).toEqual({ status: "not_required" });
    expect(classifyReceiptAckUrl("https://mercari-shops.com/products/abc123")).toEqual({ status: "unknown" });
    expect(classifyReceiptAckUrl("追跡番号不明")).toEqual({
      status: "unknown",
    });
    expect(classifyReceiptAckUrl("")).toEqual({ status: "unknown" });
  });

  it("クロール結果を受取連絡状態に変換する", () => {
    expect(
      resolveReceiptAckStatusFromCrawlItem("yahuoku", {
        itemId: "n1",
        status: "shipped",
      })
    ).toBe("pending");
    expect(
      resolveReceiptAckStatusFromCrawlItem("yahuoku", {
        itemId: "n1",
        status: "shipped",
        isStore: true,
      })
    ).toBe("not_required");
    expect(
      resolveReceiptAckStatusFromCrawlItem("mercari", {
        itemId: "m1",
        status: "awaiting_review",
      })
    ).toBe("pending");
    expect(
      resolveReceiptAckStatusFromCrawlItem("yahoo_fleamarket", {
        itemId: "z1",
        status: "completed",
      })
    ).toBe("done");
    expect(
      resolveReceiptAckStatusFromCrawlItem("mercari", {
        itemId: "m1",
        status: "bundled",
      })
    ).toBe("not_required");
  });

  it("一覧に無い場合に完了扱いできるサイトを限定する", () => {
    expect(receiptAckSiteCompletesMissingItems("mercari")).toBe(true);
    expect(receiptAckSiteCompletesMissingItems("yahoo_fleamarket")).toBe(true);
    expect(receiptAckSiteCompletesMissingItems("yahuoku")).toBe(false);
  });

  it("巡回失敗時は一覧に無くても完了扱いしない", () => {
    expect(resolveMissingReceiptAckTargetStatus("mercari", false)).toBe("unavailable");
    expect(resolveMissingReceiptAckTargetStatus("yahoo_fleamarket", false)).toBe("unavailable");
    expect(resolveMissingReceiptAckTargetStatus("yahuoku", false)).toBe("unavailable");
    expect(resolveMissingReceiptAckTargetStatus("mercari", true)).toBe("done");
    expect(resolveMissingReceiptAckTargetStatus("yahuoku", true)).toBe("unknown");
  });

  it("表示ラベルを返す", () => {
    expect(receiptAckLabel("done", "crawl")).toBe("済");
    expect(receiptAckLabel("done", "manual")).toBe("済（手動）");
    expect(receiptAckLabel("pending")).toBe("未");
  });

  it("照合キーは大文字小文字を吸収する", () => {
    expect(receiptAckItemKey("mercari", "M123")).toBe("mercari:m123");
  });
});
