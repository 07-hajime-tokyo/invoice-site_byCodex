import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  actionItems,
  inventoryItemLabels,
  localInventories,
  purchaseHistories,
  workLogs,
} from "../../drizzle/schema";
import { protectedProcedure } from "../_core/trpc";
import {
  actionItemUndoDisposition,
  missingUndoRejection,
  normalizeUndoLabelIds,
  receiveUndoBlockReason,
  runClaimedUndo,
} from "./inboundUndo";
import {
  InspectionOutcome,
  requireDb,
  findPurchaseForLabel,
  labelWasAlreadyCounted,
  normalizeStatus,
  operatorName,
  affectedRowsFromResult,
} from "./inboundDeskData";

export type UndoKind = "receive" | "inspection";

export type InspectionUndoMeta = {
  outcome: InspectionOutcome;
  sourceInventoryId: number;
  inspectionInventoryId: number;
  quantityDelta: number;
  purchaseHistoryId: number | null;
  actionItem: typeof actionItems.$inferSelect | null;
};

export async function resolveInspectionUndoMeta(
  label: typeof inventoryItemLabels.$inferSelect
): Promise<InspectionUndoMeta | null> {
  const db = await requireDb();
  const [latestLog] = await db
    .select()
    .from(workLogs)
    .where(
      and(
        eq(workLogs.sourceType, "inbound-inspection"),
        eq(workLogs.sourceId, label.labelId)
      )
    )
    .orderBy(desc(workLogs.createdAt))
    .limit(1);
  const details = (() => {
    try {
      return JSON.parse(latestLog?.detailsJson ?? "{}") as {
        outcome?: InspectionOutcome;
        sourceInventoryId?: number;
        inspectionInventoryId?: number;
        quantityDelta?: number;
        purchaseHistoryId?: number | null;
        actionItemId?: number | null;
      };
    } catch {
      return {};
    }
  })();
  const outcome = (label.inspectionOutcome ??
    details.outcome) as InspectionOutcome | null;
  if (!outcome) return null;

  const purchase = await findPurchaseForLabel(label);
  const sourceInventoryId =
    label.inspectionSourceInventoryId ??
    details.sourceInventoryId ??
    (outcome === "defective" || outcome === "junk"
      ? purchase?.localInventoryId
      : label.localInventoryId);
  const inspectionInventoryId =
    label.inspectionInventoryId ??
    details.inspectionInventoryId ??
    label.localInventoryId;
  if (!sourceInventoryId || !inspectionInventoryId) return null;

  let quantityDelta =
    label.inspectionQuantityDelta ?? details.quantityDelta ?? null;
  if (quantityDelta == null) {
    const countedBeforeInspection = await labelWasAlreadyCounted(label.labelId);
    quantityDelta =
      outcome === "stocked"
        ? countedBeforeInspection
          ? 0
          : 1
        : countedBeforeInspection
          ? -1
          : 0;
  }

  const actionItemId =
    label.inspectionActionItemId ?? details.actionItemId ?? null;
  const [actionItem] = actionItemId
    ? await db
        .select()
        .from(actionItems)
        .where(eq(actionItems.id, actionItemId))
        .limit(1)
    : await db
        .select()
        .from(actionItems)
        .where(
          and(
            eq(actionItems.source, "inbound-inspection"),
            eq(actionItems.sourceKey, label.labelId)
          )
        )
        .limit(1);

  let purchaseHistoryId =
    label.inspectionPurchaseHistoryId ?? details.purchaseHistoryId ?? null;
  if (!purchaseHistoryId && quantityDelta !== 0) {
    const [history] = await db
      .select({ id: purchaseHistories.id })
      .from(purchaseHistories)
      .where(
        and(
          eq(purchaseHistories.inventoryId, inspectionInventoryId),
          eq(purchaseHistories.cancelled, 0)
        )
      )
      .orderBy(desc(purchaseHistories.createdAt))
      .limit(1);
    purchaseHistoryId = history?.id ?? null;
  }

  return {
    outcome,
    sourceInventoryId,
    inspectionInventoryId,
    quantityDelta,
    purchaseHistoryId,
    actionItem: actionItem ?? null,
  };
}

export async function loadUndoPreview(kind: UndoKind, labelIds: string[]) {
  const db = await requireDb();
  const uniqueIds = normalizeUndoLabelIds(labelIds);
  if (uniqueIds.length === 0) return [];
  const labels = await db
    .select()
    .from(inventoryItemLabels)
    .where(inArray(inventoryItemLabels.labelId, uniqueIds));
  const labelsById = new Map(labels.map(label => [label.labelId, label]));
  const items = [] as Array<{
    labelId: string;
    canUndo: boolean;
    reason: string | null;
    inventoryRollback: number;
    actionItemDisposition: "cancel" | "retain" | "none";
    meta: InspectionUndoMeta | null;
    label: typeof inventoryItemLabels.$inferSelect | null;
  }>;

  for (const labelId of uniqueIds) {
    const label = labelsById.get(labelId) ?? null;
    if (!label) {
      items.push({
        ...missingUndoRejection(labelId),
        canUndo: false,
        inventoryRollback: 0,
        actionItemDisposition: "none",
        meta: null,
        label: null,
      });
      continue;
    }
    const status = normalizeStatus(label.status);
    if (kind === "receive") {
      const reason = receiveUndoBlockReason(status);
      items.push({
        labelId,
        canUndo: !reason,
        reason,
        inventoryRollback: 0,
        actionItemDisposition: "none",
        meta: null,
        label,
      });
      continue;
    }

    const meta = await resolveInspectionUndoMeta(label);
    const shipped = status === "shipped" || Boolean(label.outboundBoxId);
    const alreadyUndone =
      status === "received" || Boolean(label.inspectionCancelledAt);
    const reason = shipped
      ? "出庫箱への格納・出庫後は取り消せません"
      : alreadyUndone
        ? "動作確認は既に取り消されています"
        : !meta
          ? "動作確認の巻き戻し情報を特定できません"
          : null;
    items.push({
      labelId,
      canUndo: !reason,
      reason,
      inventoryRollback: Math.abs(meta?.quantityDelta ?? 0),
      actionItemDisposition: actionItemUndoDisposition({
        exists: Boolean(meta?.actionItem),
        status: meta?.actionItem?.status,
        completedAt: meta?.actionItem?.completedAt,
      }),
      meta,
      label,
    });
  }
  return items;
}

export const inboundUndoPreviewProcedure = protectedProcedure
  .input(
    z.object({
      kind: z.enum(["receive", "inspection"]),
      labelIds: z.array(z.string().max(80)).max(100),
    })
  )
  .query(async ({ input }) => {
    const items = await loadUndoPreview(input.kind, input.labelIds);
    return {
      items: items.map(({ meta: _meta, label: _label, ...item }) => item),
      summary: {
        undoable: items.filter(item => item.canUndo).length,
        rejected: items.filter(item => !item.canUndo).length,
        inventoryRollback: items.reduce(
          (sum, item) => sum + (item.canUndo ? item.inventoryRollback : 0),
          0
        ),
        actionItemsCancelled: items.filter(
          item => item.canUndo && item.actionItemDisposition === "cancel"
        ).length,
        actionItemsRetained: items.filter(
          item => item.canUndo && item.actionItemDisposition === "retain"
        ).length,
      },
    };
  });

export const inboundUndoProcedure = protectedProcedure
  .input(
    z.object({
      kind: z.enum(["receive", "inspection"]),
      labelIds: z.array(z.string().max(80)).max(100),
      operatorName: z.string().max(200).optional(),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const workerName = operatorName(
      input.operatorName,
      ctx.user.name ?? ctx.user.email
    );
    const preview = await loadUndoPreview(input.kind, input.labelIds);
    const restored: string[] = [];
    const rejected = preview
      .filter(item => !item.canUndo)
      .map(item => ({ labelId: item.labelId, reason: item.reason! }));
    let inventoryRollback = 0;
    let actionItemsCancelled = 0;
    let actionItemsRetained = 0;

    for (const item of preview.filter(candidate => candidate.canUndo)) {
      const label = item.label!;
      const now = new Date();
      try {
        const changed = await db.transaction(async tx =>
          runClaimedUndo({
            claim: async () => {
              const result =
                input.kind === "receive"
                  ? await tx
                      .update(inventoryItemLabels)
                      .set({ status: "ordered", receivedAt: null })
                      .where(
                        and(
                          eq(inventoryItemLabels.id, label.id),
                          eq(inventoryItemLabels.status, "received")
                        )
                      )
                  : await tx
                      .update(inventoryItemLabels)
                      .set({
                        status: "received",
                        localInventoryId: item.meta!.sourceInventoryId,
                        listingKind: null,
                        defectTags: null,
                        defectNote: null,
                        defectPhotosJson: null,
                        defectRecordedAt: null,
                        yahooClosedPricesJson: null,
                        yahooPriceFetchedAt: null,
                        defectiveSheetSyncedAt: null,
                        inspectionCancelledAt: now,
                        inspectionCancelledBy: workerName,
                      })
                      .where(
                        and(
                          eq(inventoryItemLabels.id, label.id),
                          eq(inventoryItemLabels.status, label.status),
                          isNull(inventoryItemLabels.inspectionCancelledAt)
                        )
                      );
              return affectedRowsFromResult(result) === 1;
            },
            rollback: async () => {
              if (input.kind === "inspection") {
                const meta = item.meta!;
                if (meta.quantityDelta > 0) {
                  const quantityResult = await tx
                    .update(localInventories)
                    .set({
                      quantity: sql`${localInventories.quantity} - ${meta.quantityDelta}`,
                    })
                    .where(
                      and(
                        eq(localInventories.id, meta.sourceInventoryId),
                        gte(localInventories.quantity, meta.quantityDelta)
                      )
                    );
                  if (affectedRowsFromResult(quantityResult) !== 1)
                    throw new TRPCError({
                      code: "CONFLICT",
                      message: `${item.labelId} の在庫数が既に変わっています`,
                    });
                } else if (meta.quantityDelta < 0) {
                  await tx
                    .update(localInventories)
                    .set({
                      quantity: sql`${localInventories.quantity} + ${Math.abs(meta.quantityDelta)}`,
                    })
                    .where(eq(localInventories.id, meta.sourceInventoryId));
                }
                if (meta.inspectionInventoryId !== meta.sourceInventoryId) {
                  await tx
                    .update(localInventories)
                    .set({ quantity: 0, isDeleted: 1 })
                    .where(eq(localInventories.id, meta.inspectionInventoryId));
                }
                if (meta.purchaseHistoryId) {
                  await tx
                    .update(purchaseHistories)
                    .set({ cancelled: 1 })
                    .where(
                      and(
                        eq(purchaseHistories.id, meta.purchaseHistoryId),
                        eq(purchaseHistories.cancelled, 0)
                      )
                    );
                }
                if (meta.actionItem) {
                  const completed =
                    meta.actionItem.status === "done" ||
                    Boolean(meta.actionItem.completedAt);
                  const note = completed
                    ? `[動作確認取消済み ${now.toISOString()}] 完了済みのため記録を保持`
                    : `[動作確認取消済み ${now.toISOString()}] 未完了依頼を取消`;
                  await tx
                    .update(actionItems)
                    .set({
                      status: "done",
                      completedAt: meta.actionItem.completedAt ?? now,
                      detail: `${meta.actionItem.detail}\n\n${note}`,
                    })
                    .where(eq(actionItems.id, meta.actionItem.id));
                }
              }
              await tx.insert(workLogs).values({
                workerName,
                category:
                  input.kind === "receive" ? "荷受け取消" : "動作確認取消",
                status: "done",
                startedAt: now,
                endedAt: now,
                quantity: 1,
                memo: `商品ID: ${item.labelId}`,
                createdBy: workerName,
                sourceType:
                  input.kind === "receive"
                    ? "inbound-receipt-undo"
                    : "inbound-inspection-undo",
                sourceId: item.labelId,
                detailsJson: JSON.stringify({
                  labelId: item.labelId,
                  kind: input.kind,
                  inventoryRollback: item.inventoryRollback,
                  actionItemDisposition: item.actionItemDisposition,
                }),
              });
            },
          })
        );
        if (!changed) {
          rejected.push({
            labelId: item.labelId,
            reason: "別の操作で状態が変わったため取り消しませんでした",
          });
          continue;
        }
        restored.push(item.labelId);
        inventoryRollback += item.inventoryRollback;
        if (item.actionItemDisposition === "cancel") actionItemsCancelled += 1;
        if (item.actionItemDisposition === "retain") actionItemsRetained += 1;
      } catch (error) {
        rejected.push({
          labelId: item.labelId,
          reason: error instanceof Error ? error.message : "取消に失敗しました",
        });
      }
    }
    return {
      restored,
      rejected,
      inventoryRollback,
      actionItemsCancelled,
      actionItemsRetained,
    };
  });
