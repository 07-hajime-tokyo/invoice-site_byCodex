import { and, desc, eq } from "drizzle-orm";
import {
  workLogs,
  workLogWorkers,
  workLogCategories,
} from "../../drizzle/schema";
import { getDb } from "./db";

export function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db;
}

export async function ensureOptions(workerName: string, category: string) {
  const db = await requireDb();
  await db
    .insert(workLogWorkers)
    .ignore()
    .values({ name: workerName, sortOrder: 100 });
  await db
    .insert(workLogCategories)
    .ignore()
    .values({ name: category, sortOrder: 100 });
}

function mergeDetailsJson(
  existing: string | null | undefined,
  incoming: string | null | undefined
) {
  if (!incoming?.trim()) return existing?.trim() || null;
  if (!existing?.trim()) return incoming.trim();
  try {
    const existingData = JSON.parse(existing) as { items?: unknown[] };
    const incomingData = JSON.parse(incoming) as { items?: unknown[] };
    const existingItems = Array.isArray(existingData.items)
      ? existingData.items
      : [];
    const incomingItems = Array.isArray(incomingData.items)
      ? incomingData.items
      : [];
    return JSON.stringify({
      ...existingData,
      ...incomingData,
      items: [...existingItems, ...incomingItems],
    });
  } catch {
    return existing;
  }
}

function mergeSourceId(
  existing: string | null | undefined,
  incoming: string | null | undefined
) {
  const current = existing?.trim();
  const next = incoming?.trim();
  if (!next) return current || null;
  if (!current) return next.slice(0, 200);
  const parts = current.split(", ").filter(Boolean);
  if (!parts.includes(next)) parts.push(next);
  return parts.join(", ").slice(0, 200);
}

type RecordWorkLogInput = {
  workerName: string;
  category: string;
  status?: "running" | "done";
  startedAt?: Date | null;
  endedAt?: Date | null;
  manualMinutes?: number | null;
  quantity?: number;
  memo?: string | null;
  createdBy?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  detailsJson?: string | null;
};

export async function recordWorkLog(input: RecordWorkLogInput) {
  const db = await requireDb();
  const workerName = cleanText(input.workerName || "野田");
  const category = cleanText(input.category || "その他");
  await ensureOptions(workerName, category);
  const status = input.status ?? "done";
  const sourceType = input.sourceType?.trim() || null;
  const sourceId = input.sourceId?.trim() || null;
  const detailsJson = input.detailsJson?.trim() || null;

  if (status === "done" && sourceType) {
    const [runningLog] = await db
      .select()
      .from(workLogs)
      .where(
        and(
          eq(workLogs.workerName, workerName),
          eq(workLogs.category, category),
          eq(workLogs.status, "running")
        )
      )
      .orderBy(desc(workLogs.startedAt), desc(workLogs.id))
      .limit(1);

    if (runningLog) {
      await db
        .update(workLogs)
        .set({
          quantity: Number(runningLog.quantity ?? 0) + (input.quantity ?? 0),
          memo: runningLog.memo || input.memo?.trim() || null,
          sourceType: runningLog.sourceType?.trim() || sourceType,
          sourceId: mergeSourceId(runningLog.sourceId, sourceId),
          detailsJson: mergeDetailsJson(runningLog.detailsJson, detailsJson),
        })
        .where(eq(workLogs.id, runningLog.id));
      return;
    }
  }

  await db.insert(workLogs).values({
    workerName,
    category,
    status,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    manualMinutes: input.manualMinutes ?? null,
    quantity: input.quantity ?? 0,
    memo: input.memo?.trim() || null,
    createdBy: input.createdBy?.trim() || null,
    sourceType,
    sourceId,
    detailsJson,
  });
}
