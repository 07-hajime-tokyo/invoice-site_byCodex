import { purchaseTrackingInputSchema, purchaseTrackingBulkInputSchema } from "./purchases/saveInput";
import { savePurchaseTracking, savePurchaseTrackingBulk } from "./purchases/saveTracking";
import { protectedProcedure, router } from "../_core/trpc";

const publicProcedure = protectedProcedure;

export const purchaseExtraRouter = router({
    upsert: publicProcedure
      .input(
        purchaseTrackingInputSchema
      )
      .mutation(async ({ input, ctx }) => savePurchaseTracking(input, ctx.user ?? {})),
    upsertBulk: publicProcedure
      .input(
        purchaseTrackingBulkInputSchema
      )
      .mutation(async ({ input, ctx }) => savePurchaseTrackingBulk(input, ctx.user ?? {})),
});
