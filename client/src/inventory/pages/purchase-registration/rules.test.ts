import { describe, expect, it } from "vitest";
import type { PurchaseItem, PurchaseRow } from "./dataTypes";
import * as rowFilters from "./rowFilters";
import { isInboundCutoffVisible, isPurchaseInboundComplete } from "@shared/purchaseVisibility";
import * as purchaseItems from "./purchaseItems";
import * as rowStatus from "./rowStatus";
import * as rowOrder from "./rowOrder";
import * as format from "./format";
import * as tracking from "./tracking";
import { loadLegacyBaseline, BASELINE_COMMIT } from "./legacy-baseline";

const original = loadLegacyBaseline<typeof current>();
const current = {
  ...format, ...tracking, ...purchaseItems, ...rowStatus, ...rowOrder, ...rowFilters,
  isPurchaseRegistrationCutoffVisible: isInboundCutoffVisible,
  isPurchaseRegistrationRowComplete: isPurchaseInboundComplete,
};

function item(patch: Partial<PurchaseItem> = {}): PurchaseItem {
  return { id: 10, title: "架空商品", quantity: "2", currentInventoryQuantity: "1", ...patch };
}
function row(patch: Partial<PurchaseRow> = {}): PurchaseRow {
  return { id: 1, status: "ordered", purchase_date: "2026-09-01", purchase_items: [item()], ...patch };
}
const states = [undefined, null, "", "ordered", "received", "stocked", "shipped", " SHIPPED ", "returned", "cancelled"];
const kinds = [undefined, null, "ordered", "shipped", "purchased"];
const tracks = [undefined, null, "", "   ", " - ", " 123-456 "];
const dateRows = [
  {}, { purchase_date: "2026-06-19" }, { purchase_date: "2026-06-20" }, { purchase_date: " 2026-06-21T00:00:00 " },
  { purchaseDate: "2026-06-19", purchase_date: "2026-06-21" },
  { purchaseDate: "bad", purchase_date: "2026-06-20" },
  { purchaseDate: new Date("2026-06-20T00:00:00+09:00"), purchase_date: "2026-06-20" },
  { purchaseDate: new Date("invalid"), purchase_date: undefined, createdAt: new Date("2026-06-20T00:00:00Z") },
  { purchase_date: undefined, created_at: "2026-06-19", createdAt: "2026-06-21" },
  { createdAt: "invalid", created_at: "2026-09-30" },
  { createdAt: "", created_at: "2026-09-30" },
  { purchase_date: undefined, created_at: undefined, createdAt: null },
  { purchase_date: "2026-99-99" },
];
function rowResult(api: typeof current, input: ReturnType<typeof row>) {
  const visible = api.withVisiblePurchaseItems(input);
  return {
    kind: api.purchaseRowStatusKind(input), label: api.statusLabel(input), className: api.statusClass(input),
    filters: (["all", "ordered", "received", "missing_tracking"] as const).map((filter) => api.matchesStatus(input, filter)),
    counts: api.countPurchaseRows([input]), items: api.visiblePurchaseItems(input),
    visible, sameRow: visible === input, sameItems: visible?.purchase_items === input.purchase_items,
    normalized: api.normalizePurchaseRegistrationRows([input]), order: api.purchaseRegistrationOrderValue(input),
    cutoff: api.isPurchaseRegistrationCutoffVisible(input), complete: api.isPurchaseRegistrationRowComplete(input),
  };
}

describe(`registration rules against actual source at ${BASELINE_COMMIT}`, () => {
  it("preserves original formatting outputs including empty, invalid, nonfinite and zero values", () => {
    const values = [undefined, null, "", " ", 0, -12.5, "1000.25", "1,000", "bad", NaN, Infinity, -Infinity];
    const output = values.map((value) => ({
      number: current.toNumber(value), yen: current.formatCurrency(value), euro: current.formatEuro(value),
      prices: [undefined, null, "", "EUR", "ユーロ", "usd", "米ドル", "JPY", " eur "].map((currency) => current.formatTradePrice(value, currency)),
    }));
    expect(output).toMatchSnapshot();
    expect([undefined, null, "", " 2026-09-30", "bad", "2026-09-30T12:00:00"].map((value) => current.formatDate(value))).toMatchSnapshot();
    expect([undefined, null, "", "eur", "ユーロ", "USD", "米ドル", " JPY "].map((value) => current.normalizeCurrencyLabel(value))).toMatchSnapshot();
  });
  it("preserves original carrier metadata and option labels", () => {
    const output = ["", "   ", " - ", " 9123-4567 8901 ", "TBA123456", "AB123456789JP", "abc"].map((number) =>
      [undefined, null, "auto", " AUTO ", " Yamato ", "ヤマト運輸", "佐川急便", "郵便", "西濃運輸", "福山通運", "エコ配", "amazon", "unknown", "invalid"]
        .map((carrier) => current.getPurchaseTrackingMeta(number, carrier)));
    expect(output).toMatchSnapshot();
    expect(current.TRACKING_CARRIER_OPTIONS).toMatchSnapshot();
    expect(Array.from(current.TRACKING_CARRIER_KEYS)).toEqual(Array.from(original.TRACKING_CARRIER_KEYS));
  });
  it("preserves cutoff fallback, UTC conversion, null stages and sorting outputs", () => {
    const rows = dateRows.map((patch, index) => row({ ...patch, id: index + 1 }));
    expect(rows.map((input) => rowResult(current, input))).toMatchSnapshot();
    expect([...rows, row({ id: 99 }), row({ id: 100 })].sort(current.comparePurchaseRegistrationOrder).map((input) => input.id)).toMatchSnapshot();
    for (const inboundClass of [undefined, null, "ebay", "oregon", "direct", "domestic"] as const) {
      for (const stage of [undefined, null, "", "received", "shipped", "stocked", "registered", "labeled", "packed", "warehouse_shipped", "handed_over", "listed", " handed_over ", "unknown"]) {
        const input = row({ inboundClass, stage });
        expect(current.normalizePurchaseRegistrationRows([input])).toEqual(original.normalizePurchaseRegistrationRows([input]));
      }
    }
  });
  it("preserves 1500 status/label/tracking combinations and input/reference behavior", () => {
    let comparisons = 0;
    for (const status of kinds) for (const firstStatus of states) for (const secondStatus of [undefined, "received", "stocked", "shipped", "returned"]) for (const trackingNumber of tracks) {
      const input = row({ status, extra: { trackingNumber }, purchase_items: [
        item({ itemLabels: [{ labelId: "LABEL-A", status: firstStatus }, { labelId: "", status: "shipped" }] }),
        item({ id: 11, quantity: "3.5", currentInventoryQuantity: "0", itemLabels: [{ labelId: "LABEL-B", status: secondStatus }] }),
      ] });
      const before = structuredClone(input);
      expect(rowResult(current, input)).toEqual(rowResult(original, input));
      expect(input).toEqual(before);
      comparisons++;
    }
    expect(comparisons).toBe(1500);
  });
  it("preserves aggregate counts, row identity and normalized ordering", () => {
    const inputs = [
      row({ id: 1, status: "ordered", extra: { trackingNumber: " " } }),
      row({ id: 2, status: "shipped", extra: { trackingNumber: "912345678901" } }),
      row({ id: 3, purchase_items: [item({ status: "purchased", currentInventoryQuantity: "0" }), item({ id: 11 })] }),
      row({ id: 4, purchase_items: [item({ itemLabels: [{ labelId: "A", status: "shipped" }] })] }),
      row({ id: 5, status: "purchased" }), row({ id: 6, purchase_date: "2026-06-19" }),
      row({ id: 7, inboundClass: "ebay", stage: "packed" }), row({ id: 8, purchase_items: [] }),
    ];
    const before = structuredClone(inputs);
    expect(current.countPurchaseRows(inputs)).toEqual(original.countPurchaseRows(inputs));
    const actual = current.normalizePurchaseRegistrationRows(inputs);
    const expected = original.normalizePurchaseRegistrationRows(inputs);
    expect(actual).toEqual(expected);
    expect(actual.map((value: unknown) => inputs.findIndex((input) => input === value))).toEqual(
      expected.map((value: unknown) => inputs.findIndex((input) => input === value)),
    );
    expect(actual.sort(current.comparePurchaseRegistrationOrder)).toEqual(expected.sort(original.comparePurchaseRegistrationOrder));
    expect(inputs).toEqual(before);
  });
  it("preserves partial pruning, empty rows, nonfinite stock and stable references", () => {
    for (const status of kinds) for (const quantity of [undefined, null, "", "0", "-1", "0.5", "invalid", Infinity]) {
      for (const items of [[], [item({ status: "purchased", currentInventoryQuantity: quantity })], [item({ status: "purchased", currentInventoryQuantity: quantity }), item({ id: 11 })]]) {
        const input = row({ status, purchase_items: items });
        const before = structuredClone(input);
        expect(rowResult(current, input)).toEqual(rowResult(original, input));
        expect(input).toEqual(before);
      }
    }
  });
});
