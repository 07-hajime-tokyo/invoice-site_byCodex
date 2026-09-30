import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { invoiceNumberHistory, invoices, whatsappChatHistory } from "../drizzle/schema";
import { desc, eq, isNull } from "drizzle-orm";
import { detectPaymentsFromChat } from "./invoices/chatParsing";

// ─── WhatsApp history upload & invoice number extraction ──────────────────
export const whatsappHistoryRouter = router({
    /**
     * Upload WhatsApp export files (PDFs + _chat.txt) and extract invoice numbers.
     * Files are sent as base64. Returns all extracted numbers and the next invoice number.
     */
    extractNumbers: protectedProcedure
      .input(z.object({
        files: z.array(z.object({
          name: z.string(),
          base64: z.string(),
          mimeType: z.string(),
        })),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await getDb();
        if (!dbConn) throw new Error("DB connection failed");
        const db = dbConn;
        const extracted: Array<{ number: number; source: string; rawValue: string }> = [];

        for (const file of input.files) {
          const name = file.name;

          // 1) PDF filename: "Invoice - 0372.pdf" (strict: space-hyphen-space format only)
          if (name.toLowerCase().endsWith(".pdf")) {
            const m = name.match(/^Invoice\s+-\s+(\d{3,6})\.pdf$/i);
            if (m) {
              extracted.push({ number: parseInt(m[1], 10), source: "filename", rawValue: name });
            }
          }

          // 2) _chat.txt: scan for "Invoice - 0372.pdf" format ONLY (strict: space-hyphen-space)
          // This matches only the canonical "Invoice - XXXX.pdf" filename format
          // Deliberately excludes "invoice0523.pdf", "Invoice-0372.pdf", etc.
          if (name === "_chat.txt" || name.endsWith(".txt")) {
            const text = Buffer.from(file.base64, "base64").toString("utf8");
            // Strict pattern: "Invoice - 0280.pdf" with mandatory space-hyphen-space
            const strictPattern = /Invoice\s+-\s+(\d{3,6})\.pdf/g;
            let m;
            while ((m = strictPattern.exec(text)) !== null) {
              const num = parseInt(m[1], 10);
              // Skip year-like numbers (2000-2099) and numbers > 9999
              if (num > 0 && !(num >= 2000 && num <= 2099) && num <= 9999) {
                extracted.push({ number: num, source: "chat_text", rawValue: m[0] });
              }
            }
          }

          // 3) Image (screenshot): use Forge API vision to extract invoice numbers
          if (file.mimeType.startsWith("image/")) {
            try {
              const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
              const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
              if (forgeUrl && forgeKey) {
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
                          text: "Look at this WhatsApp screenshot. Extract ALL invoice numbers you can see (e.g. from filenames like 'Invoice - 0372.pdf' or text like 'Invoice: 0372'). Return ONLY a JSON array of numbers, e.g. [372, 373]. If none found, return []."
                        },
                        {
                          type: "image_url",
                          image_url: { url: `data:${file.mimeType};base64,${file.base64}` }
                        }
                      ]
                    }],
                    max_tokens: 256,
                  }),
                });
                if (res.ok) {
                  const data = await res.json() as any;
                  const text = data.choices?.[0]?.message?.content ?? "[]";
                  const match = text.match(/\[([\d,\s]+)\]/);
                  if (match) {
                    const nums = match[1].split(",").map((n: string) => parseInt(n.trim(), 10)).filter((n: number) => !isNaN(n) && n > 0);
                    for (const num of nums) {
                      extracted.push({ number: num, source: "screenshot", rawValue: `screenshot:${name}` });
                    }
                  }
                }
              }
            } catch (e) {
              console.error("Forge API vision error:", e);
            }
          }
        }

        // Deduplicate by number
        const seen = new Set<number>();
        const unique = extracted.filter(e => {
          if (seen.has(e.number)) return false;
          seen.add(e.number);
          return true;
        });

        // Save to DB
        if (unique.length > 0) {
          await db.insert(invoiceNumberHistory).values(
            unique.map(e => ({ number: e.number, source: e.source, rawValue: e.rawValue }))
          );
        }

        // Get max number from DB (including previously stored)
        const allRows = await db.select().from(invoiceNumberHistory);
        const maxNumber = allRows.reduce((max, row) => Math.max(max, row.number), 0);
        const nextNumber = maxNumber + 1;
        const nextFormatted = String(nextNumber).padStart(4, "0");

        return {
          extracted: unique,
          maxNumber,
          nextNumber,
          nextFormatted,
        };
      }),

    /**
     * Get the current max invoice number from DB and return the next one.
     */
    getNextNumber: protectedProcedure.query(async () => {
      const dbConn = await getDb();
      if (!dbConn) throw new Error("DB connection failed");
      const db = dbConn;
      const allRows = await db.select().from(invoiceNumberHistory);
      // Only count invoices that are NOT permanently deleted (soft-deleted ones excluded from max)
      // We include soft-deleted rows so their numbers are still "reserved" until permanently deleted
      const invoiceRows = await db.select({ invoiceNumber: invoices.invoiceNumber }).from(invoices)
        .where(isNull(invoices.deletedAt));
      let maxNumber = 0;
      for (const row of allRows) {
        maxNumber = Math.max(maxNumber, row.number);
      }
      for (const row of invoiceRows) {
        // Parse numbers like "0372", "INV-20260324-001", "372"
        const m = row.invoiceNumber.match(/(\d{3,6})/);
        if (m) maxNumber = Math.max(maxNumber, parseInt(m[1], 10));
      }
      const nextNumber = maxNumber + 1;
      return {
        maxNumber,
        nextNumber,
        nextFormatted: String(nextNumber).padStart(4, "0"),
      };
    }),

    /**
     * Save a chat history item (screenshot or text) to DB/S3 for future re-analysis.
     */
    saveHistory: protectedProcedure
      .input(z.object({
        label: z.string().min(1),
        type: z.enum(["screenshot", "chat_text"]),
        fileName: z.string().optional(),
        base64: z.string().optional(),   // for images
        mimeType: z.string().optional(), // for images
        textContent: z.string().optional(), // for text
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        let imageUrl: string | null = null;
        let imageKey: string | null = null;
        if (input.type === "screenshot" && input.base64 && input.mimeType) {
          const { storagePut } = await import("./storage");
          const buffer = Buffer.from(input.base64, "base64");
          const ext = input.mimeType.split("/")[1] ?? "png";
          const key = `whatsapp-history/${Date.now()}-${input.fileName ?? "screenshot"}.${ext}`;
          const result = await storagePut(key, buffer, input.mimeType);
          imageUrl = result.url;
          imageKey = key;
        }
        const result = await db.insert(whatsappChatHistory).values({
          label: input.label,
          type: input.type,
          fileName: input.fileName ?? null,
          imageUrl,
          imageKey,
          textContent: input.type === "chat_text" ? (input.textContent ?? null) : null,
          mimeType: input.mimeType ?? null,
        });
        return { id: Number(result[0].insertId) };
      }),

    /**
     * List all saved chat history items.
     */
    listHistory: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(whatsappChatHistory).orderBy(desc(whatsappChatHistory.createdAt));
    }),

    /**
     * Delete a saved chat history item.
     */
    deleteHistory: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.delete(whatsappChatHistory).where(eq(whatsappChatHistory.id, input.id));
        return { success: true };
      }),

    /**
     * Analyze a saved screenshot from DB using Forge API.
     * Returns extracted items, sender, invoice numbers, and detected status changes.
     */
    analyzeHistoryItem: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const rows = await db.select().from(whatsappChatHistory).where(eq(whatsappChatHistory.id, input.id));
        const item = rows[0];
        if (!item) throw new Error("履歴が見つかりません");

        const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
        if (!forgeUrl || !forgeKey) throw new Error("Forge API not configured");

        if (item.type === "screenshot" && item.imageUrl) {
          // Fetch image from S3 and analyze
          const imgRes = await fetch(item.imageUrl);
          if (!imgRes.ok) throw new Error("画像の取得に失敗しました");
          const arrayBuffer = await imgRes.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          const mimeType = item.mimeType ?? "image/png";

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
                    text: `You are an invoice status detection assistant. Analyze this WhatsApp chat screenshot and detect:
1. Any invoice numbers that were SENT (e.g. "Invoice - 0372.pdf" was shared/sent in the chat)
2. Any payments that were made (e.g. "paid", "payment sent", "transferred", "I paid", "done", "bank transfer done")

Return a JSON object with this EXACT format:
{
  "sentInvoices": [372, 373],
  "paidInvoices": [370, 371],
  "items": [
    { "description": "New 2DS LL", "subText": "turquoise", "quantity": 5, "unitPrice": 160.00, "currency": "EUR" }
  ],
  "detectedSender": "buyer name or phone",
  "invoiceNumbers": [372]
}

Rules:
- sentInvoices: invoice numbers where the PDF was shared/sent in this conversation
- paidInvoices: invoice numbers where payment was confirmed
- items: order items (expand abbreviations: N2dsll→New 2DS LL, N3dsxl→New 3DS XL, PSVita→PS Vita, PSPGo→PSP Go)
- items.subText: color/variant from conversation (e.g. "turquoise", "black", "white")
- detectedSender: the BUYER's name (not Murakami/村上)
- invoiceNumbers: any invoice numbers visible

Return ONLY valid JSON, no markdown, no explanation.`
                  },
                  {
                    type: "image_url",
                    image_url: { url: `data:${mimeType};base64,${base64}` }
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
              sentInvoices: number[];
              paidInvoices: number[];
              items: Array<{ description: string; subText?: string; quantity: number; unitPrice: number; currency: string }>;
              detectedSender: string | null;
              invoiceNumbers: number[];
            };
          } catch {
            return { sentInvoices: [], paidInvoices: [], items: [], detectedSender: null, invoiceNumbers: [] };
          }
        } else if (item.type === "chat_text" && item.textContent) {
          // Text-based detection
          const payments = detectPaymentsFromChat(item.textContent);
          const sentPattern = /Invoice\s+-\s+(\d{3,6})\.pdf/gi;
          const sentInvoices: number[] = [];
          let m;
          while ((m = sentPattern.exec(item.textContent)) !== null) {
            const n = parseInt(m[1], 10);
            if (n > 0 && !(n >= 2000 && n <= 2099)) sentInvoices.push(n);
          }
          const paidInvoices = payments
            .filter(p => p.invoiceNumber)
            .map(p => parseInt(p.invoiceNumber.replace(/^0+/, ""), 10))
            .filter(n => !isNaN(n));
          return { sentInvoices, paidInvoices, items: [], detectedSender: null, invoiceNumbers: sentInvoices };
        }
        throw new Error("対応していない履歴タイプです");
      }),
});
