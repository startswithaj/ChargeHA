import type { CallContext, ChargerState } from "@chargeha/shared";
import type { ChargerMiddleware } from "@chargeha/shared/plugins";

// Stands in for a charging point whose adapter could never be built (config
// missing or rejected). The row and its card still exist, so the point reports why through the same channel as every other charger. Replaced on the next rebuild once the config is fixed.
export class UnconfiguredChargerMiddleware implements ChargerMiddleware {
  private readonly state: ChargerState;

  constructor(chargerId: string, reason: string) {
    this.state = {
      chargerId,
      isCharging: false,
      isPluggedIn: null,
      chargeAmps: null,
      // Required numbers with nothing behind them. Nothing reads these:
      // isControllable() keeps this point out of the controller entirely.
      chargeAmpsMax: 0,
      chargeAmpsMin: 0,
      chargePowerKw: null,
      chargerVoltage: null,
      chargerPhases: 1,
      energyAddedKwh: 0,
      status: "unconfigured",
      statusDetail: reason,
      // Commands nothing either way; isControllable() keeps this point out of
      // the controller entirely.
      controlMode: "switch",
      // Fixed at construction; a moving timestamp would re-emit forever.
      lastUpdated: new Date().toISOString(),
    };
  }

  requestState(_ctx: CallContext): Promise<ChargerState | null> {
    return Promise.resolve(this.state);
  }

  getCachedState(): ChargerState | null {
    return this.state;
  }

  startCharging(_ctx: CallContext): Promise<boolean> {
    return Promise.resolve(false);
  }

  stopCharging(_ctx: CallContext): Promise<boolean> {
    return Promise.resolve(false);
  }

  setChargeAmps(_amps: number, _ctx: CallContext): Promise<boolean> {
    return Promise.resolve(false);
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
    return Promise.resolve();
  }
}
