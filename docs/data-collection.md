# Data Collection

This document explains how ChargeHA collects data from the energy adapter and
from vehicles, how that data flows through the system, and how it gets recorded
to the database and pushed to the frontend.

## Architecture overview

```
Energy Plugin (Fronius, etc.)        Vehicle Plugin (Tesla, Simulated, etc.)
       │                                       │
       ▼                                       ▼
EnergyAdapterManager                   VehicleMiddleware (per-plugin)
  (implements EnergySourceAdapter)             │
       │                                       │   serves cache, decides
       ▼                                       │   when to fetch / wake
EnergyPoller (5s)                              │
       │                                       ▲
       │                              VehicleManager.requestState()
       │                                       ▲
       │                              ChargeController (each tick,
       │                                       │   passes hasSolar /
       │                                       │   hasSchedule context)
       │                                       │
       ├──► TypedEventEmitter ◄────────────────┘
       │     ("energy_update")        ("vehicle_update",
       │                               "vehicle_plug_changed",
       │                               "vehicle_error")
       │            │
       │            ├──► DataRecorder (60s) ──────► SQLite
       │            ├──► VehicleFetchLogger ───────► SQLite (vehicle_poll_logs)
       │            ├──► Notification listeners
       │            └──► tRPC SSE subscription ────► React Query ──► UI
       │
       ▼
ChargeController (reads latest energy snapshot)
```

Two collection paths feed data into the system, but they have **different
shapes**:

- **Energy collection is timer-driven.** The `EnergyPoller` ticks every 5s and
  emits `energy_update`.
- **Vehicle collection is request-driven.** There is no vehicle timer. The
  `ChargeController` requests state on each controller tick, passing context
  (hasSolar, hasSchedule, hasBlockout) so the per-plugin `VehicleMiddleware` can
  make cost-aware fetch / cache / wake decisions.

Both paths converge at the `TypedEventEmitter`, which routes events to the SSE
subscription (frontend), persistence layers, and notification listeners.

## Energy data collection

### Energy adapter manager

Source: `packages/server/src/services/EnergyAdapterManager.ts`

The `EnergyAdapterManager` owns the energy adapter lifecycle. It implements the
`EnergySourceAdapter` interface and delegates to the active plugin adapter. On
startup, it reads the `energy_adapter_type` config from the DB, initializes the
corresponding plugin via `EnergyPluginRegistry`, and creates the adapter.

It also handles:

- **Hot-swap on config change** — `reconfigureAndRestart()` builds a new adapter
  from the current DB config and restarts the poller.
- **Simulated load injection** — when simulated vehicles are charging, their
  power draw only exists in software. `getRealtimeData()` adds the simulated
  wattage to `homeConsumptionW` and `gridPowerW` so the rest of the system sees
  it as if it were real meter data.

### Energy poller

Source: `packages/server/src/services/EnergyPoller.ts`

The energy poller drives energy data collection on a configurable interval
(default **5 seconds**, read from `adapter.pollIntervalSeconds`). Each poll:

1. Fetches realtime data from the adapter (via `EnergyAdapterManager`).
2. Builds cumulative daily totals from DB recordings (using the configured
   timezone so the "today" boundary matches the user's local day).
3. Caches the latest snapshot in memory (used by `ChargeController`).
4. Emits an `energy_update` event on the `TypedEventEmitter`.
5. Emits `energy_poll_success` or `energy_poll_failure` for the notification
   listener.

If a poll fails, the error is logged and the poller continues on the next
interval.

## Vehicle data collection

The vehicle path was previously timer-driven (a per-vehicle `VehiclePoller` with
adaptive intervals). It is now **request-driven** through a middleware layer.
Rationale and migration history live in
`docs/design-vehicle-data-middleware.md`.

### Vehicle adapters

Source: `packages/plugins/vehicles/<plugin>/server/`

Vehicle adapters live in plugins as self-contained modules. Each implements the
low-level `VehicleAdapter` interface (raw API calls: get state, start, stop, set
amps, wake).

### Vehicle middleware

Source: e.g. `packages/plugins/vehicles/tesla/server/TeslaVehicleMiddleware.ts`

Each plugin provides a `VehicleMiddleware` that wraps its adapter. The
middleware is the **cache + cost decision layer**: it owns the cached state,
decides whether a request can be served from cache, whether to do a cheap online
check, whether to fetch fresh data, or whether to wake the car.

```ts
interface VehicleMiddleware {
  requestState(ctx: VehicleRequestContext): Promise<VehicleChargeState | null>;
  getCachedState(): VehicleChargeState | null;
  seedState(state: VehicleChargeState): void;
  readonly online: boolean;
  startCharging(ctx: CallContext): Promise<boolean>;
  stopCharging(ctx: CallContext): Promise<boolean>;
  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean>;
}
```

Each plugin tunes its middleware to its API's cost model — Tesla's, for example,
optimises around the Fleet API's pay-per-call wake/data pricing.

### Request context

Every state request carries a `VehicleRequestContext` so the middleware can make
cost-aware decisions:

```ts
interface VehicleRequestContext extends CallContext {
  hasSolar: boolean; // solar above min generation threshold
  hasSchedule: boolean; // active charge schedule
  hasBlockout: boolean; // active blockout schedule
  scheduleChargeLimitPct?: number | null;
  forceRefresh?: boolean; // user-initiated refresh, skip cache
}
```

The middleware uses these flags to answer questions like _"is it worth waking
the car right now?"_ — if there's no solar, no schedule, and no blockout, it
will typically serve from cache to save API calls.

### Vehicle manager

Source: `packages/server/src/services/VehicleManager.ts`

The vehicle manager is the central registry between callers (controller, tRPC
service) and the per-plugin middlewares. It:

- Creates middlewares from database rows via plugin-provided factories
  (`addVehicle()`).
- Exposes `requestState(id, context)` as the single data entrypoint — wraps the
  middleware call, detects plug transitions, emits events.
- Exposes `getState()` / `getAllStates()` for cache-only reads (no API call).
- Seeds cached state from recent controller logs on startup so the dashboard
  shows last-known values while vehicles are asleep.
- Detects plug transitions on each successful state fetch and emits
  `vehicle_plug_changed` events.
- Tracks per-vehicle command backoff (exponential, 30s → 15min cap) and
  fetch/command errors; emits `vehicle_error`.
- Auto-resets `charge_now` and `stop` modes back to `auto` on unplug.
- Resolves home/away via `isVehicleHome(id)` using `home_latitude` /
  `home_longitude` config and a haversine check.

There is no vehicle polling timer. Fresh data is pulled on demand:

- **Controller tick** — `ChargeController` calls `requestState()` for each
  managed vehicle on every loop.
- **User refresh** — the dashboard calls through to `VehicleService` →
  `requestState({ forceRefresh: true })`.

### Plug transition detection

When `requestState()` returns a state with a different `isPluggedIn` value than
the previous tracker for that vehicle, `VehicleManager` emits
`vehicle_plug_changed` with `{ vehicleId, vehicleName, isPluggedIn, isHome }`.
The first data point after server start does not fire (avoids false alerts on
restart).

The mode-reset listener watches for `isPluggedIn: false` and resets `charge_now`
/ `stop` overrides back to `auto`.

### Vehicle fetch logger

Source: `packages/server/src/services/VehicleFetchLogger.ts`

A small subscriber on `vehicle_update` that writes a row to the
`vehicle_poll_logs` table for every successful fetch (battery / plug / charging
/ amps snapshot). The table keeps the legacy "poll" name because renaming would
require a migration; it is now populated on-demand, not from a timer.

## Data recording

Source: `packages/server/src/services/DataRecorder.ts`

The data recorder subscribes to `energy_update` events and writes to SQLite on a
configurable interval (default **60 seconds**, read from
`recording_interval_seconds`).

### Energy readings

Every interval, inserts the latest realtime energy snapshot into the
`energy_readings` table along with the current tariff rate (resolved by
`TariffService`):

- `solar_production_w`, `grid_power_w`, `home_consumption_w`, `battery_power_w`,
  `battery_soc`, `rate_per_kwh`.

### Vehicle charge readings

For each vehicle that is actively charging (`isCharging && chargePowerKw > 0`),
the recorder calculates solar attribution and inserts a row into
`vehicle_charge_readings`:

**Home vehicles** — solar vs grid split:

1. Calculate available solar:
   `max(0, solarProductionW - homeConsumptionW + chargePowerW)` — the charge
   power is added back because the meter already includes EV draw in home
   consumption.
2. If multiple vehicles are charging, each gets a proportional share:
   `chargePowerW / totalChargePowerW`.
3. Solar contribution: `min(chargePowerW, availableSolar * vehicleShare)`.
4. Grid contribution: `chargePowerW - solarContribution`.

**Away vehicles** — both solar and grid contributions are recorded as 0. Away
charging energy is tracked separately in stats.

Each row stores: `vehicle_id`, `charge_power_w`, `charge_amps`, `battery_level`,
`solar_contribution_w`, `grid_contribution_w`, `is_home`, `rate_per_kwh`.

### Data pruning

Every 100 recording ticks, the recorder prunes old data using the configurable
`data_retention_days` setting (default 730 days). It prunes energy readings,
vehicle charge readings, vehicle poll logs, and plugin logs.

## Frontend delivery

Source: `packages/server/src/trpc/routers/subscriptions.ts`

The frontend receives real-time data via a **single multiplexed SSE
subscription** (`subscriptions.onEvents`). One `EventSource` connection,
multiple event types — avoids the browser's 6-connection-per-origin HTTP/1.1
limit.

On connect, the subscription emits initial state (energy snapshot, all vehicle
states, all vehicle errors), then forwards live events as they occur. All events
are tagged with a `type` field (`energy_update`, `vehicle_update`,
`vehicle_error`, `controller_status`) so the client can route them.

Historical data and initial page loads use standard tRPC queries (e.g.
`energy.getRecent`, `stats.getDay`).

## Cadence summary

| Component                | Cadence                       | What it does                                              |
| ------------------------ | ----------------------------- | --------------------------------------------------------- |
| Energy poller            | 5 seconds (configurable)      | Fetches adapter data, emits event, feeds recorder         |
| Charge controller loop   | 60 seconds (configurable)     | Drives `requestState()` per vehicle, makes decisions      |
| Vehicle middleware fetch | On-demand (controller-driven) | Caches and serves vehicle state with cost-aware decisions |
| Data recorder            | 60 seconds (configurable)     | Writes energy + vehicle charge readings to SQLite         |
| Vehicle fetch logger     | Per `vehicle_update` event    | Writes a row to `vehicle_poll_logs`                       |
| Data pruning             | Every 100 recorder ticks      | Removes readings older than configured retention          |
