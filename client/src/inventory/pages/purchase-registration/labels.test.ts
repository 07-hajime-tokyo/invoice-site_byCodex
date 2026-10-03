import { createHash } from "node:crypto";
import * as labelTitles from "./labelTitles";
import * as labelStatus from "./labelStatus";
import * as labelTitleOverrides from "./labelTitleOverrides";
import * as labelPrintLayout from "./labelPrintLayout";
import * as inventoryLabelViews from "./inventoryLabelViews";
import * as productPresentation from "./productPresentation";
import * as productText from "./productText";
import * as qr from "./qr";
import { createPurchaseLabelBuilders } from "./purchaseLabelViews";
import { loadCurrentPageLabelRules, type CurrentPageLabelRules } from "./current-page-labels";
import { describe, expect, it } from "vitest";
import { loadLabelBaseline, LABEL_BASELINE_COMMIT } from "./label-baseline";
import type { PurchaseItem, PurchaseRow, InventoryItem } from "./dataTypes";
import type { LabelView, PurchaseRegistrationInvoice } from "./viewTypes";

type Rules = typeof import("./labelTitles") & typeof import("./labelStatus") & typeof import("./labelTitleOverrides") & typeof import("./labelPrintLayout") & typeof import("./inventoryLabelViews") & typeof import("./productPresentation") & typeof import("./productText") & typeof import("./qr") & ReturnType<typeof import("./purchaseLabelViews").createPurchaseLabelBuilders>;
const original = loadLabelBaseline<Rules & CurrentPageLabelRules>();
const pageRules = loadCurrentPageLabelRules();
const current: Rules = {
  ...labelTitles, ...labelStatus, ...labelTitleOverrides, ...labelPrintLayout, ...inventoryLabelViews,
  ...productPresentation, ...productText, ...qr,
  ...createPurchaseLabelBuilders(pageRules.actualProductTitle),
};

function item(patch: Partial<PurchaseItem> = {}): PurchaseItem {
  return { id: 10, title: " New 3DS LL ホワイトベース ", quantity: "3", currentInventoryQuantity: "2", unit_price: "100.5", etc: "405_相手_New3DSLL, date, Supplier", itemLabels: [{ labelId: "LABELAA", id: 1, status: "received" }, { labelId: "LABELAB", id: 2, status: "stocked" }], ...patch };
}
function row(patch: Partial<PurchaseRow> = {}): PurchaseRow {
  return { id: 1, purchase_date: "2026-08-10", purchase_items: [item()], csvSupplierName: " Seller ", csvSupplierUrl: " https://supplier.invalid ", extra: { trackingNumber: " 9123 ", carrier: "yamato" }, ...patch };
}
function inventory(patch: Partial<InventoryItem> = {}): InventoryItem {
  return { id: 2, title: "PSP 3000 ブラック", quantity: "2", etc: "在庫0814_1, date, supplier", itemLabels: item().itemLabels, ...patch };
}
function label(patch: Partial<LabelView> = {}): LabelView {
  return { key: "label1", labelId: "LABELAA", rawStatus: "received", status: "入庫済み", title: "PSP 3000 ブラック", printTitle: "PSP 3000 Black", category: "", legacyManagementNo: "405_相手_10", allocationLabel: "", unitPrice: 10, supplier: { name: "seller", url: "" }, purchaseDate: "2026-08-10", rowId: 1, itemId: 10, ...patch };
}
const titles = ["", " ", "_-・･", "new 3ds ll", "Ｎｅｗ３ＤＳＸＬ", "New 2DS LL モンスターボール", "3DSLL ホワイトベース", "New3DSLL どうぶつの森", "PS Vita 1100", "Vita 2000", "PSP3000", "PSP2000", "PSP Go", "ミント×ホワイト", "ホワイトＸミント", "ミント ホワイト", "レッド・ブルー・ホワイト", "パール ホワイト 限定版", "クリスタル･ブラック", "サファイア·ブルー", "どうぶつの森", "ｶﾀｶﾅ_Ｘ", "ＤＳＬｉｔｅ", "ゲームボーイプレイヤー", "Game Boy Advance", "Callaway", "shopping", "PING Driver", "ピン シャフト", "Nintendo Switch Lite", "シャフト", "その他😀", "A\nB"];
const statuses = [undefined, null, "", " ", "ordered", "received", "stocked", "shipped", "returned", "cancelled", " RECEIVED ", "Received", "unknown"];
const summary: PurchaseRegistrationInvoice = { invoiceNo: "405", partner: "相手", totalOrderQty: 1, totalDeliveredQty: 0, remainingQty: 1 };
const encode = (value: unknown) => JSON.stringify(value);

describe(`R06 label rules against actual source at ${LABEL_BASELINE_COMMIT}`, () => {
  it("captures title transformation order, width variants, grouping categories and status whitespace", () => {
    expect(titles.map((title) => encode({ title, order: current.formatLabelOrderTitle(title), legacy: current.formatLabelPrintTitleLegacy(title), print: current.formatLabelPrintTitle(title), category: current.stockModelName(title), key: current.normalizeLabelTitleKey(title) }))).toMatchSnapshot();
    expect(statuses.map((status) => [status, current.labelStatusLabel(status), current.labelBadgeClass(status)])).toMatchSnapshot();
    expect(["", "405_相手_3DSLL_1/2", "405_相手_1/2_ホワイトベース", "４０５_相手_3DSLL", "1000_相手_New3DS", "ebay_1", "405__", "405_相手_*PSP3000"].map((number) => [number, current.labelOrderTitleFromManagementNo(number), current.labelAllocationLabel(number)])).toMatchSnapshot();
    for (const title of titles) for (const suffix of ["", " ランダムカラー", " ホワイトベース", " 限定版", "＿ミント×ホワイト"]) {
      const text = title + suffix;
      expect(current.formatLabelPrintTitle(text)).toBe(original.formatLabelPrintTitle(text));
      expect(current.formatLabelOrderTitle(text)).toBe(original.formatLabelOrderTitle(text));
      expect(current.stockModelName(text)).toBe(original.stockModelName(text));
    }
  });
  it("keeps override priority, sanitization, empty fallback and object references", () => {
    const rawValues = [undefined, null, 0, "bad", [], ["A"], {}, { valid: " name ", empty: "", number: 1, nested: {}, nil: null }, JSON.parse('{"__proto__":"value","constructor":"title"}')];
    expect(rawValues.map((value) => current.sanitizeStringRecord(value))).toMatchSnapshot();
    const states = [current.emptyLabelTitleOverrides(), { byLabelId: { LABELAA: "ミントホワイト" }, byTitleKey: { psp3000ブラック: "Key" } }, { byLabelId: { LABELAA: " " }, byTitleKey: { psp3000ブラック: "ホワイトベース" } }, { byLabelId: { LABELAA: "_" }, byTitleKey: {} }];
    for (const input of [label(), label({ title: "", printTitle: "PSP 3000 ブラック" }), label({ labelId: "OTHER", title: "", printTitle: "" })]) for (const state of states) {
      const before = structuredClone({ input, state });
      const actual = current.applyLabelTitleOverride(input, state);
      expect(actual).toEqual(original.applyLabelTitleOverride(input, state));
      expect(actual).not.toBe(input); expect(actual.supplier).toBe(input.supplier);
      expect({ input, state }).toEqual(before);
    }
    const emptyA = current.emptyLabelTitleOverrides(); const emptyB = current.emptyLabelTitleOverrides();
    expect(emptyA).not.toBe(emptyB); expect(emptyA.byLabelId).not.toBe(emptyB.byLabelId);
  });
  it("captures purchase, stock and closed-invoice label output differences", () => {
    const rows = [row(), row({ id: 2, purchase_date: "", purchase_items: [item({ title: " ", etc: "405_相手_new3dsll", estimated_purchase_date: "2026-08-11", itemLabels: [{ labelId: "", id: 0, status: null, localInventoryId: 0 }, { labelId: "LABELAC", legacyManagementNo: "999_Other", status: " RECEIVED " }] })] }), row({ id: 3, purchase_items: [item({ etc: "", inventory_id: 12, itemLabels: [{ labelId: "L", legacyManagementNo: "406_Label" }] }), item({ id: 11, itemLabels: [] })] }), row({ id: 4, purchase_items: [] })];
    const stocks = [inventory(), inventory({ id: 3, quantity: "2.9", categories: [" "], category: "CAT", purchase_unit_price: "", unit_price: 100, last_purchase_date: "", updated_at: "2026-09-01", itemLabels: [{ labelId: " ", status: "received" }, { labelId: "A", status: "shipped" }, { labelId: "B", status: " " }, { labelId: "C", status: "" }, { labelId: "D", status: "stocked" }] }), inventory({ id: 4, quantity: "0" })];
    expect(current.buildLabelViews(rows).map(encode)).toMatchSnapshot();
    expect(current.buildInventoryLabelViews(stocks).map(encode)).toMatchSnapshot();
    expect([undefined, [], [summary]].map((summaries) => current.buildClosedInvoiceInventoryLabelViews(rows, summaries).map(encode))).toMatchSnapshot();
    const before = structuredClone({ rows, stocks });
    const actual = current.buildLabelViews(rows);
    expect(actual).toEqual(original.buildLabelViews(rows)); expect(actual[0].supplier).toBe(actual[1].supplier); expect(actual[0].supplier).not.toBe(actual[2].supplier);
    expect(current.buildInventoryLabelViews(stocks)).toEqual(original.buildInventoryLabelViews(stocks));
    expect({ rows, stocks }).toEqual(before);
  });
  it("keeps title resolution lazy, captures the supplied function and preserves missing titles", () => {
    const seen: PurchaseItem[] = [];
    const builders = createPurchaseLabelBuilders((value) => { seen.push(value); return pageRules.actualProductTitle(value); });
    expect(seen).toEqual([]);
    const missing = item({ etc: "405_相手_New3DSLL", itemLabels: [] });
    Reflect.deleteProperty(missing, "title");
    const nil = item({ etc: "405_相手_PSP2000_White" });
    Reflect.set(nil, "title", null);
    const input = row({ purchase_items: [missing, nil, item({ title: " " })] });
    const before = structuredClone(input);
    expect(builders.buildLabelViews([input])).toEqual(original.buildLabelViews([input]));
    expect(seen).toEqual(input.purchase_items);
    seen.forEach((value, index) => expect(value).toBe(input.purchase_items[index]));
    seen.length = 0;
    expect(builders.buildClosedInvoiceInventoryLabelViews([input], undefined)).toEqual([]);
    expect(builders.buildClosedInvoiceInventoryLabelViews([input], [summary])).toEqual([]);
    expect(seen).toEqual([]); expect(input).toEqual(before);
  });
  it("preserves quantity caps, label status rules, ID overrides and closed invoice membership", () => {
    let combinations = 0;
    for (const quantity of [undefined, null, "", "0", "-1", "0.9", "1", "1.9", "3", "bad", Infinity]) for (const status of statuses) for (const id of ["", " ", "ID"]) {
      const labels = [{ labelId: id, status, localInventoryId: 0 }, { labelId: "NEXT", status: "stocked" }];
      const input = row({ purchase_items: [item({ currentInventoryQuantity: quantity, itemLabels: labels, inventory_id: 99 })] });
      const inv = inventory({ quantity, itemLabels: labels }); const before = structuredClone({ input, inv });
      expect(current.isInventoryPrintableLabel(labels[0])).toBe(original.isInventoryPrintableLabel(labels[0]));
      expect(current.buildLabelViews([input])).toEqual(original.buildLabelViews([input]));
      expect(current.buildInventoryLabelViews([inv])).toEqual(original.buildInventoryLabelViews([inv]));
      expect(pageRules.buildStockItemViewsFromInventories([inv])).toEqual(original.buildStockItemViewsFromInventories([inv]));
      for (const summaries of [undefined, [], [summary]]) expect(current.buildClosedInvoiceInventoryLabelViews([input], summaries)).toEqual(original.buildClosedInvoiceInventoryLabelViews([input], summaries));
      expect({ input, inv }).toEqual(before); combinations++;
    }
    expect(combinations).toBe(429);
    for (const managementNo of ["", "ebay_1", "E0814_1", "1000_A", "405_A", "406_B"]) {
      const input = row({ purchase_items: [item({ etc: managementNo })] });
      expect(current.buildClosedInvoiceInventoryLabelViews([input], [summary])).toEqual(original.buildClosedInvoiceInventoryLabelViews([input], [summary]));
    }
  });
  it("preserves large label lists, duplicate IDs and per-row supplier sharing", () => {
    const inputs = Array.from({ length: 120 }, (_, index) => row({ id: index, purchase_items: [
      item({ id: index * 2, title: titles[index % titles.length], itemLabels: [{ labelId: "SAME", status: "received" }, { labelId: "SAME", status: "stocked" }, { labelId: `L${index}`, status: "" }] }),
      item({ id: index * 2 + 1, title: "", currentInventoryQuantity: "1.9" }),
    ] }));
    const before = structuredClone(inputs); const actual = current.buildLabelViews(inputs);
    expect(actual).toEqual(original.buildLabelViews(inputs)); expect(actual).toHaveLength(600);
    expect(current.buildClosedInvoiceInventoryLabelViews(inputs, [])).toEqual(original.buildClosedInvoiceInventoryLabelViews(inputs, []));
    expect(actual[0].supplier).toBe(actual[4].supplier); expect(actual[0].supplier).not.toBe(actual[5].supplier);
    expect(inputs).toEqual(before); expect(current.buildLabelViews([])).toEqual([]); expect(current.buildInventoryLabelViews([])).toEqual([]);
  });
  it("preserves position arithmetic, page boundaries, nonfinite inputs and item identity", () => {
    const positions = [NaN, Infinity, -Infinity, -2, 0, 1, 1.9, 23.9, 24, 25];
    const counts = [-25, -1, 0, 1, 23, 24, 25, 49, 1.5, NaN, Infinity];
    expect(positions.map((position) => [current.clampLabelStartPosition(position), ...counts.map((count) => current.nextLabelStartPosition(position, count))])).toMatchSnapshot();
    for (const count of [0, 1, 23, 24, 25, 48, 49, 1001]) for (const size of [1, 2, 24, 100, 1.5, NaN, Infinity]) {
      const values = Array.from({ length: count }, (_, id) => ({ id })); const before = [...values];
      const actual = current.chunkArray(values, size);
      expect(actual).toEqual(original.chunkArray(values, size));
      for (const value of actual.flat()) expect(value).toBe(values[value.id]);
      expect(values).toEqual(before);
    }
    // Zero/negative sizes with nonempty arrays never terminate in the original; do not invoke them.
    expect(current.chunkArray([], 0)).toEqual(original.chunkArray([], 0));
  });
  it("preserves date scope and category/checklist order without cloning labels", () => {
    expect([-1, 0, 1].flatMap((rowId) => ["", " ", "2026-08-09", "2026-08-10", "2026-08-10T12:00", "bad"].map((purchaseDate) => current.isWithinLabelScope(label({ rowId, purchaseDate }), "2026-08-10")))).toMatchSnapshot();
    const inputs = Array.from({ length: 350 }, (_, index) => label({ key: `L${index}`, labelId: `L${index}`, title: titles[index % titles.length], category: ["", "New 3DS LL", "棚10", "棚2", " ", "PSP 3000"][index % 6], legacyManagementNo: `在庫${350 - index}` }));
    const before = structuredClone(inputs); const groups = current.buildLabelPrintGroups(inputs); const checklist = current.buildChecklistRows(inputs);
    expect(groups).toEqual(original.buildLabelPrintGroups(inputs)); expect(checklist).toEqual(original.buildChecklistRows(inputs));
    expect(groups.map((group) => [group.name, group.labels.length])).toMatchSnapshot();
    for (const group of [...groups, ...checklist]) for (const value of group.labels) expect(value).toBe(inputs[Number(value.key.slice(1))]);
    expect(inputs).toEqual(before); expect(current.buildChecklistRows([])).toEqual([]);
  });
  it("captures QR matrix and path bytes including non-ASCII and capacity boundaries", () => {
    const values = ["", " ", "abcdefg", " B000001 ", "A".repeat(17), "A".repeat(18), "A".repeat(1000), "日本語", "ＡＢＣ", "😀", "ß", "a\nb"];
    expect(values.map((value) => {
      const matrix = current.createQrMatrix(value); const path = current.buildQrPath(matrix);
      return { inputLength: value.length, rows: matrix.map((row) => row.map(Number).join("")), pathHash: createHash("sha256").update(path).digest("hex") };
    })).toMatchSnapshot();
    for (let index = 0; index < 300; index++) {
      const value = `${["B", "abc", "日本語", "😀", "ß", "ＡＢＣ"][index % 6]}${String(index).padStart(index % 32, "0")}`;
      const actual = current.createQrMatrix(value); const expected = original.createQrMatrix(value); const before = structuredClone(actual);
      expect(actual).toEqual(expected); expect(current.buildQrPath(actual)).toBe(original.buildQrPath(expected)); expect(actual).toEqual(before);
      expect(current.createQrMatrix(value)).not.toBe(actual);
    }
    for (const matrix of [[], [[]], [[true, false], [false, true]], [[true], [], [false, true, true]]]) {
      const before = structuredClone(matrix); expect(current.buildQrPath(matrix)).toBe(original.buildQrPath(matrix)); expect(matrix).toEqual(before);
    }
  });
});
