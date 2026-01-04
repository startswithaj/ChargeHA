/**
 * ENCRYPTION_KEY validation and startup check utilities.
 * The key must be a valid base64-encoded 256-bit (32-byte) value.
 * Generate with: openssl rand -base64 32
 */

import type { AppDatabase } from "../db/AppDatabase.ts";

function decodeBase64(base64: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export type EncryptionKeyResult =
  | { valid: true; key: string; error?: undefined }
  | { valid: false; error: string; key?: undefined };

/**
 * Validate an encryption key string.
 * Returns { valid: true, key } if valid, { valid: false, error } if not.
 */
export function validateEncryptionKey(
  keyBase64: string | undefined | null,
): EncryptionKeyResult {
  if (keyBase64 === undefined || keyBase64 === null) {
    return { valid: false, error: "ENCRYPTION_KEY is not set" };
  }

  if (keyBase64.trim() === "") {
    return { valid: false, error: "ENCRYPTION_KEY is empty" };
  }

  const raw = decodeBase64(keyBase64);
  if (!raw) {
    return {
      valid: false,
      error:
        "ENCRYPTION_KEY is not valid base64. Generate one with: openssl rand -base64 32",
    };
  }

  if (raw.length !== 32) {
    return {
      valid: false,
      error:
        `ENCRYPTION_KEY must be 32 bytes (256-bit), got ${raw.length} bytes. Generate one with: openssl rand -base64 32`,
    };
  }

  return { valid: true, key: keyBase64 };
}

/**
 * Read and validate the ENCRYPTION_KEY env var without touching the DB.
 * Used at startup before the DB is constructed, so the key can be passed
 * into the AppDatabase constructor. Returns null on missing/invalid key.
 */
export function resolveEncryptionKeyFromEnv(): string | null {
  const keyBase64 = Deno.env.get("ENCRYPTION_KEY");
  const result = validateEncryptionKey(keyBase64);
  if (result.valid) {
    console.log("[Security] ENCRYPTION_KEY validated successfully");
    return result.key;
  }
  console.info(
    "[Security] ENCRYPTION_KEY is not set or invalid. Secrets will be stored in plain text until a valid key is provided.",
  );
  return null;
}

/**
 * Post-init warning: if no encryption key is configured but the DB contains
 * encrypted rows, surface a loud error. Decryption of those rows will fail
 * on read until a valid key is provided.
 */
export async function warnIfEncryptedRowsButNoKey(
  db: AppDatabase,
  encryptionKey: string | null,
): Promise<void> {
  if (encryptionKey) return;
  const hasEncryptedData = await db.hasEncryptedRows();
  if (!hasEncryptedData) return;
  console.error(
    `[Security] ENCRYPTION_KEY is missing, but encrypted data exists in the database.`,
  );
  console.error(
    "[Security] Decryption of stored secrets will fail until a valid key is provided.",
  );
  console.error(
    "[Security] Add ENCRYPTION_KEY to your .env file. Generate with: openssl rand -base64 32",
  );
}
