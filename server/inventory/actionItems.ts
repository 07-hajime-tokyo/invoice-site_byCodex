import { z } from "zod";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  actionItemAssignees,
  actionItemAuthors,
  actionItemReplies,
  actionItems,
  actionItemTitlePresets,
} from "../../drizzle/schema";
import { getDb } from "./db";

const actionItemStatusSchema = z.enum(["open", "done"]);
const defaultAssignees = new Set(["仕入れ担当", "荷受担当", "出荷担当", "その他"]);
const reviewerNameSchema = z.enum(["鈴木さん", "藤本さん"]);

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parseReviewerChecks(value: string | null | undefined): Record<string, boolean> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter(([key]) => key.length > 0)
        .map(([key, checked]) => [key, Boolean(checked)]),
    );
  } catch {
    return {};
  }
}

async function requireDb() {
  const db = await getDb();
  if (!db) throw new Error("DB not available");
  return db;
}

async function attachReplies<T extends { id: number }>(items: T[]) {
  if (items.length === 0) return items.map((item) => ({ ...item, replies: [] }));
  const db = await requireDb();
  const replies = await db
    .select()
    .from(actionItemReplies)
    .where(inArray(actionItemReplies.actionItemId, items.map((item) => item.id)))
    .orderBy(asc(actionItemReplies.createdAt), asc(actionItemReplies.id));
  const repliesByItem = new Map<number, typeof replies>();
  for (const reply of replies) {
    const current = repliesByItem.get(reply.actionItemId) ?? [];
    current.push(reply);
    repliesByItem.set(reply.actionItemId, current);
  }
  return items.map((item) => ({ ...item, replies: repliesByItem.get(item.id) ?? [] }));
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
        const items = await db.select().from(actionItems).orderBy(asc(actionItems.status), desc(actionItems.createdAt));
        return attachReplies(items);
      }
      const items = await db.select().from(actionItems).where(eq(actionItems.status, status)).orderBy(desc(actionItems.createdAt));
      return attachReplies(items);
    }),

  options: protectedProcedure.query(async () => {
    const db = await requireDb();
    const [assignees, titles, authors] = await Promise.all([
      db.select().from(actionItemAssignees).orderBy(asc(actionItemAssignees.sortOrder), asc(actionItemAssignees.name)),
      db.select().from(actionItemTitlePresets).orderBy(asc(actionItemTitlePresets.sortOrder), asc(actionItemTitlePresets.title)),
      db.select().from(actionItemAuthors).orderBy(asc(actionItemAuthors.sortOrder), asc(actionItemAuthors.name)),
    ]);
    return { assignees, titles, authors };
  }),

  create: protectedProcedure
    .input(z.object({
      title: z.string().min(1).max(255),
      assignee: z.string().min(1).max(100),
      detail: z.string().min(1).max(5000),
      source: z.string().max(50).optional(),
      sourceKey: z.string().max(255).optional(),
      sourceQuestion: z.string().max(2000).optional(),
      createdBy: z.string().max(200).optional(),
      saveTitlePreset: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const title = cleanText(input.title);
      const assignee = cleanText(input.assignee);
      const createdBy = cleanText(input.createdBy ?? "") || ctx.user.name || ctx.user.email || null;
      const detail = input.detail.trim();
      await db.insert(actionItems).values({
        title,
        assignee,
        detail,
        status: "open",
        source: input.source ?? null,
        sourceKey: input.sourceKey ?? null,
        sourceQuestion: input.sourceQuestion ?? null,
        createdBy,
      });
      await db.insert(actionItemAssignees).ignore().values({ name: assignee, sortOrder: 100 });
      if (createdBy) {
        await db.insert(actionItemAuthors).ignore().values({ name: createdBy, sortOrder: 100 });
      }
      if (input.saveTitlePreset) {
        await db.insert(actionItemTitlePresets).ignore().values({ title, sortOrder: 100 });
      }
      return { success: true };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      title: z.string().min(1).max(255),
      assignee: z.string().min(1).max(100),
      detail: z.string().min(1).max(5000),
      createdBy: z.string().max(200).optional(),
      saveTitlePreset: z.boolean().optional().default(false),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const title = cleanText(input.title);
      const assignee = cleanText(input.assignee);
      const detail = input.detail.trim();
      const createdBy = cleanText(input.createdBy ?? "");
      await db.update(actionItems).set({
        title,
        assignee,
        detail,
        createdBy: createdBy || null,
      }).where(eq(actionItems.id, input.id));
      await db.insert(actionItemAssignees).ignore().values({ name: assignee, sortOrder: 100 });
      if (createdBy) {
        await db.insert(actionItemAuthors).ignore().values({ name: createdBy, sortOrder: 100 });
      }
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

  addAuthor: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(100) }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.insert(actionItemAuthors).ignore().values({ name: cleanText(input.name), sortOrder: 100 });
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

  setReviewerCheck: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      reviewer: reviewerNameSchema,
      checked: z.boolean(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const [item] = await db.select().from(actionItems).where(eq(actionItems.id, input.id)).limit(1);
      if (!item) throw new Error("やることが見つかりません");
      const checks = parseReviewerChecks(item.reviewerChecksJson);
      checks[input.reviewer] = input.checked;
      await db.update(actionItems).set({
        reviewerChecksJson: JSON.stringify(checks),
      }).where(eq(actionItems.id, input.id));
      return { success: true };
    }),

  createReply: protectedProcedure
    .input(z.object({
      actionItemId: z.number().int().positive(),
      body: z.string().min(1).max(5000),
      author: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [item] = await db.select({ id: actionItems.id }).from(actionItems).where(eq(actionItems.id, input.actionItemId)).limit(1);
      if (!item) throw new Error("やることが見つかりません");
      const author = cleanText(input.author ?? "") || ctx.user.name || ctx.user.email || null;
      await db.insert(actionItemReplies).values({
        actionItemId: input.actionItemId,
        body: input.body.trim(),
        author,
      });
      if (author) {
        await db.insert(actionItemAuthors).ignore().values({ name: author, sortOrder: 100 });
      }
      return { success: true };
    }),

  updateReply: protectedProcedure
    .input(z.object({
      id: z.number().int().positive(),
      body: z.string().min(1).max(5000),
      author: z.string().max(200).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      const author = cleanText(input.author ?? "") || null;
      await db.update(actionItemReplies).set({
        body: input.body.trim(),
        author,
      }).where(eq(actionItemReplies.id, input.id));
      if (author) {
        await db.insert(actionItemAuthors).ignore().values({ name: author, sortOrder: 100 });
      }
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(actionItemReplies).where(eq(actionItemReplies.actionItemId, input.id));
      await db.delete(actionItems).where(eq(actionItems.id, input.id));
      return { success: true };
    }),
});
