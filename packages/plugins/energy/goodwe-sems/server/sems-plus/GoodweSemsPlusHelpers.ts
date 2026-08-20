import type { SemsPlusEndpoint } from "./GoodweSemsPlusProtocol.ts";
import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";

const LOGIN_HOSTS = [
  "https://au-semsplus.goodwe.com",
  "https://semsplus.goodwe.com",
];
export const FALLBACK_GATEWAY = "https://au-gateway.semsportal.com/web/sems";
const WEB_LOGIN_BOOTSTRAP_TOKEN =
  '{"uid":"","timestamp":0,"token":"","client":"semsPlusWeb","version":"","language":"en"}';

export interface SemsPlusToken {
  readonly api: string;
  readonly [key: string]: unknown;
}

// Points the whole client (login + gateway) at a local fake for dev/e2e,
// mirroring the legacy client's GOODWE_SEMS_BASE_URL.
function baseOverride(): string | undefined {
  return Deno.env.get("GOODWE_SEMS_PLUS_BASE_URL")?.replace(/\/$/, "");
}

export function loginHosts(): string[] {
  const base = baseOverride();
  return base ? [base] : LOGIN_HOSTS;
}

export async function encodePassword(password: string): Promise<string> {
  const digest = await stdCrypto.subtle.digest(
    "MD5",
    new TextEncoder().encode(password),
  );
  return btoa(encodeHex(new Uint8Array(digest)));
}

export function gatewayBase(token: SemsPlusToken): string {
  const override = baseOverride();
  if (override) return `${override}/web/sems`;
  const api = token.api.replace(/\/$/, "");
  if (api.includes("-gateway.semsportal.com")) return api;
  if (typeof token.region === "string" && token.region) {
    return `https://${token.region}-gateway.semsportal.com/web/sems`;
  }
  const host = api.split("//").at(-1)?.split("/")[0] ?? "";
  const prefix = host.split(/[.-]/)[0];
  // "semsplus.goodwe.com" has no region prefix — its first segment is the
  // product name, not a region, and would build a nonexistent gateway host.
  const region = prefix && prefix !== "semsplus" ? prefix : "au";
  return `https://${region}-gateway.semsportal.com/web/sems`;
}

// base64(sha256hex("{ms}@{uid}@{token}") + "@" + ms), fresh per request. uid
// and token are empty strings on the login call itself.
export async function signature(uid: string, inner: string): Promise<string> {
  const ms = Date.now();
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ms}@${uid}@${inner}`),
  );
  return btoa(`${encodeHex(new Uint8Array(digest))}@${ms}`);
}

// The gateway rejects non-browser identities, so mimic the SEMS+ web app.
function webAppHeaders(region: string): Record<string, string> {
  const origin = `https://${region}-semsplus.goodwe.com`;
  return {
    "Accept": "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": origin,
    "Referer": `${origin}/`,
  };
}

export function tokenRegion(token: SemsPlusToken): string {
  return typeof token.region === "string" && token.region ? token.region : "au";
}

export async function gatewayHeaders(
  token: SemsPlusToken,
): Promise<Record<string, string>> {
  return {
    ...webAppHeaders(tokenRegion(token)),
    "token": JSON.stringify({ ...token, client: "semsPlusWeb" }),
    "X-Signature": await signature(
      String(token.uid ?? ""),
      String(token.token ?? ""),
    ),
  };
}

// The gateway runs a dual-session model: a token minted by a plain cross-login
// is refused on every route with C0602. A usable one comes from the same URL
// and body carrying the semsPlusWeb bootstrap identity below.
export async function loginHeaders(
  region: string,
): Promise<Record<string, string>> {
  return {
    ...webAppHeaders(region),
    "Content-Type": "application/json",
    "token": WEB_LOGIN_BOOTSTRAP_TOKEN,
    "X-Signature": await signature("", ""),
  };
}

export function hostRegion(url: string): string {
  const host = url.replace(/^https?:\/\//, "").split("/")[0];
  const prefix = host.split(/[.:-]/)[0];
  return prefix && prefix !== "semsplus" && prefix !== "localhost"
    ? prefix
    : "au";
}

export function gatewayUrl(
  token: SemsPlusToken,
  endpoint: SemsPlusEndpoint,
  query?: Record<string, string>,
): string {
  const search = query === undefined
    ? ""
    : `?${new URLSearchParams(query).toString()}`;
  return `${gatewayBase(token)}${endpoint.path}${search}`;
}
