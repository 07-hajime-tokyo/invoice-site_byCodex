import { describe, expect, it } from "vitest";
import { deriveZeroStockPurchaseStatusForItem } from "./purchaseRegistrationZeroStock";

describe("deriveZeroStockPurchaseStatusForItem", () => {
  it("treats supplier-shipped zero stock rows as inbound waiting when labels are still ordered", () => {
    expect(
      deriveZeroStockPurchaseStatusForItem({
        itemStatus: "shipped",
        labelStatuses: ["ordered"],
        rowStatus: "inbound_shipped",
      })
    ).toEqual({
      kind: "inbound_waiting",
      label: "入庫待ち",
      inboundWaiting: true,
    });
  });

  it("keeps a single shipped label as shipped out", () => {
    expect(
      deriveZeroStockPurchaseStatusForItem({
        itemStatus: "ordered",
        labelStatuses: ["shipped"],
        rowStatus: "shipped",
      })
    ).toEqual({ kind: "shipped", label: "出庫済み", inboundWaiting: false });
  });

  it("does not mark mixed shipped labels as shipped out", () => {
    expect(
      deriveZeroStockPurchaseStatusForItem({
        itemStatus: "ordered",
        labelStatuses: ["shipped", "ordered"],
        rowStatus: "partial_shipped",
      })
    ).toEqual({
      kind: "inbound_waiting",
      label: "入庫待ち",
      inboundWaiting: true,
    });
  });

  it("keeps received labels waiting for inspection", () => {
    expect(
      deriveZeroStockPurchaseStatusForItem({
        itemStatus: "ordered",
        labelStatuses: ["received"],
        rowStatus: "received",
      })
    ).toEqual({
      kind: "inspection_waiting",
      label: "動作確認待ち",
      inboundWaiting: false,
    });
  });

  it("hides stocked labels from the zero-stock purchase list", () => {
    expect(
      deriveZeroStockPurchaseStatusForItem({
        itemStatus: "ordered",
        labelStatuses: ["stocked"],
        rowStatus: "received",
      })
    ).toBeNull();
  });
});
