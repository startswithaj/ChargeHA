import { publicProcedure, router } from "../trpc.ts";
import { PROVIDER_CONFIG_FIELDS } from "../../services/notification-providers/types.ts";

export const notificationsRouter = router({
  providers: publicProcedure.query(() => {
    return PROVIDER_CONFIG_FIELDS;
  }),

  test: publicProcedure.mutation(async ({ ctx }) => {
    try {
      await ctx.notificationService.sendTest();
      return { success: true as const };
    } catch (err) {
      return {
        success: false as const,
        error: err instanceof Error ? err.message : "Failed to send test",
      };
    }
  }),
});
