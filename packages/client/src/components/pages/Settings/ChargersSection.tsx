import { Button, Dialog, Select, Switch, Text } from "@radix-ui/themes";
import { Plug } from "lucide-react";
import { chargerPluginOptions } from "@chargeha/plugins/componentRegistry";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import {
  useChargingConfig,
  useChargingConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { demoMode } from "../../../lib/featureFlags.ts";
import { ChargerRow } from "./ChargerRow.tsx";
import { ChargerEditDialog } from "./ChargerEditDialog.tsx";
import {
  type ChargerConfirm,
  hasSettingsPanel,
  useChargersSettings,
} from "./useChargersSettings.ts";
import { isSmartCharger } from "../../../hooks/useChargers.ts";

export function ChargersSection() {
  const settings = useChargersSettings();
  return (
    <SettingsSection
      icon={<Plug size={18} />}
      title="Chargers"
      description="Configure your smart chargers and their charging priority."
      action={<AddChargerSelect onChoose={settings.choose} />}
    >
      {settings.reorderable && <PriorityChargingRow />}

      {settings.chargers.length === 0 && (
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
          editable={isSmartCharger(charger) &&
            hasSettingsPanel(charger.chargerAdapterType)}
          onEdit={() => settings.edit(charger)}
          onRemove={() => settings.requestRemove(charger.id)}
          onMove={(direction) => settings.move(charger.id, direction)}
        />
      ))}

      {settings.error && !settings.editing && (
        <Text size="2" color="red">{settings.error}</Text>
      )}

      {settings.editing && (
        <ChargerEditDialog
          typeId={settings.editing.typeId}
          title={settings.editing.mode === "add"
            ? `Add ${labelFor(settings.editing.typeId)}`
            : settings.editing.name}
          description={settings.editing.mode === "add"
            ? descriptionFor(settings.editing.typeId)
            : undefined}
          submitLabel={settings.editing.mode === "add" ? "Add charger" : "Save"}
          error={settings.error}
          busy={settings.busy}
          onSubmit={settings.submitDialog}
          onCancel={settings.closeDialog}
        />
      )}

      <ControlPathDialog
        confirm={settings.confirm}
        onCancel={settings.cancelConfirm}
        onConfirm={settings.acceptConfirm}
      />
    </SettingsSection>
  );
}

const labelFor = (typeId: string) =>
  chargerPluginOptions.find((o) => o.id === typeId)?.label ?? typeId;

const descriptionFor = (typeId: string) =>
  chargerPluginOptions.find((o) => o.id === typeId)?.description;

function AddChargerSelect({ onChoose }: { onChoose: (id: string) => void }) {
  const disabledIds = demoMode.blockedPlugins(chargerPluginOptions);
  return (
    <Select.Root value="" onValueChange={onChoose}>
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
