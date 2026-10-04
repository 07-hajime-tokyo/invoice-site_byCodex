import * as productTitles from "./productTitles";
import * as productMatchConstraints from "./productMatchConstraints";
import * as invoiceProductSuggestions from "./invoiceProductSuggestions";
import * as productMatching from "./productMatching";
import * as productDetailFilters from "./productDetailFilters";
import * as productSummaries from "./productSummaries";
import { describe, expect, it } from "vitest";
import { loadProductBaseline, PRODUCT_BASELINE_COMMIT } from "./product-baseline";
import { productKey } from "./productText";
import type { PurchaseItem, PurchaseRow } from "./dataTypes";
import type { StockItemView, InvoiceProductSummary, ProductSummary, ProductDetailFilter } from "./viewTypes";

type Rules = typeof import("./productTitles") & typeof import("./productMatchConstraints") & typeof import("./invoiceProductSuggestions") & typeof import("./productMatching") & typeof import("./productDetailFilters") & typeof import("./productSummaries");
const original = loadProductBaseline<Rules>();
const current: Rules = { ...productTitles, ...productMatchConstraints, ...invoiceProductSuggestions, ...productMatching, ...productDetailFilters, ...productSummaries };
const item = (patch: Partial<PurchaseItem> = {}): PurchaseItem => ({ id: 1, title: "3DS LL ホワイト", quantity: "3", currentInventoryQuantity: "1", unit_price: "100", etc: "405_相手_3DSLLホワイト", ...patch });
const row = (patch: Partial<PurchaseRow> = {}): PurchaseRow => ({ id: 1, status: "ordered", purchase_items: [item()], ...patch });
const stock = (patch: Partial<StockItemView> = {}): StockItemView => ({ key: "s1", inventoryId: 1, labelId: null, status: "stocked", title: "3DS LL ホワイト", category: "ゲーム", legacyManagementNo: "405_相手_3DSLLホワイト", allocationLabel: "405", unitPrice: 100, quantity: 3, supplier: { name: "仕入先", url: "https://example.test" }, purchaseDate: "2026-09-01", ...patch });
const invoice = (productName: string, patch: Partial<InvoiceProductSummary> = {}): InvoiceProductSummary => ({ productName, orderQty: 5, deliveredQty: 1, sellingPrice: 20, currency: "EUR", ...patch });
const summary = (title: string, patch: Partial<ProductSummary> = {}): ProductSummary => ({ key: productKey(title), title, required: 3, secured: 1, waiting: 2, unitPriceTotal: 100, unitPriceCount: 1, ...patch });
const names = ["", "Unknown😀", "3DS LL ホワイト", "New 3DS LL ランダムカラー", "Ｎｅｗ　３ＤＳ　ＸＬ", "New 2DS LL モンスターボール", "New 3DS LL どうぶつの森", "3DS LL Animal Crossing", "3DS LL Minecraft", "3DS LL ピカチュウ", "3DS LL Pokemon", "3DS LL Mario", "3DS LL Luigi", "3DS LL Hyrule", "3DS LL limited edition", "3DS LL special edition", "Animal-Crossing", "animal_crossing", "animal\u200bcrossing", "PS Vita 1100 ブラック", "PS Vita 1000 white", "PS Vita 2000", "PSP Go", "PSP3000 piano black", "PSP 2000 セラミックホワイト", "PSP2000 Red", "New3DS", "2DS", "3DS", "New2DSLL"];
const quantities = ["", "-2", "0", "0.5", "1", "2.9", "bad", "Infinity"];
const encode = (value: unknown) => JSON.stringify(value);
const products = [invoice("3DS LL White Base"), invoice("3DS LL ランダムカラー"), invoice("New 3DS LL どうぶつの森"), invoice("New 2DS LL モンスターボール"), invoice("PS Vita 1000 ブラック")];
const candidates = products.map(p => ({ name: p.productName, qty: p.orderQty }));

describe(`R09 product rules against actual source at ${PRODUCT_BASELINE_COMMIT}`, () => {
  it("captures display names, raw names, missing-title fallbacks and management precedence", () => {
    const inputs = names.map(title => item({ title, etc: "" }));
    inputs.push(item({ title: " ", etc: "407_相手_3DSLLどうぶつの森" }), item({ title: "PSP3000", etc: "405_相手_モンスターボール" }));
    const missing = item({ etc: "405_相手_New3DSLL" }); Reflect.deleteProperty(missing, "title");
    const nil = item({ etc: "405_相手_PSP2000" }); Reflect.set(nil, "title", null);
    inputs.push(missing, nil);
    expect(inputs.map(value => [current.displayProductTitle(value), current.actualProductTitle(value), current.invoiceAlignedProductTitle(value, products)])).toMatchSnapshot();
    for (const value of inputs) {
      expect(current.displayProductTitle(value)).toBe(original.displayProductTitle(value));
      expect(current.actualProductTitle(value)).toBe(original.actualProductTitle(value));
      expect(current.invoiceAlignedProductTitle(value, products)).toBe(original.invoiceAlignedProductTitle(value, products));
      expect(current.invoiceAlignedProductTitle(value, [])).toBe(original.invoiceAlignedProductTitle(value, []));
    }
  });
  it("preserves limited editions, broad limited tags, random color, punctuation and 407 exceptions", () => {
    const special = "407_相手_3DSLLどうぶつの森";
    const inputs = [...names, special];
    expect(inputs.map(text => [text, current.limitedEditionProductKey(text), current.isRandomColorProductTitle(text), current.canMatchTargetProduct(text, "3DS LL ランダムカラー"), current.canMatchStockTargetProduct(text, "3DS LL White Base")])).toMatchSnapshot();
    for (const a of inputs) for (const b of [...names, undefined]) {
      expect(current.canMatchTargetProduct(a, b)).toBe(original.canMatchTargetProduct(a, b));
      expect(current.canMatchStockTargetProduct(a, b)).toBe(original.canMatchStockTargetProduct(a, b));
    }
    expect(current.canMatchStockTargetProduct(special, "3DS LL White Base")).toBe(true);
    expect(current.canMatchStockTargetProduct(special.replace("407", "408"), "3DS LL White Base")).toBe(false);
    expect(current.canMatchTargetProduct("3DS LL special edition", "3DS LL ランダムカラー")).toBe(true);
    expect(current.canMatchStockTargetProduct("3DS LL special edition", "3DS LL ランダムカラー")).toBe(false);
  });
  it("captures candidate order, duplicate candidates, model ambiguity and management-over-title priority", () => {
    const candidateSets = [[], candidates, [...candidates].reverse(), [{ name: "3DS LL どうぶつの森", qty: 1 }], [{ name: "3DS LL どうぶつの森", qty: 1 }, { name: "3DS LL Animal Crossing", qty: 99 }], [{ name: "3DS LL White Base", qty: 1 }, { name: "3DS LL White Base", qty: 2 }], [{ name: "PSP2000 red", qty: 0 }, { name: "PSP3000 blue", qty: 2 }]];
    const inputs = [["3DS LL どうぶつの森", "407_相手_3DSLLどうぶつの森"], ["3DS LL ホワイト", "405_相手_PSP2000red"], ["", ""], ["PSP3000", ""], ["New3DSLLどうぶつの森", ""], ["Unknown", "405_相手_PS_Vita1000ブラック"]];
    const output: unknown[] = [];
    for (const [title, management] of inputs) for (const set of candidateSets) {
      const result = [current.suggestAnimalCrossingInvoiceProduct(title, management, set), current.suggestInvoice407WhiteBaseProduct(title, management, set), current.suggestInvoiceProductName(title, management, set), current.suggestInvoiceProductNameFromHints(title, [null, undefined, management, management], set)];
      expect(result).toEqual([original.suggestAnimalCrossingInvoiceProduct(title, management, set), original.suggestInvoice407WhiteBaseProduct(title, management, set), original.suggestInvoiceProductName(title, management, set), original.suggestInvoiceProductNameFromHints(title, [null, undefined, management, management], set)]);
      output.push(result);
    }
    expect(output).toMatchSnapshot();
  });
  it("preserves purchase matching versus stock color checks and hint sources", () => {
    const results: unknown[] = [];
    for (const title of names) {
      const p = item({ title, etc: title.includes("Animal") ? "407_相手_3DSLLどうぶつの森" : "405_相手_" + title });
      const s = stock({ title, legacyManagementNo: p.etc ?? "", allocationLabel: "", category: "" });
      expect(current.purchaseItemMatchTexts(p)).toEqual(original.purchaseItemMatchTexts(p));
      expect(current.stockItemMatchData(s)).toEqual(original.stockItemMatchData(s));
      for (const target of [...products.map(p => p.productName), undefined]) {
        const key = productKey(target ?? title);
        const result = [current.purchaseItemMatchesProduct(p, key, target), current.stockItemMatchesProduct(s, key, target)];
        expect(result).toEqual([original.purchaseItemMatchesProduct(p, key, target), original.stockItemMatchesProduct(s, key, target)]);
        results.push(result);
      }
    }
    expect(results).toMatchSnapshot();
    const base = stock({ title: "Unknown", legacyManagementNo: "", allocationLabel: "", category: "", supplier: { name: "", url: "" } });
    for (const patch of [{ category: "PS Vita1000 ブラック" }, { allocationLabel: "405_相手_PSVita1000ブラック" }, { supplier: { name: "PS Vita1000 ブラック", url: "" } }, { legacyManagementNo: "405_相手_PSVita1000ブラック" }]) {
      const s = { ...base, ...patch };
      expect(current.findInvoiceProductNameForStockItem(s, products)).toBe(original.findInvoiceProductNameForStockItem(s, products));
    }
  });
  it("captures exact-name precedence, stock candidate order and rejected cross-edition matches", () => {
    const inputs = [stock(), stock({ title: "3DS LL White Base", legacyManagementNo: "407_相手_3DSLLどうぶつの森" }), stock({ title: "3DS LL どうぶつの森", legacyManagementNo: "408_相手_3DSLLどうぶつの森" }), stock({ title: "PS Vita1000 ブラック", legacyManagementNo: "405_相手_New3DSLLどうぶつの森" })];
    expect(inputs.map(s => [current.findInvoiceProductNameForStockItem(s, products), current.findInvoiceProductNameForStockItem(s, [...products].reverse()), current.findInvoiceProductNameForStockItem(s, [])])).toMatchSnapshot();
    for (const s of inputs) for (const list of [[], products, [...products].reverse()]) expect(current.findInvoiceProductNameForStockItem(s, list)).toBe(original.findInvoiceProductNameForStockItem(s, list));
  });
  it("keeps detail status filtering, original item references and pass-through paths", () => {
    const rows = [row(), row({ id: 2, status: "shipped" }), row({ id: 3, status: "purchased" }), row({ id: 4, purchase_items: [item({ currentInventoryQuantity: "0" })] }), row({ id: 5, purchase_items: [item({ itemLabels: [{ labelId: "A", status: "shipped" }] })] })];
    const stocks = [stock(), stock({ inventoryId: 2, title: "PSP2000" })];
    const filters: Array<ProductDetailFilter | null> = [null, { mode: "stock", productTitle: "" }, { mode: "waiting", productTitle: "" }, { mode: "stock", productKey: productKey("3DS LL ホワイト"), productTitle: "3DS LL ホワイト" }, { mode: "waiting", productKey: "no-match", productTitle: "unknown" }];
    const before = structuredClone({ rows, stocks });
    expect(filters.map(f => [current.filterRowsByProductDetail(rows, f), current.filterStockItemsByProductDetail(stocks, f), current.filterStockItemsByInvoiceProductDetail(stocks, f, products), f && current.productDetailFilterLabel(f)]).map(encode)).toMatchSnapshot();
    expect(current.filterRowsByProductDetail(rows, null)).toBe(rows);
    expect(current.filterStockItemsByProductDetail(stocks, filters[1])).toBe(stocks);
    expect(current.filterStockItemsByInvoiceProductDetail(stocks, filters[1], [])).toBe(stocks);
    for (const f of filters) {
      const actual = current.filterRowsByProductDetail(rows, f);
      expect(actual).toEqual(original.filterRowsByProductDetail(rows, f));
      expect(current.filterStockItemsByProductDetail(stocks, f)).toEqual(original.filterStockItemsByProductDetail(stocks, f));
      expect(current.filterStockItemsByInvoiceProductDetail(stocks, f, products)).toEqual(original.filterStockItemsByInvoiceProductDetail(stocks, f, products));
      if (f) for (const r of actual) { const input = rows.find(v => v.id === r.id)!; expect(r).not.toBe(input); for (const p of r.purchase_items) expect(input.purchase_items).toContain(p); }
    }
    expect({ rows, stocks }).toEqual(before);
  });
  it("captures summary ordering, unweighted purchase prices and received-row waiting behavior", () => {
    const rows = [row({ purchase_items: [item({ quantity: "3.5", unit_price: "100" }), item({ id: 2, quantity: "2", unit_price: "500" }), item({ id: 3, title: "PSP2000", etc: "", quantity: "-2", unit_price: "0" })] }), row({ id: 2, status: "purchased", purchase_items: [item({ currentInventoryQuantity: "0" })] }), row({ id: 3, purchase_items: [item({ status: "purchased" }), item({ id: 5, title: "Unknown", etc: "" })] })];
    const before = structuredClone(rows);
    expect(current.buildProductSummaries(rows)).toMatchSnapshot();
    expect(current.buildProductSummaries(rows, products)).toMatchSnapshot();
    expect(current.buildProductSummaries(rows, products)).toEqual(original.buildProductSummaries(rows, products));
    expect(rows).toEqual(before);
  });
  it("preserves signed, fractional, missing and nonfinite purchase amounts across statuses", () => {
    for (const quantity of quantities) for (const currentInventoryQuantity of [null, "-1", "0.5", "5", "bad"]) for (const status of [undefined, "ordered", "purchased", "shipped"]) {
      const rows = [row({ status, purchase_items: [item({ quantity, currentInventoryQuantity, unit_price: quantity })] })];
      const before = structuredClone(rows);
      expect(current.buildProductSummaries(rows, products)).toEqual(original.buildProductSummaries(rows, products));
      expect(rows).toEqual(before);
    }
  });
  it("captures excluded inventory, floor quantities, weighted stock prices and reference preservation", () => {
    const stocks = [stock(), stock({ inventoryId: 2, quantity: 2.9, unitPrice: 500 }), stock({ inventoryId: 3, quantity: -1 }), stock({ inventoryId: 4, title: "Unknown", legacyManagementNo: "" }), stock({ inventoryId: 5, unitPrice: 0 })];
    const invoices = [invoice("3DS LL ホワイト")]; const excluded = new Set([1]); const before = structuredClone(stocks);
    expect(current.buildInvoiceStockProductSummaries(stocks, invoices, excluded)).toMatchSnapshot();
    const filtered = current.filterInvoiceStockItems(stocks, invoices, excluded);
    expect(filtered.map(s => s.inventoryId)).toMatchSnapshot();
    expect(filtered).toEqual(original.filterInvoiceStockItems(stocks, invoices, excluded));
    for (const s of filtered) expect(stocks).toContain(s);
    expect(stocks).toEqual(before);
    for (const quantity of [-2, 0, 0.5, 1, 2.9, NaN, Infinity]) for (const unitPrice of [-1, 0, 0.5, 100, NaN, Infinity]) {
      const inputs = [stock({ quantity, unitPrice })];
      expect(current.buildInvoiceStockProductSummaries(inputs, invoices, new Set())).toEqual(original.buildInvoiceStockProductSummaries(inputs, invoices, new Set()));
    }
    expect(current.buildInvoiceStockProductSummaries(stocks, [], excluded)).toEqual([]);
    expect(current.filterInvoiceStockItems(stocks, [], excluded)).toEqual([]);
  });
  it("captures invoice duplicate aggregation, weighted selling prices, first currency and unmatched omission", () => {
    const invoices = [invoice("3DS LL ホワイト", { orderQty: 2, deliveredQty: 1, sellingPrice: 10, sellingPriceJpy: 1000, currency: "EUR" }), invoice("  3ds  ll ホワイト ", { orderQty: 3, deliveredQty: 0, sellingPrice: 30, sellingPriceJpy: 5000, currency: "USD" }), invoice("New 3DS LL どうぶつの森", { orderQty: 0, deliveredQty: 1, sellingPrice: 50 }), invoice("PSP2000", { orderQty: -1, sellingPrice: 0 })];
    const inputs = [summary("3DS LL ホワイト"), summary("3DS LL random", { managementNos: ["405_相手_3DSLLホワイト"], secured: 2 }), summary("Unknown"), summary("New 3DS LL どうぶつの森", { unitPriceCount: 0, unitPriceTotal: 0 })];
    const before = structuredClone({ inputs, invoices });
    expect(current.withInvoiceProductCounts(inputs, invoices)).toMatchSnapshot();
    expect(current.withInvoiceProductCounts(inputs, invoices)).toEqual(original.withInvoiceProductCounts(inputs, invoices));
    expect(current.withInvoiceProductCounts(inputs, [])).toBe(inputs);
    expect({ inputs, invoices }).toEqual(before);
    for (const orderQty of [-2, 0, 0.5, 3, NaN, Infinity]) for (const sellingPrice of [null, -1, 0, 0.5, 20, NaN, Infinity]) {
      const list = [invoice("3DS LL ホワイト", { orderQty, sellingPrice, sellingPriceJpy: sellingPrice }), invoice("3DS LL ホワイト", { orderQty: 2, sellingPrice: 30 })];
      expect(current.withInvoiceProductCounts(inputs, list)).toEqual(original.withInvoiceProductCounts(inputs, list));
    }
  });
  it("keeps purchase invoice suggestions ahead of direct match while stock direct match stays first", () => {
    const invoices = [invoice("PSP2000 ホワイト"), invoice("3DS LL ホワイト"), invoice("3DS LL White Base")];
    const inputs = [summary("3DS LL ホワイト", { managementNos: ["405_相手_PSP2000ホワイト"] }), summary("3DS LL どうぶつの森", { managementNos: ["407_相手_3DSLLどうぶつの森"] })];
    const outputs = current.withInvoiceProductCounts(inputs, invoices);
    expect(outputs).toMatchSnapshot();
    expect(outputs).toEqual(original.withInvoiceProductCounts(inputs, invoices));
    expect(outputs[0].secured).toBe(1);
    expect(current.findInvoiceProductNameForStockItem(stock({ legacyManagementNo: "405_相手_PSP2000ホワイト" }), invoices)).toBe("3DS LL ホワイト");
  });
  it("replaces stock counts only on invoice summaries and preserves untouched product references", () => {
    const inputs = [summary("3DS LL ホワイト", { invoiceOrdered: 5 }), summary("Unknown"), summary("PSP2000", { invoiceOrdered: 0 })];
    const stocks = [stock(), stock({ quantity: 2.9 }), stock({ quantity: -1 })]; const invoices = [invoice("3DS LL ホワイト")];
    const before = structuredClone({ inputs, stocks, invoices });
    const result = current.withInvoiceStockCountsFromItems(inputs, stocks, invoices);
    expect(result).toMatchSnapshot();
    expect(result).toEqual(original.withInvoiceStockCountsFromItems(inputs, stocks, invoices));
    expect(result[0]).not.toBe(inputs[0]); expect(result[1]).toBe(inputs[1]); expect(result[2]).not.toBe(inputs[2]);
    expect(current.withInvoiceStockCountsFromItems(inputs, stocks, [])).toBe(inputs);
    expect({ inputs, stocks, invoices }).toEqual(before);
  });
});
