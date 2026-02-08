import { AppDatabase } from "../../packages/server/src/db/AppDatabase.ts";
import {
  deleteSnapshot,
  listSnapshots,
  restoreSnapshot,
  saveSnapshot,
} from "./snapshots.ts";

const DB_PATH = Deno.env.get("DB_PATH") ?? "./data/chargeha.db";

function isProduction(): boolean {
  return (
    Deno.env.get("NODE_ENV") === "production" ||
    Deno.env.get("CHARGEHA_ENV") === "production"
  );
}

function printUsage(): void {
  console.log(`Usage: deno run cli.ts <command> [options]

Commands:
  reset   Drop all data and recreate tables
  seed    Populate database with a seed profile
  save    Save a named database snapshot
  restore Restore a named database snapshot
  list    List all saved snapshots
  delete  Delete a named snapshot

Options:
  --yes   Skip confirmation prompt (required for reset)`);
}

async function backupDatabase(dbPath: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${dbPath}.backup-${timestamp}`;
  await Deno.copyFile(dbPath, backupPath);
  console.log(`Backup created: ${backupPath}`);
  return backupPath;
}

export async function resetDatabase(
  dbPath: string,
  opts: { yes?: boolean },
): Promise<void> {
  if (isProduction()) {
    console.error(
      "Error: db:reset cannot run in production (NODE_ENV or CHARGEHA_ENV is 'production')",
    );
    Deno.exit(1);
  }

  if (!opts.yes) {
    console.error(
      "Error: db:reset requires --yes flag to confirm. This will delete ALL data.",
    );
    Deno.exit(1);
  }

  // Backup existing database if it exists on disk
  try {
    const stat = await Deno.stat(dbPath);
    if (stat.isFile) {
      await backupDatabase(dbPath);
    }
  } catch (error) {
    // File doesn't exist, no backup needed
    console.debug(`No existing database to back up: ${error}`);
  }

  // Open the database, drop all tables, and recreate
  const db = new AppDatabase(dbPath);
  try {
    // Drop all tables in correct order (respecting any implicit FK references)
    const tables = [
      "controller_logs",
      "vehicle_charge_readings",
      "vehicle_poll_logs",
      "energy_readings",
      "schedules",
      "tariff_periods",
      "vehicles",
      "sessions",
      "auth_oidc",
      "auth_local",
      "config",
      "__drizzle_migrations",
    ];
    for (const table of tables) {
      // deno-lint-ignore no-explicit-any
      (db as any).sqlite.exec(`DROP TABLE IF EXISTS ${table}`);
    }

    // Recreate all tables
    await db.init();
    console.log("Database reset complete. All tables recreated.");
  } finally {
    db.close();
  }
}

export async function seedDatabase(
  dbPath: string,
  profileName: string,
): Promise<void> {
  if (isProduction()) {
    console.error(
      "Error: db:seed cannot run in production (NODE_ENV or CHARGEHA_ENV is 'production')",
    );
    Deno.exit(1);
  }

  try {
    const module = await import(
      `../../packages/server/src/db/seeds/${profileName}.ts`
    );
    const db = new AppDatabase(dbPath);
    try {
      await db.init();
      await module.seed(db);
      console.log(`Seed profile '${profileName}' applied successfully.`);
    } finally {
      db.close();
    }
  } catch (err) {
    if (
      err instanceof TypeError &&
      (err.message.includes("Module not found") ||
        err.message.includes("Cannot find module"))
    ) {
      console.error(`Error: Unknown seed profile '${profileName}'`);
      Deno.exit(1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const args = Deno.args;
  const command = args[0];

  if (!command) {
    printUsage();
    Deno.exit(1);
  }

  switch (command) {
    case "reset": {
      const yes = args.includes("--yes");
      await resetDatabase(DB_PATH, { yes });
      break;
    }
    case "seed": {
      const profileName = args[1];
      if (!profileName) {
        console.error("Error: seed command requires a profile name");
        console.error("Usage: deno run cli.ts seed <profile>");
        Deno.exit(1);
      }
      await seedDatabase(DB_PATH, profileName);
      break;
    }
    case "save": {
      const saveName = args[1];
      if (!saveName) {
        console.error("Error: save command requires a snapshot name");
        console.error("Usage: deno run cli.ts save <name>");
        Deno.exit(1);
      }
      await saveSnapshot(DB_PATH, saveName);
      break;
    }
    case "restore": {
      const restoreName = args[1];
      if (!restoreName) {
        console.error("Error: restore command requires a snapshot name");
        console.error("Usage: deno run cli.ts restore <name>");
        Deno.exit(1);
      }
      await restoreSnapshot(DB_PATH, restoreName);
      break;
    }
    case "list": {
      const snapshots = await listSnapshots(DB_PATH);
      if (snapshots.length === 0) {
        console.log("No snapshots found.");
      } else {
        console.log("Snapshots:");
        for (const s of snapshots) {
          const sizeKb = (s.size / 1024).toFixed(1);
          const date = s.createdAt.toISOString();
          console.log(`  ${s.name}  ${sizeKb} KB  ${date}`);
        }
      }
      break;
    }
    case "delete": {
      const deleteName = args[1];
      if (!deleteName) {
        console.error("Error: delete command requires a snapshot name");
        console.error("Usage: deno run cli.ts delete <name>");
        Deno.exit(1);
      }
      await deleteSnapshot(DB_PATH, deleteName);
      break;
    }
    default:
      console.error(`Error: Unknown command '${command}'`);
      printUsage();
      Deno.exit(1);
  }
}

// Run if executed directly
if (import.meta.main) {
  await main();
}
