import { z } from "zod";
import { asc, desc, eq } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  actionItemAssignees,
  actionItems,
  actionItemTitlePresets,
} from "../../drizzle/schema";
import { getDb } from "./db";

const actionItemStatusSchema = z.enum(["open", "done"]);
const defaultAssignees = new Set(["仕入れ担当", "荷受担当", "出荷担当", "その他"]);

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db;
}

export const actionItemsRouter = router({
  list: protectedProcedure
    .input(z.object({
      status: actionItemStatusSchema.or(z.literal("all")).optional().default("open"),
    }).optional())
    .query(async ({ input }) => {
      const db = await requireDb();
      const status = input?.status ?? "open";
      if (status === "all") {
        return db.select().from(actionItems).orderBy(asc(actionItems.status), desc(actionItems.createdAt));
      }
      return db.select().from(actionItems).where(eq(actionItems.status, status)).orderBy(desc(actionItems.createdAt));
    }),

  options: protectedProcedure.query(async () => {
    const db = await requireDb();
    const [assignees, titles] = await Promise.all([
      db.select().from(actionItemAssignees).orderBy(asc(actionItemAssignees.sortOrder), asc(actionItemAssignees.name)),
      db.select().from(actionItemTitlePresets).orderBy(asc(actionItemTitlePresets.sortOrder), asc(actionItemTitlePresets.title)),
    ]);
    return { assignees, titles };
  }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      assignee: z.string().min(1).max(100),
      detail: z.string().min(1).max(5000),
      source: z.string().max(50).optional(),
      sourceQuestion: z.string().max(2000).optional(),
      saveTitlePreset: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const title = cleanText(input.title);
      const assignee = cleanText(input.assignee);
      const detail = input.detail.trim();
      await db.insert(actionItems).values({
        title,
        assignee,
        detail,
        status: "open",
        source: input.source ?? null,
        sourceQuestion: input.sourceQuestion ?? null,
        createdBy: ctx.user.email ?? ctx.user.name ?? null,
      });
      await db.insert(actionItemAssignees).ignore().values({ name: assignee, sortOrder: 100 });
      if (input.saveTitlePreset) {
        await db.insert(actionItemTitlePresets).ignore().values({ title, sortOrder: 100 });
      }
      return { success: true };
    }),

  addAssignee: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.insert(actionItemAssignees).ignore().values({ name: cleanText(input.name), sortOrder: 100 });
      return { success: true };
    }),

  deleteAssignee: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [assignee] = await db.select().from(actionItemAssignees).where(eq(actionItemAssignees.id, input.id)).limit(1);
      if (!assignee) return { success: true };
      if (defaultAssignees.has(assignee.name)) {
        throw new Error("初期宛先は削除できません");
      }
      await db.delete(actionItemAssignees).where(eq(actionItemAssignees.id, input.id));
      return { success: true };
    }),

  addTitlePreset: protectedProcedure
    .input(z.object({ title: z.string().min(1).max(255) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.insert(actionItemTitlePresets).ignore().values({ title: cleanText(input.title), sortOrder: 100 });
      return { success: true };
    }),

  setStatus: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), status: actionItemStatusSchema }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(actionItems).set({
        status: input.status,
        completedAt: input.status === "done" ? new Date() : null,
      }).where(eq(actionItems.id, input.id));
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(actionItems).where(eq(actionItems.id, input.id));
      return { success: true };
    }),
});
