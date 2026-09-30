import { z } from "zod";
import { getReceiptAckSummary, markReceiptAckDone } from "./receiptAck";
import { protectedProcedure, router } from "../_core/trpc";

const publicProcedure = protectedProcedure;

export const receiptAckRouter = router({
    summary: publicProcedure.query(async () => {
      return getReceiptAckSummary();
    }),

    markDone: publicProcedure
      .input(z.object({ purchaseId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        return markReceiptAckDone(input.purchaseId);
      }),
});
