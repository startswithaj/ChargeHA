// deno-lint-ignore-file custom-plugin-refs/no-plugin-refs -- this is the one
// central inventory of every route, so it necessarily names plugin paths.

// Central inventory of every tRPC QUERY path and how the demo treats it. Plain
// string arrays (no imports) so both the client parity test and the Deno-side
// coverage test can read them without crossing environments.
//
// Enforcement:
//  - devtools/demoCoverage.test.ts asserts these cover the REAL merged router
//    (core + all plugins) exactly — a new/removed route fails CI.
//  - demoPaths.test.ts asserts HANDLED_QUERIES matches the actual handler map.
//
// As each domain is implemented, move its paths from PENDING_QUERIES to
// HANDLED_QUERIES. When PENDING is empty, delete it.

/** Queries the demo serves with a handler. */
export const HANDLED_QUERIES: readonly string[] = [];

/** Queries deliberately unreachable in demo (disabled plugins / features). */
export const GATED_QUERIES: readonly string[] = [
  // Tesla — disabled in the wizard, no tesla vehicle ever exists.
  "tesla.commandStatus",
  "tesla.getConfig",
  "tesla.teslaStatus",
  "tesla.teslaVehicles",
  // Fronius — disabled in the wizard, never the active adapter.
  "energy.fronius_local.getConfig",
  "energy.fronius_cloud.getConfig",
  // Cloudflare tunnel — Tesla-only setup step, never reached.
  "wizard.tunnelStatus",
];

/** Queries known to exist but not yet implemented. Shrinks to [] as we build. */
export const PENDING_QUERIES: readonly string[] = [
  "auth.oidcConfig",
  "auth.session",
  "config.battery.get",
  "config.charging.get",
  "config.equipment.get",
  "config.geocode",
  "config.geocodeAutocomplete",
  "config.home.get",
  "config.notification.get",
  "config.solar.get",
  "config.system.get",
  "config.systemAlert",
  "energy.getPlugins",
  "energy.history",
  "energy.realtime",
  "energy.simulated_energy.getConfig",
  "health.encryption",
  "health.pluginWarnings",
  "log.chargeController",
  "log.energyReads",
  "log.pluginLogs",
  "log.vehicleUpdates",
  "notification.providers",
  "schedule.active",
  "schedule.list",
  "stats.day",
  "stats.month",
  "stats.year",
  "tariff.currentRate",
  "tariff.defaultRate",
  "tariff.list",
  "vehicle.commandStatus",
  "vehicle.getPlugins",
  "vehicle.list",
  "wizard.getEnergyType",
  "wizard.getStep",
  "wizard.getVehicleType",
  "wizard.status",
];

/** Every query path the demo accounts for (handled + gated + pending). */
export const ALL_DEMO_QUERIES: readonly string[] = [
  ...HANDLED_QUERIES,
  ...GATED_QUERIES,
  ...PENDING_QUERIES,
];
