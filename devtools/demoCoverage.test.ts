// Enforces that the demo accounts for EVERY query path on the real merged router
// (core + all plugins). Lives in devtools so it can import both the server router
// and the client's plain-string path inventory. If a route is added or removed
// anywhere and not handled/gated/pending in demoPaths.ts, this fails.

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createAppRouter } from "../packages/server/src/trpc/root.ts";
import { createTeslaRouter } from "../packages/plugins/vehicles/tesla/server/router.ts";
import type { TeslaVehiclePlugin } from "../packages/plugins/vehicles/tesla/server/index.ts";
import { createSimulatedRouter } from "../packages/plugins/vehicles/simulated/server/router.ts";
import type { SimulatedVehiclePlugin } from "../packages/plugins/vehicles/simulated/server/index.ts";
import { createFroniusLocalRouter } from "../packages/plugins/energy/fronius-local/server/router.ts";
import { createFroniusCloudRouter } from "../packages/plugins/energy/fronius-cloud/server/router.ts";
import { createSimulatedEnergyRouter } from "../packages/plugins/energy/simulated/server/router.ts";
import type { PluginDependencies } from "../packages/server/src/bootstrap/PluginDependencies.ts";
import {
  GATED_MUTATIONS,
  GATED_QUERIES,
  PENDING_QUERIES,
} from "../packages/client/src/lib/demo/demoPaths.ts";
import { queryHandlers } from "../packages/client/src/lib/demo/handlers/index.ts";
import { mutationHandlers } from "../packages/client/src/lib/demo/handlers/mutations/index.ts";

interface ProcedureDef {
  _def: { type: "query" | "mutation" | "subscription" };
}

// The router factories only need deps/plugin to close over — procedures are
// never invoked here, only their _def shape is inspected.
const stubDeps = (pluginId: string): PluginDependencies =>
  ({ pluginId }) as unknown as PluginDependencies;

const realPaths = (type: "query" | "mutation"): string[] => {
  const merged = createAppRouter({
    vehicle: {
      tesla: createTeslaRouter(
        { deps: stubDeps("tesla") } as unknown as TeslaVehiclePlugin,
      ),
      simulated: createSimulatedRouter(
        { deps: stubDeps("simulated") } as unknown as SimulatedVehiclePlugin,
      ),
    },
    energy: {
      fronius_local: createFroniusLocalRouter(stubDeps("fronius_local")),
      fronius_cloud: createFroniusCloudRouter(stubDeps("fronius_cloud")),
      simulated_energy: createSimulatedEnergyRouter(
        stubDeps("simulated_energy"),
      ),
    },
  });
  const procedures = (merged as unknown as {
    _def: { procedures: Record<string, ProcedureDef> };
  })
    ._def.procedures;
  return Object.entries(procedures)
    .filter(([, p]) => p._def.type === type)
    .map(([path]) => path)
    .sort();
};

describe("demo query coverage", () => {
  it("accounts for every query path on the real merged router", () => {
    const declared = [
      ...new Set([
        ...Object.keys(queryHandlers),
        ...GATED_QUERIES,
        ...PENDING_QUERIES,
      ]),
    ].sort();
    expect(declared).toEqual(realPaths("query"));
  });
});

describe("demo mutation coverage", () => {
  it("accounts for every mutation path on the real merged router", () => {
    const declared = [
      ...new Set([
        ...Object.keys(mutationHandlers),
        ...GATED_MUTATIONS,
      ]),
    ].sort();
    expect(declared).toEqual(realPaths("mutation"));
  });
});
