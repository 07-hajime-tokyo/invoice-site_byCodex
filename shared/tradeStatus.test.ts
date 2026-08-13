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
    expect(isTradeStatusComplete("\u5b8c\u4e86")).toBe(true);
    expect(isTradeStatusComplete("\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b1\u53f0\uff09")).toBe(false);
  });

  it("treats simple remaining statuses as remaining", () => {
    expect(isTradeRemainingStatus("\u6b8b1")).toBe(true);
    expect(isTradeRemainingStatus("\u6b8b1\u53f0")).toBe(true);
    expect(isTradeRemainingStatus("remaining 1")).toBe(true);
    expect(isTradeRemainingStatus("\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b1\u53f0\uff09")).toBe(false);
  });

  it("keeps complete when all registered shipment quantities are covered", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 390,
        orderedQty: 10,
        registeredQty: 10,
        actualShippedQty: 10,
        fedexRegisteredQty: 0,
        hasShipmentSignal: true,
      }),
    ).toBe("complete");
  });

  it("keeps sheet remaining status even when registered shipment quantities are covered", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "remaining 1",
        invoiceNo: 393,
        orderedQty: 10,
        registeredQty: 10,
        actualShippedQty: 10,
        fedexRegisteredQty: 0,
        hasShipmentSignal: true,
      }),
    ).toBe("remaining 1");
  });

  it("shows simple remaining when actual shipments are short", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 393,
        orderedQty: 6,
        registeredQty: 5,
        actualShippedQty: 5,
        fedexRegisteredQty: 5,
        hasShipmentSignal: true,
      }),
    ).toBe("\u6b8b1");
  });

  it("downgrades complete when shipment registration is short", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 393,
        orderedQty: 10,
        registeredQty: 9,
        actualShippedQty: 10,
        fedexRegisteredQty: 10,
        hasShipmentSignal: true,
      }),
    ).toBe("\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b1\u53f0\uff09");
  });

  it("downgrades sheet complete when shipment registration has not started", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 400,
        orderedQty: 5,
        registeredQty: 0,
        fedexRegisteredQty: 0,
        hasShipmentSignal: false,
      }),
    ).toBe("\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b5\u53f0\uff09");
  });

  it("keeps sheet remaining count instead of replacing it with site remaining count", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "\u6b8b2",
        invoiceNo: 404,
        orderedQty: 5,
        registeredQty: 4,
        actualShippedQty: 4,
        fedexRegisteredQty: 4,
        hasShipmentSignal: true,
      }),
    ).toBe("\u6b8b2");
  });

  it("keeps simple sheet remaining status when shipment registration is short", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "\u6b8b1",
        invoiceNo: 393,
        orderedQty: 6,
        registeredQty: 5,
        hasShipmentSignal: true,
      }),
    ).toBe("\u6b8b1");
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
