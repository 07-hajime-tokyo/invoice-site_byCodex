/**
 * AI調査画面 表示用純関数の基準テスト。
 * 抽出前の AiInvestigation.tsx と同じ出力を固定する。
 * formatHistoryDate は実行環境のタイムゾーンに依存するため、形だけを緩く検証する。
 */
import { describe, expect, it } from "vitest";
import {
  buildDeliveryHistoryUrl,
  buildSearchUrl,
  displayDate,
  firstSearchTerm,
  formatCellValue,
  formatEbayOrderSummary,
  formatEbayStatus,
  formatHistoryDate,
  getEbayStatusCode,
  getEvidenceCellLink,
  invoiceNoFromDeliveryNo,
  splitInvestigationAnswer,
  summarizeProducts,
  toNumber,
} from "./format";

describe("formatHistoryDate", () => {
  it("不正な日付は入力文字列をそのまま返す", () => {
    expect(formatHistoryDate("not-a-date")).toBe("not-a-date");
    expect(formatHistoryDate("")).toBe("");
  });

  it("有効な日付は 月/日 時:分 形式（ローカルTZ依存のため形だけ確認）", () => {
    expect(formatHistoryDate("2026-09-20T10:05:00.000Z")).toMatch(/^\d{1,2}\/\d{1,2} \d{2}:\d{2}$/);
  });
});

describe("formatCellValue", () => {
  it("null / undefined / 空文字は -、0は0のまま", () => {
    expect(formatCellValue(null)).toBe("-");
    expect(formatCellValue(undefined)).toBe("-");
    expect(formatCellValue("")).toBe("-");
    expect(formatCellValue(0)).toBe("0");
  });

  it("真偽値は あり / なし", () => {
    expect(formatCellValue(true)).toBe("あり");
    expect(formatCellValue(false)).toBe("なし");
  });

  it("その他は文字列化", () => {
    expect(formatCellValue(12)).toBe("12");
    expect(formatCellValue("abc")).toBe("abc");
  });
});

describe("toNumber", () => {
  it("カンマ区切りを外して数値化、読めなければ0", () => {
    expect(toNumber("1,234")).toBe(1234);
    expect(toNumber(" 12 ")).toBe(12);
    expect(toNumber("abc")).toBe(0);
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("")).toBe(0);
  });
});

describe("invoiceNoFromDeliveryNo", () => {
  it("出庫No接頭辞からインボイスNoを読む（No.接頭辞も可）", () => {
    expect(invoiceNoFromDeliveryNo("405_Maxim260807")).toBe("405");
    expect(invoiceNoFromDeliveryNo("No.406_Sammy")).toBe("406");
  });

  it("読めない箱IDは入力そのまま、空は -", () => {
    expect(invoiceNoFromDeliveryNo("B000002")).toBe("B000002");
    expect(invoiceNoFromDeliveryNo("")).toBe("-");
    expect(invoiceNoFromDeliveryNo(null)).toBe("-");
  });
});

describe("displayDate", () => {
  it("ハイフンをスラッシュへ、空は -", () => {
    expect(displayDate("2026-09-20")).toBe("2026/09/20");
    expect(displayDate("  ")).toBe("-");
    expect(displayDate(null)).toBe("-");
  });
});

describe("buildDeliveryHistoryUrl", () => {
  it("group と historyId をクエリに積む", () => {
    expect(buildDeliveryHistoryUrl({ deliveryNo: "405_Maxim260807", historyId: 12 }))
      .toBe("/inventory/delivery-history?group=405&historyId=12");
  });

  it("どちらも無ければクエリなし", () => {
    expect(buildDeliveryHistoryUrl({})).toBe("/inventory/delivery-history");
  });

  it("出庫Noが読めない場合もその文字列をgroupに使う", () => {
    expect(buildDeliveryHistoryUrl({ deliveryNo: "B000002" }))
      .toBe("/inventory/delivery-history?group=B000002");
  });
});

describe("buildSearchUrl / firstSearchTerm", () => {
  it("qパラメータをURLエンコードして付ける", () => {
    expect(buildSearchUrl("/inventory/purchases", "405_ABC_1/2")).toBe("/inventory/purchases?q=405_ABC_1%2F2");
    expect(buildSearchUrl("/inventory/deliveries", "a b")).toBe("/inventory/deliveries?q=a+b");
  });

  it("firstSearchTerm は「 / 」区切りかカンマ区切りの先頭だけを取る", () => {
    expect(firstSearchTerm("A / B / C")).toBe("A");
    expect(firstSearchTerm("A,B")).toBe("A");
    expect(firstSearchTerm("single")).toBe("single");
  });
});

describe("formatEbayStatus / getEbayStatusCode", () => {
  it("既知コードは日本語、未知はそのまま、空は -", () => {
    expect(formatEbayStatus("FULFILLED")).toBe("発送済み");
    expect(formatEbayStatus("NOT_PAID")).toBe("未払い");
    expect(formatEbayStatus("SOMETHING_ELSE")).toBe("SOMETHING_ELSE");
    expect(formatEbayStatus("")).toBe("-");
    expect(formatEbayStatus(null)).toBe("-");
  });

  it("getEbayStatusCode はtrimして大文字化", () => {
    expect(getEbayStatusCode(" paid ")).toBe("PAID");
    expect(getEbayStatusCode(null)).toBe("");
  });
});

describe("formatEbayOrderSummary", () => {
  const order = (status: NonNullable<Parameters<typeof formatEbayOrderSummary>[0]["status"]>) =>
    ({ orderId: "X", ok: true, status });

  it("APIエラー時はエラーメッセージ（無ければ既定文言）", () => {
    expect(formatEbayOrderSummary({ orderId: "X", ok: false, error: "boom" })).toBe("boom");
    expect(formatEbayOrderSummary({ orderId: "X", ok: false })).toBe("eBay APIで確認できませんでした");
  });

  it("キャンセルと返金の組み合わせ", () => {
    expect(formatEbayOrderSummary(order({ cancelState: "CANCELED", refundCount: 1 }))).toBe("キャンセル返金済み");
    expect(formatEbayOrderSummary(order({ cancelState: "CANCELED" }))).toBe("キャンセル済み");
    expect(formatEbayOrderSummary(order({ cancelRequestCount: 1 }))).toBe("キャンセル済み");
    expect(formatEbayOrderSummary(order({ refundStatus: "PARTIALLY_REFUNDED" }))).toBe("返金済み");
  });

  it("発送・支払い状態", () => {
    expect(formatEbayOrderSummary(order({ orderFulfillmentStatus: "FULFILLED", orderPaymentStatus: "PAID" })))
      .toBe("発送済み・支払い済み");
    expect(formatEbayOrderSummary(order({ orderFulfillmentStatus: "FULFILLED" }))).toBe("発送済み");
    expect(formatEbayOrderSummary(order({ orderFulfillmentStatus: "NOT_STARTED" }))).toBe("未発送");
  });

  it("それ以外はラベルを / でつなぎ、何も無ければ 確認済み", () => {
    expect(formatEbayOrderSummary(order({ orderFulfillmentStatus: "IN_PROGRESS", orderPaymentStatus: "PENDING" })))
      .toBe("処理中 / 保留");
    expect(formatEbayOrderSummary(order({}))).toBe("確認済み");
  });
});

describe("getEvidenceCellLink", () => {
  it("空欄セルはリンクなし", () => {
    expect(getEvidenceCellLink("出庫履歴", "deliveryNo", {}, "-")).toBeNull();
    expect(getEvidenceCellLink("出庫履歴", "deliveryNo", {}, "")).toBeNull();
  });

  it("deliveryNo は出庫履歴URLへ", () => {
    expect(getEvidenceCellLink("出庫履歴", "deliveryNo", { deliveryNo: "405_Maxim260807" }, "405_Maxim260807"))
      .toBe("/inventory/delivery-history?group=405");
  });

  it("managementNo(s) はセクションで遷移先が変わる", () => {
    expect(getEvidenceCellLink("入庫管理 発注", "managementNo", {}, "405_ABC_1/2"))
      .toBe("/inventory/purchases?q=405_ABC_1%2F2");
    expect(getEvidenceCellLink("出庫履歴", "managementNos", {}, "A1 / B2"))
      .toBe("/inventory/deliveries?q=A1");
  });

  it("その他のキーはリンクなし", () => {
    expect(getEvidenceCellLink("出庫履歴", "title", {}, "何か")).toBeNull();
  });
});

describe("splitInvestigationAnswer", () => {
  it("見出しが無ければ全文がsummary", () => {
    expect(splitInvestigationAnswer("結論だけ。")).toEqual({ summary: "結論だけ。", details: "" });
  });

  it("## 詳細 などの見出し以降をdetailsへ分割", () => {
    const result = splitInvestigationAnswer("要約です。\n\n## 詳細\n本文です。");
    expect(result.summary).toBe("要約です。");
    expect(result.details).toBe("## 詳細\n本文です。");
  });

  it("他の見出し（数量サマリー等）でも分割される", () => {
    const result = splitInvestigationAnswer("要約\n## 数量サマリー\n表");
    expect(result.summary).toBe("要約");
    expect(result.details).toBe("## 数量サマリー\n表");
  });
});

describe("summarizeProducts", () => {
  it("商品名ごとに数量を合算し、数量なしは1と数える", () => {
    expect(summarizeProducts([
      { title: "PSP1000", quantity: 2 },
      { title: "PSP1000", quantity: "1" },
      { productName: "PSP2000" },
      { title: "" },
    ])).toEqual(["PSP1000 x3", "PSP2000 x1", "- x1"]);
  });
});
