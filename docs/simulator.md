# Simulators

Three ways to run the charge controller against synthetic data. All use the same
pure engine (`packages/shared/engine/ControllerEngine.ts`) — no database, no
adapters — so results match what the real controller would decide.

|                | Where                                    | What it runs                                                            | Best for                                                 |
| -------------- | ---------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------- |
| Solar preview  | Settings → Solar Tracking → **Simulate** | One `decide()` at a chosen time/day, with your real vehicles and config | "What would it do right now if solar were X?"            |
| Simulator page | `/simulator` in the app                  | A full day, minute by minute, with made-up vehicles                     | Tuning grace/cooldown/debounce, multi-vehicle allocation |
| Devtools sim   | `devtools/sim/` (CLI + browser)          | Same day run as the Simulator page                                      | Scripted analysis, CSV, seeds, regression numbers        |

## Solar preview (Settings)

- `packages/client/src/components/SolarSimulation/SolarSimulation.tsx`
- Uses `previewSolarAllocation` from `packages/shared/solarPreview.ts`.
- Inputs: solar kW, home consumption kW, home battery SOC/power (if you have
  one), time of day, day of week. Per-vehicle: battery level, mode.
- Reads your real config and schedules. Shows the allocation and decision each
  vehicle would get at that instant.
- Single tick only — no grace, cooldown, or debounce history.

## Simulator page (app)

- `packages/client/src/components/pages/Simulator/Simulator.tsx`
- Runs `runSimulation` from `packages/shared/simulation/`.
- Solar day: peak kW, cloudiness, storm events, home load, sunrise/sunset, seed.
- Controller: min generation, min excess, grace, cooldown, amp debounce,
  allocation mode (equal / waterfall).
- Home battery: capacity, start SOC, max rate, battery priority.
- Per charging point: name, priority, battery start %, charge limit, battery
  kWh, min/max amps, **plug-in time** (all day, or a clock time the car arrives
  — for testing what happens when a higher-priority car shows up while another
  is already charging).
- Output: per-minute chart, starts/stops/final battery per vehicle, decision
  log.

## Devtools sim

Any change to control logic goes through here first. No exceptions.

- Run it before the change and after, same seeds.
- Run it under the conditions the change is for. Waterfall and equal. Clear and
  cloudy. Car arriving mid-day. Home battery on and off.
- Read the events, not just the totals. Totals can match while the thing is
  firing in the wrong place.
- 20 seeds minimum. One run tells you nothing.

- `devtools/sim/cli.ts` — prints per-minute data and stats. Flags:
  `--vehicles=2 --waterfall --seed=N --battery-kwh=13.5 --battery-soc=20
  --battery-priority --csv`.
- `devtools/sim/browser/` — `cd devtools/sim/browser && deno run -A npm:vite`.
  Same inputs as the Simulator page, plain HTML. Not type-checked by `check:all`
  (the directory is excluded), so keep it in step with `SimulationOptions` by
  hand.
- Both call the same `runSimulation`. Write scratch scripts against it for
  before/after comparisons across seeds — see `devtools/sim/README.md`. Loop
  seeds × scenarios. Pull `events`. Count per vehicle: starts, stops, restarts
  inside N minutes, minutes both charging, grid kWh while both charging.

## Adding an input

1. `packages/shared/simulation/types.ts` — add it to `SimulationOptions` or
   `VehicleConfig`.
2. `packages/shared/simulation/run.ts` — apply it.
3. `run.test.ts` — cover it.
4. Wire it into all three UIs that apply: Simulator page, devtools browser,
   devtools CLI. The Settings preview only needs it if it affects a single tick.
