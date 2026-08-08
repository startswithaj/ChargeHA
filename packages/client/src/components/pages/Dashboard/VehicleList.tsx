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
import { useChargerCommands, useChargers } from "../../../hooks/useChargers.ts";
import { VehicleCard } from "../../VehicleCard/VehicleCard.tsx";
import { ChargerCard } from "./ChargerCard.tsx";
import { trpc } from "../../../trpc.ts";
import {
  chargingEntriesFromPoints,
  useChargingSolarGrid,
} from "./energyHelpers.ts";

type VehicleCardProps = ComponentProps<typeof VehicleCard>;

type ChargingPoint = ReturnType<typeof useChargers>["chargers"][number];

function ConnectedVehicleCard(
  { vehicleId, chargingPoint, ...props }:
    & { vehicleId: string; chargingPoint: ChargingPoint }
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
      | "chargerStatus"
    >,
) {
  const { data: cmdStatus } = trpc.vehicle.commandStatus.useQuery(
    { vehicleId },
    { refetchInterval: 30_000 },
  );
  const { commandPending, startCharging, stopCharging, setAmps, changeMode } =
    useChargerCommands(chargingPoint.id);

  return (
    <VehicleCard
      {...props}
      mode={chargingPoint.mode as VehicleMode}
      commandPending={commandPending}
      onStartCharging={startCharging}
      onStopCharging={stopCharging}
      onSetAmps={setAmps}
      onChangeMode={changeMode}
      commandsDisabled={cmdStatus?.commandsDisabled ?? false}
      commandsDisabledReason={cmdStatus?.reason ?? undefined}
      chargerStatus={chargingPoint.state}
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
  points: ChargingPoint[],
  controllerStatuses: ReturnType<typeof useControllerStatuses>,
) {
  return useMemo(() => {
    if (!priorityChargingEnabled || points.length < 2) return {};
    const sorted = [...points].sort((a, b) => a.priority - b.priority);
    const topCharging = sorted.find((p) =>
      p.state?.isCharging &&
      controllerStatuses[p.id]?.reason === "solar_tracking"
    );
    return Object.fromEntries(
      sorted
        .map((p): [string, string] | null => {
          const isSolarCharging = p.state?.isCharging &&
            controllerStatuses[p.id]?.reason === "solar_tracking";
          if (isSolarCharging && p === topCharging) {
            return [p.id, "Priority: receiving all solar"];
          }
          if (!p.state?.isCharging && topCharging) {
            return [p.id, "Waiting for priority vehicle"];
          }
          return null;
        })
        .filter((entry): entry is [string, string] => entry !== null),
    );
  }, [priorityChargingEnabled, points, controllerStatuses]);
}

// One card per charging point; linked points (Tesla) render the full
// vehicle card. Vehicles without a linked point get their own read-only
// card below — vehicle data stays on vehicle cards.
function ChargingPointCards(
  {
    points,
    vehicles,
    home,
    vehiclesLoading,
    vehicleErrors,
    solarGrid,
    allocationStatus,
    controllerStatuses,
    wakeMutation,
    refreshMutation,
    onNavigateSettings,
  }: {
    points: ChargingPoint[];
    vehicles: ReturnType<typeof useVehicles>["vehicles"];
    home: { lat: number; lng: number } | null;
    vehiclesLoading: boolean;
    vehicleErrors: Record<string, string | undefined>;
    solarGrid: Record<string, { solarW: number; gridW: number }>;
    allocationStatus: Record<string, string>;
    controllerStatuses: ReturnType<typeof useControllerStatuses>;
    wakeMutation: ReturnType<typeof trpc.vehicle.command.useMutation>;
    refreshMutation: ReturnType<typeof trpc.vehicle.refreshState.useMutation>;
    onNavigateSettings?: () => void;
  },
) {
  return (
    <>
      {points.map((point) => {
        const vehicle = point.vehicleId !== null
          ? vehicles.find((v) => v.id === point.vehicleId) ?? null
          : null;
        if (vehicle?.state) {
          return (
            <ConnectedVehicleCard
              key={point.id}
              vehicleId={vehicle.id}
              chargingPoint={point}
              name={vehicle.name || vehicle.state.vehicleName}
              state={vehicle.state}
              priority={point.priority}
              solarPowerW={solarGrid[point.id]?.solarW ?? 0}
              gridPowerW={solarGrid[point.id]?.gridW ?? 0}
              loading={vehiclesLoading}
              lastLocation={vehicle.lastLocation}
              atHome={vehicle.lastLocation
                ? isHome(home, vehicle.lastLocation)
                : null}
              vehicleError={vehicleErrors[vehicle.id]}
              allocationStatus={allocationStatus[point.id] ?? null}
              pollingSuspended={vehicle.pollingSuspended}
              pollingSuspendReason={vehicle.pollingSuspendReason}
              controllerReason={controllerStatuses[point.id]?.reason ?? null}
              controllerDetail={controllerStatuses[point.id]?.detail ?? null}
              onNavigateSettings={onNavigateSettings}
              onRefresh={() =>
                refreshMutation.mutateAsync({ vehicleId: vehicle.id })}
            />
          );
        }
        if (vehicle) {
          const isWaking = wakeMutation.isPending &&
            wakeMutation.variables?.vehicleId === vehicle.id;
          return (
            <AsleepVehicleCard
              key={point.id}
              v={vehicle}
              isWaking={isWaking}
              onWake={() =>
                wakeMutation.mutate({ vehicleId: vehicle.id, command: "wake" })}
            />
          );
        }
        return (
          <ChargerCard
            key={point.id}
            id={point.id}
            name={point.name}
            mode={point.mode}
            state={point.state}
            solarW={solarGrid[point.id]?.solarW ?? 0}
            gridW={solarGrid[point.id]?.gridW ?? 0}
            controllerDetail={controllerStatuses[point.id]?.detail ?? null}
            vehicleResolution={point.vehicleResolution}
          />
        );
      })}
    </>
  );
}

// Vehicles not represented by a linked charging point: data-only cards.
function DataOnlyVehicleCards(
  {
    vehicles,
    points,
    home,
    vehiclesLoading,
    vehicleErrors,
    wakeMutation,
    refreshMutation,
    onNavigateSettings,
  }: {
    vehicles: ReturnType<typeof useVehicles>["vehicles"];
    points: ChargingPoint[];
    home: { lat: number; lng: number } | null;
    vehiclesLoading: boolean;
    vehicleErrors: Record<string, string | undefined>;
    wakeMutation: ReturnType<typeof trpc.vehicle.command.useMutation>;
    refreshMutation: ReturnType<typeof trpc.vehicle.refreshState.useMutation>;
    onNavigateSettings?: () => void;
  },
) {
  const linked = new Set(
    points.map((p) => p.vehicleId).filter((id) => id !== null),
  );
  return (
    <>
      {vehicles.filter((v) => !linked.has(v.id)).map((v) => {
        if (v.state) {
          return (
            <VehicleCard
              key={v.id}
              readOnly
              name={v.name || v.state.vehicleName}
              state={v.state}
              priority={v.priority}
              mode={v.mode as VehicleMode}
              commandPending={false}
              onStartCharging={() => {}}
              onStopCharging={() => {}}
              onSetAmps={() => {}}
              onChangeMode={() => {}}
              loading={vehiclesLoading}
              lastLocation={v.lastLocation}
              atHome={v.lastLocation ? isHome(home, v.lastLocation) : null}
              vehicleError={vehicleErrors[v.id]}
              pollingSuspended={v.pollingSuspended}
              pollingSuspendReason={v.pollingSuspendReason}
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

  const { chargers: allPoints } = useChargers();
  // A deactivated point is not driving anything — its middleware is
  // unregistered, so its card's Charge Now and Start Charging would command a
  // charger the server no longer has. The list keeps inactive rows because
  // the API-control toggle in settings reads `active` off them.
  const points = useMemo(() => allPoints.filter((p) => p.active), [allPoints]);
  const solarGrid = useChargingSolarGrid(
    realtime,
    chargingEntriesFromPoints(points),
  );
  const controllerStatuses = useControllerStatuses();
  const allocationStatus = useAllocationStatus(
    chargingConfig?.priorityChargingEnabled,
    points,
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
        Charging
      </Text>
      <ChargingPointCards
        points={points}
        vehicles={vehicles}
        home={home}
        vehiclesLoading={vehiclesLoading}
        vehicleErrors={vehicleErrors}
        solarGrid={solarGrid}
        allocationStatus={allocationStatus}
        controllerStatuses={controllerStatuses}
        wakeMutation={wakeMutation}
        refreshMutation={refreshMutation}
        onNavigateSettings={onNavigateSettings}
      />

      <DataOnlyVehicleCards
        vehicles={vehicles}
        points={points}
        home={home}
        vehiclesLoading={vehiclesLoading}
        vehicleErrors={vehicleErrors}
        wakeMutation={wakeMutation}
        refreshMutation={refreshMutation}
        onNavigateSettings={onNavigateSettings}
      />

      {!vehiclesLoading && points.length === 0 && vehicles.length === 0 &&
        vehiclesError && (
        <VehicleListErrorCard
          error={vehiclesError}
          onRetry={refreshVehicles}
        />
      )}

      {!vehiclesLoading && points.length === 0 && vehicles.length === 0 &&
        !vehiclesError && (
        <NoVehiclesCard onNavigateSettings={onNavigateSettings} />
      )}
    </div>
  );
}
