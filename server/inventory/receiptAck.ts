import { and, asc, desc, eq, gte, inArray, isNull, ne, or } from "drizzle-orm";
import { actionItemAssignees, actionItems, inventoryItemLabels, localPurchases } from "../../drizzle/schema";
import type { AppDatabase } from "../_core/database";
import { getDb, getSystemSetting, setSystemSetting } from "./db";
import { parseReceiptAckTarget } from "@shared/receiptAck";
import {
  buildCrawlFailedTaskDetail,
  buildPendingTaskDetail,
  buildSiteResultMaps,
  buildStaleTaskDetail,
  cleanNote,
  cleanText,
  collectReceiptAckFailedSites,
  deriveStatusFromIngest,
  getReceiptAckStaleHours,
  getReceiptAckStartDate,
  incrementFailedSiteAffected,
  isReceiptAckStale,
  receiptAckIngestSchema,
  receiptAckValuesEqual,
  type LocalPurchaseRow,
  type ReceiptAckFailedSite,
  type ReceiptAckTaskRow,
  type ReceiptAckUpdate,
} from "./receiptAckRules";

// 既存の外部参照（routers.ts / cron.ts / receiptAckIngest.ts / receiptAckDrive.ts / receiptAck.test.ts）の
// import 互換を維持するため、純粋規則を receiptAckRules.ts から再エクスポートする。
export {
  buildCrawlFailedTaskDetail,
  buildPendingTaskDetail,
  buildSiteResultMaps,
  buildStaleTaskDetail,
  collectReceiptAckFailedSites,
  deriveStatusFromIngest,
  isReceiptAckStale,
  receiptAckIngestSchema,
  resolveReceiptAckNoteFromCrawlItem,
  shouldRecheckReceiptAckCandidate,
} from "./receiptAckRules";
export type { ReceiptAckFailedSite } from "./receiptAckRules";

const PENDING_TASK_SOURCE_KEY = "receipt-ack-pending";
const CRAWL_FAILED_TASK_SOURCE_KEY = "receipt-ack-crawl-failed";
const STALE_TASK_SOURCE_KEY = "receipt-ack-stale";
const LAST_CRAWLED_SETTING_KEY = "receiptAckLastCrawledAt";
const RECEIPT_ACK_OPERATIONS_ASSIGNEE = "野田さん";
const RECEIPT_ACK_PENDING_ASSIGNEE = "荷受担当";

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db;
}

async function listReceiptAckCandidatePurchases(db: AppDatabase, startDate: string) {
  return db
    .select()
    .from(localPurchases)
    .where(
      and(
        eq(localPurchases.status, "purchased"),
        gte(localPurchases.receivedDate, startDate),
        or(
          isNull(localPurchases.receiptAckStatus),
          isNull(localPurchases.receiptAckSource),
          ne(localPurchases.receiptAckStatus, "done"),
          ne(localPurchases.receiptAckSource, "crawl")
        )
      )
    )
    .orderBy(desc(localPurchases.receivedDate), desc(localPurchases.createdAt))
    .limit(5000);
}

async function updateReceiptAckStatus(db: AppDatabase, row: LocalPurchaseRow, next: ReceiptAckUpdate) {
  if (receiptAckValuesEqual(row, next)) return false;
  await db
    .update(localPurchases)
    .set({
      receiptAckStatus: next.status,
      receiptAckSource: next.source,
      receiptAckAt: next.at,
      receiptAckNote: next.note,
    })
    .where(eq(localPurchases.id, row.id));
  return true;
}

async function attachReceiptAckTaskLegacyManagementNos(db: AppDatabase, rows: LocalPurchaseRow[]): Promise<ReceiptAckTaskRow[]> {
  const purchaseIds = rows.map(row => row.id).filter(id => Number.isFinite(id));
  if (purchaseIds.length === 0) return rows;

  const labels = await db
    .select({
      purchaseId: inventoryItemLabels.purchaseId,
      legacyManagementNo: inventoryItemLabels.legacyManagementNo,
    })
    .from(inventoryItemLabels)
    .where(inArray(inventoryItemLabels.purchaseId, purchaseIds))
    .orderBy(asc(inventoryItemLabels.id));

  const legacyByPurchaseId = new Map<number, string>();
  for (const label of labels) {
    const purchaseId = Number(label.purchaseId);
    const legacyManagementNo = cleanText(label.legacyManagementNo);
    if (purchaseId > 0 && legacyManagementNo && !legacyByPurchaseId.has(purchaseId)) {
      legacyByPurchaseId.set(purchaseId, legacyManagementNo);
    }
  }

  return rows.map(row => ({
    ...row,
    labelLegacyManagementNo: legacyByPurchaseId.get(row.id) ?? null,
  }));
}

async function ensureReceiptAckAssignee(db: AppDatabase) {
  await db.insert(actionItemAssignees).ignore().values({ name: RECEIPT_ACK_OPERATIONS_ASSIGNEE, sortOrder: 4 });
  await db.insert(actionItemAssignees).ignore().values({ name: RECEIPT_ACK_PENDING_ASSIGNEE, sortOrder: 2 });
}

async function upsertAggregateActionItem(
  db: AppDatabase,
  sourceKey: string,
  title: string,
  detail: string,
  shouldOpen: boolean,
  assignee = RECEIPT_ACK_OPERATIONS_ASSIGNEE
) {
  const existing = await db.select().from(actionItems).where(eq(actionItems.sourceKey, sourceKey));
  const openTasks = existing.filter(task => task.status === "open");

  if (!shouldOpen) {
    if (openTasks.length > 0) {
      await db
        .update(actionItems)
        .set({ status: "done", completedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(actionItems.sourceKey, sourceKey), eq(actionItems.status, "open")));
    }
    return 0;
  }

  const primary = openTasks[0];
  if (primary) {
    await db
      .update(actionItems)
      .set({
        title,
        assignee,
        detail,
        status: "open",
        source: "receipt-ack",
        sourceQuestion: "受取連絡の自動チェック",
        updatedAt: new Date(),
      })
      .where(eq(actionItems.id, primary.id));

    for (const duplicate of openTasks.slice(1)) {
      await db.update(actionItems).set({ status: "done", completedAt: new Date(), updatedAt: new Date() }).where(eq(actionItems.id, duplicate.id));
    }
    return 0;
  }

  await db.insert(actionItems).values({
    title,
    assignee,
    detail,
    status: "open",
    source: "receipt-ack",
    sourceKey,
    sourceQuestion: "受取連絡の自動チェック",
    createdBy: "receipt-ack",
  });
  return 1;
}

async function syncPendingReceiptAckActionItem(db: AppDatabase) {
  const startDate = getReceiptAckStartDate();
  if (!startDate) {
    return upsertAggregateActionItem(db, PENDING_TASK_SOURCE_KEY, "受取連絡が未実施です", "", false);
  }
  const rows = await db
    .select()
    .from(localPurchases)
    .where(and(eq(localPurchases.status, "purchased"), gte(localPurchases.receivedDate, startDate), eq(localPurchases.receiptAckStatus, "pending")))
    .orderBy(desc(localPurchases.receivedDate), desc(localPurchases.createdAt))
    .limit(500);

  const taskRows = await attachReceiptAckTaskLegacyManagementNos(db, rows);
  return upsertAggregateActionItem(
    db,
    PENDING_TASK_SOURCE_KEY,
    "受取連絡が未実施です",
    buildPendingTaskDetail(taskRows),
    rows.length > 0,
    RECEIPT_ACK_PENDING_ASSIGNEE
  );
}

async function syncCrawlFailedReceiptAckActionItem(db: AppDatabase, failedSites: ReceiptAckFailedSite[]) {
  return upsertAggregateActionItem(
    db,
    CRAWL_FAILED_TASK_SOURCE_KEY,
    "受取連絡の巡回に失敗しました",
    buildCrawlFailedTaskDetail(failedSites),
    failedSites.length > 0
  );
}

async function syncStaleReceiptAckActionItem(db: AppDatabase) {
  const startDate = getReceiptAckStartDate();
  if (!startDate) {
    return upsertAggregateActionItem(db, STALE_TASK_SOURCE_KEY, "受取連絡の巡回が届いていません", "", false);
  }
  const staleHours = getReceiptAckStaleHours();
  const lastCrawledAt = await getSystemSetting(LAST_CRAWLED_SETTING_KEY);
  return upsertAggregateActionItem(
    db,
    STALE_TASK_SOURCE_KEY,
    "受取連絡の巡回が届いていません",
    buildStaleTaskDetail(lastCrawledAt, staleHours),
    isReceiptAckStale(lastCrawledAt, staleHours)
  );
}

export async function ingestReceiptAckCrawlResult(rawPayload: unknown) {
  const payload = receiptAckIngestSchema.parse(rawPayload);
  const db = await requireDb();
  const startDate = getReceiptAckStartDate();
  if (!startDate) {
    const tasksCreated =
      (await syncPendingReceiptAckActionItem(db)) + (await syncCrawlFailedReceiptAckActionItem(db, [])) + (await syncStaleReceiptAckActionItem(db));
    return {
      ok: true,
      disabled: true,
      matched: 0,
      updated: 0,
      pending: 0,
      unknown: 0,
      unavailable: 0,
      revoked: 0,
      tasksCreated,
    };
  }

  await ensureReceiptAckAssignee(db);
  const receivedAt = new Date();
  await setSystemSetting(LAST_CRAWLED_SETTING_KEY, receivedAt.toISOString());
  const rows = await listReceiptAckCandidatePurchases(db, startDate);
  const maps = buildSiteResultMaps(payload);
  let matched = 0;
  let updated = 0;
  let pending = 0;
  let unknown = 0;
  let unavailable = 0;
  let revoked = 0;
  const unavailableBySite = collectReceiptAckFailedSites(payload.sites);

  for (const row of rows) {
    const target = parseReceiptAckTarget(row.supplierUrl);
    if (target) matched += 1;

    const derivedNext = deriveStatusFromIngest(row, payload, maps);
    const wasManualDoneRevoked = row.receiptAckStatus === "done" && row.receiptAckSource === "manual" && derivedNext.status === "pending";
    const next = wasManualDoneRevoked
      ? {
          ...derivedNext,
          note: cleanNote(`手動済み取消: ${derivedNext.note ?? "巡回で未実施として検出"}`),
        }
      : derivedNext;
    if (next.status === "pending") pending += 1;
    if (next.status === "unknown") unknown += 1;
    if (next.status === "unavailable") unavailable += 1;
    if (target && next.status === "unavailable") {
      incrementFailedSiteAffected(unavailableBySite, target.site);
    }

    if (wasManualDoneRevoked) {
      revoked += 1;
    }
    if (await updateReceiptAckStatus(db, row, next)) updated += 1;
  }

  const tasksCreated =
    (await syncPendingReceiptAckActionItem(db)) +
    (await syncCrawlFailedReceiptAckActionItem(db, Array.from(unavailableBySite.values()))) +
    (await syncStaleReceiptAckActionItem(db));

  return {
    ok: true,
    matched,
    updated,
    pending,
    unknown,
    unavailable,
    revoked,
    tasksCreated,
  };
}

export async function checkReceiptAckStale() {
  const db = await requireDb();
  await ensureReceiptAckAssignee(db);
  const startDate = getReceiptAckStartDate();
  const staleHours = getReceiptAckStaleHours();
  const lastCrawledAt = startDate ? await getSystemSetting(LAST_CRAWLED_SETTING_KEY) : null;
  const stale = startDate ? isReceiptAckStale(lastCrawledAt, staleHours) : false;
  const tasksCreated = await syncStaleReceiptAckActionItem(db);
  return {
    ok: true,
    enabled: Boolean(startDate),
    startDate,
    staleHours,
    lastCrawledAt,
    stale,
    tasksCreated,
  };
}

export async function markReceiptAckDone(purchaseId: number) {
  const db = await requireDb();
  await ensureReceiptAckAssignee(db);
  const rows = await db.select().from(localPurchases).where(eq(localPurchases.id, purchaseId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error("発注データが見つかりません");

  await db
    .update(localPurchases)
    .set({
      receiptAckStatus: "done",
      receiptAckSource: "manual",
      receiptAckAt: new Date(),
      receiptAckNote: "手動で受取連絡済みにしました",
    })
    .where(eq(localPurchases.id, purchaseId));

  const tasksCreated = await syncPendingReceiptAckActionItem(db);
  return { ok: true, purchaseId, tasksCreated };
}

export async function getReceiptAckSummary() {
  const db = await requireDb();
  const startDate = getReceiptAckStartDate();
  if (!startDate) {
    return {
      enabled: false,
      startDate: null,
      pending: 0,
      unknown: 0,
      unavailable: 0,
    };
  }
  const rows = await listReceiptAckCandidatePurchases(db, startDate);
  return {
    enabled: true,
    startDate,
    pending: rows.filter(row => row.receiptAckStatus === "pending").length,
    unknown: rows.filter(row => row.receiptAckStatus === "unknown").length,
    unavailable: rows.filter(row => row.receiptAckStatus === "unavailable").length,
  };
}
