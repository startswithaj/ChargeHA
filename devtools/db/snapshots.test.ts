import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  deleteSnapshot,
  listSnapshots,
  restoreSnapshot,
  saveSnapshot,
} from "./snapshots.ts";
import { withEnv } from "../test-helpers/withEnv.ts";

describe("db snapshots", () => {
  let tempDir: string;
  let dbPath: string;
  let snapshotsDir: string;

  beforeEach(async () => {
    tempDir = await Deno.makeTempDir();
    dbPath = `${tempDir}/chargeha.db`;
    snapshotsDir = `${tempDir}/snapshots`;
    // Create a fake active database file
    await Deno.writeTextFile(dbPath, "fake-db-content");
  });

  afterEach(async () => {
    await Deno.remove(tempDir, { recursive: true });
  });

  describe("save", () => {
    it("creates a .db file in snapshots dir", async () => {
      await saveSnapshot(dbPath, "my-snapshot");

      const stat = await Deno.stat(`${snapshotsDir}/my-snapshot.db`);
      expect(stat.isFile).toBe(true);

      const content = await Deno.readTextFile(
        `${snapshotsDir}/my-snapshot.db`,
      );
      expect(content).toBe("fake-db-content");
    });

    it("creates snapshots dir if it doesn't exist", async () => {
      // beforeEach gives us a fresh tempDir; snapshotsDir is guaranteed not to exist.
      await saveSnapshot(dbPath, "test-snap");

      const stat = await Deno.stat(snapshotsDir);
      expect(stat.isDirectory).toBe(true);
    });
  });

  describe("list", () => {
    it("returns saved snapshots with name and size", async () => {
      await saveSnapshot(dbPath, "snap-a");
      await saveSnapshot(dbPath, "snap-b");

      const snapshots = await listSnapshots(dbPath);

      expect(snapshots.length).toBe(2);
      const names = snapshots.map((s) => s.name);
      expect(names).toContain("snap-a");
      expect(names).toContain("snap-b");

      for (const s of snapshots) {
        expect(s.size).toBeGreaterThan(0);
        expect(s.createdAt).toBeInstanceOf(Date);
      }
    });

    it("returns empty array when no snapshots exist", async () => {
      const snapshots = await listSnapshots(dbPath);
      expect(snapshots).toEqual([]);
    });
  });

  describe("restore", () => {
    it("copies snapshot file to active DB path", async () => {
      // Save a snapshot with known content
      await Deno.writeTextFile(dbPath, "original-content");
      await saveSnapshot(dbPath, "saved-state");

      // Modify the active DB
      await Deno.writeTextFile(dbPath, "modified-content");

      // Restore the snapshot
      await restoreSnapshot(dbPath, "saved-state");

      const content = await Deno.readTextFile(dbPath);
      expect(content).toBe("original-content");
    });

    it("auto-saves current state as pre-restore-* before overwriting", async () => {
      await Deno.writeTextFile(dbPath, "current-state");
      await saveSnapshot(dbPath, "snap-to-restore");

      // Modify the active DB
      await Deno.writeTextFile(dbPath, "about-to-be-overwritten");

      await restoreSnapshot(dbPath, "snap-to-restore");

      // Check that a pre-restore snapshot was created
      const snapshots = await listSnapshots(dbPath);
      const autoSave = snapshots.find((s) => s.name.startsWith("pre-restore-"));
      expect(autoSave).toBeDefined();

      // Verify the auto-save contains the state before restore
      const autoSavePath = `${snapshotsDir}/${autoSave!.name}.db`;
      const autoSaveContent = await Deno.readTextFile(autoSavePath);
      expect(autoSaveContent).toBe("about-to-be-overwritten");
    });

    it("throws error if snapshot doesn't exist", async () => {
      await expect(
        restoreSnapshot(dbPath, "nonexistent"),
      ).rejects.toThrow("Snapshot 'nonexistent' not found");
    });

    it("refuses in production env", async () => {
      await saveSnapshot(dbPath, "prod-snap");
      await withEnv("CHARGEHA_ENV", "production", async () => {
        await expect(
          restoreSnapshot(dbPath, "prod-snap"),
        ).rejects.toThrow("cannot run in production");
      });
    });
  });

  describe("delete", () => {
    it("removes snapshot file", async () => {
      await saveSnapshot(dbPath, "to-delete");

      // Verify it exists
      const before = await listSnapshots(dbPath);
      expect(before.find((s) => s.name === "to-delete")).toBeDefined();

      await deleteSnapshot(dbPath, "to-delete");

      // Verify it's gone
      const after = await listSnapshots(dbPath);
      expect(after.find((s) => s.name === "to-delete")).toBeUndefined();
    });

    it("throws error if snapshot doesn't exist", async () => {
      await expect(
        deleteSnapshot(dbPath, "nonexistent"),
      ).rejects.toThrow("Snapshot 'nonexistent' not found");
    });
  });
});
