import { Button, Dialog, DropdownMenu, Switch, Text } from "@radix-ui/themes";
import { ChevronDown, Plug, Plus } from "lucide-react";
import { chargerPluginOptions } from "@chargeha/plugins/componentRegistry";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import {
  useChargingConfig,
  useChargingConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { demoMode } from "../../../lib/featureFlags.ts";
import { ChargerRow } from "./ChargerRow.tsx";
import { ChargerEditForm } from "./ChargerEditForm.tsx";
import {
  type ChargerConfirm,
  hasSettingsPanel,
  useChargersSettings,
} from "./useChargersSettings.ts";
import {
  type ChargerWithState,
  isSmartCharger,
} from "../../../hooks/useChargers.ts";

const labelFor = (typeId: string) =>
  chargerPluginOptions.find((o) => o.id === typeId)?.label ?? typeId;

export function ChargersSection() {
  const settings = useChargersSettings();
  return (
    <SettingsSection
      icon={<Plug size={18} />}
      title="Chargers"
      description="Configure your smart chargers and their charging priority."
    >
      {settings.reorderable && <PriorityChargingRow />}

      <div
        style={{
          marginTop: 4,
          paddingTop: 12,
          borderTop: "1px solid var(--gray-a4)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <Text size="2" weight="bold">Charging Points</Text>
          <AddChargerSelect onChoose={settings.choose} />
        </div>

        <ChargerList settings={settings} />
      </div>

      <ControlPathDialog
        confirm={settings.confirm}
        onCancel={settings.cancelConfirm}
        onConfirm={settings.acceptConfirm}
      />
    </SettingsSection>
  );
}

function ChargerList(
  { settings }: { settings: ReturnType<typeof useChargersSettings> },
) {
  const editing = settings.editing;
  return (
    <>
      {settings.chargers.length === 0 && editing === null && (
        <Text size="2" color="gray">
          No chargers configured. Add one to control charging through a smart
          charger instead of the vehicle's own API.
        </Text>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {settings.chargers.map((charger) => (
          <ChargerListItem
            key={charger.id}
            charger={charger}
            settings={settings}
            expanded={editing?.mode === "edit" &&
              editing.chargerId === charger.id}
          />
        ))}
      </div>

      {editing?.mode === "add" && (
        <div style={{ marginTop: 8 }}>
          <div
            style={{
              padding: "8px 10px 0",
              borderRadius: 6,
              background: "var(--gray-a2)",
            }}
          >
            <Text size="2" weight="bold">New {labelFor(editing.typeId)}</Text>
            <ChargerEditForm
              typeId={editing.typeId}
              submitLabel="Add"
              error={settings.error}
              busy={settings.busy}
              onSubmit={settings.submitEdit}
              onCancel={settings.cancelEdit}
            />
          </div>
        </div>
      )}

      {settings.error && editing === null && (
        <Text size="2" color="red">{settings.error}</Text>
      )}
    </>
  );
}

// Row and its editor share one grey band so an open charger reads as a single
// expanded block rather than two stacked things.
function ChargerListItem(
  { charger, settings, expanded }: {
    charger: ChargerWithState;
    settings: ReturnType<typeof useChargersSettings>;
    expanded: boolean;
  },
) {
  return (
    <div style={{ borderRadius: 6, background: "var(--gray-a2)" }}>
      <ChargerRow
        charger={charger}
        reorderable={settings.reorderable}
        editable={isSmartCharger(charger) &&
          hasSettingsPanel(charger.chargerAdapterType)}
        expanded={expanded}
        onEdit={() => expanded ? settings.cancelEdit() : settings.edit(charger)}
        onRemove={() => settings.requestRemove(charger.id)}
        onMove={(direction) => settings.move(charger.id, direction)}
      />
      {expanded && (
        <ChargerEditForm
          typeId={charger.chargerAdapterType}
          submitLabel="Save"
          error={settings.error}
          busy={settings.busy}
          onSubmit={settings.submitEdit}
          onCancel={settings.cancelEdit}
        />
      )}
    </div>
  );
}

function AddChargerSelect({ onChoose }: { onChoose: (id: string) => void }) {
  const disabledIds = demoMode.blockedPlugins(chargerPluginOptions);
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger>
        <Button size="1" variant="soft">
          <Plus size={14} />
          Add charger
          <ChevronDown size={14} />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Content>
        {chargerPluginOptions.map((option) => (
          <DropdownMenu.Item
            key={option.id}
            disabled={disabledIds.has(option.id)}
            onSelect={() => onChoose(option.id)}
          >
            {option.label}
          </DropdownMenu.Item>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
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
      <Dialog.Content maxWidth="450px">
        <Dialog.Title>
          {adding
            ? "Switch to smart charger control?"
            : "Switch back to vehicle control?"}
        </Dialog.Title>
        <Dialog.Description size="2" color="gray">
          {adding
            ? "Your vehicle will now charge via the smart charger — its API stays connected for battery data. Continue?"
            : "This is your last smart charger. Removing it switches charge control back to your vehicle's API, if your vehicle's API supports it. Continue?"}
        </Dialog.Description>
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 16,
            justifyContent: "flex-end",
          }}
        >
          <Button variant="soft" color="gray" onClick={onCancel}>Cancel</Button>
          <Button onClick={onConfirm}>Continue</Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
