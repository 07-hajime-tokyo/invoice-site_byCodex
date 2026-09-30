import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { whatsappConversations, whatsappMessages } from "../drizzle/schema";
import { and, asc, desc, eq, gte, isNull, like, or, sql } from "drizzle-orm";
import {
  isOwnerSender,
  looksJapanese,
  makeDedupeKey,
  parseWhatsAppExport,
  translateMessages,
} from "./whatsappConversations";

/** WhatsApp会話履歴：既定で表示する期間（日） */
const WHATSAPP_RECENT_DAYS = 14;
/** WhatsApp会話履歴：「過去の会話を確認」1回ぶんの遡り幅（月） */
const WHATSAPP_EXPAND_MONTHS = 3;
/** WhatsApp会話履歴：期間内が少なくても、最低これだけは遡って出す */
const WHATSAPP_MIN_MESSAGES = 20;

// ─── WhatsApp会話履歴（読み返し用・和訳つき） ──────────────────────────────────
export const whatsappChatsRouter = router({
    /** 相手一覧。最終メッセージが新しい順。 */
    listConversations: protectedProcedure.query(async () => {
      const db = await getDb();
      if (!db) throw new Error("DB connection failed");

      const conversations = await db
        .select()
        .from(whatsappConversations)
        .orderBy(desc(whatsappConversations.lastMessageAt));

      const counts = await db
        .select({
          conversationId: whatsappMessages.conversationId,
          total: sql<number>`count(*)`,
          untranslated: sql<number>`sum(case when ${whatsappMessages.bodyJa} is null and ${whatsappMessages.translationSkipped} = false then 1 else 0 end)`,
        })
        .from(whatsappMessages)
        .groupBy(whatsappMessages.conversationId);

      const byId = new Map(counts.map((c) => [c.conversationId, c]));
      return conversations.map((c) => ({
        ...c,
        messageCount: Number(byId.get(c.id)?.total ?? 0),
        untranslatedCount: Number(byId.get(c.id)?.untranslated ?? 0),
      }));
    }),

    /**
     * 1件の会話のメッセージ。古い順。
     *
     * 既定では直近2週間ぶんだけを返す（返信を書くときに要るのはそこだけ）。
     * expandCount は「過去の会話を確認」を押した回数で、1回につき3ヶ月ぶん遡る。
     * 期間内が少なすぎると画面が空に見えるので、最低件数までは期間を無視して遡る。
     *
     * keyword を渡したときは窓を無視して全期間から探す。
     */
    getMessages: protectedProcedure
      .input(
        z.object({
          conversationId: z.number(),
          keyword: z.string().optional(),
          expandCount: z.number().int().min(0).max(40).optional(),
        }),
      )
      .query(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB connection failed");

        const totals = await db
          .select({ total: sql<number>`count(*)` })
          .from(whatsappMessages)
          .where(eq(whatsappMessages.conversationId, input.conversationId));
        const totalCount = Number(totals[0]?.total ?? 0);

        const keyword = input.keyword?.trim();
        if (keyword) {
          const messages = await db
            .select()
            .from(whatsappMessages)
            .where(
              and(
                eq(whatsappMessages.conversationId, input.conversationId),
                or(
                  like(whatsappMessages.body, `%${keyword}%`),
                  like(whatsappMessages.bodyJa, `%${keyword}%`),
                  like(whatsappMessages.sender, `%${keyword}%`),
                )!,
              ),
            )
            .orderBy(asc(whatsappMessages.sentAt));
          return { messages, totalCount, hasMore: false, searchedAll: true };
        }

        /**
         * sentAt は「WhatsAppの画面に出ていた壁時計」をそのままUTCとして持っている。
         * 現在時刻との間に最大9時間のズレが出るが、2週間・3ヶ月という粒度では実害がない。
         */
        const cutoff = new Date(Date.now() - WHATSAPP_RECENT_DAYS * 24 * 60 * 60 * 1000);
        cutoff.setUTCMonth(cutoff.getUTCMonth() - WHATSAPP_EXPAND_MONTHS * (input.expandCount ?? 0));

        let messages = await db
          .select()
          .from(whatsappMessages)
          .where(
            and(
              eq(whatsappMessages.conversationId, input.conversationId),
              gte(whatsappMessages.sentAt, cutoff),
            ),
          )
          .orderBy(asc(whatsappMessages.sentAt));

        /**
         * 期間だけで切ると、やり取りの薄い相手では押しても何も増えない。
         * 1回押すごとに下限も増やして、必ず新しく古いぶんが出るようにする。
         */
        const minMessages = WHATSAPP_MIN_MESSAGES * ((input.expandCount ?? 0) + 1);
        if (messages.length < minMessages && totalCount > messages.length) {
          const recent = await db
            .select()
            .from(whatsappMessages)
            .where(eq(whatsappMessages.conversationId, input.conversationId))
            .orderBy(desc(whatsappMessages.sentAt))
            .limit(minMessages);
          messages = recent.reverse();
        }

        return { messages, totalCount, hasMore: messages.length < totalCount, searchedAll: false };
      }),

    /**
     * 会話を取り込む。同じ内容を再投入しても dedupeKey で弾かれるので、
     * 「前回の続きから」でも「まるごと貼り直し」でも同じ結果になる。
     */
    importChat: protectedProcedure
      .input(
        z.object({
          name: z.string().min(1),
          rawText: z.string().min(1),
          isGroup: z.boolean().optional(),
          /** 自分の発言として扱う送信者名（WhatsApp上の自分の表示名） */
          ownerNames: z.array(z.string()).optional(),
          /** この日時より古いメッセージは取り込まない（ISO文字列） */
          since: z.string().optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB connection failed");

        const parsed = parseWhatsAppExport(input.rawText);
        if (parsed.length === 0) {
          throw new Error("メッセージを1件も読み取れませんでした。フォーマットを確認してください。");
        }

        const since = input.since ? new Date(input.since) : null;
        const inRange = since ? parsed.filter((m) => m.sentAt >= since) : parsed;
        if (inRange.length === 0) {
          throw new Error("指定期間内のメッセージがありませんでした。");
        }

        // 相手（会話）を用意する
        const existing = await db
          .select()
          .from(whatsappConversations)
          .where(eq(whatsappConversations.name, input.name))
          .limit(1);

        let conversationId: number;
        if (existing.length > 0) {
          conversationId = existing[0].id;
        } else {
          await db.insert(whatsappConversations).values({
            name: input.name,
            isGroup: input.isGroup ?? false,
          });
          const created = await db
            .select()
            .from(whatsappConversations)
            .where(eq(whatsappConversations.name, input.name))
            .limit(1);
          if (created.length === 0) throw new Error("会話の作成に失敗しました");
          conversationId = created[0].id;
        }

        // 既存の dedupeKey を引いて、重複を先に落とす
        const known = await db
          .select({ dedupeKey: whatsappMessages.dedupeKey })
          .from(whatsappMessages)
          .where(eq(whatsappMessages.conversationId, conversationId));
        const knownKeys = new Set(known.map((k) => k.dedupeKey));

        const rows = inRange
          .map((m) => ({
            conversationId,
            sender: m.sender,
            isOutgoing: isOwnerSender(m.sender, input.ownerNames ?? []),
            sentAt: m.sentAt,
            body: m.body,
            translationSkipped: looksJapanese(m.body),
            dedupeKey: makeDedupeKey(input.name, m.sentAt, m.body),
          }))
          .filter((r) => {
            if (knownKeys.has(r.dedupeKey)) return false;
            knownKeys.add(r.dedupeKey); // 同一取り込み内の重複も落とす
            return true;
          });

        for (let i = 0; i < rows.length; i += 100) {
          await db.insert(whatsappMessages).values(rows.slice(i, i + 100));
        }

        const bounds = await db
          .select({
            first: sql<string | null>`min(${whatsappMessages.sentAt})`,
            last: sql<string | null>`max(${whatsappMessages.sentAt})`,
          })
          .from(whatsappMessages)
          .where(eq(whatsappMessages.conversationId, conversationId));

        await db
          .update(whatsappConversations)
          .set({
            isGroup: input.isGroup ?? existing[0]?.isGroup ?? false,
            firstMessageAt: bounds[0]?.first ? new Date(bounds[0].first) : null,
            lastMessageAt: bounds[0]?.last ? new Date(bounds[0].last) : null,
            importedAt: new Date(),
          })
          .where(eq(whatsappConversations.id, conversationId));

        return {
          conversationId,
          parsed: parsed.length,
          imported: rows.length,
          skippedDuplicates: inRange.length - rows.length,
          skippedOutOfRange: parsed.length - inRange.length,
        };
      }),

    /** 未翻訳のメッセージをまとめて日本語にする。conversationId 省略で全会話が対象。 */
    translate: protectedProcedure
      .input(z.object({ conversationId: z.number().optional(), limit: z.number().min(1).max(2000).default(400) }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB connection failed");

        const filters = [isNull(whatsappMessages.bodyJa), eq(whatsappMessages.translationSkipped, false)];
        if (input.conversationId) filters.push(eq(whatsappMessages.conversationId, input.conversationId));

        const pending = await db
          .select({ id: whatsappMessages.id, body: whatsappMessages.body })
          .from(whatsappMessages)
          .where(and(...filters))
          .orderBy(asc(whatsappMessages.sentAt))
          .limit(input.limit);

        if (pending.length === 0) return { translated: 0, remaining: 0, failedChunks: 0 };

        const { translations, failedChunks } = await translateMessages(
          pending.map((p) => ({ id: p.id, text: p.body })),
        );

        for (const [id, ja] of translations) {
          await db.update(whatsappMessages).set({ bodyJa: ja }).where(eq(whatsappMessages.id, id));
        }

        const remainingRows = await db
          .select({ count: sql<number>`count(*)` })
          .from(whatsappMessages)
          .where(and(...filters));

        return {
          translated: translations.size,
          remaining: Number(remainingRows[0]?.count ?? 0),
          failedChunks,
        };
      }),

    /** 会話をメッセージごと削除する */
    deleteConversation: protectedProcedure
      .input(z.object({ conversationId: z.number() }))
      .mutation(async ({ input }) => {
        const db = await getDb();
        if (!db) throw new Error("DB connection failed");
        await db.delete(whatsappMessages).where(eq(whatsappMessages.conversationId, input.conversationId));
        await db.delete(whatsappConversations).where(eq(whatsappConversations.id, input.conversationId));
        return { ok: true };
      }),
});
