import { describe, expect, it } from "vitest";
import {
  aggregateShipmentRowsByOrderLine,
  cleanShipmentProductTitle,
  findCsvProductForDeliveryItem,
  findShipmentCsvProduct,
  normalizeShipmentGroupKey,
  sameShipmentValue,
  sumDeliveredQtyByOrderProduct,
} from "./shipmentRows";
import type { FedexShipment, InvoiceEntry, OrderSummaryItem } from "./types";

/** 海外発送・梱包画面の発送行集計の整理前基準（現行出力の固定） */

function makeShipment(patch: Partial<FedexShipment> = {}): FedexShipment {
  return {
    id: 1,
    deliveryNo: "379_luca20260423",
    sheetName: "独発送管理",
    shippingDate: "4/23",
    trackingNumber: "TRK-1",
    itemsJson: "[]",
    spreadsheetStatus: "success",
    operatorName: null,
    createdAt: new Date("2026-04-23T00:00:00Z"),
    ...patch,
  };
}

function makeRow(
  productNameJa: string,
  quantity: number,
  shipmentPatch: Partial<FedexShipment> = {},
): InvoiceEntry["shipments"][number] {
  return {
    shipment: makeShipment(shipmentPatch),
    item: { productNameJa, productNameEn: "", quantity },
    itemIndex: 0,
  };
}

describe("normalizeShipmentGroupKey", () => {
  it("NFKC・小文字化・空白/中点/ハイフン等の除去を行う", () => {
    expect(normalizeShipmentGroupKey("Ｇａｍｅ　Ｂｏｙ")).toBe("gameboy");
    expect(normalizeShipmentGroupKey("ゲーム・ボーイ_A-1、B")).toBe("ゲムボイa1b");
  });
});

describe("cleanShipmentProductTitle", () => {
  it("括弧書きを除去してトリムする", () => {
    expect(cleanShipmentProductTitle("本体（中古） セット")).toBe("本体セット");
    expect(cleanShipmentProductTitle("  本体 (used)  ")).toBe("本体");
  });
  it("全体が括弧の場合は元のトリム値を返す", () => {
    expect(cleanShipmentProductTitle("（全部括弧）")).toBe("（全部括弧）");
  });
});

describe("sameShipmentValue", () => {
  it("単一値はその値、複数値はフォールバック、空は空文字", () => {
    expect(sameShipmentValue(["4/23", "4/23"], "複数日")).toBe("4/23");
    expect(sameShipmentValue(["4/23", "4/24"], "複数日")).toBe("複数日");
    expect(sameShipmentValue(["", "4/23"], "複数日")).toBe("4/23");
    expect(sameShipmentValue([], "複数日")).toBe("");
  });
});

describe("findShipmentCsvProduct", () => {
  it("行のitemとdeliveryNoでCSV商品を引き当てる", () => {
    const products = [{ name: "【テスト】携帯ゲーム機A", qty: 3 }];
    expect(findShipmentCsvProduct(products, makeRow("【テスト】携帯ゲーム機A", 1))).toEqual({
      name: "【テスト】携帯ゲーム機A",
      qty: 3,
      index: 0,
    });
    expect(findShipmentCsvProduct(products, makeRow("縁のない別物", 1))).toBeNull();
  });
});

describe("aggregateShipmentRowsByOrderLine", () => {
  const products = [
    { name: "【テスト】携帯ゲーム機A", qty: 3 },
    { name: "【テスト】ワイヤレスパッドB", qty: 2 },
  ];
  it("同一商品を合算し、日付・追跡番号が揃わない場合は複数表記にする", () => {
    const rows = [
      makeRow("【テスト】ワイヤレスパッドB", 1),
      makeRow("【テスト】携帯ゲーム機A", 2, { shippingDate: "4/23", trackingNumber: "TRK-1" }),
      makeRow("【テスト】携帯ゲーム機A", 1, { shippingDate: "4/24", trackingNumber: "TRK-2" }),
    ];
    const aggregated = aggregateShipmentRowsByOrderLine(products, rows);
    expect(aggregated).toEqual([
      {
        key: normalizeShipmentGroupKey("【テスト】携帯ゲーム機A"),
        shippingDate: "複数日",
        trackingNumber: "複数",
        productName: "【テスト】携帯ゲーム機A",
        quantity: 3,
        productOrder: 0,
      },
      {
        key: normalizeShipmentGroupKey("【テスト】ワイヤレスパッドB"),
        shippingDate: "4/23",
        trackingNumber: "TRK-1",
        productName: "【テスト】ワイヤレスパッドB",
        quantity: 1,
        productOrder: 1,
      },
    ]);
  });
  it("CSVに無い商品は括弧除去タイトルでproducts.length順に末尾へ並ぶ", () => {
    const aggregated = aggregateShipmentRowsByOrderLine(products, [
      makeRow("縁のない別物（箱なし）", 1),
      makeRow("【テスト】携帯ゲーム機A", 1),
    ]);
    expect(aggregated.map((row) => row.productName)).toEqual(["【テスト】携帯ゲーム機A", "縁のない別物"]);
    expect(aggregated[1].productOrder).toBe(2);
  });
});

describe("findCsvProductForDeliveryItem / sumDeliveredQtyByOrderProduct", () => {
  const products = [
    { name: "【テスト】携帯ゲーム機A", qty: 3 },
    { name: "【テスト】ワイヤレスパッドB", qty: 2 },
  ];
  function makeDeliveryItem(patch: Partial<OrderSummaryItem["deliveryItems"][number]> = {}) {
    return { title: "", quantity: 1, managementNo: "", ...patch };
  }
  it("csvProductName指定が最優先で引き当てられる", () => {
    expect(
      findCsvProductForDeliveryItem(products, makeDeliveryItem({ title: "縁のない別物", csvProductName: "【テスト】ワイヤレスパッドB" })),
    ).toEqual({ name: "【テスト】ワイヤレスパッドB", qty: 2, index: 1 });
  });
  it("csvProductNameがなければタイトルで照合、どれも一致しなければnull", () => {
    expect(findCsvProductForDeliveryItem(products, makeDeliveryItem({ title: "【テスト】携帯ゲーム機A" }))).toEqual({
      name: "【テスト】携帯ゲーム機A",
      qty: 3,
      index: 0,
    });
    expect(findCsvProductForDeliveryItem(products, makeDeliveryItem({ title: "縁のない別物" }))).toBeNull();
  });
  it("出庫明細を注文商品indexごとに数量合算する（未一致は除外）", () => {
    const summed = sumDeliveredQtyByOrderProduct(products, [
      makeDeliveryItem({ title: "【テスト】携帯ゲーム機A", quantity: 2 }),
      makeDeliveryItem({ title: "【テスト】携帯ゲーム機A", quantity: 1 }),
      makeDeliveryItem({ title: "【テスト】ワイヤレスパッドB", quantity: 1 }),
      makeDeliveryItem({ title: "縁のない別物", quantity: 5 }),
    ]);
    expect(summed).toEqual(new Map([[0, 3], [1, 1]]));
  });
});
