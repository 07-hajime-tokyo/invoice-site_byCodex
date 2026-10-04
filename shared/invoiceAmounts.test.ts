import { describe, expect, it } from "vitest";
import { calculateInvoiceTotals } from "./invoiceAmounts";

describe("invoice amounts shared by preview and PDF", () => {
  it("preserves zero totals for empty invoices", () => {
    expect(calculateInvoiceTotals([])).toEqual({subtotal:0,taxTotal:0,total:0});
  });
  it("sums line taxes and credits without rounding the underlying values", () => {
    const items = Object.freeze([
      Object.freeze({quantity:2,unitPrice:1234.567,tax:10}),
      Object.freeze({quantity:1,unitPrice:-3.25,tax:0}),
    ]);
    const actual = calculateInvoiceTotals(items);
    expect(actual.subtotal).toBe(2465.884);
    expect(actual.taxTotal).toBe(246.91340000000002);
    expect(actual.total).toBe(2712.7974);
  });
  it("treats missing and null tax rates as zero", () => {
    expect(calculateInvoiceTotals([{quantity:1,unitPrice:10}, {quantity:2,unitPrice:20,tax:null}]))
      .toEqual({subtotal:50,taxTotal:0,total:50});
  });
  it("preserves fractional quantities and negative tax rates", () => {
    expect(calculateInvoiceTotals([{quantity:0.5,unitPrice:100,tax:-10}]))
      .toEqual({subtotal:50,taxTotal:-5,total:45});
  });
  it("preserves the original non-finite arithmetic instead of silently sanitizing it", () => {
    const actual = calculateInvoiceTotals([{quantity:1,unitPrice:Infinity}]);
    expect(actual.subtotal).toBe(Infinity);
    expect(actual.taxTotal).toBeNaN();
    expect(actual.total).toBeNaN();
  });
});
