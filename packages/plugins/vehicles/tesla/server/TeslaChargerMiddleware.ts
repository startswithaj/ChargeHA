import type {
  CallContext,
  ChargerState,
  ChargerStatus,
} from "@chargeha/shared";
import type { AdapterVehicleChargeState } from "@chargeha/shared";
import type { ChargerMiddleware } from "@chargeha/shared/plugins";
import type { ChargerRow } from "@chargeha/shared";
import type { TeslaVehicleMiddleware } from "./TeslaVehicleMiddleware.ts";

// Exposes a Tesla as a charger by delegating to the same TeslaVehicleMiddleware instance the vehicle role uses.
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

  startCharging(ctx: CallContext): Promise<boolean> {
    return this.shared.startCharging(ctx);
  }

  stopCharging(ctx: CallContext): Promise<boolean> {
    return this.shared.stopCharging(ctx);
  }

  setChargeAmps(amps: number, ctx: CallContext): Promise<boolean> {
    return this.shared.setChargeAmps(amps, ctx);
  }

  supportsRecovery(): boolean {
    return false;
  }

  recoverConnection(_ctx: CallContext): Promise<string[] | null> {
    return Promise.resolve(null);
  }

  softReset(_ctx: CallContext): Promise<boolean | null> {
    return Promise.resolve(null);
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
      controlMode: "amps",
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
