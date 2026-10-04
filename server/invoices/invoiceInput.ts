import { z } from "zod";

export const invoiceStatusSchema = z.enum(["draft", "sent", "paid"]);
export const invoiceIdSchema = z.object({ id: z.number() });
export const invoiceItemSchema = z.object({
  description: z.string().min(1),
  variant: z.string().optional(),
  quantity: z.number().min(0),
  unitPrice: z.number().min(0),
  currency: z.string().optional(),
  sortOrder: z.number().optional(),
  tax: z.number().min(0).optional(),
});

const invoiceFields = {
  clientId: z.number().nullable().optional(),
  clientSnapshot: z.any().optional(),
  invoiceDate: z.string().optional(),
  dueDate: z.string().optional(),
  currency: z.string().default("EUR"),
  showAmounts: z.boolean().default(false),
  notes: z.string().optional(),
  rawChat: z.string().optional(),
  status: invoiceStatusSchema.default("draft"),
  accentColor: z.string().optional(),
};

export const createInvoiceSchema = z.object({
  invoiceNumber: z.string().min(1),
  ...invoiceFields,
  items: z.array(invoiceItemSchema),
});
export const updateInvoiceSchema = z.object({
  id: z.number(),
  ...createInvoiceSchema.shape,
});
export const splitInvoiceSchema = z.object({
  baseInvoiceNumber: z.string().min(1),
  ...invoiceFields,
  exchangeRate: z.number().positive(),
  limitJpy: z.number().default(1000000),
  splits: z.array(
    z.object({
      invoiceNumber: z.string().min(1),
      items: z.array(invoiceItemSchema),
    })
  ),
});
export const updateInvoiceStatusSchema = z.object({
  id: z.number(),
  status: invoiceStatusSchema,
});
export const invoiceChatSchema = z.object({ chatText: z.string() });
export const invoiceImageSchema = z.object({
  base64: z.string(),
  mimeType: z.string().default("image/png"),
});
export const invoiceRateSchema = z.object({ currency: z.string() });

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type SplitInvoiceInput = z.infer<typeof splitInvoiceSchema>;
export type InvoiceItemInput = z.infer<typeof invoiceItemSchema>;
export type InvoiceFields = Omit<CreateInvoiceInput, "invoiceNumber" | "items">;
export type InvoiceIdInput = z.infer<typeof invoiceIdSchema>;
export type InvoiceStatusInput = z.infer<typeof updateInvoiceStatusSchema>;
export type InvoiceChatInput = z.infer<typeof invoiceChatSchema>;
export type InvoiceImageInput = z.infer<typeof invoiceImageSchema>;
export type InvoiceRateInput = z.infer<typeof invoiceRateSchema>;
