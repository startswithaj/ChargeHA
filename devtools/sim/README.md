# sim

Simulators for testing charge controller behaviour against synthetic solar data.

## Files

- **cli.ts** — CLI: runs the shared simulation engine and prints per-minute
  data + summary stats (amp changes, start/stop frequency, charging minutes).
- **browser/** — Vite-based interactive UI: same simulation engine, with live
  charts of solar, charging power, and battery state.

Both entry points use the canonical engine in `packages/shared/simulation/`
(pure `ControllerEngine.decide()`, no DB or service wiring).

## Usage

```sh
# Charge sim with analysis (1 vehicle)
deno run -A devtools/sim/cli.ts

# Charge sim with 2 vehicles
deno run -A devtools/sim/cli.ts --vehicles=2

# CSV output
deno run -A devtools/sim/cli.ts --csv

# Browser sim
cd devtools/sim/browser && deno run -A npm:vite
```
