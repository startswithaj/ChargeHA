import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { assertExists, assertRejects } from "@std/assert";
import { expect } from "@std/expect";
import { decrypt } from "../lib/Encryption.ts";
import { AppDatabase } from "./AppDatabase.ts";
import type { UpsertChargerInput } from "./types.ts";

describe("AppDatabase charger row-scoped config/secrets", () => {
  const TEST_KEY = btoa(String.fromCharCode(...new Uint8Array(32)));

  const baseCharger: UpsertChargerInput = {
    id: "CHG1",
    name: "Garage Charger",
    chargerAdapterType: "simulated",
    chargerConfig: "{}",
    mode: "auto",
    priority: 1,
    vehicleId: null,
  };

  describe("no-key mode", () => {
    let db: AppDatabase;

    beforeEach(async () => {
      db = new AppDatabase(":memory:");
      await db.init();
      await db.chargers.upsertCharger(baseCharger);
    });

    afterEach(() => {
      db.close();
    });

    it("round-trips setChargerSecrets -> getChargerSecrets", async () => {
      await db.setChargerSecrets("CHG1", { password: "hunter2" });
      expect(await db.getChargerSecrets("CHG1")).toEqual({
        password: "hunter2",
      });
    });

    it("stores the column as readable plaintext, proving the app runs without ENCRYPTION_KEY", async () => {
      await db.setChargerSecrets("CHG1", { password: "hunter2" });
      const record = await db.chargers.getChargerSecretsRecord("CHG1");
      assertExists(record);
      expect(record.isEncrypted).toBe(false);
      expect(JSON.parse(record.value)).toEqual({ password: "hunter2" });
    });
  });

  describe("key mode", () => {
    let db: AppDatabase;

    beforeEach(async () => {
      db = new AppDatabase(":memory:", TEST_KEY);
      await db.init();
      await db.chargers.upsertCharger(baseCharger);
    });

    afterEach(() => {
      db.close();
    });

    it("round-trips through getChargerSecrets as plaintext values", async () => {
      await db.setChargerSecrets("CHG1", { password: "hunter2" });
      expect(await db.getChargerSecrets("CHG1")).toEqual({
        password: "hunter2",
      });
    });

    it("stores the column as opaque ciphertext", async () => {
      await db.setChargerSecrets("CHG1", { password: "hunter2" });
      const record = await db.chargers.getChargerSecretsRecord("CHG1");
      assertExists(record);
      expect(record.isEncrypted).toBe(true);
      expect(record.value).not.toContain("hunter2");
    });

    it("stores the project's standard IV+ciphertext base64 format", async () => {
      await db.setChargerSecrets("CHG1", { password: "hunter2" });
      const record = await db.chargers.getChargerSecretsRecord("CHG1");
      assertExists(record);
      const decrypted = await decrypt(record.value, TEST_KEY);
      expect(JSON.parse(decrypted)).toEqual({ password: "hunter2" });
    });
  });

  describe("cross-mode", () => {
    it("throws rather than returning ciphertext when a key is missing at read time", async () => {
      const withKey = new AppDatabase(":memory:", TEST_KEY);
      await withKey.init();
      const driver = withKey.getDriver();
      await withKey.chargers.upsertCharger(baseCharger);
      await withKey.setChargerSecrets("CHG1", { password: "hunter2" });

      const withoutKey = new AppDatabase(driver, null);

      await assertRejects(
        () => withoutKey.getChargerSecrets("CHG1"),
        Error,
        "Cannot decrypt secrets for charger CHG1: ENCRYPTION_KEY is not set",
      );

      withKey.close();
    });
  });

  describe("config + patch", () => {
    let db: AppDatabase;

    beforeEach(async () => {
      db = new AppDatabase(":memory:");
      await db.init();
      await db.chargers.upsertCharger(baseCharger);
    });

    afterEach(() => {
      db.close();
    });

    it("getChargerConfig on a fresh row returns {}", async () => {
      expect(await db.getChargerConfig("CHG1")).toEqual({});
    });

    it("patchChargerConfig accumulates keys across calls", async () => {
      await db.patchChargerConfig("CHG1", { max_amps: "32" });
      await db.patchChargerConfig("CHG1", { phases: "3" });
      expect(await db.getChargerConfig("CHG1")).toEqual({
        max_amps: "32",
        phases: "3",
      });
    });

    it("patchChargerConfig with null removes the key entirely, not to ''", async () => {
      await db.patchChargerConfig("CHG1", { max_amps: "32" });
      await db.patchChargerConfig("CHG1", { max_amps: null });
      const config = await db.getChargerConfig("CHG1");
      expect("max_amps" in config).toBe(false);
    });

    it("patchChargerSecrets behaves the same and preserves encryption", async () => {
      const keyedDb = new AppDatabase(":memory:", TEST_KEY);
      await keyedDb.init();
      await keyedDb.chargers.upsertCharger(baseCharger);
      try {
        await keyedDb.patchChargerSecrets("CHG1", { password: "hunter2" });
        await keyedDb.patchChargerSecrets("CHG1", { username: "admin" });

        expect(await keyedDb.getChargerSecrets("CHG1")).toEqual({
          password: "hunter2",
          username: "admin",
        });
        const record = await keyedDb.chargers.getChargerSecretsRecord(
          "CHG1",
        );
        assertExists(record);
        expect(record.isEncrypted).toBe(true);
      } finally {
        keyedDb.close();
      }
    });

    it("getChargerConfig throws Charger not found for an unknown id", async () => {
      await assertRejects(
        () => db.getChargerConfig("MISSING"),
        Error,
        "Charger not found: MISSING",
      );
    });

    it("getChargerSecrets throws Charger not found for an unknown id", async () => {
      await assertRejects(
        () => db.getChargerSecrets("MISSING"),
        Error,
        "Charger not found: MISSING",
      );
    });

    it("degrades corrupt content to {} rather than throwing", async () => {
      await db.chargers.setChargerSecretsRecord("CHG1", "not json", false);
      expect(await db.getChargerSecrets("CHG1")).toEqual({});

      await db.chargers.setChargerSecretsRecord(
        "CHG1",
        JSON.stringify(["a"]),
        false,
      );
      expect(await db.getChargerSecrets("CHG1")).toEqual({});
    });
  });
});
