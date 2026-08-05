import { useState } from "react";
import { Button, Dialog, Select, Switch, Text } from "@radix-ui/themes";
import { Plug } from "lucide-react";
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

export function ChargersSection() {
  const settings = useChargersSettings();
  return (
    <SettingsSection
      icon={<Plug size={18} />}
      title="Chargers"
      description="Manage smart chargers and their charging priority."
      saveStatus={settings.panels.saveStatus}
      isDirty={settings.panels.isDirty}
      onSave={settings.panels.save}
    >
      {settings.reorderable && <PriorityChargingRow />}

      {settings.chargers.length === 0 && (
        <Text size="2" color="gray">No chargers configured yet.</Text>
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

      <AddChargerRow onAdd={settings.startAdd} />

      {settings.error && <Text size="2" color="red">{settings.error}</Text>}

      <ChargerPluginPanels
        chargers={settings.chargers}
        reporterFor={settings.panels.reporterFor}
      />

      <ControlPathDialog
        confirm={settings.confirm}
        onCancel={settings.cancelConfirm}
        onConfirm={settings.acceptConfirm}
      />
    </SettingsSection>
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

function AddChargerRow({ onAdd }: { onAdd: (typeId: string) => void }) {
  const [choosing, setChoosing] = useState(false);
  const disabledIds = demoMode.blockedPlugins(chargerPluginOptions);

  if (!choosing) {
    return (
      <SettingsRow
        label="Add a charger"
        help="Connect a smart charger or wallbox."
      >
        <Button size="2" variant="soft" onClick={() => setChoosing(true)}>
          Add charger
        </Button>
      </SettingsRow>
    );
  }

  return (
    <SettingsRow label="Charger type">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Select.Root onValueChange={onAdd}>
          <Select.Trigger placeholder="Choose a charger type" />
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
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={() => setChoosing(false)}
        >
          Cancel
        </Button>
      </div>
    </SettingsRow>
  );
}

// Plugin config keys are plugin-scoped rather than per-row, so two chargers
// of one type share a single panel.
function ChargerPluginPanels(
  { chargers, reporterFor }: {
    chargers: ChargerWithState[];
    reporterFor: (key: string) => PanelReporter;
  },
) {
  const types = [...new Set(chargers.map((c) => c.chargerAdapterType))]
    .filter((type) => `${type}-settings` in pluginSettingsComponents);
  return (
    <>
      {types.map((type) => {
        const Panel = pluginSettingsComponents[`${type}-settings`];
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
