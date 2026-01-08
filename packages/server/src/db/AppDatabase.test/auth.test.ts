import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertExists } from "@std/assert";
import { expect } from "@std/expect";
import { AppDatabase } from "../AppDatabase.ts";
import type { CreateSessionInput } from "../types.ts";

describe("AppDatabase", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
  });

  afterEach(() => {
    db.close();
  });

  describe("auth: local users", () => {
    it("creates and retrieves a local user", async () => {
      const user = await db.createLocalUser({
        username: "admin",
        passwordHash: "$argon2id$hash123",
      });

      expect(user.id).toBeGreaterThan(0);
      expect(user.username).toBe("admin");
      expect(user.passwordHash).toBe("$argon2id$hash123");
      expect(user.createdAt).toBeDefined();
      expect(user.updatedAt).toBeDefined();
    });

    it("getLocalUser returns the user by username", async () => {
      await db.createLocalUser({
        username: "admin",
        passwordHash: "$argon2id$hash123",
      });

      const user = await db.getLocalUser("admin");
      assertExists(user);
      expect(user.username).toBe("admin");
      expect(user.passwordHash).toBe("$argon2id$hash123");
    });

    it("getLocalUser returns null for unknown username", async () => {
      const user = await db.getLocalUser("nonexistent");
      expect(user).toBeNull();
    });

    it("updateLocalUserPassword changes the password hash", async () => {
      await db.createLocalUser({
        username: "admin",
        passwordHash: "old_hash",
      });

      await db.updateLocalUserPassword("admin", "new_hash");

      const user = await db.getLocalUser("admin");
      assertExists(user);
      expect(user.passwordHash).toBe("new_hash");
    });

    it("updateLocalUserPassword updates updatedAt", async () => {
      const created = await db.createLocalUser({
        username: "admin",
        passwordHash: "old_hash",
      });

      await db.updateLocalUserPassword("admin", "new_hash");

      const user = await db.getLocalUser("admin");
      assertExists(user);
      // updatedAt should be set (may or may not differ from createdAt in fast tests)
      expect(user.updatedAt).toBeDefined();
      expect(typeof user.updatedAt).toBe("string");
      // But we can verify it's at least as recent as created
      expect(user.updatedAt >= created.createdAt).toBe(true);
    });

    it("deleteAllLocalUsers removes all users", async () => {
      await db.createLocalUser({
        username: "user1",
        passwordHash: "hash1",
      });
      await db.createLocalUser({
        username: "user2",
        passwordHash: "hash2",
      });

      await db.deleteAllLocalUsers();

      expect(await db.getLocalUser("user1")).toBeNull();
      expect(await db.getLocalUser("user2")).toBeNull();
    });

    it("rejects duplicate usernames", async () => {
      await db.createLocalUser({
        username: "admin",
        passwordHash: "hash1",
      });

      await expect(
        db.createLocalUser({ username: "admin", passwordHash: "hash2" }),
      ).rejects.toThrow();
    });
  });

  describe("auth: OIDC config", () => {
    const sampleOidc = {
      issuerUrl: "https://auth.example.com",
      clientId: "my-client-id",
      clientSecret: "my-client-secret",
      isEncrypted: false,
      baseUrl: "https://chargeha.local",
    };

    it("upserts and retrieves OIDC config", async () => {
      const config = await db.upsertOidcConfig(sampleOidc);

      expect(config.id).toBeGreaterThan(0);
      expect(config.issuerUrl).toBe("https://auth.example.com");
      expect(config.clientId).toBe("my-client-id");
      expect(config.clientSecret).toBe("my-client-secret");
      expect(config.isEncrypted).toBe(false);
      expect(config.baseUrl).toBe("https://chargeha.local");
      expect(config.createdAt).toBeDefined();
      expect(config.updatedAt).toBeDefined();
    });

    it("getOidcConfig retrieves the config", async () => {
      await db.upsertOidcConfig(sampleOidc);

      const config = await db.getOidcConfig();
      assertExists(config);
      expect(config.issuerUrl).toBe("https://auth.example.com");
      expect(config.clientId).toBe("my-client-id");
    });

    it("getOidcConfig returns null when no config", async () => {
      const config = await db.getOidcConfig();
      expect(config).toBeNull();
    });

    it("upsertOidcConfig replaces existing config", async () => {
      await db.upsertOidcConfig(sampleOidc);
      await db.upsertOidcConfig({
        ...sampleOidc,
        issuerUrl: "https://new-auth.example.com",
        clientId: "new-client-id",
      });

      const config = await db.getOidcConfig();
      assertExists(config);
      expect(config.issuerUrl).toBe("https://new-auth.example.com");
      expect(config.clientId).toBe("new-client-id");
    });

    it("stores isEncrypted=true correctly", async () => {
      await db.upsertOidcConfig({
        ...sampleOidc,
        isEncrypted: true,
      });

      const config = await db.getOidcConfig();
      assertExists(config);
      expect(config.isEncrypted).toBe(true);
    });

    it("deleteAllOidcConfigs removes all configs", async () => {
      await db.upsertOidcConfig(sampleOidc);
      await db.deleteAllOidcConfigs();

      expect(await db.getOidcConfig()).toBeNull();
    });
  });

  describe("auth: sessions", () => {
    // Use epoch seconds (not ms) to avoid @db/sqlite 32-bit truncation
    const nowSecs = Math.floor(Date.now() / 1000);
    const thirtyDaysSecs = 30 * 24 * 60 * 60;
    const sampleSession: CreateSessionInput = {
      id: "session-uuid-1",
      authType: "local",
      identifier: "admin",
      email: null,
      createdAt: nowSecs,
      expiresAt: nowSecs + thirtyDaysSecs,
    };

    it("creates and retrieves a session", async () => {
      const session = await db.createSession(sampleSession);

      expect(session.id).toBe("session-uuid-1");
      expect(session.authType).toBe("local");
      expect(session.identifier).toBe("admin");
      expect(session.email).toBeNull();
      expect(session.createdAt).toBe(nowSecs);
      expect(session.expiresAt).toBe(nowSecs + thirtyDaysSecs);
    });

    it("getSession retrieves by id", async () => {
      await db.createSession(sampleSession);

      const session = await db.getSession("session-uuid-1");
      assertExists(session);
      expect(session.id).toBe("session-uuid-1");
      expect(session.authType).toBe("local");
    });

    it("getSession returns null for unknown id", async () => {
      const session = await db.getSession("nonexistent");
      expect(session).toBeNull();
    });

    it("creates session with email (OIDC)", async () => {
      await db.createSession({
        ...sampleSession,
        id: "session-oidc-1",
        authType: "oidc",
        identifier: "oidc-sub-123",
        email: "user@example.com",
      });

      const session = await db.getSession("session-oidc-1");
      assertExists(session);
      expect(session.authType).toBe("oidc");
      expect(session.identifier).toBe("oidc-sub-123");
      expect(session.email).toBe("user@example.com");
    });

    it("deleteSession removes a specific session", async () => {
      await db.createSession(sampleSession);
      await db.createSession({
        ...sampleSession,
        id: "session-uuid-2",
      });

      await db.deleteSession("session-uuid-1");

      expect(await db.getSession("session-uuid-1")).toBeNull();
      expect(await db.getSession("session-uuid-2")).not.toBeNull();
    });

    it("deleteAllSessions removes all sessions", async () => {
      await db.createSession(sampleSession);
      await db.createSession({
        ...sampleSession,
        id: "session-uuid-2",
      });

      await db.deleteAllSessions();

      expect(await db.getSession("session-uuid-1")).toBeNull();
      expect(await db.getSession("session-uuid-2")).toBeNull();
    });

    it("deleteExpiredSessions removes only expired sessions", async () => {
      // Create an expired session
      await db.createSession({
        ...sampleSession,
        id: "expired-session",
        createdAt: nowSecs - thirtyDaysSecs * 2,
        expiresAt: nowSecs - thirtyDaysSecs,
      });

      // Create a valid session
      await db.createSession({
        ...sampleSession,
        id: "valid-session",
        createdAt: nowSecs,
        expiresAt: nowSecs + thirtyDaysSecs,
      });

      await db.deleteExpiredSessions();

      expect(await db.getSession("expired-session")).toBeNull();
      expect(await db.getSession("valid-session")).not.toBeNull();
    });
  });

  describe("prune methods", () => {
    it("pruneEnergyReadings does not delete recent entries", async () => {
      await db.insertEnergyReading({
        solarProductionW: 1000,
        gridPowerW: 0,
        homeConsumptionW: 1000,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: "2024-01-01T00:00:00.000Z",
      });

      await db.pruneEnergyReadings(30);

      const { total } = await db.energy.getEnergyReadingsPaginated({
        limit: 1,
        offset: 0,
      });
      expect(total).toBe(1);
    });

    it("pruneVehicleChargeReadings does not delete recent entries", async () => {
      await db.insertVehicleChargeReading({
        vehicleId: "VIN1",
        chargePowerW: 7000,
        chargeAmps: 32,
        batteryLevel: 65,
        solarContributionW: 5000,
        gridContributionW: 2000,
        isHome: true,
      });

      await db.pruneVehicleChargeReadings(30);

      const { total } = await db.vehicles.getVehicleChargeReadingsPaginated({
        limit: 1,
        offset: 0,
      });
      expect(total).toBe(1);
    });

    it("pruneVehiclePollLogs does not delete recent entries", async () => {
      await db.insertVehiclePollLog({
        vehicleId: "VIN1",
        vehicleName: "Car 1",
        isOnline: true,
        isPluggedIn: true,
        isCharging: false,
        batteryLevel: 72,
        chargeLimit: 80,
        chargeAmps: 16,
        chargeAmpsMax: 32,
        chargePowerKw: 0,
        chargerVoltage: 240,
        energyAddedKwh: 0,
        minutesToFull: 0,
        isHome: true,
      });

      await db.pruneVehiclePollLogs(30);

      const { total } = await db.logs.getVehiclePollLogsPaginated({
        limit: 1,
        offset: 0,
      });
      expect(total).toBe(1);
    });

    it("prunePluginLogs does not delete recent entries", async () => {
      await db.insertPluginLog({
        pluginId: "solar-adapter",
        level: "info",
        message: "hello",
        payload: null,
        origin: "poll",
      });

      await db.prunePluginLogs(30);

      const { total } = await db.logs.getPluginLogs({ limit: 1, offset: 0 });
      expect(total).toBe(1);
    });
  });

  describe("getTodayEnergySummary", () => {
    it("returns a summary object even when no readings exist", async () => {
      const summary = await db.getTodayEnergySummary("UTC");
      expect(summary).toBeDefined();
      expect(typeof summary.solarWh).toBe("number");
    });

    it("returns a summary after inserting a reading", async () => {
      await db.insertEnergyReading({
        solarProductionW: 5000,
        gridPowerW: -1000,
        homeConsumptionW: 4000,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: new Date().toISOString(),
      });

      const summary = await db.getTodayEnergySummary("UTC");
      expect(summary).toBeDefined();
    });
  });

  describe("storeSecret / readSecret", () => {
    // 32-byte base64 key for AES-GCM
    const TEST_KEY = btoa(
      String.fromCharCode(...new Uint8Array(32).map((_, i) => i)),
    );

    it("stores and reads plaintext when no encryption key is set", async () => {
      await db.storeSecret("my.secret", "hunter2");
      expect(await db.readSecret("my.secret")).toBe("hunter2");

      const row = await db.getSecret("my.secret");
      assertExists(row);
      expect(row.isEncrypted).toBe(false);
      expect(row.value).toBe("hunter2");
    });

    it("returns null when reading a missing secret", async () => {
      expect(await db.readSecret("does.not.exist")).toBeNull();
    });

    it("encrypts on store and decrypts on read when key is provided", async () => {
      const encDb = new AppDatabase(":memory:", TEST_KEY);
      await encDb.init();
      try {
        await encDb.storeSecret("api.token", "plaintext-token");

        const row = await encDb.getSecret("api.token");
        assertExists(row);
        expect(row.isEncrypted).toBe(true);
        expect(row.value).not.toBe("plaintext-token");

        expect(await encDb.readSecret("api.token")).toBe("plaintext-token");
      } finally {
        encDb.close();
      }
    });
  });

  describe("getFirstLocalUser", () => {
    it("returns null when no users exist", async () => {
      expect(await db.getFirstLocalUser()).toBeNull();
    });

    it("returns the first-created user when multiple exist", async () => {
      const first = await db.createLocalUser({
        username: "admin",
        passwordHash: "hash1",
      });
      await db.createLocalUser({
        username: "second",
        passwordHash: "hash2",
      });

      const got = await db.getFirstLocalUser();
      assertExists(got);
      expect(got.username).toBe(first.username);
    });
  });

  describe("deleteSessionsExcept", () => {
    const nowSecs = Math.floor(Date.now() / 1000);
    const thirtyDaysSecs = 30 * 24 * 60 * 60;
    const base: CreateSessionInput = {
      id: "keep-me",
      authType: "local",
      identifier: "admin",
      email: null,
      createdAt: nowSecs,
      expiresAt: nowSecs + thirtyDaysSecs,
    };

    it("removes all sessions except the given id", async () => {
      await db.createSession(base);
      await db.createSession({ ...base, id: "other-1" });
      await db.createSession({ ...base, id: "other-2" });

      await db.deleteSessionsExcept("keep-me");

      expect(await db.getSession("keep-me")).not.toBeNull();
      expect(await db.getSession("other-1")).toBeNull();
      expect(await db.getSession("other-2")).toBeNull();
    });

    it("is safe when the exceptId does not exist", async () => {
      await db.createSession({ ...base, id: "other-1" });

      await db.deleteSessionsExcept("nonexistent");

      expect(await db.getSession("other-1")).toBeNull();
    });
  });
});
