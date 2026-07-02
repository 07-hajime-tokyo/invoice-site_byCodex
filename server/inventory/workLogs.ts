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

const workLogBaseInput = z.object({
  workerName: z.string().min(1).max(100),
  category: z.string().min(1).max(100),
  startedAt: z.string().max(80).optional(),
  endedAt: z.string().max(80).optional(),
  manualMinutes: z.number().int().min(0).max(1440).nullable().optional(),
  quantity: z.number().int().min(0).max(100000).optional().default(0),
  memo: z.string().max(5000).optional(),
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
      const db = await requireDb();
      const workerName = cleanText(input.workerName);
      const category = cleanText(input.category);
      await ensureOptions(workerName, category);
      await db.insert(workLogs).values({
        workerName,
        category,
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
      const db = await requireDb();
      const workerName = cleanText(input.workerName);
      const category = cleanText(input.category);
      const startedAt = parseOptionalDate(input.startedAt);
      const endedAt = parseOptionalDate(input.endedAt);
      const manualMinutes = input.manualMinutes ?? null;
      if (manualMinutes == null && (!startedAt || !endedAt)) {
        throw new Error("開始・終了、または作業時間を入力してください");
      }
      if (startedAt && endedAt && endedAt.getTime() < startedAt.getTime()) {
        throw new Error("終了は開始より後にしてください");
      }
      await ensureOptions(workerName, category);
      await db.insert(workLogs).values({
        workerName,
        category,
        status: "done",
        startedAt,
        endedAt,
        manualMinutes,
        quantity: input.quantity,
        memo: input.memo?.trim() || null,
        createdBy: ctx.user.name || ctx.user.email || null,
      });
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

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(workLogs).where(eq(workLogs.id, input.id));
      return { success: true };
    }),
});
