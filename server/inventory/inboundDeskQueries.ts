import { TRPCError } from "@trpc/server";
import { and, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import {
  actionItems,
  fulfillmentSnapshots,
  inventoryItemLabels,
  localInventories,
  localPurchases,
  purchaseHistories,
  workLogs,
} from "../../drizzle/schema";
import { protectedProcedure } from "../_core/trpc";
import { getAllPurchaseExtras } from "./db";
import {
  requireDb,
  operatorName,
  splitSourceIds,
  normalizeStatus,
  InspectionOutcome,
} from "./inboundDeskData";

export const inboundReceivedLabelIdsOnProcedure = protectedProcedure
  .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
  .query(async ({ input }) => {
    const db = await requireDb();
    const start = new Date(`${input.date}T00:00:00+09:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    if (Number.isNaN(start.getTime())) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "日付の形式が不正です",
      });
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
  });

export const inboundReceivedLabelsOnProcedure = protectedProcedure
  .input(z.object({ date: z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/) }))
  .query(async ({ input }) => {
    const db = await requireDb();
    const start = new Date(`${input.date}T00:00:00+09:00`);
    if (Number.isNaN(start.getTime())) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "日付の形式が不正です",
      });
    }
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const [rows, purchases, inventories] = await Promise.all([
      db
        .select()
        .from(inventoryItemLabels)
        .where(
          and(
            gte(inventoryItemLabels.receivedAt, start),
            lt(inventoryItemLabels.receivedAt, end)
          )
        ),
      db.select().from(localPurchases),
      db.select().from(localInventories),
    ]);
    const purchaseById = new Map(purchases.map(row => [row.id, row]));
    const inventoryById = new Map(inventories.map(row => [row.id, row]));
    return {
      date: input.date,
      labels: rows
        .filter(row => Boolean(row.labelId?.trim()))
        .map(row => {
          const purchase = row.purchaseId
            ? (purchaseById.get(row.purchaseId) ?? null)
            : null;
          const inventory = row.localInventoryId
            ? (inventoryById.get(row.localInventoryId) ?? null)
            : null;
          return {
            labelId: row.labelId.trim().toUpperCase(),
            status: String(row.status ?? ""),
            title: row.title || inventory?.title || purchase?.title || "",
            legacyManagementNo:
              row.legacyManagementNo || purchase?.managementNo || "",
            assignedInvoiceNo: row.assignedInvoiceNo ?? null,
            category: inventory?.category || purchase?.category || "",
            receivedAt: row.receivedAt?.toISOString() ?? null,
          };
        })
        .sort((a, b) =>
          a.legacyManagementNo.localeCompare(b.legacyManagementNo, "ja", {
            numeric: true,
          })
        ),
    };
  });

export const inboundDailyActivityProcedure = protectedProcedure
  .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
  .query(async ({ input }) => {
    const db = await requireDb();
    const start = new Date(`${input.date}T00:00:00+09:00`);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    const logs = await db
      .select({
        id: workLogs.id,
        workerName: workLogs.workerName,
        category: workLogs.category,
        sourceType: workLogs.sourceType,
        sourceId: workLogs.sourceId,
        detailsJson: workLogs.detailsJson,
        createdAt: workLogs.createdAt,
      })
      .from(workLogs)
      .where(
        and(
          gte(workLogs.createdAt, start),
          lt(workLogs.createdAt, end),
          inArray(workLogs.sourceType, [
            "inbound-receipt",
            "inbound-inspection",
          ])
        )
      )
      .orderBy(workLogs.createdAt);

    const labelIds = Array.from(
      new Set(
        logs.map(log => log.sourceId).filter((id): id is string => Boolean(id))
      )
    );
    const labelRows = labelIds.length
      ? await db
          .select({
            labelId: inventoryItemLabels.labelId,
            title: inventoryItemLabels.title,
            legacyManagementNo: inventoryItemLabels.legacyManagementNo,
          })
          .from(inventoryItemLabels)
          .where(inArray(inventoryItemLabels.labelId, labelIds))
      : [];
    const titleByLabelId = new Map(
      labelRows.map(row => [
        row.labelId,
        { title: row.title, legacyManagementNo: row.legacyManagementNo },
      ])
    );

    const outcomeLabels: Record<string, string> = {
      stocked: "動作確認OK",
      defective: "不良在庫",
      junk: "ジャンク売り",
      returned: "仕入先返品",
    };

    const entries = logs.map(log => {
      let outcome: string | null = null;
      let requestReplacement: boolean | null = null;
      if (log.detailsJson) {
        try {
          const parsed = JSON.parse(log.detailsJson) as {
            outcome?: string;
            requestReplacement?: boolean;
          };
          outcome = parsed.outcome
            ? (outcomeLabels[parsed.outcome] ?? parsed.outcome)
            : null;
          requestReplacement = parsed.requestReplacement ?? null;
        } catch {
          // 壊れた記録は無視して一覧を止めない
        }
      }
      const meta = log.sourceId ? titleByLabelId.get(log.sourceId) : undefined;
      return {
        id: log.id,
        kind:
          log.sourceType === "inbound-receipt"
            ? ("receipt" as const)
            : ("inspection" as const),
        labelId: log.sourceId ?? "",
        title: meta?.title ?? "",
        legacyManagementNo: meta?.legacyManagementNo ?? "",
        worker: log.workerName,
        outcome,
        requestReplacement,
        at: log.createdAt?.toISOString() ?? null,
      };
    });

    return {
      date: input.date,
      receipts: entries.filter(entry => entry.kind === "receipt"),
      inspections: entries.filter(entry => entry.kind === "inspection"),
    };
  });

export const inboundSaveFulfillmentSnapshotProcedure = protectedProcedure
  .input(
    z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      rollups: z.array(z.record(z.string(), z.unknown())).max(200),
    })
  )
  .mutation(async ({ input, ctx }) => {
    const db = await requireDb();
    const capturedBy = operatorName(undefined, ctx.user.name ?? ctx.user.email);
    const rollupsJson = JSON.stringify(input.rollups);
    await db
      .insert(fulfillmentSnapshots)
      .values({ snapshotDate: input.date, rollupsJson, capturedBy })
      .onDuplicateKeyUpdate({ set: { rollupsJson, capturedBy } });
    return { date: input.date, count: input.rollups.length };
  });

export const inboundFulfillmentSnapshotDatesProcedure =
  protectedProcedure.query(async () => {
    const db = await requireDb();
    const rows = await db
      .select({ snapshotDate: fulfillmentSnapshots.snapshotDate })
      .from(fulfillmentSnapshots)
      .orderBy(desc(fulfillmentSnapshots.snapshotDate))
      .limit(120);
    return rows.map(row => row.snapshotDate);
  });

export const inboundFulfillmentSnapshotProcedure = protectedProcedure
  .input(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
  .query(async ({ input }) => {
    const db = await requireDb();
    const [row] = await db
      .select()
      .from(fulfillmentSnapshots)
      .where(eq(fulfillmentSnapshots.snapshotDate, input.date))
      .limit(1);
    if (!row) return null;
    try {
      return {
        date: row.snapshotDate,
        capturedBy: row.capturedBy,
        savedAt: row.updatedAt?.toISOString() ?? null,
        rollups: JSON.parse(row.rollupsJson) as unknown[],
      };
    } catch {
      return null;
    }
  });

export const inboundSnapshotProcedure = protectedProcedure.query(async () => {
  const db = await requireDb();
  const [
    labels,
    purchases,
    purchaseExtras,
    inventories,
    countedLogs,
    inspectionLogs,
    replacementTasks,
    receivedHistoryRows,
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
    // 入庫履歴が1件でもあれば、その在庫はもう届いている。
    db
      .select({ inventoryId: purchaseHistories.inventoryId })
      .from(purchaseHistories)
      .where(eq(purchaseHistories.cancelled, 0)),
  ]);
  const receivedInventoryIds = new Set(
    receivedHistoryRows
      .map(row => Number(row.inventoryId))
      .filter(value => Number.isFinite(value) && value > 0)
  );

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
        const photos = JSON.parse(label.defectPhotosJson ?? "[]") as unknown[];
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
      assignedInvoiceNo: label.assignedInvoiceNo ?? null,
      purchaseId: label.purchaseId ?? purchase?.id ?? null,
      localInventoryId: label.localInventoryId ?? null,
      trackingNumber:
        purchase?.trackingNumber?.trim() ||
        purchaseExtra?.trackingNumber?.trim() ||
        "",
      /**
       * 仕入れ行として入庫済みか。
       *
       * ラベルの status="ordered" は「発注済み・未着」ではなく
       * 「この個体はまだ荷受けスキャンを通っていない」という意味しかない。
       * ゴルフ系のように荷受け画面を通さない運用だと、入庫しても売れても ordered のまま残る。
       * 到着予定の判定には使えないので、仕入れ行の入庫状態を別に持たせる。
       * 判定は発注登録の「未入庫／入庫済み」と同じ基準にそろえてある。
       */
      purchaseReceived:
        purchase?.status === "purchased" ||
        Boolean(purchase?.receivedDate) ||
        (label.localInventoryId != null &&
          receivedInventoryIds.has(Number(label.localInventoryId))),
      /** 仕入先が発送した日。古いまま残っている行を見分けるために出す。 */
      shipDate:
        purchase?.shipDate?.trim() || purchaseExtra?.shipDate?.trim() || "",
      /** 追跡番号を登録した日時。発送日が入っていないときの手掛かりにする。 */
      trackingRegisteredAt: purchaseExtra?.updatedAt?.toISOString() ?? null,
      /**
       * 発注として存在するか。
       *
       * 2026-08-07 に既存在庫へ一括でラベルを発行したぶんは、対応する仕入れ行が無い。
       * 発注していないのだから届くこともない。到着予定にも未登録一覧にも出さない。
       */
      purchaseLinked: Boolean(purchase),
      carrier:
        purchase?.carrier?.trim() || purchaseExtra?.carrier?.trim() || "",
      supplierName: purchase?.supplierName ?? inventory?.supplierName ?? "",
      category: inventory?.category ?? purchase?.category ?? "",
      receivedAt: label.receivedAt?.toISOString() ?? null,
      updatedAt: label.updatedAt.toISOString(),
      inventoryCounted: countedLabelIds.has(label.labelId.trim().toUpperCase()),
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
      details.labelId?.trim().toUpperCase() || splitSourceIds(log.sourceId)[0];
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
});
