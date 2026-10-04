import { describe, expect, it } from "vitest";
import { cleanLegacyManagementNo, parsePurchaseEtc } from "@shared/purchaseMetadata";
import * as managementNumbers from "./managementNumbers";
import * as purchaseEtc from "./purchaseEtc";
import * as invoiceIdentity from "./invoiceIdentity";
import * as supplier from "./supplier";
import * as search from "./search";
import { extractManagementNo } from "@shared/ebayInventory";
import { loadMetadataBaseline, METADATA_BASELINE_COMMIT, type MetadataBaseline } from "./metadata-baseline";
import type { PurchaseItem, PurchaseRow } from "./dataTypes";
import type { StockItemView } from "./viewTypes";

const original = loadMetadataBaseline();
const current = {
  ...managementNumbers, ...purchaseEtc, ...invoiceIdentity, ...supplier, ...search,
  cleanLegacyManagementNo, parseEtc: parsePurchaseEtc, getInventoryManagementNo: extractManagementNo,
} satisfies MetadataBaseline;

const values = [undefined, null, "", " ", "405_マキシム_商品", " 405_Maxim_White / 備考 , 2026-09-01, Seller , Tail ",
  "４０５_ＭＡＸＩＭ_白", "在庫0814_1", "0814_1", "在庫０８１４_１", "EBAY_item", "eBay-item", "ebay", "ebayX", "E0814_1",
  "405", "405_", "405__item", "405*Maxim", "1000_Maxim_item", "405_相手 名_商品", " A B, date, C, D ",
  "A/B", "A / B", " A\tB ", ",date,Supplier", '"A,B",date,"C,D"', "A，B、C", "ｶﾀｶﾅ", "カタカナ"];
const strings = values.filter((value): value is string => typeof value === "string");
function item(patch: Partial<PurchaseItem> = {}): PurchaseItem {
  return { id: 10, title: "Product Ａ ｶﾀｶﾅ", quantity: "2", ...patch };
}
function row(patch: Partial<PurchaseRow> = {}): PurchaseRow {
  return { id: 1, num: "ORDER-A", status: "ordered", purchase_items: [item()], ...patch };
}
function stock(patch: Partial<StockItemView> = {}): StockItemView {
  return { key: "s1", inventoryId: 10, labelId: "LABEL-A", status: "stocked", title: "Stock Ｂ ｶﾀｶﾅ", category: "CATEGORY", legacyManagementNo: "405_Maxim", allocationLabel: "No.405-White", unitPrice: 42, quantity: 2, supplier: { name: "Seller", url: "https://stock-url.invalid" }, purchaseDate: "2026-09-30", ...patch };
}
function observe(api: MetadataBaseline, input: PurchaseRow) {
  return { management: api.getManagementNos(input.purchase_items), invoice: api.getInvoiceInfo(input), supplier: api.getSupplier(input), search: api.buildSearchText(input) };
}

describe(`R05 metadata against actual source at ${METADATA_BASELINE_COMMIT}`, () => {
  it("captures exact cleaning, CSV-like etc reading, normalization and invoice grammar", () => {
    expect(values.map((value) => ({ value, cleaned: current.cleanLegacyManagementNo(value), parsed: current.parseEtc(value), inventory: current.getInventoryManagementNo(value), ebay: current.isEbayManagementNo(value), normalized: current.normalizeManagementNoForDisplay(value ?? ""), invoice: current.parseInvoiceFromManagementNo(value ?? "") }))).toMatchSnapshot();
    expect([undefined, null, "", "invoice-405", "invoice-0405", "invoice-4", "invoice-10000", "invoice-４０５", " invoice-405", "invoice-405 ", "invoice-ebay", "invoice-other"].map((value) => current.invoiceNoFromGroupKey(value))).toMatchSnapshot();
  });
  it("proves the existing shared inventory extractor is equivalent over separators and width variants", () => {
    let comparisons = 0;
    for (const value of values) for (const left of ["", " ", "\t", "　"]) for (const right of ["", " / X", "/X", ", date, supplier", "\n末尾", "，末尾"]) {
      const input = value == null ? value : left + value + right;
      expect(extractManagementNo(input)).toBe(original.getInventoryManagementNo(input));
      expect(current.getInventoryManagementNo(input)).toBe(original.getInventoryManagementNo(input));
      comparisons++;
    }
    expect(comparisons).toBe(720);
  });
  it("preserves etc write precedence including undefined, null, empty supplier and extra commas", () => {
    const existing = [undefined, null, "", "old, 2026-09-01, Seller, tail", ", date", "old,,Seller", '"old,id",date,"seller,name"'];
    const suppliers = [undefined, null, "", " ", " New Seller ", "Seller, Branch"];
    expect(existing.flatMap((etc) => suppliers.map((supplier) => current.buildEtcWithManagementNo(" 405_A / trailing ", etc, supplier)))).toMatchSnapshot();
    for (const number of strings) for (const etc of existing) for (const supplier of suppliers) {
      expect(current.buildEtcWithManagementNo(number, etc, supplier)).toBe(original.buildEtcWithManagementNo(number, etc, supplier));
    }
  });
  it("preserves stable deduplication, stock suffix aliases and retained spelling", () => {
    const groups = [[], ["0814_1", "在庫0814_1"], ["在庫0814_1", "0814_1"], ["123", "在庫9123"],
      ["A", "ａ", "a", "Ａ"], ["カタカナ", "ｶﾀｶﾅ"], [" 405_A , date", "４０５_ａ", "405_B"],
      ["", " ", "在庫", "在庫在庫", "庫"], [" / ", "在庫 / X", "在庫"], strings];
    expect(groups.map((group) => current.uniqueManagementNos(group))).toMatchSnapshot();
    for (const group of groups) {
      const before = structuredClone(group);
      const result = current.uniqueManagementNos(group);
      expect(result).toEqual(original.uniqueManagementNos(group));
      expect(result).not.toBe(group);
      for (const value of strings) expect(current.isStockManagementNoSuffixAlias(value, group)).toBe(original.isStockManagementNoSuffixAlias(value, group));
      expect(group).toEqual(before);
    }
  });
  it("preserves current versus label priority and caller-specific fallback", () => {
    for (const currentNumber of values) for (const labelNumber of values) for (const fallback of [undefined, "", "fallback"]) {
      expect(current.preferredManagementNo(currentNumber, labelNumber, fallback)).toBe(original.preferredManagementNo(currentNumber, labelNumber, fallback));
    }
    expect([[null, "405_Label"], [" current , date", "label"], ["", ""], [" ", ",date"]].map(([number, label]) => current.preferredManagementNo(number, label))).toMatchSnapshot();
  });
  it("captures management hints, label fallback, supplier priority and search scope", () => {
    const inputs = [row({ purchase_items: [] }), row(), row({ num: null, purchase_items: [item({ etc: null })] }),
      row({ csvSupplierName: " CSV Seller ", csvSupplierUrl: " https://supplier.invalid/A ", extra: { trackingNumber: "TRACKING-EXCLUDED" }, purchase_items: [item({ etc: "405_First, date, Etc Seller, 406_Second", category: "CLASS-A", itemLabels: [{ labelId: "ID-A", legacyManagementNo: "999_IGNORED" }] }), item({ id: 11, title: "Next Item", etc: "ebay_stock, date, Second Supplier" })] }),
      row({ csvSupplierName: " ", csvSupplierUrl: " ", purchase_items: [item({ etc: ", date, Fallback Seller", itemLabels: [{ labelId: "", legacyManagementNo: "406_Label" }, { labelId: "ID-B", legacyManagementNo: "405_Label" }] })] }),
      row({ purchase_items: [item({ etc: "ebay_1", itemLabels: [{ labelId: "E", legacyManagementNo: "409_Discarded" }] }), item({ id: 11, etc: "405_Invoice" })] }),
      row({ purchase_items: [item({ etc: "E0814_1" })] }), row({ purchase_items: [item({ etc: "４０５_Ｍａｘｉｍ" })] }),
    ];
    expect(inputs.map((input) => observe(current, input))).toMatchSnapshot();
    for (const input of inputs) {
      const before = structuredClone(input); const itemsRef = input.purchase_items; const firstItem = itemsRef[0];
      expect(observe(current, input)).toEqual(observe(original, input));
      expect(input).toEqual(before); expect(input.purchase_items).toBe(itemsRef); expect(input.purchase_items[0]).toBe(firstItem);
    }
    const queries = ["order-a", "csv seller", "supplier.invalid/a", "id-a", "class-a", "etc seller", "999_ignored", "tracking-excluded", "ｶﾀｶﾅ", "カタカナ", "product a", "product ａ", "405_maxim"];
    expect(queries.map((query) => ({ query, ids: inputs.filter((input) => current.buildSearchText(input).includes(query)).map((input) => inputs.indexOf(input)) }))).toMatchSnapshot();
  });
  it("preserves mixed etc/label rows without mutating nested inputs", () => {
    for (const etc of values) for (const labelManagement of values) {
      const input = row({ csvSupplierName: etc, purchase_items: [item({ etc, itemLabels: [{ labelId: "A", legacyManagementNo: labelManagement }, { labelId: "B", legacyManagementNo: "在庫0814_1" }] }), item({ id: 11, etc: "0814_1", category: null })] });
      const before = structuredClone(input);
      expect(observe(current, input)).toEqual(observe(original, input));
      expect(input).toEqual(before);
    }
  });
  it("preserves stock search fields and omissions without width folding", () => {
    const inputs = [stock(), stock({ labelId: null, legacyManagementNo: "", allocationLabel: "", supplier: { name: "", url: "" } }), stock({ title: "Foo\nBar Ａ", status: " RECEIVED ", legacyManagementNo: "４０５_相手", category: " category ", supplier: { name: "Yahoo Seller", url: "https://excluded.invalid" } })];
    expect(inputs.map((input) => JSON.stringify(current.buildStockSearchText(input)))).toMatchSnapshot();
    for (const input of inputs) {
      const before = structuredClone(input); const supplier = input.supplier;
      expect(current.buildStockSearchText(input)).toBe(original.buildStockSearchText(input));
      expect(input).toEqual(before); expect(input.supplier).toBe(supplier);
    }
    expect(["label-a", "seller", "stock-url", "category", "no.405", "42", "2026-09-30", "ｶﾀｶﾅ", "カタカナ"].map((query) => current.buildStockSearchText(inputs[0]).includes(query))).toMatchSnapshot();
  });
});
