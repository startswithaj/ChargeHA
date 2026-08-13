# OCPP Charger Compatibility

Chargers that speak OCPP 1.6J and can be pointed at a local endpoint work with
ChargeHA. This list is compiled from three registers, not from vendor marketing:

- [ChargeHQ EV Charger Support Register](https://chargehq.net/ev-charger-support-register)
  — AU/NZ market, per-model, states OCPP incompatibility explicitly
- [evcc charger templates](https://docs.evcc.io/en/chargers/) — EU market; an
  `(OCPP)` suffix means a working local OCPP template exists for that model
- [Open Charge Alliance certified products](https://openchargealliance.org/certified-companies/)
  — the formal certification register

A brand appearing here is not a guarantee. OCPP support is per-model and often
per-firmware, and the endpoint must be user-configurable to a `ws://` address on
your own network. Chargers whose OCPP endpoint is locked to the vendor cloud
cannot talk to ChargeHA.

## Confirmed local OCPP 1.6J

| Brand       | Models                                                 | Source   |
| ----------- | ------------------------------------------------------ | -------- |
| ABB         | Terra AC Wallbox                                       | Both     |
| Alfen       | Eve                                                    | evcc     |
| ABL         | eM4 Single, eM4 Twin, eMH2, eMH3                       | evcc     |
| AUTEL       | AC MaxiCharger, AC Compact                             | evcc     |
| Charge Amps | Halo, Aura                                             | evcc     |
| Delta       | AC MAX Smart                                           | ChargeHQ |
| Easee       | Home, Charge, Charge Core, Charge Lite                 | evcc     |
| EM2GO       | Pro Power                                              | evcc     |
| EN+         | Caro / AC EV Charger                                   | ChargeHQ |
| EO          | Genius 2, Mini Pro 3                                   | ChargeHQ |
| Fronius     | Wattpilot Home, Wattpilot Go                           | Both     |
| FoxESS      | AC EV Charger                                          | evcc     |
| go-e        | Charger Gemini, Gemini flex, Gemini 2.0, CORE, PRO, V3 | evcc     |
| KEBA        | KeContact P30                                          | Both     |
| MG          | ChargeHub (7kW 1φ / 11kW 3φ)                           | ChargeHQ |
| Ocular      | IQ Wallbox                                             | ChargeHQ |
| Orbis       | Viaris Uni, Viaris Combi+                              | ChargeHQ |
| Schneider   | EVlink Smart Wallbox, EVlink Pro                       | Both     |
| Wallbox     | Pulsar Plus, Pulsar Max, Commander 2, Copper SB        | Both     |
| Zaptec      | Go                                                     | evcc     |
| ZJ Beny     | BCP AC EV Charger                                      | Both     |
| Circontrol  | eNext Elite                                            | ChargeHQ |

Plus a long tail of white-label AC wallboxes built on the same reference
firmware (Zencar, Iocharger, Besen, Morec, Sinexcel and others), which ship OCPP
1.6J with a configurable endpoint.

## Cloud-gated

The charger speaks OCPP, but the endpoint is fixed to the vendor's backend.
Usable only if the vendor exposes an endpoint setting or an OCPP proxy.

- Zaptec Pro
- Charge Amps Dawn
- EVBox Elvi

## Known NOT to support OCPP

Do not raise an issue asking for these — the hardware has no OCPP client.

- myenergi Zappi (proprietary API)
- Tesla Wall Connector Gen 2 and Gen 3
- ChargePoint Home Flex
- Ocular Home
- Rolec Wallpod: EV
- Hypervolt Home 2.0
- EO Mini Pro (original)
- QubeEV
- Smappee EV Wall Charger

## Known quirks

- **MG ChargeHub** — some firmware caps the current set over OCPP at around 7.1A
  regardless of the requested value. Firmware-dependent; see the
  [evcc discussion](https://github.com/evcc-io/evcc/discussions/12394).
- **Chargers reporting only the energy register** — many budget models ship with
  current and voltage sampling off. ChargeHA reconfigures them on connect and
  raises a health warning when it cannot; see [ocpp.md](ocpp.md).

## Reporting a charger

If you run a charger that is not listed, open an issue with the brand, model,
firmware version, and whether the OCPP endpoint is user-configurable. A working
report gets added here; a failing one gets added to the quirks section.
