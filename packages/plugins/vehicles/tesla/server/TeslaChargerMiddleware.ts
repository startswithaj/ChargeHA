import type {
  CallContext,
  ChargerInfo,
  ChargerState,
  ChargerStatus,
} from "@chargeha/shared";
import type { AdapterVehicleChargeState } from "@chargeha/shared";
import type { ChargerMiddleware } from "../../../types.ts";
import type { ChargerRow } from "@chargeha/server/db/types";
import type { TeslaVehicleMiddleware } from "./TeslaVehicleMiddleware.ts";

/** ChargerMiddleware view over the shared per-VIN TeslaVehicleMiddleware.
 *  Commands and state ride the same cost-aware instance the vehicle role
 *  uses — never a second poller, never a second wake decision. */
export class TeslaChargerMiddleware implements ChargerMiddleware {
  constructor(
    private readonly row: ChargerRow,
    private readonly shared: TeslaVehicleMiddleware,
  ) {}

  async requestState(ctx: CallContext): Promise<ChargerState | null> {
    const state = await this.shared.requestState({
      origin: ctx.origin,
      traceId: ctx.traceId,
      hasSolar: false,
      hasSchedule: false,
      hasBlockout: false,
    });
    return state ? this.toChargerState(state) : null;
  }

  getCachedState(): ChargerState | null {
    const state = this.shared.getCachedState();
    return state ? this.toChargerState(state) : null;
  }

  getChargerInfo(_ctx: CallContext): Promise<ChargerInfo> {
    const state = this.shared.getCachedState();
    return Promise.resolve({
      id: this.row.id,
      name: this.row.name,
      vendor: "Tesla",
      model: state?.vehicleName ?? this.row.name,
      firmwareVersion: "unknown",
      maxAmps: state?.chargeAmpsMax ?? 32,
      minAmps: state?.chargeAmpsMin ?? 5,
      phases: state?.chargerPhases ?? 1,
      connectorCount: 1,
      controlMode: "amps",
    });
  }

  startCharging(ctx: CallContext): Promise<boolean> {
    return this.shared.startCharging(ctx);
  }

  stopCharging(ctx: CallContext): Promise<boolean> {
    return this.shared.stopCharging(ctx);
  }

  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean> {
    return this.shared.setChargeAmps(amps, ctx);
  }

  shutdown(): Promise<void> {
    // The vehicle role owns the shared instance's lifecycle — deleting the
    // charger row must not tear down vehicle data.
    return Promise.resolve();
  }

  private toChargerState(state: AdapterVehicleChargeState): ChargerState {
    return {
      chargerId: this.row.id,
      isCharging: state.isCharging,
      isPluggedIn: state.isPluggedIn,
      chargeAmps: state.chargeAmps,
      chargeAmpsMax: state.chargeAmpsMax,
      chargeAmpsMin: state.chargeAmpsMin,
      chargePowerKw: state.chargePowerKw,
      chargerVoltage: state.chargerVoltage,
      chargerPhases: state.chargerPhases,
      energyAddedKwh: state.energyAddedKwh,
      status: teslaStatus(state),
      statusDetail:
        `SOC ${state.batteryLevel}%/${state.chargeLimit}%, ${state.chargeAmps}A`,
      lastUpdated: state.lastUpdated,
    };
  }
}

function teslaStatus(state: AdapterVehicleChargeState): ChargerStatus {
  if (!state.isPluggedIn) return "available";
  if (state.isCharging) return "charging";
  if (state.batteryLevel >= state.chargeLimit) return "finishing";
  return "suspended";
}
