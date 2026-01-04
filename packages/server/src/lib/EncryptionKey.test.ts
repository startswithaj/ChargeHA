import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { validateEncryptionKey } from "./EncryptionKey.ts";

describe("validateEncryptionKey", () => {
  it("accepts a valid base64-encoded 32-byte key", () => {
    // Simulate: openssl rand -base64 32
    const rawKey = new Uint8Array(32).map((_, i) => i);
    const keyBase64 = btoa(String.fromCharCode(...rawKey));

    const result = validateEncryptionKey(keyBase64);
    expect(result.valid).toBe(true);
    expect(result.key).toBe(keyBase64);
    expect(result.error).toBeUndefined();
  });

  it("rejects an invalid base64 string with clear error", () => {
    const result = validateEncryptionKey("not-valid-base64!!!");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not valid base64");
    expect(result.error).toContain("openssl rand -base64 32");
    expect(result.key).toBeUndefined();
  });

  it("rejects a key of wrong length (not 32 bytes)", () => {
    // 16-byte key (128-bit) — wrong size
    const shortKey = btoa(
      String.fromCharCode(...new Uint8Array(16).map((_, i) => i)),
    );
    const result = validateEncryptionKey(shortKey);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("32 bytes");
    expect(result.error).toContain("got 16 bytes");
    expect(result.key).toBeUndefined();

    // 64-byte key — also wrong size
    const longKey = btoa(
      String.fromCharCode(...new Uint8Array(64).map((_, i) => i % 256)),
    );
    const longResult = validateEncryptionKey(longKey);
    expect(longResult.valid).toBe(false);
    expect(longResult.error).toContain("got 64 bytes");
  });

  it("rejects an empty string", () => {
    const result = validateEncryptionKey("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("empty");
    expect(result.key).toBeUndefined();

    // Whitespace-only
    const wsResult = validateEncryptionKey("   ");
    expect(wsResult.valid).toBe(false);
    expect(wsResult.error).toContain("empty");
  });

  it("detects undefined as missing", () => {
    const result = validateEncryptionKey(undefined);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not set");
    expect(result.key).toBeUndefined();
  });

  it("detects null as missing", () => {
    const result = validateEncryptionKey(null);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("not set");
    expect(result.key).toBeUndefined();
  });
});
