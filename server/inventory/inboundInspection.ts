import { INBOUND_INSPECTION_OUTCOMES } from "@shared/inboundDesk";
import { TRPCError } from "@trpc/server";
import { and, eq, lt } from "drizzle-orm";
import { z } from "zod";
import {
  actionItems,
  inventoryItemLabels,
  localInventories,
} from "../../drizzle/schema";
import { protectedProcedure } from "../_core/trpc";
import {
  createPurchaseHistory,
  getDb,
  getLocalInventoryById,
  updateLocalInventory,
} from "./db";
import { recordWorkLog } from "./workLogs";
import {
  DEFECT_PHOTO_KINDS,
  DEFECT_TAGS,
  type DefectPhoto,
  type ListingKind,
} from "./defectiveListing";
import { syncDefectiveListingByLabelId } from "./defectiveSync";
import {
  invoiceAllocation,
  requireDb,
  InspectionOutcome,
  normalizeStatus,
  findPurchaseForLabel,
  labelWasAlreadyCounted,
  operatorName,
  insertIdFromResult,
  affectedRowsFromResult,
} from "./inboundDeskData";

export const inboundInspectionInputSchema = z
  .object({
    labelId: z.string().min(1).max(80),
    outcome: z.enum(INBOUND_INSPECTION_OUTCOMES),
    requestReplacement: z.boolean().optional(),
    operatorName: z.string().max(200).optional(),
    defectTags: z.array(z.enum(DEFECT_TAGS)).max(9).optional(),
    defectNote: z.string().max(500).optional(),
    defectPhotos: z
      .array(
        z.object({
          url: z.string().url().max(2_000),
          key: z.string().min(1).max(512),
          kind: z.enum(DEFECT_PHOTO_KINDS),
        })
      )
      .max(10)
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      (value.outcome === "defective" || value.outcome === "junk") &&
      !value.defectTags?.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["defectTags"],
        message: "不良時は不良タグを1つ以上選んでください",
      });
    }
  });

export async function insertInspectionActionItem(input: {
  labelId: string;
  title: string;
  legacyManagementNo: string | null;
  createdBy: string;
}) {
  const { invoiceNo, partner } = invoiceAllocation(input.legacyManagementNo);
  if (!invoiceNo) return null;
  const db = await requireDb();
  const sourceKey = input.labelId.trim().toUpperCase();
  const [existing] = await db
    .select({ id: actionItems.id })
    .from(actionItems)
    .where(
      and(
        eq(actionItems.source, "inbound-inspection"),
        eq(actionItems.sourceKey, sourceKey)
      )
    )
    .limit(1);
  if (existing) return existing.id;

  const partnerText = partner ? ` ${partner}` : "";
  const detail = `No.${invoiceNo}${partnerText}向けの ${input.title}（${sourceKey}）が不良のため、代替品の仕入れをお願いします`;
  const [result] = await db.insert(actionItems).values({
    title: "代替品の仕入れ依頼",
    assignee: "野田さん",
    detail,
    status: "open",
    source: "inbound-inspection",
    sourceKey,
    sourceQuestion: null,
    createdBy: input.createdBy,
  });
  return Number((result as { insertId?: number }).insertId ?? 0) || null;
}

export async function createDefectiveInventory(
  input: {
    label: typeof inventoryItemLabels.$inferSelect;
    sourceInventory: typeof localInventories.$inferSelect;
    /**
     * 仕分け先。在庫一覧で見分けられるようカテゴリを分ける。
     * surplus は不良ではないので「不良在庫」に混ぜない。
     */
    destination?: "defective" | "junk" | "surplus";
  },
  executor?: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "insert">
) {
  const db = executor ?? (await requireDb());
  const destination = input.destination ?? "defective";
  const bucket = {
    defective: { category: "不良在庫", tag: "不良" },
    junk: { category: "ジャンク売り", tag: "ジャンク" },
    surplus: { category: "国内販売", tag: "国内" },
  }[destination];
  const [result] = await db.insert(localInventories).values({
    zaicoId: null,
    title: input.label.title || input.sourceInventory.title,
    category: bucket.category,
    place: input.sourceInventory.place,
    quantity: 1,
    unit: input.sourceInventory.unit,
    unitPrice: input.sourceInventory.unitPrice,
    etc: `在庫_${bucket.tag}_${input.label.labelId}`,
    supplierUrl: input.sourceInventory.supplierUrl,
    supplierName: input.sourceInventory.supplierName,
    ebayListingUrl: null,
    ebayOrderUrl: null,
    ebayOrderStatus: "normal",
    isDeleted: 0,
  });
  const inventoryId = Number((result as { insertId?: number }).insertId ?? 0);
  if (!inventoryId)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `${bucket.category}を作成できませんでした`,
    });
  return inventoryId;
}

export async function recordInspection(input: {
  labelId: string;
  outcome: InspectionOutcome;
  workerName: string;
  actionItemId: number | null;
  requestReplacement: boolean;
  sourceInventoryId: number;
  inspectionInventoryId: number;
  quantityDelta: number;
  purchaseHistoryId: number | null;
  defectTags?: readonly string[];
  photoCount?: number;
}) {
  const now = new Date();
  await recordWorkLog({
    workerName: input.workerName,
    category: "荷受け検品",
    status: "done",
    startedAt: now,
    endedAt: now,
    quantity: 1,
    memo: `商品ID: ${input.labelId}`,
    createdBy: input.workerName,
    sourceType: "inbound-inspection",
    sourceId: input.labelId,
    detailsJson: JSON.stringify({
      labelId: input.labelId,
      outcome: input.outcome,
      actionItemId: input.actionItemId,
      requestReplacement: input.requestReplacement,
      sourceInventoryId: input.sourceInventoryId,
      inspectionInventoryId: input.inspectionInventoryId,
      quantityDelta: input.quantityDelta,
      purchaseHistoryId: input.purchaseHistoryId,
      defectTags: input.defectTags ?? [],
      photoCount: input.photoCount ?? 0,
    }),
  });
}

export const inboundInspectProcedure = protectedProcedure
  .input(inboundInspectionInputSchema)
  .mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const labelId = input.labelId.trim().toUpperCase();
    const [label] = await db
      .select()
      .from(inventoryItemLabels)
      .where(eq(inventoryItemLabels.labelId, labelId))
      .limit(1);
    if (!label)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `商品ID ${labelId} が見つかりません`,
      });
    if (normalizeStatus(label.status) !== "received") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${labelId} は検品待ちではありません`,
      });
    }
    if (!label.localInventoryId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `${labelId} に在庫情報が紐づいていません`,
      });
    }

    const sourceInventory = await getLocalInventoryById(label.localInventoryId);
    if (!sourceInventory) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: `${labelId} の在庫情報が見つかりません`,
      });
    }
    const purchase = await findPurchaseForLabel(label);
    const counted = await labelWasAlreadyCounted(labelId);
    const currentQuantity = Number(sourceInventory.quantity ?? 0);
    const workerName = operatorName(
      input.operatorName,
      ctx.user.name ?? ctx.user.email
    );
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date();
    let nextInventoryId = sourceInventory.id;
    let actionItemId: number | null = null;
    let purchaseHistoryId: number | null = null;
    let quantityDelta = 0;
    const requestReplacement =
      input.outcome === "stocked"
        ? false
        : (input.requestReplacement ?? input.outcome === "defective");
    const defectPhotos = (input.defectPhotos ?? []) as DefectPhoto[];
    if (
      (input.outcome === "defective" || input.outcome === "junk") &&
      defectPhotos.some(photo => !photo.key.startsWith(`defective/${labelId}/`))
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "写真の商品IDと動作確認対象の商品IDが一致しません",
      });
    }

    if (input.outcome === "stocked") {
      if (!counted) {
        quantityDelta = 1;
        await updateLocalInventory(sourceInventory.id, {
          quantity: currentQuantity + 1,
        });
        const historyZaicoId =
          purchase?.zaicoId ??
          purchase?.id ??
          sourceInventory.zaicoId ??
          sourceInventory.id;
        purchaseHistoryId = insertIdFromResult(
          await createPurchaseHistory({
            zaicoId: historyZaicoId,
            kanriNo: label.legacyManagementNo ?? purchase?.managementNo ?? null,
            title: label.title,
            category: purchase?.category ?? sourceInventory.category ?? null,
            supplier:
              purchase?.supplierName ?? sourceInventory.supplierName ?? null,
            quantity: "1",
            unitPrice:
              String(purchase?.unitPrice ?? sourceInventory.unitPrice ?? "") ||
              null,
            purchaseDate: today,
            inventoryId: sourceInventory.id,
            cancelled: 0,
            operatorName: workerName,
          })
        );
      }
      await db
        .update(inventoryItemLabels)
        .set({ status: "stocked", receivedAt: label.receivedAt ?? now })
        .where(eq(inventoryItemLabels.id, label.id));
    } else if (input.outcome === "defective" || input.outcome === "junk") {
      const isJunk = input.outcome === "junk";
      if (counted && currentQuantity > 0) {
        quantityDelta = -1;
        await updateLocalInventory(sourceInventory.id, {
          quantity: currentQuantity - 1,
        });
      }
      nextInventoryId = await createDefectiveInventory({
        label,
        sourceInventory,
        destination: isJunk ? "junk" : "defective",
      });
      if (!counted) {
        const historyZaicoId =
          purchase?.zaicoId ??
          purchase?.id ??
          sourceInventory.zaicoId ??
          sourceInventory.id;
        purchaseHistoryId = insertIdFromResult(
          await createPurchaseHistory({
            zaicoId: historyZaicoId,
            kanriNo: label.legacyManagementNo ?? purchase?.managementNo ?? null,
            title: label.title,
            category: isJunk ? "ジャンク売り" : "不良在庫",
            supplier:
              purchase?.supplierName ?? sourceInventory.supplierName ?? null,
            quantity: "1",
            unitPrice:
              String(purchase?.unitPrice ?? sourceInventory.unitPrice ?? "") ||
              null,
            purchaseDate: today,
            inventoryId: nextInventoryId,
            cancelled: 0,
            operatorName: workerName,
          })
        );
      }
      await db
        .update(inventoryItemLabels)
        .set({
          status: "stocked",
          localInventoryId: nextInventoryId,
          receivedAt: label.receivedAt ?? now,
          // 検品で不良に落ちたものは常にジャンク扱い
          listingKind: "junk" satisfies ListingKind,
          defectTags: input.defectTags!.join(","),
          defectNote: input.defectNote?.trim() || null,
          defectPhotosJson: JSON.stringify(defectPhotos),
          defectRecordedAt: now,
          defectiveSheetSyncedAt: null,
        })
        .where(eq(inventoryItemLabels.id, label.id));
      if (requestReplacement) {
        actionItemId = await insertInspectionActionItem({
          labelId,
          title: label.title,
          legacyManagementNo: label.legacyManagementNo,
          createdBy: workerName,
        });
      }
    } else {
      if (counted && currentQuantity > 0) {
        quantityDelta = -1;
        await updateLocalInventory(sourceInventory.id, {
          quantity: currentQuantity - 1,
        });
      }
      await db
        .update(inventoryItemLabels)
        .set({ status: "returned", receivedAt: label.receivedAt ?? now })
        .where(eq(inventoryItemLabels.id, label.id));
      if (requestReplacement) {
        actionItemId = await insertInspectionActionItem({
          labelId,
          title: label.title,
          legacyManagementNo: label.legacyManagementNo,
          createdBy: workerName,
        });
      }
    }

    await db
      .update(inventoryItemLabels)
      .set({
        inspectionOutcome: input.outcome,
        replacementRequested: requestReplacement,
        inspectionSourceInventoryId: sourceInventory.id,
        inspectionInventoryId: nextInventoryId,
        inspectionQuantityDelta: quantityDelta,
        inspectionPurchaseHistoryId: purchaseHistoryId,
        inspectionActionItemId: actionItemId,
        inspectedAt: now,
        inspectionCancelledAt: null,
        inspectionCancelledBy: null,
      })
      .where(eq(inventoryItemLabels.id, label.id));

    await recordInspection({
      labelId,
      outcome: input.outcome,
      workerName,
      actionItemId,
      requestReplacement,
      sourceInventoryId: sourceInventory.id,
      inspectionInventoryId: nextInventoryId,
      quantityDelta,
      purchaseHistoryId,
      defectTags: input.defectTags,
      photoCount: input.defectPhotos?.length,
    });
    if (input.outcome === "defective" || input.outcome === "junk") {
      setImmediate(() => {
        void syncDefectiveListingByLabelId(labelId).catch(error => {
          console.error("[defective-listing] asynchronous preparation failed", {
            labelId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });
    }
    return {
      labelId,
      outcome: input.outcome,
      localInventoryId: nextInventoryId,
      actionItemId,
      inventoryCountChanged: input.outcome === "stocked" ? !counted : counted,
      listingPreparation:
        input.outcome === "defective" || input.outcome === "junk"
          ? "queued"
          : null,
    };
  });

export const inboundCloseInspectionBacklogProcedure = protectedProcedure
  .input(
    z.object({
      receivedBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      dryRun: z.boolean().default(true),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const workerName = operatorName(undefined, ctx.user.name ?? ctx.user.email);
    const boundary = new Date(`${input.receivedBefore}T00:00:00+09:00`);
    const targets = await db
      .select({
        id: inventoryItemLabels.id,
        labelId: inventoryItemLabels.labelId,
        receivedAt: inventoryItemLabels.receivedAt,
      })
      .from(inventoryItemLabels)
      .where(
        and(
          eq(inventoryItemLabels.status, "received"),
          lt(inventoryItemLabels.receivedAt, boundary)
        )
      );

    if (input.dryRun) {
      return {
        dryRun: true,
        count: targets.length,
        labelIds: targets.map(t => t.labelId),
      };
    }

    const now = new Date();
    let closed = 0;
    for (const target of targets) {
      // 条件付き更新で状態を奪う。二重実行しても2回進まない。
      const result = await db
        .update(inventoryItemLabels)
        .set({
          status: "stocked",
          inspectionOutcome: "stocked",
          replacementRequested: false,
          inspectedAt: now,
          inspectionCancelledAt: null,
          inspectionCancelledBy: null,
          // 在庫まわりは触らない。遡及なので巻き戻しの対象も作らない。
          inspectionSourceInventoryId: null,
          inspectionInventoryId: null,
          inspectionQuantityDelta: 0,
          inspectionPurchaseHistoryId: null,
          inspectionActionItemId: null,
        })
        .where(
          and(
            eq(inventoryItemLabels.id, target.id),
            eq(inventoryItemLabels.status, "received")
          )
        );
      if (affectedRowsFromResult(result) === 1) closed += 1;
    }

    await recordWorkLog({
      workerName,
      category: "検品待ちの遡及クローズ",
      status: "done",
      startedAt: now,
      endedAt: now,
      quantity: closed,
      memo: `${input.receivedBefore} より前の荷受け分 ${closed}件を動作確認済みにした（在庫は動かしていない）`,
      createdBy: workerName,
      sourceType: "inbound-backlog-close",
      sourceId: input.receivedBefore,
      detailsJson: JSON.stringify({
        receivedBefore: input.receivedBefore,
        closed,
        labelIds: targets.map(t => t.labelId),
      }),
    });

    return {
      dryRun: false,
      count: targets.length,
      closed,
      labelIds: [] as string[],
    };
  });
