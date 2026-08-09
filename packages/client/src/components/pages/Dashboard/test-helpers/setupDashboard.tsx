import { type Mock, vi } from "vitest";
import { renderWithProviders } from "../../../../test-utils.tsx";
import { Dashboard } from "../Dashboard.tsx";
import { useEnergyData } from "../../../../hooks/useEnergyData.ts";
import { useToast } from "../../../../hooks/useToast.tsx";
import { useVehicles } from "../../../../hooks/useVehicles.ts";
import { trpc } from "../../../../trpc.ts";

// Typed mock-fn instances, consumed by vi.mock factories in the test file.

type ConfigGetAllReturn = {
  data: string | null;
  isLoading: boolean;
  error: null;
};

type PluginWarning = {
  title: string;
  message: string;
  severity?: "warning" | "error";
};

type PluginWarningsReturn = {
  data: PluginWarning[];
  isLoading: boolean;
  error: null;
};

type TariffCurrentRateReturn = {
  data: {
    ratePerKwh: number;
    label: string;
    currencySymbol: string;
    nextRate?: { ratePerKwh: number; label: string; startsAt: string };
  } | null;
  isLoading: boolean;
  error: null;
};

type CommandStatusReturn = {
  data: { commandsDisabled: boolean; reason: string | null };
  isLoading: boolean;
  error: null;
};

export const dashboardMocks = {
  dismissMutate: vi.fn() as Mock,
  invalidateConfig: vi.fn() as Mock,
  configGetAllUseQuery: vi.fn<() => ConfigGetAllReturn>(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
  pluginWarningsUseQuery: vi.fn<() => PluginWarningsReturn>(() => ({
    data: [],
    isLoading: false,
    error: null,
  })),
  tariffCurrentRateUseQuery: vi.fn<() => TariffCurrentRateReturn>(() => ({
    data: null,
    isLoading: false,
    error: null,
  })),
  chargerListUseQuery: vi.fn(() => ({
    data: [] as Array<Record<string, unknown>>,
    isLoading: false,
    error: null,
  })),
  commandStatusUseQuery: vi.fn<() => CommandStatusReturn>(() => ({
    data: { commandsDisabled: false, reason: null },
    isLoading: false,
    error: null,
  })),
  // Captured onSuccess from the dismissSystemAlert mutation, populated by the
  // mutation factory below; mockDismissMutate calls it to simulate refetch.
  capturedDismiss: { onSuccess: undefined as (() => void) | undefined },
};

export function makeVehicleState(overrides: Record<string, unknown> = {}) {
  return {
    vehicleId: "VIN1",
    batteryLevel: 72,
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
    vehicleName: "Test Car",
    lastUpdated: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeVehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: "VIN1",
    name: "Test Car",
    mode: "auto",
    adapterType: "simulated",
    priority: 1,
    config: "{}",
    state: makeVehicleState(),
    lastLocation: null,
    ...overrides,
  };
}

export function makeSleepingVehicle(overrides: Record<string, unknown> = {}) {
  return {
    id: "VIN2",
    name: "Sleeping Car",
    mode: "auto",
    adapterType: "simulated",
    priority: 1,
    config: "{}",
    state: null,
    lastLocation: null,
    ...overrides,
  };
}

/** Charging points mirroring the mocked vehicles — the dashboard iterates
 *  charger.list, so every vehicle fixture needs its linked point. */
function chargerStateFrom(
  vehicleId: unknown,
  state: Record<string, unknown> | null,
  now: string,
): Record<string, unknown> | null {
  if (!state) return null;
  return {
    chargerId: `cp-${vehicleId}`,
    isCharging: state.isCharging ?? false,
    isPluggedIn: state.isPluggedIn ?? true,
    chargeAmps: state.chargeAmps ?? 0,
    chargeAmpsMax: state.chargeAmpsMax ?? 32,
    chargeAmpsMin: state.chargeAmpsMin ?? 5,
    chargePowerKw: state.chargePowerKw ?? 0,
    chargerVoltage: state.chargerVoltage ?? 240,
    chargerPhases: state.chargerPhases ?? 1,
    energyAddedKwh: 0,
    status: state.isCharging ? "charging" : "available",
    statusDetail: null,
    lastUpdated: now,
  };
}

function setPointsFromVehicles(
  vehicles: Array<Record<string, unknown>>,
): void {
  const now = "2026-01-01T00:00:00.000Z";
  dashboardMocks.chargerListUseQuery.mockReturnValue({
    data: vehicles.map((v) => ({
      id: `cp-${v.id}`,
      name: v.name,
      chargerAdapterType: v.adapterType ?? "simulated",
      chargerConfig: v.chargerConfig ?? "{}",
      mode: v.mode ?? "auto",
      priority: v.priority ?? 1,
      // Overridable so a fixture can describe an UNASSIGNED smart charger —
      // the only shape that reaches ChargerCard, since VehicleList renders a
      // vehicle card whenever the point names a vehicle it can find.
      vehicleId: v.chargerVehicleId === undefined ? v.id : v.chargerVehicleId,
      // Real rows always carry this; the dashboard hides inactive points, so
      // a fixture without it renders nothing at all.
      active: v.active ?? true,
      kind: v.kind ?? "vehicle_api",
      createdAt: now,
      updatedAt: now,
      resolvedVehicleId: v.resolvedVehicleId === undefined
        ? v.id
        : v.resolvedVehicleId,
      vehicleResolution: v.vehicleResolution ?? "linked",
      // "vehicle_api" here means a SMART charger gone passive for a
      // self-driven car; a vehicle_api row is always "self", since that row is
      // the car's own API.
      controlOwner: v.controlOwner ?? "self",
      passiveForVehicleId: v.passiveForVehicleId ?? null,
      state: chargerStateFrom(
        v.id,
        v.state as Record<string, unknown> | null,
        now,
      ),
    })),
    isLoading: false,
    error: null,
  });
}

export function makeVehiclesReturn(
  vehicles: Array<Record<string, unknown>> = [makeVehicle()],
): ReturnType<typeof useVehicles> {
  return {
    vehicles,
    loading: false,
    error: null,
    vehicleErrors: {},
    refreshVehicles: vi.fn(),
  } as unknown as ReturnType<typeof useVehicles>;
}

const defaultRealtime: {
  solarProductionW: number;
  gridPowerW: number;
  homeConsumptionW: number;
  batteryPowerW: number | null;
  batterySoc: number | null;
} = {
  solarProductionW: 5000,
  gridPowerW: -2000,
  homeConsumptionW: 3000,
  batteryPowerW: null,
  batterySoc: null,
};

const defaultCumulative = {
  solarProducedWh: 50000,
  gridImportedWh: 10000,
  gridExportedWh: 20000,
  dailySolarProducedWh: 5000,
  dailyGridImportWh: 1000,
  dailyGridExportWh: 2000,
};

type EnergyOverrides = {
  realtime?: Partial<typeof defaultRealtime>;
  cumulative?: Partial<typeof defaultCumulative>;
  lastUpdated?: Date | null;
  isLoading?: boolean;
  data?: null | undefined;
};

export function makeEnergyReturn(
  overrides: EnergyOverrides = {},
): ReturnType<typeof useEnergyData> {
  if (
    overrides.data === null ||
    overrides.data === undefined && overrides.isLoading
  ) {
    return {
      data: undefined,
      isLoading: overrides.isLoading ?? false,
      error: null,
    } as unknown as ReturnType<typeof useEnergyData>;
  }
  return {
    data: {
      realtime: { ...defaultRealtime, ...overrides.realtime },
      cumulative: { ...defaultCumulative, ...overrides.cumulative },
      lastUpdated: overrides.lastUpdated ?? null,
    },
    isLoading: overrides.isLoading ?? false,
    error: null,
  } as unknown as ReturnType<typeof useEnergyData>;
}

export interface DashboardHarness {
  setEnergy: (overrides?: EnergyOverrides) => void;
  setEnergyLoading: () => void;
  setVehicles: (vehicles?: Array<Record<string, unknown>>) => void;
  setVehiclesRaw: (returnValue: ReturnType<typeof useVehicles>) => void;
  setSystemAlert: (alert: Record<string, unknown> | null) => void;
  setPluginWarnings: (warnings: PluginWarning[]) => void;
  setTariff: (rate: TariffCurrentRateReturn["data"]) => void;
  setWakeMutation: (
    impl: { mutate: Mock; isPending?: boolean; variables?: unknown },
  ) => void;
  setWakeMutationOnError: (onError: (err: { message: string }) => void) => void;
  setToast: (
    addToast: Mock,
  ) => void;
  render: (
    props?: { onNavigateSettings?: () => void },
  ) => ReturnType<typeof renderWithProviders>;
}

function resetDashboardMocks(): void {
  dashboardMocks.capturedDismiss.onSuccess = undefined;
  dashboardMocks.tariffCurrentRateUseQuery.mockReturnValue({
    data: null,
    isLoading: false,
    error: null,
  });
  dashboardMocks.configGetAllUseQuery.mockReturnValue({
    data: null,
    isLoading: false,
    error: null,
  });
  dashboardMocks.pluginWarningsUseQuery.mockReturnValue({
    data: [],
    isLoading: false,
    error: null,
  });
  dashboardMocks.commandStatusUseQuery.mockReturnValue({
    data: { commandsDisabled: false, reason: null },
    isLoading: false,
    error: null,
  });
  dashboardMocks.dismissMutate.mockImplementation(() => {
    dashboardMocks.capturedDismiss.onSuccess?.();
  });
}

export function setupDashboard(): DashboardHarness {
  resetDashboardMocks();

  return {
    setEnergy(overrides) {
      vi.mocked(useEnergyData).mockReturnValue(makeEnergyReturn(overrides));
    },
    setEnergyLoading() {
      vi.mocked(useEnergyData).mockReturnValue(
        {
          data: undefined,
          isLoading: true,
          error: null,
        } as unknown as ReturnType<typeof useEnergyData>,
      );
    },
    setVehicles(vehicles) {
      const vehiclesReturn = makeVehiclesReturn(vehicles);
      vi.mocked(useVehicles).mockReturnValue(vehiclesReturn);
      setPointsFromVehicles(
        vehiclesReturn.vehicles as unknown as Array<Record<string, unknown>>,
      );
    },
    setVehiclesRaw(returnValue) {
      vi.mocked(useVehicles).mockReturnValue(returnValue);
      setPointsFromVehicles(
        (returnValue.vehicles ?? []) as unknown as Array<
          Record<string, unknown>
        >,
      );
    },
    setSystemAlert(alert) {
      dashboardMocks.configGetAllUseQuery.mockReturnValue({
        data: alert ? JSON.stringify(alert) : null,
        isLoading: false,
        error: null,
      });
    },
    setPluginWarnings(warnings) {
      dashboardMocks.pluginWarningsUseQuery.mockReturnValue({
        data: warnings,
        isLoading: false,
        error: null,
      });
    },
    setTariff(rate) {
      dashboardMocks.tariffCurrentRateUseQuery.mockReturnValue({
        data: rate,
        isLoading: false,
        error: null,
      });
    },
    setWakeMutation({ mutate, isPending = false, variables = null }) {
      vi.mocked(trpc.vehicle.command.useMutation).mockReturnValue(
        {
          mutate,
          mutateAsync: vi.fn(),
          isPending,
          variables,
        } as unknown as ReturnType<typeof trpc.vehicle.command.useMutation>,
      );
    },
    setWakeMutationOnError(onError) {
      vi.mocked(trpc.vehicle.command.useMutation).mockImplementation(
        ((opts: { onError?: (err: { message: string }) => void }) => ({
          mutate: vi.fn(() => {
            opts?.onError?.({ message: "Wake failed" });
            onError({ message: "Wake failed" });
          }),
          mutateAsync: vi.fn(),
          isPending: false,
          variables: null,
        })) as unknown as typeof trpc.vehicle.command.useMutation,
      );
    },
    setToast(addToast) {
      vi.mocked(useToast).mockReturnValue({
        addToast,
        removeToast: vi.fn(),
        toasts: [],
      });
    },
    render(props = {}) {
      return renderWithProviders(<Dashboard {...props} />);
    },
  };
}
