import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import {
  decrypt,
  encrypt,
  generateEcKeyPair,
  importKey,
  maybeEncrypt,
} from "./Encryption.ts";

describe("encryption", () => {
  // Generate a valid base64-encoded 256-bit key for testing
  const TEST_KEY = btoa(
    String.fromCharCode(
      ...new Uint8Array(32).map((_, i) => i),
    ),
  );

  // A different valid key for wrong-key tests
  const WRONG_KEY = btoa(
    String.fromCharCode(
      ...new Uint8Array(32).map((_, i) => 255 - i),
    ),
  );

  describe("encrypt / decrypt", () => {
    it("round-trips correctly for various plaintext inputs", async () => {
      const inputs = [
        "hello world",
        "",
        "a",
        'special chars: !@#$%^&*()_+{}[]|\\:";<>?,./~`',
        "unicode: 日本語テスト 🔑",
        "-----BEGIN PRIVATE KEY-----\nMIGHAgEAMBMGByqGSM49...\n-----END PRIVATE KEY-----\n",
      ];

      await inputs.reduce(async (prev, plaintext) => {
        await prev;
        const encrypted = await encrypt(plaintext, TEST_KEY);
        const decrypted = await decrypt(encrypted, TEST_KEY);
        expect(decrypted).toBe(plaintext);
      }, Promise.resolve());
    });

    it("produces different ciphertext each time (random IV)", async () => {
      const plaintext = "same input twice";
      const encrypted1 = await encrypt(plaintext, TEST_KEY);
      const encrypted2 = await encrypt(plaintext, TEST_KEY);
      expect(encrypted1).not.toBe(encrypted2);

      // Both should decrypt to the same value
      expect(await decrypt(encrypted1, TEST_KEY)).toBe(plaintext);
      expect(await decrypt(encrypted2, TEST_KEY)).toBe(plaintext);
    });

    it("throws error when decrypting with wrong key", async () => {
      const encrypted = await encrypt("secret data", TEST_KEY);
      await expect(decrypt(encrypted, WRONG_KEY)).rejects.toThrow();
    });

    it("throws error when decrypting corrupted ciphertext", async () => {
      const encrypted = await encrypt("test", TEST_KEY);
      // Corrupt the ciphertext by flipping bits in the middle
      const bytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
      bytes[bytes.length - 5] ^= 0xff;
      const corrupted = btoa(String.fromCharCode(...bytes));
      await expect(decrypt(corrupted, TEST_KEY)).rejects.toThrow();
    });

    it("works with base64-encoded 256-bit key", async () => {
      // Generate a proper random key the way a user would (openssl rand -base64 32)
      const rawKey = crypto.getRandomValues(new Uint8Array(32));
      const keyBase64 = btoa(String.fromCharCode(...rawKey));

      const plaintext = "test with random key";
      const encrypted = await encrypt(plaintext, keyBase64);
      const decrypted = await decrypt(encrypted, keyBase64);
      expect(decrypted).toBe(plaintext);
    });
  });

  describe("importKey", () => {
    it("rejects key of wrong length", () => {
      const shortKey = btoa(String.fromCharCode(...new Uint8Array(16)));
      expect(() => importKey(shortKey)).toThrow("expected 32 bytes");
    });

    it("rejects invalid base64", () => {
      expect(() => importKey("not-valid-base64!!!")).toThrow();
    });
  });

  describe("generateEcKeyPair", () => {
    it("generates valid PEM-formatted EC key pair", async () => {
      const { publicKeyPem, privateKeyPem } = await generateEcKeyPair();

      expect(publicKeyPem).toContain("-----BEGIN PUBLIC KEY-----");
      expect(publicKeyPem).toContain("-----END PUBLIC KEY-----");
      expect(privateKeyPem).toContain("-----BEGIN PRIVATE KEY-----");
      expect(privateKeyPem).toContain("-----END PRIVATE KEY-----");
    });

    it("generates unique key pairs each time", async () => {
      const pair1 = await generateEcKeyPair();
      const pair2 = await generateEcKeyPair();
      expect(pair1.publicKeyPem).not.toBe(pair2.publicKeyPem);
      expect(pair1.privateKeyPem).not.toBe(pair2.privateKeyPem);
    });
  });

  describe("maybeEncrypt", () => {
    it("encrypts when key is provided", async () => {
      const result = await maybeEncrypt("secret", TEST_KEY);
      expect(result.isEncrypted).toBe(true);
      expect(result.value).not.toBe("secret");
      expect(await decrypt(result.value, TEST_KEY)).toBe("secret");
    });

    it("returns plaintext when key is null", async () => {
      const result = await maybeEncrypt("secret", null);
      expect(result.isEncrypted).toBe(false);
      expect(result.value).toBe("secret");
    });
  });
});
