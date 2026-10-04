import { z } from "zod";
export const purchaseEditInputSchema = z.object({
  purchaseId: z.number().int().positive(),
  operatorKey: z.enum(["default", "A", "B"]).optional(),
  customerName: z.string().optional(),
  estimatedPurchaseDate: z.string().optional(),
  memo: z.string().optional(),
  purchaseItems: z
    .array(
      z.object({
        id: z.number().int().nonnegative().optional(),
        inventoryId: z.number().int().positive(),
        title: z.string().min(1).max(500).optional(),
        unitPrice: z.number().optional(),
        quantity: z.number().optional(),
        estimatedPurchaseDate: z.string().optional(),
        etc: z.string().optional(),
        category: z.string().max(200).nullable().optional(),
      })
    )
    .optional(),
});
export type PurchaseEditInput = z.infer<typeof purchaseEditInputSchema>;
export const purchaseSupplierInputSchema = z.object({
  purchaseId: z.number().int().positive().optional(),
  inventoryId: z.number().int().positive(),
  supplierName: z.string().max(200).nullable(),
  supplierUrl: z.string().max(500).nullable().optional(),
});
export type PurchaseSupplierInput = z.infer<typeof purchaseSupplierInputSchema>;
export const purchaseTrackingInputSchema = z.object({
  zaicoId: z.number().int().positive(),
  shipDate: z.string().nullable().optional(),
  trackingNumber: z.string().max(200).nullable().optional(),
  carrier: z.string().max(50).nullable().optional(),
  note: z.string().nullable().optional(),
  inventoryId: z.number().int().positive().optional(),
  managementNo: z.string().max(200).optional(),
  labelId: z.string().max(20).optional(),
});
export type PurchaseTrackingInput = z.infer<typeof purchaseTrackingInputSchema>;
export const purchaseTrackingBulkInputSchema = z.object({
  zaicoIds: z.array(z.number().int().positive()).min(1).max(100),
  shipDate: z.string().nullable().optional(),
  trackingNumber: z.string().max(200).nullable().optional(),
  carrier: z.string().max(50).nullable().optional(),
  note: z.string().nullable().optional(),
});
export type PurchaseTrackingBulkInput = z.infer<
  typeof purchaseTrackingBulkInputSchema
>;
