import { describe, expect, it } from "vitest";
import {
  deriveTradeShipmentRegistrationStatus,
  formatRemainingQty,
  isTradeRemainingStatus,
  isTradeStatusComplete,
} from "./tradeStatus";

describe("tradeStatus", () => {
  it("treats complete and Japanese complete as complete", () => {
    expect(isTradeStatusComplete("complete")).toBe(true);
    expect(isTradeStatusComplete("完了")).toBe(true);
    expect(isTradeStatusComplete("発送登録未完了（残1台）")).toBe(false);
  });

  it("treats simple remaining statuses as remaining", () => {
    expect(isTradeRemainingStatus("残5")).toBe(true);
    expect(isTradeRemainingStatus("残 ５台")).toBe(true);
    expect(isTradeRemainingStatus("remaining 1")).toBe(true);
    expect(isTradeRemainingStatus("発送登録未完了（残1台）")).toBe(false);
  });

  it("keeps complete when all registered shipment quantities are covered", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 390,
        orderedQty: 10,
        registeredQty: 10,
        hasShipmentSignal: true,
      }),
    ).toBe("complete");
  });

  it("promotes stale sheet remaining status when registered shipment quantities are covered", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "remaining 1",
        invoiceNo: 393,
        orderedQty: 10,
        registeredQty: 10,
        hasShipmentSignal: true,
      }),
    ).toBe("complete");
  });

  it("downgrades complete when shipment registration is short", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 393,
        orderedQty: 10,
        registeredQty: 9,
        hasShipmentSignal: true,
      }),
    ).toBe("発送登録未完了（残1台）");
  });

  it("keeps simple sheet remaining status when shipment registration is short", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "残1",
        invoiceNo: 393,
        orderedQty: 6,
        registeredQty: 5,
        hasShipmentSignal: true,
      }),
    ).toBe("残1");
  });

  it("does not change old closed invoices", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 383,
        orderedQty: 10,
        registeredQty: 0,
        hasShipmentSignal: true,
      }),
    ).toBe("complete");
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 390,
        paymentDate: "2025-06-01",
        orderedQty: 10,
        registeredQty: 0,
        hasShipmentSignal: true,
      }),
    ).toBe("complete");
  });

  it("formats fractional quantities without noisy decimals", () => {
    expect(formatRemainingQty(1)).toBe("1");
    expect(formatRemainingQty(1.25)).toBe("1.25");
  });
});
