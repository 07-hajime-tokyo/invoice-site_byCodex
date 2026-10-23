import { describe, expect, it } from "vitest";
import {
  deriveTradeShipmentRegistrationStatus,
  formatRemainingQty,
  isTradeIncompleteForList,
  isTradeProcurementMissing,
  isTradeRemainingStatus,
  isTradeStatusComplete,
  isTradeShipmentConfirmed,
} from "./tradeStatus";

describe("tradeStatus", () => {
  const confirmedRow = { id: 690003, no: 400, partner: "Maxim", productName: "Vita 1000 Black", quantity: "5.00" };
  const confirmation = JSON.stringify({
    version: 1, confirmedShipped: true, tradeId: confirmedRow.id, invoiceNo: confirmedRow.no,
    partner: confirmedRow.partner, productName: confirmedRow.productName, quantity: 5,
  });

  it("keeps the specifically confirmed shipment complete despite missing registrations", () => {
    expect(isTradeShipmentConfirmed(confirmedRow, confirmation)).toBe(true);
    for (const registeredQty of [0, 4]) {
      expect(deriveTradeShipmentRegistrationStatus({
        status: "complete", invoiceNo: 400, orderedQty: 5, registeredQty,
        fedexRegisteredQty: registeredQty,
        shipmentConfirmed: isTradeShipmentConfirmed(confirmedRow, confirmation),
      })).toBe("complete");
    }
  });

  it("does not apply a confirmation to other rows or a changed order", () => {
    for (const change of [
      { id: 690004 }, { no: 414 }, { partner: "Sammy" },
      { productName: "Vita 1000 White" }, { quantity: "6.00" }, { quantity: "0" },
    ]) {
      expect(isTradeShipmentConfirmed({ ...confirmedRow, ...change }, confirmation)).toBe(false);
    }
    expect(deriveTradeShipmentRegistrationStatus({
      status: "complete", invoiceNo: 400, orderedQty: 5, registeredQty: 4,
      shipmentConfirmed: false,
    })).toBe("\u6b8b1");
  });

  it("ignores absent, malformed, unsupported, or revoked confirmations", () => {
    for (const memo of [undefined, "1", "broken", "null", "{}",
      JSON.stringify({ ...JSON.parse(confirmation), version: 2 }),
      JSON.stringify({ ...JSON.parse(confirmation), confirmedShipped: false }),
    ]) {
      expect(isTradeShipmentConfirmed(confirmedRow, memo)).toBe(false);
    }
  });

  it("still treats confirmed shipments with missing procurement as incomplete", () => {
    const status = deriveTradeShipmentRegistrationStatus({
      status: "", invoiceNo: 400, orderedQty: 5, registeredQty: 0, shipmentConfirmed: true,
    });
    expect(isTradeIncompleteForList({ status, procurementTotal: 0 })).toBe(true);
    expect(isTradeIncompleteForList({ status, procurementTotal: 86540 })).toBe(false);
  });

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
        invoiceNo: 400,
        orderedQty: 10,
        registeredQty: 10,
        fedexRegisteredQty: 10,
      }),
    ).toBe("complete");
  });

  it("uses FedEx registration quantities over sheet remaining status", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "remaining 1",
        invoiceNo: 419,
        orderedQty: 10,
        registeredQty: 10,
        fedexRegisteredQty: 10,
      }),
    ).toBe("complete");
  });

  it("shows simple remaining when FedEx registrations are short", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 400,
        orderedQty: 6,
        registeredQty: 5,
        fedexRegisteredQty: 5,
      }),
    ).toBe("\u6b8b1");
  });

  it("counts FedEx registration as shipment registration", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 400,
        orderedQty: 10,
        registeredQty: 9,
        fedexRegisteredQty: 10,
      }),
    ).toBe("complete");
  });

  it("does not count delivery-history-only quantities as shipment registration", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 420,
        orderedQty: 6,
        registeredQty: 6,
        fedexRegisteredQty: 0,
      }),
    ).toBe("\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b6\u53f0\uff09");
  });

  it("keeps invoice numbers through 399 complete even without site shipment registration", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 399,
        orderedQty: 5,
        registeredQty: 0,
      }),
    ).toBe("complete");
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "\u6b8b5",
        invoiceNo: 399,
        orderedQty: 5,
        registeredQty: 0,
        fedexRegisteredQty: 0,
      }),
    ).toBe("complete");
  });

  it("downgrades sheet complete when shipment registration has not started", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 400,
        orderedQty: 5,
        registeredQty: 0,
        fedexRegisteredQty: 0,
      }),
    ).toBe("\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b5\u53f0\uff09");
  });

  it("does not show simple sheet remaining status before shipment registration starts", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "\u6b8b6",
        invoiceNo: 419,
        orderedQty: 6,
        registeredQty: 0,
        fedexRegisteredQty: 0,
      }),
    ).toBe("");
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "\u6b8b5",
        invoiceNo: 399,
        orderedQty: 5,
        registeredQty: 0,
        fedexRegisteredQty: 0,
      }),
    ).toBe("complete");
  });

  it("does not leak invoice-level FedEx registration into unrelated product rows", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "\u6b8b6",
        invoiceNo: 419,
        orderedQty: 6,
        registeredQty: 0,
        fedexRegisteredQty: 0,
      }),
    ).toBe("");
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 419,
        orderedQty: 6,
        registeredQty: 0,
        fedexRegisteredQty: 0,
      }),
    ).toBe("\u767a\u9001\u767b\u9332\u672a\u5b8c\u4e86\uff08\u6b8b6\u53f0\uff09");
  });

  it("replaces sheet remaining count with site shipment remaining count", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "\u6b8b2",
        invoiceNo: 404,
        orderedQty: 5,
        registeredQty: 4,
        fedexRegisteredQty: 4,
      }),
    ).toBe("\u6b8b1");
  });

  it("keeps simple sheet remaining status when shipment registration is short", () => {
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "\u6b8b1",
        invoiceNo: 393,
        orderedQty: 6,
        registeredQty: 5,
        fedexRegisteredQty: 5,
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
      }),
    ).toBe("complete");
    expect(
      deriveTradeShipmentRegistrationStatus({
        status: "complete",
        invoiceNo: 390,
        paymentDate: "2025-06-01",
        orderedQty: 10,
        registeredQty: 0,
      }),
    ).toBe("complete");
  });

  it("formats fractional quantities without noisy decimals", () => {
    expect(formatRemainingQty(1)).toBe("1");
    expect(formatRemainingQty(1.25)).toBe("1.25");
  });

  it("treats complete rows with missing procurement as incomplete for the trade list", () => {
    expect(isTradeProcurementMissing(0)).toBe(true);
    expect(isTradeProcurementMissing("¥0")).toBe(true);
    expect(isTradeProcurementMissing("12,300")).toBe(false);
    expect(isTradeIncompleteForList({ status: "complete", procurementTotal: 0 })).toBe(true);
    expect(isTradeIncompleteForList({ status: "complete", procurementTotal: 12300 })).toBe(false);
    expect(isTradeIncompleteForList({ status: "\u6b8b1", procurementTotal: 12300 })).toBe(true);
  });

  it("hides closed-year complete rows even when procurement is missing", () => {
    expect(
      isTradeIncompleteForList({
        status: "complete",
        paymentDate: "2025-04-04",
        procurementTotal: 0,
      }),
    ).toBe(false);
  });
});
