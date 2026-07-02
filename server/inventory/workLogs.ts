import { z } from "zod";
import { asc, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import { workLogCategories, workLogs, workLogWorkers } from "../../drizzle/schema";
import { getDb } from "./db";

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parseOptionalDate(value: string | undefined | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error("日時の形式が正しくありません");
  return date;
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db;
}

async function ensureOptions(workerName: string, category: string) {
  const db = await requireDb();
  await db.insert(workLogWorkers).ignore().values({ name: workerName, sortOrder: 100 });
  await db.insert(workLogCategories).ignore().values({ name: category, sortOrder: 100 });
}

type WorkLogRow = typeof workLogs.$inferSelect;

function getStoredDurationMinutes(log: WorkLogRow) {
  if (typeof log.manualMinutes === "number") return Math.max(0, log.manualMinutes);
  if (log.startedAt && log.endedAt) {
    return Math.max(0, Math.round((log.endedAt.getTime() - log.startedAt.getTime()) / 60000));
  }
  return 0;
}

function subtractMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() - minutes * 60000);
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
  await db.insert(workLogs).values({
    workerName,
    category,
    status: input.status ?? "done",
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
    manualMinutes: input.manualMinutes ?? null,
    quantity: input.quantity ?? 0,
    memo: input.memo?.trim() || null,
    createdBy: input.createdBy?.trim() || null,
    sourceType: input.sourceType?.trim() || null,
    sourceId: input.sourceId?.trim() || null,
    detailsJson: input.detailsJson?.trim() || null,
  });
}

const workLogBaseInput = z.object({
  workerName: z.string().min(1).max(100),
  category: z.string().min(1).max(100),
  startedAt: z.string().max(80).optional(),
  endedAt: z.string().max(80).optional(),
  manualMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  quantity: z.number().int().min(0).max(100000).optional().default(0),
  memo: z.string().max(5000).optional(),
  sourceType: z.string().max(50).nullable().optional(),
  sourceId: z.string().max(200).nullable().optional(),
  detailsJson: z.string().max(30000).nullable().optional(),
});

const optionInput = z.object({
  name: z.string().min(1).max(100),
  sortOrder: z.number().int().min(0).max(10000).optional().default(100),
});

export const workLogsRouter = router({
  options: protectedProcedure.query(async () => {
    const db = await requireDb();
    const [workers, categories] = await Promise.all([
      db.select().from(workLogWorkers).orderBy(asc(workLogWorkers.sortOrder), asc(workLogWorkers.name)),
      db.select().from(workLogCategories).orderBy(asc(workLogCategories.sortOrder), asc(workLogCategories.name)),
    ]);
    return { workers, categories };
  }),

  addWorker: protectedProcedure
    .input(optionInput)
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.insert(workLogWorkers).ignore().values({ name: cleanText(input.name), sortOrder: input.sortOrder });
      return { success: true };
    }),

  updateWorker: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), name: z.string().min(1).max(100), sortOrder: z.number().int().min(0).max(10000).optional() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(workLogWorkers).set({
        name: cleanText(input.name),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      }).where(eq(workLogWorkers.id, input.id));
      return { success: true };
    }),

  deleteWorker: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(workLogWorkers).where(eq(workLogWorkers.id, input.id));
      return { success: true };
    }),

  addCategory: protectedProcedure
    .input(optionInput)
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.insert(workLogCategories).ignore().values({ name: cleanText(input.name), sortOrder: input.sortOrder });
      return { success: true };
    }),

  updateCategory: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), name: z.string().min(1).max(100), sortOrder: z.number().int().min(0).max(10000).optional() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(workLogCategories).set({
        name: cleanText(input.name),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      }).where(eq(workLogCategories.id, input.id));
      return { success: true };
    }),

  deleteCategory: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(workLogCategories).where(eq(workLogCategories.id, input.id));
      return { success: true };
    }),

  list: protectedProcedure
    .input(z.object({
      status: z.enum(["running", "done", "all"]).optional().default("all"),
      limit: z.number().int().min(1).max(500).optional().default(200),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const status = input?.status ?? "all";
      const limit = input?.limit ?? 200;
      if (status === "all") {
        return db.select().from(workLogs).orderBy(desc(workLogs.createdAt), desc(workLogs.id)).limit(limit);
      }
      return db.select().from(workLogs).where(eq(workLogs.status, status)).orderBy(desc(workLogs.createdAt), desc(workLogs.id)).limit(limit);
    }),

  start: protectedProcedure
    .input(z.object({
      workerName: z.string().min(1).max(100),
      category: z.string().min(1).max(100),
      memo: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      await recordWorkLog({
        workerName: input.workerName,
        category: input.category,
        status: "running",
        startedAt: new Date(),
        quantity: 0,
        memo: input.memo?.trim() || null,
        createdBy: ctx.user.name || ctx.user.email || null,
      });
      return { success: true };
    }),

  create: protectedProcedure
    .input(workLogBaseInput)
    .mutation(async ({ input, ctx }) => {
      const startedAt = parseOptionalDate(input.startedAt);
      const endedAt = parseOptionalDate(input.endedAt);
      const manualMinutes = input.manualMinutes ?? null;
      if (manualMinutes == null && (!startedAt || !endedAt)) {
        throw new Error("開始・終了、または作業時間を入力してください");
      }
      if (startedAt && endedAt && endedAt.getTime() < startedAt.getTime()) {
        throw new Error("終了は開始より後にしてください");
      }
      await recordWorkLog({
        workerName: input.workerName,
        category: input.category,
        status: "done",
        startedAt,
        endedAt,
        manualMinutes,
        quantity: input.quantity,
        memo: input.memo?.trim() || null,
        createdBy: ctx.user.name || ctx.user.email || null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
        detailsJson: input.detailsJson ?? null,
      });
      return { success: true };
    }),

  update: protectedProcedure
    .input(workLogBaseInput.extend({
      id: z.number().int().positive(),
      status: z.enum(["running", "done"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const workerName = cleanText(input.workerName);
      const category = cleanText(input.category);
      const startedAt = parseOptionalDate(input.startedAt);
      const endedAt = parseOptionalDate(input.endedAt);
      if (startedAt && endedAt && endedAt.getTime() < startedAt.getTime()) {
        throw new Error("終了は開始より後にしてください");
      }
      await ensureOptions(workerName, category);
      await db.update(workLogs).set({
        workerName,
        category,
        status: input.status ?? "done",
        startedAt,
        endedAt,
        manualMinutes: input.manualMinutes ?? null,
        quantity: input.quantity,
        memo: input.memo?.trim() || null,
        sourceType: input.sourceType?.trim() || null,
        sourceId: input.sourceId?.trim() || null,
        detailsJson: input.detailsJson?.trim() || null,
      }).where(eq(workLogs.id, input.id));
      return { success: true };
    }),

  finish: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      quantity: z.number().int().min(0).max(100000).optional(),
      manualMinutes: z.number().int().min(0).max(1440).nullable().optional(),
      memo: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [log] = await db.select().from(workLogs).where(eq(workLogs.id, input.id)).limit(1);
      if (!log) throw new Error("作業ログが見つかりません");
      await db.update(workLogs).set({
        status: "done",
        endedAt: new Date(),
        quantity: input.quantity ?? log.quantity,
        manualMinutes: input.manualMinutes ?? log.manualMinutes,
        memo: input.memo?.trim() || log.memo,
      }).where(eq(workLogs.id, input.id));
      return { success: true };
    }),

  split: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      category: z.string().min(1).max(100),
      manualMinutes: z.number().int().min(1).max(1440),
      quantity: z.number().int().min(0).max(100000).optional().default(0),
      memo: z.string().max(5000).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [log] = await db.select().from(workLogs).where(eq(workLogs.id, input.id)).limit(1);
      if (!log) throw new Error("作業ログが見つかりません");
      if (log.status === "running") throw new Error("作業中のログは終了してから分割してください");

      const category = cleanText(input.category);
      const currentMinutes = getStoredDurationMinutes(log);
      if (currentMinutes <= 0) throw new Error("分割する作業時間がありません");
      if (input.manualMinutes > currentMinutes) throw new Error("分割時間が元ログの作業時間を超えています");

      const nextOriginalMinutes = Math.max(0, currentMinutes - input.manualMinutes);
      const nextOriginalQuantity = Math.max(0, Number(log.quantity ?? 0) - input.quantity);
      let originalEndedAt = log.endedAt ?? null;
      let splitStartedAt: Date | null = null;
      let splitEndedAt: Date | null = null;

      if (log.startedAt && log.endedAt) {
        const nextEnd = subtractMinutes(log.endedAt, input.manualMinutes);
        if (nextEnd.getTime() >= log.startedAt.getTime()) {
          originalEndedAt = nextEnd;
          splitStartedAt = nextEnd;
          splitEndedAt = log.endedAt;
        }
      }

      await ensureOptions(log.workerName, category);
      await db.update(workLogs).set({
        endedAt: originalEndedAt,
        manualMinutes: nextOriginalMinutes,
        quantity: nextOriginalQuantity,
      }).where(eq(workLogs.id, input.id));

      await db.insert(workLogs).values({
        workerName: log.workerName,
        category,
        status: "done",
        startedAt: splitStartedAt,
        endedAt: splitEndedAt,
        manualMinutes: input.manualMinutes,
        quantity: input.quantity,
        memo: input.memo?.trim() || `分割元: #${log.id}${log.memo ? ` / ${log.memo}` : ""}`,
        createdBy: ctx.user.name || ctx.user.email || null,
        sourceType: "split",
        sourceId: String(log.id),
        detailsJson: null,
      });

      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(workLogs).where(eq(workLogs.id, input.id));
      return { success: true };
    }),
});
