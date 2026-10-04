import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { invoiceClients } from "../../drizzle/schema";
import { eq, asc } from "drizzle-orm";

// 不可視文字（ゼロ幅スペース、WORD JOINERなど）を除去するヘルパー
function sanitizeText(str: string | null | undefined): string | null {
  if (str == null) return null;
  return str.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').trim() || null;
}

export const invoiceClientsRouter = router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(invoiceClients).orderBy(asc(invoiceClients.name));
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const rows = await db.select().from(invoiceClients).where(eq(invoiceClients.id, input.id));
        return rows[0] ?? null;
      }),

    create: protectedProcedure
      .input(z.object({
        name: z.string().min(1),
        company: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        notes: z.string().optional(),
        extraInfo: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const result = await db.insert(invoiceClients).values({
          name: sanitizeText(input.name) ?? input.name,
          company: sanitizeText(input.company),
          email: sanitizeText(input.email),
          phone: sanitizeText(input.phone),
          address: sanitizeText(input.address),
          city: sanitizeText(input.city),
          country: sanitizeText(input.country),
          notes: sanitizeText(input.notes),
          extraInfo: sanitizeText(input.extraInfo),
        });
        return { id: Number(result[0].insertId) };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        name: z.string().min(1),
        company: z.string().optional(),
        email: z.string().optional(),
        phone: z.string().optional(),
        address: z.string().optional(),
        city: z.string().optional(),
        country: z.string().optional(),
        notes: z.string().optional(),
        extraInfo: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.update(invoiceClients)
          .set({
            name: sanitizeText(input.name) ?? input.name,
            company: sanitizeText(input.company),
            email: sanitizeText(input.email),
            phone: sanitizeText(input.phone),
            address: sanitizeText(input.address),
            city: sanitizeText(input.city),
            country: sanitizeText(input.country),
            notes: sanitizeText(input.notes),
            extraInfo: sanitizeText(input.extraInfo),
          })
          .where(eq(invoiceClients.id, input.id));
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.delete(invoiceClients).where(eq(invoiceClients.id, input.id));
        return { success: true };
      }),
  });
