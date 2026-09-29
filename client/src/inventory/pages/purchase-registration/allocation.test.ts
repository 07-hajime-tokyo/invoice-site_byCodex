import * as labelMerging from "./labelMerging";
import * as allocationGroups from "./allocationGroups";
import * as StatCard from "./StatCard";
import * as ProductFulfillmentTable from "./ProductFulfillmentTable";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadAllocationBaseline, ALLOCATION_BASELINE_COMMIT } from "./allocation-baseline";
import type { PurchaseItem, PurchaseRow } from "./dataTypes";
import type { AllocationGroup, LabelView, ProductSummary, PurchaseRegistrationInvoice, ProductDetailFilter } from "./viewTypes";

type Rules = typeof import("./allocationGroups") & typeof import("./labelMerging") & typeof import("./StatCard") & typeof import("./ProductFulfillmentTable");
const original = loadAllocationBaseline<Rules>();
const current: Rules = { ...labelMerging, ...allocationGroups, ...StatCard, ...ProductFulfillmentTable };
const item = (patch: Partial<PurchaseItem> = {}): PurchaseItem => ({ id: 1, title: "3DS LL ホワイト", quantity: "3", currentInventoryQuantity: "1", unit_price: "100", etc: "405_相手_3DSLLホワイト", ...patch });
const row = (patch: Partial<PurchaseRow> = {}): PurchaseRow => ({ id: 1, status: "ordered", purchase_items: [item()], ...patch });
const product = (patch: Partial<ProductSummary> = {}): ProductSummary => ({ key: "p", title: "Product", required: 3, secured: 1, waiting: 1, unitPriceTotal: 201, unitPriceCount: 2, sellingPrice: 20, sellingCurrency: "EUR", ...patch });
const label = (patch: Partial<LabelView> = {}): LabelView => ({ key: "l", labelId: "L1", rawStatus: "stocked", status: "現在庫", title: "Product", printTitle: "Product", category: "", legacyManagementNo: "405_相手_3DSLL", allocationLabel: "405", unitPrice: 100, supplier: { name: "supplier", url: "" }, purchaseDate: "", rowId: 1, itemId: 1, ...patch });
const group = (patch: Partial<AllocationGroup> = {}): AllocationGroup => ({ key: "invoice-405", label: "No.405 相手", partner: "相手", rows: [row()], products: [product()], labels: [], required: 3, secured: 1, waiting: 2, purchaseTotal: 300, ...patch });
const invoice = (invoiceNo: string, partner = "相手"): PurchaseRegistrationInvoice => ({ invoiceNo, partner, totalOrderQty: 4, totalDeliveredQty: 1, remainingQty: 3 });
const encode = (v: unknown) => JSON.stringify(v);
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, any>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function uiSummary(node: ReactNode) {
  const html = renderToStaticMarkup(node);
  return { hash: digest(html), text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), controls: elements(node).filter(n => n.props.onClick || n.props.onKeyDown).map(n => ({ type: n.type, className: n.props.className, role: n.props.role, tabIndex: n.props.tabIndex, keydown: Boolean(n.props.onKeyDown) })) };
}

describe(`allocation groups and fulfillment UI against ${ALLOCATION_BASELINE_COMMIT}`, () => {
  it("captures invoice availability, numeric order, partners, ebay and inventory groups", () => {
    const rows = [row(), row({ id: 2, purchase_items: [item({ etc: "405_別相手_PSP3000", title: "PSP3000", quantity: "2.5" })] }), row({ id: 3, purchase_items: [item({ etc: "010_相手_3DSLL" })] }), row({ id: 4, purchase_items: [item({ etc: "ebay_001", unit_price: -20 })] }), row({ id: 5, purchase_items: [item({ etc: "在庫001", quantity: "-2" })] }), row({ id: 6, purchase_items: [] })];
    const before = structuredClone(rows);
    const sets = [undefined, [], [invoice("405", "InvoicePartner"), invoice("1000"), invoice("009"), invoice("009", "duplicate")]];
    expect(sets.map(list => current.buildAllocationGroups(rows, list)).map(encode)).toMatchSnapshot();
    for (const list of sets) {
      const result = current.buildAllocationGroups(rows, list);
      expect(result).toEqual(original.buildAllocationGroups(rows, list));
      for (const g of result) for (const r of g.rows) expect(rows.some(input => input === r)).toBe(true);
    }
    expect(rows).toEqual(before);
  });
  it("preserves totals and label generation over quantity, status and summary presence", () => {
    for (const quantity of ["-2", "0", "0.5", "3", "bad", "Infinity"]) for (const status of [undefined, "ordered", "purchased", "shipped"]) for (const list of [undefined, [], [invoice("405")]]) {
      const rows = [row({ status, purchase_items: [item({ quantity, unit_price: quantity, currentInventoryQuantity: "2.5", itemLabels: [{ labelId: "A", status: "stocked" }] })] })];
      const before = structuredClone(rows);
      expect(current.buildAllocationGroups(rows, list)).toEqual(original.buildAllocationGroups(rows, list));
      expect(rows).toEqual(before);
    }
  });
  it("captures label merge priority, canonical IDs, insertion order and blank IDs", () => {
    const a = [label(), label({ labelId: " ", inventoryId: 9 }), label({ labelId: "B", inventoryId: 2 })];
    const b = [label({ labelId: " l1 ", inventoryId: 3, rawStatus: "shipped", title: "next" }), label({ labelId: "b", inventoryId: null, title: "next B" }), label({ labelId: "C" })];
    const before = structuredClone({ a, b });
    expect(current.mergeLabelViewsById(a, b)).toMatchSnapshot();
    expect(current.mergeLabelViewsById(a, b)).toEqual(original.mergeLabelViewsById(a, b));
    expect(current.mergeLabelViewsById(a)[0]).toBe(a[0]);
    expect({ a, b }).toEqual(before);
    for (const rawStatus of ["stocked", " RECEIVED ", "shipped", "returned", ""]) for (const nextStatus of ["stocked", "received", "shipped", "cancelled"]) for (const inventoryId of [undefined, null, 0, 2]) for (const nextId of [undefined, null, 0, 3]) {
      const args = [[label({ rawStatus, inventoryId })], [label({ rawStatus: nextStatus, inventoryId: nextId })]];
      expect(current.mergeLabelViewsById(...args)).toEqual(original.mergeLabelViewsById(...args));
    }
  });
  it("captures group merging with label counts versus numeric totals and nullish metadata", () => {
    const a = group({ invoiceOrderQty: 0, invoiceRemainingQty: 0 });
    const b = group({ label: "ignored", partner: "ignored", rows: [], labels: [label()], invoiceOrderQty: 9, invoiceDeliveredQty: 2, invoiceRemainingQty: 8 });
    const c = group({ key: "other", labels: [], required: -2, purchaseTotal: -10 });
    const d = group({ labels: [label({ labelId: "l1", inventoryId: 3 }), label({ labelId: "B" })] });
    const inputs = [a, c, b, d]; const before = structuredClone(inputs);
    expect(current.mergeAllocationGroupsByKey(inputs)).toMatchSnapshot();
    expect(current.mergeAllocationGroupsByKey(inputs)).toEqual(original.mergeAllocationGroupsByKey(inputs));
    expect(current.mergeAllocationGroupsByKey(inputs)[1]).toBe(c);
    expect(current.mergeAllocationGroupsByKey([a, group({ required: 2 })])).toEqual(original.mergeAllocationGroupsByKey([a, group({ required: 2 })]));
    expect(inputs).toEqual(before);
  });
  it("keeps open-quantity semantics and row fallback references", () => {
    const output = [];
    for (const invoiceOrdered of [undefined, 0, -1, 0.5, 3, NaN, Infinity]) for (const invoiceShipped of [undefined, 0, -1, 3, Infinity]) {
      const p = product({ invoiceOrdered, invoiceShipped });
      expect(current.hasOpenInvoiceQuantity(p)).toBe(original.hasOpenInvoiceQuantity(p));
      output.push(current.hasOpenInvoiceQuantity(p));
    }
    expect(output).toMatchSnapshot();
    const rows = [row()]; const g = group();
    expect(current.getAllRowsFromGroup(null, rows)).toBe(rows);
    expect(current.getAllRowsFromGroup(g, rows)).toBe(g.rows);
  });
  it("captures stat cards and preserves the unused legacy table including its different shortage formula", () => {
    for (const sub of [undefined, "", "補足"]) {
      const props = { label: "想定売上", value: "1,200 €", sub };
      expect(renderToStaticMarkup(current.StatCard(props))).toBe(renderToStaticMarkup(original.StatCard(props)));
    }
    expect(uiSummary(current.StatCard({ label: "想定売上", value: "1,200 €", sub: "補足" }))).toMatchSnapshot();
    for (const products of [[], [product()], [product({ secured: 5, waiting: 3, sellingPrice: null, unitPriceCount: 0 })]]) {
      expect(renderToStaticMarkup(current.ProductFulfillmentTable({ products }))).toBe(renderToStaticMarkup(original.ProductFulfillmentTable({ products })));
    }
    expect(uiSummary(current.ProductFulfillmentTable({ products: [product({ secured: 5, waiting: 3 })] }))).toMatchSnapshot();
  });
  it("captures V2 desktop/mobile markup, stock-only columns, selection classes and empty state", () => {
    const sample = [product({ invoiceOrdered: 5, invoiceShipped: 2 }), product({ key: "zero", secured: 0, waiting: 0, unitPriceCount: 0, sellingPrice: null }), product({ key: "over", secured: 5, waiting: 2 })];
    const filters: Array<ProductDetailFilter | null | undefined> = [undefined, null, { productTitle: "現在庫", mode: "stock" }, { productTitle: "入庫まち", mode: "waiting" }, { productKey: "p", productTitle: "Product", mode: "stock" }, { productKey: "p", productTitle: "Product", mode: "waiting" }];
    for (const products of [[], sample]) for (const stockOnly of [false, true]) for (const selectedFilter of filters) for (const onProductFilter of [undefined, () => {}]) {
      const props = { products, stockOnly, selectedFilter, onProductFilter };
      expect(renderToStaticMarkup(current.ProductFulfillmentTableV2(props))).toBe(renderToStaticMarkup(original.ProductFulfillmentTableV2(props)));
    }
    expect([{}, { stockOnly: true }, { selectedFilter: filters[4] }].map(patch => uiSummary(current.ProductFulfillmentTableV2({ products: sample, onProductFilter: () => {}, ...patch })))).toMatchSnapshot();
    expect(uiSummary(current.ProductFulfillmentTableV2({ products: [] }))).toMatchSnapshot();
  });
  it("preserves click payloads and Enter/Space preventDefault ordering on table headers", () => {
    function actions(rules: Rules) {
      const log: unknown[] = [];
      const node = rules.ProductFulfillmentTableV2({ products: [product()], onProductFilter: f => log.push(f) });
      for (const n of elements(node)) {
        if (n.props.onClick) n.props.onClick();
        if (n.props.onKeyDown) for (const key of ["Enter", " ", "Escape"]) n.props.onKeyDown({ key, preventDefault: () => log.push("prevent:" + key) });
      }
      return log;
    }
    expect(actions(current)).toEqual(actions(original));
    expect(actions(current)).toMatchSnapshot();
    for (const n of elements(current.ProductFulfillmentTableV2({ products: [product()] }))) {
      if (n.props.onClick) expect(() => n.props.onClick()).not.toThrow();
      if (n.props.onKeyDown) n.props.onKeyDown({ key: "Enter", preventDefault: () => { throw new Error("No handler must not prevent"); } });
    }
  });
  it("keeps OrderDashboard state, effect dependencies, JSX and parent callback wiring verbatim", () => {
    function declaration(source: string) {
      const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "OrderDashboard");
      if (!node) throw new Error("Missing dashboard declaration");
      return node.getText(tree);
    }
    const baseline = declaration(readFileSync(new URL("./allocation-baseline-source.txt", import.meta.url), "utf8"));
    const page = declaration(readFileSync(new URL("../PurchaseRegistration.tsx", import.meta.url), "utf8"));
    expect(page).toBe(baseline);
    expect(digest(page)).toMatchSnapshot();
  });
});
