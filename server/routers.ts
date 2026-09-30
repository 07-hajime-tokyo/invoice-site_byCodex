import { invoiceClientsRouter } from "./invoices/invoiceClientsRouter";
import { invoicesRouter } from "./invoices/invoicesRouter";
import { invoiceSettingsRouter } from "./invoices/invoiceSettingsRouter";
import { generateInvoiceNumber } from "./invoices/numbering";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import {
  createEmailOpenId,
  EMAIL_AUTH_LOGIN_METHOD,
  isAllowedLoginEmail,
  normalizeLoginEmail,
} from "./_core/emailAuth";
import { sdk } from "./_core/sdk";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { inventoryRouter } from "./inventory/routers";
import { whatsappHistoryRouter } from "./whatsappHistoryRouter";
import { whatsappChatsRouter } from "./whatsappChatsRouter";
import { knowledgeBaseRouter } from "./knowledgeBaseRouter";
import { tradeRouter } from "./tradeRouter";
import { shipmentRouter } from "./shipmentRouter";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getDb, upsertUser } from "./db";
import { invoiceClients, invoices, invoiceItems } from "../drizzle/schema";
import { eq, desc, asc, and, isNull } from "drizzle-orm";


const quoteProxyProcedure = publicProcedure.use(({ ctx, next }) => {
  const expected = process.env.INVOICE_SITE_PROXY_KEY;
  const provided = ctx.req.header("x-invoice-site-proxy-key");
  const allowLocalWithoutKey =
    process.env.NODE_ENV === "development" && process.env.LOCAL_AUTH_BYPASS !== "false";

  if (!expected && allowLocalWithoutKey) return next();
  if (!expected || provided !== expected) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invoice proxy key is invalid" });
  }

  return next();
});



// ============================================================
// Auth Gate Router - allowlisted email login
// ============================================================
function isLocalAuthBypass() {
  return (
    process.env.LOCAL_AUTH_BYPASS === "true" ||
    (process.env.NODE_ENV === "development" && process.env.LOCAL_AUTH_BYPASS !== "false")
  );
}

const authGateRouter = router({
  checkVerified: publicProcedure.query(async ({ ctx }) => {
    if (isLocalAuthBypass()) return { verified: true, loggedIn: true, user: ctx.user ?? null };
    if (!ctx.user) return { verified: false, loggedIn: false, user: null };
    return { verified: isAllowedLoginEmail(ctx.user.email), loggedIn: true, user: ctx.user };
  }),
  loginWithEmail: publicProcedure
    .input(z.object({ email: z.string().trim().email().max(320) }))
    .mutation(async ({ ctx, input }) => {
      if (isLocalAuthBypass()) {
        return { success: true, message: "ログインしました" };
      }

      const email = normalizeLoginEmail(input.email);
      if (!isAllowedLoginEmail(email)) {
        return { success: false, message: "このメールアドレスは許可されていません" };
      }

      const db = await getDb();
      if (!db) throw new Error("データベースに接続できません");

      const openId = createEmailOpenId(email);
      await upsertUser({
        openId,
        name: email,
        email,
        loginMethod: EMAIL_AUTH_LOGIN_METHOD,
        role: "admin",
        lastSignedIn: new Date(),
      });

      const token = await sdk.createSessionToken(openId, {
        name: email,
        expiresInMs: ONE_YEAR_MS,
      });
      ctx.res.cookie(COOKIE_NAME, token, {
        ...getSessionCookieOptions(ctx.req),
        maxAge: ONE_YEAR_MS,
      });

      return { success: true, message: "ログインしました" };
    }),
});

export const appRouter = router({
  authGate: authGateRouter,
  system: systemRouter,
  inventory: inventoryRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  quoteProxy: router({
    invoiceClientsList: quoteProxyProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return db.select().from(invoiceClients).orderBy(asc(invoiceClients.name));
    }),

    invoicesGetNextNumber: quoteProxyProcedure.query(async () => {
      const db = await getDb();
      if (!db) return generateInvoiceNumber();
      const rows = await db.select({ invoiceNumber: invoices.invoiceNumber }).from(invoices).orderBy(desc(invoices.createdAt));
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

    invoicesCreate: quoteProxyProcedure
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
          await db.insert(invoiceItems).values(
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
  }),

  // Trade data management
  trade: tradeRouter,

  // ─── Invoice clients (宛先管理) ───────────────────────────────────────────
  invoiceClients: invoiceClientsRouter,

  // ─── Invoices (請求書) ────────────────────────────────────────────────────
  invoices: invoicesRouter,

  // ─── Invoice Settings (差出人デフォルト設定) ───────────────────────────────────────
  invoiceSettings: invoiceSettingsRouter,
  // ─── WhatsApp history upload & invoice number extraction ──────────────────
  whatsappHistory: whatsappHistoryRouter,

  // ─── WhatsApp会話履歴（読み返し用・和訳つき） ──────────────────────────────────
  whatsappChats: whatsappChatsRouter,

  // ─── Knowledge Base & AI Chat ────────────────────────────────────────────────
  knowledgeBase: knowledgeBaseRouter,

  // ─── Shipment (発送記録) Router ─────────────────────────────────────────────
  shipment: shipmentRouter,
});
export type AppRouter = typeof appRouter;
