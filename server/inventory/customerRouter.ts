import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from "./db";

export const customerRouter = router({
    /** 取引先一覧を取得 */
    list: protectedProcedure.query(async () => {
      return getCustomers();
    }),
    /** 取引先を作成 */
    create: protectedProcedure
      .input(z.object({
        displayName: z.string().min(1).max(100),
        code: z.string().min(1).max(100),
        keywords: z.string().min(1).max(500),
        sortOrder: z.number().int().default(0),
      }))
      .mutation(async ({ input }) => {
        await createCustomer(input);
        return { success: true };
      }),
    /** 取引先を更新 */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int(),
        displayName: z.string().min(1).max(100).optional(),
        code: z.string().min(1).max(100).optional(),
        keywords: z.string().min(1).max(500).optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...data } = input;
        await updateCustomer(id, data);
        return { success: true };
      }),
    /** 取引先を削除 */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int() }))
      .mutation(async ({ input }) => {
        await deleteCustomer(input.id);
        return { success: true };
      }),
});
