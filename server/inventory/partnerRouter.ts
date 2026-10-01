import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { getOrderRowsFromTradeRecords } from "./orderTradeRows";
import { resolveWorkOperatorName } from "./workOperator";
import { protectedProcedure, router } from "../_core/trpc";
import { alignShipmentItemsWithDeliveryHistories, sumWorkQuantity } from "./fedexRouter";
import { recordWorkLog } from "./workLogs";
import {
  getAllFedexShipments,
  getAllPartnerPortals,
  getPartnerPortalByCode,
  createPartnerPortal,
  updatePartnerPortal,
  deletePartnerPortal,
  setPartnerSessionToken,
  getShipmentChecksByPartner,
  upsertShipmentCheck,
  createPartnerMessage,
  getAllPartnerMessages,
  markPartnerMessageRead,
  replyToPartnerMessage,
  deletePartnerMessage,
  deletePartnerMessageByPartner,
  getPartnerMessagesByCode,
  markPartnerMessagesReadByPartner,
  addMessageThread,
  getThreadsByParentIds,
  markThreadsReadByPartner,
  markThreadsReadByAdmin,
  createManualShipment,
  getAllManualShipments,
  deleteManualShipment,
} from "./db";

const publicProcedure = protectedProcedure;

export const partnerRouter = router({
    /**
     * 取引先ポータルにパスワードでログインする（公開プロシージャ）
     */
    login: publicProcedure
      .input(z.object({ partnerCode: z.string(), password: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const portal = await getPartnerPortalByCode(input.partnerCode);
        if (!portal || !portal.isActive) throw new TRPCError({ code: "NOT_FOUND", message: "Partner not found" });
        if (portal.password !== input.password) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid password" });
        // セッショントークン生成（90日有効）
        const token = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
        await setPartnerSessionToken(input.partnerCode, token, expiresAt);
        ctx.res.cookie("partner_session", JSON.stringify({ partnerCode: input.partnerCode, token }), {
          httpOnly: true, sameSite: "lax", maxAge: 90 * 24 * 60 * 60 * 1000,
        });
        return { success: true, partnerCode: input.partnerCode, partnerName: portal.partnerName };
      }),

    /**
     * 取引先ポータルのセッションを確認する（公開プロシージャ）
     */
    checkSession: publicProcedure.query(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (!match) return { authenticated: false, partnerCode: null, partnerName: null };
      try {
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || !portal.sessionToken || portal.sessionToken !== session.token) return { authenticated: false, partnerCode: null, partnerName: null };
        if (portal.sessionExpiresAt && new Date(portal.sessionExpiresAt) < new Date()) return { authenticated: false, partnerCode: null, partnerName: null };
        return { authenticated: true, partnerCode: portal.partnerCode, partnerName: portal.partnerName };
      } catch {
        return { authenticated: false, partnerCode: null, partnerName: null };
      }
    }),

    /**
     * 取引先ポータルからログアウトする
     */
    logout: publicProcedure.mutation(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (match) {
        try {
          const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
          await setPartnerSessionToken(session.partnerCode, null, null);
        } catch { /* ignore */ }
      }
      ctx.res.clearCookie("partner_session");
      return { success: true };
    }),

    /**
     * 取引先向け: 自分のSheetNameに対応するFedEx発送記録とCSV情報を取得
     */
    getShipments: publicProcedure.query(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
      let partnerCode: string;
      let sheetName: string;
      try {
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        if (portal.sessionExpiresAt && new Date(portal.sessionExpiresAt) < new Date()) throw new TRPCError({ code: "UNAUTHORIZED" });
        partnerCode = portal.partnerCode;
        sheetName = portal.sheetName;
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      // 対応するFedEx発送記録を取得
      const allShipments = await getAllFedexShipments();
      const myShipments = await alignShipmentItemsWithDeliveryHistories(
        allShipments.filter((s) => s.sheetName === sheetName),
      );
      // 手動発送データも取得して統合
      const allManual = await getAllManualShipments();
      const myManual = allManual.filter((m) => m.sheetName === sheetName);
      const manualAsFedex = myManual.map((m) => ({
        id: -(m.id),
        deliveryNo: m.invoiceNo,
        sheetName: m.sheetName,
        shippingDate: m.shippingDate,
        trackingNumber: m.trackingNumber,
        itemsJson: m.itemsJson,
        spreadsheetStatus: "success" as const,
        spreadsheetError: null,
        operatorName: m.operatorName,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
        isManual: true,
        manualId: m.id,
      }));
      const combinedShipments = [...myShipments, ...manualAsFedex];
      // 受取確認チェックを取得
      const checks = await getShipmentChecksByPartner(partnerCode);
      const checkMap = new Map(checks.map((c) => [`${c.fedexShipmentId}_${c.itemIndex}`, c.isChecked === 1] as [string, boolean]));
      // CSV情報を取得（インボイスNo・支払日・発注数）
      let csvData: Record<string, { paymentDate: string; products: Array<{ name: string; qty: number }> }> = {};
      try {
        for (const row of await getOrderRowsFromTradeRecords()) {
          const partner = row.partner;
          const invoiceNo = row.invoiceNo;
          const paymentDate = row.paymentDate;
          const productName = row.productName;
          const orderQty = row.orderQty;
          // 取引先フィルタリング（シート名と取引先を照合）
          const isLuca = sheetName === "独発送管理";
          const isSamee = sheetName === "サミー発送管理";
          const isDevon = sheetName === "デボン発送管理";
          const isSimon = sheetName === "サイモン発送管理";
          const isNele = sheetName === "ネレ発送管理";
          const partnerLower = partner.toLowerCase();
          if (isLuca && !partnerLower.includes("ルカ") && !partnerLower.includes("luca") && !partnerLower.includes("マキシム") && !partnerLower.includes("maxim")) continue;
          if (isSamee && !partnerLower.includes("サミ") && !partnerLower.includes("samm") && !partnerLower.includes("same")) continue;
          if (isDevon && !partnerLower.includes("デボン") && !partnerLower.includes("devon")) continue;
          if (isSimon && !partnerLower.includes("サイモン") && !partnerLower.includes("simon")) continue;
          if (isNele && !partnerLower.includes("ネレ") && !partnerLower.includes("nele")) continue;
          if (!csvData[invoiceNo]) csvData[invoiceNo] = { paymentDate, products: [] };
          if (productName) csvData[invoiceNo].products.push({ name: productName, qty: orderQty });
        }
      } catch { /* CSV取得失敗時は空データ */ }
      return { shipments: combinedShipments, checks: Object.fromEntries(checks.map((c) => [`${c.fedexShipmentId}_${c.itemIndex}`, c.isChecked === 1])), csvData };
    }),

    /**
     * 受取確認チェックを更新する
     */
    updateCheck: publicProcedure
      .input(z.object({ fedexShipmentId: z.number(), itemIndex: z.number(), isChecked: z.boolean() }))
      .mutation(async ({ input, ctx }) => {
        const cookieHeader = ctx.req.headers.cookie ?? "";
        const match = cookieHeader.match(/partner_session=([^;]+)/);
        if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        await upsertShipmentCheck(session.partnerCode, input.fedexShipmentId, input.itemIndex, input.isChecked);
        return { success: true };
      }),

    /**
     * 取引先からメッセージを送信する
     */
    sendMessage: publicProcedure
      .input(z.object({ message: z.string().min(1).max(2000), fedexShipmentId: z.number().optional() }))
      .mutation(async ({ input, ctx }) => {
        const cookieHeader = ctx.req.headers.cookie ?? "";
        const match = cookieHeader.match(/partner_session=([^;]+)/);
        if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        await createPartnerMessage({
          partnerCode: session.partnerCode,
          partnerName: portal.partnerName,
          fedexShipmentId: input.fedexShipmentId ?? null,
          message: input.message,
        });
        // 管理者に通知
        try {
          const { notifyOwner } = await import("../_core/notification");
          await notifyOwner({ title: `メッセージ: ${portal.partnerName}`, content: input.message });
        } catch { /* 通知失敗は無視 */ }
        return { success: true };
      }),

    // ===== 管理者向け =====
    /**
     * 全取引先ポータル一覧（管理者向け）
     */
    listPortals: protectedProcedure.query(async () => {
      return getAllPartnerPortals();
    }),

    /**
     * 取引先ポータルを作成する
     */
    createPortal: protectedProcedure
      .input(z.object({
        partnerCode: z.string().min(1).max(100),
        partnerName: z.string().min(1).max(200),
        sheetName: z.string().min(1).max(100),
        password: z.string().min(1).max(200),
      }))
      .mutation(async ({ input }) => {
        const id = await createPartnerPortal({ ...input, isActive: 1 });
        return { id };
      }),

    /**
     * 取引先ポータルを更新する（パスワード変更等）
     */
    updatePortal: protectedProcedure
      .input(z.object({
        id: z.number(),
        partnerName: z.string().min(1).max(200).optional(),
        sheetName: z.string().min(1).max(100).optional(),
        password: z.string().min(1).max(200).optional(),
        isActive: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updatePartnerPortal(id, data);
        return { success: true };
      }),

    /**
     * 取引先ポータルを削除する
     */
    deletePortal: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deletePartnerPortal(input.id);
        return { success: true };
      }),

    /**
     * 取引先からのメッセージ一覧（管理者向け）
     */
    listMessages: protectedProcedure.query(async () => {
      return getAllPartnerMessages();
    }),

    /**
     * メッセージを既読にする
     */
    markMessageRead: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await markPartnerMessageRead(input.id);
        return { success: true };
      }),

    /**
     * メッセージに返信する（管理者向け）
     */
    replyMessage: protectedProcedure
      .input(z.object({ id: z.number(), replyText: z.string().min(1).max(2000) }))
      .mutation(async ({ input }) => {
        await replyToPartnerMessage(input.id, input.replyText);
        return { success: true };
      }),

    /**
     * メッセージを削除する（管理者向け）
     */
    deleteMessage: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deletePartnerMessage(input.id);
        return { success: true };
      }),

    /**
     * 取引先が自分のメッセージ履歴を取得する（取引先向け）
     */
    getMyMessages: publicProcedure.query(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
      let partnerCode: string;
      try {
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        partnerCode = session.partnerCode;
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return getPartnerMessagesByCode(partnerCode);
    }),

    /**
     * 取引先が自分のメッセージを削除する（取引先向け）
     */
    deleteMyMessage: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const cookieHeader = ctx.req.headers.cookie ?? "";
        const match = cookieHeader.match(/partner_session=([^;]+)/);
        if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
         if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        await deletePartnerMessageByPartner(input.id, session.partnerCode);
        return { success: true };
      }),
    /**
     * 取引先が自分のメッセージを既読にする（返信ありメッセージのバッジを消す）
     */
    markMessagesRead: publicProcedure.mutation(async ({ ctx }) => {
      const cookieHeader = ctx.req.headers.cookie ?? "";
      const match = cookieHeader.match(/partner_session=([^;]+)/);
      if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
      let partnerCode: string;
      try {
        const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
        const portal = await getPartnerPortalByCode(session.partnerCode);
        if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
        partnerCode = session.partnerCode;
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      await markPartnerMessagesReadByPartner(partnerCode);
      // スレッド内のadmin返信も既読にする
      const myMsgs = await getPartnerMessagesByCode(partnerCode);
      const msgIds = myMsgs.map(m => m.id);
      if (msgIds.length > 0) await markThreadsReadByPartner(msgIds);
      return { success: true };
    }),
    /**
     * スレッド返信を追加する（取引先向け）
     */
    addThreadReply: publicProcedure
      .input(z.object({
        parentMessageId: z.number().int().positive(),
        content: z.string().min(1).max(2000),
      }))
      .mutation(async ({ input, ctx }) => {
        const cookieHeader = ctx.req.headers.cookie ?? "";
        const match = cookieHeader.match(/partner_session=([^;]+)/);
        if (!match) throw new TRPCError({ code: "UNAUTHORIZED" });
        let partnerCode: string;
        let partnerName: string;
        try {
          const session = JSON.parse(decodeURIComponent(match[1])) as { partnerCode: string; token: string };
          const portal = await getPartnerPortalByCode(session.partnerCode);
          if (!portal || portal.sessionToken !== session.token) throw new TRPCError({ code: "UNAUTHORIZED" });
          partnerCode = portal.partnerCode;
          partnerName = portal.partnerName;
        } catch (e) {
          if (e instanceof TRPCError) throw e;
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        await addMessageThread({
          parentMessageId: input.parentMessageId,
          senderType: "partner",
          senderName: partnerName,
          content: input.content,
        });
        return { success: true };
      }),
    /**
     * スレッド返信を追加する（管理者向け）
     */
    addAdminThreadReply: protectedProcedure
      .input(z.object({
        parentMessageId: z.number().int().positive(),
        content: z.string().min(1).max(2000),
      }))
      .mutation(async ({ input, ctx }) => {
        await addMessageThread({
          parentMessageId: input.parentMessageId,
          senderType: "admin",
          senderName: ctx.user.name ?? "管理者",
          content: input.content,
        });
        return { success: true };
      }),
    /**
     * スレッド一覧を取得する（親メッセージIDリストで一括取得）
     */
    getThreads: publicProcedure
      .input(z.object({ parentMessageIds: z.array(z.number().int()) }))
      .query(async ({ input }) => {
        return getThreadsByParentIds(input.parentMessageIds);
      }),
    /**
     * 管理者側で取引先からのスレッド返信を既読にする
     */
    markThreadReadByAdmin: protectedProcedure
      .input(z.object({ parentMessageId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await markThreadsReadByAdmin(input.parentMessageId);
        return { success: true };
      }),
    /**
     * 手動発送データを登録する（管理者向け）
     */
    addManualShipment: protectedProcedure
      .input(z.object({
        invoiceNo: z.string().min(1),
        sheetName: z.string().min(1),
        shippingDate: z.string().min(1),
        trackingNumber: z.string().min(1),
        items: z.array(z.object({
          productNameJa: z.string(),
          productNameEn: z.string(),
          quantity: z.number().int().min(1),
        })),
        operatorName: z.string().max(200).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const workOperatorName = resolveWorkOperatorName(input.operatorName, (ctx as { user?: { name?: string; email?: string } }).user?.name ?? null);
        const id = await createManualShipment({
          invoiceNo: input.invoiceNo,
          sheetName: input.sheetName,
          shippingDate: input.shippingDate,
          trackingNumber: input.trackingNumber,
          itemsJson: JSON.stringify(input.items),
          operatorName: workOperatorName,
        });
        await recordWorkLog({
          workerName: workOperatorName,
          category: "FedEx発送登録",
          status: "done",
          startedAt: new Date(),
          endedAt: new Date(),
          quantity: sumWorkQuantity(input.items),
          memo: `インボイスNo: ${input.invoiceNo} / 追跡番号: ${input.trackingNumber}`,
          createdBy: workOperatorName,
          sourceType: "manual-shipment",
          sourceId: `${input.invoiceNo}:${input.trackingNumber}`,
          detailsJson: JSON.stringify({
            invoiceNo: input.invoiceNo,
            sheetName: input.sheetName,
            shippingDate: input.shippingDate,
            trackingNumber: input.trackingNumber,
            items: input.items,
          }),
        });
        return { id };
      }),

    /**
     * 手動発送データを削除する（管理者向け）
     */
    deleteManualShipment: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        await deleteManualShipment(input.id);
        return { success: true };
      }),

    /**
     * 手動発送データ一覧を取得する（管理者向け）
     */
    listManualShipments: protectedProcedure.query(async () => {
      return getAllManualShipments();
    }),

    /**
     * 管理者向け: 全FedEx発送記録とCSV情報を取得（海外発送ページ用）
     */
    getAdminShipments: protectedProcedure.query(async () => {
      const allShipments = await alignShipmentItemsWithDeliveryHistories(await getAllFedexShipments());
      const manualShipmentsList = await getAllManualShipments();
      // 手動発送データをFedexShipment形式に変換して統合
      const manualAsFedex = manualShipmentsList.map((m) => ({
        id: -(m.id), // 負のIDで手動データを識別
        deliveryNo: m.invoiceNo,
        sheetName: m.sheetName,
        shippingDate: m.shippingDate,
        trackingNumber: m.trackingNumber,
        itemsJson: m.itemsJson,
        spreadsheetStatus: "success" as const,
        spreadsheetError: null,
        operatorName: m.operatorName,
        createdAt: m.createdAt,
        updatedAt: m.createdAt,
        isManual: true,
        manualId: m.id,
      }));
      const combinedShipments = [...allShipments, ...manualAsFedex];
      let csvData: Record<string, { partner: string; paymentDate: string; products: Array<{ name: string; qty: number }> }> = {};
      try {
        for (const row of await getOrderRowsFromTradeRecords()) {
          const partner = row.partner;
          const invoiceNo = row.invoiceNo;
          const paymentDate = row.paymentDate;
          const productName = row.productName;
          const orderQty = row.orderQty;
          const status = row.status;
          if (!csvData[invoiceNo]) csvData[invoiceNo] = { partner, paymentDate, products: [] };
          if (productName) csvData[invoiceNo].products.push({ name: productName, qty: orderQty });
          // statusをcompleteとして記録
          if (status.toLowerCase() === "complete") (csvData[invoiceNo] as { partner: string; paymentDate: string; products: Array<{ name: string; qty: number }>; isComplete?: boolean }).isComplete = true;
        }
      } catch { /* CSV取得失敗 */ }
      return { shipments: combinedShipments, csvData };
    }),
});
