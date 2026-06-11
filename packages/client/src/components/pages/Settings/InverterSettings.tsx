import { useCallback, useState } from "react";
import { Plus, Zap } from "lucide-react";
import { Button, Select, Text } from "@radix-ui/themes";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import {
  type SaveStatus,
  useEquipmentConfig,
  useEquipmentConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import {
  PluginSettingsHostProvider,
  type PluginSettingsState,
} from "./pluginSettingsHost.ts";
import { trpc } from "../../../trpc.ts";
import { useRouter } from "../../../hooks/useRouter.ts";
import {
  energyPluginOptions,
  energyPluginSteps,
  pluginSettingsComponents,
} from "@chargeha/plugins/componentRegistry";
import { demoMode } from "../../../lib/featureFlags.ts";

function PluginSelect(
  { value, onChange, pluginsByVendor, disabledIds }: {
    value: string;
    onChange: (v: string) => void;
    pluginsByVendor: Record<string, Array<{ id: string; displayName: string }>>;
    disabledIds: ReadonlySet<string>;
  },
) {
  return (
    <Select.Root
      value={value || "_none"}
      onValueChange={(v) => onChange(v === "_none" ? "" : v)}
    >
      <Select.Trigger
        placeholder="Select your equipment..."
        style={{ minWidth: 200 }}
      />
      <Select.Content>
        <Select.Item value="_none">Not configured</Select.Item>
        {Object.entries(pluginsByVendor).map(([vendor, vendorPlugins]) => (
          <Select.Group key={vendor}>
            <Select.Label>{vendor}</Select.Label>
            {vendorPlugins.map((plugin) => (
              <Select.Item
                key={plugin.id}
                value={plugin.id}
                disabled={disabledIds.has(plugin.id)}
              >
                {plugin.displayName}
              </Select.Item>
            ))}
          </Select.Group>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

/** Merge the panel's own draft save state with a plugin settings component's. */
function useCombinedSaveState(
  baseIsDirty: boolean,
  baseSave: () => void,
  baseSaveStatus: SaveStatus,
): {
  setPluginState: (s: PluginSettingsState | null) => void;
  isDirty: boolean;
  save: () => void;
  saveStatus: SaveStatus;
} {
  const [pluginState, setPluginState] = useState<PluginSettingsState | null>(
    null,
  );
  const save = useCallback(() => {
    if (baseIsDirty) baseSave();
    pluginState?.save();
  }, [baseIsDirty, baseSave, pluginState]);
  const isDirty = baseIsDirty || !!pluginState?.isDirty;
  const saveStatus = pluginState && pluginState.saveStatus.state !== "idle"
    ? pluginState.saveStatus
    : baseSaveStatus;
  return { setPluginState, isDirty, save, saveStatus };
}

type VendorPlugin = { id: string; displayName: string; vendor: string };

/** Group energy plugins by vendor for the dropdown's grouped options. */
function groupPluginsByVendor(
  plugins: VendorPlugin[],
): Record<string, Array<{ id: string; displayName: string }>> {
  return plugins.reduce<
    Record<string, Array<{ id: string; displayName: string }>>
  >((acc, plugin) => {
    if (!acc[plugin.vendor]) acc[plugin.vendor] = [];
    acc[plugin.vendor].push({ id: plugin.id, displayName: plugin.displayName });
    return acc;
  }, {});
}

export function InverterSettings() {
  const { navigate } = useRouter();
  const { data: config } = useEquipmentConfig();
  const mutation = useEquipmentConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );
  const { data: plugins } = trpc.energy.getPlugins.useQuery();

  const handleStartOnboarding = useCallback((pluginId: string) => {
    navigate({ type: "pluginSetup", pluginId });
  }, []);

  // A plugin settings component (e.g. simulated solar) reports its own dirty/
  // save state, so this panel's header Save + dirty highlight cover it too.
  const {
    setPluginState,
    isDirty: combinedDirty,
    save: combinedSave,
    saveStatus: combinedSaveStatus,
  } = useCombinedSaveState(isDirty, save, saveStatus);

  if (!fields) return null;

  const adapterConfigured = !!fields.energyAdapterType;

  // Group plugins by vendor for the dropdown
  const pluginsByVendor = groupPluginsByVendor(plugins ?? []);

  // In demo, disable energy plugins the demo can't serve (Fronius local/cloud).
  const disabledIds = demoMode.blockedPlugins(energyPluginOptions);

  // Resolve the settings component for the currently selected adapter
  const selectedPlugin = (plugins ?? []).find(
    (p) => p.id === fields.energyAdapterType,
  );
  const SettingsComponent = selectedPlugin?.settingsComponentKey
    ? pluginSettingsComponents[selectedPlugin.settingsComponentKey]
    : undefined;

  // Check if the selected plugin needs onboarding (has wizard steps, isn't configured, and has no inline settings)
  const selectedNeedsSetup = selectedPlugin !== undefined &&
    needsOnboarding(selectedPlugin, SettingsComponent);

  function needsOnboarding(
    plugin: NonNullable<typeof selectedPlugin>,
    settings: typeof SettingsComponent,
  ): boolean {
    return !plugin.configured &&
      !settings &&
      (energyPluginSteps[plugin.id]?.length ?? 0) > 0;
  }

  return (
    <SettingsSection
      icon={<Zap size={18} />}
      title="My Equipment"
      description="Configure your inverter or smart meter for energy monitoring."
      saveStatus={combinedSaveStatus}
      isDirty={combinedDirty}
      onSave={combinedSave}
    >
      <SettingsRow label="Energy source">
        <PluginSelect
          value={fields.energyAdapterType ?? ""}
          onChange={(v) => setField("energyAdapterType", v)}
          pluginsByVendor={pluginsByVendor}
          disabledIds={disabledIds}
        />
      </SettingsRow>

      {/* Show "Set up" button for selected but unconfigured plugins without inline settings */}
      {selectedNeedsSetup && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginTop: 8,
          }}
        >
          <Button
            size="1"
            variant="soft"
            onClick={() => handleStartOnboarding(selectedPlugin.id)}
          >
            <Plus size={14} />
            Set up {selectedPlugin.displayName}
          </Button>
        </div>
      )}

      {/* Render plugin settings component dynamically */}
      {SettingsComponent && (
        <ErrorBoundary label="Plugin Settings">
          <PluginSettingsHostProvider value={setPluginState}>
            <SettingsComponent />
          </PluginSettingsHostProvider>
        </ErrorBoundary>
      )}

      {!adapterConfigured && (
        <Text size="1" color="orange">
          Select your inverter or smart meter to start monitoring energy.
        </Text>
      )}
    </SettingsSection>
  );
}
