# Charge Controller

The charge controller is the core automation loop that decides when and how to
charge each vehicle. It runs as a background service on a configurable timer
(default 30 seconds, `controller_loop_seconds`) and evaluates every configured
vehicle on each cycle.

## Architecture

The controller is split into two layers:

- **`ChargeController`** (`server/src/services/ChargeController.ts`) — the
  orchestrator. Owns the loop timer, loads config from DB, requests vehicle
  state through `VehicleManager` (with context flags for the middleware), reads
  the latest energy snapshot, calls the engine, executes the returned decisions
  via adapter commands, emits events for notifications, and writes decision
  logs.
- **`ControllerEngine`** (`shared/engine/ControllerEngine.ts`) — the pure
  decision engine. No I/O, no database, no adapters. Takes the current state of
  the world and returns per-vehicle decisions. Lives in `shared/` so it can be
  used by both the server and the in-browser simulator.

## Loop overview

Each cycle (`ChargeController.runOnce()`):

1. Load config from DB via `ConfigService` (charging, solar, battery, system)
2. If `chargingEnabled` is `false`, the engine returns `none` for all vehicles
3. Load all vehicles and schedules from DB
4. Get the latest energy snapshot from the `EnergyPoller`
5. For each vehicle, call `VehicleManager.requestState()` with context
   (`hasSolar`, `hasSchedule`, `hasBlockout`, optional schedule charge limit) so
   the per-plugin middleware can make cost-aware fetch / cache / wake decisions
6. Run the pure decision engine (`engine.decide()`)
7. For each vehicle, execute the decision (adapter commands), emit events, and
   build the log entry
8. Batch-insert all decision log entries into `controller_logs`
9. Every 100 loops, prune logs older than the configured `logRetentionDays`

The loop uses `setTimeout` (not `setInterval`) so each cycle waits for the
previous one to finish before scheduling the next. The interval is read from
`controllerLoopSeconds` config each cycle.

## Decision pipeline

For each vehicle, the engine runs through a series of checks in order. The first
check that produces an action wins — later checks are skipped.

### Pre-checks (all modes)

These run before considering the vehicle's mode:

1. **Vehicle state available?** — If the vehicle hasn't been polled yet, skip
   it.
2. **Plugged in?** — If the vehicle isn't plugged in, skip it.
3. **Location** — If the vehicle is confirmed away from home, suspend
   automation.
4. **Battery at charge limit?** — If the vehicle's battery level >= its charge
   limit, stop charging (or do nothing if already stopped). Special case: at
   100% limit, treats 99% as "done" if already stopped (avoids retrying the last
   1%).

### Mode evaluation

After pre-checks pass, the vehicle's mode determines what happens:

#### `stop` mode

Stop charging immediately. Idempotent — only sends a stop command if the vehicle
is currently charging.

#### `charge_now` mode

Charge at maximum amps. Starts charging if stopped, adjusts amps to max if not
already there. Temporary — the mode automatically resets back to `auto` when the
vehicle is unplugged (along with `stop` mode), so both act as one-shot manual
overrides.

#### `auto` mode

This is where the main logic lives. The checks run in priority order:

1. **Blockout schedule** — If an active blockout schedule covers the current
   time, stop charging. Blockout schedules apply to all vehicles.

2. **Charge schedule** — If an active charge schedule applies (either targeting
   this vehicle or all vehicles), charge at the schedule's configured amps (or
   max if not specified). If the schedule has a charge limit and the battery has
   reached it, fall through to solar tracking instead.

3. **Battery priority** — If enabled and the home battery SoC is below the
   configured threshold, stop charging to let the home battery charge first.

4. **Solar tracking** — The main solar-following logic (see below).

5. **Fallback** — If nothing above applied, stop charging (or do nothing if
   already stopped). Marks the vehicle as suspendable.

## Solar tracking

Solar tracking dynamically adjusts charging amps based on available solar power.

### Pre-gates

Before calculating available solar, two threshold checks run:

- **Min solar generation** — If solar production is below
  `minSolarGenerationKw`, stop (or skip). Exception: if production is above zero
  and the vehicle is already charging, the check passes to let the normal grace
  period handle the dip instead of stopping immediately (prevents rapid cycling
  at sunrise/sunset).
- **Min excess solar** — If configured and excess solar is below
  `minExcessSolarKw`, don't start charging. Already-charging vehicles pass
  through to let grace period handle it.

### Available solar calculation

Two reference modes:

- **Excess mode** (default): Uses the grid export value (`-gridPowerW`). This
  represents solar that would otherwise be exported.
- **Gross mode**: Uses total solar production. Charges from all solar regardless
  of home consumption.

An adjustment is applied when the energy meter includes EV charging in its
consumption reading (the common case): the vehicle's current charge power is
added back to get the "true" available solar. This is skipped if
`consumptionExcludesCharging` is enabled.

A configurable safety margin (`solarMarginKw`) is subtracted from the result.

### Amps conversion

Available watts are converted to amps using the grid voltage (configurable,
default 230V) and phase count (1 or 3, configurable).

### Multi-vehicle solar allocation

When multiple vehicles are charging, the `SolarAllocator` distributes available
solar amps across vehicles. Two modes:

- **Equal** — split evenly across all charging vehicles
- **Waterfall** (priority charging enabled) — allocate by vehicle priority,
  higher-priority vehicles get their share first

The allocated amps override the per-vehicle calculation.

### Insufficient solar handling

When available solar can't sustain minimum charging amps:

1. **Grace period** — If the vehicle is currently charging, a timer starts. The
   vehicle drops to minimum amps during the grace period (default 6 minutes) to
   ride out brief cloud cover.
2. **Grace expired** — In `solar_only` mode, charging stops and a cooldown
   period begins. In `solar_grid` mode, charging continues at minimum amps from
   the grid instead.
3. **Cooldown** — The vehicle won't restart charging for the cooldown duration
   (default 15 minutes), even if solar recovers. This prevents rapid on/off
   cycling.

### Solar+Grid fallback

When `solarTrackingMode` is `solar_grid`, instead of stopping when solar is
insufficient, the vehicle charges at minimum amps from the grid. This applies
both when the vehicle is not yet charging and when the grace period expires.

### Amp debouncing

To avoid sending frequent small amp adjustments to the vehicle, the engine
debounces amp changes below a configurable threshold (`ampDebounceThreshold`).
Small changes must remain stable for `ampDebounceSettleMinutes` before being
applied. Large changes (above the threshold) are applied immediately.

## Idempotent commands

Both `startChargingAt` and `stopCharging` on `VehicleManager` are idempotent:

- `startChargingAt` only sends `setChargeAmps` if the current amps differ from
  the target, and only sends `startCharging` if the vehicle isn't already
  charging.
- `stopCharging` only sends `stopCharging` if the vehicle is currently charging.

This means the controller can safely re-evaluate every cycle without spamming
the vehicle API.

## Vehicle data fetches

Vehicle data is middleware-driven, not timer-driven. On each loop the controller
calls `VehicleManager.requestState(id, context)` once per vehicle. The
per-plugin `VehicleMiddleware` decides whether to serve cache, do a cheap online
check, fetch fresh data, or wake the car — based on the context flags
(`hasSolar`, `hasSchedule`, `hasBlockout`, `forceRefresh`) and its own cost
model. See `data-collection.md` for the full request/cache/wake flow.

A `suspendable` hint is included on each engine decision and persisted with the
log entry, but it is not currently acted on by the controller — wake suppression
is now the middleware's job.

## Decision logging

Every cycle produces a log entry per vehicle with:

- **inputs**: Energy snapshot, vehicle state, active config, active schedules
- **checks**: An ordered list of each check performed and its result
- **action**: `start`, `stop`, `adjust_amps`, or `none`
- **actionDetail**: Human-readable explanation of the decision
- **targetAmps**: The target amps if applicable

These logs are stored in `controller_logs` and are viewable in the Logs page of
the UI. They are the primary debugging tool for understanding why the controller
made a particular decision.

## Controller events

The orchestrator detects state transitions between loops and emits typed events
for the notification system:

| Event                           | Trigger                                                                                                                                                                |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controller_charge_started`     | Vehicle was not charging → now charging (by controller)                                                                                                                |
| `controller_charge_stopped`     | Vehicle was charging → now stopped. Carries a `reason` field; `battery_at_limit` drives the "charge complete" notification, all other reasons drive "charging stopped" |
| `controller_external_charge`    | Vehicle started charging outside the controller                                                                                                                        |
| `controller_low_solar`          | Grace period started (solar dropped)                                                                                                                                   |
| `controller_schedule_activated` | New schedule became active since last loop                                                                                                                             |
| `controller_status`             | Emitted every loop with the full per-vehicle decision payload, consumed by the SSE subscription                                                                        |

The first loop after startup suppresses transition events to avoid false
notifications from stale state.

## Per-vehicle runtime state

The engine tracks in-memory state per vehicle (not persisted to DB):

| Field                    | Purpose                                                                 |
| ------------------------ | ----------------------------------------------------------------------- |
| `initialized`            | False until first cycle — suppresses false transition notifications     |
| `prevState`              | Vehicle state from end of previous loop (for transition detection)      |
| `graceStartedAt`         | Timestamp when the grace period began (null if not in grace)            |
| `graceNotified`          | Whether the low-solar notification has been emitted for this grace      |
| `cooldownUntil`          | Timestamp when cooldown expires (null if not cooling down)              |
| `lastActiveScheduleIds`  | Set of schedule IDs that were active last cycle (for activation events) |
| `blockoutChargeNotified` | Whether a blockout-during-charging notification was emitted             |
| `pollingSuspended`       | Whether the vehicle's poller is currently suspended                     |
| `allocatedAmps`          | Pre-computed solar allocation for this vehicle (set each loop)          |
| `pendingAmps`            | Debounced target amps waiting to settle                                 |
| `pendingSince`           | Timestamp when pendingAmps was first seen                               |

This state is lost on server restart, which is safe — grace periods, cooldowns,
and debounce state will simply reset.

## Config keys

| Key                             | Default      | Description                                          |
| ------------------------------- | ------------ | ---------------------------------------------------- |
| `charging_enabled`              | `true`       | Master switch for the controller                     |
| `controller_loop_seconds`       | `30`         | Seconds between each evaluation cycle                |
| `solar_tracking_enabled`        | `true`       | Whether to follow solar production                   |
| `solar_tracking_mode`           | `solar_only` | `solar_only` or `solar_grid`                         |
| `solar_reference`               | `excess`     | `excess` (grid export) or `gross` (total production) |
| `solar_margin_kw`               | `0`          | Safety margin subtracted from available solar (kW)   |
| `min_solar_generation_kw`       | `0.2`        | Minimum solar production to consider tracking        |
| `min_excess_solar_kw`           | (null)       | Optional minimum excess solar to start charging      |
| `grid_voltage`                  | `230`        | Grid voltage for amps calculation                    |
| `three_phase_charger`           | `false`      | Whether the charger uses 3 phases                    |
| `consumption_excludes_charging` | `false`      | Whether the meter excludes EV load from consumption  |
| `grace_period_minutes`          | `6`          | How long to keep charging when solar drops           |
| `cooldown_period_minutes`       | `15`         | How long to wait after stopping before restarting    |
| `amp_debounce_threshold`        |              | Amp change threshold below which debouncing applies  |
| `amp_debounce_settle_minutes`   |              | How long a small amp change must be stable to apply  |
| `battery_priority_enabled`      | `false`      | Whether to prioritize home battery charging          |
| `battery_priority_limit`        | `80`         | Home battery SoC threshold (%)                       |
| `priority_charging_enabled`     | `false`      | Use waterfall allocation instead of equal split      |
