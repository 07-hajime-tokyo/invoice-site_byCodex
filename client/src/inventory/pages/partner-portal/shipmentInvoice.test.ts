import { describe, expect, it } from "vitest";
import {
  extractInvoiceNo,
  findCsvProductForShipmentItem,
  reserveShipmentProductUsage,
  resolveShipmentItemInvoice,
  shipmentProductUsageKey,
  sortInvoiceNo,
} from "./shipmentInvoice";
import type { CsvInvoiceData, ShipmentInvoiceUsage, ShipmentItem } from "./types";

/** パートナーポータルのインボイス割当ロジックの整理前基準（現行出力の固定） */

function item(partial: Partial<ShipmentItem>): ShipmentItem {
  return {
    productNameJa: "",
    productNameEn: "",
    quantity: 1,
    ...partial,
  };
}

function csv(products: Array<{ name: string; qty: number }>): CsvInvoiceData {
  return { partner: "ルカ", paymentDate: "2026-01-01", products };
}

describe("extractInvoiceNo", () => {
  it("先頭の番号表記を抽出する", () => {
    expect(extractInvoiceNo("369")).toBe("369");
    expect(extractInvoiceNo("No.369")).toBe("369");
    expect(extractInvoiceNo("No 369")).toBe("369");
    expect(extractInvoiceNo("369_ルカ_コズミックレッド")).toBe("369");
    expect(extractInvoiceNo("369-2")).toBe("369");
  });
  it("埋め込み形式（アンダースコア前）も抽出する", () => {
    expect(extractInvoiceNo("ルカ369_黒")).toBe("369");
  });
  it("抽出できなければ null", () => {
    expect(extractInvoiceNo(null)).toBe(null);
    expect(extractInvoiceNo(undefined)).toBe(null);
    expect(extractInvoiceNo("")).toBe(null);
    expect(extractInvoiceNo("ルカ")).toBe(null);
  });
});

describe("sortInvoiceNo", () => {
  it("数値順に並べ、数値を非数値より前に置く", () => {
    expect(["10", "2", "abc", "1"].sort(sortInvoiceNo)).toEqual(["1", "2", "10", "abc"]);
  });
  it("同値は0を返す", () => {
    expect(sortInvoiceNo("5", "5")).toBe(0);
  });
});

describe("shipmentProductUsageKey / reserveShipmentProductUsage", () => {
  it("使用量をキー単位で加算する", () => {
    const usage: ShipmentInvoiceUsage = new Map();
    const product = { name: "PS Vita 2000 Black", qty: 5, index: 0 };
    reserveShipmentProductUsage(usage, "369", product, 2);
    reserveShipmentProductUsage(usage, "369", product, 3);
    expect(usage.get(shipmentProductUsageKey("369", product))).toBe(5);
  });
  it("usage や product が無ければ何もしない", () => {
    const usage: ShipmentInvoiceUsage = new Map();
    reserveShipmentProductUsage(undefined, "369", { name: "x", qty: 1, index: 0 }, 1);
    reserveShipmentProductUsage(usage, "369", null, 1);
    expect(usage.size).toBe(0);
  });
  it("負数や非数は0として扱う", () => {
    const usage: ShipmentInvoiceUsage = new Map();
    const product = { name: "x", qty: 1, index: 0 };
    reserveShipmentProductUsage(usage, "369", product, -4);
    expect(usage.get(shipmentProductUsageKey("369", product))).toBe(0);
  });
});

describe("findCsvProductForShipmentItem", () => {
  const products = [
    { name: "PS Vita 2000 ブラック", qty: 5 },
    { name: "New 3DS ランダムカラー", qty: 3 },
  ];
  it("商品名照合で一致した商品と位置を返す", () => {
    const match = findCsvProductForShipmentItem(products, item({ productNameJa: "PS Vita 2000 ブラック 本体" }));
    expect(match).toEqual({ name: "PS Vita 2000 ブラック", qty: 5, index: 0 });
  });
  it("英語名でも照合する", () => {
    const match = findCsvProductForShipmentItem(products, item({ productNameEn: "New 3DS Console White" }));
    expect(match?.name).toBe("New 3DS ランダムカラー");
  });
  it("一致しなければ null", () => {
    expect(findCsvProductForShipmentItem(products, item({ productNameJa: "全く別の商品ゲームギア" }))).toBe(null);
  });
});

describe("resolveShipmentItemInvoice", () => {
  const csvData: Record<string, CsvInvoiceData> = {
    "369": csv([{ name: "PS Vita 2000 ブラック", qty: 2 }]),
    "370": csv([{ name: "PS Vita 2000 ブラック", qty: 5 }]),
  };

  it("明示インボイスNo（invoiceNo > managementNo > deliveryNo）を優先する", () => {
    const r1 = resolveShipmentItemInvoice("999", item({ invoiceNo: "370", productNameJa: "PS Vita 2000 ブラック" }), csvData);
    expect(r1.invoiceNo).toBe("370");
    expect(r1.product?.name).toBe("PS Vita 2000 ブラック");
    const r2 = resolveShipmentItemInvoice("999", item({ managementNo: "369_ルカ_黒", productNameJa: "PS Vita 2000 ブラック" }), csvData);
    expect(r2.invoiceNo).toBe("369");
    const r3 = resolveShipmentItemInvoice("370_出庫", item({ productNameJa: "該当なし商品" }), csvData);
    expect(r3.invoiceNo).toBe("370");
    expect(r3.product).toBe(null);
  });

  it("番号が無い場合は残数が多いインボイスへ割り当てて使用量を予約する", () => {
    const usage: ShipmentInvoiceUsage = new Map();
    const target = item({ productNameJa: "PS Vita 2000 ブラック", quantity: 4 });
    const first = resolveShipmentItemInvoice("発送A", target, csvData, usage);
    expect(first.invoiceNo).toBe("370");
    const second = resolveShipmentItemInvoice("発送A", item({ productNameJa: "PS Vita 2000 ブラック", quantity: 2 }), csvData, usage);
    expect(second.invoiceNo).toBe("369");
  });

  it("どこにも一致しなければ deliveryNo をそのまま返す", () => {
    const r = resolveShipmentItemInvoice("発送A", item({ productNameJa: "該当なし商品ゲームギア" }), csvData);
    expect(r).toEqual({ invoiceNo: "発送A", product: null });
    expect(resolveShipmentItemInvoice("  ", item({ productNameJa: "該当なし商品ゲームギア" }), csvData).invoiceNo).toBe("unknown");
  });
});
