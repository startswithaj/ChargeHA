import { load } from "@std/dotenv";

/**
 * Load a .env file into the process environment before the app reads config.
 * No-op when the file is absent (e.g. containers passing vars via -e); existing
 * env vars are not overwritten.
 */
export async function loadEnv(envPath = ".env"): Promise<void> {
  await load({ envPath, export: true });
}
