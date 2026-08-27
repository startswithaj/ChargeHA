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

type DashboardVehicle = ReturnType<typeof useVehicles>["vehicles"][number];

// Resolution first, then the car a passive charger is passing current to —
// `inferVehicle` skips self-driven cars, so only `passiveForVehicleId`
// names that one.
const cardVehicleId = (point: ChargingPoint): string | null =>
  point.resolvedVehicleId ?? point.passiveForVehicleId;

// A vehicle_api point outranks a smart one for the same car, since its card
// carries working controls. Within a rank the first point in list order
// wins; entries reversed since Map keeps the LAST value for a duplicate key.
function ownerByVehicleId(points: ChargingPoint[]): Map<string, string> {
  const rank = (p: ChargingPoint) => p.kind === "vehicle_api" ? 0 : 1;
  return new Map(
    [...points]
      .sort((a, b) => rank(a) - rank(b))
      .flatMap((p) => {
        const vehicleId = cardVehicleId(p);
        return vehicleId === null
          ? []
          : [[vehicleId, p.id] as [string, string]];
      })
      .reverse(),
  );
}

// `point`, not `chargingPoint`: VehicleCard now has a `chargingPoint` prop of
// its own for the badge naming a car's charger, and these props are spread
// straight into it.
function ConnectedVehicleCard(
  { vehicleId, point, ...props }:
    & { vehicleId: string; point: ChargingPoint }
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
    useChargerCommands(point.id);

  return (
    <VehicleCard
      {...props}
      mode={point.mode as VehicleMode}
      commandPending={commandPending}
      onStartCharging={startCharging}
      onStopCharging={stopCharging}
      onSetAmps={setAmps}
      onChangeMode={changeMode}
      commandsDisabled={cmdStatus?.commandsDisabled ?? false}
      commandsDisabledReason={cmdStatus?.reason ?? undefined}
      chargerStatus={point.state}
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
          // Only a point that could actually charge is "waiting": stopped,
          // unplugged, or higher-priority points have their own story.
          const couldCharge = p.mode !== "stop" &&
            p.state?.isPluggedIn === true && !p.state?.isCharging;
          const outranked = topCharging !== undefined &&
            p.priority > topCharging.priority;
          if (couldCharge && outranked) {
            return [p.id, "Waiting for priority vehicle"];
          }
          return null;
        })
        .filter((entry): entry is [string, string] => entry !== null),
    );
  }, [priorityChargingEnabled, points, controllerStatuses]);
}

interface PointCardContext {
  vehicles: DashboardVehicle[];
  home: { lat: number; lng: number } | null;
  vehiclesLoading: boolean;
  vehicleErrors: Record<string, string | undefined>;
  solarGrid: Record<string, { solarW: number; gridW: number }>;
  allocationStatus: Record<string, string>;
  controllerStatuses: ReturnType<typeof useControllerStatuses>;
  wakeMutation: ReturnType<typeof trpc.vehicle.command.useMutation>;
  refreshMutation: ReturnType<typeof trpc.vehicle.refreshState.useMutation>;
  onNavigateSettings?: () => void;
}

function AsleepPointCard(
  { vehicle, ctx }: { vehicle: DashboardVehicle; ctx: PointCardContext },
) {
  const isWaking = ctx.wakeMutation.isPending &&
    ctx.wakeMutation.variables?.vehicleId === vehicle.id;
  return (
    <AsleepVehicleCard
      v={vehicle}
      isWaking={isWaking}
      onWake={() =>
        ctx.wakeMutation.mutate({ vehicleId: vehicle.id, command: "wake" })}
    />
  );
}

// A vehicle_api point IS the car — its own API is the control path — so it
// renders one card, and that card keeps its controls.
function VehicleApiPointCard(
  { point, vehicle, ctx }: {
    point: ChargingPoint;
    vehicle: DashboardVehicle;
    ctx: PointCardContext;
  },
) {
  if (!vehicle.state) return <AsleepPointCard vehicle={vehicle} ctx={ctx} />;
  return (
    <ConnectedVehicleCard
      vehicleId={vehicle.id}
      point={point}
      name={vehicle.name || vehicle.state.vehicleName}
      state={vehicle.state}
      priority={point.priority}
      solarPowerW={ctx.solarGrid[point.id]?.solarW ?? 0}
      gridPowerW={ctx.solarGrid[point.id]?.gridW ?? 0}
      loading={ctx.vehiclesLoading}
      lastLocation={vehicle.lastLocation}
      atHome={vehicle.lastLocation
        ? isHome(ctx.home, vehicle.lastLocation)
        : null}
      vehicleError={ctx.vehicleErrors[vehicle.id]}
      allocationStatus={ctx.allocationStatus[point.id] ?? null}
      pollingSuspended={vehicle.pollingSuspended}
      pollingSuspendReason={vehicle.pollingSuspendReason}
      controllerReason={ctx.controllerStatuses[point.id]?.reason ?? null}
      controllerDetail={ctx.controllerStatuses[point.id]?.detail ?? null}
      onNavigateSettings={ctx.onNavigateSettings}
      onRefresh={() =>
        ctx.refreshMutation.mutateAsync({ vehicleId: vehicle.id })}
    />
  );
}

// A smart charger is the control path, so its card carries the controls and
// the car rides alongside read-only: charging detail on the charger, battery
// and location on the car. Emitted as one fragment so nothing can be rendered
// between the pair. Also the fallback for a vehicle_api point whose vehicle is
// missing, so a point never renders nothing at all.
function SmartPointCards(
  { point, vehicle, ctx }: {
    point: ChargingPoint;
    vehicle: DashboardVehicle | null;
    ctx: PointCardContext;
  },
) {
  return (
    <>
      <ChargerCard
        id={point.id}
        name={point.name}
        mode={point.mode}
        state={point.state}
        solarW={ctx.solarGrid[point.id]?.solarW ?? 0}
        gridW={ctx.solarGrid[point.id]?.gridW ?? 0}
        controllerDetail={ctx.controllerStatuses[point.id]?.detail ?? null}
        controllerReason={ctx.controllerStatuses[point.id]?.reason ?? null}
        allocationStatus={ctx.allocationStatus[point.id] ?? null}
        onNavigateSettings={ctx.onNavigateSettings}
        vehicleResolution={point.vehicleResolution}
        resolvedVehicleName={vehicle?.name || null}
        controlOwner={point.controlOwner}
        passiveForVehicleName={ctx.vehicles.find((v) =>
          v.id === point.passiveForVehicleId
        )?.name || null}
        supportsRecovery={point.supportsRecovery}
      />
      {
        /* Nothing here while passive: the car commands itself, so its own
          vehicle_api point renders it, with controls. */
      }
      {point.controlOwner === "self" && vehicle?.state && (
        <VehicleCard
          readOnly
          chargingPoint={{ name: point.name }}
          name={vehicle.name || vehicle.state.vehicleName}
          state={vehicle.state}
          priority={point.priority}
          mode={point.mode as VehicleMode}
          commandPending={false}
          onStartCharging={() => {}}
          onStopCharging={() => {}}
          onSetAmps={() => {}}
          onChangeMode={() => {}}
          loading={ctx.vehiclesLoading}
          lastLocation={vehicle.lastLocation}
          atHome={vehicle.lastLocation
            ? isHome(ctx.home, vehicle.lastLocation)
            : null}
          vehicleError={ctx.vehicleErrors[vehicle.id]}
          pollingSuspended={vehicle.pollingSuspended}
          pollingSuspendReason={vehicle.pollingSuspendReason}
          // The charger card's badge and status line already say this.
          chargerStatus={null}
          onNavigateSettings={ctx.onNavigateSettings}
          onRefresh={() =>
            ctx.refreshMutation.mutateAsync({ vehicleId: vehicle.id })}
        />
      )}
      {point.controlOwner === "self" && vehicle && !vehicle.state && (
        <AsleepPointCard vehicle={vehicle} ctx={ctx} />
      )}
    </>
  );
}

// One card per charging point, plus the car's own card when a smart charger
// is what controls it.
function ChargingPointCards(
  { points, ...ctx }: { points: ChargingPoint[] } & PointCardContext,
) {
  const owner = useMemo(() => ownerByVehicleId(points), [points]);
  return (
    <>
      {points.map((point) => {
        const vehicleId = cardVehicleId(point);
        const owned = vehicleId !== null && owner.get(vehicleId) === point.id;
        const vehicle = owned
          ? ctx.vehicles.find((v) => v.id === vehicleId) ?? null
          : null;
        if (point.kind !== "smart" && vehicle !== null) {
          return (
            <VehicleApiPointCard
              key={point.id}
              point={point}
              vehicle={vehicle}
              ctx={ctx}
            />
          );
        }
        return (
          <SmartPointCards
            key={point.id}
            point={point}
            vehicle={vehicle}
            ctx={ctx}
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
  // On screen already = an active point RESOLVED to this car, which is not the
  // same as being assigned to one. An inferred car has no vehicleId anywhere,
  // and a car assigned to a charger it has since driven away from resolves to
  // nothing there and correctly gets its own card back here.
  const shown = new Set(
    points.map(cardVehicleId).filter((id) => id !== null),
  );
  return (
    <>
      {vehicles.filter((v) => !shown.has(v.id)).map((v) => {
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

      {!vehiclesLoading && vehicles.length === 0 && vehiclesError && (
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
