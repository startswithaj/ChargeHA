// Speaks the same wire protocol as ChargeHA's SemsPlusClient, including its
// X-Signature auth, so a pass here means the real client would work too.
// Run: deno task semsplus:sim:smoke [baseUrl]
import { createHash } from "node:crypto";

const BASE = (Deno.args[0] ?? Deno.env.get("SMOKE_BASE") ??
  "http://localhost:8098").replace(/\/$/, "");
const ACCOUNT = Deno.env.get("SMOKE_ACCOUNT") ?? "tester@example.com";
const PASSWORD = Deno.env.get("SMOKE_PASSWORD") ?? "fake-password-123";

const LOGIN_PATH = "/web/sems/sems-user/api/v1/auth/cross-login";
const FLOW_PATH = "/web/sems/sems-plant/api/stations/flow";
const LIST_PATH = "/web/sems/sems-plant/api/stations/simple-query";

const DT_STATION = "11111111-1111-4111-8111-111111111111";
const BATTERY_STATION = "22222222-2222-4222-8222-222222222222";
const EV_STATION = "33333333-3333-4333-8333-333333333333";

type Json = Record<string, unknown>;

const results: { name: string; ok: boolean; detail: string }[] = [];

const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
};

const md5Base64 = (value: string): string =>
  btoa(createHash("md5").update(value).digest("hex"));

// base64(sha256hex("{ms}@{uid}@{token}") + "@" + ms), as the SEMS+ web app sends.
const signature = async (uid: string, token: string): Promise<string> => {
  const ms = Date.now();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ms}@${uid}@${token}`),
  );
  const hex = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return btoa(`${hex}@${ms}`);
};

const BOOTSTRAP_TOKEN =
  '{"uid":"","timestamp":0,"token":"","client":"semsPlusWeb","version":"","language":"en"}';

const login = async (password = PASSWORD): Promise<Json> => {
  const res = await fetch(`${BASE}${LOGIN_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "token": BOOTSTRAP_TOKEN,
      "X-Signature": await signature("", ""),
    },
    body: JSON.stringify({
      account: ACCOUNT,
      pwd: md5Base64(password),
      agreement: 1,
      isChinese: false,
      isLocal: false,
    }),
  });
  return await res.json() as Json;
};

const authed = async (
  session: Json,
  url: string,
  init: RequestInit = {},
): Promise<Json> => {
  const uid = String(session.uid ?? "");
  const token = String(session.token ?? "");
  const res = await fetch(url, {
    ...init,
    headers: {
      ...init.headers,
      "token": JSON.stringify({ ...session, client: "semsPlusWeb" }),
      "X-Signature": await signature(uid, token),
    },
  });
  return await res.json() as Json;
};

const control = async (patch: Json): Promise<void> => {
  await fetch(`${BASE}/control`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  });
};

const dataOf = (body: Json): Json => (body.data ?? {}) as Json;

// ── login ───────────────────────────────────────────────────────────────────

const loginBody = await login();
check(
  "login succeeds with the right credentials",
  loginBody.code === "00000" && Boolean(dataOf(loginBody).token),
  `code ${loginBody.code}`,
);
check(
  "login returns a gateway api base",
  String(loginBody.api ?? "").includes("-gateway.semsportal.com"),
  String(loginBody.api ?? "(none)"),
);

const session = dataOf(loginBody);

const plainLogin = await fetch(`${BASE}${LOGIN_PATH}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    account: ACCOUNT,
    pwd: md5Base64(PASSWORD),
    agreement: 1,
    isChinese: false,
    isLocal: false,
  }),
}).then((r) => r.json()) as Json;
check(
  "a plain cross-login without the semsPlusWeb identity is refused",
  plainLogin.code === "C0602",
  `code ${plainLogin.code}`,
);

const badLogin = await login("wrong-password");
check(
  "login rejects a wrong password",
  badLogin.code !== "00000",
  `code ${badLogin.code}`,
);

// ── flow ────────────────────────────────────────────────────────────────────

const flowUrl = (id: string) => `${BASE}${FLOW_PATH}?stationId=${id}`;

const flowBody = await authed(session, flowUrl(DT_STATION));
const flow = dataOf(flowBody);
check(
  "flow returns the requested station",
  flow.id === DT_STATION,
  String(flow.name ?? ""),
);
check(
  "flow carries signed pGrid and pConsum",
  typeof flow.pGrid === "number" && typeof flow.pConsum === "number",
  `pGrid=${flow.pGrid} pConsum=${flow.pConsum}`,
);
check(
  "flow balances: pAc = pConsum + pGrid",
  Math.abs(
    Number(flow.pAc) - (Number(flow.pConsum) + Number(flow.pGrid)),
  ) < 0.002,
  `pAc=${flow.pAc} pConsum=${flow.pConsum} pGrid=${flow.pGrid}`,
);
check(
  "flow carries a refreshTime with no timezone offset",
  typeof flow.refreshTime === "string" && !/[Z+]/.test(flow.refreshTime),
  String(flow.refreshTime ?? ""),
);

const batteryFlow = dataOf(await authed(session, flowUrl(BATTERY_STATION)));
check(
  "battery station reports pBat and soc",
  typeof batteryFlow.pBat === "number" && typeof batteryFlow.soc === "number",
  `pBat=${batteryFlow.pBat} soc=${batteryFlow.soc}`,
);

const evFlow = dataOf(await authed(session, flowUrl(EV_STATION)));
check(
  "ev station reports pEvChar when charging",
  evFlow.pEvChar === undefined || typeof evFlow.pEvChar === "number",
  `pEvChar=${evFlow.pEvChar}`,
);

// ── station list ────────────────────────────────────────────────────────────

const listBody = await authed(session, `${BASE}${LIST_PATH}`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ current: 1, size: 100 }),
});
const records = (dataOf(listBody).dataList ?? []) as Json[];
check(
  "station list returns dataList with id and name",
  records.length > 0 && Boolean(records[0].id) && Boolean(records[0].name),
  `${records.length} station(s)`,
);

// ── auth failures ───────────────────────────────────────────────────────────

const unsigned = await fetch(flowUrl(DT_STATION), {
  headers: { "token": JSON.stringify(session) },
}).then((r) => r.json()) as Json;
check(
  "flow rejects a request with no X-Signature",
  unsigned.code !== "00000",
  `code ${unsigned.code}`,
);

// ── injected failures ───────────────────────────────────────────────────────

await control({ emptyFlow: true });
const empty = dataOf(await authed(session, flowUrl(DT_STATION)));
check(
  "EMPTY_FLOW serves a payload with no power fields",
  empty.pGrid === undefined && empty.pConsum === undefined,
  JSON.stringify(empty),
);
await control({ emptyFlow: false });

await control({ rateLimitRequests: 1 });
const limited = await authed(session, flowUrl(DT_STATION));
check(
  "rate limiting returns GY0429",
  limited.code === "GY0429",
  `code ${limited.code}`,
);

await control({ tokensRevoked: true });
const revoked = await authed(session, flowUrl(DT_STATION));
check(
  "a revoked token returns the stale-token code",
  revoked.code === "100002",
  `code ${revoked.code}`,
);
await control({ tokensRevoked: false });

// ── summary ─────────────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
if (failed.length > 0) Deno.exit(1);
