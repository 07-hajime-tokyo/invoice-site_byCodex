import { afterEach, describe, expect, it, vi } from "vitest";
import { dbRecordToTradeRecord, normalizeTradeDataPartner, runWhenIdle } from "./model";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("normalizeTradeDataPartner", () => {
  it("hennes kamusien（NFKC・大文字小文字無視）をサイモンに置換する", () => {
    expect(normalizeTradeDataPartner("hennes kamusien")).toBe("サイモン");
    expect(normalizeTradeDataPartner("  Hennes Kamusien ")).toBe("サイモン");
  });

  it("それ以外はトリムして返す", () => {
    expect(normalizeTradeDataPartner(" ルカ ")).toBe("ルカ");
    expect(normalizeTradeDataPartner(null)).toBe("");
    expect(normalizeTradeDataPartner(undefined)).toBe("");
  });
});

describe("dbRecordToTradeRecord", () => {
  const baseRow = {
    id: 1,
    month: "4",
    partner: "ルカ",
    no: 500,
    paymentDate: "2026-04-01",
    productName: "New3DSLL",
    quantity: "3.00",
    unitPrice: "100.5049",
    currency: "ユーロ",
    unitPriceJPY: "16000.4",
    status: "complete",
    procurement: "",
    shippingFromTokyo: "",
    totalSales: "48001.5",
    procurementTotal: "30000",
    refund: null,
    shippingCost: "1650",
    customsDuty: "12.6",
    profitWithRefund: "16350",
    cumulativeProfit: "0",
  };

  it("年・年月を抽出し、数値文字列を丸めて変換する", () => {
    const rec = dbRecordToTradeRecord(baseRow);
    expect(rec.year).toBe("2026");
    expect(rec.yearMonth).toBe("2026-04");
    expect(rec.partner).toBe("ルカ");
    expect(rec.quantity).toBe(3);
    expect(rec.unitPrice).toBe(100.5); // 小数2桁へ丸め
    expect(rec.unitPriceJPY).toBe(16000); // 整数へ丸め
    expect(rec.totalSales).toBe(48002);
    expect(rec.refund).toBe(0);
    expect(rec.customsDuty).toBe(13);
  });

  it("支払日が空なら年・年月は空、null列はデフォルト値になる", () => {
    const rec = dbRecordToTradeRecord({
      ...baseRow,
      paymentDate: null,
      partner: null,
      no: null,
      productName: null,
      currency: null,
      status: null,
      quantity: null,
    });
    expect(rec.year).toBe("");
    expect(rec.yearMonth).toBe("");
    expect(rec.partner).toBe("");
    expect(rec.no).toBe(0);
    expect(rec.productName).toBe("");
    expect(rec.currency).toBe("");
    expect(rec.status).toBe("");
    expect(rec.quantity).toBe(0);
  });

  it("hennes kamusien の取引相手はサイモンとして表示される", () => {
    const rec = dbRecordToTradeRecord({ ...baseRow, partner: "hennes kamusien" });
    expect(rec.partner).toBe("サイモン");
  });
});

describe("runWhenIdle", () => {
  it("requestIdleCallback があればそれを使い、キャンセル関数を返す", () => {
    const requestIdleCallback = vi.fn().mockReturnValue(42);
    const cancelIdleCallback = vi.fn();
    vi.stubGlobal("window", { requestIdleCallback, cancelIdleCallback });

    const cb = vi.fn();
    const cancel = runWhenIdle(cb, 5000);
    expect(requestIdleCallback).toHaveBeenCalledWith(cb, { timeout: 5000 });
    cancel();
    expect(cancelIdleCallback).toHaveBeenCalledWith(42);
  });

  it("requestIdleCallback が無ければ setTimeout にフォールバックする", () => {
    const setTimeoutSpy = vi.fn().mockReturnValue(7);
    const clearTimeoutSpy = vi.fn();
    vi.stubGlobal("window", { setTimeout: setTimeoutSpy, clearTimeout: clearTimeoutSpy });

    const cb = vi.fn();
    const cancel = runWhenIdle(cb, 5000);
    expect(setTimeoutSpy).toHaveBeenCalledWith(cb, 5000);
    cancel();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(7);
  });
});
