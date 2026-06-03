// Enforces that the demo accounts for EVERY query path on the real merged router
// (core + all plugins). Lives in devtools so it can import both the server router
// and the client's plain-string path inventory. If a route is added or removed
// anywhere and not handled/gated/pending in demoPaths.ts, this fails.

import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { createAppRouter } from "../packages/server/src/trpc/root.ts";
import { teslaRouter } from "../packages/plugins/vehicles/tesla/server/router.ts";
import { simulatedRouter } from "../packages/plugins/vehicles/simulated/server/router.ts";
import { froniusLocalRouter } from "../packages/plugins/energy/fronius-local/server/router.ts";
import { froniusCloudRouter } from "../packages/plugins/energy/fronius-cloud/server/router.ts";
import { simulatedEnergyRouter } from "../packages/plugins/energy/simulated/server/router.ts";
import { ALL_DEMO_QUERIES } from "../packages/client/src/lib/demo/demoPaths.ts";

interface ProcedureDef {
  _def: { type: "query" | "mutation" | "subscription" };
}

const realQueryPaths = (): string[] => {
  const merged = createAppRouter({
    vehicle: { tesla: teslaRouter, simulated: simulatedRouter },
    energy: {
      fronius_local: froniusLocalRouter,
      fronius_cloud: froniusCloudRouter,
      simulated_energy: simulatedEnergyRouter,
    },
  });
  const procedures = (merged as unknown as {
    _def: { procedures: Record<string, ProcedureDef> };
  })
    ._def.procedures;
  return Object.entries(procedures)
    .filter(([, p]) => p._def.type === "query")
    .map(([path]) => path)
    .sort();
};

describe("demo query coverage", () => {
  it("accounts for every query path on the real merged router", () => {
    expect([...ALL_DEMO_QUERIES].sort()).toEqual(realQueryPaths());
  });
});
