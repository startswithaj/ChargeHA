import { Button, Dialog, Select, Switch, Text } from "@radix-ui/themes";
import { Plug, Plus } from "lucide-react";
import {
  chargerPluginOptions,
  pluginSettingsComponents,
} from "@chargeha/plugins/componentRegistry";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import {
  useChargingConfig,
  useChargingConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import { PluginSettingsHostProvider } from "./pluginSettingsHost.ts";
import { demoMode } from "../../../lib/featureFlags.ts";
import { ChargerRow } from "./ChargerRow.tsx";
import {
  type ChargerConfirm,
  type PanelReporter,
  useChargersSettings,
} from "./useChargersSettings.ts";
import type { ChargerWithState } from "../../../hooks/useChargers.ts";

const panelKeyFor = (typeId: string) => `${typeId}-settings`;

export function ChargersSection() {
  const settings = useChargersSettings();
  const configuredTypes = [
    ...new Set(settings.chargers.map((c) => c.chargerAdapterType)),
  ];

  return (
    <SettingsSection
      icon={<Plug size={18} />}
      title="Chargers"
      description="Configure your smart chargers and their charging priority."
      action={settings.pendingType === null
        ? <AddChargerSelect onChoose={settings.choose} />
        : undefined}
      saveStatus={settings.panels.saveStatus}
      isDirty={settings.panels.isDirty}
      onSave={settings.panels.save}
    >
      {settings.reorderable && <PriorityChargingRow />}

      {settings.chargers.length === 0 && settings.pendingType === null && (
        <Text size="2" color="gray">
          No chargers configured yet. Add one to control charging through a
          smart charger instead of the vehicle's own API.
        </Text>
      )}

      {settings.chargers.map((charger) => (
        <ChargerRow
          key={charger.id}
          charger={charger}
          reorderable={settings.reorderable}
          onRemove={() => settings.requestRemove(charger.id)}
          onMove={(direction) => settings.move(charger.id, direction)}
        />
      ))}

      {settings.pendingType !== null && (
        <PendingCharger
          typeId={settings.pendingType}
          adding={settings.adding}
          reporterFor={settings.panels.reporterFor}
          onAdd={settings.confirmAdd}
          onCancel={settings.cancelAdd}
        />
      )}

      <ConfiguredPluginSettings
        types={configuredTypes}
        pendingType={settings.pendingType}
        reporterFor={settings.panels.reporterFor}
      />

      {settings.error && <Text size="2" color="red">{settings.error}</Text>}

      <ControlPathDialog
        confirm={settings.confirm}
        onCancel={settings.cancelConfirm}
        onConfirm={settings.acceptConfirm}
      />
    </SettingsSection>
  );
}

function AddChargerSelect({ onChoose }: { onChoose: (id: string) => void }) {
  const disabledIds = demoMode.blockedPlugins(chargerPluginOptions);
  return (
    <Select.Root onValueChange={onChoose}>
      <Select.Trigger placeholder="Add charger" variant="soft" />
      <Select.Content>
        {chargerPluginOptions.map((option) => (
          <Select.Item
            key={option.id}
            value={option.id}
            disabled={disabledIds.has(option.id)}
          >
            {option.label}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function PendingCharger(
  { typeId, adding, reporterFor, onAdd, onCancel }: {
    typeId: string;
    adding: boolean;
    reporterFor: (key: string) => PanelReporter;
    onAdd: () => void;
    onCancel: () => void;
  },
) {
  const option = chargerPluginOptions.find((o) => o.id === typeId);
  const Panel = pluginSettingsComponents[panelKeyFor(typeId)];
  return (
    <>
      <SettingsRow
        label={`New ${option?.label ?? typeId}`}
        help={option?.description}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button size="1" onClick={onAdd} disabled={adding}>
            <Plus size={14} />
            Add
          </Button>
          <Button size="1" variant="soft" color="gray" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </SettingsRow>
      {Panel && (
        <PluginSettingsHostProvider value={reporterFor(typeId)}>
          <ErrorBoundary label="Plugin Settings">
            <Panel />
          </ErrorBoundary>
        </PluginSettingsHostProvider>
      )}
    </>
  );
}

// Plugin config keys are plugin-scoped rather than per-row, so two chargers
// of one type share a single panel.
function ConfiguredPluginSettings(
  { types, pendingType, reporterFor }: {
    types: string[];
    pendingType: string | null;
    reporterFor: (key: string) => PanelReporter;
  },
) {
  return (
    <>
      {types
        .filter((type) =>
          type !== pendingType && panelKeyFor(type) in pluginSettingsComponents
        )
        .map((type) => {
          const Panel = pluginSettingsComponents[panelKeyFor(type)];
          if (!Panel) return null;
          return (
            <PluginSettingsHostProvider key={type} value={reporterFor(type)}>
              <ErrorBoundary label="Plugin Settings">
                <Panel />
              </ErrorBoundary>
            </PluginSettingsHostProvider>
          );
        })}
    </>
  );
}

function PriorityChargingRow() {
  const { data: chargingConfig } = useChargingConfig();
  const chargingMutation = useChargingConfigMutation();
  return (
    <SettingsRow
      label="Priority charging"
      help="When enabled, the highest-priority charging point receives all excess solar first. Remaining solar flows to lower-priority charging points. When disabled, available solar is split equally. Lower priority number = charged first."
    >
      <Switch
        size="2"
        checked={chargingConfig?.priorityChargingEnabled ?? false}
        onCheckedChange={(enabled) =>
          chargingMutation.mutate({ priorityChargingEnabled: enabled })}
      />
    </SettingsRow>
  );
}

function ControlPathDialog(
  { confirm, onCancel, onConfirm }: {
    confirm: ChargerConfirm | null;
    onCancel: () => void;
    onConfirm: () => void;
  },
) {
  if (!confirm) return null;
  const adding = confirm.kind === "add";
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Content>
        <Dialog.Title>
          {adding
            ? "Switch to smart charger control?"
            : "Switch back to vehicle control?"}
        </Dialog.Title>
        <Dialog.Description size="2">
          {adding
            ? "Your vehicle will now charge via the smart charger — its API stays connected for battery data. Continue?"
            : "This is your last smart charger. Removing it switches charge control back to your vehicle's API, if your vehicle's API supports it. Continue?"}
        </Dialog.Description>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button size="2" onClick={onConfirm}>Continue</Button>
          <Button size="2" variant="soft" onClick={onCancel}>Cancel</Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}

export type { ChargerWithState };
