# Tesla Powerwall 2 via Gateway (Local)

The `powerwall2_local` energy plugin reads site-level solar production, grid
import/export, home consumption, battery power and battery state of charge from
a Tesla Backup Gateway on your LAN. It is separate from the Tesla **vehicle**
plugin. No Fleet API credentials, OAuth flow, RSA registration, or Python proxy
are needed.

## Compatibility and scope

Validated on **Backup Gateway 2, firmware 26.34.0**, with local customer login.
This is not a claim that every Gateway or every 26.x firmware supports this API.
Powerwall 2 with Backup Gateway 2 (tested). Gateway 1 untested. Powerwall 3 not
supported. Multi-Gateway sites and other firmware are unverified. There is no
TEDAPI/v1r or cloud fallback. The plugin requires the four endpoints below,
including all four aggregate meters and their communication timestamps.

The plugin is read-only with respect to Powerwall settings: it does not set
backup reserve, operating mode, grid charging, or import/export limits. EV
charging stays under ChargeHA's controller and the selected vehicle/charger
plugin.

## Setup

1. Ensure the ChargeHA **server/container** can reach the Gateway on HTTPS
   port 443. Reserve the Gateway's address in DHCP. Phone/browser access alone
   is not enough.
2. Select **Tesla Powerwall 2 via Gateway (Local)** as the energy source in
   setup or Settings.
3. Enter the Gateway's IPv4 address or DNS hostname, without scheme, port or
   path. IPv6 literal input is not currently supported.
4. Enter the email associated with the Gateway's local customer login if
   required.
5. Enter its **local customer password**, not your Tesla account password. On
   Gateway 2 the default is the last five characters of the label's **Password**
   field, preserving case, unless changed. Do not use the serial number or the
   Powerwall battery label. See
   [Finding your Gateway password](#finding-your-gateway-password) below, also
   available directly beneath the password field in setup and Settings.
6. Leave maximum telemetry age at **60 seconds** unless you have a reason to
   change it. The allowed range is 10–300 seconds. Leave the advanced polling
   interval at its **30-second** default; it controls the wait after each
   completed poll, not the age of readings the plugin accepts.
7. **Test Connection** should show firmware and live power/SOC. In setup, Next
   saves the tested values. Editing a value requires another successful test. In
   Settings, Test Connection uses the draft values; the panel's Save persists
   them separately.
8. Check grid/battery direction and approximate values against the Tesla app
   before relying on solar-based EV charging. Cloud displays may lag local data.

## Finding your Gateway password

These instructions apply to **Backup Gateway 2**. Other models remain
unverified; do not assume they use the same label or password convention.

1. Locate the **Gateway**, not the Powerwall battery. Open only its outer glass
   door and look for the QR-code label with a field named **Password**. Do not
   remove electrical covers. If you cannot access or identify the label, ask
   your installer.
2. Read the **Password** field, not the serial number or part number. Enter only
   its **last five characters**, preserving uppercase and lowercase, with no
   extra spaces. This is the default local customer password, unless changed.

   Fictional example (not a real credential):

   ```text
   Label Password:       Ab3De6Gh9J
   Enter in ChargeHA:         6Gh9J
   ```

3. Do not enter the full printed password, your home Wi-Fi password, or your
   Tesla account password. If you changed the local customer password, enter
   that replacement instead of deriving one from the label.
4. Select **Test Connection**. A successful test displays the firmware and live
   readings. In setup, select **Next** to save; in Settings, use **Save**.

**If login fails:** check the correct label, letter case, accidental spaces and
local-login email. If the password is unknown or still rejected, ask your
installer or Tesla Support specifically about the **Gateway's local customer
login**, not your Tesla account. Do not factory-reset the Gateway for this
setup. A 401 alone does not prove that local access has been removed. For a
timeout or connection failure, check the IP address and network route from the
ChargeHA server/container; changing the password will not fix an unreachable
Gateway.

Source:
[Netzero's local-password explanation](https://docs.netzero.energy/docs/diagnostics/Powerwall2#credentials).
There is no need to change Wi-Fi settings to use this plugin. The complete
password instructions are provided above; opening an external page is optional.

## Credentials and TLS

The password uses ChargeHA's normal plugin secret storage. Configure and retain
ChargeHA's `ENCRYPTION_KEY` to encrypt it at rest; the core secret store falls
back to plaintext when encryption is not configured. Restrict access to
ChargeHA's UI and data backups, which can expose configuration or credentials.

Gateways use self-signed certificates. Certificate verification is disabled
**only for this plugin's HTTPS requests**, not process-wide. Traffic is
encrypted but the Gateway's identity is not certificate-verified. Use a trusted
LAN and verify the configured address. The client does not follow HTTP
redirects. Login credentials are sent only to that configured host; session
cookies remain in memory and are cleared on disconnect. Authentication/JSON
parsing errors omit response bodies.

## Protocol and telemetry

| Endpoint                     | Purpose                                      |
| ---------------------------- | -------------------------------------------- |
| `POST /api/login/Basic`      | Customer login; session cookie or JSON token |
| `GET /api/status`            | Identity and firmware, without login         |
| `GET /api/meters/aggregates` | Site, solar, load and battery power          |
| `GET /api/system_status/soe` | Battery percentage                           |

The default polling interval is 30 seconds after completion, configurable from
10 to 60 seconds. HTTPS requests have a 10-second wall-clock deadline as well as
a socket inactivity timeout. There is no separate whole-cycle deadline. Reads
are sequential and reuse the login session. A protected request receiving
401/403 reauthenticates and retries once, then fails rather than looping
indefinitely. See **Polling safeguards** below for failure cadence and
cooldowns.

Power is rounded to watts. Positive grid means **import**; negative means
export. Positive battery means **discharge**; negative means charge. Solar and
home power are clamped to zero for small negative meter noise. Voltage is
optional. Raw SOC must be finite and between 0 and 100; invalid readings fail
the poll before conversion. The local SOE endpoint includes Tesla's 5% battery
buffer. The plugin reports usable SOC on the Tesla app's scale:
`max(0, min(100, (rawPercentage - 5) / 0.95))`. For example, raw 24% becomes
20%; raw 0–5% becomes 0%, and raw 100% remains 100%. Fractional precision is
retained for the UI to format. This follows
[pyPowerwall's app-style scaling](https://github.com/jasonacox/pypowerwall/blob/main/API.md#power-and-energy).
The 5% buffer is separate from your configured backup reserve: no user reserve
is subtracted, and measured charge/discharge power is not inferred from SOC.
Connection-test results and subsequent polls use the same conversion. Existing
history rows are not rewritten.

Each aggregate meter must have finite power and a valid
`last_communication_time`. The oldest timestamp must be within the configured
age limit; equality is allowed. A timestamp more than five seconds ahead of the
server is rejected. Keep both clocks synchronized. SOC has no independent
freshness timestamp in this response; it is read on every poll. `lastUpdated`
records the successful local poll time.

## Failure and recovery

Missing, malformed, stale or future-dated required meter data fails the poll; it
is never silently reused as a new good reading. ChargeHA's existing EnergyPoller
emits `pollFailed` with zero power and an error, and retries on subsequent
polls.

In Auto's solar-only path, this prevents a new solar start and stops existing
solar charging on the next controller iteration. Fresh readings permit recovery.
This is **not a global charging interlock**: explicit Charge Now and charge
schedules can still charge without solar telemetry. This plugin does not change
those core semantics.

For login failures, verify the local password and email first; a 401 alone does
not establish that the firmware removed local access. For connection failures,
check the server/container route and port 443. For stale/future readings, check
Gateway meter reporting and both clocks instead of disabling freshness checks.

## Development and verification

Run `deno task check:all` from the repository root. Plugin server tests exercise
transport errors/timeouts, authentication, validation, encrypted config storage
and connection-test cleanup with fake hardware. Core controller tests exercise
failed energy data and recovery using a mock energy adapter. Client tests cover
wizard validation, explicit save, draft connection tests, pending/error feedback
and network-free gallery specimens.

Run `deno task dev:client` and open `/components` for static setup and
connection feedback examples. They do not query a Gateway.

## Polling safeguards

Normal polling waits **30 seconds after the previous cycle completes**. The
advanced **Polling interval** setting accepts whole seconds from 10 to 60. A
slower interval trades quicker solar tracking for less Gateway traffic; charging
thresholds and schedules are not changed.

The shared energy poller permits only one cycle in flight. Stop and reconfigure
abort outstanding requests and await in-flight work before stop returns or the
adapter is replaced. Rejected cancellation is logged at debug level only; a late
success may finish while draining, but the old loop is not rescheduled.
Powerwall reads aggregates then SOC sequentially, using a separate HTTPS
connection for each request so a timed-out connection cannot replay old work.
Each request has a 10-second absolute deadline. Authentication and retry can
make a complete poll take longer than 20 seconds, but cannot overlap the next
scheduled poll. Cancellation destroys the active request.

Success and failure both wait the configured interval after completion. HTTP 429
and 503 activate the plugin client's cooldown: Retry-After seconds or an HTTP
date are respected, capped at one hour; absent/invalid/past values use five
minutes. All endpoints, including login, fail fast during cooldown without
network traffic. There is no cloud fallback or reuse of stale readings as fresh
charging input.

The adapter persists connection failures only, throttled to one entry per five
minutes. The shared poller logs scheduled failures and recovery, with repeated
failures throttled. A failed connection followed by the first failed scheduled
poll can produce two startup entries (connection and poll). Interactive
connection tests return results to the caller without writing to the Logs page;
console diagnostics are not persisted Logs entries.

Unknown dependency/transport errors are normalized inside the plugin before
reaching core Logs, failure events or connection-test results. Trusted plugin
diagnostics retain authentication, HTTP status/cooldown, timeout, cancellation
and telemetry-validation categories, but arbitrary error messages/causes and
response bodies are not forwarded. Connection-test construction failures return
a structured safe failure.
