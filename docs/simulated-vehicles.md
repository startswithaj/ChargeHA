# Simulated Vehicles

A simulated vehicle is a fully in-memory fake EV. It plugs into the same
charge-control flow as a real car, so you can test schedules, solar tracking,
priority allocation, and the energy flow diagram without owning an EV.

## Defaults

| Setting          | Default                     |
| ---------------- | --------------------------- |
| Battery capacity | 75 kWh                      |
| Max charge rate  | 11 kW                       |
| Voltage          | 230V                        |
| Phases           | 1                           |
| Amp range        | 5–32A                       |
| Initial SOC      | 50%                         |
| Charge limit     | 80%                         |
| Location         | Sydney (-33.8688, 151.2093) |

The vehicle is always "online" — there are no wake delays. Battery level moves
in real time based on charge amps and voltage; charging auto-stops at the
configured charge limit.

## Energy integration

When a simulated vehicle is charging, its draw is added to home consumption and
grid power in every energy reading. The energy flow diagram, solar attribution,
and charge controller all see it as if it were a real load on the meter. With no
simulated vehicles charging, the contribution is zero.

This means a simulated vehicle behaves correctly under solar tracking — the
controller will throttle it down or cycle it on/off as solar fluctuates, just
like a real car.

## Runtime controls

Settings page exposes per-vehicle runtime knobs you can change at any time:

- Plug / unplug
- Move location (drives home/away detection)
- Set battery level
- Set charge limit

Mutations apply immediately — the dashboard updates without waiting for the next
controller tick.

## Charge sessions

Simulated charge sessions are recorded the same way as real ones, so they show
up on the Stats page (kWh added, solar vs grid attribution, cost). Useful for
sanity-checking allocation logic and stats math.

## Limitations

**State is not persisted.** On server restart the vehicle resets to its
configured initial SOC, unplugged, at the home location. Anything you changed at
runtime (battery level, plug state, location) is lost. Only the base
configuration in the database survives restarts.
