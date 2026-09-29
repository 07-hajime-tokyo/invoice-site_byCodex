import { describe, expect, it } from "vitest";
import {
  assertLocalPurchaseTrackingSynced,
  buildPurchaseTrackingUpdate,
  normalizePurchaseTrackingValue,
} from "./trackingFields";

describe("追跡保存の入力規則", () => {
  it("未指定と明示したundefined/null/空文字を区別する", () => {
    expect(buildPurchaseTrackingUpdate({ zaicoId: 1 })).toEqual({});
    for (const trackingNumber of [undefined, null, "", "  "]) {
      expect(
        buildPurchaseTrackingUpdate({ zaicoId: 1, trackingNumber })
      ).toEqual({ trackingNumber: null, carrier: null });
    }
  });
  it("番号を指定せず配送業者とメモだけを更新できる", () => {
    expect(
      buildPurchaseTrackingUpdate({
        zaicoId: 1,
        carrier: " yamato ",
        note: " メモ ",
      })
    ).toEqual({ carrier: "yamato", note: "メモ" });
    expect(
      buildPurchaseTrackingUpdate({
        zaicoId: 1,
        trackingNumber: " TRACK ",
        carrier: "auto",
        shipDate: "2026-09-01",
      })
    ).toEqual({
      trackingNumber: "TRACK",
      carrier: "auto",
      shipDate: "2026-09-01",
    });
  });
  it("正規化は空欄をnullにし内部の空白を保持する", () => {
    expect(normalizePurchaseTrackingValue(" A B ")).toBe("A B");
    expect(normalizePurchaseTrackingValue(" \t ")).toBeNull();
  });
  it("未一致を拒否するのは非空の番号を指定したときだけ", () => {
    expect(() =>
      assertLocalPurchaseTrackingSynced(
        { zaicoId: 1, trackingNumber: "TRACK" },
        0
      )
    ).toThrow("見つかりませんでした");
    expect(() =>
      assertLocalPurchaseTrackingSynced(
        { zaicoId: 1, trackingNumber: "TRACK" },
        1
      )
    ).not.toThrow();
    expect(() =>
      assertLocalPurchaseTrackingSynced({ zaicoId: 1, trackingNumber: null }, 0)
    ).not.toThrow();
    expect(() =>
      assertLocalPurchaseTrackingSynced({ zaicoId: 1, note: "メモ" }, 0)
    ).not.toThrow();
  });
});
