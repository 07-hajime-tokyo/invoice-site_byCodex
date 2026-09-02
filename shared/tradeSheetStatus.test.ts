import { describe, expect, it } from "vitest";
import {
  applySourceTradeSheetStatuses,
  parseSourceTradeStatusSheetRows,
} from "./tradeSheetStatus";

describe("tradeSheetStatus", () => {
  it("parses invoice continuation rows from the source trade sheet", () => {
    const statuses = parseSourceTradeStatusSheetRows([
      [],
      [],
      ["No.", "", "商品名", "注文数", "", "", "", "状況"],
      ["410", "", "New 2DS LL ホワイト×オレンジ", "3", "", "", "", "complete"],
      ["", "", "New 2DS LL ホワイト×ラベンダー", "1", "", "", "", "残1"],
    ]);

    expect(statuses.get("410")).toEqual([
      {
        invoiceNo: "410",
        productName: "New 2DS LL ホワイト×オレンジ",
        quantity: 3,
        status: "complete",
      },
      {
        invoiceNo: "410",
        productName: "New 2DS LL ホワイト×ラベンダー",
        quantity: 1,
        status: "残1",
      },
    ]);
  });

  it("overlays source sheet statuses by invoice and product name", () => {
    const statuses = parseSourceTradeStatusSheetRows([
      [],
      [],
      ["No.", "", "商品名", "注文数", "", "", "", "状況"],
      ["410", "", "New 2DS LL ホワイト×オレンジ", "3", "", "", "", "complete"],
      ["", "", "New 2DS LL ホワイト×ラベンダー", "1", "", "", "", "残1"],
    ]);

    const rows = applySourceTradeSheetStatuses(
      [
        { no: 410, productName: "New2DSLL オレンジ", status: "残3" },
        { no: 410, productName: "New 2DS LL ホワイト×ラベンダー", status: "complete" },
      ],
      statuses,
    );

    expect(rows.map((row) => row.status)).toEqual(["complete", "残1"]);
  });

  it("can overlay only complete source sheet statuses", () => {
    const statuses = parseSourceTradeStatusSheetRows([
      [],
      [],
      ["No.", "", "商品名", "注文数", "", "", "", "状況"],
      ["410", "", "New 2DS LL ホワイト×オレンジ", "3", "", "", "", "complete"],
      ["", "", "New 2DS LL ホワイト×ラベンダー", "1", "", "", "", "残1"],
    ]);

    const rows = applySourceTradeSheetStatuses(
      [
        { no: 410, productName: "New 2DS LL ホワイト×オレンジ", status: "残3" },
        { no: 410, productName: "New 2DS LL ホワイト×ラベンダー", status: "complete" },
      ],
      statuses,
      { completeOnly: true },
    );

    expect(rows.map((row) => row.status)).toEqual(["complete", "complete"]);
  });
});
