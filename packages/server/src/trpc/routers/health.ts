import { publicProcedure, router } from "../trpc.ts";

export const healthRouter = router({
  // Check if ENCRYPTION_KEY is configured
  encryption: publicProcedure.query(({ ctx }) =>
    ctx.healthService.checkEncryption()
  ),

  // Collect user-facing warnings from all failed plugin health checks
  pluginWarnings: publicProcedure.query(({ ctx }) =>
    ctx.healthService.getPluginWarnings()
  ),
});
