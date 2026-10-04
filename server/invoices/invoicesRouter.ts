import { protectedProcedure, router } from "../_core/trpc";
import {
  createInvoiceSchema,
  updateInvoiceSchema,
  splitInvoiceSchema,
  updateInvoiceStatusSchema,
  invoiceChatSchema,
  invoiceImageSchema,
  invoiceRateSchema,
  invoiceIdSchema,
} from "./invoiceInput";
import {
  listInvoices,
  getInvoice,
  listDeletedInvoices,
  getLatestInvoice,
} from "./invoiceReads";
import {
  createInvoice,
  updateInvoice,
  deleteInvoice,
  restoreInvoice,
  permanentlyDeleteInvoice,
  updateInvoiceStatus,
  createSplitInvoices,
  cloneInvoice,
} from "./invoiceWrites";
import {
  parseInvoiceChat,
  detectInvoicePayments,
  getInvoiceImageAnalysisStatus,
  analyzeInvoiceScreenshot,
  getInvoiceExchangeRate,
} from "./invoiceAnalysis";
import { getNextInvoiceNumber } from "./invoiceNumbering";

export const invoicesRouter = router({
  list: protectedProcedure.query(listInvoices),
  get: protectedProcedure.input(invoiceIdSchema).query(getInvoice),
  parseWhatsApp: protectedProcedure
    .input(invoiceChatSchema)
    .mutation(parseInvoiceChat),
  detectPayments: protectedProcedure
    .input(invoiceChatSchema)
    .mutation(detectInvoicePayments),
  imageAnalysisStatus: protectedProcedure.query(getInvoiceImageAnalysisStatus),
  analyzeScreenshot: protectedProcedure
    .input(invoiceImageSchema)
    .mutation(analyzeInvoiceScreenshot),
  getNextNumber: protectedProcedure.query(getNextInvoiceNumber),
  create: protectedProcedure.input(createInvoiceSchema).mutation(createInvoice),
  update: protectedProcedure.input(updateInvoiceSchema).mutation(updateInvoice),
  delete: protectedProcedure.input(invoiceIdSchema).mutation(deleteInvoice),
  restore: protectedProcedure.input(invoiceIdSchema).mutation(restoreInvoice),
  permanentDelete: protectedProcedure
    .input(invoiceIdSchema)
    .mutation(permanentlyDeleteInvoice),
  listDeleted: protectedProcedure.query(listDeletedInvoices),
  updateStatus: protectedProcedure
    .input(updateInvoiceStatusSchema)
    .mutation(updateInvoiceStatus),
  getLatest: protectedProcedure.query(getLatestInvoice),
  getExchangeRate: protectedProcedure
    .input(invoiceRateSchema)
    .query(getInvoiceExchangeRate),
  createSplit: protectedProcedure
    .input(splitInvoiceSchema)
    .mutation(createSplitInvoices),
  clone: protectedProcedure.input(invoiceIdSchema).mutation(cloneInvoice),
});
