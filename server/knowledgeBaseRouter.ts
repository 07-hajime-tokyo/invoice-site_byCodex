import { z } from "zod";
import { protectedProcedure, router } from "./_core/trpc";
import { getDb } from "./db";
import { aiChatMessages, chatConversations, chatKnowledge } from "../drizzle/schema";
import { asc, desc, eq } from "drizzle-orm";

// ─── Knowledge Base & AI Chat ────────────────────────────────────────────────
export const knowledgeBaseRouter = router({
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
});
