import { TRPCError } from "@trpc/server";
import { and, desc, eq, gt, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  actionItems,
  inventoryItemLabels,
  localInventories,
  localPurchases,
  outboundBoxes,
  purchaseHistories,
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
  actionItemUndoDisposition,
  missingUndoRejection,
  normalizeUndoLabelIds,
  receiveUndoBlockReason,
  runClaimedUndo,
} from "./inboundUndo";
import {
  createDefectiveGroup,
  dissolveDefectiveGroup,
  listDefectiveGroups,
  syncDefectiveGroup,
} from "./defectiveGroups";

type InspectionOutcome = "stocked" | "defective" | "junk" | "returned";

export const inboundInspectionInputSchema = z
  .object({
    labelId: z.string().min(1).max(80),
    outcome: z.enum(["stocked", "defective", "junk", "returned"]),
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

function insertIdFromResult(result: unknown): number | null {
  const row = Array.isArray(result) ? result[0] : result;
  const value = Number((row as { insertId?: number } | null)?.insertId ?? 0);
  return value > 0 ? value : null;
}

function affectedRowsFromResult(result: unknown): number {
  const row = Array.isArray(result) ? result[0] : result;
  return Number((row as { affectedRows?: number } | null)?.affectedRows ?? 0);
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
  /** 不良在庫の仕分け先。ジャンク売りは在庫一覧で見分けられるよう別カテゴリにする */
  destination?: "defective" | "junk";
}, executor?: Pick<NonNullable<Awaited<ReturnType<typeof getDb>>>, "insert">) {
  const db = executor ?? await requireDb();
  const isJunk = input.destination === "junk";
  const [result] = await db.insert(localInventories).values({
    zaicoId: null,
    title: input.label.title || input.sourceInventory.title,
    category: isJunk ? "ジャンク売り" : "不良在庫",
    place: input.sourceInventory.place,
    quantity: 1,
    unit: input.sourceInventory.unit,
    unitPrice: input.sourceInventory.unitPrice,
    etc: `在庫_${isJunk ? "ジャンク" : "不良"}_${input.label.labelId}`,
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
      message: isJunk
        ? "ジャンク在庫を作成できませんでした"
        : "不良在庫を作成できませんでした",
    });
  return inventoryId;
}

async function recordInspection(input: {
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

type UndoKind = "receive" | "inspection";

type InspectionUndoMeta = {
  outcome: InspectionOutcome;
  sourceInventoryId: number;
  inspectionInventoryId: number;
  quantityDelta: number;
  purchaseHistoryId: number | null;
  actionItem: typeof actionItems.$inferSelect | null;
};

async function resolveInspectionUndoMeta(
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
  const outcome = (label.inspectionOutcome ?? details.outcome) as
    | InspectionOutcome
    | null;
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
    label.inspectionActionItemId ??
    details.actionItemId ??
    null;
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
    label.inspectionPurchaseHistoryId ??
    details.purchaseHistoryId ??
    null;
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

async function loadUndoPreview(kind: UndoKind, labelIds: string[]) {
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
    const alreadyUndone = status === "received" || Boolean(label.inspectionCancelledAt);
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

  /**
   * 指定日に荷受けした商品IDを返す。
   * 「荷受日」は配送伝票のバーコードを読んだ時点（receivedAt）で、入庫日（動作確認OKで作られる
   * 入庫履歴の日付）とは別物。実データで8日ずれていた例がある（2026-08-15）。
   * 日付の区切りは Asia/Tokyo。
   */
  receivedLabelIdsOn: protectedProcedure
    .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
    .query(async ({ input }) => {
      const db = await requireDb();
      const start = new Date(`${input.date}T00:00:00+09:00`);
      const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
      if (Number.isNaN(start.getTime())) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "日付の形式が不正です" });
      }
      const rows = await db
        .select({
          labelId: inventoryItemLabels.labelId,
          receivedAt: inventoryItemLabels.receivedAt,
        })
        .from(inventoryItemLabels)
        .where(
          and(
            gte(inventoryItemLabels.receivedAt, start),
            lt(inventoryItemLabels.receivedAt, end)
          )
        );
      return {
        date: input.date,
        labelIds: rows
          .map(row => row.labelId?.trim().toUpperCase())
          .filter((labelId): labelId is string => Boolean(labelId)),
      };
    }),

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
    const activeInspectionLabelIds = new Set(
      labels
        .filter(label => {
          const status = normalizeStatus(label.status);
          return (
            status !== "ordered" &&
            status !== "received" &&
            !label.inspectionCancelledAt
          );
        })
        .map(label => label.labelId)
    );
    const seenRecentLabelIds = new Set<string>();
    const recent = inspectionLogs.flatMap(log => {
      const details = (() => {
        try {
          return JSON.parse(log.detailsJson ?? "{}") as {
            labelId?: string;
            outcome?: InspectionOutcome;
            actionItemId?: number | null;
            requestReplacement?: boolean;
          };
        } catch {
          return {};
        }
      })();
      const labelId =
        details.labelId?.trim().toUpperCase() ||
        splitSourceIds(log.sourceId)[0];
      const label = labelId ? labelsById.get(labelId) : null;
      if (
        !label ||
        !details.outcome ||
        !activeInspectionLabelIds.has(label.labelId) ||
        seenRecentLabelIds.has(label.labelId)
      )
        return [];
      seenRecentLabelIds.add(label.labelId);
      return [
        {
          ...label,
          outcome: details.outcome,
          actionItemId: details.actionItemId ?? null,
          requestReplacement:
            details.requestReplacement ?? details.outcome === "defective",
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

  undoPreview: protectedProcedure
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
    }),

  undo: protectedProcedure
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
              base64: z.string().min(1).max(20 * 1024 * 1024),
              mimeType: z.string().regex(/^image\//i).max(100),
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
      if (
        status !== "received" &&
        (status !== "stocked" || !candidate?.eligible)
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            candidate?.reason ??
            `${labelId} は動作確認待ち・在庫化済みのどちらでもありません`,
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
      let purchaseHistoryId: number | null = null;
      let quantityDelta = 0;
      const requestReplacement =
        input.outcome === "stocked"
          ? false
          : (input.requestReplacement ?? input.outcome === "defective");
      const defectPhotos = (input.defectPhotos ?? []) as DefectPhoto[];
      if (
        (input.outcome === "defective" || input.outcome === "junk") &&
        defectPhotos.some(
          photo => !photo.key.startsWith(`defective/${labelId}/`)
        )
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
          purchaseHistoryId = insertIdFromResult(await createPurchaseHistory({
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
          }));
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
          purchaseHistoryId = insertIdFromResult(await createPurchaseHistory({
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
          }));
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
        listingPreparation:
          input.outcome === "defective" || input.outcome === "junk"
            ? "queued"
            : null,
      };
    }),
});
