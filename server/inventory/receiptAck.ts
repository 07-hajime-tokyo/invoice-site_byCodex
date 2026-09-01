import { and, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { actionItemAssignees, actionItems, localPurchases } from "../../drizzle/schema";
import type { AppDatabase } from "../_core/database";
import { getDb, getSystemSetting, setSystemSetting } from "./db";
import {
  RECEIPT_ACK_SITES,
  classifyReceiptAckUrl,
  parseReceiptAckTarget,
  receiptAckItemKey,
  receiptAckSiteCompletesMissingItems,
  resolveMissingReceiptAckTargetStatus,
  resolveReceiptAckStatusFromCrawlItem,
  type ReceiptAckSite,
  type ReceiptAckStatus,
} from "@shared/receiptAck";

const PENDING_TASK_SOURCE_KEY = "receipt-ack-pending";
const CRAWL_FAILED_TASK_SOURCE_KEY = "receipt-ack-crawl-failed";
const STALE_TASK_SOURCE_KEY = "receipt-ack-stale";
const LAST_CRAWLED_SETTING_KEY = "receiptAckLastCrawledAt";
const RECEIPT_ACK_ASSIGNEE = "野田さん";
const DEFAULT_RECEIPT_ACK_STALE_HOURS = 36;

const receiptAckCrawlItemSchema = z
  .object({
    itemId: z.string().min(1),
    status: z.string().min(1),
    isStore: z.boolean().optional(),
  })
  .passthrough();

const receiptAckSiteResultSchema = z
  .object({
    site: z.enum(RECEIPT_ACK_SITES),
    ok: z.boolean(),
    error: z.string().max(500).optional().nullable(),
    items: z.array(receiptAckCrawlItemSchema).optional().default([]),
  })
  .passthrough();

export const receiptAckIngestSchema = z
  .object({
    crawledAt: z.string().optional(),
    sites: z.array(receiptAckSiteResultSchema),
  })
  .passthrough();

type ReceiptAckIngestPayload = z.infer<typeof receiptAckIngestSchema>;
type LocalPurchaseRow = typeof localPurchases.$inferSelect;
type ReceiptAckSource = "crawl" | "manual";

type ReceiptAckTaskRow = Pick<
  LocalPurchaseRow,
  "id" | "title" | "managementNo" | "supplierName" | "supplierUrl" | "receivedDate" | "receiptAckSource" | "receiptAckNote"
>;

type ReceiptAckUpdate = {
  status: ReceiptAckStatus;
  source: ReceiptAckSource;
  at: Date;
  note: string | null;
};

export type ReceiptAckFailedSite = {
  site: ReceiptAckSite;
  error: string | null;
  affected: number;
};

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function cleanNote(value: unknown) {
  const text = cleanText(value);
  return text ? text.slice(0, 255) : null;
}

function getReceiptAckStartDate() {
  const raw = cleanText(process.env.RECEIPT_ACK_START_DATE);
  if (!raw) return null;
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function getReceiptAckStaleHours() {
  const value = Number(process.env.RECEIPT_ACK_STALE_HOURS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_RECEIPT_ACK_STALE_HOURS;
}

function asCrawledAt(value: string | undefined) {
  if (!value) return new Date();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

export function isReceiptAckStale(lastCrawledAt: string | Date | null | undefined, staleHours: number, now = new Date()) {
  if (!lastCrawledAt) return true;
  const last = lastCrawledAt instanceof Date ? lastCrawledAt : new Date(lastCrawledAt);
  if (Number.isNaN(last.getTime()) || Number.isNaN(now.getTime())) return true;
  return now.getTime() - last.getTime() > staleHours * 60 * 60 * 1000;
}

export function collectReceiptAckFailedSites(sites: Array<{ site: ReceiptAckSite; ok: boolean; error?: string | null }>) {
  const failedSites = new Map<ReceiptAckSite, ReceiptAckFailedSite>();
  for (const siteResult of sites) {
    if (siteResult.ok) continue;
    failedSites.set(siteResult.site, {
      site: siteResult.site,
      error: cleanNote(siteResult.error),
      affected: 0,
    });
  }
  return failedSites;
}

function incrementFailedSiteAffected(failedSites: Map<ReceiptAckSite, ReceiptAckFailedSite>, site: ReceiptAckSite) {
  const current = failedSites.get(site);
  if (current) {
    current.affected += 1;
    return;
  }
  failedSites.set(site, { site, error: null, affected: 1 });
}

function receiptAckValuesEqual(row: LocalPurchaseRow, next: ReceiptAckUpdate) {
  return row.receiptAckStatus === next.status && row.receiptAckSource === next.source && cleanText(row.receiptAckNote) === cleanText(next.note);
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db;
}

async function listReceiptAckCandidatePurchases(db: AppDatabase, startDate: string) {
  return db
    .select()
    .from(localPurchases)
    .where(and(eq(localPurchases.status, "purchased"), gte(localPurchases.receivedDate, startDate)))
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

function buildSiteResultMaps(payload: ReceiptAckIngestPayload) {
  const siteResults = new Map<ReceiptAckSite, (typeof payload.sites)[number]>();
  const itemsBySite = new Map<ReceiptAckSite, Map<string, z.infer<typeof receiptAckCrawlItemSchema>>>();

  for (const siteResult of payload.sites) {
    siteResults.set(siteResult.site, siteResult);
    const itemMap = new Map<string, z.infer<typeof receiptAckCrawlItemSchema>>();
    for (const item of siteResult.items ?? []) {
      itemMap.set(receiptAckItemKey(siteResult.site, item.itemId), item);
    }
    itemsBySite.set(siteResult.site, itemMap);
  }

  return { siteResults, itemsBySite };
}

function deriveStatusFromIngest(row: LocalPurchaseRow, payload: ReceiptAckIngestPayload, maps: ReturnType<typeof buildSiteResultMaps>): ReceiptAckUpdate {
  const crawledAt = asCrawledAt(payload.crawledAt);
  const classification = classifyReceiptAckUrl(row.supplierUrl);

  if (classification.status === "not_required") {
    return {
      status: "not_required",
      source: "crawl",
      at: crawledAt,
      note: "対象外の仕入先URL",
    };
  }
  if (classification.status === "unknown") {
    return {
      status: "unknown",
      source: "crawl",
      at: crawledAt,
      note: "仕入先URLなし、または取引URLを判定できません",
    };
  }

  const { target } = classification;
  const siteResult = maps.siteResults.get(target.site);
  if (!siteResult) {
    return {
      status: "unknown",
      source: "crawl",
      at: crawledAt,
      note: "巡回結果に対象サイトがありません",
    };
  }
  if (!siteResult.ok) {
    return {
      status: resolveMissingReceiptAckTargetStatus(target.site, false),
      source: "crawl",
      at: crawledAt,
      note: cleanNote(siteResult.error) ?? "巡回に失敗しました",
    };
  }

  const item = maps.itemsBySite.get(target.site)?.get(receiptAckItemKey(target.site, target.itemId));
  if (item) {
    return {
      status: resolveReceiptAckStatusFromCrawlItem(target.site, item),
      source: "crawl",
      at: crawledAt,
      note: cleanNote(item.status),
    };
  }

  if (receiptAckSiteCompletesMissingItems(target.site)) {
    return {
      status: resolveMissingReceiptAckTargetStatus(target.site, true),
      source: "crawl",
      at: crawledAt,
      note: "未完了一覧に無いため完了扱い",
    };
  }

  return {
    status: resolveMissingReceiptAckTargetStatus(target.site, true),
    source: "crawl",
    at: crawledAt,
    note: "落札一覧に見つかりません",
  };
}

function purchaseLine(row: ReceiptAckTaskRow, prefix = "-") {
  const managementNo = cleanText(row.managementNo) || "管理番号なし";
  const title = cleanText(row.title) || "商品名不明";
  const supplier = cleanText(row.supplierName) || "仕入先不明";
  const receivedDate = cleanText(row.receivedDate) || "入庫日不明";
  return `${prefix} ${receivedDate} ${managementNo} ${title} / ${supplier}`;
}

function buildPendingTaskDetail(rows: ReceiptAckTaskRow[]) {
  const manualRevoked = rows.filter(row => row.receiptAckSource === "manual" || cleanText(row.receiptAckNote).includes("手動済み取消"));
  const lines = rows.slice(0, 80).map(row => {
    const marker = row.receiptAckSource === "manual" || cleanText(row.receiptAckNote).includes("手動済み取消") ? "- [手動済み取消]" : "-";
    return purchaseLine(row, marker);
  });

  return [
    `受取連絡が未実施の可能性がある入庫商品が ${rows.length} 件あります。`,
    manualRevoked.length > 0 ? `手動で済にした後、巡回で未実施に戻った商品が ${manualRevoked.length} 件あります。` : "",
    "",
    ...lines,
    rows.length > lines.length ? `- ほか ${rows.length - lines.length} 件` : "",
    "",
    "入庫履歴の受取連絡列から取引ページを開き、完了後に「済にする」を押してください。",
  ]
    .filter(line => line !== "")
    .join("\n");
}

export function buildCrawlFailedTaskDetail(failedSites: ReceiptAckFailedSite[]) {
  const lines = failedSites.map(item => {
    const affected = item.affected > 0 ? `${item.affected}件` : "影響件数不明";
    return `- ${item.site}: ${affected} / ${item.error || "エラー詳細なし"}`;
  });
  return [
    "受取連絡の巡回に失敗したサイトがあります。",
    "",
    ...lines,
    "",
    "対象サイトにログインできるか、巡回側の処理が止まっていないか確認してください。",
  ].join("\n");
}

export function buildStaleTaskDetail(lastCrawledAt: string | null, staleHours: number) {
  const parsed = lastCrawledAt ? new Date(lastCrawledAt) : null;
  const lastLine = parsed && !Number.isNaN(parsed.getTime()) ? `最後に届いた巡回: ${parsed.toISOString()}` : "まだ一度も巡回結果が届いていません。";
  return [
    `受取連絡の巡回結果が ${staleHours} 時間以上届いていません。`,
    lastLine,
    "",
    "巡回側の自動実行、ログイン状態、または受取連絡チェックの連携設定を確認してください。",
  ].join("\n");
}

async function ensureReceiptAckAssignee(db: AppDatabase) {
  await db.insert(actionItemAssignees).ignore().values({ name: RECEIPT_ACK_ASSIGNEE, sortOrder: 4 });
}

async function upsertAggregateActionItem(db: AppDatabase, sourceKey: string, title: string, detail: string, shouldOpen: boolean) {
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
        assignee: RECEIPT_ACK_ASSIGNEE,
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
    assignee: RECEIPT_ACK_ASSIGNEE,
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

  return upsertAggregateActionItem(db, PENDING_TASK_SOURCE_KEY, "受取連絡が未実施です", buildPendingTaskDetail(rows), rows.length > 0);
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
  const crawledAt = asCrawledAt(payload.crawledAt);
  await setSystemSetting(LAST_CRAWLED_SETTING_KEY, crawledAt.toISOString());
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
