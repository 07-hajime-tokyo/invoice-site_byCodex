import { describe, expect, it, vi } from "vitest";
import { deleteShipmentRowsForUnlink } from "./outboundBoxes";

describe("outbound box cancellation safety", () => {
  it("stops before the caller can mutate box state when GAS deletion fails", async () => {
    const post = vi.fn()
      .mockResolvedValueOnce({ success: true })
      .mockResolvedValueOnce({ success: false, message: "sheet unavailable" });
    await expect(deleteShipmentRowsForUnlink([
      { sheetName: "独発送管理", trackingNumber: "TRACK123" },
      { sheetName: "サミー発送管理", trackingNumber: "TRACK123" },
    ], post)).rejects.toThrow(/Googleスプレッドシート/);
    expect(post).toHaveBeenCalledTimes(2);
  });

  it("completes all sheet deletions before returning success", async () => {
    const post = vi.fn().mockResolvedValue({ success: true });
    await deleteShipmentRowsForUnlink([
      { sheetName: "独発送管理", trackingNumber: "TRACK123" },
      { sheetName: "サミー発送管理", trackingNumber: "TRACK123" },
    ], post);
    expect(post).toHaveBeenCalledTimes(2);
  });
});
