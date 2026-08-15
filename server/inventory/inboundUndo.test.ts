import { describe, expect, it, vi } from "vitest";
import {
  actionItemUndoDisposition,
  missingUndoRejection,
  normalizeUndoLabelIds,
  receiveUndoBlockReason,
  runClaimedUndo,
} from "./inboundUndo";

describe("inbound undo safety", () => {
  it("二重取消では巻き戻しを1回しか実行しない", async () => {
    let available = true;
    const rollback = vi.fn(async () => undefined);
    const execute = () => runClaimedUndo({
      claim: async () => {
        if (!available) return false;
        available = false;
        return true;
      },
      rollback,
    });

    await expect(execute()).resolves.toBe(true);
    await expect(execute()).resolves.toBe(false);
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it("存在しないIDを理由付きで表す", () => {
    expect(missingUndoRejection("NOPE001")).toEqual({
      labelId: "NOPE001",
      reason: "商品IDが見つかりません",
    });
  });

  it("空入力は空の対象一覧として安全に扱う", () => {
    expect(normalizeUndoLabelIds(["", "   "])).toEqual([]);
  });

  it("受取取消後に同じ個体をもう一度受け取れる", async () => {
    let status = "received";
    const undone = await runClaimedUndo({
      claim: async () => status === "received",
      rollback: async () => {
        status = "ordered";
      },
    });
    expect(undone).toBe(true);
    expect(status).toBe("ordered");
    if (status === "ordered") status = "received";
    expect(status).toBe("received");
  });

  it("判定済みが混ざる箱では戻せる個体と理由を分ける", () => {
    const rows = [
      { labelId: "BOX0001", status: "received" },
      { labelId: "BOX0002", status: "stocked" },
    ].map(row => ({ ...row, reason: receiveUndoBlockReason(row.status) }));
    expect(rows.filter(row => !row.reason).map(row => row.labelId)).toEqual([
      "BOX0001",
    ]);
    expect(rows.filter(row => row.reason)).toEqual([
      expect.objectContaining({
        labelId: "BOX0002",
        reason: "先に動作確認を取り消してください",
      }),
    ]);
  });

  it("代替品依頼は未完了を取消し、完了済みを保持する", () => {
    expect(actionItemUndoDisposition({ exists: true, status: "open" })).toBe(
      "cancel"
    );
    expect(actionItemUndoDisposition({ exists: true, status: "done" })).toBe(
      "retain"
    );
  });
});
