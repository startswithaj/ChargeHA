# Tesla Integration

ChargeHA uses Tesla's Fleet API to monitor vehicle state, send charging
commands, and detect plug-in / unplug events. Every API call costs money against
a $10/month developer credit, so the integration caches aggressively and only
wakes the car when there's a real reason.

## Notes on Tesla Onboarding

Tesla setup needs two addresses registered in the developer portal. Only one of
them has to be reachable from the internet:

1. **A public key domain — fetched by Tesla's servers.** Tesla fetches your
   public key from
   `https://<domain>/.well-known/appspecific/com.tesla.3p.public-key.pem` — but
   **only during virtual key pairing**. This is the one that must be genuinely
   internet-reachable. The domain doesn't need to stay reachable afterwards;
   re-pairing (a new vehicle, or a key removed from the car) needs it serving
   again. The domain's root must be listed in the portal's **Allowed Origin
   URL(s)** or partner registration fails with "Root domain must match
   registered allowed origin".
2. **An OAuth redirect address — reached by your browser.** Where you land after
   the Tesla login. Nothing outside your machine ever connects to it, which is
   why `localhost` is fine. It still has to be _registered_, and the portal
   accepts **`localhost` or `https` only** — a plain-http LAN address like
   `http://192.168.1.10:8000` cannot be registered.

### The recommended paths

- **Localhost + static key host (safest).** Open ChargeHA at
  `http://localhost:<port>` — directly if it runs on your machine, or by
  forwarding a port from the machine you're browsing on:

  ```bash
  # plain server
  ssh -L 8000:localhost:<port> <server>

  # kubernetes
  kubectl port-forward svc/<chargeha-service-name> 8000:80
  ```

  Then open `http://localhost:8000`, and host the public key on FleetKey.net or
  GitHub Pages. localhost always registers with Tesla, and the static key hosts
  use domains Tesla accepts. No third party is involved and nothing expires
  mid-setup.
- **Temporary tunnel (easiest).** One click in the wizard, covers both the key
  domain and the OAuth redirect — but it depends on Tesla accepting the tunnel
  provider's domain. Most free tunnel services are rejected by the portal
  ("Domain is not valid ... not being used with a reverse proxy setup"), and
  Tesla blocks new ones over time. If the portal rejects the tunnel's URLs, fall
  back to the localhost path.

### What the tunnel actually exposes

The wizard's tunnel runs **Pinggy** over plain ssh — no account needed:

```bash
ssh -R 0:localhost:<port> qr@a.pinggy.io
```

It returns a temporary `https://<random>.free.pinggy.net` URL that covers both
addresses above, and is currently the only tested free tunnel whose domain the
portal accepts in both the Redirect URI and Allowed Origin fields (tested
2026-07).

It does **not** put ChargeHA on the internet. The tunnel terminates at a small
middleware server that serves an exact-path allowlist — any path that isn't a
registered plugin route returns 404, and proxied routes are GET-only with no
request body forwarded. The dashboard, the API, and the setup wizard are not
reachable through it.

For Tesla that allowlist is two routes:

| Route                          | Carries                         |
| ------------------------------ | ------------------------------- |
| `/com.tesla.3p.public-key.pem` | Your public key — not sensitive |
| `/callback`                    | OAuth `code` + `state`          |

Neither carries a credential. The authorization code that lands on `/callback`
cannot be redeemed on its own: exchanging it also requires your OAuth client
secret, which never crosses the tunnel (see below).

So Pinggy relays a short-lived, single-use code that is useless without a secret
they never see. The practical caveats are operational rather than security ones:

- Free tunnels **expire after 60 minutes** — partner registration, login, and
  pairing must all finish in one session.
- The URL embeds your public IP address.
- The URL changes on every start. If it dies mid-flow, re-run partner
  registration with the new URL and update the portal fields.
- When the OAuth callback uses a tunnel domain, the callback URL must be listed
  in **both** Allowed Redirect URI(s) and Allowed Returned URL(s).

### Two secrets, don't confuse them

Setup involves two unrelated credentials. Both stay on your machine and neither
ever crosses the tunnel — but they do different jobs, and the error messages
that mention them are not interchangeable. Both are stored in the database, and
encrypted at rest **only if `ENCRYPTION_KEY` is set**.

|             | OAuth client secret                      | EC private key                   |
| ----------- | ---------------------------------------- | -------------------------------- |
| What        | Password string paired with `client_id`  | Half of a keypair you generate   |
| Used for    | Exchanging the auth code for tokens      | Signing vehicle commands         |
| Where from  | Tesla's developer portal gives it to you | You generate it with `openssl`   |
| Public half | `client_id` — not secret                 | The `.pem` served at the key URL |

The client secret is sent only on the direct server-to-server POST to Tesla's
token endpoint — never in the authorize URL, which carries just `client_id`,
`redirect_uri`, `scope`, and `state`. The EC private key is read by the local
`tesla-http-proxy` on `localhost:4443` and never leaves the machine at all.

Tokens and key pairing fail independently: you can hold valid tokens and still
have commands rejected because the key isn't paired with the car, and vice
versa.

---

## Setup

### Part 1: Tesla developer application (manual, one-time)

1. Go to [developer.tesla.com](https://developer.tesla.com/), sign in with the
   Tesla account linked to your vehicle (MFA enabled), and click "Create
   Application".
2. **App Name / Description**: anything. Suggested Purpose of Usage:

   > Personal home automation application for solar-aware EV charging. Monitors
   > real-time solar generation and dynamically adjusts vehicle charging to
   > maximize self-consumption. Reads charge state and sends charging commands
   > (start, stop, set amperage, set charge limit). Personal use only.

3. **OAuth Grant Type**: **Authorisation Code and Machine-to-Machine**. Not
   "Machine-to-Machine only" — that's for enterprise fleets.
4. **Allowed Origin URLs / Redirect URIs / Returned URLs**: leave for later —
   the wizard shows the exact values to paste when you reach that step.
5. **Scopes**: Vehicle Information, Vehicle Location, Vehicle Charging
   Management. Nothing else is used — in particular **Vehicle Commands is not
   needed**, despite its portal description mentioning "wake up". ChargeHA wakes
   the car fine without it; that scope also covers unlock, Live Camera, and
   remote start, none of which ChargeHA uses.
6. Submit. Approval is usually instant, occasionally days. Note your **Client
   ID** (UUID) and **Client Secret** (starts with `ta-secret.`).

### Part 2: the setup wizard

The wizard handles the rest: key generation, public key hosting, credentials,
partner registration, OAuth, vehicle selection, and virtual key pairing.

1. **Key Generation** — generate or import an EC P-256 key pair. The private key
   is stored in the DB (encrypted if `ENCRYPTION_KEY` is set).
2. **Public Key Hosting** — pick how Tesla fetches your key: the temporary
   tunnel, FleetKey.net, GitHub Pages, self-hosting, or AI-assisted setup. On a
   plain-http LAN address every option except the tunnel is disabled (Tesla
   can't use that address for login) — switch to localhost to unlock them.
3. **Tesla Credentials** — Client ID, Client Secret, Region (NA/EU/CN; Australia
   is NA). The step shows the exact portal values to paste.
4. **Partner Registration** — automatic and idempotent.
5. **Tesla Authorization** — opens Tesla's login; the wizard polls for
   completion.
6. **Vehicle Selection** — pick vehicles; priorities order solar allocation when
   an account has more than one.
7. **Virtual Key Pairing** — open the pairing URL
   (`https://tesla.com/_ak/<domain>`) or QR code on your phone near the vehicle,
   approve in the Tesla app, confirm on the touchscreen, then "Verify Pairing".

## Verifying by hand

The wizard does all of this for you. These commands are for debugging a failed
setup — running them isolates whether the problem is your credentials, your
portal configuration, or ChargeHA.

### Hosting the public key yourself

**FleetKey.net** (simplest): paste the public key at
[fleetkey.net](https://fleetkey.net), get a `<id>.fleetkey.net` domain.

**GitHub Pages**:

1. Create a public repo named `<username>.github.io` — it must be the
   root-domain repo; project repos serve under a subpath, which Tesla rejects.
2. Add:

   ```
   .nojekyll                                            (empty file)
   .well-known/appspecific/com.tesla.3p.public-key.pem  (your public key)
   ```

   `.nojekyll` is required — Jekyll ignores `.well-known` otherwise.
3. Enable GitHub Pages (Settings → Pages), then verify:
   `https://<username>.github.io/.well-known/appspecific/com.tesla.3p.public-key.pem`

### Partner registration and token checks

Regional base URLs:

| Region                        | Base URL                                      |
| ----------------------------- | --------------------------------------------- |
| North America / Asia-Pacific  | `https://fleet-api.prd.na.vn.cloud.tesla.com` |
| Europe / Middle East / Africa | `https://fleet-api.prd.eu.vn.cloud.tesla.com` |
| China                         | `https://fleet-api.prd.cn.vn.cloud.tesla.com` |

Partner registration — the key domain must already be in Allowed Origin URL(s):

```bash
# 1. Get a partner token
curl --request POST \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=client_credentials' \
  --data-urlencode 'client_id=<YOUR_CLIENT_ID>' \
  --data-urlencode 'client_secret=<YOUR_CLIENT_SECRET>' \
  --data-urlencode 'audience=https://fleet-api.prd.na.vn.cloud.tesla.com' \
  --data-urlencode 'scope=openid vehicle_device_data vehicle_cmds vehicle_charging_cmds' \
  'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'

# 2. Register your domain
curl --request POST \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer <PARTNER_TOKEN>' \
  --data '{"domain": "<your-key-domain>"}' \
  'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/partner_accounts'
```

Testing an access token:

```bash
# List vehicles (does not wake)
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles'

# Get charge state (wakes the vehicle)
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/<VIN>/vehicle_data?endpoints=charge_state'
```

## Token lifecycle

| Token         | Lifetime              | Renewal                                                                 |
| ------------- | --------------------- | ----------------------------------------------------------------------- |
| Access token  | 8 hours               | Automatic — ChargeHA refreshes 30 minutes before expiry                 |
| Refresh token | 3 months (single-use) | Each refresh returns a new refresh token — chain continues indefinitely |
| Partner token | 8 hours               | Only needed for one-time partner registration                           |
| Auth code     | ~2 minutes            | One-time use during initial OAuth                                       |

Refresh happens on a timer _and_ lazily before any request, so a server that was
asleep past its scheduled refresh still recovers on the next call.

You should never need to re-authorize unless:

- ChargeHA is offline for 3+ consecutive months (refresh token expires).
- You change your Tesla account password.
- You revoke ChargeHA's access in your Tesla account settings.

---

## Why polling instead of streaming?

Tesla's Fleet Telemetry (streaming) is cheaper and faster, but it requires the
vehicle to open a WebSocket directly to your server using mTLS — which needs a
public IP, port 443 open, and direct TLS termination (no tunnels, no reverse
proxy). That doesn't fit a local-only approach.

Third-party relays like Teslemetry.com solve the connectivity problem but charge
ongoing subscription fees, which conflicts with ChargeHA's self-hosted
philosophy.

So ChargeHA polls the REST API instead. Revisit if Tesla adds a cloud-relayed
streaming option.

## Cost model

Tesla's Fleet API charges per call. The default monthly credit is $10 (roughly
5,000 data calls or 500 wakes).

| Call type    | Endpoint            | Cost   |
| ------------ | ------------------- | ------ |
| Online check | `GET /vehicles`     | Free   |
| Data fetch   | `GET /vehicle_data` | $0.002 |
| Wake-up      | `POST /wake_up`     | $0.02  |
| Command      | proxy command call  | $0.001 |

- Each data fetch returns charge state, vehicle state, and location in a single
  response — location is included on every fetch at no extra cost.
- Daily traffic is dominated by data fetches.
- Wakes are by far the most expensive single action.

## When calls happen

| When                                         | What runs                              |
| -------------------------------------------- | -------------------------------------- |
| Controller tick, cache fresh                 | Nothing — served from cache            |
| Controller tick, cache stale                 | Data fetch                             |
| Controller tick, car asleep + need to charge | Wake → data fetch                      |
| User refresh from dashboard                  | Wake (if needed) + data fetch          |
| Start / stop / set amps                      | Pre-command wake (if asleep) + command |

## Cache and wake rules

Cached state is considered fresh for a window that depends on the car's state.
The first matching rule wins:

1. **3 min** — no state has been fetched yet.
2. **5 min** — the car is online and unplugged. Tight window so we catch a
   plug-in before Tesla puts the car back to sleep. This is checked _before_ the
   solar/schedule case, so it applies even when a schedule is active.
3. **10 min** — charging is plausible (solar or schedule active).
4. **20 min** — otherwise.

Waking is more restricted than fetching, because a wake costs 10× a data fetch.
On top of the cache rules, a scheduled wake is suppressed when:

- A blockout schedule is active (no charging allowed anyway).
- Neither schedule nor solar applies (no reason to top up).
- The cached state shows the car is unplugged. Tesla wakes itself on plug-in;
  the free `/vehicles` probe will catch it.
- The battery is already at the effective charge limit (vehicle limit or
  schedule limit, whichever is lower).
- A wake fired in the last **60 minutes** (cooldown).

Two paths bypass all of the above:

- **A dashboard refresh.** Sets `forceRefresh`, which short-circuits every
  suppression check. It still only wakes if the car is actually offline — if
  it's already online, you get fresh data without paying for a wake.
- **A charge command** (start / stop / set amps). These don't consult the
  suppression rules at all: the command path does a free online check and wakes
  unconditionally if the car is asleep — no cooldown, no plugged-in check.

---

## Troubleshooting

### "We don't recognize this redirect_uri" / "redirect_uri is not registered"

- The `redirect_uri` in the OAuth URL must **exactly match** one of the Allowed
  Redirect URIs in your Tesla developer app.
- When the callback uses a **tunnel domain**, the same URL must also be listed
  in **Allowed Returned URL(s)** — Allowed Redirect URIs alone is not enough.
- Tesla's URI field requires a path — bare domains are rejected. ChargeHA's
  callback path is `/api/vehicle/tesla/callback`.
- Changes to these fields may take a few minutes to propagate.

### "Domain is not valid ... reverse proxy setup" (developer portal)

- Tesla has blocked that domain — most free tunnel domains are. Also check: no
  trailing slash, and the domain must serve valid https.
- Fall back to the localhost path with FleetKey.net or GitHub Pages.

### "Root domain must match registered allowed origin"

- The key domain must appear in Allowed Origin URL(s) before partner
  registration.

### "Invalid client_id / client_secret"

- Double-check you're using the client_secret (starts with `ta-secret.`), not
  the client_id twice. No leading/trailing whitespace.
- Note this is the OAuth client secret, not your EC private key — see
  [Two secrets, don't confuse them](#two-secrets-dont-confuse-them).

### "Invalid auth code"

- Auth codes expire in ~2 minutes and are single-use. Go through the OAuth flow
  again.

### "Vehicle not responding to commands"

- Ensure the virtual key is paired (open `https://tesla.com/_ak/<domain>` on
  your phone near the car).
- The vehicle must be awake — ChargeHA wakes it automatically when needed.
- Check that your EC private key matches the hosted public key. Valid tokens and
  a working key pairing fail independently — commands can be rejected while
  everything else looks healthy.

### "404 on public key URL"

- GitHub Pages: `.nojekyll` must exist in the repo root, Pages must be enabled
  on the correct branch, and the repo must be `<username>.github.io`.
- Tunnel: the key is only served while the tunnel is running.
