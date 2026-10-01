import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getDomesticProducts,
  createDomesticProduct,
  updateDomesticProduct,
  deleteDomesticProduct,
} from "./db";

const publicProcedure = protectedProcedure;

export const domesticProductRouter = router({
    /** 国内卸商品マスタ一覧を取得 */
    list: publicProcedure.query(async () => {
      return getDomesticProducts();
    }),
    /** 国内卸商品マスタを作成 */
    create: protectedProcedure
      .input(z.object({
        title: z.string().min(1).max(500),
        unitPrice: z.number().nullable().optional(),
        supplierName: z.string().max(200).nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const result = await createDomesticProduct(input);
        return { success: true, insertId: (result as { insertId?: number }).insertId };
      }),
    /** 国内卸商品マスタを更新 */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int(),
        title: z.string().min(1).max(500).optional(),
        unitPrice: z.number().nullable().optional(),
        supplierName: z.string().max(200).nullable().optional(),
        note: z.string().max(2000).nullable().optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateDomesticProduct(id, data);
        return { success: true };
      }),
    /** 国内卸商品マスタを削除 */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteDomesticProduct(input.id);
        return { success: true };
      }),
});
