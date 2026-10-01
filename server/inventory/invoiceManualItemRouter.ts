import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getInvoiceManualItems,
  getInvoiceManualItemsByInvoiceNos,
  createInvoiceManualItem,
  updateInvoiceManualItem,
  deleteInvoiceManualItem,
} from "./db";

const publicProcedure = protectedProcedure;

export const invoiceManualItemRouter = router({
    /** 指定インボイスの手動入力行を取得 */
    list: publicProcedure
      .input(z.object({ invoiceNo: z.string().max(50) }))
      .query(async ({ input }) => {
        return getInvoiceManualItems(input.invoiceNo);
      }),
    /** 複数インボイスの手動入力行を一括取得 */
    listByInvoiceNos: publicProcedure
      .input(z.object({ invoiceNos: z.array(z.string().max(50)) }))
      .query(async ({ input }) => {
        return getInvoiceManualItemsByInvoiceNos(input.invoiceNos);
      }),
    /** 手動入力行を作成 */
    create: protectedProcedure
      .input(z.object({
        invoiceNo: z.string().max(50),
        title: z.string().max(500).default(""),
        quantity: z.number().int().min(1).default(1),
        unitPrice: z.number().nullable().optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await createInvoiceManualItem({
          invoiceNo: input.invoiceNo,
          title: input.title,
          quantity: input.quantity,
          unitPrice: input.unitPrice ?? null,
          sortOrder: input.sortOrder,
        });
        return { success: true, insertId: (result as { insertId?: number }).insertId };
      }),
    /** 手動入力行を更新 */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int(),
        title: z.string().max(500).optional(),
        quantity: z.number().int().min(1).optional(),
        unitPrice: z.number().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        await updateInvoiceManualItem(input.id, {
          title: input.title,
          quantity: input.quantity,
          unitPrice: input.unitPrice ?? null,
        });
        return { success: true };
      }),
    /** 手動入力行を削除 */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteInvoiceManualItem(input.id);
        return { success: true };
      }),
});
