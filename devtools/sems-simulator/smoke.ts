/** Smoke test for the fake SEMS portal.
 *
 *  Speaks the same wire protocol as ChargeHA's GoodweSemsClient, including its
 *  api-base rewrite rules, so a pass here means the real client would work too.
 *
 *  Run:  deno run --allow-net --allow-env smoke.ts [baseUrl]
 *  Env:  SMOKE_BASE, SMOKE_ACCOUNT, SMOKE_PASSWORD,
 *        SMOKE_GATEWAY=1  also run the gateway-mode rewrite checks
 *        SMOKE_REGION_BASE  where https://<region>.semsportal.com actually
 *                           resolves to (default https://<region>.semsportal.com)
 */
import { createHash } from "node:crypto";

const BASE = (Deno.args[0] ?? Deno.env.get("SMOKE_BASE") ??
  "http://localhost:8099").replace(/\/$/, "");
const ACCOUNT = Deno.env.get("SMOKE_ACCOUNT") ?? "tester@example.com";
const PASSWORD = Deno.env.get("SMOKE_PASSWORD") ?? "fake-password-123";
const REGION = Deno.env.get("SMOKE_REGION") ?? "eu";
const RUN_GATEWAY = Deno.env.get("SMOKE_GATEWAY") === "1";
const REGION_BASE = Deno.env.get("SMOKE_REGION_BASE") ??
  `https://${REGION}.semsportal.com/api`;

const SUCCESS = new Set(["0", "00000"]);
const BOOTSTRAP = '{"version":"3.1.1","client":"ios","language":"en"}';
const DT_STATION = "11111111-1111-4111-8111-111111111111";
const BATTERY_STATION = "22222222-2222-4222-8222-222222222222";
const NO_HOMEKIT_STATION = "44444444-4444-4444-8444-444444444444";

type Json = Record<string, unknown>;

const results: { name: string; ok: boolean; detail: string }[] = [];

const check = (name: string, ok: boolean, detail = "") => {
  results.push({ name, ok, detail });
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`,
  );
};

const post = async (
  url: string,
  body: Json | null,
  headers: Record<string, string>,
): Promise<Json> => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === null ? undefined : JSON.stringify(body),
  });
  return await response.json() as Json;
};

const control = async (patch: Json): Promise<void> => {
  await fetch(`${BASE}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
};

const semsPlusPwd = (password: string): string =>
  btoa(createHash("md5").update(password).digest("hex"));

const legacyLogin = (): Promise<Json> =>
  post(`${BASE}/api/v3/Common/CrossLogin`, {
    account: ACCOUNT,
    pwd: PASSWORD,
  }, { token: BOOTSTRAP, Accept: "application/json" });

const newLogin = (): Promise<Json> =>
  post(`${BASE}/web/sems/sems-user/api/v1/auth/cross-login`, {
    account: ACCOUNT,
    pwd: semsPlusPwd(PASSWORD),
    agreement: 1,
    isChinese: false,
    isLocal: false,
  }, { Accept: "application/json, */*;q=0.5" });

/** The client's own rule: PowerStation routes are pulled off a gateway base
 *  and onto the regional portal host. Mirrored here so gateway mode is really
 *  exercised rather than assumed. */
const extractRegion = (base: string): string | null => {
  const host = base.split("//").at(-1)?.split("/")[0] ?? "";
  if (host.endsWith("-gateway.semsportal.com")) {
    return host.replace("-gateway.semsportal.com", "") || null;
  }
  if (host.endsWith(".semsportal.com")) return host.split(".")[0] || null;
  return null;
};

const resolveApiBase = (token: Json, path: string): string => {
  const base = String(token.api).replace(/\/$/, "");
  const isStationRoute = path.startsWith("/PowerStation") ||
    path.startsWith("/v3/PowerStation");
  if (!isStationRoute) return base;
  if (!base.includes("/web/sems") && !base.includes("/sems/")) return base;
  const region = typeof token.region === "string" && token.region
    ? token.region
    : extractRegion(base);
  // The rewritten host is redirected at the fake so the branch is testable.
  return region ? REGION_BASE : "https://eu.semsportal.com/api";
};

/** Turn a login envelope into the token payload the client would keep. */
const tokenFrom = (envelope: Json, fallbackApi?: string): Json | null => {
  if (!SUCCESS.has(String(envelope.code ?? ""))) return null;
  const data = envelope.data as Json | null;
  if (!data || typeof data.token !== "string") return null;
  const api = envelope.api ?? data.api ?? fallbackApi;
  if (typeof api !== "string") return null;
  return { ...data, api };
};

const authed = (
  token: Json,
  path: string,
  body: Json | null,
): Promise<Json> =>
  post(resolveApiBase(token, path) + path, body, {
    Accept: "application/json",
    token: JSON.stringify(token),
  });

const STATION_LIST = "/PowerStation/GetPowerStationIdByOwner";
const STATION_DETAIL = "/v3/PowerStation/GetMonitorDetailByPowerstationId";

const isWattString = (value: unknown): boolean =>
  typeof value === "string" && /^-?\d+\(W\)$/.test(value);

const wattValue = (value: unknown): number =>
  Number(String(value).replace("(W)", ""));

const run = async () => {
  await control({
    apiBaseMode: "direct",
    rateLimitRequests: 0,
    rateLimitUntilCleared: false,
    expireNextToken: false,
    tokensRevoked: false,
    rejectLogin: false,
    gridSignMode: "signed",
    hourOverride: 12,
  });

  // --- login, both modes -------------------------------------------------
  const legacyEnvelope = await legacyLogin();
  const legacyToken = tokenFrom(legacyEnvelope);
  check(
    "legacy login returns a token and api base",
    legacyToken !== null,
    `code=${legacyEnvelope.code} api=${legacyEnvelope.api}`,
  );

  const newEnvelope = await newLogin();
  const newToken = tokenFrom(newEnvelope);
  check(
    "SEMS+ login returns a token and api base",
    newToken !== null,
    `code=${newEnvelope.code}`,
  );

  const badLogin = await post(`${BASE}/api/v3/Common/CrossLogin`, {
    account: ACCOUNT,
    pwd: "wrong-password",
  }, { token: BOOTSTRAP });
  check(
    "wrong password is rejected",
    !SUCCESS.has(String(badLogin.code)),
    `code=${badLogin.code}`,
  );

  if (!newToken) {
    check("cannot continue without a token", false);
    return;
  }
  const token = newToken;

  // --- station list ------------------------------------------------------
  const list = await authed(token, STATION_LIST, null);
  const stations = list.data as Json[];
  check(
    "station list returns the seeded stations",
    SUCCESS.has(String(list.code)) && Array.isArray(stations) &&
      stations.length === 4,
    `count=${Array.isArray(stations) ? stations.length : "n/a"}`,
  );

  // --- station detail: 3-phase, no battery -------------------------------
  const detail = await authed(token, STATION_DETAIL, {
    powerStationId: DT_STATION,
  });
  const data = detail.data as Json;
  const flow = data?.powerflow as Json;
  check(
    "station detail has hasPowerflow, powerflow, info, inverter, kpi, homeKit",
    data?.hasPowerflow === true && !!flow && !!data.info && !!data.inverter &&
      !!data.kpi && !!data.homeKit,
  );
  check(
    "power values are unit-suffixed strings",
    isWattString(flow?.pv) && isWattString(flow?.load) &&
      isWattString(flow?.grid) && isWattString(flow?.bettery),
    `pv=${flow?.pv} load=${flow?.load} grid=${flow?.grid}`,
  );
  check(
    "battery keys use the SEMS misspelling",
    "bettery" in flow && "betteryStatus" in flow,
  );
  check(
    "status fields are -1/0/1",
    [-1, 0, 1].includes(Number(flow?.gridStatus)) &&
      [-1, 0, 1].includes(Number(flow?.loadStatus)) &&
      [-1, 0, 1].includes(Number(flow?.betteryStatus)),
    `gridStatus=${flow?.gridStatus} loadStatus=${flow?.loadStatus}`,
  );
  check(
    "inverter model is the GW10KAU-DT profile",
    (data.inverter as Json[])[0]?.invert_full !== undefined &&
      ((data.inverter as Json[])[0].invert_full as Json).model_type ===
        "GW10KAU-DT",
  );
  check(
    "kpi carries total_power",
    typeof (data.kpi as Json)?.total_power === "number",
  );

  // --- solar curve moves over the day ------------------------------------
  await control({ hourOverride: 0 });
  const night = await authed(token, STATION_DETAIL, {
    powerStationId: DT_STATION,
  });
  const nightPv = wattValue(((night.data as Json).powerflow as Json).pv);
  await control({ hourOverride: 12 });
  const noon = await authed(token, STATION_DETAIL, {
    powerStationId: DT_STATION,
  });
  const noonPv = wattValue(((noon.data as Json).powerflow as Json).pv);
  check(
    "pv follows a daily curve (midnight 0, midday high)",
    nightPv === 0 && noonPv > 1000,
    `midnight=${nightPv}W midday=${noonPv}W`,
  );

  // --- grid sign convention ----------------------------------------------
  await control({ gridSignMode: "signed", hourOverride: 12 });
  const signed = ((await authed(token, STATION_DETAIL, {
    powerStationId: DT_STATION,
  })).data as Json).powerflow as Json;
  await control({ gridSignMode: "magnitude" });
  const magnitude = ((await authed(token, STATION_DETAIL, {
    powerStationId: DT_STATION,
  })).data as Json).powerflow as Json;
  // Real SEMS marks direction with loadStatus (-1 = exporting) and reports
  // gridStatus as its inverse, so exporting is gridStatus 1 / loadStatus -1.
  check(
    "signed mode exports a negative grid value at midday",
    wattValue(signed.grid) < 0 && Number(signed.loadStatus) === -1,
    `grid=${signed.grid} loadStatus=${signed.loadStatus}`,
  );
  check(
    "magnitude mode keeps grid non-negative with the direction in loadStatus",
    wattValue(magnitude.grid) >= 0 && Number(magnitude.loadStatus) === -1 &&
      Number(magnitude.gridStatus) === 1 &&
      wattValue(magnitude.grid) === Math.abs(wattValue(signed.grid)),
    `grid=${magnitude.grid} gridStatus=${magnitude.gridStatus} loadStatus=${magnitude.loadStatus}`,
  );
  await control({ gridSignMode: "signed" });

  // --- battery station ---------------------------------------------------
  await control({ hourOverride: 10 });
  const battery = ((await authed(token, STATION_DETAIL, {
    powerStationId: BATTERY_STATION,
  })).data as Json).powerflow as Json;
  check(
    "battery station charges mid-morning with a real soc",
    Number(battery.betteryStatus) === 1 && wattValue(battery.bettery) > 0 &&
      /^\d+%$/.test(String(battery.soc)),
    `bettery=${battery.bettery} status=${battery.betteryStatus} soc=${battery.soc}`,
  );

  // --- station with no HomeKit -------------------------------------------
  const noKit = (await authed(token, STATION_DETAIL, {
    powerStationId: NO_HOMEKIT_STATION,
  })).data as Json;
  check(
    "no-HomeKit station reports hasPowerflow false and no powerflow",
    noKit.hasPowerflow === false && noKit.powerflow === null,
  );

  // --- rate limiting ------------------------------------------------------
  await control({ rateLimitRequests: 2 });
  const first = await authed(token, STATION_LIST, null);
  const second = await authed(token, STATION_LIST, null);
  const third = await authed(token, STATION_LIST, null);
  check(
    "rate limit returns GY0429 for exactly N requests then recovers",
    first.code === "GY0429" && second.code === "GY0429" &&
      SUCCESS.has(String(third.code)),
    `${first.code}, ${second.code}, ${third.code}`,
  );

  await control({ rateLimitUntilCleared: true });
  const sticky = await authed(token, STATION_LIST, null);
  await control({ rateLimitUntilCleared: false });
  const recovered = await authed(token, STATION_LIST, null);
  check(
    "sticky rate limit holds until cleared",
    sticky.code === "GY0429" && SUCCESS.has(String(recovered.code)),
    `${sticky.code} then ${recovered.code}`,
  );

  // --- token expiry -------------------------------------------------------
  await control({ expireNextToken: true });
  const stale = await authed(token, STATION_LIST, null);
  check(
    "forced expiry makes the next authenticated call fail",
    !SUCCESS.has(String(stale.code)),
    `code=${stale.code} msg=${stale.msg}`,
  );
  const reloginToken = tokenFrom(await newLogin());
  const afterRelogin = reloginToken
    ? await authed(reloginToken, STATION_LIST, null)
    : { code: "no-token" };
  check(
    "re-login recovers after a forced expiry",
    SUCCESS.has(String(afterRelogin.code)),
    `code=${afterRelogin.code}`,
  );

  const garbage = await post(`${BASE}/api${STATION_LIST}`, null, {
    token: '{"token":"not-a-real-token","api":"x"}',
  });
  check(
    "an unknown token is rejected",
    !SUCCESS.has(String(garbage.code)),
    `code=${garbage.code}`,
  );

  // --- api base modes -----------------------------------------------------
  await control({ apiBaseMode: "missing" });
  const missingEnvelope = await newLogin();
  const missingData = missingEnvelope.data as Json;
  check(
    "missing mode omits api so the client uses its hardcoded fallback",
    SUCCESS.has(String(missingEnvelope.code)) &&
      missingEnvelope.api === undefined && missingData.api === undefined,
  );

  await control({ apiBaseMode: "gateway" });
  const gatewayEnvelope = await newLogin();
  const gatewayToken = tokenFrom(gatewayEnvelope);
  check(
    "gateway mode advertises a -gateway.semsportal.com/web/sems base",
    String(gatewayEnvelope.api).includes("-gateway.semsportal.com/web/sems"),
    String(gatewayEnvelope.api),
  );
  check(
    "the client's rewrite turns that gateway base into a regional portal base",
    gatewayToken !== null &&
      resolveApiBase(gatewayToken, STATION_DETAIL) === REGION_BASE,
    `${gatewayToken ? resolveApiBase(gatewayToken, STATION_DETAIL) : "n/a"}`,
  );

  await control({ apiBaseMode: "gateway-with-region" });
  const regionToken = tokenFrom(await newLogin());
  check(
    "gateway-with-region puts an explicit region in the token payload",
    regionToken?.region === REGION,
    `region=${regionToken?.region}`,
  );

  if (RUN_GATEWAY && gatewayToken) {
    // Only meaningful where <region>.semsportal.com resolves to the fake
    // (docker-compose sets a network alias for exactly this).
    const viaGateway = await authed(gatewayToken, STATION_DETAIL, {
      powerStationId: DT_STATION,
    });
    check(
      "PowerStation call succeeds over the rewritten gateway base",
      SUCCESS.has(String(viaGateway.code)),
      `${REGION_BASE} code=${viaGateway.code}`,
    );
    const viaRegion = regionToken
      ? await authed(regionToken, STATION_LIST, null)
      : { code: "no-token" };
    check(
      "PowerStation call succeeds using the explicit token region",
      SUCCESS.has(String(viaRegion.code)),
      `code=${viaRegion.code}`,
    );
  } else {
    console.log(
      "NOTE  gateway end-to-end checks skipped (set SMOKE_GATEWAY=1 and point " +
        `${REGION}.semsportal.com at the fake — see README)`,
    );
  }

  await control({ apiBaseMode: "direct" });

  // --- login rejection ----------------------------------------------------
  await control({ rejectLogin: true });
  const rejected = await newLogin();
  await control({ rejectLogin: false });
  check(
    "rejectLogin knob makes logins fail",
    !SUCCESS.has(String(rejected.code)),
    `code=${rejected.code}`,
  );

  await control({ hourOverride: null });
};

await run();

const failed = results.filter((result) => !result.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} checks passed`,
);
if (failed.length > 0) {
  console.log(`failed: ${failed.map((f) => f.name).join("; ")}`);
  Deno.exit(1);
}
