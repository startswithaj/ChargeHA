import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { WizardService } from "./WizardService.ts";

describe("WizardService", () => {
  const mockLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  };

  type MockDb = Record<string, unknown>;
  type MockTunnel = Record<string, unknown>;
  type MockVehicleMgr = Record<string, unknown>;
  type MockAuth = Record<string, unknown>;
  type MockOidc = Record<string, unknown>;

  function defaultDb(): MockDb {
    return {
      getConfig: () => Promise.resolve(null),
      setConfig: () => Promise.resolve(),
      getVehicles: () => Promise.resolve([]),
      upsertVehicle: () => Promise.resolve(),
      upsertOidcConfig: () => Promise.resolve({}),
      setSecret: () => Promise.resolve(),
    };
  }

  function defaultTunnel(): MockTunnel {
    return {
      isRunning: false,
      tunnelUrl: null,
      start: () => Promise.resolve("https://tunnel.example.com"),
      stop: () => Promise.resolve(),
    };
  }

  function defaultVehicleMgr(): MockVehicleMgr {
    return { syncVehicles: () => Promise.resolve() };
  }

  function defaultAuth(): MockAuth {
    return { changeMode: () => Promise.resolve(null) };
  }

  function defaultOidc(): MockOidc {
    return {
      testDiscovery: () => Promise.resolve({ success: true }),
      initOidc: () => Promise.resolve(),
    };
  }

  function makeService(overrides: {
    db?: MockDb;
    encryptionKey?: string | null;
    logger?: Record<string, unknown>;
    tunnelManager?: MockTunnel;
    vehicleManager?: MockVehicleMgr;
    authService?: MockAuth;
    oidcService?: MockOidc;
  } = {}): WizardService {
    const db = overrides.db ?? defaultDb();
    const tunnelManager = overrides.tunnelManager ?? defaultTunnel();
    const vehicleManager = overrides.vehicleManager ?? defaultVehicleMgr();
    const authService = overrides.authService ?? defaultAuth();
    const oidcService = overrides.oidcService ?? defaultOidc();
    return new WizardService(
      db as never,
      overrides.encryptionKey ?? null,
      (overrides.logger ?? mockLogger) as never,
      tunnelManager as never,
      vehicleManager as never,
      authService as never,
      oidcService as never,
    );
  }

  // ── getStatus ─────────────────────────────────────────────────────────

  describe("getStatus", () => {
    it("returns completed:true when wizard_completed is 'true'", async () => {
      const service = makeService({
        db: {
          getConfig: (key: string) =>
            Promise.resolve(
              key === "wizard_completed" ? "true" : "fronius-local",
            ),
          getVehicles: () => Promise.resolve([{ id: "v1" }]),
        },
      });
      const result = await service.getStatus();
      expect(result.completed).toBe(true);
      expect(result.firstRun).toBe(false);
    });

    it("returns firstRun:true when not completed, no vehicles, no adapter", async () => {
      const service = makeService({
        db: {
          getConfig: (key: string) =>
            Promise.resolve(
              key === "wizard_completed" ? null : null,
            ),
          getVehicles: () => Promise.resolve([]),
        },
      });
      const result = await service.getStatus();
      expect(result.completed).toBe(false);
      expect(result.firstRun).toBe(true);
    });

    it("returns firstRun:true when adapterType is empty string", async () => {
      const service = makeService({
        db: {
          getConfig: (key: string) =>
            Promise.resolve(
              key === "wizard_completed" ? null : "",
            ),
          getVehicles: () => Promise.resolve([]),
        },
      });
      const result = await service.getStatus();
      expect(result.firstRun).toBe(true);
    });

    it("returns firstRun:false when vehicles exist", async () => {
      const service = makeService({
        db: {
          getConfig: () => Promise.resolve(null),
          getVehicles: () => Promise.resolve([{ id: "v1" }]),
        },
      });
      const result = await service.getStatus();
      expect(result.firstRun).toBe(false);
    });

    it("returns firstRun:false when adapterType is set", async () => {
      const service = makeService({
        db: {
          getConfig: (key: string) =>
            Promise.resolve(
              key === "energy_adapter_type" ? "fronius-local" : null,
            ),
          getVehicles: () => Promise.resolve([]),
        },
      });
      const result = await service.getStatus();
      expect(result.firstRun).toBe(false);
    });
  });

  // ── complete ──────────────────────────────────────────────────────────

  describe("complete", () => {
    it("stops tunnel when running and clears wizard state", async () => {
      let tunnelStopped = false;
      const configSet: Record<string, string> = {};
      const service = makeService({
        tunnelManager: {
          isRunning: true,
          tunnelUrl: "https://tunnel.example.com",
          start: () => Promise.resolve("https://tunnel.example.com"),
          stop: () => {
            tunnelStopped = true;
            return Promise.resolve();
          },
        },
        db: {
          setConfig: (key: string, value: string) => {
            configSet[key] = value;
            return Promise.resolve();
          },
        },
      });

      const result = await service.complete();

      expect(tunnelStopped).toBe(true);
      expect(result).toEqual({ completed: true });
      expect(configSet["wizard_step"]).toBe("");
      expect(configSet["wizard_vehicle_type"]).toBe("");
      expect(configSet["wizard_energy_type"]).toBe("");
      expect(configSet["wizard_oidc_pending"]).toBe("");
      expect(configSet["wizard_completed"]).toBe("true");
    });

    it("skips tunnel stop when not running", async () => {
      let tunnelStopped = false;
      const service = makeService({
        tunnelManager: {
          isRunning: false,
          tunnelUrl: null,
          stop: () => {
            tunnelStopped = true;
            return Promise.resolve();
          },
        },
        db: {
          setConfig: () => Promise.resolve(),
        },
      });

      await service.complete();

      expect(tunnelStopped).toBe(false);
    });
  });

  // ── Navigation state (getState/patchState) ───────────────────────────

  describe("getState", () => {
    it("reads every field from its config key", async () => {
      const stored: Record<string, string> = {
        wizard_step: "tesla-credentials",
        wizard_vehicle_type: "tesla",
        wizard_energy_type: "fronius_local",
      };
      const service = makeService({
        db: {
          getConfig: (key: string) => Promise.resolve(stored[key] ?? null),
        },
      });

      expect(await service.getState()).toEqual({
        stepId: "tesla-credentials",
        vehicleType: "tesla",
        energyType: "fronius_local",
      });
    });

    it("defaults each field to empty string when db returns null", async () => {
      const service = makeService({
        db: {
          getConfig: () => Promise.resolve(null),
        },
      });

      expect(await service.getState()).toEqual({
        stepId: "",
        vehicleType: "",
        energyType: "",
      });
    });
  });

  describe("patchState", () => {
    it("writes each provided field to its own config key", async () => {
      const configSet: Record<string, string> = {};
      const service = makeService({
        db: {
          setConfig: (key: string, value: string) => {
            configSet[key] = value;
            return Promise.resolve();
          },
        },
      });

      await service.patchState({
        stepId: "tesla-key-generation",
        vehicleType: "tesla",
        energyType: "fronius_local",
      });

      expect(configSet).toEqual({
        wizard_step: "tesla-key-generation",
        wizard_vehicle_type: "tesla",
        wizard_energy_type: "fronius_local",
      });
    });

    it("leaves omitted fields untouched", async () => {
      const configSet: Record<string, string> = {};
      const service = makeService({
        db: {
          setConfig: (key: string, value: string) => {
            configSet[key] = value;
            return Promise.resolve();
          },
        },
      });

      await service.patchState({ stepId: "done" });

      expect(configSet).toEqual({ wizard_step: "done" });
    });

    it("writes an empty string rather than skipping the field", async () => {
      const configSet: Record<string, string> = {};
      const service = makeService({
        db: {
          setConfig: (key: string, value: string) => {
            configSet[key] = value;
            return Promise.resolve();
          },
        },
      });

      // "" is a real selection (None / Skip on the energy step), not an
      // absent one — only undefined means "don't touch this field".
      await service.patchState({ energyType: "" });

      expect(configSet).toEqual({ wizard_energy_type: "" });
    });
  });

  // ── setAuthMode ───────────────────────────────────────────────────────

  describe("setAuthMode", () => {
    it("delegates to authService.changeMode with correct input", async () => {
      let capturedInput: unknown = null;
      const service = makeService({
        authService: {
          changeMode: (input: unknown) => {
            capturedInput = input;
            return Promise.resolve(null);
          },
        },
      });

      await service.setAuthMode({ mode: "none" });

      expect(capturedInput).toEqual({
        newMode: "none",
        localConfig: undefined,
        oidcConfig: undefined,
      });
    });

    it("passes localConfig through to changeMode", async () => {
      let capturedInput: unknown = null;
      const service = makeService({
        authService: {
          changeMode: (input: unknown) => {
            capturedInput = input;
            return Promise.resolve("session-123");
          },
        },
      });

      await service.setAuthMode({
        mode: "local",
        localConfig: { username: "admin", password: "password123" },
      });

      expect(capturedInput).toEqual({
        newMode: "local",
        localConfig: { username: "admin", password: "password123" },
        oidcConfig: undefined,
      });
    });

    it("sets session cookie when changeMode returns a session ID", async () => {
      const service = makeService({
        authService: {
          changeMode: () => Promise.resolve("session-abc-123"),
        },
      });
      const responseHeaders = new Headers();

      await service.setAuthMode(
        { mode: "local", localConfig: { username: "admin", password: "pw" } },
        responseHeaders,
        false,
      );

      const setCookie = responseHeaders.get("Set-Cookie");
      expect(setCookie).not.toBeNull();
      expect(setCookie).toContain("session_id=session-abc-123");
      expect(setCookie).toContain("HttpOnly");
    });

    it("sets Secure flag on cookie when isHttps is true", async () => {
      const service = makeService({
        authService: {
          changeMode: () => Promise.resolve("session-xyz"),
        },
      });
      const responseHeaders = new Headers();

      await service.setAuthMode(
        { mode: "local", localConfig: { username: "admin", password: "pw" } },
        responseHeaders,
        true,
      );

      const setCookie = responseHeaders.get("Set-Cookie");
      expect(setCookie).toContain("Secure");
    });

    it("does not set cookie when changeMode returns null", async () => {
      const service = makeService({
        authService: {
          changeMode: () => Promise.resolve(null),
        },
      });
      const responseHeaders = new Headers();

      await service.setAuthMode({ mode: "none" }, responseHeaders, false);

      const setCookie = responseHeaders.get("Set-Cookie");
      expect(setCookie).toBeNull();
    });

    it("defaults isHttps to false when omitted", async () => {
      const service = makeService({
        authService: {
          changeMode: () => Promise.resolve("session-id"),
        },
      });
      const responseHeaders = new Headers();

      // Call without isHttps parameter
      await service.setAuthMode(
        { mode: "local", localConfig: { username: "admin", password: "pw" } },
        responseHeaders,
      );

      const setCookie = responseHeaders.get("Set-Cookie");
      expect(setCookie).not.toBeNull();
      expect(setCookie).not.toContain("Secure");
    });

    it("does not crash when responseHeaders is omitted", async () => {
      const service = makeService({
        authService: {
          changeMode: () => Promise.resolve("session-id"),
        },
      });

      // Call without responseHeaders — sessionId is truthy but responseHeaders is undefined
      const result = await service.setAuthMode({
        mode: "local",
        localConfig: { username: "admin", password: "pass" },
      });
      expect(result).toEqual({ success: true });
    });

    it("returns { success: true }", async () => {
      const service = makeService();
      const result = await service.setAuthMode({ mode: "none" });
      expect(result).toEqual({ success: true });
    });

    it("logs the mode change", async () => {
      const logged: string[] = [];
      const service = makeService({
        logger: { ...mockLogger, info: (msg: string) => logged.push(msg) },
      });

      await service.setAuthMode({
        mode: "oidc",
        oidcConfig: {
          issuerUrl: "https://issuer.example.com",
          clientId: "cid",
          clientSecret: "secret",
          baseUrl: "https://app.example.com",
        },
      });

      expect(logged.some((m) => m.includes("oidc"))).toBe(true);
    });
  });

  // ── saveOidcConfig ────────────────────────────────────────────────────

  describe("saveOidcConfig", () => {
    it("tests discovery and saves config", async () => {
      let discoveryTested = false;
      let upsertedConfig: unknown = null;
      const configSet: Record<string, string> = {};

      const service = makeService({
        db: {
          upsertOidcConfig: (config: unknown) => {
            upsertedConfig = config;
            return Promise.resolve({});
          },
          setConfig: (key: string, value: string) => {
            configSet[key] = value;
            return Promise.resolve();
          },
        },
        oidcService: {
          testDiscovery: () => {
            discoveryTested = true;
            return Promise.resolve({ success: true });
          },
        },
      });

      const result = await service.saveOidcConfig({
        issuerUrl: "https://auth.example.com",
        clientId: "chargeha",
        clientSecret: "secret123",
        baseUrl: "https://chargeha.example.com",
      });

      expect(result).toEqual({ success: true });
      expect(discoveryTested).toBe(true);
      expect(upsertedConfig).toEqual({
        issuerUrl: "https://auth.example.com",
        clientId: "chargeha",
        clientSecret: "secret123",
        isEncrypted: false,
        baseUrl: "https://chargeha.example.com",
      });
      expect(configSet["wizard_oidc_pending"]).toBe("true");
    });

    it("throws when discovery fails with error message", async () => {
      const service = makeService({
        oidcService: {
          testDiscovery: () =>
            Promise.resolve({
              success: false,
              error: "Discovery endpoint returned 404",
            }),
          initOidc: () => Promise.resolve(),
        },
      });

      try {
        await service.saveOidcConfig({
          issuerUrl: "https://bad.example.com",
          clientId: "chargeha",
          clientSecret: "secret123",
          baseUrl: "https://chargeha.example.com",
        });
        expect(true).toBe(false);
      } catch (err) {
        expect((err as Error).message).toContain("404");
      }
    });

    it("uses error message from discovery failure", async () => {
      const service = makeService({
        oidcService: {
          testDiscovery: () =>
            Promise.resolve({
              success: false,
              error: "OIDC discovery failed",
            }),
          initOidc: () => Promise.resolve(),
        },
      });

      try {
        await service.saveOidcConfig({
          issuerUrl: "https://bad.example.com",
          clientId: "chargeha",
          clientSecret: "secret123",
          baseUrl: "https://chargeha.example.com",
        });
        expect(true).toBe(false);
      } catch (err) {
        expect((err as Error).message).toBe("OIDC discovery failed");
      }
    });

    it("encrypts client secret when encryption key is available", async () => {
      let savedSecret: string | null = null;
      let savedIsEncrypted: boolean | null = null;

      const encKey = btoa(
        String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
      );

      const service = makeService({
        db: {
          upsertOidcConfig: (
            config: { clientSecret: string; isEncrypted: boolean },
          ) => {
            savedSecret = config.clientSecret;
            savedIsEncrypted = config.isEncrypted;
            return Promise.resolve({});
          },
          setConfig: () => Promise.resolve(),
        },
        encryptionKey: encKey,
      });

      await service.saveOidcConfig({
        issuerUrl: "https://auth.example.com",
        clientId: "chargeha",
        clientSecret: "secret123",
        baseUrl: "https://chargeha.example.com",
      });

      expect(savedIsEncrypted).toBe(true);
      expect(savedSecret).not.toBe("secret123");
    });
  });

  // ── demoSetup ─────────────────────────────────────────────────────────

  describe("demoSetup", () => {
    it("creates simulated vehicle, sets defaults, and registers it", async () => {
      let upsertedVehicle: unknown = null;
      const configSet: Record<string, string> = {};
      let addedVehicle: unknown = null;

      const service = makeService({
        db: {
          upsertVehicle: (v: unknown) => {
            upsertedVehicle = v;
            return Promise.resolve();
          },
          getVehicle: (id: string) =>
            Promise.resolve({
              id,
              name: "Demo EV",
              adapterType: "simulated",
              priority: 1,
              config: JSON.stringify({ batteryCapacityKwh: 60 }),
              mode: "auto",
              createdAt: "2026-01-01",
              updatedAt: "2026-01-01",
            }),
          setConfig: (key: string, value: string) => {
            configSet[key] = value;
            return Promise.resolve();
          },
        },
        vehicleManager: {
          addVehicle: (row: unknown) => {
            addedVehicle = row;
            return Promise.resolve();
          },
        },
      });

      const result = await service.demoSetup({
        adapterType: "simulated",
        timezone: "Australia/Sydney",
      });

      expect(result).toEqual({ success: true });
      expect(upsertedVehicle).toEqual({
        id: "DEMO-001",
        name: "Demo EV",
        adapterType: "simulated",
        priority: 1,
        config: JSON.stringify({ batteryCapacityKwh: 60 }),
        mode: "auto",
      });
      // demoSetup must not pick the energy source — that's the user's choice
      // on the inverter-type step.
      expect(configSet["energy_adapter_type"]).toBeUndefined();
      expect(configSet["home_latitude"]).toBe("-33.8688");
      expect(configSet["home_longitude"]).toBe("151.2093");
      expect(configSet["timezone"]).toBe("Australia/Sydney");
      expect((addedVehicle as { id: string }).id).toBe("DEMO-001");
    });

    it("skips timezone when not provided", async () => {
      const configSet: Record<string, string> = {};

      const service = makeService({
        db: {
          upsertVehicle: () => Promise.resolve(),
          getVehicle: () => Promise.resolve(null),
          setConfig: (key: string, value: string) => {
            configSet[key] = value;
            return Promise.resolve();
          },
        },
        vehicleManager: { addVehicle: () => Promise.resolve() },
      });

      await service.demoSetup({ adapterType: "simulated" });

      expect(configSet["timezone"]).toBeUndefined();
    });

    it("skips timezone when null", async () => {
      const configSet: Record<string, string> = {};

      const service = makeService({
        db: {
          upsertVehicle: () => Promise.resolve(),
          getVehicle: () => Promise.resolve(null),
          setConfig: (key: string, value: string) => {
            configSet[key] = value;
            return Promise.resolve();
          },
        },
        vehicleManager: { addVehicle: () => Promise.resolve() },
      });

      await service.demoSetup({ adapterType: "simulated", timezone: null });

      expect(configSet["timezone"]).toBeUndefined();
    });

    it("wraps errors in ServiceError", async () => {
      const service = makeService({
        db: {
          upsertVehicle: () =>
            Promise.reject(new Error("db constraint violation")),
          setConfig: () => Promise.resolve(),
        },
      });

      try {
        await service.demoSetup({ adapterType: "simulated" });
        expect(true).toBe(false);
      } catch (err) {
        expect((err as Error).message).toBe("Demo setup failed");
      }
    });
  });
});
