// Fixed-vector coverage for KlapCrypto: the simulator (devtools/tapo-simulator)
// and the real KlapClient both call this module. A vector-independent test
// (e.g. round-tripping crypto against itself) would pass even if the byte
// order or hash material drifted identically on both sides. These expected
// bytes were computed once against the real implementation for the fixed
// inputs below and hardcoded, so a systematic derivation bug fails loud
// against real hardware instead of only showing up there.
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { KlapCrypto } from "./KlapCrypto.ts";
import { TapoConnectionError } from "./errors.ts";

describe("KlapCrypto", () => {
  const bytesToHex = (bytes: Uint8Array): string =>
    Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

  // Fixed inputs — deterministic, not random, so the derived values below
  // are reproducible from a fresh run of the real implementation.
  const LOCAL_SEED = Uint8Array.from([
    0x00,
    0x01,
    0x02,
    0x03,
    0x04,
    0x05,
    0x06,
    0x07,
    0x08,
    0x09,
    0x0a,
    0x0b,
    0x0c,
    0x0d,
    0x0e,
    0x0f,
  ]);
  const REMOTE_SEED = Uint8Array.from([
    0x10,
    0x11,
    0x12,
    0x13,
    0x14,
    0x15,
    0x16,
    0x17,
    0x18,
    0x19,
    0x1a,
    0x1b,
    0x1c,
    0x1d,
    0x1e,
    0x1f,
  ]);
  const EMAIL = "user@example.com";
  const PASSWORD = "example-password";

  // Expected bytes below (hex) computed once from the real implementation
  // against LOCAL_SEED/REMOTE_SEED/EMAIL/PASSWORD above.
  const EXPECTED_AUTH_HASH =
    "cd523355fbf4265ad004f5664388240b682a4864a2962e07da59987de4b4b3cd";
  const EXPECTED_SERVER_HASH =
    "ef1ab73e9f0e8670559304ce47d47bb40187536389135b6d44dbab331f8760da";
  const EXPECTED_HANDSHAKE2_HASH =
    "d199bb137ac2e247fccdd5ae7fc1273b0c19f0d5f4ca024674143d6f0d0b0f61";
  const EXPECTED_ENC_KEY = "93f3736fb4a800178c78b7f5d9c6d735";
  const EXPECTED_IV_PREFIX = "61bddd033e172dd6e70608a1";
  const EXPECTED_SIG_KEY =
    "f7bc85a976d7eace9237971e45710315b41ce2e1cbac66c341425bdb";
  const EXPECTED_INITIAL_SEQ = -374796402;
  // seq used for the request-signature vector below: initialSeq + 1.
  const EXPECTED_REQUEST_SEQ = -374796401;
  const EXPECTED_REQUEST_SIGNATURE =
    "d81fb8dc7b1a00fdb9507a81a029cfbb0379f1b5da8443e1930a8d4c5392b940";
  const EXPECTED_REQUEST_CIPHERTEXT =
    "f5af69d11a1432c002ac4d031d2aa8c5a17dd835d871d0e49002b13d7d5e1270";

  describe("fixed vector", () => {
    it("computeAuthHash matches the hardcoded auth hash", async () => {
      const authHash = await KlapCrypto.computeAuthHash(EMAIL, PASSWORD);
      expect(bytesToHex(authHash)).toBe(EXPECTED_AUTH_HASH);
    });

    it("serverHash matches the hardcoded handshake1 hash", async () => {
      const authHash = await KlapCrypto.computeAuthHash(EMAIL, PASSWORD);
      const hash = await KlapCrypto.serverHash(
        LOCAL_SEED,
        REMOTE_SEED,
        authHash,
      );
      expect(bytesToHex(hash)).toBe(EXPECTED_SERVER_HASH);
    });

    it("handshake2Hash matches the hardcoded handshake2 body", async () => {
      const authHash = await KlapCrypto.computeAuthHash(EMAIL, PASSWORD);
      const hash = await KlapCrypto.handshake2Hash(
        LOCAL_SEED,
        REMOTE_SEED,
        authHash,
      );
      expect(bytesToHex(hash)).toBe(EXPECTED_HANDSHAKE2_HASH);
    });

    it("deriveSessionKeys matches the hardcoded session keys", async () => {
      const authHash = await KlapCrypto.computeAuthHash(EMAIL, PASSWORD);
      const keys = await KlapCrypto.deriveSessionKeys(
        LOCAL_SEED,
        REMOTE_SEED,
        authHash,
      );
      expect(bytesToHex(keys.encKey)).toBe(EXPECTED_ENC_KEY);
      expect(bytesToHex(keys.ivPrefix)).toBe(EXPECTED_IV_PREFIX);
      expect(bytesToHex(keys.sigKey)).toBe(EXPECTED_SIG_KEY);
      expect(keys.initialSeq).toBe(EXPECTED_INITIAL_SEQ);
    });

    it("encryptPayload matches the hardcoded request signature", async () => {
      const authHash = await KlapCrypto.computeAuthHash(EMAIL, PASSWORD);
      const keys = await KlapCrypto.deriveSessionKeys(
        LOCAL_SEED,
        REMOTE_SEED,
        authHash,
      );
      const plaintext = new TextEncoder().encode(
        JSON.stringify({ method: "get_device_info" }),
      );
      const encrypted = await KlapCrypto.encryptPayload(
        keys,
        EXPECTED_REQUEST_SEQ,
        plaintext,
      );
      expect(bytesToHex(encrypted.slice(0, 32))).toBe(
        EXPECTED_REQUEST_SIGNATURE,
      );
      expect(bytesToHex(encrypted.slice(32))).toBe(
        EXPECTED_REQUEST_CIPHERTEXT,
      );
    });
  });

  describe("encryptPayload / decryptPayload round trip", () => {
    it("decrypts back to the original plaintext", async () => {
      const authHash = await KlapCrypto.computeAuthHash(EMAIL, PASSWORD);
      const keys = await KlapCrypto.deriveSessionKeys(
        LOCAL_SEED,
        REMOTE_SEED,
        authHash,
      );
      const seq = keys.initialSeq + 1;
      const plaintext = new TextEncoder().encode(
        JSON.stringify({
          method: "set_device_info",
          params: { device_on: true },
        }),
      );
      const encrypted = await KlapCrypto.encryptPayload(keys, seq, plaintext);
      const decrypted = await KlapCrypto.decryptPayload(keys, seq, encrypted);
      expect(new TextDecoder().decode(decrypted)).toBe(
        new TextDecoder().decode(plaintext),
      );
    });

    it("throws TapoConnectionError when the signature byte is tampered", async () => {
      const authHash = await KlapCrypto.computeAuthHash(EMAIL, PASSWORD);
      const keys = await KlapCrypto.deriveSessionKeys(
        LOCAL_SEED,
        REMOTE_SEED,
        authHash,
      );
      const seq = keys.initialSeq + 1;
      const plaintext = new TextEncoder().encode(
        JSON.stringify({ method: "get_device_info" }),
      );
      const encrypted = await KlapCrypto.encryptPayload(keys, seq, plaintext);
      const tampered = Uint8Array.from(encrypted);
      tampered[0] = tampered[0] ^ 0xff;

      const attempt = () => KlapCrypto.decryptPayload(keys, seq, tampered);
      await expect(attempt()).rejects.toThrow(TapoConnectionError);
      await expect(attempt()).rejects.toThrow("Response signature mismatch");
    });
  });

  describe("seqBytes", () => {
    it("encodes small positive sequence numbers big-endian", () => {
      expect(bytesToHex(KlapCrypto.seqBytes(1))).toBe("00000001");
    });

    it("encodes multi-byte sequence numbers big-endian", () => {
      expect(bytesToHex(KlapCrypto.seqBytes(256))).toBe("00000100");
      expect(bytesToHex(KlapCrypto.seqBytes(0x01020304))).toBe("01020304");
    });

    it("encodes negative sequence numbers as two's complement", () => {
      expect(bytesToHex(KlapCrypto.seqBytes(-1))).toBe("ffffffff");
    });
  });

  describe("bytesEqual", () => {
    it("is true for identical byte arrays", () => {
      expect(
        KlapCrypto.bytesEqual(
          Uint8Array.from([1, 2, 3]),
          Uint8Array.from([1, 2, 3]),
        ),
      ).toBe(true);
    });

    it("is false when lengths differ", () => {
      expect(
        KlapCrypto.bytesEqual(
          Uint8Array.from([1, 2, 3]),
          Uint8Array.from([1, 2]),
        ),
      ).toBe(false);
    });

    it("is false when content differs at the same length", () => {
      expect(
        KlapCrypto.bytesEqual(
          Uint8Array.from([1, 2, 3]),
          Uint8Array.from([1, 2, 4]),
        ),
      ).toBe(false);
    });
  });
});
