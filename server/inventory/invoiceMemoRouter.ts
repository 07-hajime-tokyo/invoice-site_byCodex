import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  upsertInvoiceMemo,
  getInvoiceMemos,
  getAllInvoiceMemos,
} from "./db";

const publicProcedure = protectedProcedure;

export const invoiceMemoRouter = router({
    /** インボイスの商品種別メモを保存する（upsert） */
    upsert: publicProcedure
      .input(z.object({
        invoiceKey: z.string().max(50),
        colorKey: z.string().max(200),
        memo: z.string().max(2000),
      }))
      .mutation(async ({ input }) => {
        await upsertInvoiceMemo(input.invoiceKey, input.colorKey, input.memo);
        return { success: true };
      }),
    /** インボイスのメモ一覧を取得する */
    list: publicProcedure
      .input(z.object({ invoiceKey: z.string().max(50) }))
      .query(async ({ input }) => {
        return getInvoiceMemos(input.invoiceKey);
      }),
    /** 全インボイスのメモを取得する */
    listAll: publicProcedure.query(async () => {
      return getAllInvoiceMemos();
    }),
    /**
     * インボイスの手動完了フラグをセット/解除する
     * colorKey = "__manual_complete__" を使って invoice_memos に保存
     */
    setManualComplete: publicProcedure
      .input(z.object({
        invoiceKey: z.string().max(50),
        completed: z.boolean(),
      }))
      .mutation(async ({ input }) => {
        await upsertInvoiceMemo(input.invoiceKey, "__manual_complete__", input.completed ? "1" : "0");
        return { success: true };
      }),
});
