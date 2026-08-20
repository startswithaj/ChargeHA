import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import type { z } from "zod";
import type {
  semsPlusStationEntrySchema,
  semsPlusStationPageSchema,
} from "./GoodweSemsPlusTypes.ts";

export const LOGIN_PATH = "/web/sems/sems-user/api/v1/auth/cross-login";
const LOGIN_HOSTS = [
  "https://au-semsplus.goodwe.com",
  "https://semsplus.goodwe.com",
];
export const FALLBACK_GATEWAY = "https://au-gateway.semsportal.com/web/sems";

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

export function stationEntries(
  data: z.infer<typeof semsPlusStationPageSchema>,
): z.infer<typeof semsPlusStationEntrySchema>[] {
  if (Array.isArray(data)) return data;
  if ("records" in data) return data.records;
  return data.list;
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

// X-Signature auth the SEMS+ web app sends on every gateway call:
// base64(sha256hex("{ms}@{uid}@{token}") + "@" + ms), recomputed per request,
// plus the semsPlusWeb client identity in the token header.
export async function gatewayHeaders(
  token: SemsPlusToken,
): Promise<Record<string, string>> {
  const uid = String(token.uid ?? "");
  const inner = String(token.token ?? "");
  const ms = Date.now();
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ms}@${uid}@${inner}`),
  );
  // The gateway rejects non-browser identities, so mimic the SEMS+ web app.
  const region = typeof token.region === "string" && token.region
    ? token.region
    : "au";
  const origin = `https://${region}-semsplus.goodwe.com`;
  return {
    "Accept": "application/json, text/plain, */*",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Origin": origin,
    "Referer": `${origin}/`,
    "token": JSON.stringify({ ...token, client: "semsPlusWeb" }),
    "X-Signature": btoa(`${encodeHex(new Uint8Array(digest))}@${ms}`),
  };
}
