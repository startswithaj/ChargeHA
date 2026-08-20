import type { EnergyData } from "@chargeha/shared";
import type { SemsPlusFlow } from "./types.ts";

// refreshTime arrives station-local with no offset; the server shares the
// station's timezone in a home install, so local parsing recovers UTC.
function parseRefreshTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function toEnergyDataFromFlow(flow: SemsPlusFlow): EnergyData {
  const toW = (kw: number | null | undefined): number | null =>
    kw == null ? null : Math.round(kw * 1000);
  const solar = toW(flow.pSystem ?? flow.pAc) ?? 0;
  // SEMS+ signs pGrid positive when exporting; ChargeHA signs import positive.
  // The zero branch avoids -0, which JS preserves and renders as "-0W".
  const gridExportW = toW(flow.pGrid) ?? 0;
  const grid = gridExportW === 0 ? 0 : -gridExportW;
  const home = toW(flow.pConsum);
  return {
    solarProductionW: solar,
    gridPowerW: grid,
    homeConsumptionW: home === null
      ? Math.max(0, solar + grid)
      : Math.abs(home),
    // TODO: verify battery direction against a real battery station. The
    // SEMS+ web app derives direction from the response's `flows` edges, not
    // pBat's sign — likely the right source here too.
    batteryPowerW: toW(flow.pBat),
    batterySoc: flow.soc ?? null,
    gridVoltageV: null,
    sourceUpdatedAt: parseRefreshTime(flow.refreshTime),
    lastUpdated: new Date().toISOString(),
  };
}
