import { describe, expect, it } from "vitest";
import {
  getEffectivePurchaseStatus,
  isInboundActivePurchase,
  isInboundCutoffVisible,
  isPurchaseInboundComplete,
} from "./purchaseVisibility";

describe("入庫一覧の共通表示判定", () => {
  it("対象日の前日は非表示、対象日当日は表示する", () => {
    expect(
      isInboundCutoffVisible({ status: "ordered", purchaseDate: "2026-06-19" })
    ).toBe(false);
    expect(
      isInboundCutoffVisible({ status: "ordered", purchaseDate: "2026-06-20" })
    ).toBe(true);
  });

  it("発注日を最優先し、無効値なら代替日付を順に使う", () => {
    expect(
      isInboundCutoffVisible({
        status: "ordered",
        purchaseDate: "2026-06-19",
        purchase_date: "2026-07-01",
      })
    ).toBe(false);
    expect(
      isInboundCutoffVisible({
        status: "ordered",
        purchaseDate: "不明",
        purchase_date: " 2026-06-20T01:00:00 ",
      })
    ).toBe(true);
    expect(
      isInboundCutoffVisible({
        status: "ordered",
        purchase_date: "不明",
        created_at: "2026-06-19",
        createdAt: "2026-07-01",
      })
    ).toBe(false);
  });

  it("日付がない行は残し、Date値には既存のUTC日付を使う", () => {
    expect(isInboundCutoffVisible({ status: "ordered" })).toBe(true);
    expect(
      isInboundCutoffVisible({
        status: "ordered",
        createdAt: new Date("invalid"),
      })
    ).toBe(true);
    expect(
      isInboundCutoffVisible({
        status: "ordered",
        createdAt: new Date("2026-06-20T00:00:00+09:00"),
      })
    ).toBe(false);
    expect(
      isInboundCutoffVisible({
        status: "ordered",
        createdAt: new Date("2026-06-20T00:00:00Z"),
      })
    ).toBe(true);
  });

  it("日付が対象でも入庫済みは作業対象から除外する", () => {
    expect(
      isInboundActivePurchase({
        status: "purchased",
        purchaseDate: "2026-07-01",
      })
    ).toBe(false);
    expect(
      isInboundActivePurchase({ status: "ordered", purchaseDate: "2026-07-01" })
    ).toBe(true);
  });

  it("追跡番号のある未入庫行は発送済みとして扱う", () => {
    expect(
      getEffectivePurchaseStatus({
        status: "ordered",
        extra: { trackingNumber: "TEST-1" },
      })
    ).toBe("shipped");
    expect(
      getEffectivePurchaseStatus({
        status: "purchased",
        extra: { trackingNumber: "TEST-1" },
      })
    ).toBe("purchased");
    expect(
      getEffectivePurchaseStatus({
        status: "ordered",
        extra: { trackingNumber: "" },
      })
    ).toBe("ordered");
    // 空白をtrimしない現行の表示判定も保持する。
    expect(
      getEffectivePurchaseStatus({
        status: "ordered",
        extra: { trackingNumber: " " },
      })
    ).toBe("shipped");
  });

  it("分類に対応する最終工程だけを完了と判定する", () => {
    expect(
      isPurchaseInboundComplete({
        status: "ordered",
        inboundClass: "ebay",
        stage: "packed",
      })
    ).toBe(true);
    expect(
      isPurchaseInboundComplete({
        status: "ordered",
        inboundClass: "direct",
        stage: "packed",
      })
    ).toBe(false);
    expect(
      isPurchaseInboundComplete({
        status: "ordered",
        inboundClass: "direct",
        stage: "handed_over",
      })
    ).toBe(true);
    expect(
      isPurchaseInboundComplete({ status: "ordered", stage: "packed" })
    ).toBe(false);
    expect(
      isPurchaseInboundComplete({ status: "ordered", inboundClass: "ebay" })
    ).toBe(false);
  });
});
