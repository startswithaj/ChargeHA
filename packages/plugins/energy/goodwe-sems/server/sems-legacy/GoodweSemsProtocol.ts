import { crypto as stdCrypto } from "@std/crypto";
import { encodeHex } from "@std/encoding/hex";
import type { SemsToken } from "./GoodweSemsTypes.ts";

export type LoginMode = "new" | "legacy";

export const STATION_DETAIL_PATH =
  "/v3/PowerStation/GetMonitorDetailByPowerstationId";
export const STATION_LIST_PATH = "/PowerStation/GetPowerStationIdByOwner";

export const LEGACY_API_FALLBACK = "https://au.semsportal.com/api";
const NEW_LOGIN_FALLBACK_API = "https://au-gateway.semsportal.com/web/sems";
const BOOTSTRAP_TOKEN = '{"version":"3.1.1","client":"ios","language":"en"}';

export const SUCCESS_CODES: ReadonlySet<string> = new Set(["0", "00000"]);
export const STALE_TOKEN_CODES: ReadonlySet<string> = new Set([
  "100002",
  "C0602",
]);
export const RATE_LIMIT_CODE = "GY0429";
export const RATE_LIMIT_BACKOFF_MS = 300_000;
export const EMPTY_RETRY_COOLDOWN_MS = 10 * 60 * 1000;
// Rejected credentials can't fix themselves — don't hammer rate-limited CrossLogin.
export const REJECTED_LOGIN_COOLDOWN_MS = 5 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 15_000;

function baseOverride(): string | undefined {
  return Deno.env.get("GOODWE_SEMS_BASE_URL")?.replace(/\/$/, "");
}

export function newLoginUrls(): string[] {
  const base = baseOverride();
  const path = "/web/sems/sems-user/api/v1/auth/cross-login";
  if (base) return [`${base}${path}`];
  return [
    `https://au-semsplus.goodwe.com${path}`,
    `https://semsplus.goodwe.com${path}`,
  ];
}

export function legacyLoginUrl(): string {
  const base = baseOverride();
  return base
    ? `${base}/api/v3/Common/CrossLogin`
    : "https://www.semsportal.com/api/v3/Common/CrossLogin";
}

export function loginHeaders(mode: LoginMode): Record<string, string> {
  if (mode === "legacy") {
    return {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "token": BOOTSTRAP_TOKEN,
    };
  }
  return {
    "Content-Type": "application/json",
    "Accept": "application/json, */*;q=0.5",
  };
}

export function resolveLoginApi(
  envelopeApi: string | undefined,
  payloadApi: string | undefined,
  mode: LoginMode,
): string | null {
  if (envelopeApi) return envelopeApi;
  if (payloadApi) return payloadApi;
  if (mode === "new") return NEW_LOGIN_FALLBACK_API;
  return null;
}

export async function encodeSemsPlusPassword(
  password: string,
): Promise<string> {
  const digest = await stdCrypto.subtle.digest(
    "MD5",
    new TextEncoder().encode(password),
  );
  return btoa(encodeHex(new Uint8Array(digest)));
}

function validRegion(region: unknown): string | null {
  if (typeof region !== "string") return null;
  const trimmed = region.trim().toLowerCase();
  return /^[a-z]{2,4}$/.test(trimmed) ? trimmed : null;
}

function extractRegion(base: string): string | null {
  const host = base.split("//").at(-1)?.split("/")[0] ?? "";
  if (host.endsWith("-gateway.semsportal.com")) {
    return host.replace("-gateway.semsportal.com", "") || null;
  }
  if (host.endsWith(".semsportal.com")) return host.split(".")[0] || null;
  return null;
}

// null means the region could not be resolved — the caller warns and falls
// back, so a misrouted station call is visible rather than silent.
export function resolveApiBase(token: SemsToken, path: string): string | null {
  const override = baseOverride();
  if (override) return `${override}/api`;

  const base = token.api.replace(/\/$/, "");
  const isStationRoute = path.startsWith("/PowerStation") ||
    path.startsWith("/v3/PowerStation");
  if (!isStationRoute) return base;
  const host = base.split("//").at(-1)?.split("/")[0] ?? "";
  const isSemsPlusHost = host.endsWith("-gateway.semsportal.com") ||
    host.endsWith("semsplus.goodwe.com");
  if (!isSemsPlusHost) return base;

  const region = validRegion(token.region) ?? extractRegion(base);
  return region ? `https://${region}.semsportal.com/api` : null;
}

export function isEmptyData(data: unknown): boolean {
  if (data === null || data === undefined || data === "") return true;
  if (Array.isArray(data)) return data.length === 0;
  if (typeof data === "object") return Object.keys(data).length === 0;
  return false;
}

export const POLL_INTERVAL_SECONDS = 60;
export const MAX_STALE_MS = 15 * 60 * 1000;
