import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { assertExists } from "@std/assert";
import { AppDatabase } from "../../db/AppDatabase.ts";
import { appRouter } from "../root.ts";
import { createCallerFactory } from "../trpc.ts";
import type { TrpcContext } from "../trpc.ts";
import { WizardService } from "../../services/WizardService.ts";
import { AuthService } from "../../services/AuthService.ts";
import { OidcService } from "../../services/OidcService.ts";
import { ConfigService } from "../../services/ConfigService.ts";
import { RateLimiter } from "../../middleware/rateLimit.ts";
import { throwingMock } from "../../test-helpers/throwingMock.ts";

describe("Wizard tRPC Router", () => {
  const createCaller = createCallerFactory(appRouter);

  const mockLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  };

  let db: AppDatabase;
  let caller: ReturnType<typeof createCaller>;

  const makeCaller = (encryptionKey: string | null = null) => {
    const oidcService = new OidcService(db, encryptionKey, mockLogger as never);
    const configService = new ConfigService(
      db,
      {} as never,
      encryptionKey,
      mockLogger as never,
    );
    const authService = new AuthService(
      db,
      encryptionKey,
      mockLogger as never,
      oidcService,
      configService,
      new RateLimiter(),
    );
    const wizardService = new WizardService(
      db,
      encryptionKey,
      mockLogger as never,
      {
        isRunning: false,
        tunnelUrl: null,
        start: () => Promise.resolve(""),
        stop: () => Promise.resolve(),
      } as never,
      {
        addVehicle: () => Promise.resolve(),
        removeVehicle: () => Promise.resolve(),
      } as never,
      authService,
      oidcService,
    );
    return createCaller(throwingMock<TrpcContext>("TrpcContext", {
      db,
      encryptionKey,
      wizardService,
      authService,
      oidcService,
      configService,
      logger: mockLogger as never,
      responseHeaders: new Headers(),
      isHttps: false,
      clientIp: "127.0.0.1",
    }));
  };

  const makeCallerWithActiveTunnel = (encryptionKey: string | null = null) => {
    const mockTunnelUrl = "https://test-tunnel.trycloudflare.com";
    let tunnelRunning = true;
    const mockTunnelManager = {
      get isRunning() {
        return tunnelRunning;
      },
      get tunnelUrl() {
        return tunnelRunning ? mockTunnelUrl : null;
      },
      start: () => Promise.resolve(mockTunnelUrl),
      stop: () => {
        tunnelRunning = false;
        return Promise.resolve();
      },
    };
    const wizardService = new WizardService(
      db,
      encryptionKey,
      mockLogger as never,
      mockTunnelManager as never,
      {
        addVehicle: () => Promise.resolve(),
        removeVehicle: () => Promise.resolve(),
      } as never,
      {} as never,
      {} as never,
    );
    return {
      caller: createCaller(throwingMock<TrpcContext>("TrpcContext", {
        db,
        encryptionKey,
        wizardService,
        logger: mockLogger as never,
        responseHeaders: new Headers(),
        isHttps: false,
        clientIp: "127.0.0.1",
      })),
      mockTunnelManager,
    };
  };

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
    caller = makeCaller();
  });

  afterEach(() => {
    db.close();
  });

  describe("wizard.status", () => {
    it("returns completed=false on fresh DB", async () => {
      const data = await caller.wizard.status();
      expect(data.completed).toBe(false);
    });

    it("returns completed=true after complete mutation", async () => {
      await caller.wizard.complete();
      const data = await caller.wizard.status();
      expect(data.completed).toBe(true);
    });

    it("detects first-run correctly when no vehicles and no adapter", async () => {
      const data = await caller.wizard.status();
      expect(data.firstRun).toBe(true);
      expect(data.completed).toBe(false);
    });

    it("returns not first-run when vehicles exist", async () => {
      await db.upsertVehicle({
        id: "VIN123",
        name: "Test Vehicle",
        adapterType: "simulated",
        priority: 1,
        config: "{}",
        mode: "auto",
      });

      const data = await caller.wizard.status();
      expect(data.completed).toBe(false);
      expect(data.firstRun).toBe(false);
    });

    it("returns not first-run when energy adapter is configured", async () => {
      await db.setConfig("energy_adapter_type", "fronius_local");
      const data = await caller.wizard.status();
      expect(data.firstRun).toBe(false);
    });
  });

  describe("wizard.complete", () => {
    it("sets wizard_completed to true", async () => {
      const result = await caller.wizard.complete();
      expect(result.completed).toBe(true);

      const stored = await db.getConfig("wizard_completed");
      expect(stored).toBe("true");
    });
  });

  describe("wizard.demoSetup", () => {
    it("creates a simulated vehicle without touching the energy adapter selection", async () => {
      const result = await caller.wizard.demoSetup({
        adapterType: "simulated",
      });
      expect(result.success).toBe(true);

      const vehicles = await db.getVehicles();
      expect(vehicles.length).toBe(1);
      expect(vehicles[0].id).toBe("DEMO-001");
      expect(vehicles[0].adapterType).toBe("simulated");

      // The energy source is the user's choice on the inverter-type step.
      const adapterType = await db.getConfig("energy_adapter_type");
      expect(adapterType).toBeNull();

      const lat = await db.getConfig("home_latitude");
      const lng = await db.getConfig("home_longitude");
      expect(lat).toBe("-33.8688");
      expect(lng).toBe("151.2093");
    });

    it("saves timezone when provided", async () => {
      await caller.wizard.demoSetup({
        adapterType: "simulated",
        timezone: "Australia/Sydney",
      });
      const timezone = await db.getConfig("timezone");
      expect(timezone).toBe("Australia/Sydney");
    });
  });

  describe("wizard.complete - tunnel auto-stop", () => {
    it("stops tunnel when it is running on complete", async () => {
      const { caller: tunnelCaller, mockTunnelManager } =
        makeCallerWithActiveTunnel();

      // Tunnel should be running before complete
      expect(mockTunnelManager.isRunning).toBe(true);

      const result = await tunnelCaller.wizard.complete();
      expect(result.completed).toBe(true);

      // Tunnel should be stopped after complete
      expect(mockTunnelManager.isRunning).toBe(false);
    });
  });

  describe("wizard.setAuthMode", () => {
    it("sets auth mode to 'none' and writes config", async () => {
      const result = await caller.wizard.setAuthMode({ mode: "none" });
      expect(result.success).toBe(true);

      const authMode = await db.getConfig("auth_mode");
      expect(authMode).toBe("none");
    });

    it("sets auth mode to 'local' with valid credentials", async () => {
      const result = await caller.wizard.setAuthMode({
        mode: "local",
        localConfig: { username: "admin", password: "password123" },
      });
      expect(result.success).toBe(true);

      const authMode = await db.getConfig("auth_mode");
      expect(authMode).toBe("local");

      const user = await db.getLocalUser("admin");
      assertExists(user);
      expect(user.username).toBe("admin");
      // Password should be hashed (not plaintext)
      expect(user.passwordHash).not.toBe("password123");
      expect(user.passwordHash.startsWith("$argon2")).toBe(true);
    });

    it("sets auth mode to 'oidc' with valid config", async () => {
      // Mock the OIDC discovery fetch that changeMode calls internally
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ issuer: "https://auth.example.com" }), {
            status: 200,
          }),
        )) as typeof fetch;

      try {
        const result = await caller.wizard.setAuthMode({
          mode: "oidc",
          oidcConfig: {
            issuerUrl: "https://auth.example.com",
            clientId: "chargeha",
            clientSecret: "secret123",
            baseUrl: "https://chargeha.example.com",
          },
        });
        expect(result.success).toBe(true);

        const authMode = await db.getConfig("auth_mode");
        expect(authMode).toBe("oidc");

        const oidcConfig = await db.getOidcConfig();
        assertExists(oidcConfig);
        expect(oidcConfig.issuerUrl).toBe("https://auth.example.com");
        expect(oidcConfig.clientId).toBe("chargeha");
        expect(oidcConfig.baseUrl).toBe("https://chargeha.example.com");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("encrypts OIDC client_secret when encryption key is available", async () => {
      const encKey = btoa(
        String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
      );
      const authCaller = makeCaller(encKey);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ issuer: "https://auth.example.com" }), {
            status: 200,
          }),
        )) as typeof fetch;

      try {
        await authCaller.wizard.setAuthMode({
          mode: "oidc",
          oidcConfig: {
            issuerUrl: "https://auth.example.com",
            clientId: "chargeha",
            clientSecret: "secret123",
            baseUrl: "https://chargeha.example.com",
          },
        });

        const oidcConfig = await db.getOidcConfig();
        assertExists(oidcConfig);
        // Secret should be encrypted (not plaintext)
        expect(oidcConfig.clientSecret).not.toBe("secret123");
        expect(oidcConfig.isEncrypted).toBeTruthy();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("creates a session after setting local auth so the wizard is not locked out", async () => {
      const responseHeaders = new Headers();
      const oidcSvc = new OidcService(db, null, mockLogger as never);
      const configSvc = new ConfigService(
        db,
        {} as never,
        null,
        mockLogger as never,
      );
      const authSvc = new AuthService(
        db,
        null,
        mockLogger as never,
        oidcSvc,
        configSvc,
        new RateLimiter(),
      );
      const callerWithHeaders = createCaller({
        db,
        encryptionKey: null,
        wizardService: new WizardService(
          db,
          null,
          mockLogger as never,
          {
            isRunning: false,
            tunnelUrl: null,
            start: () => Promise.resolve(""),
            stop: () => Promise.resolve(),
          } as never,
          {
            syncVehicles: () => Promise.resolve(),
            startVehicle: () => {},
          } as never,
          authSvc,
          oidcSvc,
        ),
        authService: authSvc,
        oidcService: oidcSvc,
        configService: configSvc,
        logger: mockLogger,
        responseHeaders,
        rateLimiter: {} as never,
      } as unknown as TrpcContext);

      await callerWithHeaders.wizard.setAuthMode({
        mode: "local",
        localConfig: { username: "admin", password: "password123" },
      });

      // After setting local auth, the response must include a Set-Cookie
      // with a valid session_id so subsequent wizard requests pass auth
      // middleware. Without this, the wizard is locked out on the next step.
      const setCookie = responseHeaders.get("Set-Cookie");
      assertExists(setCookie);
      expect(setCookie).toContain("session_id=");

      // Extract session ID and verify it's valid in the DB
      const sessionId = setCookie.split("session_id=")[1].split(";")[0];
      const authService = new AuthService(
        db,
        null,
        mockLogger as never,
        new OidcService(db, null, mockLogger as never),
        new ConfigService(db, {} as never, null, mockLogger as never),
        new RateLimiter(),
      );
      const session = await authService.validateSession(sessionId);
      assertExists(session);
      expect(session.identifier).toBe("admin");
    });

    it("rejects local mode with empty password via Zod validation", async () => {
      await expect(
        caller.wizard.setAuthMode({
          mode: "local",
          localConfig: { username: "admin", password: "" },
        }),
      ).rejects.toThrow();
    });

    it("rejects local mode with empty username via Zod validation", async () => {
      await expect(
        caller.wizard.setAuthMode({
          mode: "local",
          localConfig: { username: "", password: "password123" },
        }),
      ).rejects.toThrow();
    });
  });

  describe("wizard.state / wizard.patchState", () => {
    it("returns empty fields on fresh DB", async () => {
      const state = await caller.wizard.state();
      expect(state).toEqual({ stepId: "", vehicleType: "", energyType: "" });
    });

    it("persists and retrieves a step ID", async () => {
      await caller.wizard.patchState({ stepId: "tesla-credentials" });
      const state = await caller.wizard.state();
      expect(state.stepId).toBe("tesla-credentials");
    });

    it("overwrites previous step value", async () => {
      await caller.wizard.patchState({ stepId: "welcome" });
      await caller.wizard.patchState({ stepId: "done" });
      const state = await caller.wizard.state();
      expect(state.stepId).toBe("done");
    });

    it("patches a single field without disturbing the others", async () => {
      await caller.wizard.patchState({
        stepId: "vehicle-type",
        vehicleType: "tesla",
        energyType: "fronius_local",
      });
      await caller.wizard.patchState({ stepId: "done" });

      expect(await caller.wizard.state()).toEqual({
        stepId: "done",
        vehicleType: "tesla",
        energyType: "fronius_local",
      });
    });

    it("round-trips a selection and its step in one write", async () => {
      // The step id and the vehicle type that puts that step in the list are
      // written together, so no read can observe one without the other.
      await caller.wizard.patchState({
        vehicleType: "tesla",
        stepId: "tesla-key-generation",
      });

      expect(await caller.wizard.state()).toEqual({
        stepId: "tesla-key-generation",
        vehicleType: "tesla",
        energyType: "",
      });
    });
  });

  describe("wizard.complete - clears wizard state", () => {
    it("clears wizard_step, wizard_vehicle_type, wizard_energy_type on complete", async () => {
      // Set wizard state
      await caller.wizard.patchState({
        stepId: "home-location",
        vehicleType: "tesla",
        energyType: "fronius_local",
      });

      // Complete wizard
      await caller.wizard.complete();

      // All wizard state should be cleared
      expect(await caller.wizard.state()).toEqual({
        stepId: "",
        vehicleType: "",
        energyType: "",
      });
    });
  });

  describe("wizard.saveOidcConfig", () => {
    it("saves OIDC config without changing auth mode", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ issuer: "https://auth.example.com" }), {
            status: 200,
          }),
        )) as typeof fetch;

      try {
        const result = await caller.wizard.saveOidcConfig({
          issuerUrl: "https://auth.example.com",
          clientId: "chargeha",
          clientSecret: "secret123",
          baseUrl: "https://chargeha.example.com",
        });
        expect(result.success).toBe(true);

        // Auth mode should NOT have changed
        const authMode = await db.getConfig("auth_mode");
        expect(authMode ?? "none").toBe("none");

        // OIDC config should be saved
        const oidcConfig = await db.getOidcConfig();
        assertExists(oidcConfig);
        expect(oidcConfig.issuerUrl).toBe("https://auth.example.com");
        expect(oidcConfig.clientId).toBe("chargeha");

        // Wizard pending flag should be set
        const pending = await db.getConfig("wizard_oidc_pending");
        expect(pending).toBe("true");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("encrypts client secret when encryption key available", async () => {
      const encKey = btoa(
        String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))),
      );
      const authCaller = makeCaller(encKey);

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(JSON.stringify({ issuer: "https://auth.example.com" }), {
            status: 200,
          }),
        )) as typeof fetch;

      try {
        await authCaller.wizard.saveOidcConfig({
          issuerUrl: "https://auth.example.com",
          clientId: "chargeha",
          clientSecret: "secret123",
          baseUrl: "https://chargeha.example.com",
        });

        const oidcConfig = await db.getOidcConfig();
        assertExists(oidcConfig);
        expect(oidcConfig.clientSecret).not.toBe("secret123");
        expect(oidcConfig.isEncrypted).toBeTruthy();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("rejects when OIDC discovery fails", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response("Not Found", { status: 404 }),
        )) as typeof fetch;

      try {
        await expect(
          caller.wizard.saveOidcConfig({
            issuerUrl: "https://bad.example.com",
            clientId: "chargeha",
            clientSecret: "secret123",
            baseUrl: "https://chargeha.example.com",
          }),
        ).rejects.toThrow();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("wizard.testOidcDiscovery", () => {
    it("returns success when discovery endpoint is reachable", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              issuer: "https://auth.example.com",
              authorization_endpoint: "https://auth.example.com/authorize",
            }),
            { status: 200 },
          ),
        )) as typeof fetch;

      try {
        const result = await caller.wizard.testOidcDiscovery({
          issuerUrl: "https://auth.example.com",
        });
        expect(result.success).toBe(true);
        expect(result).not.toHaveProperty("error");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns error when discovery endpoint returns non-200", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (() =>
        Promise.resolve(
          new Response("Not Found", { status: 404 }),
        )) as typeof fetch;

      try {
        const result = await caller.wizard.testOidcDiscovery({
          issuerUrl: "https://auth.example.com",
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("404");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns error when discovery endpoint is unreachable", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch =
        (() => Promise.reject(new Error("Network error"))) as typeof fetch;

      try {
        const result = await caller.wizard.testOidcDiscovery({
          issuerUrl: "https://auth.example.com",
        });
        expect(result.success).toBe(false);
        expect(result.error).toContain("unreachable");
        expect(result.error).toContain("Network error");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
