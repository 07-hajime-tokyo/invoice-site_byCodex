import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  actionItems,
  inventoryItemLabels,
  localInventories,
  localPurchases,
  outboundBoxes,
  workLogs,
} from "../../drizzle/schema";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createPurchaseHistory,
  getAllPurchaseExtras,
  getDb,
  getLocalInventoryById,
  getLocalPurchaseById,
  updateLocalInventory,
  updateLocalPurchaseStatus,
} from "./db";
import { recordWorkLog } from "./workLogs";
import {
  DEFECT_PHOTO_KINDS,
  DEFECT_TAGS,
  type DefectPhoto,
} from "./defectiveListing";
import { uploadDefectivePhotos } from "./defectivePhotos";
import { syncDefectiveListingByLabelId } from "./defectiveSync";
import {
  createDefectiveGroup,
  dissolveDefectiveGroup,
  listDefectiveGroups,
  syncDefectiveGroup,
} from "./defectiveGroups";

type InspectionOutcome = "stocked" | "defective" | "returned";

export const inboundInspectionInputSchema = z
  .object({
    labelId: z.string().min(1).max(80),
    outcome: z.enum(["stocked", "defective", "returned"]),
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
    if (value.outcome === "defective" && !value.defectTags?.length) {
      context.addIssue({
        code: "custom",
        path: ["defectTags"],
        message: "不良時は不良タグを1つ以上選んでください",
      });
    }
  });

export const restockToDefectiveInputSchema = z.object({
  labelId: z.string().min(1).max(80),
  operatorName: z.string().max(200).optional(),
  defectTags: z.array(z.enum(DEFECT_TAGS)).min(1).max(9),
  defectNote: z.string().max(500).optional(),
  defectPhotos: z.array(z.object({
    url: z.string().url().max(2_000),
    key: z.string().min(1).max(512),
    kind: z.enum(DEFECT_PHOTO_KINDS),
  })).max(10).optional(),
});

export function restockToDefectiveBlockReason(input: {
  status: string;
  boxStatus?: string | null;
  boxCode?: string | null;
  alreadyDefective?: boolean;
}): string | null {
  const status = normalizeStatus(input.status);
  if (input.boxStatus === "shipped") {
    return `${input.boxCode ?? "箱"} の追跡番号を解除し、封を解いてから不良在庫へ移してください`;
  }
  if (input.boxStatus === "sealed") {
    return `${input.boxCode ?? "箱"} の封を解いてから不良在庫へ移してください`;
  }
  if (input.boxStatus === "open") {
    return `${input.boxCode ?? "箱"} から個体を取り出してから不良在庫へ移してください`;
  }
  if (status === "shipped") {
    return "出荷済みの個体は本操作の対象外です。返品フローで処理してください";
  }
  if (input.alreadyDefective) return "この個体は既に不良在庫として登録済みです";
  if (status !== "stocked") return `在庫化済み（stocked）の個体だけ変更できます。現在: ${input.status}`;
  return null;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function invoiceAllocation(managementNo: string | null | undefined) {
  const normalized = String(managementNo ?? "")
    .normalize("NFKC")
    .trim();
  const match = normalized.match(/^(\d{3})(?:_|$)/);
  if (!match) return { invoiceNo: null, partner: null };
  const partner = normalized.split("_")[1]?.trim() || null;
  return { invoiceNo: match[1], partner };
}

function splitSourceIds(value: string | null | undefined): string[] {
  return String(value ?? "")
    .split(", ")
    .map(part => part.trim().toUpperCase())
    .filter(Boolean);
}

function operatorName(
  inputName: string | undefined,
  fallback: string | null | undefined
) {
  return inputName?.trim() || fallback?.trim() || "野田";
}

async function requireDb() {
  const db = await getDb();
  if (!db)
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Database not available",
    });
  return db;
}

async function findPurchaseForLabel(
  label: typeof inventoryItemLabels.$inferSelect
) {
  if (label.purchaseId) {
    const purchase = await getLocalPurchaseById(label.purchaseId);
    if (purchase) return purchase;
  }
  if (!label.localInventoryId) return null;
  const db = await requireDb();
  const purchases = await db
    .select()
    .from(localPurchases)
    .where(eq(localPurchases.localInventoryId, label.localInventoryId));
  const managementNo = String(label.legacyManagementNo ?? "").trim();
  return (
    purchases.find(
      purchase => String(purchase.managementNo ?? "").trim() === managementNo
    ) ??
    purchases[0] ??
    null
  );
}

async function labelWasAlreadyCounted(labelId: string): Promise<boolean> {
  const db = await requireDb();
  const logs = await db
    .select({ sourceId: workLogs.sourceId })
    .from(workLogs)
    .where(eq(workLogs.sourceType, "purchase-label"));
  const normalized = labelId.trim().toUpperCase();
  return logs.some(log => splitSourceIds(log.sourceId).includes(normalized));
}

async function markPurchaseReceivedIfComplete(purchaseId: number | null) {
  if (!purchaseId) return;
  const db = await requireDb();
  const labels = await db
    .select({ status: inventoryItemLabels.status })
    .from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.purchaseId, purchaseId));
  if (labels.length === 0) return;
  const complete = labels.every(label =>
    ["received", "stocked", "shipped", "returned", "cancelled"].includes(
      normalizeStatus(label.status)
    )
  );
  if (complete)
    await updateLocalPurchaseStatus(
      purchaseId,
      "purchased",
      new Date().toISOString().slice(0, 10)
    );
}

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

export async function createDefectiveInventory(input: {
  label: typeof inventoryItemLabels.$inferSelect;
  sourceInventory: typeof localInventories.$inferSelect;
}, executor?: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "insert">) {
  const db = executor ?? await requireDb();
  const [result] = await db.insert(localInventories).values({
    zaicoId: null,
    title: input.label.title || input.sourceInventory.title,
    category: "不良在庫",
    place: input.sourceInventory.place,
    quantity: 1,
    unit: input.sourceInventory.unit,
    unitPrice: input.sourceInventory.unitPrice,
    etc: `在庫_不良_${input.label.labelId}`,
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
      message: "不良在庫を作成できませんでした",
    });
  return inventoryId;
}

async function recordInspection(input: {
  labelId: string;
  outcome: InspectionOutcome;
  workerName: string;
  actionItemId: number | null;
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
      defectTags: input.defectTags ?? [],
      photoCount: input.photoCount ?? 0,
    }),
  });
}

async function loadRestockCandidate(labelId: string) {
  const db = await requireDb();
  const normalizedId = labelId.trim().toUpperCase();
  const [label] = await db.select().from(inventoryItemLabels)
    .where(eq(inventoryItemLabels.labelId, normalizedId)).limit(1);
  if (!label) return null;
  const [inventory] = label.localInventoryId
    ? await db.select().from(localInventories)
        .where(eq(localInventories.id, label.localInventoryId)).limit(1)
    : [];
  const [box] = label.outboundBoxId
    ? await db.select().from(outboundBoxes)
        .where(eq(outboundBoxes.id, label.outboundBoxId)).limit(1)
    : [];
  const reason = restockToDefectiveBlockReason({
    status: label.status,
    boxStatus: box?.status,
    boxCode: box?.boxCode,
    alreadyDefective: Boolean(label.defectRecordedAt),
  });
  return {
    label,
    inventory: inventory ?? null,
    box: box ?? null,
    eligible: !reason,
    reason,
  };
}

export const inboundDeskRouter = router({
  defectiveGroups: protectedProcedure.query(() => listDefectiveGroups()),

  createDefectiveGroup: protectedProcedure
    .input(z.object({
      labelIds: z.array(z.string().min(1).max(80)).min(2).max(50),
      operatorName: z.string().max(200).optional(),
    }))
    .mutation(({ input, ctx }) => createDefectiveGroup(
      input.labelIds,
      operatorName(input.operatorName, ctx.user.name ?? ctx.user.email),
    )),

  syncDefectiveGroup: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => syncDefectiveGroup(input.id)),

  dissolveDefectiveGroup: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(({ input }) => dissolveDefectiveGroup(input.id)),

  listRestockCandidates: protectedProcedure.query(async () => {
    const db = await requireDb();
    const labels = await db.select({ labelId: inventoryItemLabels.labelId })
      .from(inventoryItemLabels)
      .where(eq(inventoryItemLabels.status, "stocked"));
    const candidates = await Promise.all(labels.map(row => loadRestockCandidate(row.labelId)));
    return candidates.filter(candidate => candidate && !candidate.label.defectRecordedAt);
  }),

  lookupRestockCandidate: protectedProcedure
    .input(z.object({ labelId: z.string().min(1).max(80) }))
    .query(async ({ input }) => loadRestockCandidate(input.labelId)),

  snapshot: protectedProcedure.query(async () => {
    const db = await requireDb();
    const [
      labels,
      purchases,
      purchaseExtras,
      inventories,
      countedLogs,
      inspectionLogs,
      replacementTasks,
    ] = await Promise.all([
      db
        .select()
        .from(inventoryItemLabels)
        .orderBy(desc(inventoryItemLabels.updatedAt)),
      db.select().from(localPurchases),
      getAllPurchaseExtras(),
      db.select().from(localInventories),
      db
        .select({ sourceId: workLogs.sourceId })
        .from(workLogs)
        .where(eq(workLogs.sourceType, "purchase-label")),
      db
        .select()
        .from(workLogs)
        .where(eq(workLogs.sourceType, "inbound-inspection"))
        .orderBy(desc(workLogs.endedAt), desc(workLogs.id))
        .limit(30),
      db
        .select()
        .from(actionItems)
        .where(eq(actionItems.source, "inbound-inspection"))
        .orderBy(desc(actionItems.createdAt), desc(actionItems.id))
        .limit(30),
    ]);

    const purchaseById = new Map(
      purchases.map(purchase => [purchase.id, purchase])
    );
    const purchaseExtraById = new Map(
      purchaseExtras.map(extra => [extra.zaicoId, extra])
    );
    const inventoryById = new Map(
      inventories.map(inventory => [inventory.id, inventory])
    );
    const countedLabelIds = new Set(
      countedLogs.flatMap(log => splitSourceIds(log.sourceId))
    );
    const fallbackPurchase = (label: (typeof labels)[number]) => {
      if (label.purchaseId && purchaseById.has(label.purchaseId))
        return purchaseById.get(label.purchaseId) ?? null;
      if (!label.localInventoryId) return null;
      const managementNo = String(label.legacyManagementNo ?? "").trim();
      return (
        purchases.find(
          purchase =>
            purchase.localInventoryId === label.localInventoryId &&
            (!managementNo ||
              String(purchase.managementNo ?? "").trim() === managementNo)
        ) ??
        purchases.find(
          purchase => purchase.localInventoryId === label.localInventoryId
        ) ??
        null
      );
    };
    const labelView = (label: (typeof labels)[number]) => {
      const purchase = fallbackPurchase(label);
      const purchaseExtra = purchase
        ? (purchaseExtraById.get(purchase.id) ??
          (purchase.zaicoId
            ? purchaseExtraById.get(purchase.zaicoId)
            : undefined) ??
          (purchase.localInventoryId
            ? purchaseExtraById.get(purchase.localInventoryId)
            : undefined) ??
          null)
        : null;
      const inventory = label.localInventoryId
        ? (inventoryById.get(label.localInventoryId) ?? null)
        : null;
      const market = (() => {
        try {
          return JSON.parse(label.yahooClosedPricesJson ?? "null") as {
            keyword?: string;
            adopted?: { median?: number | null };
          } | null;
        } catch {
          return null;
        }
      })();
      const defectPhotos = (() => {
        try {
          const photos = JSON.parse(
            label.defectPhotosJson ?? "[]"
          ) as unknown[];
          return Array.isArray(photos) ? photos.length : 0;
        } catch {
          return 0;
        }
      })();
      return {
        labelId: label.labelId,
        status: normalizeStatus(label.status),
        title: label.title,
        legacyManagementNo:
          label.legacyManagementNo ?? purchase?.managementNo ?? "",
        purchaseId: label.purchaseId ?? purchase?.id ?? null,
        localInventoryId: label.localInventoryId ?? null,
        trackingNumber:
          purchase?.trackingNumber?.trim() ||
          purchaseExtra?.trackingNumber?.trim() ||
          "",
        carrier:
          purchase?.carrier?.trim() || purchaseExtra?.carrier?.trim() || "",
        supplierName: purchase?.supplierName ?? inventory?.supplierName ?? "",
        category: inventory?.category ?? purchase?.category ?? "",
        receivedAt: label.receivedAt?.toISOString() ?? null,
        updatedAt: label.updatedAt.toISOString(),
        inventoryCounted: countedLabelIds.has(
          label.labelId.trim().toUpperCase()
        ),
        defectTags: String(label.defectTags ?? "")
          .split(",")
          .map(tag => tag.trim())
          .filter(Boolean),
        defectNote: label.defectNote ?? "",
        defectPhotoCount: defectPhotos,
        marketKeyword: market?.keyword ?? "",
        marketMedian: market?.adopted?.median ?? null,
        marketFetchedAt: label.yahooPriceFetchedAt?.toISOString() ?? null,
        defectiveSheetSyncedAt:
          label.defectiveSheetSyncedAt?.toISOString() ?? null,
      };
    };
    const labelsById = new Map(
      labels.map(label => [label.labelId, labelView(label)])
    );
    const recent = inspectionLogs.flatMap(log => {
      const details = (() => {
        try {
          return JSON.parse(log.detailsJson ?? "{}") as {
            labelId?: string;
            outcome?: InspectionOutcome;
            actionItemId?: number | null;
          };
        } catch {
          return {};
        }
      })();
      const labelId =
        details.labelId?.trim().toUpperCase() ||
        splitSourceIds(log.sourceId)[0];
      const label = labelId ? labelsById.get(labelId) : null;
      if (!label || !details.outcome) return [];
      return [
        {
          ...label,
          outcome: details.outcome,
          actionItemId: details.actionItemId ?? null,
          processedAt: (
            log.endedAt ??
            log.updatedAt ??
            log.createdAt
          ).toISOString(),
          workerName: log.workerName,
        },
      ];
    });

    return {
      labels: Array.from(labelsById.values()),
      recent,
      actionItems: replacementTasks.map(item => ({
        id: item.id,
        title: item.title,
        assignee: item.assignee,
        detail: item.detail,
        status: item.status,
        sourceKey: item.sourceKey,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }),

  receive: protectedProcedure
    .input(
      z.object({
        labelIds: z.array(z.string().min(1).max(80)).min(1).max(100),
        operatorName: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const workerName = operatorName(
        input.operatorName,
        ctx.user.name ?? ctx.user.email
      );
      const uniqueIds = Array.from(
        new Set(input.labelIds.map(value => value.trim().toUpperCase()))
      );
      const received: string[] = [];
      const alreadyReceived: string[] = [];
      const notFound: string[] = [];
      const rejected: string[] = [];
      const purchaseIds = new Set<number>();

      for (const labelId of uniqueIds) {
        const [label] = await db
          .select()
          .from(inventoryItemLabels)
          .where(eq(inventoryItemLabels.labelId, labelId))
          .limit(1);
        if (!label) {
          notFound.push(labelId);
          continue;
        }
        const status = normalizeStatus(label.status);
        if (status === "received") {
          alreadyReceived.push(labelId);
          continue;
        }
        if (status !== "ordered") {
          rejected.push(labelId);
          continue;
        }
        const now = new Date();
        await db
          .update(inventoryItemLabels)
          .set({ status: "received", receivedAt: label.receivedAt ?? now })
          .where(eq(inventoryItemLabels.id, label.id));
        received.push(labelId);
        if (label.purchaseId) purchaseIds.add(label.purchaseId);
        await recordWorkLog({
          workerName,
          category: "荷受け",
          status: "done",
          startedAt: now,
          endedAt: now,
          quantity: 1,
          memo: `商品ID: ${labelId}`,
          createdBy: workerName,
          sourceType: "inbound-receipt",
          sourceId: labelId,
          detailsJson: JSON.stringify({ labelId }),
        });
      }
      for (const purchaseId of purchaseIds)
        await markPurchaseReceivedIfComplete(purchaseId);
      return { received, alreadyReceived, notFound, rejected };
    }),

  uploadDefectPhotos: protectedProcedure
    .input(
      z.object({
        labelId: z.string().min(1).max(80),
        files: z
          .array(
            z.object({
              base64: z
                .string()
                .min(1)
                .max(20 * 1024 * 1024),
              mimeType: z
                .string()
                .regex(/^image\//i)
                .max(100),
              kind: z.enum(DEFECT_PHOTO_KINDS),
            })
          )
          .max(10)
          .refine(
            files =>
              files.reduce((sum, file) => sum + file.base64.length, 0) <=
              45 * 1024 * 1024,
            "写真の合計サイズは45MB以下にしてください"
          ),
      })
    )
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const labelId = input.labelId.trim().toUpperCase();
      const [label] = await db
        .select({
          id: inventoryItemLabels.id,
          status: inventoryItemLabels.status,
          outboundBoxId: inventoryItemLabels.outboundBoxId,
          defectRecordedAt: inventoryItemLabels.defectRecordedAt,
        })
        .from(inventoryItemLabels)
        .where(eq(inventoryItemLabels.labelId, labelId))
        .limit(1);
      if (!label)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `商品ID ${labelId} が見つかりません`,
        });
      const candidate = await loadRestockCandidate(labelId);
      const status = normalizeStatus(label.status);
      if (status !== "received" && (status !== "stocked" || !candidate?.eligible))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: candidate?.reason ?? `${labelId} は検品待ち・在庫化済みのどちらでもありません`,
        });
      return { photos: await uploadDefectivePhotos(labelId, input.files) };
    }),

  refreshDefectiveListing: protectedProcedure
    .input(
      z.object({
        labelId: z.string().min(1).max(80),
        keyword: z.string().max(200).optional(),
      })
    )
    .mutation(async ({ input }) =>
      syncDefectiveListingByLabelId(input.labelId, { keyword: input.keyword })
    ),

  restockToDefective: protectedProcedure
    .input(restockToDefectiveInputSchema)
    .mutation(async ({ input, ctx }) => {
      const labelId = input.labelId.trim().toUpperCase();
      const candidate = await loadRestockCandidate(labelId);
      if (!candidate) {
        throw new TRPCError({ code: "NOT_FOUND", message: `商品ID ${labelId} が見つかりません` });
      }
      if (!candidate.eligible) {
        throw new TRPCError({ code: "BAD_REQUEST", message: candidate.reason ?? "不良在庫へ移せません" });
      }
      if (!candidate.inventory) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${labelId} に在庫情報が紐づいていません` });
      }
      const currentQuantity = Number(candidate.inventory.quantity ?? 0);
      if (currentQuantity < 1) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${labelId} の在庫数が0のため不良在庫へ移せません` });
      }
      const defectPhotos = (input.defectPhotos ?? []) as DefectPhoto[];
      const expectedPhotoPrefix = `defective/${labelId}/`;
      if (defectPhotos.some(photo => !photo.key.startsWith(expectedPhotoPrefix))) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "写真の商品IDと対象の商品IDが一致しません" });
      }

      const db = await requireDb();
      const now = new Date();
      const workerName = operatorName(input.operatorName, ctx.user.name ?? ctx.user.email);
      const defectiveInventoryId = await db.transaction(async tx => {
        const quantityUpdate = await tx.update(localInventories)
          .set({ quantity: sql`${localInventories.quantity} - 1` })
          .where(and(
            eq(localInventories.id, candidate.inventory!.id),
            gt(localInventories.quantity, 0),
          ));
        const quantityChanged = Number((quantityUpdate[0] as { affectedRows?: number }).affectedRows ?? 0) === 1;
        if (!quantityChanged) {
          throw new TRPCError({ code: "CONFLICT", message: `${labelId} の在庫数が既に変更されています。画面を更新してください` });
        }

        const inventoryId = await createDefectiveInventory({
          label: candidate.label,
          sourceInventory: candidate.inventory!,
        }, tx);
        const labelUpdate = await tx.update(inventoryItemLabels).set({
          status: "stocked",
          localInventoryId: inventoryId,
          outboundBoxId: null,
          shippedAt: null,
          defectTags: input.defectTags.join(","),
          defectNote: input.defectNote?.trim() || null,
          defectPhotosJson: JSON.stringify(defectPhotos),
          defectRecordedAt: now,
          defectiveSheetSyncedAt: null,
        }).where(and(
          eq(inventoryItemLabels.id, candidate.label.id),
          eq(inventoryItemLabels.status, "stocked"),
          isNull(inventoryItemLabels.outboundBoxId),
          isNull(inventoryItemLabels.defectRecordedAt),
        ));
        const labelChanged = Number((labelUpdate[0] as { affectedRows?: number }).affectedRows ?? 0) === 1;
        if (!labelChanged) {
          throw new TRPCError({ code: "CONFLICT", message: `${labelId} の状態が既に変更されています。画面を更新してください` });
        }
        return inventoryId;
      });
      const actionItemId = await insertInspectionActionItem({
        labelId,
        title: candidate.label.title,
        legacyManagementNo: candidate.label.legacyManagementNo,
        createdBy: workerName,
      });
      await recordWorkLog({
        workerName,
        category: "在庫から不良在庫へ変更",
        status: "done",
        startedAt: now,
        endedAt: now,
        quantity: 1,
        memo: `${labelId} / ${candidate.label.title}`,
        createdBy: workerName,
        sourceType: "restock-to-defective",
        sourceId: labelId,
        detailsJson: JSON.stringify({
          labelId,
          sourceInventoryId: candidate.inventory.id,
          defectiveInventoryId,
          defectTags: input.defectTags,
          photoCount: defectPhotos.length,
          actionItemId,
        }),
      });
      setImmediate(() => {
        void syncDefectiveListingByLabelId(labelId).catch(error => {
          console.error("[defective-listing] restock preparation failed", {
            labelId,
            error: error instanceof Error ? error.message : String(error),
          });
        });
      });
      return { labelId, defectiveInventoryId, actionItemId, listingPreparation: "queued" as const };
    }),

  inspect: protectedProcedure
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

      const sourceInventory = await getLocalInventoryById(
        label.localInventoryId
      );
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

      if (input.outcome === "stocked") {
        if (!counted) {
          await updateLocalInventory(sourceInventory.id, {
            quantity: currentQuantity + 1,
          });
          const historyZaicoId =
            purchase?.zaicoId ??
            purchase?.id ??
            sourceInventory.zaicoId ??
            sourceInventory.id;
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
          });
        }
        await db
          .update(inventoryItemLabels)
          .set({ status: "stocked", receivedAt: label.receivedAt ?? now })
          .where(eq(inventoryItemLabels.id, label.id));
      } else if (input.outcome === "defective") {
        const defectPhotos = (input.defectPhotos ?? []) as DefectPhoto[];
        const expectedPhotoPrefix = `defective/${labelId}/`;
        if (
          defectPhotos.some(photo => !photo.key.startsWith(expectedPhotoPrefix))
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "写真の商品IDと検品対象の商品IDが一致しません",
          });
        }
        if (counted && currentQuantity > 0) {
          await updateLocalInventory(sourceInventory.id, {
            quantity: currentQuantity - 1,
          });
        }
        nextInventoryId = await createDefectiveInventory({
          label,
          sourceInventory,
        });
        if (!counted) {
          const historyZaicoId =
            purchase?.zaicoId ??
            purchase?.id ??
            sourceInventory.zaicoId ??
            sourceInventory.id;
          await createPurchaseHistory({
            zaicoId: historyZaicoId,
            kanriNo: label.legacyManagementNo ?? purchase?.managementNo ?? null,
            title: label.title,
            category: "不良在庫",
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
          });
        }
        await db
          .update(inventoryItemLabels)
          .set({
            status: "stocked",
            localInventoryId: nextInventoryId,
            receivedAt: label.receivedAt ?? now,
            defectTags: input.defectTags!.join(","),
            defectNote: input.defectNote?.trim() || null,
            defectPhotosJson: JSON.stringify(defectPhotos),
            defectRecordedAt: now,
            defectiveSheetSyncedAt: null,
          })
          .where(eq(inventoryItemLabels.id, label.id));
        actionItemId = await insertInspectionActionItem({
          labelId,
          title: label.title,
          legacyManagementNo: label.legacyManagementNo,
          createdBy: workerName,
        });
      } else {
        if (counted && currentQuantity > 0) {
          await updateLocalInventory(sourceInventory.id, {
            quantity: currentQuantity - 1,
          });
        }
        await db
          .update(inventoryItemLabels)
          .set({ status: "returned", receivedAt: label.receivedAt ?? now })
          .where(eq(inventoryItemLabels.id, label.id));
      }

      await recordInspection({
        labelId,
        outcome: input.outcome,
        workerName,
        actionItemId,
        defectTags: input.defectTags,
        photoCount: input.defectPhotos?.length,
      });
      if (input.outcome === "defective") {
        setImmediate(() => {
          void syncDefectiveListingByLabelId(labelId).catch(error => {
            console.error(
              "[defective-listing] asynchronous preparation failed",
              {
                labelId,
                error: error instanceof Error ? error.message : String(error),
              }
            );
          });
        });
      }
      return {
        labelId,
        outcome: input.outcome,
        localInventoryId: nextInventoryId,
        actionItemId,
        inventoryCountChanged: input.outcome === "stocked" ? !counted : counted,
        listingPreparation: input.outcome === "defective" ? "queued" : null,
      };
    }),
});
