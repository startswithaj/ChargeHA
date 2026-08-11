import type {
  CallContext,
  ChargerAdapter,
  ChargerInfo,
  ChargerState,
  ChargerStatus,
} from "@chargeha/shared";

const VOLTAGE = 230;

interface SimState {
  on: boolean;
  pluggedIn: boolean;
  // The fake car's appetite; 0 = absent or full.
  carMaxAmps: number;
  commandedAmps: number;
  energyAddedKwh: number;
  lastTickMs: number;
}

// In-memory EVSE: honours start/stop/setChargeAmps like real hardware, draws
// min(commanded, car appetite), accumulates session energy on a wall-clock tick.
export class SimulatedChargerAdapter implements ChargerAdapter {
  private state: SimState = {
    on: false,
    pluggedIn: true,
    carMaxAmps: 16,
    commandedAmps: 6,
    energyAddedKwh: 0,
    lastTickMs: Date.now(),
  };

  constructor(readonly chargerId: string) {}

  pollIntervalSeconds(): number {
    return 2;
  }

  disconnect(): Promise<void> {
    return Promise.resolve();
  }

  startCharging(_ctx: CallContext): Promise<boolean> {
    this.state = { ...this.state, on: true, lastTickMs: Date.now() };
    return Promise.resolve(true);
  }

  stopCharging(_ctx: CallContext): Promise<boolean> {
    this.tick();
    this.state = { ...this.state, on: false, energyAddedKwh: 0 };
    return Promise.resolve(true);
  }

  setChargeAmps(amps: number, _ctx: CallContext): Promise<boolean> {
    this.tick();
    this.state = { ...this.state, commandedAmps: amps };
    return Promise.resolve(true);
  }

  getChargerState(_ctx: CallContext): Promise<ChargerState> {
    this.tick();
    const s = this.state;
    const amps = this.drawAmps();
    return Promise.resolve({
      chargerId: this.chargerId,
      isCharging: amps > 0,
      isPluggedIn: s.pluggedIn,
      chargeAmps: amps,
      chargeAmpsMax: 32,
      chargeAmpsMin: 6,
      chargePowerKw: (amps * VOLTAGE) / 1000,
      chargerVoltage: VOLTAGE,
      chargerPhases: 1,
      energyAddedKwh: s.energyAddedKwh,
      status: this.status(amps),
      statusDetail: `simulated: ${
        s.pluggedIn ? `car appetite ${s.carMaxAmps}A` : "no cable"
      }, ${s.on ? `energized at ${s.commandedAmps}A` : "off"}`,
      lastUpdated: new Date().toISOString(),
    });
  }

  getChargerInfo(_ctx: CallContext): Promise<ChargerInfo> {
    return Promise.resolve({
      id: this.chargerId,
      name: "Simulated Charger",
      vendor: "ChargeHA",
      model: "SimEVSE",
      firmwareVersion: "sim",
      maxAmps: 32,
      minAmps: 6,
      phases: 1,
      connectorCount: 1,
      controlMode: "amps",
    });
  }

  // Dev controls (router): plug/unplug the fake car, set its appetite.
  updateState(patch: { pluggedIn?: boolean; carMaxAmps?: number }): void {
    this.tick();
    this.state = {
      ...this.state,
      ...patch,
      // Unplugging ends the session like a real cable pull.
      ...(patch.pluggedIn === false && { on: false, energyAddedKwh: 0 }),
    };
  }

  // Dev-panel view of current state — no ChargerState ceremony.
  devStatus(): {
    chargerRowId: string;
    pluggedIn: boolean;
    carMaxAmps: number;
    on: boolean;
    commandedAmps: number;
    drawAmps: number;
  } {
    const s = this.state;
    return {
      chargerRowId: this.chargerId,
      pluggedIn: s.pluggedIn,
      carMaxAmps: s.carMaxAmps,
      on: s.on,
      commandedAmps: s.commandedAmps,
      drawAmps: this.drawAmps(),
    };
  }

  private drawAmps(): number {
    const s = this.state;
    if (!s.on || !s.pluggedIn) return 0;
    return Math.min(s.commandedAmps, s.carMaxAmps);
  }

  private status(amps: number): ChargerStatus {
    const s = this.state;
    if (!s.pluggedIn) return "available";
    if (amps > 0) return "charging";
    if (s.on && s.carMaxAmps === 0) return "no_draw";
    return "suspended";
  }

  private tick(): void {
    const now = Date.now();
    const hours = (now - this.state.lastTickMs) / 3_600_000;
    const kw = (this.drawAmps() * VOLTAGE) / 1000;
    this.state = {
      ...this.state,
      energyAddedKwh: this.state.energyAddedKwh + kw * hours,
      lastTickMs: now,
    };
  }
}
