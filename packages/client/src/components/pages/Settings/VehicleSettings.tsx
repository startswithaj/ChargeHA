import { Car, FlaskConical, Key, Plus, Trash2 } from "lucide-react";
import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Badge, Button, Card, Switch, Text } from "@radix-ui/themes";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import {
  pluginSettingsComponents,
  vehiclePluginSteps,
} from "@chargeha/plugins/componentRegistry";
import {
  useChargingConfig,
  useChargingConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import { useVehicleSettings } from "./useVehicleSettings.ts";

type Vehicle = ReturnType<typeof useVehicleSettings>["vehicles"][number];
type VehiclePlugin = ReturnType<
  typeof useVehicleSettings
>["vehiclePlugins"][number];

function EncryptionWarning() {
  return (
    <Card style={{ borderLeft: "3px solid var(--orange-9)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Key size={20} style={{ color: "var(--orange-9)", flexShrink: 0 }} />
        <div>
          <Text size="2" weight="bold" style={{ display: "block" }}>
            Encryption Key Not Configured
          </Text>
          <Text size="2" color="gray">
            Secrets (API keys, tokens, passwords) will be stored in plain text
            instead of encrypted. Add <code>ENCRYPTION_KEY</code> to your{" "}
            <code>.env</code> file. Generate with:{" "}
            <code>openssl rand -base64 32</code>
          </Text>
        </div>
      </div>
    </Card>
  );
}

function VehicleRow(
  {
    v,
    idx,
    vehiclesLength,
    recentlyAddedVins,
    handleMovePriority,
    handleDelete,
  }: {
    v: Vehicle;
    idx: number;
    vehiclesLength: number;
    recentlyAddedVins: Set<string>;
    handleMovePriority: (vin: string, direction: "up" | "down") => void;
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
        <Badge variant="outline" size="1">{v.adapterType}</Badge>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
        {vehiclesLength > 1 && (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Text size="1" color="gray">Priority {v.priority}</Text>
            <Button
              variant="soft"
              size="1"
              disabled={idx === 0}
              onClick={() =>
                handleMovePriority(v.id, "up")}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              variant="soft"
              size="1"
              disabled={idx === vehiclesLength - 1}
              onClick={() => handleMovePriority(v.id, "down")}
            >
              <ArrowDownIcon />
            </Button>
          </div>
        )}
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
  { handleAddSimulatedVehicle }: { handleAddSimulatedVehicle: () => void },
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
      <Button size="1" variant="soft" onClick={handleAddSimulatedVehicle}>
        <FlaskConical size={14} />
        Add Simulated Vehicle
      </Button>
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

function PriorityChargingHeader(
  { priorityChargingEnabled, setPriorityCharging }: {
    priorityChargingEnabled: boolean;
    setPriorityCharging: (enabled: boolean) => void;
  },
) {
  return (
    <>
      <SettingsRow
        label="Priority Charging"
        help="When enabled, the highest-priority vehicle receives all excess solar first. Remaining solar flows to lower-priority vehicles. When disabled, available solar is split equally across all eligible vehicles."
      >
        <Switch
          size="2"
          checked={priorityChargingEnabled}
          onCheckedChange={setPriorityCharging}
        />
      </SettingsRow>
      <Text
        size="1"
        color="gray"
        style={{ display: "block", marginBottom: 4 }}
      >
        Priority determines which vehicle receives excess solar energy first.
        Lower priority number = charged first.
      </Text>
    </>
  );
}

function VehicleListBlock(
  { vehicles, loadFailed, recentlyAddedVins, handleMovePriority, handleDelete }:
    {
      vehicles: Vehicle[];
      loadFailed: boolean;
      recentlyAddedVins: Set<string>;
      handleMovePriority: (vin: string, direction: "up" | "down") => void;
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
      {[...vehicles].sort((a, b) => a.priority - b.priority).map((v, idx) => (
        <VehicleRow
          key={v.id}
          v={v}
          idx={idx}
          vehiclesLength={vehicles.length}
          recentlyAddedVins={recentlyAddedVins}
          handleMovePriority={handleMovePriority}
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
    encryptionMissing,
    handleDelete,
    handleMovePriority,
    handleAddSimulatedVehicle,
    vehiclePlugins,
    handleStartOnboarding,
  } = useVehicleSettings();

  const { data: chargingConfig } = useChargingConfig();
  const chargingMutation = useChargingConfigMutation();
  const priorityChargingEnabled = chargingConfig?.priorityChargingEnabled ??
    false;
  const setPriorityCharging = (enabled: boolean) => {
    chargingMutation.mutate({ priorityChargingEnabled: enabled });
  };

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

  // Unconfigured vehicle plugins with wizard steps (excludes simulated, which has none)
  const unconfiguredPlugins = vehiclePlugins.filter(
    (p) => !p.configured && (vehiclePluginSteps[p.id]?.length ?? 0) > 0,
  );

  return (
    <>
      {encryptionMissing && <EncryptionWarning />}

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
        {vehicles.length > 1 && (
          <PriorityChargingHeader
            priorityChargingEnabled={priorityChargingEnabled}
            setPriorityCharging={setPriorityCharging}
          />
        )}

        <VehicleListBlock
          vehicles={vehicles}
          loadFailed={loadFailed}
          recentlyAddedVins={recentlyAddedVins}
          handleMovePriority={handleMovePriority}
          handleDelete={handleDelete}
        />

        <ConfiguredPluginSettings vehiclePlugins={vehiclePlugins} />

        {unconfiguredPlugins.map((plugin) => (
          <UnconfiguredPluginCard
            key={plugin.id}
            plugin={plugin}
            handleStartOnboarding={handleStartOnboarding}
          />
        ))}

        <SimulatedVehicleSection
          handleAddSimulatedVehicle={handleAddSimulatedVehicle}
        />
      </SettingsSection>
    </>
  );
}
