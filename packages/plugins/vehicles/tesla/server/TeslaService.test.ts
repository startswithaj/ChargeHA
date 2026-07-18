import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { TeslaService } from "./TeslaService.ts";
import type { TeslaServiceIo } from "./TeslaService.ts";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { TeslaTokenManager } from "./TeslaTokenManager.ts";
import type { Logger } from "@chargeha/server/lib/Logger";
import type { VehicleRow } from "@chargeha/server/db/types";

describe("TeslaService", () => {
  const VEHICLE_ROW: VehicleRow = {
    id: "VIN123",
    name: "Tesla",
    adapterType: "tesla",
    priority: 1,
    config: "{}",
    mode: "auto",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  // ── Mocks ───────────────────────────────────────────────────────────────────

  function mockLogger(): Logger {
    return {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    } as unknown as Logger;
  }

  function mockTokenManager(
    overrides: Partial<TeslaTokenManager> = {},
  ): TeslaTokenManager {
    return {
      getAccessToken: () => Promise.resolve("mock-token"),
      getFleetApiBaseUrl: () =>
        Promise.resolve("https://fleet-api.prd.na.vn.cloud.tesla.com"),
      stopAutoRefresh: () => {},
      deleteTokens: () => Promise.resolve(),
      ...overrides,
    } as unknown as TeslaTokenManager;
  }

  function mockDeps(
    overrides: Partial<PluginDependencies> = {},
  ): PluginDependencies {
    return {
      pluginId: "tesla",
      getConfig: () => Promise.resolve(null),
      setConfig: () => Promise.resolve(),
      getSecret: () => Promise.resolve(null),
      setSecret: () => Promise.resolve(),
      getVehicleRows: () => Promise.resolve([]),
      getVehicleRow: () => Promise.resolve(null),
      upsertVehicleRow: () => Promise.resolve(),
      addVehicle: () => Promise.resolve(),
      deleteVehicle: () => Promise.resolve(),
      tunnel: {
        getUrl: () => null,
        start: () => Promise.reject(new Error("tunnel start not mocked")),
        stop: () => Promise.resolve(),
        getExpiryMinutes: () => null,
      },
      setSimulatedLoad: () => {},
      log: mockLogger(),
      dbLog: mockLogger() as unknown as PluginDependencies["dbLog"],
      ...overrides,
    } as unknown as PluginDependencies;
  }

  function extractUrl(input: string | URL | Request): string {
    if (typeof input === "string") return input;
    if (input instanceof URL) return input.toString();
    return input.url;
  }

  function mockIo(
    fetchHandler: (
      url: string,
      init?: RequestInit,
    ) => Response | Promise<Response>,
    connectResult: "success" | "fail" = "success",
  ): TeslaServiceIo {
    const mockConnect = connectResult === "success"
      ? () => Promise.resolve({ close: () => {} })
      : () => Promise.reject(new Error("Connection refused"));
    return {
      fetch: (input: string | URL | Request, init?: RequestInit) =>
        Promise.resolve(fetchHandler(extractUrl(input), init)),
      connect: mockConnect as unknown as typeof Deno.connect,
      wakePollDelayMs: 0,
      wakePollAttempts: 3,
    };
  }

  function makeService(
    opts: {
      deps?: Partial<PluginDependencies>;
      tokenManager?: Partial<TeslaTokenManager>;
      io?: TeslaServiceIo;
    } = {},
  ): TeslaService {
    return new TeslaService(
      mockDeps(opts.deps ?? {}),
      mockTokenManager(opts.tokenManager ?? {}),
      mockLogger(),
      opts.io,
    );
  }

  const DEPS_WITH_CREDS: Partial<PluginDependencies> = {
    getConfig: (key: string) => {
      const config: Record<string, string> = {
        client_id: "id",
        region: "na",
        public_key_domain: "https://example.com",
      };
      return Promise.resolve(config[key] ?? null);
    },
    getSecret: (key: string) =>
      Promise.resolve(key === "client_secret" ? "secret" : null),
  };

  // ── listFleetVehicles ───────────────────────────────────────────────────────

  describe("TeslaService.listFleetVehicles", () => {
    it("returns mapped vehicle list from Fleet API", async () => {
      const io = mockIo(() =>
        new Response(
          JSON.stringify({
            response: [
              { vin: "VIN1", display_name: "Model 3", state: "online" },
              { vin: "VIN2", display_name: "Model Y", state: "asleep" },
            ],
          }),
          { status: 200 },
        )
      );

      const service = makeService({ io });
      const result = await service.listFleetVehicles();
      expect(result.vehicles).toHaveLength(2);
      expect(result.vehicles[0]).toEqual({
        vin: "VIN1",
        name: "Model 3",
        state: "online",
      });
      expect(result.vehicles[1]).toEqual({
        vin: "VIN2",
        name: "Model Y",
        state: "asleep",
      });
    });

    it("throws on non-ok response", async () => {
      const io = mockIo(() => new Response("Unauthorized", { status: 401 }));
      const service = makeService({ io });
      await expect(service.listFleetVehicles()).rejects.toThrow(
        "Tesla API error",
      );
    });
  });

  // ── resetOnboarding ─────────────────────────────────────────────────────────

  describe("TeslaService.resetOnboarding", () => {
    it("removes vehicles, resets config to defaults, and stops refresh", async () => {
      const deleted: string[] = [];
      const stopCalls: boolean[] = [];
      const configSet: string[] = [];
      const secretSet: string[] = [];

      const service = makeService({
        deps: {
          getVehicleRows: () => Promise.resolve([VEHICLE_ROW]),
          deleteVehicle: (id: string) => {
            deleted.push(id);
            return Promise.resolve();
          },
          setConfig: (key: string) => {
            configSet.push(key);
            return Promise.resolve();
          },
          setSecret: (key: string) => {
            secretSet.push(key);
            return Promise.resolve();
          },
        },
        tokenManager: {
          stopAutoRefresh: () => {
            stopCalls.push(true);
          },
        } as unknown as Partial<TeslaTokenManager>,
      });

      const result = await service.resetOnboarding();
      expect(result.success).toBe(true);
      expect(stopCalls).toHaveLength(1);
      expect(deleted).toEqual(["VIN123"]);
      // Secret keys reset via setSecret, the rest via setConfig.
      expect(secretSet).toEqual(
        expect.arrayContaining([
          "client_secret",
          "access_token",
          "refresh_token",
        ]),
      );
      expect(configSet).toEqual(
        expect.arrayContaining(["client_id", "region"]),
      );
    });

    it("keeps the EC keypair and a self-hosted domain + hosting mode", async () => {
      const configSet: string[] = [];
      const secretSet: string[] = [];

      const service = makeService({
        deps: {
          getConfig: (key: string) =>
            Promise.resolve(key === "public_key_hosting" ? "custom" : null),
          getVehicleRows: () => Promise.resolve([VEHICLE_ROW]),
          deleteVehicle: () => Promise.resolve(),
          setConfig: (key: string) => {
            configSet.push(key);
            return Promise.resolve();
          },
          setSecret: (key: string) => {
            secretSet.push(key);
            return Promise.resolve();
          },
        },
      });

      await service.resetOnboarding();
      expect(secretSet).not.toContain("ec_private_key");
      expect(configSet).not.toContain("ec_public_key_pem");
      expect(configSet).not.toContain("public_key_domain");
      expect(configSet).not.toContain("public_key_hosting");
    });

    it("clears the domain and hosting mode when hosting was a tunnel", async () => {
      const configSet: string[] = [];

      const service = makeService({
        deps: {
          getConfig: (key: string) =>
            Promise.resolve(key === "public_key_hosting" ? "tunnel" : null),
          getVehicleRows: () => Promise.resolve([VEHICLE_ROW]),
          deleteVehicle: () => Promise.resolve(),
          setConfig: (key: string) => {
            configSet.push(key);
            return Promise.resolve();
          },
          setSecret: () => Promise.resolve(),
        },
      });

      await service.resetOnboarding();
      // A tunnel URL is dead after a reset — cleared like everything else.
      expect(configSet).toContain("public_key_domain");
      expect(configSet).toContain("public_key_hosting");
      // The keypair still survives regardless of hosting mode.
      expect(configSet).not.toContain("ec_public_key_pem");
    });
  });

  // ── selectVehicle ───────────────────────────────────────────────────────────

  describe("TeslaService.selectVehicle", () => {
    it("upserts vehicle row and registers with manager", async () => {
      const upserted: unknown[] = [];
      const added: unknown[] = [];

      const service = makeService({
        deps: {
          upsertVehicleRow: (row) => {
            upserted.push(row);
            return Promise.resolve();
          },
          getVehicleRow: () => Promise.resolve(VEHICLE_ROW),
          addVehicle: (row) => {
            added.push(row);
            return Promise.resolve();
          },
        },
        // checkKeyPairing runs in background — needs IO that won't hang
        io: mockIo(() => new Response("{}", { status: 404 }), "fail"),
      });

      const result = await service.selectVehicle({
        vin: "VIN123",
        name: "My Tesla",
      });
      expect(result.success).toBe(true);
      expect(result.vin).toBe("VIN123");
      expect(upserted).toHaveLength(1);
      expect(added).toHaveLength(1);
    });
  });

  // ── registerPartner ─────────────────────────────────────────────────────────

  describe("TeslaService.registerPartner", () => {
    it("throws when client credentials are not configured", async () => {
      const service = makeService();
      await expect(service.registerPartner()).rejects.toThrow(
        "Tesla client credentials not configured",
      );
    });

    it("throws when domain is not configured", async () => {
      const service = makeService({
        deps: {
          getConfig: (key: string) =>
            Promise.resolve(key === "client_id" ? "id" : null),
          getSecret: (key: string) =>
            Promise.resolve(key === "client_secret" ? "secret" : null),
        },
      });
      await expect(service.registerPartner()).rejects.toThrow(
        "Tesla domain not configured",
      );
    });

    it("fetches partner token then registers", async () => {
      const fetches: string[] = [];
      const io = mockIo((url) => {
        fetches.push(url);
        if (url.includes("oauth2")) {
          return new Response(JSON.stringify({ access_token: "tok" }), {
            status: 200,
          });
        }
        if (url.includes("partner_accounts")) {
          return new Response(JSON.stringify({ response: {} }), {
            status: 200,
          });
        }
        return new Response("", { status: 404 });
      });

      const service = makeService({ deps: DEPS_WITH_CREDS, io });
      const result = await service.registerPartner();
      expect(result.success).toBe(true);
      expect(fetches).toHaveLength(2);
      expect(fetches[0]).toContain("oauth2");
      expect(fetches[1]).toContain("partner_accounts");
    });

    it("throws when partner token fetch fails", async () => {
      const io = mockIo(() => new Response("Unauthorized", { status: 401 }));
      const service = makeService({ deps: DEPS_WITH_CREDS, io });
      await expect(service.registerPartner()).rejects.toThrow(
        "Failed to obtain partner token",
      );
    });

    const tunnelModeConfig = (key: string) => {
      const config: Record<string, string> = {
        client_id: "id",
        region: "na",
        public_key_hosting: "tunnel",
      };
      return Promise.resolve(config[key] ?? null);
    };

    it("throws with a start-tunnel hint in tunnel mode when the tunnel is down", async () => {
      const service = makeService({
        deps: {
          getConfig: tunnelModeConfig,
          getSecret: (key: string) =>
            Promise.resolve(key === "client_secret" ? "secret" : null),
          tunnel: {
            getUrl: () => null,
            start: () => Promise.reject(new Error("tunnel start not mocked")),
            stop: () => Promise.resolve(),
            getExpiryMinutes: () => null,
          },
        },
      });
      await expect(service.registerPartner()).rejects.toThrow(
        "Tunnel is not running",
      );
    });

    it("registers the live tunnel URL in tunnel mode", async () => {
      const bodies: string[] = [];
      const io = mockIo((url, init) => {
        if (url.includes("oauth2")) {
          return new Response(JSON.stringify({ access_token: "tok" }), {
            status: 200,
          });
        }
        bodies.push(String(init?.body));
        return new Response(JSON.stringify({ response: {} }), { status: 200 });
      });
      const service = makeService({
        deps: {
          getConfig: tunnelModeConfig,
          getSecret: (key: string) =>
            Promise.resolve(key === "client_secret" ? "secret" : null),
          tunnel: {
            getUrl: () => "https://abc.trycloudflare.com",
            start: () => Promise.reject(new Error("tunnel start not mocked")),
            stop: () => Promise.resolve(),
            getExpiryMinutes: () => null,
          },
        },
        io,
      });
      const result = await service.registerPartner();
      expect(result.success).toBe(true);
      expect(bodies[0]).toContain("abc.trycloudflare.com");
    });
  });

  // ── checkProxyReachable ─────────────────────────────────────────────────────

  describe("TeslaService.checkProxyReachable", () => {
    it("returns not configured when no vehicles", async () => {
      const service = makeService();
      const result = await service.checkProxyReachable();
      expect(result).toEqual({ teslaConfigured: false, proxyReachable: false });
    });

    it("returns reachable when connect succeeds", async () => {
      const service = makeService({
        deps: {
          getVehicleRows: () => Promise.resolve([VEHICLE_ROW]),
          getConfig: (key: string) =>
            Promise.resolve(
              key === "proxy_url" ? "https://localhost:4443" : null,
            ),
        },
        io: mockIo(() => new Response("", { status: 200 }), "success"),
      });
      const result = await service.checkProxyReachable();
      expect(result).toEqual({ teslaConfigured: true, proxyReachable: true });
    });

    it("returns not reachable when connect fails", async () => {
      const service = makeService({
        deps: {
          getVehicleRows: () => Promise.resolve([VEHICLE_ROW]),
          getConfig: (key: string) =>
            Promise.resolve(
              key === "proxy_url" ? "https://localhost:4443" : null,
            ),
        },
        io: mockIo(() => new Response("", { status: 200 }), "fail"),
      });
      const result = await service.checkProxyReachable();
      expect(result).toEqual({ teslaConfigured: true, proxyReachable: false });
    });
  });

  // ── checkKeyPairing ─────────────────────────────────────────────────────────

  describe("TeslaService.checkKeyPairing", () => {
    const depsWithVehicle = (
      setConfigFn?: (key: string, value: string) => Promise<void>,
    ): Partial<PluginDependencies> => ({
      getConfig: (key: string) =>
        Promise.resolve(key === "proxy_url" ? "https://localhost:4443" : null),
      setConfig: setConfigFn ?? (() => Promise.resolve()),
      getVehicleRows: () => Promise.resolve([VEHICLE_ROW]),
    });

    it("returns error when no vehicle configured", async () => {
      const result = await makeService().checkKeyPairing();
      expect(result.paired).toBe(null);
      expect(result.error).toBe("No Tesla vehicle configured");
    });

    it("returns proxy not reachable when connect fails", async () => {
      const service = makeService({
        deps: depsWithVehicle(),
        io: mockIo(() => new Response("", { status: 200 }), "fail"),
      });
      const result = await service.checkKeyPairing();
      expect(result.paired).toBe(null);
      expect(result.error).toBe("Proxy not reachable");
    });

    it("returns paired true when command succeeds on first read", async () => {
      const configSet: Record<string, string> = {};
      const io = mockIo((url) => {
        if (url.includes("vehicle_data")) {
          return new Response(
            JSON.stringify({
              response: { charge_state: { charge_limit_soc: 80 } },
            }),
            { status: 200 },
          );
        }
        if (url.includes("set_charge_limit")) {
          return new Response(JSON.stringify({ response: { result: true } }), {
            status: 200,
          });
        }
        return new Response("", { status: 404 });
      });

      const service = makeService({
        deps: depsWithVehicle((key, value) => {
          configSet[key] = value;
          return Promise.resolve();
        }),
        io,
      });

      const result = await service.checkKeyPairing();
      expect(result.paired).toBe(true);
      expect(configSet["key_paired"]).toBe("true");
    });

    it("returns not paired when command returns pairing error", async () => {
      const configSet: Record<string, string> = {};
      const io = mockIo((url) => {
        if (url.includes("vehicle_data")) {
          return new Response(
            JSON.stringify({
              response: { charge_state: { charge_limit_soc: 80 } },
            }),
            { status: 200 },
          );
        }
        if (url.includes("set_charge_limit")) {
          return new Response(
            JSON.stringify({
              error: {
                message: "Public key has not been paired with this vehicle",
              },
            }),
            { status: 422 },
          );
        }
        return new Response("", { status: 404 });
      });

      const service = makeService({
        deps: depsWithVehicle((key, value) => {
          configSet[key] = value;
          return Promise.resolve();
        }),
        io,
      });

      const result = await service.checkKeyPairing();
      expect(result.paired).toBe(false);
      expect(configSet["key_paired"]).toBe("false");
    });

    it("returns could not read when vehicle never wakes", async () => {
      const io = mockIo((url) => {
        if (url.includes("wake_up")) return new Response("{}", { status: 200 });
        return new Response("{}", { status: 408 });
      });

      const service = makeService({ deps: depsWithVehicle(), io });
      const result = await service.checkKeyPairing();
      expect(result.paired).toBe(null);
      expect(result.error).toBe("Could not read vehicle data after waking");
    });
  });
});
