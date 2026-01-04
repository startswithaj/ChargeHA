/**
 * AES-256-GCM encryption utilities using Web Crypto API.
 * Key is a base64-encoded 256-bit (32-byte) key from ENCRYPTION_KEY env var.
 */

/** Import a base64-encoded 256-bit key into a CryptoKey for AES-256-GCM. */
export function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  if (raw.length !== 32) {
    throw new Error(
      `Invalid encryption key: expected 32 bytes, got ${raw.length}`,
    );
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

/**
 * Encrypt plaintext using AES-256-GCM.
 * Returns a base64 string containing: 12-byte IV + ciphertext (includes GCM auth tag).
 */
export async function encrypt(
  plaintext: string,
  keyBase64: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoded,
  );

  // Prepend IV to ciphertext
  const combined = new Uint8Array(iv.length + cipherBuf.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuf), iv.length);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a base64 string (IV + ciphertext) using AES-256-GCM.
 * Returns the original plaintext.
 */
export async function decrypt(
  ciphertextBase64: string,
  keyBase64: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const combined = Uint8Array.from(
    atob(ciphertextBase64),
    (c) => c.charCodeAt(0),
  );

  if (combined.length < 13) {
    throw new Error("Invalid ciphertext: too short");
  }

  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const plainBuf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );

  return new TextDecoder().decode(plainBuf);
}

/**
 * Optionally encrypt a value if an encryption key is available.
 * Returns the (possibly encrypted) value and whether encryption was applied.
 */
export async function maybeEncrypt(
  plaintext: string,
  encryptionKey: string | null,
): Promise<{ value: string; isEncrypted: boolean }> {
  if (!encryptionKey) return { value: plaintext, isEncrypted: false };
  const encrypted = await encrypt(plaintext, encryptionKey);
  return { value: encrypted, isEncrypted: true };
}

/**
 * Store a secret in the database, encrypting it if an encryption key is available.
 * Uses the is_encrypted column on the config row to track encryption state.
 */
export async function storeSecret(
  db: {
    setSecret(
      key: string,
      value: string,
      isEncrypted: boolean,
    ): Promise<void>;
  },
  configKey: string,
  plaintext: string,
  encryptionKey: string | null,
): Promise<void> {
  if (encryptionKey) {
    const encrypted = await encrypt(plaintext, encryptionKey);
    await db.setSecret(configKey, encrypted, true);
  } else {
    await db.setSecret(configKey, plaintext, false);
  }
}

/**
 * Read a secret from the database, decrypting it if it was stored encrypted.
 * Returns null if the config key doesn't exist.
 */
export async function readSecret(
  db: {
    getSecret(
      key: string,
    ): Promise<{ value: string; isEncrypted: boolean } | null>;
  },
  configKey: string,
  encryptionKey: string | null,
): Promise<string | null> {
  const row = await db.getSecret(configKey);
  if (row === null) return null;

  if (row.isEncrypted) {
    if (!encryptionKey) {
      throw new Error(
        `Cannot decrypt ${configKey}: ENCRYPTION_KEY is not set`,
      );
    }
    return await decrypt(row.value, encryptionKey);
  }

  return row.value;
}

/**
 * Generate an EC P-256 key pair and return PEM-encoded public and private keys.
 */
export async function generateEcKeyPair(): Promise<{
  publicKeyPem: string;
  privateKeyPem: string;
}> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true, // extractable
    ["sign", "verify"],
  );

  const publicKeyDer = await crypto.subtle.exportKey(
    "spki",
    keyPair.publicKey,
  );
  const privateKeyDer = await crypto.subtle.exportKey(
    "pkcs8",
    keyPair.privateKey,
  );

  const publicKeyPem = derToPem(publicKeyDer, "PUBLIC KEY");
  const privateKeyPem = derToPem(privateKeyDer, "PRIVATE KEY");

  return { publicKeyPem, privateKeyPem };
}

/** Convert a DER ArrayBuffer to PEM format with the given label. */
function derToPem(der: ArrayBuffer, label: string): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = Array.from(
    { length: Math.ceil(base64.length / 64) },
    (_, i) => base64.slice(i * 64, i * 64 + 64),
  );
  return `-----BEGIN ${label}-----\n${
    lines.join("\n")
  }\n-----END ${label}-----\n`;
}
