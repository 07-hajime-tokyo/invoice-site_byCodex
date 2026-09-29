import * as StockProposalProducts from "./StockProposalProducts";
import * as StockProposalGroupCard from "./StockProposalGroupCard";
import * as StockProposalPanel from "./StockProposalPanel";
import * as StockPanel from "./StockPanel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { loadStockUiBaseline, STOCK_UI_BASELINE_COMMIT } from "./stock-ui-baseline";
import type { InventoryItem, PurchaseRow } from "./dataTypes";
import type { StockProposalProduct, StockProposalGroup } from "./viewTypes";

const hooks = vi.hoisted(() => ({ active: false, cursor: 0, slots: [] as any[], log: [] as unknown[] }));
vi.mock("react", async load => {
  const actual = await load<typeof import("react")>();
  return { ...actual, useState(initial: any) {
    if (!hooks.active) return actual.useState(initial);
    const index = hooks.cursor++;
    if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.slots[index], (value: any) => { const previous = hooks.slots[index]; hooks.slots[index] = typeof value === "function" ? value(previous) : value; hooks.log.push({ slot: index, value: hooks.slots[index] instanceof Set ? [...hooks.slots[index]] : hooks.slots[index], previous: previous instanceof Set ? [...previous] : previous, sameReference: previous === hooks.slots[index] }); }];
  } };
});

type Rules = typeof import("./StockProposalProducts") & typeof import("./StockProposalGroupCard") & typeof import("./StockProposalPanel") & typeof import("./StockPanel");
const original = loadStockUiBaseline<Rules>();
const current: Rules = { ...StockProposalProducts, ...StockProposalGroupCard, ...StockProposalPanel, ...StockPanel };
const product = (patch: Partial<StockProposalProduct> = {}): StockProposalProduct => ({ key: "p", title: "3DS LL ホワイト", model: "3DS LL", stockQuantity: 2, waitingQuantity: 1, totalQuantity: 3, unitPriceTotal: 400, unitPriceQuantity: 2, minUnitPrice: 100, maxUnitPrice: 300, details: [], searchText: "", ...patch });
const group = (patch: Partial<StockProposalGroup> = {}): StockProposalGroup => ({ model: "3DS LL", stockQuantity: 2, waitingQuantity: 1, totalQuantity: 3, unitPriceTotal: 400, unitPriceQuantity: 2, products: [product()], ...patch });
const inventory = (patch: Partial<InventoryItem> = {}): InventoryItem => ({ id: 1, title: "3DS LL ホワイト", quantity: "2", unit_price: 100, etc: "在庫001_3DSLL", supplierName: "Shop", supplierUrl: "https://example.test", last_purchase_date: "2026-09-01", ...patch });
const waiting: PurchaseRow = { id: 20, status: "ordered", purchase_items: [{ id: 20, inventory_id: 20, title: "3DS LL ブラック", quantity: "3", currentInventoryQuantity: 0, unit_price: 200, etc: "在庫002_3DSLL" }] };
const noop = () => {};
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement<Record<string, any>>(node)) return []; return [node, ...elements(node.props.children)]; }
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join(""); if (isValidElement<Record<string, any>>(node)) return text(node.props.children); return typeof node === "string" || typeof node === "number" ? String(node) : ""; }
function snap(node: ReactNode) { const html = renderToStaticMarkup(node); return { hash: createHash("sha256").update(html).digest("hex"), text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), controls: elements(node).filter(n => n.props.onClick || n.props.onChange || n.props.onOpenChange).map(n => ({ text: text(n), className: n.props.className, value: n.props.value, open: n.props.open, variant: n.props.variant })) }; }
function reset() { hooks.active = false; hooks.cursor = 0; hooks.slots = []; hooks.log = []; }
function render<P>(component: (props: P) => ReactNode, props: P) { hooks.active = true; hooks.cursor = 0; try { return component(props); } finally { hooks.active = false; } }
afterEach(reset);

describe(`stock UI against ${STOCK_UI_BASELINE_COMMIT}`, () => {
  it("captures desktop/mobile proposal quantities, price ranges and management truncation", () => {
    const details = Array.from({ length: 6 }, (_, i) => ({ source: "stock" as const, managementNo: `在庫${i}`, quantity: 1, unitPrice: 100, status: "stocked", supplier: { name: "", url: "" }, date: "" }));
    const cases = [product(), product({ stockQuantity: 0, waitingQuantity: 0, totalQuantity: 0, unitPriceQuantity: 0 }), product({ stockQuantity: -1, waitingQuantity: 0.5, totalQuantity: -0.5, minUnitPrice: 200, maxUnitPrice: 200, details }), product({ details: [...details, details[0]], unitPriceTotal: -1 })];
    const output = [];
    for (const p of cases) for (const name of ["StockProposalProductRow", "StockProposalProductMobile"] as const) {
      const before = structuredClone(p); const node = current[name]({ product: p });
      expect(renderToStaticMarkup(node)).toBe(renderToStaticMarkup(original[name]({ product: p })));
      output.push(snap(node)); expect(p).toEqual(before);
    }
    expect(output).toMatchSnapshot();
  });
  it("captures collapsed/expanded model cards and keeps controlled open state across props updates", () => {
    for (const defaultOpen of [false, true]) {
      reset(); const expected = snap(render(original.StockProposalGroupCard, { group: group(), defaultOpen }));
      reset(); expect(snap(render(current.StockProposalGroupCard, { group: group(), defaultOpen }))).toEqual(expected);
    }
    function flow(rules: Rules) {
      reset(); let props = { group: group(), defaultOpen: false }; const output = [];
      let node = render(rules.StockProposalGroupCard, props); output.push(snap(node));
      const open = () => elements(node).find(n => n.props.onOpenChange)!;
      open().props.onOpenChange(true); node = render(rules.StockProposalGroupCard, props); output.push(snap(node));
      props = { group: group({ totalQuantity: 9 }), defaultOpen: false }; node = render(rules.StockProposalGroupCard, props); output.push(snap(node));
      open().props.onOpenChange(false); props = { ...props, defaultOpen: true }; node = render(rules.StockProposalGroupCard, props); output.push(snap(node));
      return { output, log: hooks.log };
    }
    expect(flow(current)).toEqual(flow(original)); expect(flow(current)).toMatchSnapshot();
  });
  it("keeps average model selection and fallback without resetting the remembered selection", () => {
    function flow(rules: Rules) {
      reset(); const a = group(); const b = group({ model: "PSP", products: [product({ key: "psp" })], unitPriceTotal: 900, unitPriceQuantity: 3, waitingQuantity: 0 });
      let groups = [a, b]; const output = [];
      let node = render(rules.StockProposalPanel, { groups }); output.push(snap(node));
      elements(node).find(n => n.props.onChange)!.props.onChange({ target: { value: "PSP" } });
      node = render(rules.StockProposalPanel, { groups }); output.push(snap(node));
      groups = [a]; node = render(rules.StockProposalPanel, { groups }); output.push(snap(node));
      groups = [b, a]; node = render(rules.StockProposalPanel, { groups }); output.push(snap(node));
      groups = []; node = render(rules.StockProposalPanel, { groups }); output.push(snap(node));
      return { output, log: hooks.log };
    }
    expect(flow(current)).toEqual(flow(original)); expect(flow(current)).toMatchSnapshot();
  });
  it("captures list/proposal, empty/search, labels and unfinished-invoice inputs", () => {
    const inventories = [inventory(), inventory({ id: 2, title: "PSP3000", quantity: "3.9", etc: "405_相手_PSP3000", itemLabels: [{ labelId: "P1", status: "stocked" }, { labelId: "P2", status: "shipped" }] })];
    const output = [];
    for (const viewMode of ["list", "proposal"] as const) for (const searchText of ["", "psp", "nomatch"]) for (const unfinishedInvoices of [undefined, [], [{ invoiceNo: "405", partner: "相手", totalOrderQty: 3, totalDeliveredQty: 0, remainingQty: 3 }]]) {
      const props = { inventories, purchaseRows: [waiting], viewMode, searchText, unfinishedInvoices, onOpenEdit: noop }; const before = structuredClone(props.inventories);
      reset(); const expected = renderToStaticMarkup(render(original.StockPanel, props)); reset(); const node = render(current.StockPanel, props);
      expect(renderToStaticMarkup(node)).toBe(expected); output.push(snap(node)); expect(inventories).toEqual(before);
    }
    reset(); output.push(snap(render(current.StockPanel, { inventories: [], purchaseRows: [], viewMode: "list", searchText: "", onOpenEdit: noop })));
    expect(output).toMatchSnapshot();
  });
  it("preserves shelf Set state, waiting toggles, edit IDs and search/mode round trips", () => {
    function flow(rules: Rules) {
      reset(); const edits: number[] = [];
      let props: Parameters<Rules["StockPanel"]>[0] = { inventories: [inventory(), inventory({ id: 2, title: "PSP3000", etc: "在庫003_PSP3000" })], purchaseRows: [waiting], viewMode: "list", searchText: "", onOpenEdit: id => edits.push(id) };
      const output = []; let node = render(rules.StockPanel, props); output.push(snap(node));
      const renderAgain = () => { node = render(rules.StockPanel, props); output.push(snap(node)); };
      const shelfButtons = () => elements(node).filter(n => n.props.onClick && text(n).startsWith("棚 "));
      for (const button of shelfButtons()) button.props.onClick(); renderAgain();
      elements(node).filter(n => n.props.onClick && text(n) === "編集").forEach(n => n.props.onClick());
      elements(node).find(n => n.props.onClick && text(n).includes("入庫待ち0在庫"))!.props.onClick(); renderAgain();
      elements(node).filter(n => n.props.onClick && text(n) === "編集").forEach(n => n.props.onClick());
      props = { ...props, searchText: "nomatch" }; renderAgain(); props = { ...props, searchText: "" }; renderAgain();
      props = { ...props, viewMode: "proposal" }; renderAgain(); props = { ...props, viewMode: "list" }; renderAgain();
      shelfButtons()[0].props.onClick(); renderAgain(); shelfButtons()[0].props.onClick(); renderAgain();
      elements(node).find(n => n.props.onClick && text(n).includes("入庫待ち0在庫"))!.props.onClick(); renderAgain();
      return { output, edits, log: hooks.log, slots: hooks.slots.map(s => s instanceof Set ? [...s] : s) };
    }
    const result = flow(current); expect(result).toEqual(flow(original)); expect(result).toMatchSnapshot();
    expect(result.edits).toContain(1); expect(result.edits).toContain(20);
    const setUpdates = result.log.filter((entry: any) => entry.slot === 1) as Array<{ sameReference: boolean }>;
    expect(setUpdates.every(entry => !entry.sameReference)).toBe(true);
  });
});
