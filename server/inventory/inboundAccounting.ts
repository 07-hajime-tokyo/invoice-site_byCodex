import { TRPCError } from "@trpc/server";
import { and, eq, or, sql } from "drizzle-orm";
import { localInventories, purchaseHistories, type InsertPurchaseHistory } from "../../drizzle/schema";
import type { AppDatabase } from "../_core/database";
import { recordWorkLog } from "./workLogs";

export function assertInboundQuantity(recorded: number, incoming: number, ordered?: number | null) {
  if (!Number.isSafeInteger(incoming) || incoming <= 0 ||
    !Number.isSafeInteger(recorded) || recorded < 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "入庫数量を確認してください" });
  }
  const limit = Number.isSafeInteger(ordered) && Number(ordered) > 0 ? Number(ordered) : incoming;
  if (recorded + incoming > limit) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `入庫済みの数量があるため登録できません（入庫済み ${recorded} / 発注 ${limit}）`,
    });
  }
}

// Call only after locking the local inventory row and before writing stock or history.
export async function assertInboundCapacity(
  tx: Pick<AppDatabase, "select">,
  input: {
    inventoryId: number;
    zaicoInventoryId?: number | null;
    purchaseHistoryKeys?: number[];
    managementNo?: string | null;
    incoming: number;
    ordered?: number | null;
  },
) {
  const historyKeys = [...new Set(input.purchaseHistoryKeys ?? [])];
  const inventoryKeys = [...new Set([input.inventoryId, input.zaicoInventoryId].filter((id): id is number => id != null))];
  const rows = await tx.select({
    quantity: purchaseHistories.quantity,
    kanriNo: purchaseHistories.kanriNo,
    zaicoId: purchaseHistories.zaicoId,
  }).from(purchaseHistories).where(and(
    eq(purchaseHistories.cancelled, 0),
    or(
      ...inventoryKeys.map(id => eq(purchaseHistories.inventoryId, id)),
      ...historyKeys.map(id => eq(purchaseHistories.zaicoId, id)),
    ),
  )).for("update");
  const management = (input.managementNo ?? "").split(",")[0].trim();
  const recorded = rows.reduce((total, row) => {
    const rowManagement = (row.kanriNo ?? "").split(",")[0].trim();
    return historyKeys.includes(row.zaicoId) || !management || !rowManagement || management === rowManagement
      ? total + Number(row.quantity) : total;
  }, 0);
  assertInboundQuantity(recorded, input.incoming, input.ordered);
}

export async function addInboundReceipt(
  tx: Pick<AppDatabase, "select" | "update" | "insert">,
  input: Parameters<typeof assertInboundCapacity>[1],
  history: Omit<InsertPurchaseHistory, "inventoryId" | "quantity">,
  audit: { sourceType: string; sourceId: string; details: Record<string, unknown> },
) {
  await assertInboundCapacity(tx, input);
  await tx.update(localInventories)
    .set({ quantity: sql`${localInventories.quantity} + ${input.incoming}` })
    .where(eq(localInventories.id, input.inventoryId));
  await tx.insert(purchaseHistories).values({
    ...history, inventoryId: input.inventoryId, quantity: String(input.incoming),
  });
  const workerName = history.operatorName || "入庫";
  const now = new Date();
  await recordWorkLog({
    workerName,
    category: "入庫登録",
    startedAt: now,
    endedAt: now,
    quantity: input.incoming,
    memo: history.kanriNo ?? audit.sourceId,
    createdBy: workerName,
    sourceType: audit.sourceType,
    sourceId: audit.sourceId,
    detailsJson: JSON.stringify({ ...audit.details, inventoryId: input.inventoryId, managementNo: history.kanriNo }),
  }, { executor: tx, standalone: true });
}
