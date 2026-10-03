import { z } from "zod";
import { INBOUND_CLASS_ORDER } from "@shared/inboundPipeline";

/** 入庫一覧APIの入力検証とTypeScript型の共通定義。 */
export const purchasePageInputSchema = z
  .object({
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(100).optional(),
    status: z.enum(["ordered", "shipped"]).nullable().optional(),
    category: z.string().max(200).nullable().optional(),
    search: z.string().max(200).nullable().optional(),
    showCompleted: z.boolean().optional(),
    inboundClass: z
      .enum([...INBOUND_CLASS_ORDER, "unclassified"])
      .nullable()
      .optional(),
  })
  .optional();

export type PurchasePageInput = z.infer<typeof purchasePageInputSchema>;
