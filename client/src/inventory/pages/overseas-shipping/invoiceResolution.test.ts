import { describe, expect, it } from "vitest";
import {
  extractInvoiceNo,
  findCsvProductForShipmentItem,
  reserveShipmentProductUsage,
  resolveShipmentItemInvoice,
  shipmentProductUsageKey,
  sortInvoiceNo,
} from "./invoiceResolution";
import type { CsvInvoiceData, ShipmentInvoiceUsage, ShipmentItem } from "./types";

/** 海外発送・梱包画面のインボイスNo解決の整理前基準（現行出力の固定） */

function makeItem(patch: Partial<ShipmentItem> = {}): ShipmentItem {
  return { productNameJa: "", productNameEn: "", quantity: 1, ...patch };
}

function makeCsv(products: Array<{ name: string; qty: number }>): CsvInvoiceData {
  return { partner: "Luca", paymentDate: "2026-04-01", products };
}

describe("extractInvoiceNo", () => {
  it("先頭の数字（区切り付き/末尾）を抽出する", () => {
    expect(extractInvoiceNo("379_luca20260423")).toBe("379");
    expect(extractInvoiceNo("379")).toBe("379");
    expect(extractInvoiceNo("No.379")).toBe("379");
    expect(extractInvoiceNo("No. 380 x")).toBe("380");
    expect(extractInvoiceNo("381-2")).toBe("381");
  });
  it("埋め込み（非数字の後の数字+アンダースコア）も抽出する", () => {
    expect(extractInvoiceNo("ABC379_x")).toBe("379");
  });
  it("NFKC正規化してから抽出する", () => {
    expect(extractInvoiceNo("３７９_1")).toBe("379");
  });
  it("抽出できない場合はnull", () => {
    expect(extractInvoiceNo("luca")).toBeNull();
    expect(extractInvoiceNo("")).toBeNull();
    expect(extractInvoiceNo(null)).toBeNull();
    expect(extractInvoiceNo(undefined)).toBeNull();
  });
});

describe("sortInvoiceNo", () => {
  it("数値昇順・数値が非数値より先", () => {
    expect(["380", "9", "abc", "379"].sort(sortInvoiceNo)).toEqual(["9", "379", "380", "abc"]);
  });
});

describe("shipmentProductUsageKey / reserveShipmentProductUsage", () => {
  it("インボイスNo・index・商品名で使用量を加算する", () => {
    const usage: ShipmentInvoiceUsage = new Map();
    const product = { name: "商品A", qty: 5, index: 0 };
    reserveShipmentProductUsage(usage, "379", product, 2);
    reserveShipmentProductUsage(usage, "379", product, 3);
    expect(usage.get(shipmentProductUsageKey("379", product))).toBe(5);
  });
  it("usageまたはproductがない場合、負数は0として扱う", () => {
    const usage: ShipmentInvoiceUsage = new Map();
    reserveShipmentProductUsage(undefined, "379", { name: "A", qty: 1, index: 0 }, 1);
    reserveShipmentProductUsage(usage, "379", null, 1);
    expect(usage.size).toBe(0);
    reserveShipmentProductUsage(usage, "379", { name: "A", qty: 1, index: 0 }, -4);
    expect(usage.get("379\n0\nA")).toBe(0);
  });
});

describe("findCsvProductForShipmentItem", () => {
  it("商品名が一致するCSV商品をindex付きで返す", () => {
    const products = [
      { name: "【テスト】携帯ゲーム機A", qty: 3 },
      { name: "【テスト】ワイヤレスパッドB", qty: 2 },
    ];
    const found = findCsvProductForShipmentItem(products, makeItem({ productNameJa: "【テスト】ワイヤレスパッドB" }));
    expect(found).toEqual({ name: "【テスト】ワイヤレスパッドB", qty: 2, index: 1 });
  });
  it("一致しない場合はnull", () => {
    const products = [{ name: "【テスト】携帯ゲーム機A", qty: 3 }];
    expect(findCsvProductForShipmentItem(products, makeItem({ productNameJa: "縁のない別物" }))).toBeNull();
    expect(findCsvProductForShipmentItem([], makeItem({ productNameJa: "【テスト】携帯ゲーム機A" }))).toBeNull();
  });
});

describe("resolveShipmentItemInvoice", () => {
  it("item.invoiceNo > managementNo > deliveryNo の順でインボイスNoを決める", () => {
    const csvData: Record<string, CsvInvoiceData> = {};
    expect(
      resolveShipmentItemInvoice("381_luca20260423", makeItem({ invoiceNo: "379", managementNo: "380_2" }), csvData),
    ).toEqual({ invoiceNo: "379", product: null });
    expect(
      resolveShipmentItemInvoice("381_luca20260423", makeItem({ managementNo: "380_2" }), csvData),
    ).toEqual({ invoiceNo: "380", product: null });
    expect(
      resolveShipmentItemInvoice("381_luca20260423", makeItem(), csvData),
    ).toEqual({ invoiceNo: "381", product: null });
  });
  it("優先インボイスNoが決まれば該当CSV商品を紐付けて使用量を記録する", () => {
    const csvData = { "379": makeCsv([{ name: "【テスト】携帯ゲーム機A", qty: 3 }]) };
    const usage: ShipmentInvoiceUsage = new Map();
    const result = resolveShipmentItemInvoice(
      "379_luca20260423",
      makeItem({ productNameJa: "【テスト】携帯ゲーム機A", quantity: 2 }),
      csvData,
      usage,
    );
    expect(result).toEqual({ invoiceNo: "379", product: { name: "【テスト】携帯ゲーム機A", qty: 3, index: 0 } });
    expect(usage.get("379\n0\n【テスト】携帯ゲーム機A")).toBe(2);
  });
  it("インボイスNoが取れない場合は残数の多いCSV候補へ割り当てる", () => {
    const csvData = {
      "379": makeCsv([{ name: "【テスト】携帯ゲーム機A", qty: 1 }]),
      "380": makeCsv([{ name: "【テスト】携帯ゲーム機A", qty: 1 }]),
    };
    const usage: ShipmentInvoiceUsage = new Map();
    const item = makeItem({ productNameJa: "【テスト】携帯ゲーム機A", quantity: 1 });
    expect(resolveShipmentItemInvoice("luca", item, csvData, usage).invoiceNo).toBe("379");
    expect(resolveShipmentItemInvoice("luca", item, csvData, usage).invoiceNo).toBe("380");
  });
  it("候補がない場合はdeliveryNo（空白ならunknown）を返す", () => {
    expect(resolveShipmentItemInvoice("luca", makeItem({ productNameJa: "縁のない別物" }), {})).toEqual({
      invoiceNo: "luca",
      product: null,
    });
    expect(resolveShipmentItemInvoice("  ", makeItem(), {})).toEqual({ invoiceNo: "unknown", product: null });
  });
});
