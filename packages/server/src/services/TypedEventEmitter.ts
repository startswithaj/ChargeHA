import type {
  CumulativeEnergyData,
  EnergyData,
  VehicleChargeState,
} from "@chargeha/shared";
import type { DecisionReason } from "@chargeha/shared/engine";

// Event type map: event name → payload type
export interface EventMap {
  energy_update: EnergyData & CumulativeEnergyData;
  energy_poll_success: Record<string, never>;
  energy_poll_failure: { error: string };
  config_changed: { key: string };
  vehicle_update: VehicleChargeState;
  vehicle_plug_changed: {
    vehicleId: string;
    vehicleName: string;
    isPluggedIn: boolean;
    isHome: boolean | null;
  };
  vehicle_arrived_home: {
    vehicleId: string;
    vehicleName: string;
    isPluggedIn: boolean;
    soc: number;
    chargeLimit: number;
  };
  vehicle_mode_changed: {
    vehicleId: string;
    vehicleName: string;
    mode: "auto" | "charge_now" | "stop";
  };
  vehicle_error: {
    vehicleId: string;
    vehicleName: string;
    error: string | null;
    source: "fetch" | "command";
  };
  controller_charge_started: {
    vehicleId: string;
    vehicleName: string;
    actionDetail: string;
    reason: DecisionReason;
  };
  controller_charge_stopped: {
    vehicleId: string;
    vehicleName: string;
    actionDetail: string;
    reason: DecisionReason;
    batteryLevel?: number;
    chargeLimit?: number;
    scheduleLimitContext?: { scheduleLimitPct: number; batteryLevel: number };
  };
  controller_external_charge: {
    vehicleId: string;
    vehicleName: string;
  };
  controller_low_solar: {
    vehicleId: string;
    vehicleName: string;
    gracePeriodMinutes: number;
  };
  controller_schedule_activated: {
    vehicleId: string;
    vehicleName: string;
    scheduleType: string;
    startTime: string;
    endTime: string;
    isPluggedIn: boolean;
    isHome: boolean | null;
  };
  safety_trip: {
    vehicleId: string;
    vehicleName: string;
    cycles: number;
    windowMinutes: number;
  };
  controller_blockout_charge: {
    vehicleId: string;
    vehicleName: string;
    startTime: string;
    endTime: string;
  };
  controller_status: {
    vehicleId: string;
    action: string;
    reason: string;
    detail: string;
    targetAmps: number | null;
    checksJson: string;
  };
}

export type EventType = keyof EventMap;
type Listener<T extends EventType> = (data: EventMap[T]) => void;

export class TypedEventEmitter {
  private listeners = new Map<EventType, Set<Listener<EventType>>>();
  /** Last emitted value per (event, key). Used to seed SSE connections
   *  with the latest state on connect. Written by emit() when a retainKey
   *  is provided. */
  private retained = new Map<EventType, Map<string, EventMap[EventType]>>();

  subscribe<T extends EventType>(
    event: T,
    listener: Listener<T>,
    options?: { replay?: boolean },
  ): () => void {
    const existing = this.listeners.get(event);
    const set = existing ?? new Set<Listener<EventType>>();
    if (!existing) this.listeners.set(event, set);
    set.add(listener as Listener<EventType>);

    // Replay retained values to the new subscriber
    if (options?.replay) {
      const map = this.retained.get(event);
      if (map) {
        [...map.values()].forEach((value) => {
          listener(value as EventMap[T]);
        });
      }
    }

    // Return unsubscribe function
    return () => {
      set.delete(listener as Listener<EventType>);
    };
  }

  emit<T extends EventType>(
    event: T,
    data: EventMap[T],
    retainKey?: string,
  ): void {
    if (retainKey !== undefined) {
      const existing = this.retained.get(event);
      const map = existing ?? new Map<string, EventMap[EventType]>();
      if (!existing) this.retained.set(event, map);
      map.set(retainKey, data);
    }

    const set = this.listeners.get(event);
    if (!set) return;
    set.forEach((listener) => listener(data));
  }

  unsubscribe<T extends EventType>(
    event: T,
    listener: Listener<T>,
  ): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as Listener<EventType>);
  }
}
