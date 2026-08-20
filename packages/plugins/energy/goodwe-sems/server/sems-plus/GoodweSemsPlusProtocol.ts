// Every SEMS+ endpoint ChargeHA calls. None is documented by GoodWe — shapes
// come from the semsplus.goodwe.com bundle and captured responses, see
// docs/goodwe.md.

export interface SemsPlusEndpoint {
  readonly label: string;
  readonly method: "GET" | "POST";
  readonly path: string;
}

export const LOGIN: SemsPlusEndpoint = {
  label: "login",
  method: "POST",
  path: "/web/sems/sems-user/api/v1/auth/cross-login",
};

export const STATION_LIST: SemsPlusEndpoint = {
  label: "station list",
  method: "POST",
  path: "/sems-plant/api/stations/simple-query",
};

export const FLOW: SemsPlusEndpoint = {
  label: "flow",
  method: "GET",
  path: "/sems-plant/api/stations/flow",
};

export const STATION_LIST_BODY = { current: 1, size: 100 } as const;

export const SUCCESS_CODES: ReadonlySet<string> = new Set(["0", "00000"]);
export const STALE_TOKEN_CODES: ReadonlySet<string> = new Set([
  "100002",
  "C0602",
]);
export const RATE_LIMIT_CODE = "GY0429";
export const RATE_LIMIT_BACKOFF_MS = 300_000;
// Rejected credentials can't fix themselves — don't hammer rate-limited CrossLogin.
export const REJECTED_LOGIN_COOLDOWN_MS = 5 * 60 * 1000;
export const REQUEST_TIMEOUT_MS = 15_000;

export const POLL_INTERVAL_SECONDS = 60;
export const MAX_STALE_MS = 15 * 60 * 1000;
