# Tesla Integration

ChargeHA uses Tesla's Fleet API to monitor vehicle state, send charging
commands, and detect plug-in / unplug events. Every API call costs money against
a $10/month developer credit, so the integration caches aggressively and only
wakes the car when there's a real reason.

## Why polling instead of streaming?

Tesla's Fleet Telemetry (streaming) is cheaper and faster, but it requires the
vehicle to open a WebSocket directly to your server using mTLS — which needs a
public IP, port 443 open, and direct TLS termination (no Cloudflare Tunnel, no
reverse proxy). That doesn't fit a local-only approach.

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

## Setup Guide

There are two parts:

1. **Manual** — Tesla developer registration on Tesla's website.
2. **Automated** — the ChargeHA setup wizard handles the rest.

### Part 1: Tesla Developer Registration

#### Step 1: Create a Tesla Developer Account

1. Go to [developer.tesla.com](https://developer.tesla.com/).
2. Sign in with your Tesla account (the same one linked to your vehicle).
3. Ensure **multi-factor authentication** is enabled.

#### Step 2: Create an Application

From the developer dashboard, click "Create Application".

**Application details**

| Field                | What to enter                        |
| -------------------- | ------------------------------------ |
| **App Name**         | Whatever you like (e.g., "ChargeHA") |
| **Description**      | Brief description of your app        |
| **Purpose of Usage** | See below                            |

Recommended Purpose of Usage (copy-paste):

> Personal home automation application for solar-aware EV charging. Monitors
> real-time solar generation and dynamically adjusts vehicle charging to
> maximize self-consumption. Reads charge state and sends charging commands
> (start, stop, set amperage, set charge limit). Personal use only.

**OAuth Grant Type**

Select **Authorisation Code and Machine-to-Machine**.

- This gives you both Authorization Code (for user consent) and
  Machine-to-Machine (for the one-time partner registration call).
- Do NOT select "Machine-to-Machine only" — that's for enterprise fleets.

**Allowed Origin URLs and Redirect URIs**

Tesla requires you to whitelist these. The wizard will tell you the exact values
when you reach that step — you can come back and fill them in then.

If ChargeHA runs on your local network:

- **Localhost** — whitelist `http://localhost:<PORT>` (e.g.
  `http://localhost:5175` for Vite dev).
- **Cloudflare Tunnel** — the wizard can generate a temporary HTTPS tunnel for
  you. No account required.
- **GitHub Pages** — if you host your public key on GitHub Pages, whitelist that
  domain.

**OAuth Scopes**

| Scope                           | Select? | Why                                                |
| ------------------------------- | ------- | -------------------------------------------------- |
| Profile Information             | No      | Not needed                                         |
| **Vehicle Information**         | **Yes** | Read charge state, battery level, charging status  |
| **Vehicle Location**            | **Yes** | Detect whether vehicle is at home or away          |
| Vehicle Commands                | No      | For unlock, remote start — not needed for charging |
| **Vehicle Charging Management** | **Yes** | Start/stop charging, set amps, set charge limit    |
| Energy Product Information      | No      | For Powerwall/solar — handled by the energy plugin |
| Energy Product Commands         | No      | Not needed                                         |

The actual scopes ChargeHA requests are:
`openid offline_access vehicle_device_data vehicle_charging_cmds vehicle_location`

#### Step 3: Submit and Wait for Approval

After submitting, Tesla reviews your application. In our experience this was
instant, but it can take a few hours to a few days. You'll get an email when
approved.

Once approved, note your:

- **Client ID** (a UUID like `f689df54-d25a-487b-9217-ba25fd4f0d3f`).
- **Client Secret** (starts with `ta-secret.`).

### Part 2: ChargeHA Setup Wizard

The wizard handles key generation, public key hosting, partner registration,
OAuth, vehicle selection, and virtual key pairing.

- **Step 1: Key Generation** — Generate or import an EC P-256 key pair. The
  private key is stored in the DB (encrypted if `ENCRYPTION_KEY` is set).
- **Step 2: Public Key Hosting** — Tesla needs to fetch your public key from an
  internet-accessible URL at
  `https://<domain>/.well-known/appspecific/com.tesla.3p.public-key.pem`. The
  wizard offers Cloudflare Tunnel (recommended), self-hosting, GitHub Pages, or
  AI-assisted setup.
- **Step 3: Tesla Credentials** — Enter your Client ID, Client Secret, and
  Region (NA, EU, or CN). The wizard shows the exact Allowed Origin URL and
  Redirect URI to paste into the Tesla developer portal.
- **Step 4: Partner Registration** — Runs automatically. Idempotent, so
  re-running is safe.
- **Step 5: Tesla Authorization (OAuth)** — Click "Authorize with Tesla" to open
  Tesla's login page. After approval, Tesla redirects back to ChargeHA. The
  wizard polls for completion.
- **Step 6: Vehicle Selection** — Lists your vehicles with checkboxes (all
  selected by default). For multi-vehicle accounts, priority numbers can be
  assigned for solar allocation ordering.
- **Step 7: Virtual Key Pairing** — Pair ChargeHA's virtual key with each
  vehicle. The wizard shows a pairing URL
  (`https://tesla.com/_ak/<your-domain>`) and a QR code:
  1. Open the pairing URL on your phone while near the vehicle.
  2. Approve the virtual key in the Tesla app.
  3. Confirm on the vehicle's center screen by tapping the key card.

  Click "Verify Pairing" to confirm.

---

## Manual Setup (alternative to the wizard)

For troubleshooting or if you'd rather do everything yourself.

### Generate Key Pair

```bash
openssl ecparam -name prime256v1 -genkey -noout -out private-key.pem
openssl ec -in private-key.pem -pubout -out public-key.pem
```

### Host Public Key on GitHub Pages

1. Create a public repo named `<username>.github.io`.
2. Add:

   ```
   .nojekyll                                            (empty file)
   .well-known/appspecific/com.tesla.3p.public-key.pem  (your public key)
   ```

3. Enable GitHub Pages: Settings → Pages → Source: master branch.
4. Verify after ~30s:
   `https://<username>.github.io/.well-known/appspecific/com.tesla.3p.public-key.pem`

Notes:

- The `.nojekyll` file is required — Jekyll ignores `.well-known` otherwise.
- The repo must be named `<username>.github.io` (root domain), not a project
  subpath — Tesla only accepts hostnames.

### Add Domain to Tesla Allowed Origins

Before partner registration, the GitHub Pages domain must be in Allowed Origins
on your Tesla developer app.

### Register as a Partner

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
  --data '{"domain": "<username>.github.io"}' \
  'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/partner_accounts'
```

Regional base URLs:

| Region                        | Base URL                                      |
| ----------------------------- | --------------------------------------------- |
| North America / Asia-Pacific  | `https://fleet-api.prd.na.vn.cloud.tesla.com` |
| Europe / Middle East / Africa | `https://fleet-api.prd.eu.vn.cloud.tesla.com` |
| China                         | `https://fleet-api.prd.cn.vn.cloud.tesla.com` |

Australia is NA/APAC.

### OAuth Authorization

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

### Pair Virtual Key

Open `https://tesla.com/_ak/<your-domain>` on your phone while near the vehicle.
The Tesla app will prompt for approval; tap approve on the vehicle's center
screen.

### Test the Connection

```bash
# List vehicles (does not wake)
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles'

# Get charge state (wakes the vehicle)
curl -H "Authorization: Bearer <ACCESS_TOKEN>" \
  'https://fleet-api.prd.na.vn.cloud.tesla.com/api/1/vehicles/<VIN>/vehicle_data?endpoints=charge_state'
```

---

## Token Lifecycle

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

### "We don't recognize this redirect_uri"

- The `redirect_uri` in the OAuth URL must **exactly match** one of the Allowed
  Redirect URIs in your Tesla developer app.
- Tesla's URI field requires a path — bare domains are rejected. ChargeHA's
  callback path is `/api/vehicle/tesla/callback`.
- Changes to Allowed Redirect URIs may take a few minutes to propagate.

### "Root domain must match registered allowed origin"

- During partner registration, the domain must also appear in your Allowed
  Origin URLs.
- Add `https://<your-domain>` to Allowed Origins on the Tesla developer portal.

### "Invalid client_id / client_secret"

- Double-check you're using the client_secret (starts with `ta-secret.`), not
  the client_id twice.
- No leading/trailing whitespace.

### "Invalid auth code"

- Auth codes expire in ~2 minutes and are single-use.
- Request a new one by going through the OAuth flow again.

### "Vehicle not responding to commands"

- Ensure the virtual key is paired (open `https://tesla.com/_ak/<domain>` on
  your phone near the car).
- The vehicle must be awake — ChargeHA wakes it automatically when needed.
- Check that your private key matches the hosted public key.

### "404 on public key URL"

- Ensure `.nojekyll` exists in the repo root.
- GitHub Pages must be enabled on the correct branch.
- The repo must be named `<username>.github.io` for root-domain hosting —
  project repos serve under a subpath which Tesla doesn't support.
