import { z } from "zod";
import { updateOidcConfigInput } from "@chargeha/shared/schemas";
import { publicProcedure, router } from "../trpc.ts";

export const authRouter = router({
  login: publicProcedure
    .input(z.object({
      username: z.string(),
      password: z.string(),
    }))
    .mutation(({ ctx, input }) =>
      ctx.authService.handleLogin(
        input.username,
        input.password,
        ctx.clientIp ?? "unknown",
        ctx.responseHeaders,
        ctx.isHttps ?? false,
      )
    ),

  logout: publicProcedure
    .mutation(({ ctx }) =>
      ctx.authService.handleLogout(
        ctx.sessionId,
        ctx.responseHeaders,
        ctx.isHttps ?? false,
      )
    ),

  session: publicProcedure
    .query(({ ctx }) => ctx.authService.getSessionStatus(ctx.sessionId)),

  changePassword: publicProcedure
    .input(z.object({
      currentPassword: z.string(),
      newPassword: z.string().min(1),
    }))
    .mutation(({ ctx, input }) =>
      ctx.authService.handleChangePassword(
        input.currentPassword,
        input.newPassword,
        ctx.sessionId,
      )
    ),

  oidcConfig: publicProcedure
    .query(({ ctx }) => ctx.authService.getOidcConfig()),

  updateOidcConfig: publicProcedure
    .input(updateOidcConfigInput)
    .mutation(({ ctx, input }) =>
      ctx.authService.handleUpdateOidcConfig(input)
    ),

  changeMode: publicProcedure
    .input(z.discriminatedUnion("newMode", [
      z.object({
        newMode: z.literal("none"),
        currentPassword: z.string().optional(),
      }),
      z.object({
        newMode: z.literal("local"),
        currentPassword: z.string().optional(),
        localConfig: z.object({
          username: z.string(),
          password: z.string(),
        }),
      }),
      z.object({
        newMode: z.literal("oidc"),
        currentPassword: z.string().optional(),
        oidcConfig: z.object({
          issuerUrl: z.string(),
          clientId: z.string(),
          clientSecret: z.string(),
          baseUrl: z.string(),
        }),
      }),
    ]))
    .mutation(({ ctx, input }) =>
      ctx.authService.handleChangeMode(
        input,
        ctx.responseHeaders,
        ctx.isHttps ?? false,
      )
    ),
});
