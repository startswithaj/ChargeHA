import { useState } from "react";
import { ArrowDownIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Badge, Button, Dialog, Select, Text } from "@radix-ui/themes";
import { Plug } from "lucide-react";
import {
  chargerPluginOptions,
  pluginSettingsComponents,
} from "@chargeha/plugins/componentRegistry";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";
import { useChargers } from "../../../hooks/useChargers.ts";
import { trpc } from "../../../trpc.ts";
import { useRouter } from "../../../hooks/useRouter.ts";
import { clearPluginOnboarding } from "../../../hooks/usePluginOnboardingState.ts";

export function ChargersSection() {
  const { navigate } = useRouter();
  const { chargers } = useChargers();
  const utils = trpc.useUtils();
  const invalidate = () => utils.charger.list.invalidate();
  const removeMutation = trpc.charger.remove.useMutation({
    onSuccess: invalidate,
  });
  const reorderMutation = trpc.charger.reorder.useMutation({
    onSuccess: invalidate,
  });

  const move = (chargerId: string, direction: "up" | "down") => {
    const ids = chargers.map((c) => c.id);
    const index = ids.indexOf(chargerId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    next[index] = next[target];
    next[target] = chargerId;
    reorderMutation.mutate({ order: next });
  };
  const [adding, setAdding] = useState(false);
  const [confirm, setConfirm] = useState<
    { kind: "add" | "removeLast"; typeId?: string; chargerId?: string } | null
  >(null);

  // null vehicleId = smart charger; non-null = Tesla vehicle-API row
  const smartChargers = chargers.filter((c) => c.vehicleId === null);

  const requestAdd = (typeId: string) => {
    // first smart charger switches control path from vehicle API — confirm first
    const first = smartChargers.length === 0 && chargers.length > 0;
    if (first) setConfirm({ kind: "add", typeId });
    else startSetup(typeId);
  };

  const startSetup = (typeId: string) => {
    clearPluginOnboarding(typeId); // fresh run, drop any half-finished state
    navigate({ type: "pluginSetup", pluginId: typeId });
    setAdding(false);
    setConfirm(null);
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
    >
      {chargers.map((charger) => (
        <ChargerRowView
          key={charger.id}
          charger={charger}
          onRemove={() => requestRemove(charger.id)}
          onMove={(direction) => move(charger.id, direction)}
        />
      ))}

      {adding
        ? <AddChargerRow onAdd={requestAdd} />
        : <AddChargerButton onClick={() => setAdding(true)} />}

      {/* ongoing config only; first-time setup goes through startSetup */}
      {smartChargers.map((charger) => {
        const Panel = pluginSettingsComponents[
          `${charger.chargerAdapterType}-settings`
        ];
        return Panel ? <Panel key={charger.id} /> : null;
      })}

      <ControlPathDialog
        confirm={confirm}
        onCancel={() => setConfirm(null)}
        onConfirmAdd={(typeId) => startSetup(typeId)}
        onConfirmRemove={(chargerId) => {
          removeMutation.mutate({ id: chargerId });
          setConfirm(null);
        }}
      />
    </SettingsSection>
  );
}

function AddChargerRow({ onAdd }: { onAdd: (typeId: string) => void }) {
  return (
    <SettingsRow label="Charger type">
      <Select.Root onValueChange={onAdd}>
        <Select.Trigger placeholder="Choose a charger type" />
        <Select.Content>
          {chargerPluginOptions.map((o) => (
            <Select.Item key={o.id} value={o.id}>{o.label}</Select.Item>
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
  { charger, onRemove, onMove }: {
    charger: {
      id: string;
      name: string;
      chargerAdapterType: string;
      mode: string;
      priority: number;
      vehicleId: string | null;
      state: { status: string } | null;
    };
    onRemove: () => void;
    onMove: (direction: "up" | "down") => void;
  },
) {
  const label = charger.vehicleId
    ? `${charger.name} — via vehicle API`
    : charger.name;
  return (
    <SettingsRow label={label}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Badge size="1">{charger.mode}</Badge>
        <Text size="1" color="gray">priority {charger.priority}</Text>
        {charger.state && <Badge size="1">{charger.state.status}</Badge>}
        <Button size="1" variant="ghost" onClick={() => onMove("up")}>
          <ArrowUpIcon />
        </Button>
        <Button size="1" variant="ghost" onClick={() => onMove("down")}>
          <ArrowDownIcon />
        </Button>
        <Button size="1" variant="soft" color="red" onClick={onRemove}>
          Delete
        </Button>
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
