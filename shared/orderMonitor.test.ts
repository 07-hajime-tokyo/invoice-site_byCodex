import { describe, expect, it } from "vitest";
import { buildOrderMonitorSnapshot, effectiveDeliveryQuantity } from "@/inventory/lib/orderMonitor";

describe("order monitor aggregation", () => {
  it("separates direct, eBay, purchase and shipment stages", () => {
    const result = buildOrderMonitorSnapshot(
      [{
        key: "394",
        partner: "Simon",
        csvOrderQty: 20,
        csvStatus: "",
        manualComplete: false,
        deliveredCount: 2,
        stockCount: 14,
        csvProducts: [{ status: "" }],
      }],
      [
        { id: 1, num: "P1", status: "ordered", extra: { trackingNumber: null }, purchase_items: [{ title: "A", quantity: "3", etc: "394_1" }] },
        { id: 2, num: "P2", status: "ordered", extra: { trackingNumber: "TRACK" }, purchase_items: [{ title: "B", quantity: "2", etc: "394_2" }] },
        { id: 3, num: "P3", status: "purchased", extra: { trackingNumber: "DONE" }, purchase_items: [{ title: "C", quantity: "9", etc: "394_3" }] },
      ],
      [
        { id: 1, title: "eBay order", quantity: "1", etc: "E0721_1", ebayOrderUrl: "https://example.com/order", ebayOrderStatus: "normal" },
        { id: 2, title: "not linked", quantity: "1", etc: "E0721_2", ebayOrderUrl: null, ebayOrderStatus: "normal" },
      ],
      [{
        id: 1,
        deliveryNo: "E0721_1",
        status: "success",
        createdAt: "2026-07-21T01:00:00.000Z",
        items: [{ inventoryId: 1, title: "A", quantity: 2 }],
        cancelledItems: [{ inventoryId: 1, quantity: 1 }],
      }],
      new Date("2026-07-21T12:00:00.000Z"),
    );

    expect(result.directOutstanding).toBe(18);
    expect(result.ebayOutstanding).toBe(1);
    expect(result.ebayWithoutOrderUrl).toBe(1);
    expect(result.purchaseOrderedQuantity).toBe(3);
    expect(result.supplierShippedQuantity).toBe(2);
    expect(result.shippedToday).toBe(1);
    expect(result.ebayShippedThisMonth).toBe(1);
  });

  it("subtracts cancelled quantities only from their inventory row", () => {
    expect(effectiveDeliveryQuantity({
      id: 1,
      deliveryNo: "394_1",
      status: "success",
      createdAt: "2026-07-21T00:00:00.000Z",
      items: [
        { inventoryId: 10, title: "A", quantity: 3 },
        { inventoryId: 20, title: "B", quantity: 2 },
      ],
      cancelledItems: [{ inventoryId: 10, quantity: 1 }],
    })).toBe(4);
  });
});
