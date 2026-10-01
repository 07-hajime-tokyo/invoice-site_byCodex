import * as trackingNavigation from "./trackingNavigation";
import * as purchaseRowIdentity from "./purchaseRowIdentity";
import * as PurchaseRegistrationCard from "./PurchaseRegistrationCard";
import * as StockDetailCard from "./StockDetailCard";
import * as EmptyState from "./EmptyState";
import * as OrderDashboard from "./OrderDashboard";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createHash } from "node:crypto";
import { loadDashboardBaseline, DASHBOARD_BASELINE_COMMIT } from "./dashboard-baseline";
import { EBAY_GROUP_KEY, OTHER_INVOICE_KEY } from "./invoiceIdentity";
import type { PurchaseItem, PurchaseRow } from "./dataTypes";
import type { StockItemView, AllocationGroup, ProductDetailFilter } from "./viewTypes";

// A local hook harness compares state/effect transitions; browser integration is verified by the parent.
const hooks = vi.hoisted(() => ({ active: false, state: false, initialized: false, deps: undefined as unknown[] | undefined, effects: [] as Array<() => void>, log: [] as unknown[] }));
vi.mock("react", async load => {
  const actual = await load<typeof import("react")>();
  return { ...actual,
    useState(initial: boolean) {
      if (!hooks.active) return actual.useState(initial);
      if (!hooks.initialized) { hooks.state = initial; hooks.initialized = true; }
      return [hooks.state, (value: boolean | ((previous: boolean) => boolean)) => { hooks.state = typeof value === "function" ? value(hooks.state) : value; hooks.log.push(["state", hooks.state]); }];
    },
    useEffect(effect: () => void, deps?: unknown[]) {
      if (!hooks.active) return actual.useEffect(effect, deps);
      if (!hooks.deps || !deps || deps.some((value, index) => !Object.is(value, hooks.deps![index]))) {
        hooks.effects.push(effect); hooks.log.push(["effect", deps]); hooks.deps = deps;
      }
    },
  };
});

// BoxItemInvoiceField depends on trpc hooks; a deterministic stub keeps both baseline and current renders comparable.
vi.mock("./OutboundBoxes", async load => {
  const actual = await load<typeof import("./OutboundBoxes")>();
  const react = await vi.importActual<typeof import("react")>("react");
  return { ...actual, BoxItemInvoiceField: (props: { labelId: string; assignedInvoiceNo: string | null; legacyManagementNo: string | null }) => react.createElement("span", { "data-box-item-invoice": JSON.stringify([props.labelId, props.assignedInvoiceNo ?? null, props.legacyManagementNo ?? null]) }) };
});

type Rules = typeof import("./trackingNavigation") & typeof import("./purchaseRowIdentity") & typeof import("./PurchaseRegistrationCard") & typeof import("./StockDetailCard") & typeof import("./EmptyState") & typeof import("./OrderDashboard");
const original = loadDashboardBaseline<Rules>();
const current: Rules = { ...trackingNavigation, ...purchaseRowIdentity, ...PurchaseRegistrationCard, ...StockDetailCard, ...EmptyState, ...OrderDashboard };
const item = (patch: Partial<PurchaseItem> = {}): PurchaseItem => ({ id: 1, inventory_id: 8, title: "3DS LL", quantity: "3", currentInventoryQuantity: "1", unit_price: 100, etc: "405_相手_3DSLL", ...patch });
const row = (patch: Partial<PurchaseRow> = {}): PurchaseRow => ({ id: 1, num: "P-01", status: "ordered", purchase_date: "2026-09-01", purchase_items: [item()], ...patch });
const stock = (patch: Partial<StockItemView> = {}): StockItemView => ({ key: "s1", inventoryId: 8, labelId: "L1", status: "stocked", title: "3DS LL", category: "ゲーム", legacyManagementNo: "405_相手_3DSLL", allocationLabel: "405", unitPrice: 100, quantity: 3, supplier: { name: "仕入先", url: "https://example.test" }, purchaseDate: "2026-09-01", ...patch });
const group = (patch: Partial<AllocationGroup> = {}): AllocationGroup => ({ key: "invoice-405", label: "No.405 相手", partner: "相手", rows: [row()], products: [], labels: [], required: 0, secured: 0, waiting: 0, purchaseTotal: 300, ...patch });
const noop = () => {};
const callbacks = { invoiceOptions: [] as AllocationGroup[], onPrintLabels: noop, onOpenEdit: noop, onOpenTrackingDialog: noop, onOpenShippingHistory: noop, onDeleteRow: noop };
type Element = ReactElement<Record<string, any>>;
function elements(node: ReactNode): Element[] { if (Array.isArray(node)) return node.flatMap(elements); if (!isValidElement<Record<string, any>>(node)) return []; return [node, ...elements(node.props.children)]; }
function text(node: ReactNode): string { if (Array.isArray(node)) return node.map(text).join(""); if (isValidElement<Record<string, any>>(node)) return text(node.props.children); return typeof node === "string" || typeof node === "number" ? String(node) : ""; }
function snapshot(node: ReactNode) { const html = renderToStaticMarkup(node); return { hash: createHash("sha256").update(html).digest("hex"), text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(), controls: elements(node).filter(n => n.props.onClick || n.props.onCheckedChange).map(n => ({ text: text(n), className: n.props.className, disabled: n.props.disabled, checked: n.props.checked, ariaLabel: n.props["aria-label"] })) }; }
function resetHooks() { hooks.active = false; hooks.state = false; hooks.initialized = false; hooks.deps = undefined; hooks.effects = []; hooks.log = []; }
function renderDashboard(rules: Rules, props: Parameters<Rules["OrderDashboard"]>[0]) { hooks.active = true; let node: ReactNode; try { node = rules.OrderDashboard(props); } finally { hooks.active = false; } const effects = hooks.effects.splice(0); effects.forEach(effect => effect()); return node; }
afterEach(() => { vi.unstubAllGlobals(); resetHooks(); });

describe(`registration cards/dashboard against ${DASHBOARD_BASELINE_COMMIT}`, () => {
  it("captures purchase cards, item/label caps, tracking variants and disabled actions", () => {
    const rows = [row(), row({ purchase_items: [] }), row({ status: "purchased", csvSupplierName: "Shop", csvSupplierUrl: "example.test", purchase_items: Array.from({ length: 6 }, (_, i) => item({ id: i, title: `商品${i}`, itemLabels: Array.from({ length: 2 }, (_, j) => ({ labelId: `L${i}-${j}`, status: i % 2 ? "shipped" : "stocked" })) })) }), row({ extra: { trackingNumber: "1234-5678-9012", carrier: "yamato" } }), row({ extra: { trackingNumber: "ECO-123", carrier: "ecohai" } }), row({ purchase_items: [item({ inventory_id: null, quantity: "0" })] })];
    const output = [];
    for (const input of rows) for (const isDeleting of [false, true]) {
      const props = { ...callbacks, row: input, isDeleting };
      const before = structuredClone(input);
      const node = current.PurchaseRegistrationCard(props);
      expect(renderToStaticMarkup(node)).toBe(renderToStaticMarkup(original.PurchaseRegistrationCard(props)));
      output.push(snapshot(node)); expect(input).toEqual(before);
    }
    expect(output).toMatchSnapshot();
    const props = { ...callbacks, row: row(), isSelected: true, onSelectChange: noop };
    expect(snapshot(current.PurchaseRegistrationCard(props))).toMatchSnapshot();
    expect(renderToStaticMarkup(current.PurchaseRegistrationCard(props))).toBe(renderToStaticMarkup(original.PurchaseRegistrationCard(props)));
  });
  it("preserves card event payload identities, selection coercion and disabled props", () => {
    const input = row();
    function events(rules: Rules) {
      const log: unknown[] = [];
      const props = { row: input, invoiceOptions: [] as AllocationGroup[], isSelected: true, onPrintLabels: (labels: unknown) => log.push(["print", labels]), onOpenEdit: (r: PurchaseRow) => log.push(["edit", r === input]), onOpenTrackingDialog: (r: PurchaseRow) => log.push(["tracking", r === input]), onOpenShippingHistory: (r: PurchaseRow) => log.push(["history", r === input]), onDeleteRow: (r: PurchaseRow) => log.push(["delete", r === input]), onSelectChange: (r: PurchaseRow, checked: boolean) => log.push(["select", r === input, checked]) };
      for (const n of elements(rules.PurchaseRegistrationCard(props))) {
        if (n.props.onClick && !n.props.disabled) n.props.onClick();
        if (n.props.onCheckedChange) for (const value of [true, false, "indeterminate"]) n.props.onCheckedChange(value);
      }
      return log;
    }
    expect(events(current)).toEqual(events(original)); expect(events(current)).toMatchSnapshot();
    const invalid = row({ purchase_items: [item({ inventory_id: 0, quantity: "0" })] });
    for (const deleting of [false, true]) {
      const props = { ...callbacks, row: invalid, isDeleting: deleting };
      expect(elements(current.PurchaseRegistrationCard(props)).filter(n => n.props.disabled).map(n => text(n))).toEqual(elements(original.PurchaseRegistrationCard(props)).filter(n => n.props.disabled).map(n => text(n)));
    }
  });
  it("preserves inventory-ID label precedence, finite positive conversion and item fallback", () => {
    const outputs = [];
    for (const localInventoryId of [undefined, null, -1, 0, 0.5, 2, NaN, Infinity]) for (const inventory_id of [undefined, null, -1, 0, 3, NaN, Infinity]) {
      const input = row({ purchase_items: [item({ inventory_id, itemLabels: [{ labelId: "A", localInventoryId }] }), item({ id: 2, inventory_id: 9 })] });
      expect(current.purchaseRowInventoryId(input)).toBe(original.purchaseRowInventoryId(input)); outputs.push(current.purchaseRowInventoryId(input));
    }
    expect(outputs).toMatchSnapshot(); expect(current.purchaseRowInventoryId(row({ purchase_items: [] }))).toBeNull();
  });
  it("captures stock cards/empty states and preserves inventory edit IDs", () => {
    const outputs = [];
    for (const input of [stock(), stock({ labelId: null, quantity: 1, title: "", legacyManagementNo: "", allocationLabel: "", purchaseDate: "", unitPrice: 0, supplier: { name: "", url: "" } }), stock({ quantity: 0.5, unitPrice: -10 })]) {
      const ids: number[] = []; const props = { item: input, onOpenEdit: (id: number) => ids.push(id) };
      const node = current.StockDetailCard(props);
      expect(renderToStaticMarkup(node)).toBe(renderToStaticMarkup(original.StockDetailCard(props))); outputs.push(snapshot(node));
      elements(node).find(n => n.props.onClick)!.props.onClick(); expect(ids).toEqual([input.inventoryId]);
    }
    expect(outputs).toMatchSnapshot();
    const Icon = (() => createElement("svg")) as unknown as Parameters<Rules["EmptyState"]>[0]["icon"];
    for (const description of [undefined, "", "説明"]) {
      const props = { icon: Icon, title: "表示なし", description };
      expect(renderToStaticMarkup(current.EmptyState(props))).toBe(renderToStaticMarkup(original.EmptyState(props)));
    }
    expect(snapshot(current.EmptyState({ icon: Icon, title: "表示なし", description: "説明" }))).toMatchSnapshot();
  });
  it("preserves Ecohai form construction, normalized payload and append/submit/remove order", () => {
    function actions(rules: Rules, fail = false) {
      const log: unknown[] = [];
      vi.stubGlobal("document", { createElement(tag: string) { log.push(["create", tag]); return { appendChild(child: unknown) { log.push(["appendInput", child]); }, submit() { log.push("submit"); if (fail) throw Error("submit failed"); } }; }, body: { appendChild(form: Record<string, unknown>) { log.push(["appendForm", form.method, form.action, form.target]); }, removeChild() { log.push("removeForm"); } } });
      try { rules.openEcohaiTracking(" １２３-４５６  "); } catch (error) { log.push((error as Error).message); }
      return JSON.stringify(log);
    }
    expect(actions(current)).toBe(actions(original)); expect(actions(current)).toMatchSnapshot();
    expect(actions(current, true)).toBe(actions(original, true)); expect(actions(current, true)).toMatchSnapshot();
    vi.stubGlobal("document", undefined); expect(() => current.openEcohaiTracking("123")).not.toThrow();
  });
  it("captures dashboard empty/stock/ebay/detail states and exact child callback forwarding", () => {
    const base = { ...callbacks, group: null, rows: [row()], onOpenStockEdit: noop, onProductFilter: noop, onClearProductFilter: noop };
    const cases: Array<Parameters<Rules["OrderDashboard"]>[0]> = [base, { ...base, rows: [] }, { ...base, group: group({ key: OTHER_INVOICE_KEY }), stockDetailItems: [stock()] }, { ...base, group: group({ key: EBAY_GROUP_KEY }) }, { ...base, detailRows: [], productFilter: { mode: "stock", productTitle: "現在庫" } }, { ...base, rows: [row({ purchase_items: [item({ itemLabels: [{ labelId: "A", status: "shipped" }] })] })] }];
    const output = [];
    for (const props of cases) {
      resetHooks(); const expected = renderDashboard(original, props); const oldHtml = renderToStaticMarkup(expected);
      resetHooks(); const node = renderDashboard(current, props); expect(renderToStaticMarkup(node)).toBe(oldHtml); output.push(snapshot(node));
      for (const n of elements(node)) {
        if (n.props.onOpenEdit && n.props.row) { expect(n.props.onOpenEdit).toBe(props.onOpenEdit); expect(n.props.onPrintLabels).toBe(props.onPrintLabels); expect(n.props.onDeleteRow).toBe(props.onDeleteRow); expect(n.props.onOpenTrackingDialog).toBe(props.onOpenTrackingDialog); expect(n.props.onOpenShippingHistory).toBe(props.onOpenShippingHistory); }
        if (n.props.item && n.props.onOpenEdit) expect(n.props.onOpenEdit).toBe(props.onOpenStockEdit);
      }
    }
    expect(output).toMatchSnapshot();
  });
  it("preserves shipped-row toggles and resets only when group/filter dependency values change", () => {
    function flow(rules: Rules) {
      resetHooks();
      let props: Parameters<Rules["OrderDashboard"]>[0] = { ...callbacks, group: null, onOpenStockEdit: noop, rows: [row(), row({ id: 2, purchase_items: [item({ itemLabels: [{ labelId: "A", status: "shipped" }] })] })] };
      const output: unknown[] = [];
      const record = () => { const node = renderDashboard(rules, props); output.push({ state: hooks.state, cards: elements(node).filter(n => n.props.row).map(n => n.props.row.id), controls: elements(node).filter(n => n.props.onClick).map(n => text(n)) }); return node; };
      let node = record();
      const toggle = () => { elements(node).find(n => n.props.onClick && text(n).includes("出庫済みを"))!.props.onClick(); node = record(); };
      toggle(); toggle(); toggle();
      props = { ...props, rows: [...props.rows] }; node = record(); // same dependency values retain state
      for (const filter of [{ mode: "stock", productTitle: "現在庫" }, { mode: "stock", productTitle: "別名" }, { mode: "stock", productTitle: "別名", productKey: "p" }, { mode: "waiting", productTitle: "別名", productKey: "p" }] as ProductDetailFilter[]) {
        props = { ...props, productFilter: filter }; node = record(); node = record(); toggle();
      }
      props = { ...props, group: group({ rows: props.rows }) }; node = record(); node = record();
      return { output, log: hooks.log };
    }
    expect(flow(current)).toEqual(flow(original)); expect(flow(current)).toMatchSnapshot();
  });
});
