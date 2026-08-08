# sap-simulator

Standalone OCPP 1.6 virtual charge point for local development, using
[SAP/e-mobility-charging-stations-simulator](https://github.com/SAP/e-mobility-charging-stations-simulator)
(Apache-2.0). Built from a pinned git clone in `Dockerfile` — upstream source is
not vendored into this repo.

Unlike `devtools/ocpp-simulator` (a simple charge point), this simulator adds a
physics-based EV battery/SoC model and real smart-charging throttling: it reads
`SetChargingProfile` limits and caps its simulated power draw to match.

## Usage

Start the dev server first, then:

```sh
deno task dev
docker compose -f devtools/sap-simulator/docker-compose.yml up -d --build
```

- Charge point id: `vcp-dev-2`
- Connects to: `ws://host.docker.internal:8000/api/charger/ocpp/vcp-dev-2`
- Admin UI API: `ws://localhost:18080` (basic auth `admin` / `admin`)

Logs:

```sh
docker compose -f devtools/sap-simulator/docker-compose.yml logs -f
```

Stop:

```sh
docker compose -f devtools/sap-simulator/docker-compose.yml down
```

## How the id and URL work

- `station-template.json` sets `"baseName": "vcp-dev-2"` and
  `"fixedName": true`. `fixedName: true` makes the simulator use `baseName`
  unchanged as the charge point id (no numeric suffix). `config.json` sets
  `numberOfStations: 1` for this template — with `fixedName: true`, more than
  one station would collide on the same id.
- `config.json`'s `supervisionUrls` is
  `ws://host.docker.internal:8000/api/charger/ocpp` — the simulator appends
  `/<chargingStationId>` itself, giving the URL above, which matches our
  `GET /api/charger/ocpp/:chargerId` route.
- `host.docker.internal` reaches the host's dev server from inside the
  container. `extra_hosts` in `docker-compose.yml` makes this resolve on Linux
  too (Docker Desktop provides it out of the box).

The app only adopts a charge point id already configured on an OCPP charger row,
unless the panel's pairing mode ("Listen") is active — in which case an
unrecognised id is accepted provisionally so you can pair it. Either pair
`vcp-dev-2` via the panel, or add an OCPP charger row configured with that id
before starting the container.

## The EV / battery model

- `station-template.json` sets `"coherentMeterValues": true` and
  `"evProfilesFile": "ev-profiles-vcp-dev-2.json"`. This turns on the
  simulator's physics-based MeterValues generation (voltage → power → current →
  energy → SoC) instead of random values.
- `ev-profiles-vcp-dev-2.json` describes the simulated car: battery capacity,
  max onboard charge power, starting SoC range, and a charging curve (power
  fraction vs. SoC, e.g. tapering near full).
- The connector's `MeterValues` array in `station-template.json` explicitly
  declares `Current.Import`, `Voltage`, `Power.Active.Import`, and
  `Energy.Active.Import.Register` (plus `SoC`). Coherent mode only fills in
  measurands that are already declared — leaving one out means it's never
  emitted. ChargeHA reads amps from `Current.Import`, so this is required.

### Changing the simulated car

Edit `ev-profiles-vcp-dev-2.json`:

- `batteryCapacityWh` — pack size.
- `maxPowerW` — max power the car's onboard charger will draw (the station's own
  7.4 kW cap in `station-template.json` still applies on top of this).
- `initialSocPercentMin` / `initialSocPercentMax` — random starting SoC range
  each time a transaction starts.
- `chargingCurve` — list of `{ socPercent, powerFraction }` points; power tapers
  as SoC rises between them.

Multiple profiles can be listed with a `weight` each, and one is picked at
random per transaction. Rebuild after editing:
`docker compose -f devtools/sap-simulator/docker-compose.yml up -d --build`.

## Smart charging / throttling

The template declares `SmartCharging` in `SupportedFeatureProfiles`. The
simulator takes the minimum of connector max power, hardware max, any amperage
limitation, and any active `SetChargingProfile` limit (station-wide or
per-connector) — so a limit set via ChargeHA's app actually caps the simulated
charge current, not just gets acknowledged.

## Config baked in, not bind-mounted

Upstream has no volume-based config story: `config.json`, station templates, and
EV profile files are copied into `src/assets/` and bundled into `dist/assets/`
at build time (`scripts/bundle.js`). `Dockerfile` follows that same path —
copying our three files into the clone's `src/assets/` before `pnpm build` —
rather than bind-mounting over `dist/assets/*` after the fact. That means
editing any of these three files requires a rebuild (`--build`), but avoids
fighting the bundler's own asset-copy step or guessing at its output layout
across upstream versions.

Note: the EV profile file must be named `ev-profiles*.json` (not
`ev-profiles-template.json`) and live at the root of `src/assets/` — the
bundler's copy glob only picks up that path, not `station-templates/`.
`evProfilesFile` in the template only needs to match by basename.

## Multiple chargers

Same pattern as `ocpp-simulator`: give each instance its own compose project
name, station template baseName/id, and host port.
