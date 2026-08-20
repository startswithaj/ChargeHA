# SEMS Simulator

A standalone fake of the GoodWe SEMS Portal cloud API.

It shares no code with ChargeHA and imports nothing from it — it just speaks the
same wire protocol. It is not a workspace member, so it never reaches the app's
module graph.

## Why it exists

ChargeHA has a GoodWe SEMS energy plugin that talks to GoodWe's undocumented
cloud API. There is no SEMS account to test against, so this fake exists to:

- **Settle the grid sign convention.** SEMS is ambiguous about whether
  `powerflow.grid` already carries a sign, or is a magnitude whose direction
  lives in `gridStatus`. The fake serves both, so the plugin can be tested
  against each.
- **Exercise failure paths on demand** — rate limiting (`GY0429`) and token
  expiry, both of which are otherwise almost impossible to trigger deliberately.
- **Run the plugin end to end** without touching GoodWe's servers.

## Running it

Directly (needs Deno 2.x):

```
deno task sems:sim          # listens on http://localhost:8099
```

In a container:

```
docker compose up -d     # publishes 8099, also serves TLS on 443 internally
docker compose down
```

Seeded credentials (deliberately fake):

```
account   tester@example.com
password  fake-password-123
```

## Smoke test

The smoke test speaks the protocol the way ChargeHA's `GoodweSemsClient` does,
including its API-base rewrite rules, and prints PASS/FAIL per check.

Against a locally running server:

```
deno task sems:sim:smoke                       # defaults to http://localhost:8099
deno run --allow-net --allow-env devtools/sems-simulator/smoke.ts http://somewhere-else:8099
```

Against the container, including the gateway-rewrite checks:

```
docker compose --profile smoke run --rm smoke
```

Exit code is non-zero if any check fails.

## Endpoints

All are `POST` and all return the SEMS envelope
`{"code": ..., "msg": ..., "data": ..., "api": ...}`. Success codes are `0`,
`"0"` and `"00000"`; the rate-limit code is `"GY0429"`.

| Path                                                    | Body                                            | Notes                                                                            |
| ------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| `/api/v3/Common/CrossLogin`                             | `{account, pwd}`                                | Legacy login. Expects the bootstrap `token` header. `pwd` is the plain password. |
| `/web/sems/sems-user/api/v1/auth/cross-login`           | `{account, pwd, agreement, isChinese, isLocal}` | SEMS+ login. `pwd` is `base64(hex(md5(password)))`.                              |
| `/api/PowerStation/GetPowerStationIdByOwner`            | _(none)_                                        | Station list. The real client sends no body at all.                              |
| `/api/v3/PowerStation/GetMonitorDetailByPowerstationId` | `{powerStationId}`                              | Station detail.                                                                  |

Both logins return the token payload in `data` and a regional base URL in `api`.
Authenticated calls must send the `token` header set to that `data` payload,
JSON-stringified verbatim; the fake validates it.

Two non-protocol helpers: `GET /health` and `GET|POST /control`.

### Station detail shape

`data` carries `hasPowerflow`, `powerflow`, `homeKit.sn`, `info.stationname`,
`inverter[].invert_full.{model_type,name,sn}` and `kpi.total_power`.

Power values in `powerflow` are **strings with a unit suffix** — `"1234(W)"`,
not `1234`. Status fields (`gridStatus`, `loadStatus`, `betteryStatus`) are
`-1`, `0` or `1`. The battery keys really are spelled `bettery` and
`betteryStatus`; that misspelling is reproduced deliberately because it is what
the real API sends.

Sign conventions used by the fake:

- `gridStatus` — `1` importing, `-1` exporting, `0` idle.
- `loadStatus` — `1` consuming, `0` idle.
- `betteryStatus` — `1` charging, `-1` discharging, `0` idle.

## Control knobs

Every knob has an environment variable (read at startup) and can be changed at
runtime by posting a partial patch to `/control`. `GET /control` shows the
current state and the station list.

| Knob                     | Env var                                  | Values                                                | Default                                    |
| ------------------------ | ---------------------------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Grid sign mode           | `GRID_SIGN_MODE`                         | `signed`, `magnitude`                                 | `signed`                                   |
| API base mode            | `API_BASE_MODE`                          | `direct`, `gateway`, `gateway-with-region`, `missing` | `direct`                                   |
| Direct-mode base URL     | `PUBLIC_BASE`                            | any URL                                               | `http://localhost:8099/api`                |
| Rate limit next N        | `RATE_LIMIT_REQUESTS`                    | integer                                               | `0`                                        |
| Rate limit until cleared | `RATE_LIMIT_UNTIL_CLEARED`               | `1`/`0`                                               | `0`                                        |
| Expire next token        | `EXPIRE_NEXT_TOKEN`                      | `1`/`0`                                               | `0`                                        |
| Revoke all tokens        | _(runtime only)_                         | `true`/`false`                                        | `false`                                    |
| Time of day              | `HOUR_OVERRIDE`                          | `0`–`23.99`, or `null` for real time                  | real time                                  |
| Reject logins            | `REJECT_LOGIN`                           | `1`/`0`                                               | `0`                                        |
| Account / password       | `SEMS_ACCOUNT`, `SEMS_PASSWORD`          |                                                       | `tester@example.com` / `fake-password-123` |
| Region label             | `SEMS_REGION`                            | e.g. `eu`, `au`                                       | `eu`                                       |
| Log level                | `LOG_LEVEL`                              | `silent`, `info`, `debug`                             | `info`                                     |
| Port                     | `PORT`                                   |                                                       | `8099`                                     |
| TLS listener             | `TLS`, `TLS_PORT`, `TLS_CERT`, `TLS_KEY` |                                                       | off, `443`                                 |

### Grid sign mode

The question this fake exists to answer.

```bash
# grid carries its own sign: negative means exporting
curl -s localhost:8099/control -d '{"gridSignMode":"signed"}'
#  "grid": "-8453(W)",  "gridStatus": -1

# grid is a magnitude; only gridStatus says which way it flows
curl -s localhost:8099/control -d '{"gridSignMode":"magnitude"}'
#  "grid": "8453(W)",   "gridStatus": -1
```

Point the plugin at the fake, flip the knob, and see which mode makes its
import/export readings come out right.

### Rate limiting

```bash
curl -s localhost:8099/control -d '{"rateLimitRequests":3}'          # next 3 -> GY0429
curl -s localhost:8099/control -d '{"rateLimitUntilCleared":true}'   # every request
curl -s localhost:8099/control -d '{"rateLimitUntilCleared":false}'  # back to normal
```

Rate limiting sits in front of every endpoint, logins included.

### Token expiry

```bash
curl -s localhost:8099/control -d '{"expireNextToken":true}'   # one-shot
curl -s localhost:8099/control -d '{"tokensRevoked":true}'     # until cleared
```

`expireNextToken` fails exactly one authenticated call with code `100002` and
then clears itself, which is what drives the client's re-login-and-retry path.

### Time of day

```bash
curl -s localhost:8099/control -d '{"hourOverride":12}'    # solar noon
curl -s localhost:8099/control -d '{"hourOverride":2}'     # night, pv = 0
curl -s localhost:8099/control -d '{"hourOverride":null}'  # follow the real clock
```

PV output follows a half-sine daylight curve from 06:00 to 18:00 with a little
cloud noise; household load has morning and evening peaks; the battery station
charges on surplus and discharges after dark. Values move between polls rather
than being constants.

### API base mode

Controls what the login responses advertise as the API base, which decides
whether the client's host-rewrite logic runs.

- `direct` — login returns `PUBLIC_BASE` (no `/web/sems` in it), so no rewrite
  happens. The simple happy path.
- `gateway` — login returns `https://<region>-gateway.semsportal.com/web/sems`.
  The client parses the region out of the host and rewrites PowerStation calls
  to `https://<region>.semsportal.com/api`.
- `gateway-with-region` — same base, but the token payload also carries an
  explicit `region` field, which the client prefers over parsing the host.
- `missing` — the SEMS+ login omits `api` entirely, so the client falls back to
  its hardcoded `https://eu-gateway.semsportal.com/web/sems` (and then rewrites
  that). A legacy login in this mode is expected to fail — the legacy path has
  no fallback.

The rewrite always produces `https://<region>.semsportal.com`, so exercising it
for real needs both DNS and TLS. `docker-compose.yml` sets that up: the fake
answers to the network aliases `eu.semsportal.com`, `au.semsportal.com`,
`us.semsportal.com`, `eu-gateway.semsportal.com`, `www.semsportal.com` and
`semsplus.goodwe.com`, and serves TLS on 443 using a throwaway CA baked into the
image. Clients on that network trust it with `DENO_CERT=/certs/ca.crt`.

```bash
curl -s localhost:8099/control -d '{"apiBaseMode":"gateway"}'
docker compose --profile smoke run --rm smoke
```

Outside Docker the same effect needs a hosts entry pointing `eu.semsportal.com`
at the machine running the fake, the fake listening on 443 with `TLS=1`, and the
CA trusted by the client.

### Station profiles

Four are seeded; the list endpoint returns all of them.

| Station id                             | Profile                                                                  |
| -------------------------------------- | ------------------------------------------------------------------------ |
| `11111111-1111-4111-8111-111111111111` | 3-phase, no battery, GoodWe `GW10KAU-DT` + HomeKit — the target hardware |
| `22222222-2222-4222-8222-222222222222` | Hybrid `GW8K-ET` with a 13.5 kWh battery and moving SOC                  |
| `33333333-3333-4333-8333-333333333333` | Multi-inverter site, three inverters                                     |
| `44444444-4444-4444-8444-444444444444` | `hasPowerflow: false`, no HomeKit fitted, `powerflow` is null            |

## Logging

`LOG_LEVEL` is read at startup only — it is not patchable through `/control`.

| Level    | Output                                                         |
| -------- | -------------------------------------------------------------- |
| `silent` | startup banner and hard errors only                            |
| `info`   | one line per request and per response, plus the powerflow line |
| `debug`  | everything in `info`, plus full request and response bodies    |

```bash
LOG_LEVEL=debug deno task sems:sim
LOG_LEVEL=silent deno task sems:sim
```

Each line is `HH:MM:SS.mmm  TAG  message`. Tags:

- `->` / `<-` — the request (method, path, which SEMS operation it maps to, auth
  state) and its response (HTTP status, envelope `code`, and `msg` when the code
  is not a success code).
- `AUTH` — logins accepted or rejected, and authenticated calls turned away.
  Unauthenticated (no or malformed `token` header) and expired (a token that was
  never issued or has been revoked) are reported as different things.
- `PWRFLOW` — the powerflow values actually served for a station detail call:
  `pv`, `load`, `grid` with its direction, `bettery` with its state, `soc`, the
  raw `gridStatus`/`loadStatus`, the station id and the active `gridSignMode`.
- `INJECTED` — a control knob deliberately changing the answer: rate limit,
  forced token expiry, rejected login. These are never real bugs.
- `CONTROL` — a `/control` patch, one line per knob, `old -> new`.
- `BODY` — request and response bodies, `debug` only.

Colour is used when stdout is a TTY, and is dropped otherwise or when `NO_COLOR`
is set.

Passwords are never logged, at any level — not in the startup banner and not in
`debug` request bodies, where `pwd`/`password` are replaced with
`***redacted***`. Token values are truncated to an 8-character prefix.

## Pointing ChargeHA at it

The GoodWe SEMS client has GoodWe's hostnames compiled in, so redirect them
rather than reconfiguring the plugin. Either:

1. **Same Docker network (preferred).** Put ChargeHA on this compose network and
   it will resolve `www.semsportal.com` and `semsplus.goodwe.com` to the fake
   through the aliases above. Give ChargeHA `DENO_CERT=/certs/ca.crt` so it
   trusts the TLS listener. Log in with `tester@example.com` /
   `fake-password-123`.
2. **Hosts file.** Point `www.semsportal.com`, `semsplus.goodwe.com` and
   `eu.semsportal.com` at the host running the fake with `TLS=1` on 443, and
   trust `/certs/ca.crt`.

Undo the hosts entries when you are done — they will otherwise silently
intercept real SEMS traffic.

## Files

- `src/server.ts` — request routing, envelopes, auth, control endpoint
- `src/log.ts` — console logging, levels, redaction
- `src/config.ts` — the control state and its env seeding
- `src/stations.ts` — station profiles, solar/load/battery simulation, powerflow
- `smoke.ts` — protocol-level smoke test
- `Dockerfile`, `docker-compose.yml` — container and the DNS/TLS setup that
  makes gateway mode testable
