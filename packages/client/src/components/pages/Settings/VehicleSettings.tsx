import { Car, FlaskConical, Plus, Trash2 } from "lucide-react";
import { Badge, Button, Card, Text } from "@radix-ui/themes";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import {
  pluginSettingsComponents,
  vehiclePluginOptions,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";
import { demoMode } from "../../../lib/featureFlags.ts";
import { SettingsSection } from "./SettingsLayout.tsx";
import { useVehicleSettings } from "./useVehicleSettings.ts";

type Vehicle = ReturnType<typeof useVehicleSettings>["vehicles"][number];
type VehiclePlugin = ReturnType<
  typeof useVehicleSettings
>["vehiclePlugins"][number];

function VehicleRow(
  { v, recentlyAddedVins, handleDelete }: {
    v: Vehicle;
    recentlyAddedVins: Set<string>;
    handleDelete: (vin: string) => void;
  },
) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 10px",
        borderBottom: "1px solid var(--gray-a3)",
        borderRadius: 6,
        background: recentlyAddedVins.has(v.id)
          ? "var(--green-a3)"
          : "transparent",
        transition: "background 1s ease-out",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Car size={16} style={{ color: "var(--color-vehicle)" }} />
        <div>
          <Text size="2" weight="bold">{v.name}</Text>
          <Text size="1" color="gray" style={{ display: "block" }}>
            {v.id}
          </Text>
        </div>
        <Badge variant="outline" size="1">
          {vehiclePluginOptions.find((o) => o.id === v.adapterType)?.label ??
            v.adapterType}
        </Badge>
      </div>
      {
        /* Charging priority lives on the charging point (Chargers
          section) — vehicles are data-only. */
      }
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        <Button
          variant="ghost"
          color="red"
          size="1"
          onClick={() => handleDelete(v.id)}
        >
          <Trash2 size={14} />
        </Button>
      </div>
    </div>
  );
}

function UnconfiguredPluginCard(
  { plugin, handleStartOnboarding }: {
    plugin: VehiclePlugin;
    handleStartOnboarding: (id: string) => void;
  },
) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <Car size={14} />
        <Text size="2" weight="medium">{plugin.displayName}</Text>
        <Badge color="gray" size="1">Not configured</Badge>
      </div>
      <Text size="1" color="gray" style={{ display: "block", marginBottom: 8 }}>
        Run the setup wizard to configure {plugin.displayName} vehicles.
      </Text>
      <Button
        size="1"
        variant="soft"
        onClick={() => handleStartOnboarding(plugin.id)}
      >
        <Plus size={14} />
        Set up {plugin.displayName}
      </Button>
    </div>
  );
}

function SimulatedVehicleSection(
  { handleAddSimulatedVehicle, handleAddDataOnlyVehicle }: {
    handleAddSimulatedVehicle: () => void;
    handleAddDataOnlyVehicle: () => void;
  },
) {
  return (
    <div
      style={{
        marginTop: 12,
        paddingTop: 12,
        borderTop: "1px solid var(--gray-a4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
        }}
      >
        <FlaskConical size={14} />
        <Text size="2" weight="medium">Simulated Vehicle</Text>
      </div>
      <Text size="1" color="gray" style={{ display: "block", marginBottom: 8 }}>
        Add a virtual EV for testing charge control, schedules, and solar
        tracking without a real vehicle.
      </Text>
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="1" variant="soft" onClick={handleAddSimulatedVehicle}>
          <FlaskConical size={14} />
          Add Simulated Vehicle
        </Button>
        <Button size="1" variant="soft" onClick={handleAddDataOnlyVehicle}>
          <FlaskConical size={14} />
          Add Data-Only Vehicle
        </Button>
      </div>
    </div>
  );
}

function ConfiguredPluginSettings(
  { vehiclePlugins }: { vehiclePlugins: VehiclePlugin[] },
) {
  return (
    <>
      {vehiclePlugins
        .filter(
          (p): p is typeof p & { settingsComponentKey: string } =>
            !!(p.configured && p.settingsComponentKey),
        )
        .map((p) => {
          const SettingsComponent =
            pluginSettingsComponents[p.settingsComponentKey];
          if (!SettingsComponent) return null;
          return (
            <ErrorBoundary key={p.id} label="Plugin Settings">
              <SettingsComponent />
            </ErrorBoundary>
          );
        })}
    </>
  );
}

function VehicleListBlock(
  { vehicles, loadFailed, recentlyAddedVins, handleDelete }: {
    vehicles: Vehicle[];
    loadFailed: boolean;
    recentlyAddedVins: Set<string>;
    handleDelete: (vin: string) => void;
  },
) {
  return (
    <>
      {vehicles.length === 0 && !loadFailed && (
        <Text size="2" color="gray">No vehicles configured yet.</Text>
      )}
      {vehicles.length === 0 && loadFailed && (
        <Text size="2" color="gray">
          Could not load vehicles. Check that the server is running and try
          again.
        </Text>
      )}
      {vehicles.map((v) => (
        <VehicleRow
          key={v.id}
          v={v}
          recentlyAddedVins={recentlyAddedVins}
          handleDelete={handleDelete}
        />
      ))}
    </>
  );
}

export function VehicleSettings() {
  const {
    vehicles,
    loading,
    loadFailed,
    error,
    recentlyAddedVins,
    handleDelete,
    handleAddSimulatedVehicle,
    handleAddDataOnlyVehicle,
    vehiclePlugins,
    handleStartOnboarding,
  } = useVehicleSettings();

  if (loading) {
    return (
      <SettingsSection
        icon={<Car size={18} />}
        title="Vehicles"
        description="Manage your electric vehicles and charging integrations."
      >
        <Text size="2" color="gray">Loading vehicles...</Text>
      </SettingsSection>
    );
  }

  // In demo, hide plugins the demo can't set up (Tesla), mirroring wizard gating.
  const demoBlockedIds = demoMode.blockedPlugins(vehiclePluginOptions);

  // Unconfigured vehicle plugins with wizard steps (excludes simulated, which has none)
  const unconfiguredPlugins = vehiclePlugins.filter(
    (p) =>
      !p.configured && (vehiclePluginSteps[p.id]?.length ?? 0) > 0 &&
      !demoBlockedIds.has(p.id),
  );

  return (
    <>
      {error && (
        <Card style={{ borderLeft: "3px solid var(--red-9)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text size="2" color="red">{error}</Text>
          </div>
        </Card>
      )}

      <SettingsSection
        icon={<Car size={18} />}
        title="Vehicles"
        description="Manage your electric vehicles and charging integrations."
      >
        <VehicleListBlock
          vehicles={vehicles}
          loadFailed={loadFailed}
          recentlyAddedVins={recentlyAddedVins}
          handleDelete={handleDelete}
        />

        {unconfiguredPlugins.map((plugin) => (
          <UnconfiguredPluginCard
            key={plugin.id}
            plugin={plugin}
            handleStartOnboarding={handleStartOnboarding}
          />
        ))}

        <SimulatedVehicleSection
          handleAddSimulatedVehicle={handleAddSimulatedVehicle}
          handleAddDataOnlyVehicle={handleAddDataOnlyVehicle}
        />

        <ConfiguredPluginSettings vehiclePlugins={vehiclePlugins} />
      </SettingsSection>
    </>
  );
}
