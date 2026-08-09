/** Mutable control surface for the fake. Seeded from env, changed at runtime
 *  through POST /control. Everything the fake can be told to lie about lives
 *  here so a test can flip one field and re-issue the same request. */

export type GridSignMode = "signed" | "magnitude";
export type ApiBaseMode =
  | "direct"
  | "gateway"
  | "gateway-with-region"
  | "missing";

export interface ControlState {
  /** "signed": powerflow.grid already carries the sign (negative = export).
   *  "magnitude": grid is an absolute value and gridStatus carries the sign. */
  gridSignMode: GridSignMode;
  /** What `api` (and `region`) the login responses hand back. */
  apiBaseMode: ApiBaseMode;
  /** Base URL the fake tells clients to use in "direct" mode. */
  publicBase: string;
  /** Remaining requests to answer with the GY0429 rate-limit code. */
  rateLimitRequests: number;
  /** Rate limit every request until explicitly cleared. */
  rateLimitUntilCleared: boolean;
  /** Reject the next authenticated call as if the token went stale. */
  expireNextToken: boolean;
  /** Invalidate every issued token immediately. */
  tokensRevoked: boolean;
  /** Force a specific hour-of-day (0-23.999) for the solar curve. */
  hourOverride: number | null;
  /** Reject logins, to exercise the auth-error path. */
  rejectLogin: boolean;
}

const num = (name: string, fallback: number): number => {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const bool = (name: string, fallback: boolean): boolean => {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
};

const oneOf = <T extends string>(
  name: string,
  allowed: readonly T[],
  fallback: T,
): T => {
  const raw = Deno.env.get(name);
  return allowed.includes(raw as T) ? raw as T : fallback;
};

export type LogLevel = "silent" | "info" | "debug";
export const LOG_LEVEL: LogLevel = oneOf(
  "LOG_LEVEL",
  ["silent", "info", "debug"],
  "info",
);

export const PORT = num("PORT", 8099);
export const TLS_PORT = num("TLS_PORT", 443);
export const TLS_ENABLED = bool("TLS", false);
export const TLS_CERT = Deno.env.get("TLS_CERT") ?? "/certs/server.crt";
export const TLS_KEY = Deno.env.get("TLS_KEY") ?? "/certs/server.key";

export const ACCOUNT = Deno.env.get("SEMS_ACCOUNT") ?? "tester@example.com";
export const PASSWORD = Deno.env.get("SEMS_PASSWORD") ?? "fake-password-123";
/** Region label used to build gateway hosts. Point DNS for
 *  `<region>.semsportal.com` at the fake to exercise the rewrite branch. */
export const REGION = Deno.env.get("SEMS_REGION") ?? "eu";

export const state: ControlState = {
  // "magnitude" is what real SEMS sends: `grid` is unsigned in both
  // directions and `loadStatus` carries the direction. Confirmed against four
  // captured payloads. "signed" is kept so the other reading stays testable.
  gridSignMode: oneOf("GRID_SIGN_MODE", ["signed", "magnitude"], "magnitude"),
  apiBaseMode: oneOf(
    "API_BASE_MODE",
    ["direct", "gateway", "gateway-with-region", "missing"],
    "direct",
  ),
  publicBase: Deno.env.get("PUBLIC_BASE") ?? `http://localhost:${PORT}/api`,
  rateLimitRequests: num("RATE_LIMIT_REQUESTS", 0),
  rateLimitUntilCleared: bool("RATE_LIMIT_UNTIL_CLEARED", false),
  expireNextToken: bool("EXPIRE_NEXT_TOKEN", false),
  tokensRevoked: false,
  hourOverride: Deno.env.get("HOUR_OVERRIDE") ? num("HOUR_OVERRIDE", 12) : null,
  rejectLogin: bool("REJECT_LOGIN", false),
};

const KEYS: readonly (keyof ControlState)[] = [
  "gridSignMode",
  "apiBaseMode",
  "publicBase",
  "rateLimitRequests",
  "rateLimitUntilCleared",
  "expireNextToken",
  "tokensRevoked",
  "hourOverride",
  "rejectLogin",
];

export interface ControlChange {
  key: string;
  from: unknown;
  to: unknown;
}

/** Apply a partial control patch, ignoring unknown keys so a typo cannot
 *  silently create a field nothing reads. Returns each key applied with its
 *  old and new value, so the change can be logged. */
export const applyControl = (
  patch: Record<string, unknown>,
): ControlChange[] =>
  KEYS.filter((key) => key in patch).map((key) => {
    const from = state[key];
    // deno-lint-ignore no-explicit-any
    (state as any)[key] = patch[key];
    return { key, from, to: state[key] };
  });
