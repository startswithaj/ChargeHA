export interface ControlState {
  // Serve a flow payload with no power fields — an un-migrated station.
  emptyFlow: boolean;
  rateLimitRequests: number;
  rateLimitUntilCleared: boolean;
  expireNextToken: boolean;
  tokensRevoked: boolean;
  rejectLogin: boolean;
  // Pin the simulated clock, 0–23, instead of following real time.
  hourOverride: number | null;
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

export const PORT = num("PORT", 8098);

export const ACCOUNT = Deno.env.get("SEMS_ACCOUNT") ?? "tester@example.com";
export const PASSWORD = Deno.env.get("SEMS_PASSWORD") ?? "fake-password-123";
export const REGION = Deno.env.get("SEMS_REGION") ?? "au";

export const state: ControlState = {
  emptyFlow: bool("EMPTY_FLOW", false),
  rateLimitRequests: num("RATE_LIMIT_REQUESTS", 0),
  rateLimitUntilCleared: bool("RATE_LIMIT_UNTIL_CLEARED", false),
  expireNextToken: bool("EXPIRE_NEXT_TOKEN", false),
  tokensRevoked: false,
  rejectLogin: bool("REJECT_LOGIN", false),
  hourOverride: Deno.env.get("HOUR_OVERRIDE") ? num("HOUR_OVERRIDE", 12) : null,
};

const KEYS: readonly (keyof ControlState)[] = [
  "emptyFlow",
  "rateLimitRequests",
  "rateLimitUntilCleared",
  "expireNextToken",
  "tokensRevoked",
  "rejectLogin",
  "hourOverride",
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
