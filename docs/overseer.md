# Overseer

The overseer is a safety watchdog that monitors the charge controller's decision
logs for signs of oscillation — rapid start/stop cycling that could damage
vehicle charging hardware or the electrical system. It runs independently from
the controller on its own timer.

Source: `server/src/services/Overseer.ts`

## How it works

Every **60 seconds**, the overseer:

1. Queries `controller_logs` for all `start` and `stop` actions from the last
   **60 minutes**, ignoring any transitions before the last trip (so re-enabling
   charging doesn't immediately re-trip on the same history)
2. Groups those rows by vehicle ID (ordered by timestamp)
3. Counts **transitions** — each time the action flips between `start` and
   `stop`
4. If any vehicle exceeds **3 transitions** in the window, the overseer trips

### What counts as a transition

Only `start` and `stop` log entries are queried. Other actions (`adjust_amps`,
`none`) are ignored entirely.

A transition is when consecutive entries for the same vehicle alternate:

- `start` → `stop` = 1 transition
- `stop` → `start` = 1 transition
- `start` → `start` = 0 transitions (duplicate, no change)
- `stop` → `stop` = 0 transitions (duplicate, no change)

So a sequence of `start, stop, start, stop` = 3 transitions, which is within the
limit. Add one more (`start, stop, start, stop, start`) = 4 transitions, which
triggers a trip.

### Safety gate

The overseer only trips when the last logged action for the vehicle is `stop`.
If the vehicle is mid-charge (last action is `start`), it waits for the
controller to stop it naturally, then trips on the next check cycle. This avoids
disabling the controller while a vehicle is actively drawing power.

## What happens when it trips

The overseer writes three config values to the database:

1. **`charging_enabled` = `"false"`** — Disables the charge controller's main
   loop. The controller checks this flag at the start of every cycle and returns
   `none` for all vehicles. No more start/stop commands will be sent.

2. **`oscillation_trip_at`** — Timestamp of the trip. On subsequent checks, the
   overseer ignores transitions before this time, so re-enabling charging
   doesn't immediately re-trip.

3. **`system_alert`** — A JSON payload stored in the config table:
   ```json
   {
     "message": "Charging disabled: Model 3 had 3 start/stop cycles in 60 minutes, which may indicate oscillation. Re-enable charging from Settings when ready.",
     "timestamp": "2026-03-02T10:30:00.000Z",
     "vehicleId": "LRW3E7EK...",
     "vehicleName": "Model 3"
   }
   ```

The overseer emits a `safety_trip` event on the `TypedEventEmitter` and logs an
error with the vehicle name, ID, and cycle count. `NotificationListener`
subscribes to `safety_trip` and forwards it to `NotificationService` for user
delivery — the overseer itself never calls `NotificationService` directly.

Only one trip is processed per check cycle (it stops after the first vehicle
that exceeds the threshold).

## Recovery

Two independent actions are available to the user:

1. **Re-enable charging** — Toggle the charging switch in the Settings UI. This
   sets `charging_enabled` back to `"true"` and the controller loop resumes on
   its next cycle.

2. **Dismiss the alert banner** — Click "Dismiss" on the red alert banner shown
   at the top of the Dashboard. This calls
   `trpc.config.dismissSystemAlert.useMutation()` which clears the
   `system_alert` config value via `ConfigService`. The banner disappears.

These are intentionally independent — dismissing the banner does not re-enable
charging, and re-enabling charging does not dismiss the banner. This ensures the
user makes a conscious decision about both.

## Dashboard alert banner

When `system_alert` is set, the Dashboard shows a red-accented card at the very
top (above the energy overview) with:

- An alert triangle icon
- The alert message and a "Safety Alert" heading
- A "Dismiss" button

The Dashboard polls for the alert every 30 seconds via
`trpc.config.systemAlert.useQuery`.

## Architecture

The overseer is fully decoupled from the charge controller:

- The **controller** writes log entries to `controller_logs` as part of its
  normal operation
- The **overseer** reads those log entries on its own schedule
- They share no in-memory state
- The overseer's only side effects are writing config values and sending a
  notification

This means the overseer would still catch oscillation even if the controller was
restarted during an oscillation event, since it reads from persisted logs.

## Constants

| Constant            | Value         | Description                                   |
| ------------------- | ------------- | --------------------------------------------- |
| `CHECK_INTERVAL_MS` | `60000` (60s) | How often the overseer runs its check         |
| `WINDOW_MINUTES`    | `60`          | Rolling window to look back for state changes |
| `MAX_TRANSITIONS`   | `3`           | Maximum allowed transitions before tripping   |
