import { describe, expect, it } from "vitest";
import {
  allocateShipmentProgressToProducts,
  applySourceTradeSheetStatuses,
  buildShipmentProgressProductTotals,
  parseShipmentProgressSheetRows,
  parseSourceTradeStatusSheetRows,
  summarizeShipmentProgress,
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

  it("parses shipment progress continuation rows", () => {
    const progress = parseShipmentProgressSheetRows([[
      ["invoice", "Date of payment", "", "", "", "shipped"],
      ["410", "8/31", "New 2DS LL ホワイト×オレンジ", "New 2DS LL White/Orange", "3", "2"],
      ["", "", "New 2DS LL ホワイト×ラベンダー", "New 2DS LL White/Lavender", "1", "1"],
    ]]);

    expect(progress.get("410")).toEqual([
      {
        invoiceNo: "410",
        productNameJa: "New 2DS LL ホワイト×オレンジ",
        productNameEn: "New 2DS LL White/Orange",
        orderedQty: 3,
        shippedQty: 2,
      },
      {
        invoiceNo: "410",
        productNameJa: "New 2DS LL ホワイト×ラベンダー",
        productNameEn: "New 2DS LL White/Lavender",
        orderedQty: 1,
        shippedQty: 1,
      },
    ]);
    expect(summarizeShipmentProgress(progress.get("410"))).toEqual({ orderedQty: 4, shippedQty: 3 });
  });

  it("allocates shipment progress to trade products by product name", () => {
    const progress = parseShipmentProgressSheetRows([[
      ["410", "8/31", "New 2DS LL ホワイト×オレンジ", "New 2DS LL White/Orange", "3", "2"],
      ["", "", "New 2DS LL ホワイト×ラベンダー", "New 2DS LL White/Lavender", "1", "1"],
    ]]);
    const rows = [
      { productName: "New 2DS LL ホワイト×オレンジ", orderQty: 3 },
      { productName: "New 2DS LL ホワイト×ラベンダー", orderQty: 1 },
    ];

    const totals = buildShipmentProgressProductTotals(
      rows.map((row) => ({ name: row.productName, qty: row.orderQty })),
      progress.get("410"),
    );
    const allocated = allocateShipmentProgressToProducts(rows, progress.get("410"));

    expect(totals.get("New 2DS LL ホワイト×オレンジ")).toEqual({ orderedQty: 3, shippedQty: 2 });
    expect(allocated.map((item) => item.shippedQty)).toEqual([2, 1]);
  });
});
