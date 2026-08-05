import { useCallback, useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Badge, Button, Dialog, Select, Switch, Text } from "@radix-ui/themes";
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
import {
  PluginSettingsHostProvider,
  type PluginSettingsState,
} from "./pluginSettingsHost.ts";
import type { SaveStatus } from "../../../hooks/useSectionConfig.ts";
import { useChargers } from "../../../hooks/useChargers.ts";
import { trpc } from "../../../trpc.ts";
import { demoMode } from "../../../lib/featureFlags.ts";

function reorderedIds(
  ids: string[],
  chargerId: string,
  direction: "up" | "down",
): string[] | null {
  const index = ids.indexOf(chargerId);
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return null;
  const next = [...ids];
  next[index] = next[target];
  next[target] = chargerId;
  return next;
}

// Aggregates every mounted panel's state into the single header Save.
function usePanelStates() {
  const [states, setStates] = useState<
    Record<string, PluginSettingsState | null>
  >({});
  const reporterFor = useCallback(
    (key: string) => (state: PluginSettingsState | null) =>
      setStates((prev) => ({ ...prev, [key]: state })),
    [],
  );
  const live = Object.values(states).filter((s) => s !== null);
  const isDirty = live.some((s) => s.isDirty);
  const save = () => live.filter((s) => s.isDirty).forEach((s) => s.save());
  const activeStatus = live.map((s) => s.saveStatus)
    .find((st) => st.state !== "idle");
  const saveStatus: SaveStatus = activeStatus ?? { state: "idle", tick: 0 };
  return { reporterFor, isDirty, save, saveStatus };
}

function useChargerMutations() {
  const utils = trpc.useUtils();
  const invalidate = () => utils.charger.list.invalidate();
  return {
    removeMutation: trpc.charger.remove.useMutation({ onSuccess: invalidate }),
    ensureMutation: trpc.charger.ensure.useMutation({ onSuccess: invalidate }),
    reorderMutation: trpc.charger.reorder.useMutation({
      onSuccess: invalidate,
    }),
  };
}

function PriorityChargingRow() {
  const { data: chargingConfig } = useChargingConfig();
  const chargingMutation = useChargingConfigMutation();
  return (
    <SettingsRow
      label="Priority Charging"
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

export function ChargersSection() {
  const { chargers } = useChargers();
  const { removeMutation, ensureMutation, reorderMutation } =
    useChargerMutations();

  const move = (chargerId: string, direction: "up" | "down") => {
    const next = reorderedIds(chargers.map((c) => c.id), chargerId, direction);
    if (next) reorderMutation.mutate({ order: next });
  };
  const panels = usePanelStates();
  const [adding, setAdding] = useState(false);
  const [pendingType, setPendingType] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<
    { kind: "add" | "removeLast"; typeId?: string; chargerId?: string } | null
  >(null);

  const smartChargers = chargers.filter((c) => c.vehicleId === null);

  const pickType = (typeId: string) => {
    setAdding(false);
    if (chargerPluginOptions.find((o) => o.id === typeId)?.directAdd) {
      requestAdd(typeId);
    } else {
      setPendingType(typeId);
    }
  };

  const requestAdd = (typeId: string) => {
    const first = smartChargers.length === 0 && chargers.length > 0;
    if (first) setConfirm({ kind: "add", typeId });
    else addCharger(typeId);
  };

  const addCharger = (typeId: string) => {
    setConfirm(null);
    ensureMutation.mutate({ chargerAdapterType: typeId }, {
      onSuccess: () => setPendingType(null),
    });
  };

  const requestRemove = (chargerId: string) => {
    const last = smartChargers.length === 1 &&
      smartChargers[0]?.id === chargerId;
    if (last) setConfirm({ kind: "removeLast", chargerId });
    else removeMutation.mutate({ id: chargerId });
  };

  return (
    <SettingsSection
      icon={<Plug size={18} />}
      title="Chargers"
      description="Manage smart chargers and their charging priority."
      saveStatus={panels.saveStatus}
      isDirty={panels.isDirty}
      onSave={panels.save}
    >
      {chargers.length > 1 && <PriorityChargingRow />}

      {chargers.map((charger) => (
        <ChargerListItem
          key={charger.id}
          charger={charger}
          reorderable={chargers.length > 1}
          configuring={configuring === charger.id}
          onConfigure={() =>
            setConfiguring(configuring === charger.id ? null : charger.id)}
          onRemove={() => requestRemove(charger.id)}
          onMove={(direction) => move(charger.id, direction)}
          reporterFor={panels.reporterFor}
        />
      ))}

      {adding && <AddChargerRow onAdd={pickType} />}
      {!adding && pendingType === null && (
        <AddChargerButton onClick={() => setAdding(true)} />
      )}

      {pendingType !== null && (
        <PluginSettingsHostProvider value={panels.reporterFor(pendingType)}>
          <PendingChargerSetup
            typeId={pendingType}
            error={ensureMutation.error?.message ?? null}
            onAdd={() =>
              requestAdd(pendingType)}
            onCancel={() => {
              ensureMutation.reset();
              setPendingType(null);
            }}
          />
        </PluginSettingsHostProvider>
      )}

      <ControlPathDialog
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirmAdd={(typeId) => addCharger(typeId)}
        onConfirmRemove={(chargerId) => {
          removeMutation.mutate({ id: chargerId });
          setConfirm(null);
        }}
      />
    </SettingsSection>
  );
}

function ChargerListItem(
  {
    charger,
    reorderable,
    configuring,
    onConfigure,
    onRemove,
    onMove,
    reporterFor,
  }: {
    charger: {
      id: string;
      name: string;
      chargerAdapterType: string;
      mode: string;
      priority: number;
      vehicleId: string | null;
      state: { status: string } | null;
    };
    reorderable: boolean;
    configuring: boolean;
    onConfigure: () => void;
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
    reporterFor: (key: string) => (state: PluginSettingsState | null) => void;
  },
) {
  const configurable = charger.vehicleId === null &&
    `${charger.chargerAdapterType}-settings` in pluginSettingsComponents;
  return (
    <div>
      <ChargerRowView
        charger={charger}
        reorderable={reorderable}
        configurable={configurable}
        configuring={configuring}
        onConfigure={onConfigure}
        onRemove={onRemove}
        onMove={onMove}
      />
      {configuring && (
        <ChargerConfigPanel charger={charger} reporterFor={reporterFor} />
      )}
    </div>
  );
}

function ChargerConfigPanel(
  { charger, reporterFor }: {
    charger: { id: string; chargerAdapterType: string };
    reporterFor: (key: string) => (state: PluginSettingsState | null) => void;
  },
) {
  const Panel = pluginSettingsComponents[
    `${charger.chargerAdapterType}-settings`
  ];
  if (!Panel) return null;
  return (
    <div
      style={{
        margin: "4px 0 12px 12px",
        paddingLeft: 14,
        borderLeft: "2px solid var(--gray-a5)",
      }}
    >
      <PluginSettingsHostProvider value={reporterFor(charger.id)}>
        <ErrorBoundary label="Plugin Settings">
          <Panel />
        </ErrorBoundary>
      </PluginSettingsHostProvider>
    </div>
  );
}

function PendingChargerSetup(
  { typeId, error, onAdd, onCancel }: {
    typeId: string;
    error: string | null;
    onAdd: () => void;
    onCancel: () => void;
  },
) {
  const option = chargerPluginOptions.find((o) => o.id === typeId);
  const Panel = pluginSettingsComponents[`${typeId}-settings`];
  return (
    <>
      <SettingsRow label={`New ${option?.label ?? typeId} charger`}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Button size="1" onClick={onAdd}>Add charger</Button>
          <Button size="1" variant="soft" color="gray" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </SettingsRow>
      {Panel && (
        <ErrorBoundary label="Plugin Settings">
          <Panel />
        </ErrorBoundary>
      )}
      {error && <Text size="2" color="red">{error}</Text>}
    </>
  );
}

function AddChargerRow({ onAdd }: { onAdd: (typeId: string) => void }) {
  const disabledIds = demoMode.blockedPlugins(chargerPluginOptions);
  return (
    <SettingsRow label="Charger type">
      <Select.Root onValueChange={onAdd}>
        <Select.Trigger placeholder="Choose a charger type" />
        <Select.Content>
          {chargerPluginOptions.map((o) => (
            <Select.Item
              key={o.id}
              value={o.id}
              disabled={disabledIds.has(o.id)}
            >
              {o.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </SettingsRow>
  );
}

function AddChargerButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="2" variant="soft" onClick={onClick}>
      Add charger
    </Button>
  );
}

function ChargerRowView(
  {
    charger,
    reorderable,
    configurable,
    configuring,
    onConfigure,
    onRemove,
    onMove,
  }: {
    charger: {
      id: string;
      name: string;
      chargerAdapterType: string;
      mode: string;
      priority: number;
      vehicleId: string | null;
      state: { status: string } | null;
    };
    reorderable: boolean;
    configurable: boolean;
    configuring: boolean;
    onConfigure: () => void;
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
  },
) {
  // Vehicle-API rows are created and retired by control-path switching.
  const linked = charger.vehicleId !== null;
  const label = linked ? `${charger.name} — via vehicle API` : charger.name;
  return (
    <SettingsRow label={label}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Badge size="1">{charger.mode}</Badge>
        {reorderable && (
          <Text size="1" color="gray">priority {charger.priority}</Text>
        )}
        {charger.state && <Badge size="1">{charger.state.status}</Badge>}
        {reorderable && (
          <>
            <Button size="1" variant="ghost" onClick={() => onMove("up")}>
              <ArrowUpIcon />
            </Button>
            <Button size="1" variant="ghost" onClick={() => onMove("down")}>
              <ArrowDownIcon />
            </Button>
          </>
        )}
        <Button
          size="1"
          variant="soft"
          disabled={!configurable}
          onClick={onConfigure}
        >
          {configuring ? "Close" : "Configure"}
        </Button>
        {!linked && (
          <Button size="1" variant="soft" color="red" onClick={onRemove}>
            Delete
          </Button>
        )}
      </div>
    </SettingsRow>
  );
}

function ControlPathDialog(
  { confirm, onCancel, onConfirmAdd, onConfirmRemove }: {
    confirm:
      | { kind: "add" | "removeLast"; typeId?: string; chargerId?: string }
      | null;
    onCancel: () => void;
    onConfirmAdd: (typeId: string) => void;
    onConfirmRemove: (chargerId: string) => void;
  },
) {
  if (!confirm) return null;
  const adding = confirm.kind === "add";
  const handleContinue = () => {
    if (adding) {
      if (confirm.typeId) onConfirmAdd(confirm.typeId);
      return;
    }
    if (confirm.chargerId) onConfirmRemove(confirm.chargerId);
  };
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
          <Button size="2" onClick={handleContinue}>
            Continue
          </Button>
          <Button size="2" variant="soft" onClick={onCancel}>Cancel</Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
