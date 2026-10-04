import { beforeEach, describe, expect, it, vi } from "vitest";
import { recordWorkLog } from "../workLogs";
import type { LocalPurchaseWithLabels } from "../db";
import {
  getPurchaseTrackingAuditState,
  getNextPurchaseTrackingAuditState,
  getPurchaseTrackingChangedFields,
  recordPurchaseTrackingAuditLog,
} from "./trackingAudit";
vi.mock("../workLogs", () => ({ recordWorkLog: vi.fn() }));
const purchase = {
  id: 1,
  managementNo: " TEST ,日付",
  title: "架空",
  itemsJson: '[null,{"itemLabels":[{"labelId":" aa "},{"labelId":"BB"}]}]',
  itemLabels: [{ labelId: "AA" }],
  shipDate: null,
  trackingNumber: " OLD ",
  carrier: null,
  note: " 保持メモ ",
  status: "ordered",
  stage: "received",
} as LocalPurchaseWithLabels;
beforeEach(() => vi.resetAllMocks());
describe("追跡番号の作業記録", () => {
  it("未指定項目は保持し、明示したnullのみ解除として差分に含める", () => {
    const before = getPurchaseTrackingAuditState(purchase);
    const after = getNextPurchaseTrackingAuditState(before, {
      trackingNumber: " NEW ",
      note: null,
    });
    expect(after).toEqual({ ...before, trackingNumber: "NEW", note: null });
    expect(getPurchaseTrackingChangedFields(before, after)).toEqual([
      "trackingNumber",
      "note",
    ]);
  });
  it("差分がなければ記録しない", async () => {
    const state = getPurchaseTrackingAuditState(purchase);
    await recordPurchaseTrackingAuditLog(
      { zaicoId: 1 },
      purchase,
      state,
      state,
      []
    );
    expect(recordWorkLog).not.toHaveBeenCalled();
  });
  it("変更前後と正規化した商品ID・担当者を記録する", async () => {
    const before = getPurchaseTrackingAuditState(purchase);
    const after = getNextPurchaseTrackingAuditState(before, {
      trackingNumber: "NEW",
    });
    await recordPurchaseTrackingAuditLog(
      { zaicoId: 1, labelId: " bb ", operatorName: " TEST " },
      purchase,
      before,
      after,
      ["trackingNumber"]
    );
    const saved = vi.mocked(recordWorkLog).mock.calls[0][0];
    expect(saved).toMatchObject({
      workerName: "TEST",
      sourceType: "purchase-tracking-audit",
      sourceId: "purchase:1",
      quantity: 1,
    });
    expect(JSON.parse(saved.detailsJson!)).toMatchObject({
      target: { managementNo: "TEST", labelIds: ["BB", "AA"] },
      before: { trackingNumber: "OLD" },
      after: { trackingNumber: "NEW" },
      changedFields: ["trackingNumber"],
    });
  });
  it("作業記録だけの失敗は警告し、保存全体を失敗にはしない", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      vi.mocked(recordWorkLog).mockRejectedValue(new Error("synthetic"));
      const before = getPurchaseTrackingAuditState(purchase);
      await expect(
        recordPurchaseTrackingAuditLog(
          { zaicoId: 1 },
          purchase,
          before,
          before,
          ["note"]
        )
      ).resolves.toBeUndefined();
      expect(warn).toHaveBeenCalledOnce();
    } finally {
      warn.mockRestore();
    }
  });
});
