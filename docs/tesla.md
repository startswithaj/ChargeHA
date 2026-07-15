# Tesla Integration

ChargeHA uses Tesla's Fleet API to monitor vehicle state, send charging
commands, and detect plug-in / unplug events. Every API call costs money against
a $10/month developer credit, so the integration caches aggressively and only
wakes the car when there's a real reason.

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

---

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

## Cache freshness

The cache is considered fresh for:

- **3 min** before any state has been fetched.
- **5 min** when the car is online and unplugged. Tight window so we catch a
  plug-in before Tesla puts the car back to sleep.
- **10 min** when charging is plausible (solar or schedule active).
- **20 min** otherwise.

Wakes have a separate **60-minute cooldown** on top of the cache rules.

## Wake suppression

The plugin will not wake the car when:

- A blockout schedule is active (no charging allowed anyway).
- Neither schedule nor solar applies (no reason to top up).
- The cached state shows the car is unplugged. Tesla wakes itself on plug-in;
  the free `/vehicles` probe will catch it.
- The battery is already at the effective charge limit (vehicle limit or
  schedule limit, whichever is lower).
- A wake fired in the last 60 minutes.

A user-initiated dashboard refresh bypasses all of these.

---

## How setup fits together

Tesla setup needs two internet-reachable things, and it's easy to conflate them:

1. **A public key domain.** Tesla fetches your public key from
   `https://<domain>/.well-known/appspecific/com.tesla.3p.public-key.pem` — but
   **only during virtual key pairing**. The domain doesn't need to stay
   reachable afterwards; re-pairing (a new vehicle, or a key removed from the
   car) needs it serving again. The domain's root must be listed in the portal's
   **Allowed Origin URL(s)** or partner registration fails with "Root domain
   must match registered allowed origin".
2. **An OAuth redirect address.** Where your browser lands after the Tesla
   login. Only your browser needs to reach it, but Tesla's portal must accept
   it: **`localhost` or `https` only** — a plain-http LAN address like
   `http://192.168.1.10:8000` cannot be registered.

### The recommended paths

- **Safest: run setup from localhost and host the key on FleetKey.net or GitHub
  Pages.** Open ChargeHA at `http://localhost:<port>` — directly if it runs on
  your machine, or via a port-forward from the machine you're browsing on
  (`ssh -L 8000:localhost:<port> <server>`, then `http://localhost:8000`).
  localhost always registers with Tesla, and the static key hosts use domains
  Tesla accepts.
- **Easiest: the wizard's temporary tunnel.** One click, covers both the key
  domain and the OAuth redirect — but it depends on Tesla accepting the tunnel
  provider's domain, and Tesla blocks these over time (see below). If the portal
  rejects the tunnel's URLs, fall back to the localhost path.

### Which domains Tesla's portal accepts

The portal validates every domain entered in its fields and rejects most free
tunnel services ("Domain is not valid ... not being used with a reverse proxy
setup"). Tested 2026-07:

| Domain                  | Redirect URI field | Allowed Origin field |
| ----------------------- | ------------------ | -------------------- |
| `free.pinggy.net`       | accepted           | accepted             |
| `github.io`             | n/a                | accepted             |
| `fleetkey.net`          | n/a                | accepted             |
| `serveousercontent.com` | accepted           | rejected             |
| `trycloudflare.com`     | rejected           | rejected             |
| `run.pinggy-free.link`  | —                  | rejected             |
| `tunnelmole.net`        | —                  | rejected             |
| `loca.lt`               | rejected           | —                    |

The wizard's tunnel runs over **Pinggy** (plain ssh, no account) — the only
tested free tunnel accepted in both fields. Caveats:

- Free tunnels **expire after 60 minutes** — partner registration, login, and
  pairing must all finish within one session.
- The URL embeds your public IP address.
- The tunnel URL changes on every start. If it dies mid-flow, partner
  registration must be re-run with the new URL, and the portal fields updated.
- When the OAuth callback uses a tunnel domain, the callback URL must be listed
  in **both** Allowed Redirect URI(s) and Allowed Returned URL(s).

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
   Management. Nothing else is used.
6. Submit. Approval is usually instant, occasionally days. Note your **Client
   ID** (UUID) and **Client Secret** (starts with `ta-secret.`).

### Part 2: the setup wizard

The wizard handles the rest: key generation, public key hosting, credentials,
partner registration, OAuth, vehicle selection, and virtual key pairing.

1. **Key Generation** — generate or import an EC P-256 key pair. The private key
   is stored in the DB (encrypted if `ENCRYPTION_KEY` is set).
2. **Public Key Hosting** — pick how Tesla fetches your key: the temporary
   tunnel, FleetKey.net, GitHub Pages, self-hosting, or AI-assisted setup. On a
   plain-http LAN address the static options are disabled (Tesla can't use that
   address for login) — switch to localhost to unlock them.
3. **Tesla Credentials** — Client ID, Client Secret, Region (NA/EU/CN; Australia
   is NA). The step shows the exact portal values to paste.
4. **Partner Registration** — automatic and idempotent.
5. **Tesla Authorization** — opens Tesla's login; the wizard polls for
   completion.
6. **Vehicle Selection** — pick vehicles; priorities order solar allocation for
   multi-vehicle accounts.
7. **Virtual Key Pairing** — open the pairing URL
   (`https://tesla.com/_ak/<domain>`) or QR code on your phone near the vehicle,
   approve in the Tesla app, confirm on the touchscreen, then "Verify Pairing".

---

## Manual setup reference

For troubleshooting or doing it all yourself.

### Generate a key pair

```bash
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out public-key.pem
```

### Host the public key

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

### Register as a partner

The key domain must already be in Allowed Origin URL(s).

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

Regional base URLs:

| Region                        | Base URL                                      |
| ----------------------------- | --------------------------------------------- |
| North America / Asia-Pacific  | `https://fleet-api.prd.na.vn.cloud.tesla.com` |
| Europe / Middle East / Africa | `https://fleet-api.prd.eu.vn.cloud.tesla.com` |
| China                         | `https://fleet-api.prd.cn.vn.cloud.tesla.com` |

### OAuth authorization

```
https://auth.tesla.com/oauth2/v3/authorize
  ?response_type=code
  &client_id=<YOUR_CLIENT_ID>
  &redirect_uri=<REDIRECT_URI>
  &scope=openid offline_access vehicle_device_data vehicle_charging_cmds vehicle_location
  &state=<random_string>
```

Exchange the returned code immediately (codes expire in ~2 minutes):

```bash
curl --request POST \
  --header 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode 'client_id=<YOUR_CLIENT_ID>' \
  --data-urlencode 'client_secret=<YOUR_CLIENT_SECRET>' \
  --data-urlencode 'code=<AUTH_CODE>' \
  --data-urlencode 'audience=https://fleet-api.prd.na.vn.cloud.tesla.com' \
  --data-urlencode 'redirect_uri=<REDIRECT_URI>' \
  'https://fleet-auth.prd.vn.cloud.tesla.com/oauth2/v3/token'
```

### Test the connection

```bash
# List vehicles (does not wake)
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles'

# Get charge state (wakes the vehicle)
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/<VIN>/vehicle_data?endpoints=charge_state'
```

---

## Token lifecycle

| Token         | Lifetime              | Renewal                                                                 |
| ------------- | --------------------- | ----------------------------------------------------------------------- |
| Access token  | 8 hours               | Automatic — ChargeHA refreshes 30 minutes before expiry                 |
| Refresh token | 3 months (single-use) | Each refresh returns a new refresh token — chain continues indefinitely |
| Partner token | 8 hours               | Only needed for one-time partner registration                           |
| Auth code     | ~2 minutes            | One-time use during initial OAuth                                       |

You should never need to re-authorize unless:

- ChargeHA is offline for 3+ consecutive months (refresh token expires).
- You change your Tesla account password.
- You revoke ChargeHA's access in your Tesla account settings.

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

- Tesla has blocked that domain — most free tunnel domains are (see the
  acceptance table above). Also check: no trailing slash, and the domain must
  serve valid https.
- Fall back to the localhost path with FleetKey.net or GitHub Pages.

### "Root domain must match registered allowed origin"

- The key domain must appear in Allowed Origin URL(s) before partner
  registration.

### "Invalid client_id / client_secret"

- Double-check you're using the client_secret (starts with `ta-secret.`), not
  the client_id twice. No leading/trailing whitespace.

### "Invalid auth code"

- Auth codes expire in ~2 minutes and are single-use. Go through the OAuth flow
  again.

### "Vehicle not responding to commands"

- Ensure the virtual key is paired (open `https://tesla.com/_ak/<domain>` on
  your phone near the car).
- The vehicle must be awake — ChargeHA wakes it automatically when needed.
- Check that your private key matches the hosted public key.

### "404 on public key URL"

- GitHub Pages: `.nojekyll` must exist in the repo root, Pages must be enabled
  on the correct branch, and the repo must be `<username>.github.io`.
- Tunnel: the key is only served while the tunnel is running.
