# Simulated load

Why ChargeHA sometimes adds a car's charging draw to the energy numbers, and why
it must not always do it.

## The problem

The dashboard needs `grid = home + car - solar`.

Whether that adds up depends on one thing: **does the grid reading already
include the car?**

- Already included, and we add it → the car is counted twice.
- Not included, and we don't add it → the app sees export that isn't there, and
  the charge controller ramps against surplus that doesn't exist.

## What sees what

A **real inverter** measures the switchboard. Real charging is genuinely flowing
through it, so its grid figure already includes the car. It cannot see a
simulated car, because no electricity moved.

A **simulated inverter** measures nothing whatsoever. It generates a curve
(`grid = home - solar`) from sun and background house load. It has no concept of
a car, real or otherwise.

A **simulated car** reports a draw that doesn't physically exist. Nothing can
measure it — not a real meter, not a simulated one.

## The four setups

**Simulated inverter + simulated car** — nothing real, nothing measured. Add the
draw.

**Simulated inverter + real car or charger** — the draw is real, but this
inverter measured nothing, so its figures have no trace of it. Add the draw.

**Real inverter + simulated car** — inverter is real, car isn't. No electricity
moved, so there's nothing for it to have measured. Add the draw.

**Real inverter + real car or charger** — real power, really measured, already
in the reading. Add nothing.

## Why two numbers

A single load total can't express that table:

- Always add → real customers double-count their charger.
- Only add when the inverter is simulated → simulated cars stop registering on
  real hardware.

So live load is reported as two figures:

- **unmetered** — loads nothing can see (simulated cars). Always added.
- **metered** — real draw a physical meter would have caught. Added only when
  the active adapter measured nothing, i.e. the simulated inverter.

Both figures are decided by the plugin behind the charging point, not by what
kind of point it is. A car's own charging point and a smart charger can each be
a simulation that moves no electricity, and each declares `loadIsUnmetered`.

Metered is the default, so anything that does not declare itself is assumed
real. The in-memory simulated charger declares itself unmetered; the OCPP
simulator does not, because it is indistinguishable from real hardware over the
wire.

## Where it happens

`ChargingPointManager` splits current load into the two figures. It reads cached
charger and vehicle state — no device I/O — and de-duplicates: a car charging
through a charger is one physical load, so the charger's reading wins and that
vehicle is skipped.

`EnergyAdapterManager` decides which figures apply, based on which energy
adapter is active, and adds them to `homeConsumptionW` and `gridPowerW` as the
reading passes through.

The energy adapters themselves know nothing about this. A simulated inverter
keeps inventing its curve; the correction happens after it returns.

## Effect on the charge controller

If the draw is missing from the reading, the controller's feedback loop never
closes:

1. Sees export, raises the amps.
2. Car draws more, but the grid figure doesn't move — the inverter never saw it.
3. Sees the same export, raises again.

Solar tracking and charge-oscillation detection both depend on the grid figure
responding to the car.

## Note

The test is not "is the inverter simulated" — it is whether the equipment
reporting the figures could already have seen that particular load. That is why
the load is classified, not just the adapter.
