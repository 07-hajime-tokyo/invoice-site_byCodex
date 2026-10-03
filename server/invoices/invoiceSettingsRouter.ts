import { protectedProcedure, router } from "../_core/trpc";
import { z } from "zod";
import { getDb } from "../db";
import { invoiceSettings } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const invoiceSettingsRouter = router({
    get: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      const rows = await db.select().from(invoiceSettings).limit(1);
      return rows[0] ?? null;
    }),

    save: protectedProcedure
      .input(z.object({
        senderName: z.string().optional(),
        senderCompany: z.string().optional(),
        senderEmail: z.string().optional(),
        senderPhone: z.string().optional(),
        senderAddress: z.string().optional(),
        senderCity: z.string().optional(),
        senderCountry: z.string().optional(),
        logoUrl: z.string().optional(),
        logoKey: z.string().optional(),
        taxRate: z.number().optional(),
        senderExtraInfo: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const existing = await db.select().from(invoiceSettings).limit(1);
        const setData = {
          senderName: input.senderName ?? null,
          senderCompany: input.senderCompany ?? null,
          senderEmail: input.senderEmail ?? null,
          senderPhone: input.senderPhone ?? null,
          senderAddress: input.senderAddress ?? null,
          senderCity: input.senderCity ?? null,
          senderCountry: input.senderCountry ?? null,
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
          ...(input.logoKey !== undefined ? { logoKey: input.logoKey } : {}),
          ...(input.taxRate !== undefined ? { taxRate: String(input.taxRate) } : {}),
          ...(input.senderExtraInfo !== undefined ? { senderExtraInfo: input.senderExtraInfo } : {}),
        };
        if (existing.length > 0) {
          await db.update(invoiceSettings).set(setData).where(eq(invoiceSettings.id, existing[0].id));
        } else {
          await db.insert(invoiceSettings).values(setData);
        }
        return { success: true };
      }),

    // ロゴ画像をS3にアップロードしてURLを返す
    uploadLogo: protectedProcedure
      .input(z.object({
        base64: z.string(), // base64 encoded image
        mimeType: z.string().default("image/png"),
        fileName: z.string().default("logo.png"),
      }))
      .mutation(async ({ input }) => {
        const { storagePut } = await import("../storage");
        const buffer = Buffer.from(input.base64, "base64");
        const key = `invoice-logos/${Date.now()}-${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url, key };
      }),
   });
