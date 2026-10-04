import { ADMIN_EMAILS } from "@shared/const";
import { protectedProcedure, router } from "../_core/trpc";

export const adminRouter = router({
    /**
     * 現在ログイン中のユーザーが管理者かどうかを返す
     */
    isAdmin: protectedProcedure.query(async ({ ctx }) => {
      return { isAdmin: ADMIN_EMAILS.includes(ctx.user.email ?? "") };
    }),
});
