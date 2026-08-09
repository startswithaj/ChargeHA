# OCPP Chargers

ChargeHA speaks OCPP 1.6-J. Your charger connects to ChargeHA over a WebSocket
and reports what it is doing; ChargeHA sets the current and starts and stops the
charge. Two things happen behind the scenes that are worth knowing about: what
ChargeHA asks the charger to measure, and how it reads a 3-phase charger.

## What the charger is asked to report

OCPP 1.6 only requires a charger to report one thing — its cumulative energy
register. Everything else is optional and off by default on plenty of hardware.
A charger reporting only the register leaves ChargeHA with no current and no
voltage, which is a problem: current is the quantity solar tracking steers by.

So when a charger connects, ChargeHA asks it to report four things — the energy
register, current, voltage and power — and to send a sample every 30 seconds.

1. **A charger already reporting all four is left alone.** ChargeHA reads its
   configuration before writing anything.
2. **A charger reporting less is reconfigured.** If it refuses the full list,
   ChargeHA asks once more for the subset the charger says it supports, then
   stops asking. Retrying forever would just hammer the charger.
3. **Sampling is only ever sped up.** A charger already sampling faster than
   every 30 seconds keeps its own interval.
4. **ChargeHA never reboots your charger.** Some chargers store the change but
   need a restart to apply it — ChargeHA tells you, and you restart it yourself
   when nothing is charging.

30 seconds is the sample interval because the controller re-decides on roughly
that cadence. Slower and it would steer on stale readings; faster buys nothing.

### When it doesn't work

If the charger ends up sending readings with no current in them, ChargeHA raises
a health **warning** — not an error. The charger still charges correctly; solar
tracking is just less precise, because ChargeHA has to estimate the current from
power and voltage instead of reading it. The warning names the state the charger
is actually in (refused, read-only, needs a restart, doesn't support the setting
at all), because each one has a different fix.

The warning is evidence-based, not based on what the charger promised. A charger
that says yes and changes nothing is still caught. A charger sitting idle with
no car plugged in sends no readings at all, and is never accused on that basis.

## 3-phase readings

A 3-phase charger sends one sample per phase rather than one figure for the
installation. ChargeHA combines them:

- **Power and energy are summed** across the phases. Reading only the first
  phase reported power at a third of what the charger was actually delivering.
- **Current is averaged across the active phases only.** Amps are a per-phase
  limit: a charger held to 16A draws 16A on each phase it is using. A charger
  reporting 16/16/0 is charging at 16A, not 10.7A — averaging in the idle
  phase's zero would invent headroom that isn't there.
- **Voltage is converted to line-to-neutral.** A charger reporting line-to-line
  voltage (400V on a European supply) has it divided by √3, since everything
  downstream assumes line-to-neutral (230V).

A sample that won't parse is dropped rather than allowed to poison the total,
and a reading that says nothing about a measurand never overwrites the last good
one ChargeHA holds.
