import { SolarAllocator } from "./SolarAllocator.ts";
import { Trace } from "./Trace.ts";
import { StepOrchestrator } from "./StepOrchestrator.ts";
import type {
  ControlStateUpdates,
  EngineInput,
  EngineOutput,
  VehicleControlState,
  VehicleDecision,
} from "./types.ts";
import { createControlState } from "./types.ts";

// Pure decision engine for the charge controller. Owns per-vehicle runtime
// state (grace periods, cooldowns, amp debouncing) and exposes a single
// `decide()` method. No I/O, no database, no adapters — the caller (ChargeController or the simulator) executes the returned decisions.
export class ControllerEngine {
  private controlStates = new Map<string, VehicleControlState>();

  decide(input: EngineInput): EngineOutput {
    const { config, vehicles, activeBlockout, energy, now, timestamp } = input;
    if (!config.chargingEnabled) {
      vehicles.forEach((vehicle) => this.commit(vehicle.id));
      const decisions = new Map(
        vehicles.map((vehicle): [string, VehicleDecision] => [vehicle.id, {
          action: "none",
          reason: "charging_disabled",
          detail: "Charging disabled",
          targetAmps: null,
          checks: [],
        }]),
      );
      return { decisions, controlStates: this.controlStates };
    }

    // Pre-compute per-vehicle solar allocation
    const allocation = SolarAllocator.allocate(vehicles, config, energy);
    vehicles.forEach((vehicle) => {
      const cs = this.getControlState(vehicle.id);
      this.controlStates.set(vehicle.id, {
        ...cs,
        allocatedAmps: allocation.get(vehicle.id) ?? null,
      });
    });

    const decisions = new Map(
      vehicles.map((vehicle): [string, VehicleDecision] => {
        const { state } = vehicle;
        if (!state) {
          this.commit(vehicle.id);
          return [vehicle.id, noState()];
        }
        const cs = this.getControlState(vehicle.id);
        const { decision, stateUpdates } = StepOrchestrator.run({
          vehicle,
          state,
          config,
          activeBlockout,
          energy,
          now,
          timestamp,
          cs,
          solar: SolarAllocator.targets(
            state,
            config,
            energy,
            cs.allocatedAmps,
          ),
        });
        this.commit(vehicle.id, stateUpdates);
        return [vehicle.id, decision];
      }),
    );

    return { decisions, controlStates: this.controlStates };
  }

  // Read a vehicle's control state (for the orchestrator's event emission).
  getControlState(vehicleId: string): VehicleControlState {
    const existing = this.controlStates.get(vehicleId);
    if (existing) return existing;
    const cs = createControlState();
    this.controlStates.set(vehicleId, cs);
    return cs;
  }

  // Grace lasts one loop unless the grace step renews it, so no other rule
  // can leave a stale start time behind.
  private commit(vehicleId: string, updates: ControlStateUpdates = {}): void {
    this.controlStates.set(vehicleId, {
      ...this.getControlState(vehicleId),
      graceStartedAt: null,
      graceNotified: false,
      ...updates,
    });
  }
}

function noState(): VehicleDecision {
  return {
    action: "none",
    reason: "no_state",
    detail: "No vehicle state available",
    targetAmps: null,
    checks: [Trace.vehicleStateUnavailable()],
  };
}
