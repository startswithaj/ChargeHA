import { createLogger } from "../../packages/server/src/lib/Logger.ts";

const logger = createLogger("Snapshots");

export interface SnapshotInfo {
  name: string;
  size: number;
  createdAt: Date;
}

function isProduction(): boolean {
  return (
    Deno.env.get("NODE_ENV") === "production" ||
    Deno.env.get("CHARGEHA_ENV") === "production"
  );
}

function getSnapshotsDir(dbPath: string): string {
  const dataDir = dbPath.substring(0, dbPath.lastIndexOf("/"));
  return `${dataDir}/snapshots`;
}

async function ensureSnapshotsDir(snapshotsDir: string): Promise<void> {
  await Deno.mkdir(snapshotsDir, { recursive: true });
}

export async function saveSnapshot(
  dbPath: string,
  name: string,
): Promise<string> {
  const snapshotsDir = getSnapshotsDir(dbPath);
  await ensureSnapshotsDir(snapshotsDir);

  const destPath = `${snapshotsDir}/${name}.db`;
  await Deno.copyFile(dbPath, destPath);
  logger.info(`Snapshot saved: ${destPath}`);
  return destPath;
}

export async function restoreSnapshot(
  dbPath: string,
  name: string,
): Promise<void> {
  if (isProduction()) {
    throw new Error(
      "db:restore cannot run in production (NODE_ENV or CHARGEHA_ENV is 'production')",
    );
  }

  const snapshotsDir = getSnapshotsDir(dbPath);
  const snapshotPath = `${snapshotsDir}/${name}.db`;

  // Verify snapshot exists
  try {
    await Deno.stat(snapshotPath);
  } catch {
    throw new Error(`Snapshot '${name}' not found at ${snapshotPath}`);
  }

  // Auto-save current state before restoring
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const autoSaveName = `pre-restore-${timestamp}`;
  try {
    await Deno.stat(dbPath);
    await saveSnapshot(dbPath, autoSaveName);
    logger.info(`Auto-saved current state as '${autoSaveName}'`);
  } catch (error) {
    // Active DB doesn't exist yet, no auto-save needed
    logger.debug(`No active DB to auto-save: ${error}`);
  }

  // Remove stale WAL and SHM files before restoring — if left in place,
  // SQLite will apply the old journal to the new db file causing page-level
  // data corruption (wrong table data returned for unrelated queries).
  for (const suffix of ["-wal", "-shm"]) {
    try {
      await Deno.remove(dbPath + suffix);
      logger.info(`Removed stale ${suffix} file`);
    } catch (error) {
      // File doesn't exist — fine
      logger.debug(`No stale ${suffix} file to remove: ${error}`);
    }
  }

  // Copy snapshot to active DB path
  await Deno.copyFile(snapshotPath, dbPath);
  logger.info(`Restored snapshot '${name}' to ${dbPath}`);
}

export async function listSnapshots(
  dbPath: string,
): Promise<SnapshotInfo[]> {
  const snapshotsDir = getSnapshotsDir(dbPath);

  try {
    await Deno.stat(snapshotsDir);
  } catch {
    return [];
  }

  const snapshots: SnapshotInfo[] = [];
  for await (const entry of Deno.readDir(snapshotsDir)) {
    if (entry.isFile && entry.name.endsWith(".db")) {
      const filePath = `${snapshotsDir}/${entry.name}`;
      const stat = await Deno.stat(filePath);
      snapshots.push({
        name: entry.name.replace(/\.db$/, ""),
        size: stat.size,
        createdAt: stat.mtime ?? new Date(),
      });
    }
  }

  // Sort by creation date, newest first
  snapshots.sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
  return snapshots;
}

export async function deleteSnapshot(
  dbPath: string,
  name: string,
): Promise<void> {
  const snapshotsDir = getSnapshotsDir(dbPath);
  const snapshotPath = `${snapshotsDir}/${name}.db`;

  try {
    await Deno.stat(snapshotPath);
  } catch {
    throw new Error(`Snapshot '${name}' not found at ${snapshotPath}`);
  }

  await Deno.remove(snapshotPath);
  logger.info(`Deleted snapshot '${name}'`);
}
