import { createHash, randomUUID } from "node:crypto";
import {
  ACCOUNT,
  applyControl,
  LOG_LEVEL,
  PASSWORD,
  PORT,
  REGION,
  state,
} from "./config.ts";
import {
  findStation,
  stationFlow,
  stationListEntry,
  STATIONS,
} from "./stations.ts";

const RATE_LIMIT_CODE = "GY0429";
const TOKEN_EXPIRED_CODE = "100002";
const SUCCESS_CODE = "00000";

const issuedTokens = new Set<string>();

const log = (message: string): void => {
  if (LOG_LEVEL !== "silent") console.log(message);
};

const debug = (message: string): void => {
  if (LOG_LEVEL === "debug") console.log(message);
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const envelope = (code: string, msg: string, data: unknown, api?: string) => ({
  code,
  description: msg,
  traceId: randomUUID().replaceAll("-", ""),
  ...(api === undefined ? {} : { api }),
  data,
});

const ok = (data: unknown, api?: string) =>
  envelope(SUCCESS_CODE, "成功", data, api);

const rateLimited = () =>
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

// The real gateway authenticates every call with an X-Signature header and a
// JSON `token` header carrying the session. Both are required here so the
// plugin's auth path is genuinely exercised.
const authFailure = (req: Request): Response | null => {
  const raw = req.headers.get("token");
  if (raw === null) {
    debug("  no token header");
    return json(envelope(TOKEN_EXPIRED_CODE, "token missing", null));
  }
  if (req.headers.get("x-signature") === null) {
    debug("  no X-Signature header");
    return json(envelope(TOKEN_EXPIRED_CODE, "signature missing", null));
  }
  const parsed = JSON.parse(raw) as { token?: string };
  const token = parsed.token ?? "";
  if (state.tokensRevoked || !issuedTokens.has(token)) {
    debug(`  token not recognised (${token.slice(0, 8)}…)`);
    return json(envelope(TOKEN_EXPIRED_CODE, "token expired", null));
  }
  return null;
};

// The real gateway mints a usable token only for a semsPlusWeb login; a plain
// cross-login is answered C0602 and every later call fails. Enforced here so an
// unsigned login cannot pass the fake while failing in production.
const loginAuthFailure = (req: Request): Response | null => {
  const raw = req.headers.get("token");
  if (raw === null || req.headers.get("x-signature") === null) {
    log("  login missing the semsPlusWeb bootstrap headers");
    return json(envelope("C0602", "account_login_abnormal", null));
  }
  const client = ((): unknown => {
    try {
      return (JSON.parse(raw) as { client?: string }).client;
    } catch {
      return undefined;
    }
  })();
  if (client !== "semsPlusWeb") {
    log(`  login carried a non-web client identity (${client ?? "none"})`);
    return json(envelope("C0602", "account_login_abnormal", null));
  }
  return null;
};

const handleLogin = async (req: Request): Promise<Response> => {
  const failure = loginAuthFailure(req);
  if (failure !== null) return failure;
  const body = await req.json().catch(() => ({})) as {
    account?: string;
    pwd?: string;
  };
  if (state.rejectLogin) {
    log("  login rejected (REJECT_LOGIN)");
    return json(envelope("100005", "Account or password error", null));
  }
  const expected = md5Base64(PASSWORD);
  if (body.account !== ACCOUNT || body.pwd !== expected) {
    log(`  login rejected — bad credentials for ${body.account ?? "(none)"}`);
    return json(envelope("100005", "Account or password error", null));
  }
  const token = randomUUID();
  // A token issued while expireNextToken is set is never accepted, which
  // drives the plugin's stale-token retry.
  if (state.expireNextToken) {
    state.expireNextToken = false;
    log("  issued a pre-expired token (EXPIRE_NEXT_TOKEN)");
  } else {
    issuedTokens.add(token);
  }
  const api = `https://${REGION}-gateway.semsportal.com/web/sems`;
  log(`  login ok — token ${token.slice(0, 8)}…`);
  return json(ok({ token, uid: randomUUID(), timestamp: Date.now() }, api));
};

const handleFlow = (req: Request, url: URL): Response => {
  const failure = authFailure(req);
  if (failure !== null) return failure;
  const stationId = url.searchParams.get("stationId") ?? "";
  const station = findStation(stationId);
  if (station === undefined) {
    log(`  unknown station ${stationId}`);
    return json(ok({}));
  }
  // An un-migrated station answers 200 with nothing usable in it.
  if (state.emptyFlow) {
    log("  serving an empty flow (EMPTY_FLOW)");
    return json(ok({ id: stationId, name: station.name }));
  }
  const flow = stationFlow(station);
  debug(`  flow ${JSON.stringify(flow)}`);
  return json(ok(flow));
};

const handleStationList = (req: Request): Response => {
  const failure = authFailure(req);
  if (failure !== null) return failure;
  return json(ok({
    dataList: STATIONS.map(stationListEntry),
    total: STATIONS.length,
    current: 1,
    size: 100,
  }));
};

const handleControl = async (req: Request): Promise<Response> => {
  if (req.method === "GET") return json(state);
  const patch = await req.json().catch(() => ({})) as Record<string, unknown>;
  const changes = applyControl(patch);
  changes.forEach((c) => log(`  control ${c.key}: ${c.from} → ${c.to}`));
  return json(state);
};

const handler = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  log(`${req.method} ${url.pathname}${url.search}`);

  if (url.pathname === "/health") return json({ status: "ok" });
  if (url.pathname === "/control") return await handleControl(req);

  if (shouldRateLimit()) {
    log("  rate limited (GY0429)");
    return json(rateLimited());
  }

  if (url.pathname.endsWith("/sems-user/api/v1/auth/cross-login")) {
    return await handleLogin(req);
  }
  if (url.pathname.endsWith("/sems-plant/api/stations/flow")) {
    return handleFlow(req, url);
  }
  if (url.pathname.endsWith("/sems-plant/api/stations/simple-query")) {
    return handleStationList(req);
  }
  return json({ code: "404", description: "not found", data: null }, 404);
};

if (import.meta.main) {
  console.log(
    `SEMS+ simulator on http://localhost:${PORT} — account ${ACCOUNT}, ` +
      `password ${PASSWORD}, ${STATIONS.length} stations`,
  );
  console.log(
    `Point ChargeHA at it with GOODWE_SEMS_PLUS_BASE_URL=http://localhost:${PORT}`,
  );
  Deno.serve({ port: PORT, hostname: "0.0.0.0" }, handler);
}
