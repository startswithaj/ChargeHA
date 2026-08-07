import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { ChargerRow } from "@chargeha/shared";
import type { ResolvedChargerRow } from "@chargeha/shared/plugins";
import { throwingMock } from "../../../../server/src/test-helpers/throwingMock.ts";
import type { OcppCentralSystem } from "./OcppCentralSystem.ts";
import { createOcppWsRoutes } from "./wsRoutes.ts";

describe("OCPP wsRoutes — the demux fix", () => {
  const log = new Logger("OcppWsTest", "error");

  const rowFor = (id: string, chargerId: string): ResolvedChargerRow => ({
    row: {
      id,
      name: id,
      chargerAdapterType: "ocpp",
      chargerConfig: "{}",
      mode: "auto",
      priority: 1,
      vehicleId: null,
      kind: "smart",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as ChargerRow,
    config: { charger_id: chargerId },
    secrets: {},
  });

  function deps(entries: ResolvedChargerRow[]): PluginDependencies {
    return throwingMock<PluginDependencies>("PluginDependencies", {
      log,
      resolveChargerConfigs: () => Promise.resolve(entries),
    });
  }

  function noopCentralSystem(
    overrides: Partial<OcppCentralSystem> = {},
  ): OcppCentralSystem {
    return throwingMock<OcppCentralSystem>("OcppCentralSystem", {
      acceptsPairing: () => false,
      shouldLogRejection: () => false,
      noteRejected: () => {},
      notePairedCharger: () => {},
      ...overrides,
    });
  }

  it("adopts a charge point id configured on row A", async () => {
    const app = createOcppWsRoutes(
      deps([rowFor("row-a", "cp-a"), rowFor("row-b", "cp-b")]),
      noopCentralSystem(),
    );
    const res = await app.fetch(
      new Request("http://localhost/cp-a", {
        headers: { Upgrade: "not-a-websocket" },
      }),
    );
    // Adoption passed; rejected only for not actually being a WS upgrade.
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Expected WebSocket upgrade");
  });

  it("also adopts a charge point id configured on row B — the demux regression test", async () => {
    const app = createOcppWsRoutes(
      deps([rowFor("row-a", "cp-a"), rowFor("row-b", "cp-b")]),
      noopCentralSystem(),
    );
    const res = await app.fetch(
      new Request("http://localhost/cp-b", {
        headers: { Upgrade: "not-a-websocket" },
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Expected WebSocket upgrade");
  });

  it("returns 404 and notes the rejection for an id configured on no row, pairing disarmed", async () => {
    let rejected: string | null = null;
    const app = createOcppWsRoutes(
      deps([rowFor("row-a", "cp-a")]),
      noopCentralSystem({
        acceptsPairing: () => false,
        noteRejected: (id: string) => {
          rejected = id;
        },
      }),
    );
    const res = await app.fetch(new Request("http://localhost/cp-unknown"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Unknown charger");
    expect(rejected).toBe("cp-unknown");
  });

  it("accepts the same unknown id provisionally when pairing is armed", async () => {
    const app = createOcppWsRoutes(
      deps([rowFor("row-a", "cp-a")]),
      noopCentralSystem({ acceptsPairing: () => true }),
    );
    const res = await app.fetch(
      new Request("http://localhost/cp-unknown", {
        headers: { Upgrade: "not-a-websocket" },
      }),
    );
    // Accepted for pairing; rejected only for not being a real WS upgrade —
    // proves it was not turned away as "unknown".
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Expected WebSocket upgrade");
  });

  it("a row with charger_id absent does not adopt an arbitrary id", async () => {
    const unconfiguredRow: ResolvedChargerRow = {
      row: rowFor("row-a", "cp-a").row,
      config: {},
      secrets: {},
    };
    let rejected: string | null = null;
    const app = createOcppWsRoutes(
      deps([unconfiguredRow]),
      noopCentralSystem({
        acceptsPairing: () => false,
        noteRejected: (id: string) => {
          rejected = id;
        },
      }),
    );
    const res = await app.fetch(new Request("http://localhost/anything"));
    expect(res.status).toBe(404);
    expect(rejected).toBe("anything");
  });
});
