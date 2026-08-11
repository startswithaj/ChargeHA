# GoodWe Integration

ChargeHA reads solar, grid, and home consumption figures from the GoodWe SEMS
Portal — GoodWe's own cloud service. You log in with the same account you use in
the SEMS app, pick your station, and ChargeHA polls it for live power readings.

There is no local connection. Everything goes through GoodWe's servers, so the
inverter does not need to be reachable on your network, but an internet outage
at either end stops the readings.

## What it works with

Any GoodWe inverter registered in SEMS. That includes:

- Single-inverter and multi-inverter stations. ChargeHA reads the station's
  combined figures, so a multi-inverter site is handled the same way as a single
  one.
- Systems with or without a battery. Battery power and state of charge are read
  when the station reports them, and left empty when it does not.

## The HomeKit / smart meter requirement

Grid and home consumption readings come from a GoodWe HomeKit or a smart meter
fitted alongside the inverter. Without one, SEMS only knows what the inverter is
generating — it cannot tell how much of that goes to the house and how much goes
to the grid.

ChargeHA needs the grid figure to decide how much surplus solar is available. If
the station has no HomeKit or meter, setup fails with a message saying the
station reports no power flow data. Solar-aware charging cannot work on that
station until a meter is fitted.

## Setup

1. In the setup wizard, choose **GoodWe (Cloud / SEMS Portal)** as your energy
   source.
2. Enter the email address and password for your SEMS account — the same
   credentials as the SEMS mobile app or web portal.
3. Click **Load Stations**. ChargeHA logs in and lists every station on the
   account.
4. Pick your station from the list.
5. Run the connection test. It confirms the login works and that the station
   reports power flow data.

The password is stored in the database, and encrypted at rest only if
`ENCRYPTION_KEY` is set. You can change the account, password, or station later
from the plugin's settings panel.

Both the current SEMS Portal login and the older one are supported. ChargeHA
tries each and uses whichever your account accepts, so there is nothing to
choose.

## Polling

Readings refresh every **60 seconds**.

That is slower than the local integrations, which poll their inverter directly
on your LAN every few seconds. Two reasons:

- Every reading is a round trip to GoodWe's cloud, so it is slower and less
  reliable than a call on your own network.
- SEMS actively rate limits. The endpoint ChargeHA uses is the one the mobile
  app uses, and polling it hard gets the account throttled.

The practical effect is that ChargeHA reacts to a cloud passing over your panels
a bit later than a local integration would. Charging still tracks solar; it just
adjusts on a one-minute cadence.

## Rate limits

If SEMS says you are being rate limited, ChargeHA stops making requests for **5
minutes** and keeps showing the last reading it got. Continuing to call during a
throttle is what turns it into a longer block, so it stays quiet.

If the throttle lasts longer than **15 minutes**, ChargeHA stops presenting the
old reading as current and reports the energy source as failed instead. You will
see an energy outage rather than numbers that quietly stopped moving.

Normal polling resumes on its own once the throttle clears. Nothing needs
restarting.

## Limitations

- Grid voltage is not available. SEMS reports it per inverter, but not in the
  station power flow figures ChargeHA reads.
- Readings are as fresh as the cloud makes them. SEMS itself updates on its own
  schedule, so a value can be a little older than the last poll.
- The account is shared with the SEMS app. Heavy use of the app at the same time
  contributes to the same rate limits.

## Troubleshooting

### "SEMS login rejected"

Check the email address and password by signing in to the SEMS app or the SEMS
Portal website. There is no separate API credential — it is your normal account
login.

### "SEMS station reports no power flow data"

The station has no HomeKit or smart meter, so grid and consumption figures do
not exist. See
[The HomeKit / smart meter requirement](#the-homekit--smart-meter-requirement).

### No stations in the list

The account has no stations registered against it. If your installer set up the
system under their own account, ask them to share or transfer the station to
yours.

### Readings stop updating

Check the logs for a rate-limit warning. If SEMS is throttling, ChargeHA pauses
and recovers on its own. Otherwise confirm the SEMS app itself shows live data —
if it does not, the problem is between the inverter and GoodWe's cloud.

## Testing without a SEMS account

A simulator that speaks the SEMS wire protocol ships with the project, so the
integration can be exercised end to end without a GoodWe account:

```
deno task sems:sim          # listens on http://localhost:8099
```

Point ChargeHA at it by setting `GOODWE_SEMS_BASE_URL=http://localhost:8099`.
Leave that unset to talk to the real SEMS Portal.

Setting `GOODWE_SEMS_GATEWAY_PROBE=1` (in the environment or `.env`) enables a
shadow probe of the native SEMS+ gateway flow endpoint: every 30 minutes the raw
gateway response is logged beside the legacy powerflow it should mirror, without
affecting the data ChargeHA serves. Diagnostics for the 2026-08-30 legacy portal
shutdown; implemented entirely in `SemsGatewayProbe.ts`.

It serves four station profiles (three-phase without a battery, hybrid with a
battery, multi-inverter, and one with no HomeKit fitted), simulates a daily
solar curve, and can inject rate limits and expired tokens on demand. See
[the simulator's README](../devtools/sems-simulator/README.md) for the full list
of controls.
