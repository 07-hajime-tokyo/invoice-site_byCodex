export async function runClaimedUndo(input: {
  claim: () => Promise<boolean>;
  rollback: () => Promise<void>;
}): Promise<boolean> {
  const claimed = await input.claim();
  if (!claimed) return false;
  await input.rollback();
  return true;
}

export type UndoRejection = { labelId: string; reason: string };

export function missingUndoRejection(labelId: string): UndoRejection {
  return { labelId, reason: "商品IDが見つかりません" };
}

export function receiveUndoBlockReason(status: string): string | null {
  if (status === "received") return null;
  if (["stocked", "returned", "shipped"].includes(status))
    return "先に動作確認を取り消してください";
  return `荷受け済みではありません（現在: ${status}）`;
}

export function actionItemUndoDisposition(input: {
  exists: boolean;
  status?: string | null;
  completedAt?: Date | string | null;
}): "cancel" | "retain" | "none" {
  if (!input.exists) return "none";
  return input.status === "done" || Boolean(input.completedAt)
    ? "retain"
    : "cancel";
}

export function normalizeUndoLabelIds(values: string[]): string[] {
  return Array.from(
    new Set(values.map(value => value.trim().toUpperCase()).filter(Boolean))
  );
}
