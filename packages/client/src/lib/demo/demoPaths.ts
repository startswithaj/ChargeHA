// deno-lint-ignore-file custom-plugin-refs/no-plugin-refs -- this is the one
// central inventory of routes, so it necessarily names plugin paths.

// Declares only what needs human judgement: which query paths the demo
// deliberately does NOT serve (GATED) and which are known-but-not-yet-built
// (PENDING). The set of HANDLED paths is derived from the actual handler map
// (Object.keys), so it can never drift.
//
// devtools/demoCoverage.test.ts asserts handlers ∪ GATED ∪ PENDING equals the
// real merged router's query paths — add/remove a route anywhere and CI fails.
//
// Both arrays are `satisfies readonly QueryPath[]`: a typo or non-existent path
// is a compile error (QueryPath is derived from the real merged router type).
// The `readonly string[]` annotation keeps the export usable for runtime
// membership checks (e.g. GATED_QUERIES.includes(path)).

import type { MutationPath, QueryPath } from "./queryPaths.ts";

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
] as const satisfies readonly QueryPath[];

/** Queries known to exist but not yet implemented. Empty — all are handled. */
export const PENDING_QUERIES: readonly string[] =
  [] as const satisfies readonly QueryPath[];

/** Mutations deliberately unreachable in demo (disabled plugins / features). */
export const GATED_MUTATIONS: readonly string[] = [
  // Tesla — disabled in the wizard, no tesla vehicle ever exists.
  "tesla.checkKeyPairing",
  "tesla.disconnect",
  "tesla.generateKeys",
  "tesla.getAuthUrl",
  "tesla.importKeys",
  "tesla.registerPartner",
  "tesla.selectVehicle",
  "tesla.setConfig",
  // Fronius — disabled in the wizard, never the active adapter.
  "energy.fronius_cloud.setConfig",
  "energy.fronius_cloud.testConnection",
  "energy.fronius_local.discover",
  "energy.fronius_local.setConfig",
  "energy.fronius_local.testConnection",
  // OIDC — disabled in demo (Feature.OidcAuth off).
  "auth.updateOidcConfig",
  "wizard.saveOidcConfig",
  "wizard.testOidcDiscovery",
  // Cloudflare tunnel — Tesla-only setup step, never reached.
  "wizard.startTunnel",
  "wizard.stopTunnel",
] as const satisfies readonly MutationPath[];

/** Mutations known to exist but not yet implemented. Shrinks to [] as 5c–5e land. */
export const PENDING_MUTATIONS: readonly string[] = [
  "auth.changeMode",
  "auth.changePassword",
  "auth.login",
  "auth.logout",
  "config.battery.set",
  "config.charging.set",
  "config.dismissSystemAlert",
  "config.equipment.set",
  "config.home.set",
  "config.notification.set",
  "config.set",
  "config.solar.set",
  "config.system.set",
  "energy.simulated_energy.setConfig",
  "notification.test",
  "schedule.create",
  "schedule.delete",
  "schedule.update",
  "simulated.updateState",
  "tariff.create",
  "tariff.delete",
  "tariff.loadPreset",
  "tariff.update",
  "tariff.updateDefaultRate",
  "vehicle.command",
  "vehicle.create",
  "vehicle.delete",
  "vehicle.refreshState",
  "vehicle.setAmps",
  "vehicle.setMode",
  "vehicle.setPriority",
  "wizard.complete",
  "wizard.demoSetup",
  "wizard.setAuthMode",
  "wizard.setEnergyType",
  "wizard.setStep",
  "wizard.setVehicleType",
] as const satisfies readonly MutationPath[];
