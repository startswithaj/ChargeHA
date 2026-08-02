import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { AppDatabase } from "../AppDatabase.ts";

describe("ConfigRepository", () => {
  let db: AppDatabase;

  beforeEach(async () => {
    db = new AppDatabase(":memory:");
    await db.init();
  });

  afterEach(() => {
    db.close();
  });

  describe("getConfig", () => {
    it("returns null for a missing key", async () => {
      expect(await db.config.getConfig("nonexistent")).toBeNull();
    });
  });

  describe("setConfig", () => {
    it("inserts a new key", async () => {
      await db.config.setConfig("test_key", "test_value");
      expect(await db.config.getConfig("test_key")).toBe("test_value");
    });

    it("updates an existing key on conflict", async () => {
      await db.config.setConfig("test_key", "first");
      await db.config.setConfig("test_key", "second");
      expect(await db.config.getConfig("test_key")).toBe("second");
    });

    it("deletes the row when value is null, clearing the key", async () => {
      await db.config.setConfig("test_key", "value");
      await db.config.setConfig("test_key", null);
      expect(await db.config.getConfig("test_key")).toBeNull();
    });
  });
});
