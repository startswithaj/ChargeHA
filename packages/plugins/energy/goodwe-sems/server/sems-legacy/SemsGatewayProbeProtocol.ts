import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import type { SemsToken } from "./GoodweSemsTypes.ts";

export const PROBE_INTERVAL_MS = 30 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 15_000;

export const WEB_LOGIN_BOOTSTRAP_TOKEN =
  '{"uid":"","timestamp":0,"token":"","client":"semsPlusWeb","version":"","language":"en"}';

export const SUCCESS_CODES: ReadonlySet<string> = new Set(["0", "00000"]);
export const STALE_WEB_TOKEN_CODE = "C0602";

export function probeEnabled(): boolean {
  if (Deno.env.get("GOODWE_SEMS_GATEWAY_PROBE") !== "1") return false;
  // A base override means we are talking to the local fake, which has no
  // gateway routes.
  return !Deno.env.get("GOODWE_SEMS_BASE_URL");
}

export function tokenRegion(token: SemsToken): string {
  if (typeof token.region === "string" && token.region) return token.region;
  const api = token.api.replace(/\/$/, "");
  const host = api.split("//").at(-1)?.split("/")[0] ?? "";
  return host.split(/[.-]/)[0] || "au";
}

export function gatewayBase(token: SemsToken): string {
  const api = token.api.replace(/\/$/, "");
  if (api.includes("-gateway.semsportal.com")) return api;
  return `https://${tokenRegion(token)}-gateway.semsportal.com/web/sems`;
}

export function webLoginUrls(region: string): string[] {
  const path = "/web/sems/sems-user/api/v1/auth/cross-login";
  return [
    `https://${region}-semsplus.goodwe.com${path}`,
    `https://semsplus.goodwe.com${path}`,
  ];
}

// X-Signature the SEMS+ web app sends on every request:
// base64(sha256hex("{ms}@{uid}@{token}") + "@" + ms), recomputed per request.
// uid and token are empty strings on the login call itself.
export async function signature(uid: string, inner: string): Promise<string> {
  const ms = Date.now();
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ms}@${uid}@${inner}`),
  );
  return btoa(`${encodeHex(new Uint8Array(digest))}@${ms}`);
}

export async function encodeWebPassword(password: string): Promise<string> {
  const digest = await stdCrypto.subtle.digest(
    "MD5",
    new TextEncoder().encode(password),
  );
  return btoa(encodeHex(new Uint8Array(digest)));
}

// The gateway rejects non-browser identities, so mimic the SEMS+ web app.
export function browserHeaders(region: string): Record<string, string> {
  const origin = `https://${region}-semsplus.goodwe.com`;
  return {
    "Accept": "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": origin,
    "Referer": `${origin}/`,
  };
}

export type WebToken = Record<string, unknown>;
