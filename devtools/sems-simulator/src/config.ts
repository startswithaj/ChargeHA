export type GridSignMode = "signed" | "magnitude";
export type ApiBaseMode =
  | "direct"
  | "gateway"
  | "gateway-with-region"
  | "missing";

export interface ControlState {
  gridSignMode: GridSignMode;
  apiBaseMode: ApiBaseMode;
  publicBase: string;
  rateLimitRequests: number;
  rateLimitUntilCleared: boolean;
  expireNextToken: boolean;
  tokensRevoked: boolean;
  hourOverride: number | null;
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
export const REGION = Deno.env.get("SEMS_REGION") ?? "eu";

export const state: ControlState = {
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

export const applyControl = (
  patch: Record<string, unknown>,
): ControlChange[] =>
  KEYS.filter((key) => key in patch).map((key) => {
    const from = state[key];
    // deno-lint-ignore no-explicit-any
    (state as any)[key] = patch[key];
    return { key, from, to: state[key] };
  });
