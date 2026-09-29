import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb } from "../db";
import { invoices, invoiceItems } from "../../drizzle/schema";
import { eq, desc, asc, and, sql, isNull, isNotNull } from "drizzle-orm";
import { analyzeInvoiceImageWithGemini } from "./imageAnalysis";
import { parseWhatsAppChat, extractSenderFromChat, detectPaymentsFromChat } from "./chatParsing";
import { generateInvoiceNumber } from "./numbering";

export const invoicesRouter = router({
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(invoices)
        .where(isNull(invoices.deletedAt))
        .orderBy(desc(invoices.createdAt));
      const result = await Promise.all(rows.map(async (inv) => {
        const countRows = await db.select({ count: sql<number>`count(*)` }).from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
        const sumRows = await db.select({
          total: sql<string>`COALESCE(SUM(CAST(quantity AS DECIMAL(10,2)) * CAST(unitPrice AS DECIMAL(12,2))), 0)`,
        }).from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
        return {
          ...inv,
          itemCount: Number(countRows[0]?.count ?? 0),
          totalAmount: Number(sumRows[0]?.total ?? 0),
        };
      }));
      return result;
    }),

    get: protectedProcedure
      .input(z.object({ id: z.number() }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return null;
        const rows = await db.select().from(invoices).where(eq(invoices.id, input.id));
        const inv = rows[0];
        if (!inv) return null;
        const items = await db.select().from(invoiceItems)
          .where(eq(invoiceItems.invoiceId, input.id))
          .orderBy(asc(invoiceItems.sortOrder));
        return { ...inv, items };
      }),

    parseWhatsApp: protectedProcedure
      .input(z.object({ chatText: z.string() }))
      .mutation(async ({ input }) => {
        const parsed = parseWhatsAppChat(input.chatText);
        const detectedSender = extractSenderFromChat(input.chatText);
        return {
          items: parsed,
          invoiceNumber: generateInvoiceNumber(),
          detectedSender,
        };
      }),

    // Detect payment from chat text and return matching invoice numbers
    detectPayments: protectedProcedure
      .input(z.object({ chatText: z.string() }))
      .mutation(async ({ input }) => {
        return detectPaymentsFromChat(input.chatText);
      }),

    imageAnalysisStatus: protectedProcedure.query(() => {
      const hasGemini = Boolean(process.env.GEMINI_API_KEY);
      const hasForge = Boolean(process.env.BUILT_IN_FORGE_API_URL && process.env.BUILT_IN_FORGE_API_KEY);
      return {
        enabled: hasGemini || hasForge,
        provider: hasGemini ? "gemini" : hasForge ? "forge" : null,
      };
    }),

    // Analyze screenshot image to extract invoice line items using Gemini, with Forge as a fallback.
    analyzeScreenshot: protectedProcedure
      .input(z.object({
        base64: z.string(),
        mimeType: z.string().default("image/png"),
      }))
      .mutation(async ({ input }) => {
        const geminiResult = await analyzeInvoiceImageWithGemini(input);
        if (geminiResult) return geminiResult;

        const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
        if (!forgeUrl || !forgeKey) {
          throw new Error("画像解析APIが未設定です。無料枠で使う場合は GEMINI_API_KEY を設定してください。");
        }
        const res = await fetch(`${forgeUrl}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${forgeKey}`,
          },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [{
              role: "user",
              content: [
                {
                  type: "text",
                  text: `You are an invoice extraction assistant. Analyze this WhatsApp chat screenshot carefully and extract all order/invoice information.

Return a JSON object with this EXACT format:
{
  "items": [
    { "description": "product name", "subText": "color or variant", "quantity": 10, "unitPrice": 25.00, "currency": "EUR" }
  ],
  "detectedSender": "name or phone number of the buyer (not the seller/Murakami)",
  "invoiceNumbers": [372, 373],
  "totalAmount": 250.00,
  "currency": "EUR"
}

Extraction rules:
- items.description: FULL product name, expanded from abbreviations/slang:
  * "N2dsll" or "n2dsll" → "New 2DS LL"
  * "N3dsxl" → "New 3DS XL"
  * "N3ds" → "New 3DS"
  * "PSVita" → "PS Vita"
  * "PSPGO" or "PSPGo" → "PSP Go"
  * "WiiU" → "Wii U"
  * Other abbreviations: expand to full official product name
- items.subText: color, variant, or condition mentioned in the conversation for this item.
  * Look in the ENTIRE conversation for color/variant info, not just the order line.
  * Examples: "turquoise", "black", "white", "random color", "coral pink", "like new"
  * Leave empty string "" if no color/variant info found.
- items.quantity: number of units ordered
- items.unitPrice: unit price if visible (e.g. "€25 each", "25 EUR/pc", "160 euros per"). Set to 0 if not shown.
- items.currency: currency code (EUR, USD, GBP, JPY). Default EUR.
- detectedSender: the BUYER's name or phone number. The seller is typically "Murakami" or "村上" - exclude them.
- invoiceNumbers: any invoice numbers like "Invoice - 0372.pdf" → [372]
- totalAmount: total order amount if visible (e.g. "Total: €500" → 500)
- currency: overall currency of the transaction

Return ONLY valid JSON, no markdown, no explanation.`
                },
                {
                  type: "image_url",
                  image_url: { url: `data:${input.mimeType};base64,${input.base64}` }
                }
              ]
            }],
            max_tokens: 1024,
          }),
        });
        if (!res.ok) throw new Error(`Forge API error: ${res.status}`);
        const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
        const text = data.choices?.[0]?.message?.content ?? "{}";
        try {
          const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          return JSON.parse(clean) as {
            items: Array<{ description: string; subText?: string; quantity: number; unitPrice: number; currency: string }>;
            detectedSender: string | null;
            invoiceNumbers: number[];
            totalAmount: number | null;
            currency: string | null;
          };
        } catch {
          return { items: [], detectedSender: null, invoiceNumbers: [] };
        }
      }),

    // 過去の請求書番号から最大番号を取得し、次の番号を返す
    getNextNumber: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return generateInvoiceNumber();
      const rows = await db.select({ invoiceNumber: invoices.invoiceNumber }).from(invoices).orderBy(desc(invoices.createdAt));
      // Find max numeric suffix from INV-YYYYMMDD-NNN format
      let maxNum = 0;
      for (const row of rows) {
        const match = row.invoiceNumber.match(/(\d+)$/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) maxNum = n;
        }
      }
      const next = maxNum + 1;
      const now = new Date();
      const y = now.getFullYear();
      const m = String(now.getMonth() + 1).padStart(2, "0");
      const d = String(now.getDate()).padStart(2, "0");
      return `INV-${y}${m}${d}-${String(next).padStart(3, "0")}`;
    }),

    create: protectedProcedure
      .input(z.object({
        invoiceNumber: z.string().min(1),
        clientId: z.number().nullable().optional(),
        clientSnapshot: z.any().optional(),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        currency: z.string().default("EUR"),
        showAmounts: z.boolean().default(false),
        notes: z.string().optional(),
        rawChat: z.string().optional(),
        status: z.enum(["draft", "sent", "paid"]).default("draft"),
        accentColor: z.string().optional(),
        items: z.array(z.object({
          description: z.string().min(1),
          variant: z.string().optional(),
          quantity: z.number().min(0),
          unitPrice: z.number().min(0),
          currency: z.string().optional(),
          sortOrder: z.number().optional(),
          tax: z.number().min(0).optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const existing = await db
          .select({ id: invoices.id })
          .from(invoices)
          .where(and(eq(invoices.invoiceNumber, input.invoiceNumber), isNull(invoices.deletedAt)))
          .limit(1);
        if (existing.length > 0) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `インボイス番号 ${input.invoiceNumber} は既に存在します。新規作成し直してください。`,
          });
        }
        const result = await db.insert(invoices).values({
          invoiceNumber: input.invoiceNumber,
          clientId: input.clientId ?? null,
          clientSnapshot: input.clientSnapshot ?? null,
          invoiceDate: input.invoiceDate ?? null,
          dueDate: input.dueDate ?? null,
          currency: input.currency,
          showAmounts: input.showAmounts,
          notes: input.notes ?? null,
          rawChat: input.rawChat ?? null,
          status: input.status,
          accentColor: input.accentColor ?? "#db8b1a",
        });
        const invoiceId = Number(result[0].insertId);

        if (input.items.length > 0) {
          const db2 = await getDb();
          if (!db2) throw new Error("DB not available");
          await db2.insert(invoiceItems).values(
            input.items.map((item, idx) => ({
              invoiceId,
              description: item.description,
              variant: item.variant ?? null,
              quantity: String(item.quantity),
              unitPrice: String(item.unitPrice),
              currency: item.currency ?? null,
              sortOrder: item.sortOrder ?? idx,
              tax: item.tax !== undefined ? String(item.tax) : "0",
            }))
          );
        }

        return { id: invoiceId };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        invoiceNumber: z.string().min(1),
        clientId: z.number().nullable().optional(),
        clientSnapshot: z.any().optional(),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        currency: z.string().default("EUR"),
        showAmounts: z.boolean().default(false),
        notes: z.string().optional(),
        rawChat: z.string().optional(),
        status: z.enum(["draft", "sent", "paid"]).default("draft"),
        accentColor: z.string().optional(),
        items: z.array(z.object({
          description: z.string().min(1),
          variant: z.string().optional(),
          quantity: z.number().min(0),
          unitPrice: z.number().min(0),
          currency: z.string().optional(),
          sortOrder: z.number().optional(),
          tax: z.number().min(0).optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.update(invoices)
          .set({
            invoiceNumber: input.invoiceNumber,
            clientId: input.clientId ?? null,
            clientSnapshot: input.clientSnapshot ?? null,
            invoiceDate: input.invoiceDate ?? null,
            dueDate: input.dueDate ?? null,
            currency: input.currency,
            showAmounts: input.showAmounts,
            notes: input.notes ?? null,
            rawChat: input.rawChat ?? null,
            status: input.status,
            accentColor: input.accentColor ?? "#db8b1a",
          })
          .where(eq(invoices.id, input.id));

        // Replace all items
        await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
        if (input.items.length > 0) {
          await db.insert(invoiceItems).values(
            input.items.map((item, idx) => ({
              invoiceId: input.id,
              description: item.description,
              variant: item.variant ?? null,
              quantity: String(item.quantity),
              unitPrice: String(item.unitPrice),
              currency: item.currency ?? null,
              sortOrder: item.sortOrder ?? idx,
              tax: item.tax !== undefined ? String(item.tax) : "0",
            }))
          );
        }

        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        // Soft delete: set deletedAt instead of removing the row
        await db.update(invoices)
          .set({ deletedAt: new Date() })
          .where(eq(invoices.id, input.id));
        return { success: true };
      }),

    restore: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.update(invoices)
          .set({ deletedAt: null })
          .where(eq(invoices.id, input.id));
        return { success: true };
      }),

    permanentDelete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        // Verify the invoice is soft-deleted before permanent deletion
        const rows = await db.select().from(invoices).where(eq(invoices.id, input.id));
        const inv = rows[0];
        if (!inv) throw new Error("インボイスが見つかりません");
        if (!inv.deletedAt) throw new Error("先にソフトデリートしてから完全削除してください");
        // Permanently delete items and invoice
        await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, input.id));
        await db.delete(invoices).where(eq(invoices.id, input.id));
        return { success: true, invoiceNumber: inv.invoiceNumber };
      }),

    listDeleted: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      const rows = await db.select().from(invoices)
        .where(isNotNull(invoices.deletedAt))
        .orderBy(desc(invoices.deletedAt));
      const result = await Promise.all(rows.map(async (inv) => {
        const countRows = await db.select({ count: sql<number>`count(*)` }).from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
        const sumRows = await db.select({
          total: sql<string>`COALESCE(SUM(CAST(quantity AS DECIMAL(10,2)) * CAST(unitPrice AS DECIMAL(12,2))), 0)`,
        }).from(invoiceItems).where(eq(invoiceItems.invoiceId, inv.id));
        return {
          ...inv,
          itemCount: Number(countRows[0]?.count ?? 0),
          totalAmount: Number(sumRows[0]?.total ?? 0),
        };
      }));
      return result;
    }),

    updateStatus: protectedProcedure
      .input(z.object({
        id: z.number(),
        status: z.enum(["draft", "sent", "paid"]),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.update(invoices)
          .set({ status: input.status })
          .where(eq(invoices.id, input.id));
        return { success: true };
      }),

    getLatest: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return null;
      // 番号の最大値（末尾の数字が最大）のインボイスを取得
      const rows = await db.select().from(invoices).orderBy(desc(invoices.createdAt));
      let maxNum = 0;
      let latestInvoice = null;
      for (const row of rows) {
        const match = row.invoiceNumber.match(/(\d+)$/);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > maxNum) {
            maxNum = n;
            latestInvoice = row;
          }
        }
      }
      if (!latestInvoice) return null;
      // 明細も取得
      const items = await db.select().from(invoiceItems)
        .where(eq(invoiceItems.invoiceId, latestInvoice.id))
        .orderBy(asc(invoiceItems.sortOrder));
      return { ...latestInvoice, items };
    }),
    // ─── リアルタイム為替レート取得 ─────────────────────────────────────────────
    getExchangeRate: protectedProcedure
      .input(z.object({ currency: z.string() }))
      .query(async ({ input }) => {
        const { currency } = input;
        if (currency === "JPY") return { rate: 1, currency: "JPY", date: new Date().toISOString().slice(0, 10) };
        try {
          const res = await fetch(`https://api.frankfurter.app/latest?from=${currency}&to=JPY`);
          if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
          const data = await res.json() as { rates: Record<string, number>; date: string };
          const rate = data.rates["JPY"];
          if (!rate) throw new Error(`No JPY rate for ${currency}`);
          return { rate, currency, date: data.date };
        } catch (e) {
          throw new Error(`為替レートの取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
        }
      }),

    // ─── 分割インボイス一括作成 ───────────────────────────────────────────────
    // 1回の決済が100万円以下になるよう自動分割して複数インボイスを作成する
    createSplit: protectedProcedure
      .input(z.object({
        baseInvoiceNumber: z.string().min(1), // 元のインボイス番号（連番の起点）
        clientId: z.number().nullable().optional(),
        clientSnapshot: z.any().optional(),
        invoiceDate: z.string().optional(),
        dueDate: z.string().optional(),
        currency: z.string().default("EUR"),
        showAmounts: z.boolean().default(false),
        notes: z.string().optional(),
        rawChat: z.string().optional(),
        status: z.enum(["draft", "sent", "paid"]).default("draft"),
        accentColor: z.string().optional(),
        exchangeRate: z.number().positive(), // JPY換算レート
        limitJpy: z.number().default(1000000), // 上限（デフォルト100万円）
        splits: z.array(z.object({
          invoiceNumber: z.string().min(1),
          items: z.array(z.object({
            description: z.string().min(1),
            variant: z.string().optional(),
            quantity: z.number().min(0),
            unitPrice: z.number().min(0),
            currency: z.string().optional(),
            sortOrder: z.number().optional(),
            tax: z.number().min(0).optional(),
          })),
        })),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");

        const createdIds: number[] = [];
        for (const split of input.splits) {
          const invoiceNumber = split.invoiceNumber.trim();
          const normalizedInvoiceNumber = /^\d+$/.test(invoiceNumber)
            ? invoiceNumber.padStart(4, "0")
            : invoiceNumber;
          const result = await db.insert(invoices).values({
            invoiceNumber: normalizedInvoiceNumber,
            clientId: input.clientId ?? null,
            clientSnapshot: input.clientSnapshot ?? null,
            invoiceDate: input.invoiceDate ?? null,
            dueDate: input.dueDate ?? null,
            currency: input.currency,
            showAmounts: input.showAmounts,
            notes: input.notes ?? null,
            rawChat: input.rawChat ?? null,
            status: input.status,
            accentColor: input.accentColor ?? "#db8b1a",
          });
          const invoiceId = Number(result[0].insertId);
          createdIds.push(invoiceId);

          if (split.items.length > 0) {
            const db2 = await getDb();
            if (!db2) throw new Error("DB not available");
            await db2.insert(invoiceItems).values(
              split.items.map((item, idx) => ({
                invoiceId,
                description: item.description,
                variant: item.variant ?? null,
                quantity: String(item.quantity),
                unitPrice: String(item.unitPrice),
                currency: item.currency ?? null,
                sortOrder: item.sortOrder ?? idx,
                tax: item.tax !== undefined ? String(item.tax) : "0",
              }))
            );
          }
        }

        return { ids: createdIds, count: createdIds.length };
      }),

    clone: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        // Fetch original invoice
        const origRows = await db.select().from(invoices).where(eq(invoices.id, input.id));
        const orig = origRows[0];
        if (!orig) throw new Error("Invoice not found");
        // Fetch original items
        const origItems = await db.select().from(invoiceItems)
          .where(eq(invoiceItems.invoiceId, input.id))
          .orderBy(asc(invoiceItems.sortOrder));
        // Calculate next invoice number from all existing invoices (excluding soft-deleted)
        const allRows = await db.select({ invoiceNumber: invoices.invoiceNumber }).from(invoices)
          .where(isNull(invoices.deletedAt));
        let maxNum = 0;
        for (const row of allRows) {
          const match = row.invoiceNumber.match(/(\d{3,6})/);
          if (match) {
            const n = parseInt(match[1], 10);
            if (n > maxNum) maxNum = n;
          }
        }
        const next = maxNum + 1;
        const newInvoiceNumber = String(next).padStart(4, "0");
        // Insert cloned invoice with draft status
        const result = await db.insert(invoices).values({
          invoiceNumber: newInvoiceNumber,
          clientId: orig.clientId,
          clientSnapshot: orig.clientSnapshot,
          invoiceDate: orig.invoiceDate,
          dueDate: orig.dueDate,
          currency: orig.currency,
          showAmounts: orig.showAmounts,
          notes: orig.notes,
          rawChat: orig.rawChat,
          status: "draft",
          accentColor: orig.accentColor ?? "#db8b1a",
        });
        const newId = Number(result[0].insertId);
        // Insert cloned items
        if (origItems.length > 0) {
          await db.insert(invoiceItems).values(
            origItems.map((item, idx) => ({
              invoiceId: newId,
              description: item.description,
              variant: item.variant ?? null,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              currency: item.currency,
              sortOrder: item.sortOrder ?? idx,
              tax: item.tax ?? "0",
            }))
          );
        }
        return { id: newId, invoiceNumber: newInvoiceNumber };
      }),
  });
