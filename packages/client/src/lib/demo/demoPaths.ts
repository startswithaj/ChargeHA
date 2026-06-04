// deno-lint-ignore-file custom-plugin-refs/no-plugin-refs -- this is the one
// central inventory of routes, so it necessarily names plugin paths.

// Declares only what needs human judgement: which query paths the demo
// deliberately does NOT serve (GATED) and which are known-but-not-yet-built
// (PENDING). The set of HANDLED paths is derived from the actual handler map
// (Object.keys), so it can never drift.
//
// devtools/demoCoverage.test.ts asserts handlers ∪ GATED ∪ PENDING equals the
// real merged router's query paths — add/remove a route anywhere and CI fails.

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
  "energy.getPlugins",
  "energy.history",
  "energy.realtime",
  "energy.simulated_energy.getConfig",
  "log.chargeController",
  "log.energyReads",
  "log.pluginLogs",
  "log.vehicleUpdates",
  "vehicle.commandStatus",
  "vehicle.getPlugins",
  "vehicle.list",
];
