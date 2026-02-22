import { vi } from "vitest";
import type { VehicleChargeState } from "@chargeha/shared";

export const mockGeocodeQuery = vi.fn();

export type DialogProps = {
  vehicleState: VehicleChargeState | null;
  lastLocation: { latitude: number; longitude: number } | null;
  onSave: (data: {
    isPluggedIn?: boolean;
    latitude?: number;
    longitude?: number;
    chargeLimit?: number;
    socPercent?: number;
  }) => Promise<string | null>;
  onCancel: () => void;
};

export const makeDefaultProps = (): DialogProps => ({
  vehicleState: null,
  lastLocation: null,
  onSave: vi.fn().mockResolvedValue(null),
  onCancel: vi.fn(),
});

export const makeVehicleState = (
  overrides: Partial<VehicleChargeState> = {},
): VehicleChargeState => ({
  vehicleId: "VIN1",
  batteryLevel: 60,
  chargeLimit: 80,
  isCharging: false,
  isPluggedIn: true,
  isOnline: true,
  chargeAmps: 16,
  chargeAmpsMax: 32,
  chargeAmpsMin: 5,
  chargePowerKw: 0,
  chargerVoltage: 240,
  chargerPhases: 1,
  energyAddedKwh: 0,
  minutesToFull: 0,
  chargePortOpen: false,
  vehicleName: "Test Vehicle",
  lastUpdated: new Date().toISOString(),
  latitude: null,
  longitude: null,
  isHome: null,
  ...overrides,
});

export const installResizeObserverPolyfill = () => {
  globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
};

export const defaultAutocompleteState = () => ({
  query: "",
  suggestions: [],
  open: false,
  updateQuery: vi.fn(),
  setQuery: vi.fn(),
  setOpen: vi.fn(),
  clear: vi.fn(),
});
