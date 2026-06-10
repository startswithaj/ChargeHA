/** Per-vehicle solar vs grid split for home charging.
 *
 *  The home meter already includes EV draw in homeConsumption, so the total
 *  EV draw is added back to find the solar left over for charging. Each
 *  vehicle takes its proportional share, capped by actual production: when
 *  the meter under-reports the cars' draw (e.g. a stuck/stale inverter),
 *  availableSolar can spike beyond what the panels actually produced. */
export function calculateSolarAttribution(
  chargePowerW: number,
  totalChargePowerW: number,
  solarProductionW: number,
  homeConsumptionW: number,
): { solarW: number; gridW: number } {
  const availableSolar = Math.max(
    0,
    solarProductionW - homeConsumptionW + totalChargePowerW,
  );
  const vehicleShare = totalChargePowerW > 0
    ? chargePowerW / totalChargePowerW
    : 1;
  const solarW = Math.min(
    chargePowerW,
    availableSolar * vehicleShare,
    Math.max(0, solarProductionW) * vehicleShare,
  );
  return { solarW, gridW: chargePowerW - solarW };
}
