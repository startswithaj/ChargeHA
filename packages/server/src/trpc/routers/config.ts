import { publicProcedure, router } from "../trpc.ts";
import {
  batteryConfigInput,
  chargingConfigInput,
  equipmentConfigInput,
  homeConfigInput,
  notificationConfigInput,
  solarConfigInput,
  systemConfigInput,
} from "@chargeha/shared/configSections";
import {
  configSetInput,
  geocodeAutocompleteInput,
  geocodeInput,
} from "@chargeha/shared/schemas";

// ── Per-section sub-routers ─────────────────────────────────────────────────

const chargingRouter = router({
  get: publicProcedure.query(({ ctx }) => ctx.configService.getCharging()),
  set: publicProcedure
    .input(chargingConfigInput)
    .mutation(({ ctx, input }) => ctx.configService.setCharging(input)),
});

const solarRouter = router({
  get: publicProcedure.query(({ ctx }) => ctx.configService.getSolar()),
  set: publicProcedure
    .input(solarConfigInput)
    .mutation(({ ctx, input }) => ctx.configService.setSolar(input)),
});

const batteryRouter = router({
  get: publicProcedure.query(({ ctx }) => ctx.configService.getBattery()),
  set: publicProcedure
    .input(batteryConfigInput)
    .mutation(({ ctx, input }) => ctx.configService.setBattery(input)),
});

const homeRouter = router({
  get: publicProcedure.query(({ ctx }) => ctx.configService.getHome()),
  set: publicProcedure
    .input(homeConfigInput)
    .mutation(({ ctx, input }) => ctx.configService.setHome(input)),
});

const equipmentRouter = router({
  get: publicProcedure.query(({ ctx }) => ctx.configService.getEquipment()),
  set: publicProcedure
    .input(equipmentConfigInput)
    .mutation(({ ctx, input }) => ctx.configService.setEquipment(input)),
});

const systemRouter = router({
  get: publicProcedure.query(({ ctx }) => ctx.configService.getSystem()),
  set: publicProcedure
    .input(systemConfigInput)
    .mutation(({ ctx, input }) => ctx.configService.setSystem(input)),
});

const notificationRouter = router({
  get: publicProcedure.query(({ ctx }) => ctx.configService.getNotification()),
  set: publicProcedure
    .input(notificationConfigInput)
    .mutation(({ ctx, input }) => ctx.configService.setNotification(input)),
});

// ── Main config router ──────────────────────────────────────────────────────

export const configRouter = router({
  // Per-section typed sub-routers (core sections only)
  charging: chargingRouter,
  solar: solarRouter,
  battery: batteryRouter,
  home: homeRouter,
  equipment: equipmentRouter,
  system: systemRouter,
  notification: notificationRouter,

  // System alert (from internal config section)
  systemAlert: publicProcedure.query(({ ctx }) =>
    ctx.configService.getSystemAlert()
  ),

  // Geocode an address
  geocode: publicProcedure
    .input(geocodeInput)
    .query(({ ctx, input }) => ctx.geocodeService.geocodeAddress(input.q)),

  // Address autocomplete
  geocodeAutocomplete: publicProcedure
    .input(geocodeAutocompleteInput)
    .query(({ ctx, input }) => ctx.geocodeService.geocodeAutocomplete(input.q)),

  // Set a single config value (operational use: Overseer, WizardService, etc.)
  set: publicProcedure
    .input(configSetInput)
    .mutation(({ ctx, input }) =>
      ctx.configService.setConfigValue(input.key, input.value)
    ),

  // Clear system alert
  dismissSystemAlert: publicProcedure
    .mutation(({ ctx }) => ctx.configService.dismissSystemAlert()),
});
