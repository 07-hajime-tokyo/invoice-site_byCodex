import { z } from "zod";
import { asc, desc, eq, inArray } from "drizzle-orm";
import { protectedProcedure, router } from "../_core/trpc";
import {
  actionItemAttachments,
  actionItemAssignees,
  actionItemAuthors,
  actionItemReplies,
  actionItems,
  actionItemTitlePresets,
} from "../../drizzle/schema";
import { actionItemAttachmentUrl } from "./actionItemAttachmentStorage";
import { getDb } from "./db";

const actionItemStatusSchema = z.enum(["open", "done"]);
const defaultAssignees = new Set(["仕入れ担当", "荷受担当", "出荷担当", "その他"]);
const reviewerNameSchema = z.enum(["鈴木さん", "藤本さん"]);
const MAX_ATTACHMENTS_PER_REQUEST = 10;
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_ATTACHMENT_BASE64_LENGTH = 12 * 1024 * 1024;
const allowedImageTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const actionItemAttachmentInputSchema = z.object({
  fileName: z.string().max(255).optional(),
  contentType: z.string().min(1).max(100),
  dataBase64: z.string().min(1).max(MAX_ATTACHMENT_BASE64_LENGTH),
});

function cleanText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function cleanBase64(value: string) {
  return value.replace(/^data:[^;]+;base64,/i, "").replace(/\s/g, "");
}

function validateAttachment(input: z.infer<typeof actionItemAttachmentInputSchema>) {
  const contentType = input.contentType.trim().toLowerCase();
  if (!allowedImageTypes.has(contentType)) {
    throw new Error("添付できるのは画像ファイルだけです");
  }
  const dataBase64 = cleanBase64(input.dataBase64);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
    throw new Error("画像データの形式が正しくありません");
  }
  const byteLength = Buffer.byteLength(dataBase64, "base64");
  if (byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error("添付画像は1枚8MB以下にしてください");
  }
  return {
    fileName: cleanText(input.fileName ?? "") || "screenshot",
    contentType,
    dataBase64,
  };
}

type ValidatedAttachmentInput = ReturnType<typeof validateAttachment>;

function validateAttachments(attachments: Array<z.infer<typeof actionItemAttachmentInputSchema>>) {
  if (attachments.length > MAX_ATTACHMENTS_PER_REQUEST) {
    throw new Error(`添付は1回${MAX_ATTACHMENTS_PER_REQUEST}枚までです`);
  }
  return attachments.map(validateAttachment);
}

function buildAttachmentRows(
  actionItemId: number,
  attachments: ValidatedAttachmentInput[],
  createdBy: string | null,
) {
  return attachments.map((attachment) => ({
    actionItemId,
    ...attachment,
    createdBy,
  }));
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

async function attachRelatedRows<T extends { id: number }>(items: T[]) {
  if (items.length === 0) return items.map((item) => ({ ...item, replies: [], attachments: [] }));
  const db = await requireDb();
  const itemIds = items.map((item) => item.id);
  const [replies, attachments] = await Promise.all([
    db
      .select()
      .from(actionItemReplies)
      .where(inArray(actionItemReplies.actionItemId, itemIds))
      .orderBy(asc(actionItemReplies.createdAt), asc(actionItemReplies.id)),
    db
      .select({
        id: actionItemAttachments.id,
        actionItemId: actionItemAttachments.actionItemId,
        fileName: actionItemAttachments.fileName,
        contentType: actionItemAttachments.contentType,
        createdBy: actionItemAttachments.createdBy,
        createdAt: actionItemAttachments.createdAt,
      })
      .from(actionItemAttachments)
      .where(inArray(actionItemAttachments.actionItemId, itemIds))
      .orderBy(asc(actionItemAttachments.createdAt), asc(actionItemAttachments.id)),
  ]);
  const repliesByItem = new Map<number, typeof replies>();
  for (const reply of replies) {
    const current = repliesByItem.get(reply.actionItemId) ?? [];
    current.push(reply);
    repliesByItem.set(reply.actionItemId, current);
  }
  const attachmentsByItem = new Map<number, Array<(typeof attachments)[number] & { url: string }>>();
  for (const attachment of attachments) {
    const current = attachmentsByItem.get(attachment.actionItemId) ?? [];
    current.push({ ...attachment, url: actionItemAttachmentUrl(attachment.id) });
    attachmentsByItem.set(attachment.actionItemId, current);
  }
  return items.map((item) => ({
    ...item,
    replies: repliesByItem.get(item.id) ?? [],
    attachments: attachmentsByItem.get(item.id) ?? [],
  }));
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
        const items = await db
          .select()
          .from(actionItems)
          .orderBy(desc(actionItems.isPinned), asc(actionItems.status), desc(actionItems.createdAt));
        return attachRelatedRows(items);
      }
      const items = await db
        .select()
        .from(actionItems)
        .where(eq(actionItems.status, status))
        .orderBy(desc(actionItems.isPinned), desc(actionItems.createdAt));
      return attachRelatedRows(items);
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
      attachments: z.array(actionItemAttachmentInputSchema).max(MAX_ATTACHMENTS_PER_REQUEST).optional().default([]),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const title = cleanText(input.title);
      const assignee = cleanText(input.assignee);
      const createdBy = cleanText(input.createdBy ?? "") || ctx.user.name || ctx.user.email || null;
      const detail = input.detail.trim();
      const validatedAttachments = validateAttachments(input.attachments);
      const result = await db.insert(actionItems).values({
        title,
        assignee,
        detail,
        status: "open",
        source: input.source ?? null,
        sourceKey: input.sourceKey ?? null,
        sourceQuestion: input.sourceQuestion ?? null,
        createdBy,
      });
      const actionItemId = Number((result[0] as { insertId?: number }).insertId ?? 0);
      if (input.attachments.length > 0 && actionItemId <= 0) {
        throw new Error("やることの登録IDを取得できませんでした");
      }
      const attachmentRows = buildAttachmentRows(actionItemId, validatedAttachments, createdBy);
      if (actionItemId > 0 && attachmentRows.length > 0) {
        await db.insert(actionItemAttachments).values(attachmentRows);
      }
      await db.insert(actionItemAssignees).ignore().values({ name: assignee, sortOrder: 100 });
      if (createdBy) {
        await db.insert(actionItemAuthors).ignore().values({ name: createdBy, sortOrder: 100 });
      }
      if (input.saveTitlePreset) {
        await db.insert(actionItemTitlePresets).ignore().values({ title, sortOrder: 100 });
      }
      return { success: true, id: actionItemId };
    }),

  addAttachments: protectedProcedure
    .input(z.object({
      actionItemId: z.number().int().positive(),
      attachments: z.array(actionItemAttachmentInputSchema).min(1).max(MAX_ATTACHMENTS_PER_REQUEST),
      createdBy: z.string().max(200).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await requireDb();
      const [item] = await db.select({ id: actionItems.id }).from(actionItems).where(eq(actionItems.id, input.actionItemId)).limit(1);
      if (!item) throw new Error("やることが見つかりません");
      const createdBy = cleanText(input.createdBy ?? "") || ctx.user.name || ctx.user.email || null;
      await db.insert(actionItemAttachments).values(buildAttachmentRows(input.actionItemId, validateAttachments(input.attachments), createdBy));
      return { success: true, count: input.attachments.length };
    }),

  deleteAttachment: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.delete(actionItemAttachments).where(eq(actionItemAttachments.id, input.id));
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

  setPinned: protectedProcedure
    .input(z.object({ id: z.number().int().positive(), pinned: z.boolean() }))
    .mutation(async ({ input }) => {
      const db = await requireDb();
      await db.update(actionItems).set({
        isPinned: input.pinned,
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
      await db.delete(actionItemAttachments).where(eq(actionItemAttachments.actionItemId, input.id));
      await db.delete(actionItems).where(eq(actionItems.id, input.id));
      return { success: true };
    }),
});
