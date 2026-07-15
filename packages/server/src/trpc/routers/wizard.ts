import { publicProcedure, router } from "../trpc.ts";
import {
  wizardDemoSetupInput,
  wizardSaveOidcConfigInput,
  wizardSetAuthModeInput,
  wizardSetEnergyTypeInput,
  wizardSetStepInput,
  wizardSetVehicleTypeInput,
  wizardTestOidcDiscoveryInput,
} from "@chargeha/shared/schemas";

// Tesla procedures (generateKeys, importKeys, registerPartner) moved to
// plugins/vehicles/tesla/server/router.ts

export const wizardRouter = router({
  status: publicProcedure.query(async ({ ctx }) => {
    return await ctx.wizardService.getStatus();
  }),

  complete: publicProcedure.mutation(async ({ ctx }) => {
    return await ctx.wizardService.complete();
  }),

  demoSetup: publicProcedure
    .input(wizardDemoSetupInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.wizardService.demoSetup(input);
    }),

  setAuthMode: publicProcedure
    .input(wizardSetAuthModeInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.wizardService.setAuthMode(
        input,
        ctx.responseHeaders,
        ctx.isHttps,
      );
    }),

  saveOidcConfig: publicProcedure
    .input(wizardSaveOidcConfigInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.wizardService.saveOidcConfig(input);
    }),

  testOidcDiscovery: publicProcedure
    .input(wizardTestOidcDiscoveryInput)
    .mutation(async ({ ctx, input }) => {
      return await ctx.oidcService.testDiscovery(input.issuerUrl);
    }),

  // ── Wizard navigation state ────────────────────────────────────────────

  getStep: publicProcedure.query(async ({ ctx }) => {
    return await ctx.wizardService.getStep();
  }),

  setStep: publicProcedure
    .input(wizardSetStepInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.wizardService.setStep(input.stepId);
    }),

  getVehicleType: publicProcedure.query(async ({ ctx }) => {
    return await ctx.wizardService.getVehicleType();
  }),

  setVehicleType: publicProcedure
    .input(wizardSetVehicleTypeInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.wizardService.setVehicleType(input.type);
    }),

  getEnergyType: publicProcedure.query(async ({ ctx }) => {
    return await ctx.wizardService.getEnergyType();
  }),

  setEnergyType: publicProcedure
    .input(wizardSetEnergyTypeInput)
    .mutation(async ({ ctx, input }) => {
      await ctx.wizardService.setEnergyType(input.type);
    }),
});
