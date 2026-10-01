import { describe, it, expect } from "vitest";
import {
  emptyStocktakeState,
  stocktakeCode,
  stocktakeScanResult,
  summarizeStocktake,
  type StocktakeSnapshot,
} from "./stocktake";

import { fixture } from "./stocktake.fixture";
describe("physical stocktake", () => {
  it("normalizes scanner text and refuses tracking numbers / URLs", () => {
    expect(stocktakeCode(" ａａａａａａａ\r\n")).toBe("AAAAAAA");
    expect(stocktakeCode("B000001")).toBe("B000001");
    expect(() => stocktakeCode("123456789012")).toThrow();
    expect(() => stocktakeCode("https://example.com/AAAAAAA")).toThrow();
  });
  it("does not double count repeat scans", () => {
    const state = emptyStocktakeState();
    state.scans = [1, 2].map(() => ({ code: "AAAAAAA", at: "", operator: "" }));
    const result = summarizeStocktake(fixture, state);
    expect(result.confirmed).toBe(1);
    expect(result.confirmedAmount).toBe(100.25);
    expect(result.missing).toBe(4);
  });
  it("adds manual quantities only to their own row and preserves decimal cost", () => {
    const state = emptyStocktakeState();
    state.manual["2"] = { quantity: 3, at: "", operator: "" };
    expect(summarizeStocktake(fixture, state).confirmedAmount).toBe(150.3);
    expect(summarizeStocktake(fixture, state).expectedAmount).toBe(350.8);
  });
  it("keeps boxes and sealed contents outside normal stock quantities", () => {
    const state = emptyStocktakeState();
    state.scans.push({ code: "B000001", at: "", operator: "" });
    const result = summarizeStocktake(fixture, state);
    expect(result.confirmed).toBe(0);
    expect(result.boxes[0]).toMatchObject({
      boxConfirmed: true,
      confirmedContents: 0,
    });
    state.scans.push({ code: "CCCCCCC", at: "", operator: "" });
    expect(summarizeStocktake(fixture, state).boxes[0].confirmedContents).toBe(
      1
    );
    expect(stocktakeScanResult(fixture, "CCCCCCC").kind).toBe("packed");
  });
  it("retains unknown and not-in-stock scans as exceptions", () => {
    const state = emptyStocktakeState();
    state.scans = ["DDDDDDD", "ZZZZZZZ"].map(code => ({
      code,
      at: "",
      operator: "",
    }));
    const result = summarizeStocktake(fixture, state);
    expect(result.exceptions.map(s => s.kind)).toEqual([
      "unexpected",
      "unknown",
    ]);
    expect(result.confirmedAmount).toBe(0);
  });
  it("flags stale excess labels rather than silently trusting them", () => {
    const snapshot = structuredClone(fixture);
    snapshot.rows[0].quantity = 1;
    const state = emptyStocktakeState();
    state.scans = ["AAAAAAA", "BBBBBBB"].map(code => ({
      code,
      at: "",
      operator: "",
    }));
    expect(summarizeStocktake(snapshot, state).rows[0]).toMatchObject({
      labelConflict: true,
      excess: 1,
      manualCapacity: 0,
    });
  });
});
