import { describe, expect, it } from "vitest";
import * as stockViews from "./stockViews";
import * as stockProposalRules from "./stockProposalRules";
import * as stockProposalValues from "./stockProposalValues";
import * as stockProposalDisplay from "./stockProposalDisplay";
import * as stockForecast from "./stockForecast";
import * as stringValues from "./stringValues";
import { productKey, hasAnyProductText } from "./productText";
import { createZeroStockPurchaseBuilder } from "./stockWaiting";
import { createStockProposalBuilder } from "./stockProposalGroups";
import { loadCurrentPageLabelRules } from "./current-page-labels";
import { loadStockBaseline, STOCK_BASELINE_COMMIT } from "./stock-baseline";
import type { InventoryItem, PurchaseItem, PurchaseRow } from "./dataTypes";
import type { StockItemView, StockProposalProduct, ProductSummary, PurchaseRegistrationInvoice } from "./viewTypes";

type Rules = typeof import("./stockViews") & typeof import("./stockProposalRules") & typeof import("./stockProposalValues") & typeof import("./stockProposalDisplay") & typeof import("./stockForecast") & typeof import("./stringValues") & Pick<typeof import("./productText"), "productKey" | "hasAnyProductText"> & { buildZeroStockPurchaseItemViewsFromRows: ReturnType<typeof import("./stockWaiting").createZeroStockPurchaseBuilder>; buildStockProposalGroups: ReturnType<typeof import("./stockProposalGroups").createStockProposalBuilder> };
const original = loadStockBaseline<Rules>();
const { actualProductTitle } = loadCurrentPageLabelRules();
const current: Rules = {
  ...stockViews, ...stockProposalRules, ...stockProposalValues, ...stockProposalDisplay, ...stockForecast,
  ...stringValues, productKey, hasAnyProductText,
  buildZeroStockPurchaseItemViewsFromRows: createZeroStockPurchaseBuilder(actualProductTitle),
  buildStockProposalGroups: createStockProposalBuilder(actualProductTitle),
};

function item(patch: Partial<PurchaseItem> = {}): PurchaseItem { return { id: 10, inventory_id: 1, title: "PS Vita 1100", quantity: "2.5", currentInventoryQuantity: "0", unit_price: "100.5", etc: "在庫001, date, Supplier", ...patch }; }
function row(patch: Partial<PurchaseRow> = {}): PurchaseRow { return { id: 1, status: "ordered", purchase_date: "2026-09-01", purchase_items: [item()], ...patch }; }
function inventory(patch: Partial<InventoryItem> = {}): InventoryItem { return { id: 1, title: "PS Vita 1100", quantity: "3.9", unit_price: 100, etc: "在庫001, date, Supplier", supplierName: " Seller ", itemLabels: [{ labelId: "L1", status: "received" }], ...patch }; }
function stock(patch: Partial<StockItemView> = {}): StockItemView { return { key: "s1", inventoryId: 1, labelId: "L1", status: "在庫", title: "PS Vita 1100", category: "", legacyManagementNo: "在庫001", allocationLabel: "", unitPrice: 100, quantity: 2, supplier: { name: "Seller", url: "https://supplier.invalid" }, purchaseDate: "2026-09-01", ...patch }; }
function product(patch: Partial<StockProposalProduct> = {}): StockProposalProduct { return { key: "p", title: "Product", model: "その他", stockQuantity: 0, waitingQuantity: 0, totalQuantity: 0, unitPriceTotal: 0, unitPriceQuantity: 0, minUnitPrice: null, maxUnitPrice: null, details: [], searchText: "product", ...patch }; }
function forecast(patch: Partial<ProductSummary> = {}): ProductSummary { return { key: "p", title: "Product", required: 2, secured: 1, waiting: 1, unitPriceTotal: 100, unitPriceCount: 1, sellingPrice: 20, sellingPriceJpy: 3000, sellingCurrency: "EUR", ...patch }; }
const invoice: PurchaseRegistrationInvoice = { invoiceNo: "405", partner: "相手", totalOrderQty: 2, totalDeliveredQty: 0, remainingQty: 2 };
const quantities = [undefined, null, "", "-2", "0", "0.5", "1", "2.9", "bad", Infinity];
const titles = ["", " 登録漏れ PS Vita 1100 ", "登録漏れPSVita1000", " Vita 1100", "Ｎｅｗ３ＤＳＸＬ", "New 3DS XL", "3ds xl", "New2DSLL", "充電器", "USBケーブル 本体", "Console ケース", "ケース unit", "バッテリー", "Switch Lite", "Other😀"];
const encode = (value: unknown) => JSON.stringify(value);

describe(`R07-R09 stock rules against actual source at ${STOCK_BASELINE_COMMIT}`, () => {
  it("captures stock remainder, waiting quantities, labels, prices and date precedence", () => {
    const inventories = [inventory(), inventory({ id: 2, quantity: "0" }), inventory({ id: 3, purchase_unit_price: "", categories: [" "], category: "PSP", last_purchase_date: "", updated_at: "2026-09-02", itemLabels: [{ labelId: " ", status: "received" }, { labelId: "A", status: "shipped" }, { labelId: "B", status: " " }, { labelId: "B", status: "stocked" }] }), inventory({ id: 4, itemLabels: [], quantity: "1.9" })];
    const rows = [row(), row({ id: 2, status: "purchased" }), row({ id: 3, purchase_date: "", purchase_items: [item({ title: "", etc: "", purchase_date: "2026-09-03", itemLabels: [{ labelId: "A", legacyManagementNo: "在庫FromLabel" }] })] }), row({ id: 4, purchase_items: [item({ title: "充電器" })] })];
    expect(current.buildStockItemViewsFromInventories(inventories).map(encode)).toMatchSnapshot();
    expect(current.buildZeroStockPurchaseItemViewsFromRows(rows, inventories).map(encode)).toMatchSnapshot();
  });
  it("keeps resolver construction lazy and uses unchanged missing-title fallbacks", () => {
    const seen: PurchaseItem[] = [];
    const resolver = (value: PurchaseItem) => { seen.push(value); return actualProductTitle(value); };
    const waiting = createZeroStockPurchaseBuilder(resolver); const proposal = createStockProposalBuilder(resolver);
    expect(seen).toEqual([]);
    const missing = item({ etc: "在庫001_New3DSLL" }); Reflect.deleteProperty(missing, "title");
    const nil = item({ id: 11, etc: "在庫002_PSP3000" }); Reflect.set(nil, "title", null);
    const input = row({ purchase_items: [missing, nil] }); const before = structuredClone(input);
    const activeInventories = [inventory()]; const inventoriesBefore = structuredClone(activeInventories);
    expect(waiting([input], activeInventories)).toEqual(original.buildZeroStockPurchaseItemViewsFromRows([input], activeInventories));
    expect(seen).toEqual(input.purchase_items); expect(seen[0]).toBe(missing); expect(seen[1]).toBe(nil);
    seen.length = 0; expect(proposal([], [input], "")).toEqual(original.buildStockProposalGroups([], [input], ""));
    expect(seen).toEqual(input.purchase_items); expect(input).toEqual(before); expect(activeInventories).toEqual(inventoriesBefore);
    seen.length = 0; waiting([input], []); waiting([row({ status: "purchased" })], []); proposal([], [row({ status: "purchased" })], ""); expect(seen).toEqual([]);
  });
  it("preserves 200 quantity/status combinations and inventory/supplier references", () => {
    let count = 0;
    for (const quantity of quantities) for (const status of [undefined, "ordered", "shipped", "purchased", "unknown"]) for (const labelStatus of [undefined, "", "received", "shipped"]) {
      const inv = inventory({ quantity, itemLabels: [{ labelId: "A", status: labelStatus }, { labelId: "A", status: "stocked" }] });
      const input = row({ status, purchase_items: [item({ quantity: String(quantity ?? ""), itemLabels: [{ labelId: "A", status: labelStatus }] })] });
      const before = structuredClone({ inv, input });
      const actual = current.buildStockItemViewsFromInventories([inv]);
      expect(actual).toEqual(original.buildStockItemViewsFromInventories([inv]));
      if (actual.length > 1) expect(actual[0].supplier).toBe(actual[1].supplier);
      expect(current.buildZeroStockPurchaseItemViewsFromRows([input], [inv])).toEqual(original.buildZeroStockPurchaseItemViewsFromRows([input], [inv]));
      expect({ inv, input }).toEqual(before); count++;
    }
    expect(count).toBe(200);
    for (const inventory_id of [undefined, null, -1, 0, 1, Infinity, NaN]) for (const currentInventoryQuantity of quantities) {
      const input = row({ purchase_items: [item({ inventory_id, currentInventoryQuantity })] });
      expect(current.buildZeroStockPurchaseItemViewsFromRows([input], [inventory()])).toEqual(original.buildZeroStockPurchaseItemViewsFromRows([input], [inventory()]));
    }
  });
  it("keeps sorting and grouping quantities while retaining each input object", () => {
    const inputs = Array.from({ length: 400 }, (_, index) => stock({ key: `s${index}`, title: ["商品2", "商品10", "New 3DS LL", "PSP3000"][index % 4], category: ["", "棚2", "棚10", " "][index % 4], legacyManagementNo: `在庫${400 - index}`, quantity: index % 7 - 2 }));
    const before = structuredClone(inputs); const groups = current.buildStockItemGroups(inputs);
    expect(groups).toEqual(original.buildStockItemGroups(inputs));
    expect(groups.map((group) => [group.name, group.quantity, group.items.length])).toMatchSnapshot();
    for (const group of groups) for (const entry of group.items) expect(entry).toBe(inputs[Number(entry.key.slice(1))]);
    expect(inputs).toEqual(before); expect(current.buildStockItemGroups([])).toEqual([]);
  });
  it("captures title normalization, accessory/body precedence and invoice exclusions", () => {
    expect(titles.flatMap((title) => [undefined, null, "", "付属品", "本体", "Vita1000"].map((category) => encode({ title, category, normalized: current.normalizeStockProposalTitle(title), model: current.stockProposalModelName(title, category), accessory: current.isStockProposalAccessory(title, category), fulfillment: current.isFulfillmentStockItem(stock({ title, category: category ?? "" })) })))).toMatchSnapshot();
    expect([undefined, null, "", "403_ネレ", "403_ネレ2", " 403_ネレ ", "４０３_ネレ", "405_A", "４０５_A", "405", "1000_A", "在庫405_A"].map((number) => [number, current.isExcludedStockProposalManagementNo(number), current.isUnfinishedInvoiceManagementNo(number, new Set(["405", "1000"]))])).toMatchSnapshot();
  });
  it("captures merged proposal counts, weighted prices, detail order and search coverage", () => {
    const stocks = [stock(), stock({ key: "s2", title: "Vita 1000", unitPrice: 200, quantity: 1, labelId: "L2" }), stock({ title: "Vita 1000", unitPrice: 0, quantity: 3 }), stock({ legacyManagementNo: "403_ネレ" }), stock({ legacyManagementNo: "405_A" }), stock({ title: "充電器" }), stock({ title: "PSP3000 本体 ケース", unitPrice: -1, quantity: -2 })];
    const rows = [row(), row({ id: 2, purchase_items: [item({ id: 2, etc: "在庫002" }), item({ id: 3, etc: "405_A", title: "Other", quantity: "1" })] }), row({ id: 3, status: "purchased" })];
    const before = structuredClone({ stocks, rows });
    const result = current.buildStockProposalGroups(stocks, rows, "", [invoice]);
    expect(result.map(encode)).toMatchSnapshot(); expect(result).toEqual(original.buildStockProposalGroups(stocks, rows, "", [invoice]));
    for (const query of ["", " VITA ", "seller", "supplier", "l2", "在庫002", "supplier.invalid", "2026-09", "unknown"]) {
      expect(current.buildStockProposalGroups(stocks, rows, query, [invoice])).toEqual(original.buildStockProposalGroups(stocks, rows, query, [invoice]));
    }
    const detail = result.flatMap((group) => group.products).flatMap((entry) => entry.details).find((entry) => entry.labelId === "L1");
    expect(detail?.supplier).toBe(stocks[0].supplier); expect({ stocks, rows }).toEqual(before);
  });
  it("preserves proposal boundary inputs and unfinished invoice gating without mutation", () => {
    for (let index = 0; index < 180; index++) {
      const stocks = [stock({ title: titles[index % titles.length], quantity: [-2, 0, 0.5, 2, NaN, Infinity][index % 6], unitPrice: [-1, 0, 0.5, 100, NaN, Infinity][Math.floor(index / 6) % 6], legacyManagementNo: ["在庫001", "405_A", "403_ネレ", "４０５_A", "-"][index % 5] })];
      const rows = [row({ status: ["ordered", "shipped", "purchased"][index % 3], purchase_items: [item({ title: titles[(index + 1) % titles.length], quantity: String(quantities[index % quantities.length] ?? ""), etc: ["在庫002", "405_A", "", "403_ネレ"][index % 4] }), item({ id: 11, etc: "", title: "PSP3000" })] })];
      const invoices = index % 2 ? [invoice] : []; const before = structuredClone({ stocks, rows, invoices });
      expect(current.buildStockProposalGroups(stocks, rows, "", invoices)).toEqual(original.buildStockProposalGroups(stocks, rows, "", invoices));
      expect(current.isStockWaitingPurchaseRow(rows[0], new Set(invoices.map((value) => value.invoiceNo)))).toBe(original.isStockWaitingPurchaseRow(rows[0], new Set(invoices.map((value) => value.invoiceNo))));
      expect({ stocks, rows, invoices }).toEqual(before);
    }
  });
  it("preserves deliberate accumulator mutation, map reuse and detail references", () => {
    for (const quantity of [-2, 0, 0.5, 2, NaN, Infinity]) for (const price of [-1, 0, 0.5, 100, NaN, Infinity]) {
      const actual = product(); const expected = product();
      current.addStockProposalPrice(actual, price, quantity); original.addStockProposalPrice(expected, price, quantity); expect(actual).toEqual(expected);
    }
    const detail = { source: "stock" as const, managementNo: "在庫001", labelId: "L1", quantity: 1, unitPrice: 10, status: "RECEIVED", supplier: { name: "Seller", url: "" }, date: "" };
    const actual = product(); const expected = product(); current.appendStockProposalDetail(actual, detail); original.appendStockProposalDetail(expected, detail);
    expect(actual).toEqual(expected); expect(actual.details[0]).toBe(detail);
    const map = new Map<string, StockProposalProduct>(); const oldMap = new Map<string, StockProposalProduct>();
    const first = current.getOrCreateStockProposalProduct(map, "PS Vita 1100", "PS Vita 1000");
    const second = current.getOrCreateStockProposalProduct(map, "Vita 1000", "PS Vita 1000");
    original.getOrCreateStockProposalProduct(oldMap, "PS Vita 1100", "PS Vita 1000"); original.getOrCreateStockProposalProduct(oldMap, "Vita 1000", "PS Vita 1000");
    expect(first).toBe(second); expect(map).toEqual(oldMap);
  });
  it("captures average rounding, range and management labels without extra normalization", () => {
    expect([-1, 0, 0.5, 100, NaN, Infinity].flatMap((total) => [-1, 0, 1, 2, Infinity].map((quantity) => current.proposalAveragePrice(total, quantity)))).toMatchSnapshot();
    const products = [product(), product({ unitPriceTotal: 301, unitPriceQuantity: 2 }), product({ unitPriceTotal: 300, unitPriceQuantity: 2, minUnitPrice: 100, maxUnitPrice: 200 }), product({ unitPriceTotal: 300, unitPriceQuantity: 2, minUnitPrice: 100, maxUnitPrice: 100 })];
    expect(products.map((entry) => current.stockProposalPriceLabel(entry))).toMatchSnapshot();
    expect([[], ["", "-"], [" A ", "A", "a", "Ａ", "A", "B", "C"]].map((numbers) => current.stockProposalManagementLabel(product({ details: numbers.map((managementNo) => ({ source: "stock", managementNo, quantity: 1, unitPrice: 1, status: "", supplier: { name: "", url: "" }, date: "" })) })))).toMatchSnapshot();
  });
  it("preserves forecast rounding, empty/unknown/mixed currencies and ignored quantities", () => {
    const cases = [[], [forecast()], [forecast({ sellingPrice: 0 })], [forecast({ sellingPriceJpy: 0 })], [forecast({ sellingCurrency: "USD" }), forecast({ sellingCurrency: "eur" })], [forecast({ sellingCurrency: "" }), forecast({ sellingCurrency: "EUR" })], [forecast({ sellingCurrency: "JPY" })], [forecast({ required: -1 })], [forecast({ required: 0.5, sellingPrice: 1.5, sellingPriceJpy: 10.5 })]];
    expect(cases.map((products) => current.buildForecastSummary(products, 1000.5))).toMatchSnapshot();
    for (const required of [-2, 0, 0.5, 2, NaN, Infinity]) for (const price of [undefined, null, -1, 0, 0.5, 100, NaN, Infinity]) for (const currency of [null, "", "EUR", "usd", "ユーロ", "円"]) {
      const products = [forecast({ required, sellingPrice: price, sellingPriceJpy: price, sellingCurrency: currency })]; const before = structuredClone(products);
      expect(current.buildForecastSummary(products, -100.5)).toEqual(original.buildForecastSummary(products, -100.5)); expect(products).toEqual(before);
    }
  });
});
