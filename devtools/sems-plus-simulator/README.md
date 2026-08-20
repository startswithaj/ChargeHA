# SEMS+ Simulator

A standalone fake of GoodWe's SEMS+ gateway API.

It shares no code with ChargeHA and imports nothing from it — it just speaks the
same wire protocol. It is not a workspace member, so it never reaches the app's
module graph. It is also entirely separate from the
[SEMS simulator](../sems-simulator/README.md), which fakes the older portal API.

## Why it exists

ChargeHA's GoodWe plugin can read from SEMS+ instead of the classic portal (the
`use_sems_plus` setting). That backend talks to an undocumented gateway API, so
this fake exists to:

- **Run the SEMS+ backend end to end** without a GoodWe account.
- **Exercise the X-Signature auth path**, which the plugin computes per request
  and which the real gateway rejects silently when wrong.
- **Serve payload shapes we have no live sample of** — a battery station
  (`pBat`/`soc`) and an EV charger (`pEvChar`), neither of which appear in the
  captures the backend was written against.
- **Trigger failure paths on demand** — rate limiting (`GY0429`), token expiry,
  and the empty-payload response an un-migrated station returns.

## Running it

```
deno task semsplus:sim          # listens on http://localhost:8098
deno task semsplus:sim:smoke    # drives every route and asserts the shapes
```

Point ChargeHA at it:

```
GOODWE_SEMS_PLUS_BASE_URL=http://localhost:8098 deno task dev
```

In Docker, use `http://host.docker.internal:8098` so the container can reach the
host.

Log in with `tester@example.com` / `fake-password-123` (override with
`SEMS_ACCOUNT` / `SEMS_PASSWORD`).

## Stations

| Station                                | Shape                                                                       |
| -------------------------------------- | --------------------------------------------------------------------------- |
| `11111111-1111-4111-8111-111111111111` | 3-phase, no battery — mirrors the AU install this backend was built against |
| `22222222-2222-4222-8222-222222222222` | Hybrid with a battery — adds `pBat` and `soc`                               |
| `33333333-3333-4333-8333-333333333333` | EV charger — adds `pEvChar` while charging                                  |

Solar follows a bell curve peaking at 13:00 and is zero outside 06:00–20:00, so
the same station serves day and night payload shapes. Every flow keeps
`pAc = pConsum + pGrid` exact, matching every captured payload.

## Routes

| Route                                                 | Purpose                                             |
| ----------------------------------------------------- | --------------------------------------------------- |
| `POST /web/sems/sems-user/api/v1/auth/cross-login`    | Login, returns a session token and gateway api base |
| `GET  /web/sems/sems-plant/api/stations/flow`         | Live flow for `?stationId=`                         |
| `POST /web/sems/sems-plant/api/stations/simple-query` | Station list                                        |
| `GET  /health`                                        | Liveness                                            |
| `GET/POST /control`                                   | Read or patch the injected-failure state            |

## Injecting failures

Set at startup by env var, or flipped at runtime through `/control`:

| Key                     | Env                        | Effect                                     |
| ----------------------- | -------------------------- | ------------------------------------------ |
| `emptyFlow`             | `EMPTY_FLOW`               | Flow returns 200 with no power fields      |
| `rateLimitRequests`     | `RATE_LIMIT_REQUESTS`      | Next N requests return `GY0429`            |
| `rateLimitUntilCleared` | `RATE_LIMIT_UNTIL_CLEARED` | Every request returns `GY0429`             |
| `expireNextToken`       | `EXPIRE_NEXT_TOKEN`        | Next login issues a token that never works |
| `tokensRevoked`         | —                          | All issued tokens stop working             |
| `rejectLogin`           | `REJECT_LOGIN`             | Login always returns a credentials error   |
| `hourOverride`          | `HOUR_OVERRIDE`            | Pin the simulated clock, 0–23              |

```
curl -X POST localhost:8098/control -d '{"rateLimitUntilCleared":true}'
curl localhost:8098/control
```
