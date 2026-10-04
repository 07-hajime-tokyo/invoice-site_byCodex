import { describe, expect, it } from "vitest";
import type { TradeRecord } from "@/lib/csvUtils";
import {
  MOBILE_META_COLUMNS,
  PAGE_SIZE_OPTIONS,
  VISIBLE_COLUMNS,
  getTradeRecordId,
} from "./dataTableModel";

function makeRecord(patch: Partial<TradeRecord> = {}): TradeRecord {
  return {
    id: 1,
    month: "4",
    year: "2026",
    yearMonth: "2026-04",
    partner: "ルカ",
    no: 500,
    paymentDate: "2026-04-01",
    productName: "New3DSLL",
    quantity: 3,
    unitPrice: 100,
    currency: "ユーロ",
    unitPriceJPY: 16000,
    status: "",
    procurement: "",
    shippingFromTokyo: "",
    totalSales: 48000,
    procurementTotal: 30000,
    refund: 0,
    shippingCost: 1650,
    customsDuty: 0,
    profitWithRefund: 16350,
    cumulativeProfit: 0,
    ...patch,
  };
}

describe("getTradeRecordId", () => {
  it("正の有限数の id のみ返す", () => {
    expect(getTradeRecordId(makeRecord({ id: 123 }))).toBe(123);
  });

  it("id が未設定・0以下・非有限なら null", () => {
    expect(getTradeRecordId(makeRecord({ id: undefined }))).toBeNull();
    expect(getTradeRecordId(makeRecord({ id: 0 }))).toBeNull();
    expect(getTradeRecordId(makeRecord({ id: -5 }))).toBeNull();
    expect(getTradeRecordId(makeRecord({ id: Number.NaN }))).toBeNull();
  });
});

describe("表示列定数", () => {
  it("VISIBLE_COLUMNS の列順を保持する", () => {
    expect(VISIBLE_COLUMNS).toEqual([
      "month",
      "partner",
      "no",
      "paymentDate",
      "productName",
      "quantity",
      "unitPrice",
      "currency",
      "unitPriceJPY",
      "status",
      "totalSales",
      "procurementTotal",
      "shippingCost",
      "customsDuty",
      "profitWithRefund",
    ]);
  });

  it("ページサイズ候補とモバイルメタ列を保持する", () => {
    expect(PAGE_SIZE_OPTIONS).toEqual([20, 50, 100]);
    expect(MOBILE_META_COLUMNS).toEqual([
      "quantity",
      "unitPrice",
      "currency",
      "totalSales",
      "procurementTotal",
      "shippingCost",
      "customsDuty",
      "profitWithRefund",
    ]);
  });
});
