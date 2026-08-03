import { type ComponentProps, useMemo } from "react";
import { Car, Settings, Zap } from "lucide-react";
import { Button, Card, Text } from "@radix-ui/themes";
import type { VehicleMode } from "@chargeha/shared";
import { isHome } from "@chargeha/shared/geo";
import {
  useChargingConfig,
  useHomeConfig,
} from "../../../hooks/useSectionConfig.ts";
import { useEnergyData } from "../../../hooks/useEnergyData.ts";
import { useVehicles } from "../../../hooks/useVehicles.ts";
import { useToast } from "../../../hooks/useToast.tsx";
import { useControllerStatuses } from "../../../hooks/controllerStatusStore.ts";
import {
  useChargerCommands,
  useChargingPointForVehicle,
} from "../../../hooks/useChargers.ts";
import { VehicleCard } from "../../VehicleCard/VehicleCard.tsx";
import { trpc } from "../../../trpc.ts";
import { useVehicleSolarGrid } from "./energyHelpers.ts";

type VehicleCardProps = ComponentProps<typeof VehicleCard>;

/** Wraps VehicleCard with a per-vehicle commandStatus query and the linked
 *  charging point's mode/amps/start/stop controls — charge commands are
 *  addressed by charging-point id, not vehicle id, so the lookup and
 *  mutations live here rather than in the vehicles list above. */
function ConnectedVehicleCard(
  { vehicleId, vehicleMode, ...props }:
    & { vehicleId: string; vehicleMode: VehicleMode }
    & Omit<
      VehicleCardProps,
      | "commandsDisabled"
      | "commandsDisabledReason"
      | "mode"
      | "commandPending"
      | "onStartCharging"
      | "onStopCharging"
      | "onSetAmps"
      | "onChangeMode"
    >,
) {
  const { data: cmdStatus } = trpc.vehicle.commandStatus.useQuery(
    { vehicleId },
    { refetchInterval: 30_000 },
  );
  const chargingPoint = useChargingPointForVehicle(vehicleId);
  const { commandPending, startCharging, stopCharging, setAmps, changeMode } =
    useChargerCommands(chargingPoint?.id ?? null);

  // Should not happen post-migration (every driveable vehicle gets a
  // charging point), but never crash — disable controls with a reason.
  const commandsDisabled = !chargingPoint ||
    (cmdStatus?.commandsDisabled ?? false);
  const commandsDisabledReason = !chargingPoint
    ? "No charging point linked to this vehicle"
    : cmdStatus?.reason ?? undefined;

  return (
    <VehicleCard
      {...props}
      mode={chargingPoint?.mode ?? vehicleMode}
      commandPending={commandPending}
      onStartCharging={startCharging}
      onStopCharging={stopCharging}
      onSetAmps={setAmps}
      onChangeMode={changeMode}
      commandsDisabled={commandsDisabled}
      commandsDisabledReason={commandsDisabledReason}
    />
  );
}

interface VehicleListProps {
  onNavigateSettings?: () => void;
}

function WakingSpinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        animation: "spin 0.6s linear infinite",
        verticalAlign: "middle",
      }}
    />
  );
}

function AsleepVehicleCard(
  { v, isWaking, onWake }: {
    v: { id: string; name: string };
    isWaking: boolean;
    onWake: () => void;
  },
) {
  const wakeIcon = isWaking ? <WakingSpinner /> : <Zap size={14} />;
  return (
    <Card key={v.id} style={{ borderLeft: "3px solid var(--gray-a6)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Car size={18} style={{ color: "var(--gray-9)" }} />
        <div style={{ flex: 1 }}>
          <Text size="2" weight="bold">{v.name}</Text>
          <Text size="1" color="gray" style={{ display: "block" }}>
            Vehicle is asleep or unreachable
          </Text>
        </div>
        <Button variant="soft" size="1" disabled={isWaking} onClick={onWake}>
          {wakeIcon}
          {isWaking ? "Waking..." : "Wake"}
        </Button>
      </div>
    </Card>
  );
}

function VehicleListErrorCard(
  { error, onRetry }: { error: string; onRetry: () => void },
) {
  return (
    <Card style={{ borderLeft: "3px solid var(--red-a7)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Car size={24} style={{ color: "var(--red-9)" }} />
        <div style={{ flex: 1 }}>
          <Text size="3" weight="bold" style={{ display: "block" }}>
            Unable to load vehicles
          </Text>
          <Text size="2" color="gray">{error}</Text>
        </div>
        <Button variant="soft" size="2" onClick={onRetry}>Retry</Button>
      </div>
    </Card>
  );
}

function NoVehiclesCard(
  { onNavigateSettings }: { onNavigateSettings?: () => void },
) {
  return (
    <Card style={{ borderLeft: "3px solid var(--color-vehicle)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Car size={24} style={{ color: "var(--color-vehicle)" }} />
        <div style={{ flex: 1 }}>
          <Text size="3" weight="bold" style={{ display: "block" }}>
            No vehicles configured
          </Text>
          <Text size="2" color="gray">
            Add a vehicle to monitor charging and control solar allocation.
          </Text>
        </div>
        <Button variant="soft" size="2" onClick={onNavigateSettings}>
          <Settings size={16} />
          Add Vehicle
        </Button>
      </div>
    </Card>
  );
}

function useAllocationStatus(
  priorityChargingEnabled: boolean | undefined,
  vehicles: ReturnType<typeof useVehicles>["vehicles"],
  controllerStatuses: ReturnType<typeof useControllerStatuses>,
) {
  return useMemo(() => {
    if (!priorityChargingEnabled || vehicles.length < 2) return {};
    const sorted = [...vehicles].sort((a, b) => a.priority - b.priority);
    const topCharging = sorted.find((v) =>
      v.state?.isCharging &&
      controllerStatuses[v.id]?.reason === "solar_tracking"
    );
    return Object.fromEntries(
      sorted
        .map((v): [string, string] | null => {
          const isSolarCharging = v.state?.isCharging &&
            controllerStatuses[v.id]?.reason === "solar_tracking";
          if (isSolarCharging && v === topCharging) {
            return [v.id, "Priority: receiving all solar"];
          }
          if (!v.state?.isCharging && topCharging) {
            return [v.id, "Waiting for priority vehicle"];
          }
          return null;
        })
        .filter((entry): entry is [string, string] => entry !== null),
    );
  }, [priorityChargingEnabled, vehicles, controllerStatuses]);
}

function VehicleCards(
  {
    vehicles,
    home,
    vehiclesLoading,
    vehicleErrors,
    vehicleSolarGrid,
    allocationStatus,
    controllerStatuses,
    wakeMutation,
    refreshMutation,
    onNavigateSettings,
  }: {
    vehicles: ReturnType<typeof useVehicles>["vehicles"];
    home: { lat: number; lng: number } | null;
    vehiclesLoading: boolean;
    vehicleErrors: Record<string, string | undefined>;
    vehicleSolarGrid: Record<string, { solarW: number; gridW: number }>;
    allocationStatus: Record<string, string>;
    controllerStatuses: ReturnType<typeof useControllerStatuses>;
    wakeMutation: ReturnType<typeof trpc.vehicle.command.useMutation>;
    refreshMutation: ReturnType<typeof trpc.vehicle.refreshState.useMutation>;
    onNavigateSettings?: () => void;
  },
) {
  return (
    <>
      {vehicles.map((v) => {
        if (v.state) {
          return (
            <ConnectedVehicleCard
              key={v.id}
              vehicleId={v.id}
              vehicleMode={v.mode as VehicleMode}
              name={v.name || v.state.vehicleName}
              state={v.state}
              priority={v.priority}
              solarPowerW={vehicleSolarGrid[v.id]?.solarW ?? 0}
              gridPowerW={vehicleSolarGrid[v.id]?.gridW ?? 0}
              loading={vehiclesLoading}
              lastLocation={v.lastLocation}
              atHome={v.lastLocation ? isHome(home, v.lastLocation) : null}
              vehicleError={vehicleErrors[v.id]}
              allocationStatus={allocationStatus[v.id] ?? null}
              pollingSuspended={v.pollingSuspended}
              pollingSuspendReason={v.pollingSuspendReason}
              controllerReason={controllerStatuses[v.id]?.reason ?? null}
              controllerDetail={controllerStatuses[v.id]?.detail ?? null}
              onNavigateSettings={onNavigateSettings}
              onRefresh={() => refreshMutation.mutateAsync({ vehicleId: v.id })}
            />
          );
        }
        const isWaking = wakeMutation.isPending &&
          wakeMutation.variables?.vehicleId === v.id;
        return (
          <AsleepVehicleCard
            key={v.id}
            v={v}
            isWaking={isWaking}
            onWake={() =>
              wakeMutation.mutate({ vehicleId: v.id, command: "wake" })}
          />
        );
      })}
    </>
  );
}

export function VehicleList(
  { onNavigateSettings }: VehicleListProps,
) {
  const { addToast } = useToast();
  const { data: chargingConfig } = useChargingConfig();
  const { data: homeConfig } = useHomeConfig();
  const homeLat = homeConfig?.homeLatitude;
  const homeLng = homeConfig?.homeLongitude;
  const home = homeLat != null && homeLng != null
    ? { lat: homeLat, lng: homeLng }
    : null;
  const { data: energyData } = useEnergyData();
  const realtime = energyData?.realtime ?? null;
  const {
    vehicles,
    loading: vehiclesLoading,
    error: vehiclesError,
    vehicleErrors,
    refreshVehicles,
  } = useVehicles();

  const wakeMutation = trpc.vehicle.command.useMutation({
    onError: (err) => {
      addToast(err.message || "Failed to wake vehicle", "error");
    },
  });

  const refreshMutation = trpc.vehicle.refreshState.useMutation({
    onError: (err) => {
      addToast(err.message || "Failed to refresh vehicle state", "error");
    },
  });

  const vehicleSolarGrid = useVehicleSolarGrid(realtime, vehicles);
  const controllerStatuses = useControllerStatuses();
  const allocationStatus = useAllocationStatus(
    chargingConfig?.priorityChargingEnabled,
    vehicles,
    controllerStatuses,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Vehicle section — one card per configured vehicle */}
      <Text
        size="1"
        color="gray"
        weight="medium"
        style={{ textTransform: "uppercase", letterSpacing: "0.05em" }}
      >
        Vehicles
      </Text>
      <VehicleCards
        vehicles={vehicles}
        home={home}
        vehiclesLoading={vehiclesLoading}
        vehicleErrors={vehicleErrors}
        vehicleSolarGrid={vehicleSolarGrid}
        allocationStatus={allocationStatus}
        controllerStatuses={controllerStatuses}
        wakeMutation={wakeMutation}
        refreshMutation={refreshMutation}
        onNavigateSettings={onNavigateSettings}
      />

      {!vehiclesLoading && vehicles.length === 0 && vehiclesError && (
        <VehicleListErrorCard
          error={vehiclesError}
          onRetry={refreshVehicles}
        />
      )}

      {!vehiclesLoading && vehicles.length === 0 && !vehiclesError && (
        <NoVehiclesCard onNavigateSettings={onNavigateSettings} />
      )}
    </div>
  );
}
