import { createHash, randomUUID } from "node:crypto";
import {
  ACCOUNT,
  applyControl,
  LOG_LEVEL,
  PASSWORD,
  PORT,
  REGION,
  state,
  TLS_CERT,
  TLS_ENABLED,
  TLS_KEY,
  TLS_PORT,
} from "./config.ts";
import {
  findStation,
  type Powerflow,
  stationDetail,
  stationListEntry,
  STATIONS,
} from "./stations.ts";
import {
  colour,
  debug,
  info,
  injected,
  isDebug,
  isInfo,
  redactedJson,
  shortToken,
  startup,
  warn,
} from "./log.ts";

const RATE_LIMIT_CODE = "GY0429";
const TOKEN_EXPIRED_CODE = "100002";

const issuedTokens = new Set<string>();

const SUCCESS_CODES = new Set<string>(["0", "00000"]);

const operationFor = (method: string, path: string): string => {
  if (path === "/health") return "health";
  if (path === "/control") return method === "GET" ? "control-read" : "control";
  if (path === "/api/v3/Common/CrossLogin") return "login (legacy)";
  if (path === "/web/sems/sems-user/api/v1/auth/cross-login") {
    return "login (sems+)";
  }
  if (path === "/api/PowerStation/GetPowerStationIdByOwner") {
    return "station list";
  }
  if (path === "/api/v3/PowerStation/GetMonitorDetailByPowerstationId") {
    return "station detail";
  }
  return "unknown";
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

interface Envelope {
  code: string | number;
  msg: string;
  data: unknown;
  api?: string;
  components?: unknown;
}

const envelope = (
  code: string | number,
  msg: string,
  data: unknown,
  api?: string,
): Envelope => {
  const body: Envelope = { code, msg, data };
  if (api !== undefined) body.api = api;
  return body;
};

const rateLimited = (): Envelope =>
  envelope(RATE_LIMIT_CODE, "Too many requests, please try later", null);

const shouldRateLimit = (): boolean => {
  if (state.rateLimitUntilCleared) return true;
  if (state.rateLimitRequests > 0) {
    state.rateLimitRequests -= 1;
    return true;
  }
  return false;
};

const md5Base64 = (value: string): string =>
  btoa(createHash("md5").update(value).digest("hex"));

const loginApi = (): {
  api: string | undefined;
  region: string | undefined;
} => {
  switch (state.apiBaseMode) {
    case "gateway":
      return {
        api: `https://${REGION}-gateway.semsportal.com/web/sems`,
        region: undefined,
      };
    case "gateway-with-region":
      return {
        api: `https://${REGION}-gateway.semsportal.com/web/sems`,
        region: REGION,
      };
    case "missing":
      return { api: undefined, region: undefined };
    case "direct":
    default:
      return { api: state.publicBase, region: undefined };
  }
};

const issueToken = (): Record<string, unknown> => {
  const token = randomUUID().replace(/-/g, "");
  issuedTokens.add(token);
  const { api, region } = loginApi();
  const payload: Record<string, unknown> = {
    uid: "fake-uid-0001",
    timestamp: Date.now(),
    token,
    client: "ios",
    version: "v2.1.0",
    language: "en",
  };
  if (api !== undefined) payload.api = api;
  if (region !== undefined) payload.region = region;
  return payload;
};

const readJson = async (
  request: Request,
): Promise<Record<string, unknown> | null> => {
  const text = await request.text();
  if (!text) {
    debug("BODY", "request (empty)");
    return null;
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    debug("BODY", `request ${redactedJson(parsed)}`);
    return parsed;
  } catch {
    debug("BODY", `request (${text.length} bytes, not JSON)`);
    return null;
  }
};

const handleLogin = async (
  request: Request,
  mode: "new" | "legacy",
): Promise<Response> => {
  const body = await readJson(request) ?? {};
  if (state.rejectLogin) {
    injected(`rejectLogin knob is on — failing this ${mode} login with 100005`);
    return json(envelope("100005", "Login rejected by control knob", null));
  }
  const account = body.account;
  const pwd = body.pwd;
  const expected = mode === "new" ? md5Base64(PASSWORD) : PASSWORD;

  if (account !== ACCOUNT || pwd !== expected) {
    const reason = account !== ACCOUNT ? "unknown account" : "wrong password";
    warn("AUTH", `login ${mode} rejected — ${reason}`);
    return json(envelope("100005", "Email or password error", null));
  }
  if (mode === "new") {
    const missing = ["agreement", "isChinese", "isLocal"].filter((key) =>
      !(key in body)
    );
    if (missing.length > 0) {
      warn("AUTH", `login sems+ rejected — missing ${missing.join(", ")}`);
      return json(
        envelope("100001", `Missing fields: ${missing.join(", ")}`, null),
      );
    }
  }

  const payload = issueToken();
  const { api } = loginApi();
  info(
    "AUTH",
    `login ${mode} ok — token=${shortToken(String(payload.token))} ` +
      `apiBaseMode=${state.apiBaseMode} api=${api ?? "(omitted)"}`,
  );
  return json(envelope(mode === "new" ? "00000" : 0, "success", payload, api));
};

const authFailure = (request: Request): Envelope | null => {
  const header = request.headers.get("token");
  if (!header) {
    warn("AUTH", "unauthenticated — no token header presented");
    return envelope(TOKEN_EXPIRED_CODE, "Missing token header", null);
  }

  const parsed = (() => {
    try {
      return JSON.parse(header) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (!parsed || typeof parsed.token !== "string") {
    warn("AUTH", "unauthenticated — token header is not the login payload");
    return envelope(TOKEN_EXPIRED_CODE, "Malformed token header", null);
  }
  const short = shortToken(parsed.token);
  if (state.expireNextToken) {
    state.expireNextToken = false;
    issuedTokens.delete(parsed.token);
    injected(
      `expireNextToken knob fired — token=${short} forcibly expired ` +
        `(knob now cleared)`,
    );
    return envelope(TOKEN_EXPIRED_CODE, "Token expired", null);
  }
  if (state.tokensRevoked) {
    injected(`tokensRevoked knob is on — rejecting token=${short} as expired`);
    return envelope(TOKEN_EXPIRED_CODE, "Token expired", null);
  }
  if (!issuedTokens.has(parsed.token)) {
    warn("AUTH", `expired — token=${short} was never issued or was revoked`);
    return envelope(TOKEN_EXPIRED_CODE, "Token expired", null);
  }
  return null;
};

const tokenSummary = (request: Request, operation: string): string => {
  const header = request.headers.get("token");
  if (operation.startsWith("control") || operation === "health") return "";
  if (operation.startsWith("login")) {
    return colour.dim(header ? "token=bootstrap" : "token=none");
  }
  if (!header) return colour.yellow("token=none");
  const parsed = (() => {
    try {
      return JSON.parse(header) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (!parsed || typeof parsed.token !== "string") {
    return colour.yellow("token=malformed");
  }
  const short = shortToken(parsed.token);
  const valid = !state.tokensRevoked && issuedTokens.has(parsed.token);
  return valid
    ? colour.green(`token=${short} valid`)
    : colour.yellow(`token=${short} unknown`);
};

const handleControl = async (request: Request): Promise<Response> => {
  if (request.method === "GET") {
    return json({
      state,
      stations: STATIONS.map((s) => ({ id: s.id, name: s.name })),
    });
  }
  const patch = await readJson(request);
  if (!patch) {
    warn("CONTROL", "rejected — body was not a JSON object");
    return json({ error: "expected a JSON object body" }, 400);
  }
  const changes = applyControl(patch);
  if (changes.length === 0) {
    warn("CONTROL", "patch applied nothing — no known knob in the body");
  }
  changes.forEach(({ key, from, to }) =>
    info("CONTROL", `${key}: ${JSON.stringify(from)} -> ${JSON.stringify(to)}`)
  );
  return json({ applied: changes.map((change) => change.key), state });
};

const route = async (request: Request, path: string): Promise<Response> => {
  if (path === "/health") return json({ ok: true });
  if (path === "/control") return await handleControl(request);

  if (request.method !== "POST") {
    return json({ error: "method not allowed" }, 405);
  }

  if (shouldRateLimit()) {
    const remaining = state.rateLimitUntilCleared
      ? "until cleared"
      : `${state.rateLimitRequests} left after this`;
    injected(
      `rate limit knob fired — answering ${RATE_LIMIT_CODE} (${remaining})`,
    );
    return json(rateLimited());
  }

  if (path === "/api/v3/Common/CrossLogin") {
    return await handleLogin(request, "legacy");
  }
  if (path === "/web/sems/sems-user/api/v1/auth/cross-login") {
    return await handleLogin(request, "new");
  }

  if (
    path === "/api/PowerStation/GetPowerStationIdByOwner" ||
    path === "/api/v3/PowerStation/GetMonitorDetailByPowerstationId"
  ) {
    const failure = authFailure(request);
    if (failure) return json(failure);

    if (path === "/api/PowerStation/GetPowerStationIdByOwner") {
      return json(envelope(0, "success", STATIONS.map(stationListEntry)));
    }

    const body = await readJson(request) ?? {};
    const stationId = String(body.powerStationId ?? "");
    const station = findStation(stationId);
    if (!station) {
      warn("DETAIL", `no such station id=${stationId || "(empty)"}`);
      return json(envelope("100002", "Power station not found", null));
    }
    const detail = stationDetail(station);
    logPowerflow(station.id, detail.powerflow as Powerflow | null);
    return json(envelope(0, "success", detail));
  }

  warn("ROUTE", `no such endpoint: ${path}`);
  return json(envelope("404", `No such endpoint: ${path}`, null), 404);
};

const DIRECTIONS: Record<number, string> = {
  1: "import",
  [-1]: "export",
  0: "idle",
};
const BATTERY: Record<number, string> = {
  1: "charging",
  [-1]: "discharging",
  0: "idle",
};

const logPowerflow = (stationId: string, flow: Powerflow | null) => {
  if (flow === null) {
    info("PWRFLOW", `station=${stationId.slice(0, 8)} no powerflow block`);
    return;
  }
  const field = (name: string, value: string | number, width: number) =>
    `${colour.dim(name)}=${String(value).padEnd(width)}`;
  info(
    "PWRFLOW",
    [
      `station=${stationId.slice(0, 8)}`,
      `mode=${state.gridSignMode.padEnd(9)}`,
      field("pv", flow.pv, 10),
      field("load", flow.load, 10),
      field("grid", flow.grid, 10),
      colour.bold(
        `[${DIRECTIONS[flow.loadStatus] ?? "?"}]`.padEnd(8),
      ),
      field("bettery", flow.bettery, 9),
      `[${BATTERY[flow.betteryStatus] ?? "?"}]`.padEnd(13),
      field("soc", flow.soc, 5),
      colour.dim(
        `gridStatus=${flow.gridStatus} loadStatus=${flow.loadStatus}`,
      ),
    ].join(" "),
  );
};

const logResponse = async (response: Response) => {
  if (!isInfo) return;
  const text = await response.clone().text();
  const body = (() => {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  })();
  if (body && "code" in body) {
    const code = String(body.code);
    const ok = SUCCESS_CODES.has(code);
    const message = ok
      ? colour.green(`code=${code}`)
      : colour.red(`code=${code} msg=${String(body.msg)}`);
    info("<-", `${response.status} ${message}`);
  } else {
    info("<-", `${response.status}`);
  }
  if (isDebug) debug("BODY", `response ${redactedJson(body ?? text)}`);
};

const handler = async (request: Request): Promise<Response> => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";
  const operation = operationFor(request.method, path);

  if (isInfo) {
    info(
      "->",
      `${request.method.padEnd(4)} ${path}  ${colour.bold(operation)}  ${
        tokenSummary(request, operation)
      }`,
    );
  }
  const response = await route(request, path);
  await logResponse(response);
  return response;
};

const banner = () => {
  const row = (name: string, value: unknown) =>
    startup(`  ${name.padEnd(24)} ${value}`);

  startup(colour.bold("fake SEMS portal"));
  row("port", PORT);
  row("tls", TLS_ENABLED ? `on (port ${TLS_PORT})` : "off");
  row("logLevel", LOG_LEVEL);
  row("account", ACCOUNT);
  row("password", "(never logged — see README / SEMS_PASSWORD)");
  row("region", REGION);
  startup(colour.bold("  control state"));
  Object.entries(state).forEach(([key, value]) =>
    row(`  ${key}`, JSON.stringify(value))
  );
  startup(colour.bold("  stations"));
  STATIONS.forEach((station) => row(`  ${station.id}`, station.name));
};

banner();
Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);

if (TLS_ENABLED) {
  Deno.serve({
    port: TLS_PORT,
    hostname: "0.0.0.0",
    cert: Deno.readTextFileSync(TLS_CERT),
    key: Deno.readTextFileSync(TLS_KEY),
  }, handler);
}
