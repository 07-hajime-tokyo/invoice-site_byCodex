import * as ProductQrCode from "./ProductQrCode";
import * as LabelPrintStyles from "./LabelPrintStyles";
import * as PrintableLabelSheet from "./PrintableLabelSheet";
import * as LabelChecklists from "./LabelChecklists";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { loadPrintUiBaseline, PRINT_UI_BASELINE_COMMIT } from "./print-ui-baseline";
import type { LabelView } from "./viewTypes";

type Rules = typeof import("./ProductQrCode") & typeof import("./LabelPrintStyles") & typeof import("./PrintableLabelSheet") & typeof import("./LabelChecklists");
const original = loadPrintUiBaseline<Rules>();
const current: Rules = { ...ProductQrCode, ...LabelPrintStyles, ...PrintableLabelSheet, ...LabelChecklists };
const label = (patch: Partial<LabelView> = {}): LabelView => ({ key: "l1", labelId: "ABCDEFG", rawStatus: "stocked", status: "現在庫", title: "3DS LL ホワイト", printTitle: "3DSLL白", category: "3DS LL", legacyManagementNo: "405_相手_3DSLL", allocationLabel: "No.405", unitPrice: 100, supplier: { name: "Shop", url: "" }, purchaseDate: "2026-09-01", rowId: 1, itemId: 1, ...patch });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
function snap(node: ReactNode) { const html = renderToStaticMarkup(node); return { hash: hash(html), pages: (html.match(/class="label-print-sheet"/g) ?? []).length, blanks: (html.match(/label-print-blank/g) ?? []).length, boxes: (html.match(/label-print-box/g) ?? []).length, text: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() }; }
afterEach(() => vi.unstubAllGlobals());

describe(`print presentation against ${PRINT_UI_BASELINE_COMMIT}`, () => {
  it("keeps QR SVG bytes, aria labels, quiet zone and non-ASCII/capacity behavior", () => {
    const output = [];
    for (const value of ["", "ABCDEFG", "B123456", "BARDNSY", "日本語", "a".repeat(32), "a".repeat(512)]) {
      function result(rules: Rules) { try { return renderToStaticMarkup(createElement(rules.ProductQrCode, { value })); } catch (error) { return `error:${(error as Error).message}`; } }
      const actual = result(current); expect(actual).toBe(result(original));
      output.push({ valueLength: value.length, hash: hash(actual), viewBox: actual.match(/viewBox="([^"]+)"/)?.[1], ariaLabel: actual.match(/aria-label="([^"]+)"/)?.[1] });
    }
    expect(output).toMatchSnapshot();
  });
  it("preserves the complete print CSS including sheet dimensions, breaks and docpack exclusion", () => {
    const actual = renderToStaticMarkup(current.LabelPrintStyles());
    expect(actual).toBe(renderToStaticMarkup(original.LabelPrintStyles()));
    expect(actual).toMatchSnapshot();
  });
  it("keeps start offsets/page boundaries, blank-ID filtering and exact box-label decoration", () => {
    const output = [];
    for (const count of [0, 1, 23, 24, 25, 48]) for (const startPosition of [undefined, 0, 1, 2, 24, 25, -1, 2.9, NaN, Infinity]) {
      const labels = Array.from({ length: count }, (_, i) => label({ key: `l${i}`, labelId: i === 0 ? "B123456" : i === 1 ? "BARDNSY" : `ID${i}` }));
      const before = structuredClone(labels); const props = { labels, startPosition };
      const actual = current.PrintableLabelSheet(props);
      expect(renderToStaticMarkup(actual)).toBe(renderToStaticMarkup(original.PrintableLabelSheet(props)));
      output.push({ count, startPosition: String(startPosition), ...snap(actual) }); expect(labels).toEqual(before);
    }
    expect(output).toMatchSnapshot();
    const labels = [label({ labelId: " " }), label({ key: "b", labelId: "b123456" }), label({ key: "c", labelId: "B1234567" }), label({ key: "d", labelId: " B123456 " }), label({ key: "e", allocationLabel: "", printTitle: "印刷名" })];
    expect(renderToStaticMarkup(current.PrintableLabelSheet({ labels }))).toBe(renderToStaticMarkup(original.PrintableLabelSheet({ labels })));
    expect(snap(current.PrintableLabelSheet({ labels }))).toMatchSnapshot();
    expect(current.PrintableLabelSheet({ labels: [label({ labelId: " " })] })).toBeNull();
  });
  it("keeps on-screen and printable checklist grouping, sorting, titles and input references", () => {
    const labels = [label(), label({ key: "b", labelId: "B", category: "PSP", legacyManagementNo: "009_x", title: "画面用タイトル", printTitle: "別の印刷名" }), label({ key: "c", labelId: "C", category: "PSP", legacyManagementNo: "010_x" }), label({ key: "d", labelId: "", category: "", legacyManagementNo: "" })];
    const before = structuredClone(labels); const output = [];
    for (const items of [[], labels, [...labels].reverse()]) for (const name of ["LabelChecklistView", "PrintableChecklistSheet"] as const) {
      const actual = current[name]({ labels: items });
      expect(renderToStaticMarkup(actual)).toBe(renderToStaticMarkup(original[name]({ labels: items }))); output.push(snap(actual));
    }
    expect(output).toMatchSnapshot(); expect(labels).toEqual(before);
    expect(current.PrintableChecklistSheet({ labels: [] })).toBeNull();
  });
  it("keeps body portal targets, portal children and empty-print short circuits", () => {
    const body = { nodeType: 1 }; vi.stubGlobal("document", { body });
    const outputs = [];
    for (const name of ["PrintableLabelSheet", "PrintableChecklistSheet"] as const) {
      const props = { labels: [label()], startPosition: 24 };
      const actual = current[name](props) as unknown as { containerInfo: unknown; children: ReactNode; key: unknown; $$typeof: unknown };
      const expected = original[name](props) as unknown as typeof actual;
      expect(actual.containerInfo).toBe(body); expect(actual.containerInfo).toBe(expected.containerInfo);
      expect(actual.key).toBe(expected.key); expect(actual.$$typeof).toBe(expected.$$typeof);
      expect(renderToStaticMarkup(actual.children)).toBe(renderToStaticMarkup(expected.children)); outputs.push(snap(actual.children));
      expect(current[name]({ labels: [] })).toBeNull();
    }
    expect(outputs).toMatchSnapshot();
  });
  it("keeps print-panel selection, persistence, callbacks and print effects verbatim", () => {
    function declaration(source: string) { const tree = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); const node = tree.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "LabelPrintPanel"); if (!node) throw Error("Missing print panel"); return node.getText(tree); }
    const actual = declaration(readFileSync(new URL("../PurchaseRegistration.tsx", import.meta.url), "utf8"));
    expect(actual).toBe(declaration(readFileSync(new URL("./print-ui-baseline-source.txt", import.meta.url), "utf8")));
    expect(hash(actual)).toMatchSnapshot();
  });
});
