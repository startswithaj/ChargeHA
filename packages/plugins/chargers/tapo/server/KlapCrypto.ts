// KLAP v2 (Tapo variant) crypto primitives. Pure functions over WebCrypto —
// no I/O.
import { TapoConnectionError } from "./errors.ts";

const encoder = new TextEncoder();

export interface KlapSessionKeys {
  encKey: Uint8Array<ArrayBuffer>; // 16 bytes — AES-128-CBC
  ivPrefix: Uint8Array<ArrayBuffer>; // 12 bytes — iv = ivPrefix + seq (4-byte BE)
  sigKey: Uint8Array<ArrayBuffer>; // 28 bytes
  initialSeq: number; // signed int32 BE from the iv derivation's last 4 bytes
}

export class KlapCrypto {
  static concatBytes(
    ...parts: Uint8Array<ArrayBuffer>[]
  ): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
    parts.reduce((offset, p) => {
      out.set(p, offset);
      return offset + p.length;
    }, 0);
    return out;
  }

  static async sha1(
    data: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  }

  static async sha256(
    data: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  }

  // auth_hash = sha256(sha1(email) + sha1(password)) — raw bytes throughout.
  static async computeAuthHash(
    email: string,
    password: string,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const [emailHash, passwordHash] = await Promise.all([
      KlapCrypto.sha1(encoder.encode(email)),
      KlapCrypto.sha1(encoder.encode(password)),
    ]);
    return await KlapCrypto.sha256(
      KlapCrypto.concatBytes(emailHash, passwordHash),
    );
  }

  static seqBytes(seq: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(4);
    new DataView(out.buffer).setInt32(0, seq, false);
    return out;
  }

  static async deriveSessionKeys(
    localSeed: Uint8Array<ArrayBuffer>,
    remoteSeed: Uint8Array<ArrayBuffer>,
    authHash: Uint8Array<ArrayBuffer>,
  ): Promise<KlapSessionKeys> {
    const material = KlapCrypto.concatBytes(localSeed, remoteSeed, authHash);
    const [lsk, iv, ldk] = await Promise.all([
      KlapCrypto.sha256(
        KlapCrypto.concatBytes(encoder.encode("lsk"), material),
      ),
      KlapCrypto.sha256(KlapCrypto.concatBytes(encoder.encode("iv"), material)),
      KlapCrypto.sha256(
        KlapCrypto.concatBytes(encoder.encode("ldk"), material),
      ),
    ]);
    return {
      encKey: lsk.slice(0, 16),
      ivPrefix: iv.slice(0, 12),
      sigKey: ldk.slice(0, 28),
      initialSeq: new DataView(iv.buffer).getInt32(28, false),
    };
  }

  // Expected handshake1 server hash: sha256(localSeed + remoteSeed + authHash).
  static serverHash(
    localSeed: Uint8Array<ArrayBuffer>,
    remoteSeed: Uint8Array<ArrayBuffer>,
    authHash: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    return KlapCrypto.sha256(
      KlapCrypto.concatBytes(localSeed, remoteSeed, authHash),
    );
  }

  // handshake2 body: sha256(remoteSeed + localSeed + authHash).
  static handshake2Hash(
    localSeed: Uint8Array<ArrayBuffer>,
    remoteSeed: Uint8Array<ArrayBuffer>,
    authHash: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    return KlapCrypto.sha256(
      KlapCrypto.concatBytes(remoteSeed, localSeed, authHash),
    );
  }

  static bytesEqual(
    a: Uint8Array<ArrayBuffer>,
    b: Uint8Array<ArrayBuffer>,
  ): boolean {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }

  private static importAesKey(
    encKey: Uint8Array<ArrayBuffer>,
  ): Promise<CryptoKey> {
    return crypto.subtle.importKey(
      "raw",
      encKey,
      "AES-CBC",
      false,
      ["encrypt", "decrypt"],
    );
  }

  // Encrypted request body: sha256(sigKey + seq + ciphertext) + ciphertext.
  static async encryptPayload(
    keys: KlapSessionKeys,
    seq: number,
    plaintext: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const key = await KlapCrypto.importAesKey(keys.encKey);
    const iv = KlapCrypto.concatBytes(keys.ivPrefix, KlapCrypto.seqBytes(seq));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt({ name: "AES-CBC", iv }, key, plaintext),
    );
    const signature = await KlapCrypto.sha256(
      KlapCrypto.concatBytes(keys.sigKey, KlapCrypto.seqBytes(seq), ciphertext),
    );
    return KlapCrypto.concatBytes(signature, ciphertext);
  }

  // Response body has the same layout: 32-byte signature + ciphertext.
  static async decryptPayload(
    keys: KlapSessionKeys,
    seq: number,
    body: Uint8Array<ArrayBuffer>,
  ): Promise<Uint8Array<ArrayBuffer>> {
    const signature = body.slice(0, 32);
    const ciphertext = body.slice(32);
    // Same formula as the request signature. Assumption to confirm on real
    // hardware: reference clients (python-kasa) skip these 32 bytes without
    // verifying; tapo-simulator signs responses this way. A mismatch here
    // fails loud instead of surfacing as an opaque decrypt/JSON error.
    const expected = await KlapCrypto.sha256(
      KlapCrypto.concatBytes(
        keys.sigKey,
        KlapCrypto.seqBytes(seq),
        ciphertext,
      ),
    );
    if (!KlapCrypto.bytesEqual(signature, expected)) {
      throw new TapoConnectionError("Response signature mismatch");
    }
    const key = await KlapCrypto.importAesKey(keys.encKey);
    const iv = KlapCrypto.concatBytes(keys.ivPrefix, KlapCrypto.seqBytes(seq));
    return new Uint8Array(
      await crypto.subtle.decrypt({ name: "AES-CBC", iv }, key, ciphertext),
    );
  }
}
