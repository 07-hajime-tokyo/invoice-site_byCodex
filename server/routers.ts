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
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { inventoryRouter } from "./inventory/routers";
import { z } from "zod";
import { google } from "googleapis";
import { getDb, upsertUser } from "./db";
import { invoiceClients, invoices, invoiceItems, invoiceSettings, invoiceNumberHistory, whatsappChatHistory, chatKnowledge, aiChatMessages, chatConversations, tradeRecords, shipments, shipmentItems } from "../drizzle/schema";
import { eq, desc, asc, or, like, and, sql, isNull, isNotNull } from "drizzle-orm";

const SPREADSHEET_ID = "1yOBlT5PbKGQOILcd0LUqo0_Ql_27g6MbQLb-g5cHVyw";
const SHEET_NAME = "全体";

// 不可視文字（ゼロ幅スペース、WORD JOINERなど）を除去するヘルパー
function sanitizeText(str: string | null | undefined): string | null {
  if (str == null) return null;
  return str.replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').trim() || null;
}

// Fix private_key spaces that may be stripped by secret storage
function fixServiceAccountJson(jsonStr: string) {
  const credentials = JSON.parse(jsonStr);
  if (credentials.private_key) {
    credentials.private_key = credentials.private_key
      .replace(/-----BEGINPRIVATEKEY-----/g, "-----BEGIN PRIVATE KEY-----")
      .replace(/-----ENDPRIVATEKEY-----/g, "-----END PRIVATE KEY-----")
      .replace(/-----BEGINRSAPRIVATEKEY-----/g, "-----BEGIN RSA PRIVATE KEY-----")
      .replace(/-----ENDRSAPRIVATEKEY-----/g, "-----END RSA PRIVATE KEY-----")
      .replace(/\\n/g, "\n");
  }
  return credentials;
}

function getSheetsClient() {
  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON is not set");
  const credentials = fixServiceAccountJson(serviceAccountJson);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

function canSyncTradeSheet() {
  return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
}

function normalizeTradeCurrency(value: string | null | undefined) {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("usd") || text.includes("ドル") || text.includes("dollar")) return "USD";
  return "EUR";
}

function changedNumber(a: unknown, b: number) {
  return Math.abs(Number(a ?? 0) - b) > 0.0001;
}

// ─── WhatsApp chat parser ────────────────────────────────────────────────────
// Strategy:
//   1. Find the "order message" — the message that contains "invoice me" or
//      a block of lines starting with a number (qty-first format).
//   2. Extract only qty-first lines from that message block.
//   3. For price-list lines ("* Product: 95 Euros"), capture unit prices
//      and match them to order items by fuzzy name.
function parseWhatsAppChat(chatText: string): Array<{
  description: string;
  quantity: number;
  unitPrice: number;
  currency: string;
}> {
  // Split into message blocks by timestamp
  // Each block starts with a line matching [HH:MM, YYYY/M/D]
  const timestampRe = /^\[\d{1,2}:\d{2},\s*\d{4}\/\d{1,2}\/\d{1,2}\]/;

  const blocks: string[][] = [];
  let current: string[] = [];
  for (const rawLine of chatText.split("\n")) {
    if (timestampRe.test(rawLine.trim())) {
      if (current.length) blocks.push(current);
      current = [rawLine];
    } else {
      current.push(rawLine);
    }
  }
  if (current.length) blocks.push(current);

  // Build a price map from ALL blocks (price-list lines)
  const priceMap = new Map<string, { price: number; currency: string }>();
  const priceLineRe = /^\*?\s*(.+?):\s*([\d,]+(?:\.\d+)?)\s*(Euros?|EUR|USD|Dollars?|\$|€)?$/i;
  for (const block of blocks) {
    for (const rawLine of block) {
      const line = rawLine.trim();
      const m = line.match(priceLineRe);
      if (m) {
        const desc = m[1].trim().replace(/^\*\s*/, "").toLowerCase();
        const price = parseFloat(m[2].replace(/,/g, ""));
        const currRaw = (m[3] ?? "").toLowerCase();
        const currency = currRaw.startsWith("usd") || currRaw.startsWith("dollar") || currRaw === "$" ? "USD" : "EUR";
        priceMap.set(desc, { price, currency });
      }
    }
  }

  // Find the order block: contains "invoice me" or has multiple qty-first lines
  const qtyFirstRe = /^(\d+)\s+(.+)$/;
  const skipWords = new Set(["please", "also", "could", "hey", "hi", "below", "once", "if", "we", "i", "is", "are", "the", "and", "for", "with", "can", "that", "this", "from", "to", "be", "psp"]);

  let orderBlock: string[] | null = null;
  for (const block of blocks) {
    const text = block.join(" ").toLowerCase();
    if (text.includes("invoice me") || text.includes("please invoice")) {
      orderBlock = block;
      break;
    }
  }
  // Fallback: find block with most qty-first lines
  if (!orderBlock) {
    let best = 0;
    for (const block of blocks) {
      let count = 0;
      for (const line of block) {
        const m = line.trim().match(qtyFirstRe);
        if (m && !skipWords.has((m[2].split(/\s+/)[0] ?? "").toLowerCase())) count++;
      }
      if (count > best) { best = count; orderBlock = block; }
    }
  }

  if (!orderBlock) return [];

  const items: Array<{ description: string; quantity: number; unitPrice: number; currency: string }> = [];

  for (const rawLine of orderBlock) {
    const line = rawLine.trim();
    if (!line) continue;
    // Skip timestamp header line
    if (timestampRe.test(line)) continue;

    const m = line.match(qtyFirstRe);
    if (!m) continue;
    const qty = parseInt(m[1], 10);
    const desc = m[2].trim();
    if (desc.length < 2) continue;
    const firstWord = (desc.split(/\s+/)[0] ?? "").toLowerCase();
    if (skipWords.has(firstWord)) continue;

    // Try to find unit price from price map by fuzzy match
    let unitPrice = 0;
    let currency = "EUR";
    const descLower = desc.toLowerCase();
    for (const [key, val] of Array.from(priceMap.entries())) {
      // Simple containment match
      if (descLower.includes(key) || key.includes(descLower)) {
        unitPrice = val.price;
        currency = val.currency;
        break;
      }
    }

    items.push({ description: desc, quantity: qty, unitPrice, currency });
  }

  return items;
}

// ─── Extract sender name from WhatsApp chat ─────────────────────────────────
function extractSenderFromChat(chatText: string): string | null {
  const lines = chatText.split("\n");
  const timestampRe = /^\[(\d{1,2}:\d{2}),\s*\d{4}\/\d{1,2}\/\d{1,2}\]\s+([^:]+):/;
  let currentSender: string | null = null;
  for (const line of lines) {
    const m = line.match(timestampRe);
    if (m) currentSender = m[2].trim();
    const lower = line.toLowerCase();
    if (lower.includes("invoice me") || lower.includes("please invoice") || lower.includes("invoice for")) {
      return currentSender;
    }
  }
  return null;
}
// ─── Detect payments from WhatsApp chat ──────────────────────────────────────
function detectPaymentsFromChat(chatText: string): Array<{ invoiceNumber: string; confidence: "high" | "medium"; rawText: string }> {
  const results: Array<{ invoiceNumber: string; confidence: "high" | "medium"; rawText: string }> = [];
  const lines = chatText.split("\n");
  const paymentKeywords = ["paid", "payment sent", "transferred", "wire transfer", "bank transfer", "i have paid", "i've paid", "payment done", "payment made", "sent the payment", "sent payment", "money sent", "already paid"];
  const invoiceRe = /(?:invoice|inv)[\s\-#]*([0-9]{3,6})/gi;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].toLowerCase();
    const isPaymentLine = paymentKeywords.some(kw => line.includes(kw));
    if (!isPaymentLine) continue;
    const context = lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 4)).join(" ");
    const rawText = lines[i].trim();
    let match;
    invoiceRe.lastIndex = 0;
    const foundNums: string[] = [];
    while ((match = invoiceRe.exec(context)) !== null) {
      const num = match[1].padStart(4, "0");
      foundNums.push(num);
      results.push({ invoiceNumber: num, confidence: "high", rawText });
    }
    if (foundNums.length === 0) {
      results.push({ invoiceNumber: "", confidence: "medium", rawText });
    }
  }
  const seen = new Set<string>();
  return results.filter(r => {
    const key = r.invoiceNumber + r.rawText;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
// ─── Invoice number generator ──────────────────────────────────────────────
function generateInvoiceNumber(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `INV-${y}${m}${d}-${rand}`;
}

// ============================================================
// Shipment shipping cost & customs duty recalculation helper
// ============================================================
/**
 * 指定インボイスの送料・関税を再計算する。
 * - 全発送記録から当該インボイスの合計発送台数を集計
 * - 発送台数 >= 注文台数 なら実送料（按分）を適用
 * - それ以外は仮送料（550円×注文数）を維持
 * - USD取引の場合、各発送の発送日レートで関税（商品価格円換算×発送台数×10%）を計算
 */
async function recalcShippingCosts(
  db: Awaited<ReturnType<typeof getDb>>,
  invoiceNos: number[]
): Promise<void> {
  for (const invoiceNo of invoiceNos) {
    // 同じインボイスNoの全取引レコードを取得
    const trades = await db
      .select()
      .from(tradeRecords)
      .where(eq(tradeRecords.no, invoiceNo));
    if (trades.length === 0) continue;

    // 同一インボイスNoの全行の注文数合計を使用
    const orderedQty = trades.reduce((sum, t) => sum + Number(t.quantity ?? 0), 0);
    const isUSD = trades[0]?.currency === "ドル";

    // 全発送明細を取得
    const allItems = await db
      .select()
      .from(shipmentItems)
      .where(eq(shipmentItems.invoiceNo, invoiceNo));
    const shippedQty = allItems.reduce((s, i) => s + i.quantity, 0);

    let newShippingCost: number;

    if (shippedQty >= orderedQty && orderedQty > 0) {
      // 発送完了 → 実送料を按分計算
      let totalActualCost = 0;
      const shipmentIds = [...new Set(allItems.map((i) => i.shipmentId))];
      for (const sid of shipmentIds) {
        const [s] = await db.select().from(shipments).where(eq(shipments.id, sid));
        if (!s) continue;
        const allSidItems = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, sid));
        const totalQtyInShipment = allSidItems.reduce((sum, i) => sum + i.quantity, 0);
        const thisInvoiceQtyInShipment = allSidItems
          .filter((i) => i.invoiceNo === invoiceNo)
          .reduce((sum, i) => sum + i.quantity, 0);
        if (totalQtyInShipment > 0) {
          totalActualCost += (Number(s.shippingCost) / totalQtyInShipment) * thisInvoiceQtyInShipment;
        }
      }
      newShippingCost = Math.round(totalActualCost);
    } else {
      // 発送未完了 → 仮送料（550円×注文数）
      newShippingCost = 550 * orderedQty;
    }

    // USD取引の場合、各発送の発送日レートで関税を計算する
    // 関税 = 商品価格(円換算) × 発送台数 × 10%
    // 分割発送の場合は各発送の発送日レートで分割計算し合計する
    let newCustomsDuty: number | null = null;
    if (isUSD && allItems.length > 0) {
      const shipmentIds = [...new Set(allItems.map((i) => i.shipmentId))];
      let totalCustoms = 0;
      for (const sid of shipmentIds) {
        const [s] = await db.select().from(shipments).where(eq(shipments.id, sid));
        if (!s) continue;
        // 発送日のUSD/JPYレートをFrankfurter APIから取得
        let usdRate: number | null = null;
        try {
          const rateRes = await fetch(
            `https://api.frankfurter.dev/v1/${s.shippingDate}?from=USD&to=JPY`
          );
          if (rateRes.ok) {
            const rateData = await rateRes.json() as { rates?: { JPY?: number } };
            usdRate = rateData.rates?.JPY ?? null;
          }
        } catch {
          // レート取得失敗時はスキップ
        }
        if (usdRate === null) continue;
        // この発送に含まれるこのインボイスの台数
        const allSidItems = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, sid));
        const thisQty = allSidItems
          .filter((i) => i.invoiceNo === invoiceNo)
          .reduce((sum, i) => sum + i.quantity, 0);
        // 商品価格(円換算) = unitPrice × usdRate
        const unitPriceJPY = Number(trades[0]?.unitPrice ?? 0) * usdRate;
        totalCustoms += Math.round(unitPriceJPY * thisQty * 0.1);
      }
      newCustomsDuty = totalCustoms;
    }

    // 同一インボイスNoの全取引レコードの送料・関税・利益を更新
    for (const trade of trades) {
      const salesTotal = Number(trade.totalSales ?? 0);
      const procTotal = Number(trade.procurementTotal ?? 0);
      const refund = Number(trade.refund ?? 0);
      const customs = newCustomsDuty !== null ? newCustomsDuty : Number(trade.customsDuty ?? 0);
      const newProfit = salesTotal - procTotal + refund - newShippingCost - customs;
      await db
        .update(tradeRecords)
        .set({
          shippingCost: String(newShippingCost),
          ...(newCustomsDuty !== null ? { customsDuty: String(newCustomsDuty) } : {}),
          profitWithRefund: String(newProfit),
        })
        .where(eq(tradeRecords.id, trade.id));
    }
  }
}

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

  // Trade data management
  trade: router({
    // ─── DB-backed procedures ─────────────────────────────────────────────────
    /** DB から全取引データを取得する（フィルター・検索対応） */
    listFromDb: protectedProcedure
      .input(z.object({
        search: z.string().optional().default(""),
        year: z.string().optional().default(""),
        monthFrom: z.string().optional().default(""),
        monthTo: z.string().optional().default(""),
        partner: z.string().optional().default(""),
        currency: z.string().optional().default(""),
        status: z.string().optional().default(""),
        incompleteOnly: z.boolean().optional().default(false),
        page: z.number().int().min(1).optional().default(1),
        pageSize: z.number().int().min(20).max(5000).optional().default(20),
        sortKey: z.string().optional().default("no"),
        sortDir: z.enum(["asc", "desc", "none"]).optional().default("asc"),
      }))
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) {
          return {
            rows: [],
            totalCount: 0,
            summary: {
              totalProfit: 0,
              totalSales: 0,
              totalQty: 0,
              partners: 0,
              totalRefund: 0,
              totalShipping: 0,
              totalCustomsDuty: 0,
            },
          };
        }
        const conditions = [];
        if (input.search) {
          // スペースを除去した正規化キーワードで検索（例: "New3DSLL" → "New 3DS LL" にもマッチ）
          const normalized = input.search.replace(/\s+/g, "");
          const q = `%${input.search}%`;
          const qNorm = `%${normalized}%`;
          conditions.push(
            or(
              like(tradeRecords.productName, q),
              like(tradeRecords.partner, q),
              like(tradeRecords.status, q),
              sql`CAST(${tradeRecords.no} AS CHAR) LIKE ${q}`,
              // スペース除去後の商品名と照合
              sql`REPLACE(${tradeRecords.productName}, ' ', '') LIKE ${qNorm}`,
              sql`REPLACE(${tradeRecords.partner}, ' ', '') LIKE ${qNorm}`,
            )
          );
        }
        if (input.year) {
          conditions.push(like(tradeRecords.paymentDate, `${input.year}%`));
        }
        if (input.monthFrom) {
          conditions.push(sql`CAST(${tradeRecords.month} AS UNSIGNED) >= ${parseInt(input.monthFrom)}`);
        }
        if (input.monthTo) {
          conditions.push(sql`CAST(${tradeRecords.month} AS UNSIGNED) <= ${parseInt(input.monthTo)}`);
        }
        if (input.partner) {
          conditions.push(eq(tradeRecords.partner, input.partner));
        }
        if (input.currency) {
          conditions.push(eq(tradeRecords.currency, input.currency));
        }
        if (input.status) {
          conditions.push(eq(tradeRecords.status, input.status));
        }
        if (input.incompleteOnly) {
          conditions.push(
            sql`LOWER(${tradeRecords.status}) != 'complete'`
          );
        }
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const sortColumn = (() => {
          switch (input.sortKey) {
            case "month": return sql`CAST(${tradeRecords.month} AS UNSIGNED)`;
            case "partner": return tradeRecords.partner;
            case "paymentDate": return tradeRecords.paymentDate;
            case "productName": return tradeRecords.productName;
            case "quantity": return tradeRecords.quantity;
            case "unitPrice": return tradeRecords.unitPrice;
            case "currency": return tradeRecords.currency;
            case "unitPriceJPY": return tradeRecords.unitPriceJPY;
            case "status": return tradeRecords.status;
            case "totalSales": return tradeRecords.totalSales;
            case "procurementTotal": return tradeRecords.procurementTotal;
            case "profitWithRefund": return tradeRecords.profitWithRefund;
            default: return tradeRecords.no;
          }
        })();
        const orderExpr = input.sortDir === "desc" ? desc(sortColumn) : asc(sortColumn);
        const offset = (input.page - 1) * input.pageSize;
        const aggregateSelect = {
          totalCount: sql<string>`COUNT(*)`,
          totalProfit: sql<string>`COALESCE(SUM(${tradeRecords.profitWithRefund}), 0)`,
          totalSales: sql<string>`COALESCE(SUM(${tradeRecords.totalSales}), 0)`,
          totalQty: sql<string>`COALESCE(SUM(${tradeRecords.quantity}), 0)`,
          partners: sql<string>`COUNT(DISTINCT ${tradeRecords.partner})`,
          totalRefund: sql<string>`COALESCE(SUM(${tradeRecords.refund}), 0)`,
          totalShipping: sql<string>`COALESCE(SUM(${tradeRecords.shippingCost}), 0)`,
          totalCustomsDuty: sql<string>`COALESCE(SUM(${tradeRecords.customsDuty}), 0)`,
        };
        const [rows, aggregateRows] = await Promise.all([
          whereClause
            ? db.select().from(tradeRecords).where(whereClause).orderBy(orderExpr).limit(input.pageSize).offset(offset)
            : db.select().from(tradeRecords).orderBy(orderExpr).limit(input.pageSize).offset(offset),
          whereClause
            ? db.select(aggregateSelect).from(tradeRecords).where(whereClause)
            : db.select(aggregateSelect).from(tradeRecords),
        ]);
        const aggregate = aggregateRows[0] ?? {};
        const toNumber = (value: unknown) => Number(value ?? 0) || 0;
        return {
          rows,
          totalCount: toNumber(aggregate.totalCount),
          summary: {
            totalProfit: toNumber(aggregate.totalProfit),
            totalSales: toNumber(aggregate.totalSales),
            totalQty: toNumber(aggregate.totalQty),
            partners: toNumber(aggregate.partners),
            totalRefund: toNumber(aggregate.totalRefund),
            totalShipping: toNumber(aggregate.totalShipping),
            totalCustomsDuty: toNumber(aggregate.totalCustomsDuty),
          },
        };
      }),

    /** DB の取引データを更新する */
    updateInDb: protectedProcedure
      .input(z.object({
        id: z.number(),
        month: z.string().optional(),
        partner: z.string().optional(),
        paymentDate: z.string().optional(),
        productName: z.string().optional(),
        quantity: z.number().optional(),
        unitPrice: z.number().optional(),
        currency: z.string().optional(),
        status: z.string().optional(),
        procurement: z.string().optional(),
        shippingFromTokyo: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const { id, ...fields } = input;
        const updateData: Record<string, unknown> = {};
        if (fields.month !== undefined) updateData.month = fields.month;
        if (fields.partner !== undefined) updateData.partner = fields.partner;
        if (fields.paymentDate !== undefined) updateData.paymentDate = fields.paymentDate;
        if (fields.productName !== undefined) updateData.productName = fields.productName;
        if (fields.quantity !== undefined) updateData.quantity = String(fields.quantity);
        if (fields.unitPrice !== undefined) updateData.unitPrice = String(fields.unitPrice);
        if (fields.currency !== undefined) updateData.currency = fields.currency;
        if (fields.status !== undefined) updateData.status = fields.status;
        if (fields.procurement !== undefined) updateData.procurement = fields.procurement;
        if (fields.shippingFromTokyo !== undefined) updateData.shippingFromTokyo = fields.shippingFromTokyo;
        await db.update(tradeRecords).set(updateData).where(eq(tradeRecords.id, id));
        return { success: true };
      }),

    /** DB の取引データを削除する */
    deleteFromDb: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.delete(tradeRecords).where(eq(tradeRecords.id, input.id));
        return { success: true };
      }),

    /** DB のフィルター用ユニーク値を取得する */
    getFilterOptions: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return { years: [], partners: [], currencies: [], statuses: [] };
      const [yearRows, partnerRows, currencyRows, statusRows] = await Promise.all([
        db.selectDistinct({ value: sql<string>`SUBSTRING(${tradeRecords.paymentDate}, 1, 4)` })
          .from(tradeRecords)
          .where(isNotNull(tradeRecords.paymentDate)),
        db.selectDistinct({ value: tradeRecords.partner })
          .from(tradeRecords)
          .where(isNotNull(tradeRecords.partner)),
        db.selectDistinct({ value: tradeRecords.currency })
          .from(tradeRecords)
          .where(isNotNull(tradeRecords.currency)),
        db.selectDistinct({ value: tradeRecords.status })
          .from(tradeRecords)
          .where(isNotNull(tradeRecords.status)),
      ]);
      const toOptions = (rows: Array<{ value: string | null }>) =>
        rows.map((r) => r.value?.trim()).filter((v): v is string => !!v).sort();
      const years = toOptions(yearRows);
      const partners = toOptions(partnerRows);
      const currencies = toOptions(currencyRows);
      const statuses = toOptions(statusRows);
      const monthRows = await db.selectDistinct({ value: tradeRecords.month })
        .from(tradeRecords)
        .where(isNotNull(tradeRecords.month));
      const months = toOptions(monthRows).sort((a, b) => parseInt(a) - parseInt(b));
      return { years, months, partners, currencies, statuses };
    }),

    // ─── Spreadsheet-backed procedures (kept for write-back) ─────────────────
    getExchangeRates: protectedProcedure.query(async () => {
      const sheets = getSheetsClient();
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!G1:H2`,
      });
      const rows = response.data.values ?? [];
      const eurRate = parseFloat(rows[0]?.[0] ?? "0");
      const usdRate = parseFloat(rows[1]?.[0] ?? "0");
      return { eur: eurRate, usd: usdRate };
    }),

    getRateByDate: protectedProcedure
      .input(z.object({
        date: z.string(), // YYYY-MM-DD or "latest"
        currency: z.enum(["EUR", "USD"]),
      }))
      .query(async ({ input }) => {
        const endpoint = input.date === "latest"
          ? `https://api.frankfurter.dev/v1/latest?from=${input.currency}&to=JPY`
          : `https://api.frankfurter.dev/v1/${input.date}?from=${input.currency}&to=JPY`;
        const res = await fetch(endpoint);
        if (!res.ok) throw new Error(`Frankfurter API error: ${res.status}`);
        const data = await res.json() as { rates: { JPY?: number } };
        const rate = data.rates?.JPY;
        if (!rate) throw new Error("JPY rate not found");
        return { rate };
      }),

    findRowByInvoiceNo: protectedProcedure
      .input(z.object({ invoiceNo: z.string() }))
      .query(async ({ input }) => {
        const sheets = getSheetsClient();
        const response = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!C:C`,
        });
        const rows = response.data.values ?? [];
        for (let i = 3; i < rows.length; i++) {
          const cell = String(rows[i]?.[0] ?? "").trim();
          if (cell === input.invoiceNo.trim()) {
            return { rowIndex: i + 1 };
          }
        }
        return { rowIndex: null };
      }),

    updateRecord: protectedProcedure
      .input(z.object({
        invoiceNo: z.string().min(1),
        month: z.number().min(1).max(12),
        partner: z.string().min(1),
        paymentDate: z.string(),
        productName: z.string().min(1),
        customsDuty: z.number().optional(),
        quantity: z.number().min(1),
        unitPrice: z.number().min(0),
        currency: z.enum(["ユーロ", "ドル"]),
        status: z.string().default(""),
        eurRate: z.number().optional(),
        usdRate: z.number().optional(),
        procurementTotal: z.number().default(0),
        refund: z.number().default(0),
        shippingCost: z.number().default(0),
      }))
      .mutation(async ({ input }) => {
        if (!canSyncTradeSheet()) {
          const db = await getDb();
          if (db) {
            const no = parseInt(input.invoiceNo) || null;
            const paymentDate = input.paymentDate && input.paymentDate.trim() !== ""
              ? input.paymentDate
              : null;
            if (no === null) return { success: true, updatedRow: null, sheetSync: "skipped" as const };
            const existing = await db.select().from(tradeRecords)
              .where(eq(tradeRecords.no, no))
              .orderBy(asc(tradeRecords.id));
            const target = existing.find(r => r.productName === input.productName) ?? existing[0];
            if (target) {
              const shouldRecalculateSales =
                changedNumber(target.quantity, input.quantity) ||
                changedNumber(target.unitPrice, input.unitPrice) ||
                normalizeTradeCurrency(target.currency) !== normalizeTradeCurrency(input.currency);
              const rate = input.currency === "繝ｦ繝ｼ繝ｭ"
                ? (input.eurRate ?? null)
                : (input.usdRate ?? null);
              const normalizedRate = normalizeTradeCurrency(input.currency) === "EUR"
                ? (input.eurRate ?? null)
                : (input.usdRate ?? null);
              const unitPriceJPY = shouldRecalculateSales && normalizedRate ? Math.round(input.unitPrice * normalizedRate * 10000) / 10000 : null;
              const totalSalesNew = unitPriceJPY ? Math.round(input.quantity * unitPriceJPY * 10000) / 10000 : null;
              const effectiveTotalSales = totalSalesNew ?? Number(target.totalSales ?? 0);
              const customsDuty = input.customsDuty !== undefined
                ? input.customsDuty
                : Number(target.customsDuty ?? 0);
              const profitWithRefund = effectiveTotalSales > 0
                ? Math.round((effectiveTotalSales - input.procurementTotal + input.refund - input.shippingCost - customsDuty) * 10000) / 10000
                : null;
              await db.update(tradeRecords)
                .set({
                  month: String(input.month),
                  partner: input.partner,
                  paymentDate,
                  productName: input.productName,
                  quantity: String(input.quantity),
                  unitPrice: String(input.unitPrice),
                  currency: input.currency,
                  status: input.status,
                  ...(unitPriceJPY !== null ? { unitPriceJPY: String(unitPriceJPY) } : {}),
                  ...(totalSalesNew !== null ? { totalSales: String(totalSalesNew) } : {}),
                  procurementTotal: String(input.procurementTotal),
                  refund: String(input.refund),
                  shippingCost: String(input.shippingCost),
                  customsDuty: String(customsDuty),
                  ...(profitWithRefund !== null ? { profitWithRefund: String(profitWithRefund) } : {}),
                })
                .where(eq(tradeRecords.id, target.id));
            }
          }
          return { success: true, updatedRow: null, sheetSync: "skipped" as const };
        }
        const sheets = getSheetsClient();
        // C列(インボイスNo)とE列(商品名)を同時取得し、インボイスNo+商品名で行を特定
        const searchResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!C:E`,
        });
        const rows = searchResponse.data.values ?? [];
        let targetRow: number | null = null;
        for (let i = 3; i < rows.length; i++) {
          const invoiceCell = String(rows[i]?.[0] ?? "").trim();
          const productCell = String(rows[i]?.[2] ?? "").trim();
          if (invoiceCell === input.invoiceNo.trim() && productCell === input.productName.trim()) {
            targetRow = i + 1;
            break;
          }
        }
        // 商品名で見つからない場合はインボイスNoのみで最初の行を使用
        if (targetRow === null) {
          for (let i = 3; i < rows.length; i++) {
            const invoiceCell = String(rows[i]?.[0] ?? "").trim();
            if (invoiceCell === input.invoiceNo.trim()) {
              targetRow = i + 1;
              break;
            }
          }
        }
        if (targetRow === null) {
          throw new Error(`インボイスNo. ${input.invoiceNo} の行が見つかりませんでした。`);
        }
        // A〜H列（商品価格(円)のI列は数式のため書き込まない）とJ列（状況）を別々に更新
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: [
              {
                range: `${SHEET_NAME}!A${targetRow}:H${targetRow}`,
                values: [[
                  input.month,
                  input.partner,
                  input.invoiceNo,
                  input.paymentDate,
                  input.productName,
                  input.quantity,
                  input.unitPrice,
                  input.currency,
                ]],
              },
              {
                range: `${SHEET_NAME}!J${targetRow}`,
                values: [[input.status]],
              },
            ],
          },
        });

        // DBも同時更新
        const db = await getDb();
        if (db) {
          const no = parseInt(input.invoiceNo) || null;
          const paymentDate = input.paymentDate && input.paymentDate.trim() !== ""
            ? input.paymentDate
            : null;
          // noが一致するレコードを更新（noが同じ行が複数ある場合は商品名でも絞り込む）
          if (no === null) return { success: false, updatedRow: targetRow };
          const existing = await db.select().from(tradeRecords)
            .where(eq(tradeRecords.no, no))
            .orderBy(asc(tradeRecords.id));
          if (existing.length > 0) {
            // 商品名が一致するレコードを更新、なければ最初のレコードを更新
            const target = existing.find(r => r.productName === input.productName) ?? existing[0];
            // 商品価格(円)・売上合計・還付込利益を自動計算
            const rate = input.currency === "ユーロ"
              ? (input.eurRate ?? null)
              : (input.usdRate ?? null);
            const normalizedRate = normalizeTradeCurrency(input.currency) === "EUR"
              ? (input.eurRate ?? null)
              : (input.usdRate ?? null);
            const shouldRecalculateSales =
              changedNumber(target.quantity, input.quantity) ||
              changedNumber(target.unitPrice, input.unitPrice) ||
              normalizeTradeCurrency(target.currency) !== normalizeTradeCurrency(input.currency);
            const unitPriceJPY = shouldRecalculateSales && normalizedRate ? Math.round(input.unitPrice * normalizedRate * 10000) / 10000 : null;
            const totalSalesNew = unitPriceJPY ? Math.round(input.quantity * unitPriceJPY * 10000) / 10000 : null;
            // 為替レートが未取得の場合はDBの既存totalSalesを使って利益を計算する
            const effectiveTotalSales = totalSalesNew ?? Number(target.totalSales ?? 0);
            // 関税: 入力値があればそれを使用、なければ既存DB値を維持
            const customsDuty = input.customsDuty !== undefined
              ? input.customsDuty
              : Number(target.customsDuty ?? 0);
            const profitWithRefund = effectiveTotalSales > 0
              ? Math.round((effectiveTotalSales - input.procurementTotal + input.refund - input.shippingCost - customsDuty) * 10000) / 10000
              : null;

            await db.update(tradeRecords)
              .set({
                month: String(input.month),
                partner: input.partner,
                paymentDate,
                productName: input.productName,
                quantity: String(input.quantity),
                unitPrice: String(input.unitPrice),
                currency: input.currency,
                status: input.status,
                ...(unitPriceJPY !== null ? { unitPriceJPY: String(unitPriceJPY) } : {}),
                ...(totalSalesNew !== null ? { totalSales: String(totalSalesNew) } : {}),
                procurementTotal: String(input.procurementTotal),
                refund: String(input.refund),
                shippingCost: String(input.shippingCost),
                customsDuty: String(customsDuty),
                ...(profitWithRefund !== null ? { profitWithRefund: String(profitWithRefund) } : {}),
              })
              .where(eq(tradeRecords.id, target.id));
          }
        }

        return { success: true, updatedRow: targetRow };
      }),

    addRecord: protectedProcedure
      .input(z.object({
        month: z.number().min(1).max(12),
        partner: z.string().min(1),
        invoiceNo: z.string().min(1),
        paymentDate: z.string().optional().default(""),
        productName: z.string().min(1),
        quantity: z.number().min(1),
        unitPrice: z.number().min(0),
        currency: z.enum(["ユーロ", "ドル"]),
        status: z.string().default(""),
        eurRate: z.number().min(0),
        usdRate: z.number().min(0),
        shippingCost: z.number().default(0),
      }))
      .mutation(async ({ input }) => {
        if (!canSyncTradeSheet()) {
          const db = await getDb();
          if (db) {
            const no = parseInt(input.invoiceNo) || null;
            const unitPriceJPY = input.currency === "繝ｦ繝ｼ繝ｭ"
              ? input.unitPrice * input.eurRate
              : input.unitPrice * input.usdRate;
            const totalSales = unitPriceJPY * input.quantity;
            const paymentDate = input.paymentDate && input.paymentDate.trim() !== ""
              ? input.paymentDate
              : null;
            await db.insert(tradeRecords).values({
              month: String(input.month),
              partner: input.partner,
              no,
              paymentDate,
              productName: input.productName,
              quantity: String(input.quantity),
              unitPrice: String(input.unitPrice),
              currency: input.currency,
              unitPriceJPY: String(unitPriceJPY),
              status: input.status,
              procurement: "",
              shippingFromTokyo: "",
              totalSales: String(totalSales),
              procurementTotal: "0",
              refund: "0",
              shippingCost: String(input.shippingCost),
              profitWithRefund: String(totalSales - input.shippingCost),
              cumulativeProfit: "0",
            });
          }
          return { success: true, sheetSync: "skipped" as const };
        }
        const sheets = getSheetsClient();
        await sheets.spreadsheets.values.batchUpdate({
          spreadsheetId: SPREADSHEET_ID,
          requestBody: {
            valueInputOption: "USER_ENTERED",
            data: [
              { range: `${SHEET_NAME}!G1`, values: [[input.eurRate]] },
              { range: `${SHEET_NAME}!G2`, values: [[input.usdRate]] },
            ],
          },
        });
        // 現在の最終行番号を取得して、追加後の行番号を計算する
        const existingData = await sheets.spreadsheets.values.get({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A:A`,
        });
        const existingRows = existingData.data.values ?? [];
        const newRowNumber = existingRows.length + 1; // 追加後の行番号

        const newRow = [
          input.month,
          input.partner,
          input.invoiceNo,
          input.paymentDate,
          input.productName,
          input.quantity,
          input.unitPrice,
          input.currency,
          `=G${newRowNumber}*G1`, // I列: 商品価格 = 単価 × EUR/USDレート
          input.status,
        ];
        await sheets.spreadsheets.values.append({
          spreadsheetId: SPREADSHEET_ID,
          range: `${SHEET_NAME}!A:J`,
          valueInputOption: "USER_ENTERED",
          requestBody: { values: [newRow] },
        });

        // DBにも同時保存
        const db = await getDb();
        if (db) {
          const no = parseInt(input.invoiceNo) || null;
          const unitPriceJPY = input.currency === "ユーロ"
            ? input.unitPrice * input.eurRate
            : input.unitPrice * input.usdRate;
          const totalSales = unitPriceJPY * input.quantity;
          const paymentDate = input.paymentDate && input.paymentDate.trim() !== ""
            ? input.paymentDate
            : null;
          await db.insert(tradeRecords).values({
            month: String(input.month),
            partner: input.partner,
            no,
            paymentDate,
            productName: input.productName,
            quantity: String(input.quantity),
            unitPrice: String(input.unitPrice),
            currency: input.currency,
            unitPriceJPY: String(unitPriceJPY),
            status: input.status,
            procurement: "",
            shippingFromTokyo: "",
            totalSales: String(totalSales),
            procurementTotal: "0",
            refund: "0",
            shippingCost: String(input.shippingCost),
            profitWithRefund: String(totalSales - input.shippingCost),
            cumulativeProfit: "0",
          });
        }

        return { success: true };
      }),
  }),

  // ─── Invoice clients (宛先管理) ───────────────────────────────────────────
  invoiceClients: router({
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
  }),

  // ─── Invoices (請求書) ────────────────────────────────────────────────────
  invoices: router({
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

    imageAnalysisStatus: protectedProcedure.query(() => ({
      enabled: Boolean(process.env.BUILT_IN_FORGE_API_URL && process.env.BUILT_IN_FORGE_API_KEY),
    })),

    // Analyze screenshot image to extract invoice line items using Forge API
    analyzeScreenshot: protectedProcedure
      .input(z.object({
        base64: z.string(),
        mimeType: z.string().default("image/png"),
      }))
      .mutation(async ({ input }) => {
        const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
        if (!forgeUrl || !forgeKey) {
          throw new Error("画像解析APIが未設定です。テキストに切替、または手動で行を追加してください。");
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
          accentColor: input.accentColor ?? "#1a56db",
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
            accentColor: input.accentColor ?? "#1a56db",
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
          const result = await db.insert(invoices).values({
            invoiceNumber: split.invoiceNumber,
            clientId: input.clientId ?? null,
            clientSnapshot: input.clientSnapshot ?? null,
            invoiceDate: input.invoiceDate ?? null,
            dueDate: input.dueDate ?? null,
            currency: input.currency,
            showAmounts: input.showAmounts,
            notes: input.notes ?? null,
            rawChat: input.rawChat ?? null,
            status: input.status,
            accentColor: input.accentColor ?? "#1a56db",
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
  }),

  // ─── Invoice Settings (差出人デフォルト設定) ───────────────────────────────────────
  invoiceSettings: router({
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
        const { storagePut } = await import("./storage");
        const buffer = Buffer.from(input.base64, "base64");
        const key = `invoice-logos/${Date.now()}-${input.fileName}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url, key };
      }),
   }),
  // ─── WhatsApp history upload & invoice number extraction ──────────────────
  whatsappHistory: router({
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
  }),

  // ─── Knowledge Base & AI Chat ────────────────────────────────────────────────
  knowledgeBase: router({
    /**
     * Upload files to the knowledge base.
     * Accepts: WhatsApp _chat.txt, screenshots (images), invoice PDFs.
     * Text files are stored directly; images/PDFs are uploaded to S3.
     * AI extracts and summarizes content, saves to chat_knowledge table.
     */
    upload: protectedProcedure
      .input(z.object({
        files: z.array(z.object({
          name: z.string(),
          base64: z.string(),
          mimeType: z.string(),
          /** Optional: date when screenshot was taken, e.g. '2026/03/26' */
          screenshotDate: z.string().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
        if (!forgeUrl || !forgeKey) throw new Error("Forge API not configured");
        const { storagePut } = await import("./storage");

        const results: Array<{ name: string; status: "ok" | "error"; message?: string }> = [];

        for (const file of input.files) {
          try {
            const isText = file.name.endsWith(".txt") || file.mimeType === "text/plain";
            const isImage = file.mimeType.startsWith("image/");
            const isPdf = file.mimeType === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

            if (isText) {
              // Parse text directly
              const text = Buffer.from(file.base64, "base64").toString("utf8");
              // Summarize with AI (with fallback if API unavailable)
              let summary = text.slice(0, 5000);
              try {
                const res = await fetch(`${forgeUrl}/v1/chat/completions`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${forgeKey}` },
                  body: JSON.stringify({
                    model: "gpt-4o-mini",
                    messages: [{
                      role: "user",
                      content: `以下はWhatsAppのチャット履歴テキストです。このテキストから以下の情報を抽出・整理してください：
1. 取引の概要（誰と誰のやり取りか、期間）
2. 注文・取引内容（商品名、数量、価格、通貨）
3. インボイス番号の一覧（例: Invoice - 0372.pdf）
4. 支払い確認の記録
5. その他重要な情報

元のテキストも含めて、検索しやすい形式で整理してください。

テキスト:
${text.slice(0, 12000)}`
                    }],
                    max_tokens: 2000,
                  }),
                });
                if (res.ok) {
                  const data = await res.json() as any;
                  summary = data.choices?.[0]?.message?.content ?? summary;
                } else {
                  console.warn(`[knowledgeBase.upload] AI API returned ${res.status} for ${file.name}, using raw text`);
                }
              } catch (aiErr: any) {
                console.warn(`[knowledgeBase.upload] AI API error for ${file.name}: ${aiErr.message}, using raw text`);
              }
              // Store full text + summary
              const fullContent = `=== ファイル: ${file.name} ===

【AI要約】
${summary}

【原文】
${text}`;
              await db.insert(chatKnowledge).values({
                sourceType: "chat_text",
                sourceLabel: file.name,
                content: fullContent,
              });
              results.push({ name: file.name, status: "ok" });

            } else if (isImage) {
              // Upload image to S3
              const buffer = Buffer.from(file.base64, "base64");
              const key = `knowledge-base/${Date.now()}-${file.name}`;
              const { url } = await storagePut(key, buffer, file.mimeType);
              // Analyze with vision AI (with fallback)
              let analysis = `画像ファイル: ${file.name}（AI解析なし）`;
              const dateHint = file.screenshotDate
                ? `\n\n重要: このスクリーンショットの撮影日は ${file.screenshotDate} です。画像内の時刻表示（例: "1:39"）はこの日付のものとして解釈し、絶対日時（${file.screenshotDate} 1:39等）として記載してください。`
                : "";
              try {
                const res = await fetch(`${forgeUrl}/v1/chat/completions`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${forgeKey}` },
                  body: JSON.stringify({
                    model: "gpt-4o",
                    messages: [{
                      role: "user",
                      content: [
                        {
                          type: "text",
                          text: `このWhatsAppのスクリーンショットを詳しく分析してください。以下の情報を抽出してください：
1. 会話の参加者（送信者・受信者の名前）
2. 日付・時刻（画像内の時刻を絶対日時に変換してください）
3. 注文・取引内容（商品名、数量、価格、通貨）
4. インボイス番号（例: Invoice - 0372.pdf）
5. 支払い確認の記録
6. その他重要な情報${dateHint}`
                        },
                        {
                          type: "image_url",
                          image_url: { url: `data:${file.mimeType};base64,${file.base64}` }
                        }
                      ]
                    }],
                    max_tokens: 1500,
                  }),
                });
                if (res.ok) {
                  const data = await res.json() as any;
                  analysis = data.choices?.[0]?.message?.content ?? analysis;
                } else {
                  console.warn(`[knowledgeBase.upload] AI API returned ${res.status} for ${file.name}`);
                }
              } catch (aiErr: any) {
                console.warn(`[knowledgeBase.upload] AI API error for ${file.name}: ${aiErr.message}`);
              }
              const dateLabel = file.screenshotDate ? ` [撮影日: ${file.screenshotDate}]` : "";
              await db.insert(chatKnowledge).values({
                sourceType: "screenshot",
                sourceLabel: file.name,
                dateRange: file.screenshotDate ?? null,
                content: `=== スクリーンショット: ${file.name}${dateLabel} ===

【撮影日】${file.screenshotDate ?? "不明"}

【AI解析結果】
${analysis}`,
                imageUrl: url,
                imageKey: key,
              });
              results.push({ name: file.name, status: "ok" });

            } else if (isPdf) {
              // Upload PDF to S3
              const buffer = Buffer.from(file.base64, "base64");
              const key = `knowledge-base/${Date.now()}-${file.name}`;
              const { url } = await storagePut(key, buffer, "application/pdf");
              // Use AI to analyze PDF (with fallback)
              let analysis = `PDFファイル: ${file.name}（AI解析なし）`;
              try {
                const res = await fetch(`${forgeUrl}/v1/chat/completions`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", "Authorization": `Bearer ${forgeKey}` },
                  body: JSON.stringify({
                    model: "gpt-4o",
                    messages: [{
                      role: "user",
                      content: [
                        {
                          type: "text",
                          text: `このインボイスPDFを分析してください。以下の情報を抽出してください：
1. インボイス番号
2. 発行日・支払期限
3. 送付先（会社名・担当者名・住所）
4. 品目一覧（商品名、数量、単価、通貨）
5. 合計金額
6. その他重要な情報

日本語で詳しく回答してください。`
                        },
                        {
                          type: "image_url",
                          image_url: { url: `data:application/pdf;base64,${file.base64}` }
                        }
                      ]
                    }],
                    max_tokens: 1500,
                  }),
                });
                if (res.ok) {
                  const data = await res.json() as any;
                  analysis = data.choices?.[0]?.message?.content ?? analysis;
                } else {
                  console.warn(`[knowledgeBase.upload] AI API returned ${res.status} for ${file.name}`);
                }
              } catch (aiErr: any) {
                console.warn(`[knowledgeBase.upload] AI API error for ${file.name}: ${aiErr.message}`);
              }
              // Extract invoice number from filename
              const invMatch = file.name.match(/Invoice\s*-?\s*(\d{3,6})/i);
              const invNum = invMatch ? invMatch[1] : "";
              await db.insert(chatKnowledge).values({
                sourceType: "invoice_pdf",
                sourceLabel: file.name,
                content: `=== インボイスPDF: ${file.name}${invNum ? ` (No.${invNum})` : ""} ===

【AI解析結果】
${analysis}`,
                imageUrl: url,
                imageKey: key,
              });
              results.push({ name: file.name, status: "ok" });
            } else {
              results.push({ name: file.name, status: "error", message: "対応していないファイル形式です" });
            }
          } catch (e: any) {
            results.push({ name: file.name, status: "error", message: e.message ?? "不明なエラー" });
          }
        }
        return { results };
      }),

    /**
     * List all knowledge base entries.
     */
    list: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return await db.select({
        id: chatKnowledge.id,
        sourceType: chatKnowledge.sourceType,
        sourceLabel: chatKnowledge.sourceLabel,
        dateRange: chatKnowledge.dateRange,
        imageUrl: chatKnowledge.imageUrl,
        createdAt: chatKnowledge.createdAt,
      }).from(chatKnowledge).orderBy(desc(chatKnowledge.createdAt));
    }),

    /**
     * Delete a knowledge base entry.
     */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.delete(chatKnowledge).where(eq(chatKnowledge.id, input.id));
        return { success: true };
      }),

    /**
     * Create a new conversation session.
     */
    createConversation: protectedProcedure
      .input(z.object({ title: z.string().optional() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const [row] = await db.insert(chatConversations).values({
          title: input.title ?? "新しいチャット",
        }).$returningId();
        return { id: row.id, title: input.title ?? "新しいチャット" };
      }),

    /**
     * List all conversations.
     */
    listConversations: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) return [];
      return await db.select().from(chatConversations).orderBy(desc(chatConversations.updatedAt));
    }),

    /**
     * Delete a conversation and all its messages.
     */
    deleteConversation: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        await db.delete(aiChatMessages).where(eq(aiChatMessages.conversationId, input.id));
        await db.delete(chatConversations).where(eq(chatConversations.id, input.id));
        return { success: true };
      }),

    /**
     * AI Chat — answers questions using knowledge base as context.
     * Retrieves relevant knowledge entries and passes them to AI.
     */
    chat: protectedProcedure
      .input(z.object({
        message: z.string().min(1),
        conversationId: z.number().optional(),
        history: z.array(z.object({
          role: z.enum(["user", "assistant"]),
          content: z.string(),
        })).optional().default([]),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
        if (!forgeUrl || !forgeKey) throw new Error("Forge API not configured");

        // Retrieve all knowledge entries as context
        // Strategy: allocate budget per entry so ALL entries are represented,
        // even if each is trimmed. Large chat files get more budget than small invoices.
        const knowledgeRows = await db.select().from(chatKnowledge).orderBy(desc(chatKnowledge.createdAt));
        const TOTAL_CONTEXT_BUDGET = 100000; // ~100k chars fits well within gpt-4o context
        let contextText = "";
        if (knowledgeRows.length > 0) {
          // First pass: give each entry a proportional budget based on content length
          const totalContentLen = knowledgeRows.reduce((s, r) => s + (r.content?.length ?? 0), 0);
          const entries = knowledgeRows.map(r => {
            const content = r.content ?? "";
            const proportion = totalContentLen > 0 ? content.length / totalContentLen : 1 / knowledgeRows.length;
            const budget = Math.max(500, Math.floor(TOTAL_CONTEXT_BUDGET * proportion));
            const trimmed = content.length > budget ? content.slice(0, budget) + "\n...(省略)" : content;
            return `[${r.sourceLabel ?? r.sourceType}]\n${trimmed}`;
          });
          contextText = entries.join("\n\n---\n\n");
        }

        const systemPrompt = `あなたはWhatsAppの取引チャット履歴とインボイスデータを分析するアシスタントです。
以下の知識ベース（アップロードされたチャット履歴・インボイスPDFから抽出した情報）を参照して、ユーザーの質問に日本語で答えてください。

知識ベースに情報がない場合は「その情報は知識ベースに含まれていません」と正直に答えてください。

=== 知識ベース (${knowledgeRows.length}件) ===
${contextText || "（まだデータがアップロードされていません）"}`;

        const messages = [
          { role: "system" as const, content: systemPrompt },
          ...input.history.map(h => ({ role: h.role as "user" | "assistant", content: h.content })),
          { role: "user" as const, content: input.message },
        ];

        const res = await fetch(`${forgeUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${forgeKey}` },
          body: JSON.stringify({
            model: "gpt-4o",
            messages,
            max_tokens: 2000,
          }),
        });
        if (!res.ok) throw new Error(`AI API error: ${res.status}`);
        const data = await res.json() as any;
        const reply = data.choices?.[0]?.message?.content ?? "回答を生成できませんでした";

        // Save to DB with conversationId
        await db.insert(aiChatMessages).values({ role: "user", content: input.message, conversationId: input.conversationId ?? null });
        await db.insert(aiChatMessages).values({ role: "assistant", content: reply, conversationId: input.conversationId ?? null });

        // Auto-update conversation title from first message if still default
        if (input.conversationId) {
          const conv = await db.select().from(chatConversations).where(eq(chatConversations.id, input.conversationId)).limit(1);
          if (conv[0]?.title === "新しいチャット") {
            const autoTitle = input.message.slice(0, 40) + (input.message.length > 40 ? "..." : "");
            await db.update(chatConversations).set({ title: autoTitle }).where(eq(chatConversations.id, input.conversationId));
          }
        }

        return { reply };
      }),

    /**
     * Get AI chat history for a specific conversation.
     */
    getChatHistory: protectedProcedure
      .input(z.object({ conversationId: z.number().optional() }).optional())
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) return [];
        if (input?.conversationId) {
          return await db.select().from(aiChatMessages)
            .where(eq(aiChatMessages.conversationId, input.conversationId))
            .orderBy(asc(aiChatMessages.createdAt)).limit(200);
        }
        return await db.select().from(aiChatMessages).orderBy(asc(aiChatMessages.createdAt)).limit(200);
      }),

    /**
     * Clear AI chat history (all or by conversationId).
     */
    clearChatHistory: protectedProcedure
      .input(z.object({ conversationId: z.number().optional() }).optional())
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        if (input?.conversationId) {
          await db.delete(aiChatMessages).where(eq(aiChatMessages.conversationId, input.conversationId));
        } else {
          await db.delete(aiChatMessages);
        }
        return { success: true };
      }),

    /**
     * Extract invoice items / payment detections from knowledge base.
     * Used by the "ファイル抽出" and "支払い検知" buttons.
     */
    extractFromKnowledge: protectedProcedure
      .input(z.object({
        mode: z.enum(["invoice_items", "payment_detection"]),
      }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
        if (!forgeUrl || !forgeKey) throw new Error("Forge API not configured");

        const knowledgeRows = await db.select().from(chatKnowledge).orderBy(desc(chatKnowledge.createdAt));
        const contextText = knowledgeRows.map(r => r.content).join("\n\n---\n\n").slice(0, 20000);

        const prompt = input.mode === "invoice_items"
          ? `以下の知識ベースから、まだインボイスが作成されていない可能性のある注文・取引を抽出してください。
以下のJSON形式で返してください：
{
  "orders": [
    {
      "description": "商品名",
      "quantity": 数量,
      "unitPrice": 単価,
      "currency": "EUR",
      "buyer": "購入者名",
      "invoiceNumber": "関連インボイス番号（あれば）",
      "rawText": "元のテキスト"
    }
  ]
}

知識ベース:
${contextText}`
          : `以下の知識ベースから、支払いが確認された取引を抽出してください。
以下のJSON形式で返してください：
{
  "payments": [
    {
      "invoiceNumber": "インボイス番号",
      "amount": "金額（わかれば）",
      "currency": "通貨",
      "paidBy": "支払者名",
      "date": "支払日（わかれば）",
      "confidence": "high/medium/low",
      "rawText": "元のテキスト"
    }
  ]
}

知識ベース:
${contextText}`;

        const res = await fetch(`${forgeUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${forgeKey}` },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 2000,
          }),
        });
        if (!res.ok) throw new Error(`AI API error: ${res.status}`);
        const data = await res.json() as any;
        const text = data.choices?.[0]?.message?.content ?? "{}";
        try {
          const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          return JSON.parse(clean);
        } catch {
          return input.mode === "invoice_items" ? { orders: [] } : { payments: [] };
        }
      }),

    // 知識ベースから送信済み・支払済みのインボイスを検知する
    detectStatusFromKnowledge: protectedProcedure
      .mutation(async () => {
        const db = await getDb();
        if (!db) throw new Error("DB not available");
        const knowledge = await db.select().from(chatKnowledge).orderBy(desc(chatKnowledge.createdAt));
        if (knowledge.length === 0) {
          return { sent: [], paid: [], message: "知識ベースが空です。先にファイルをアップロードしてください。" };
        }
        const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
        if (!forgeUrl || !forgeKey) throw new Error("AI API not configured");

        // 撮影日でソートして時系列順に並べる（dateRangeがある場合は日付順、ない場合は末尾）
        const sortedKnowledge = [...knowledge].sort((a, b) => {
          if (a.dateRange && b.dateRange) return a.dateRange.localeCompare(b.dateRange);
          if (a.dateRange) return -1;
          if (b.dateRange) return 1;
          return 0;
        });
        const contextText = sortedKnowledge
          .slice(0, 40)
          .map((k) => {
            const dateInfo = k.dateRange ? `\n[撮影日: ${k.dateRange}]` : "";
            return `[${k.sourceLabel ?? k.sourceType}]${dateInfo}\n${k.content?.slice(0, 2000) ?? ""}`;
          })
          .join("\n\n---\n\n");

        const prompt = `あなたはWhatsAppのビジネスチャット履歴を分析する専門家です。
以下の知識ベース（WhatsApp履歴・スクリーンショット等）を分析して、
送信済みおよび支払済みのインボイスを検知してください。

## 重要: 文脈的な紐付けルール

会話の流れを時系列で追い、以下のパターンを検出してください:

### 「送信済み」の検知:
- インボイスPDFが送付された（例: 「Invoice-0378.pdf」「Invoice: 0378」等のファイル名・番号の言及）
- Wise支払いリクエストのURLが送付された（Wiseリクエスト送付 = インボイス送付とみなす）
- 「Invoice - XXXX」「Invoice: XXXX」「#XXXX」等の番号が会話中に現れた

### 「支払済み」の検知（★最重要: 文脈的な紐付け）:
- 支払い確認メッセージ（「paid」「i paid」「payment received」「支払い完了」「入金確認」「done」「ok paid」等）が
  **直前に送付されたインボイス番号**に対して返信された場合、そのインボイスが支払済みと判定する
- 例: 「Invoice: 0378」を送付 → 「i paid」という返信 → 0378が支払済み
- 例: Wise支払いリクエスト送付 + インボイスPDF送付 → 「i paid」 → そのインボイスが支払済み
- 「paid」単体でも、直前の会話でインボイス番号が特定できれば支払済みと判定する
- 複数のインボイスが混在する場合は、最も直近のインボイス番号に紐付ける

### 番号の形式:
- 「Invoice: 0378」「Invoice-0378」「#0378」「No.0378」「0378」等、様々な形式で記載される
- 先頭のゼロを除いた数値（例: 0378 → 378）で返答してください

必ず以下のJSON形式だけで返答してください（他のテキストは一切不要）:
{
  "sent": [
    { "invoiceNumber": 378, "confidence": "high", "evidence": "Invoice: 0378のPDFを送付" }
  ],
  "paid": [
    { "invoiceNumber": 378, "confidence": "high", "evidence": "Invoice: 0378送付後にルカが'i paid'と返信" }
  ]
}

知識ベース（時系列順）:
${contextText}`;

        const res = await fetch(`${forgeUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${forgeKey}` },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 1000,
          }),
        });
        if (!res.ok) throw new Error(`AI API error: ${res.status}`);
        const data = await res.json() as any;
        const text = data.choices?.[0]?.message?.content ?? "{}";
        try {
          const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(clean);
          return {
            sent: (parsed.sent ?? []) as Array<{ invoiceNumber: number; confidence: string; evidence: string }>,
            paid: (parsed.paid ?? []) as Array<{ invoiceNumber: number; confidence: string; evidence: string }>,
            message: `送信済み: ${(parsed.sent ?? []).length}件、支払済み: ${(parsed.paid ?? []).length}件を検知しました`,
          };
        } catch {
          return { sent: [], paid: [], message: "解析に失敗しました" };
        }
      }),

    // 知識ベースから最新のインボイス番号を抽出する
    getLatestInvoiceNumber: protectedProcedure
      .mutation(async () => {
        const db = await getDb();
        const knowledge = await db!.select().from(chatKnowledge).orderBy(desc(chatKnowledge.createdAt));
        if (knowledge.length === 0) {
          return { invoiceNumber: null, nextNumber: null, message: "知識ベースが空です。先にファイルをアップロードしてください。" };
        }
        const forgeUrl = process.env.BUILT_IN_FORGE_API_URL;
        const forgeKey = process.env.BUILT_IN_FORGE_API_KEY;
        if (!forgeUrl || !forgeKey) throw new Error("AI API not configured");

        const contextText = knowledge
          .slice(0, 20)
          .map((k: typeof knowledge[number]) => `[${k.sourceLabel ?? k.sourceType}]\n${k.content?.slice(0, 800) ?? ""}`.trim())
          .join("\n\n---\n\n");

        const prompt = `以下の知識ベース（WhatsApp履歴・インボイスPDF等）から、最大のインボイス番号を見つけてください。
インボイス番号は数字のみまたは「INV-XXX」「#XXX」「No.XXX」などの形式で記載されている可能性があります。
必ず以下のJSON形式だけで返答してください（他のテキストは不要）:
{
  "latestNumber": 123,
  "allNumbers": [100, 110, 120, 123],
  "context": "該当部分の原文テキスト"
}
知識ベース:
${contextText}`;

        const res = await fetch(`${forgeUrl}/v1/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${forgeKey}` },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            max_tokens: 500,
          }),
        });
        if (!res.ok) throw new Error(`AI API error: ${res.status}`);
        const data = await res.json() as any;
        const text = data.choices?.[0]?.message?.content ?? "{}";
        try {
          const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(clean);
          const latest = parsed.latestNumber ? Number(parsed.latestNumber) : null;
          const next = latest !== null ? latest + 1 : null;
          return {
            invoiceNumber: latest,
            nextNumber: next,
            allNumbers: parsed.allNumbers ?? [],
            context: parsed.context ?? "",
            message: latest !== null
              ? `最新のインボイス番号: ${latest}　次の番号: ${next}`
              : "インボイス番号が見つかりませんでした",
          };
        } catch {
          return { invoiceNumber: null, nextNumber: null, message: "解析に失敗しました" };
        }
      }),
  }),

  // ─── Shipment (発送記録) Router ─────────────────────────────────────────────
  shipment: router({
    /** 全発送記録を取得（明細付き） */
    list: protectedProcedure.query(async () => {
      const db = (await getDb())!;
      const rows = await db.select().from(shipments).orderBy(desc(shipments.shippingDate));
      const items = await db.select().from(shipmentItems);
      return rows.map((s) => ({
        ...s,
        items: items.filter((i) => i.shipmentId === s.id),
      }));
    }),

    /** インボイスNoの発注数合計・発送済み数・残数を返す */
    invoiceSummary: protectedProcedure
      .input(z.object({ invoiceNo: z.number() }))
      .query(async ({ input }) => {
        const db = (await getDb())!;
        // 同一インボイスNoの全商品の発注数合計
        const trades = await db
          .select({ quantity: tradeRecords.quantity })
          .from(tradeRecords)
          .where(eq(tradeRecords.no, input.invoiceNo));
        const orderedQty = trades.reduce((sum, t) => sum + Number(t.quantity ?? 0), 0);
        // 発送済み合計
        const items = await db
          .select({ quantity: shipmentItems.quantity })
          .from(shipmentItems)
          .where(eq(shipmentItems.invoiceNo, input.invoiceNo));
        const shippedQty = items.reduce((sum, i) => sum + i.quantity, 0);
        return {
          invoiceNo: input.invoiceNo,
          orderedQty,
          shippedQty,
          remainingQty: Math.max(0, orderedQty - shippedQty),
          isComplete: orderedQty > 0 && shippedQty >= orderedQty,
        };
      }),

    /** 特定インボイスの発送記録を取得 */
    byInvoice: protectedProcedure
      .input(z.object({ invoiceNo: z.number() }))
      .query(async ({ input }) => {
        const db = (await getDb())!;
        const items = await db
          .select()
          .from(shipmentItems)
          .where(eq(shipmentItems.invoiceNo, input.invoiceNo));
        if (items.length === 0) return [];
        const shipmentIds = Array.from(new Set(items.map((i) => i.shipmentId)));
        const result: Array<typeof shipments.$inferSelect & { items: typeof shipmentItems.$inferSelect[] }> = [];
        for (const sid of shipmentIds) {
          const [s] = await db.select().from(shipments).where(eq(shipments.id, sid));
          if (s) {
            const allItems = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, sid));
            result.push({ ...s, items: allItems });
          }
        }
        return result.sort((a, b) => a.shippingDate.localeCompare(b.shippingDate));
      }),

    /** 発送記録を新規作成し、送料を按分更新する */
    create: protectedProcedure
      .input(
        z.object({
          shippingDate: z.string(),
          trackingNumber: z.string().optional(),
          shippingCost: z.number(),
          notes: z.string().optional(),
          items: z.array(
            z.object({
              invoiceNo: z.number(),
              quantity: z.number(),
            })
          ),
        })
      )
      .mutation(async ({ input }) => {
        const db = (await getDb())!;

        // 1. 発送レコードを作成
        const [result] = await db.insert(shipments).values({
          shippingDate: input.shippingDate,
          trackingNumber: input.trackingNumber ?? null,
          shippingCost: String(input.shippingCost),
          notes: input.notes ?? null,
        });
        const shipmentId = (result as any).insertId as number;

        // 2. 発送明細を作成
        for (const item of input.items) {
          await db.insert(shipmentItems).values({
            shipmentId,
            invoiceNo: item.invoiceNo,
            quantity: item.quantity,
          });
        }

        // 3. 各インボイスの送料を更新（発送完了チェック）
        await recalcShippingCosts(db, input.items.map((i) => i.invoiceNo));

        return { shipmentId };
      }),

    /** 発送記録を更新する（発送日・追跡番号・送料・メモ） */
    update: protectedProcedure
      .input(
        z.object({
          id: z.number(),
          shippingDate: z.string(),
          trackingNumber: z.string().optional(),
          shippingCost: z.number(),
          notes: z.string().optional(),
        })
      )
      .mutation(async ({ input }) => {
        const db = (await getDb())!;
        await db
          .update(shipments)
          .set({
            shippingDate: input.shippingDate,
            trackingNumber: input.trackingNumber ?? null,
            shippingCost: String(input.shippingCost),
            notes: input.notes ?? null,
          })
          .where(eq(shipments.id, input.id));
        // 送料変更後に再計算
        const items = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, input.id));
        const invoiceNos = items.map((i) => i.invoiceNo);
        await recalcShippingCosts(db, invoiceNos);
        return { ok: true };
      }),

    /** 発送記録を削除し、送料を再計算する */
    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const db = (await getDb())!;
        const items = await db.select().from(shipmentItems).where(eq(shipmentItems.shipmentId, input.id));
        const invoiceNos = items.map((i) => i.invoiceNo);
        await db.delete(shipmentItems).where(eq(shipmentItems.shipmentId, input.id));
        await db.delete(shipments).where(eq(shipments.id, input.id));
        // 送料を再計算
        await recalcShippingCosts(db, invoiceNos);
        return { ok: true };
      }),
  }),
});
export type AppRouter = typeof appRouter;
