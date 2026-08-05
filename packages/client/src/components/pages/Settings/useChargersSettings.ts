import { useCallback, useState } from "react";
import { trpc } from "../../../trpc.ts";
import {
  type ChargerWithState,
  isSmartCharger,
  useChargers,
} from "../../../hooks/useChargers.ts";
import type { PluginSettingsState } from "./pluginSettingsHost.ts";
import type { SaveStatus } from "../../../hooks/useSectionConfig.ts";

export type ChargerConfirm =
  | { kind: "add"; typeId: string }
  | { kind: "removeLast"; chargerId: string };

export type PanelReporter = (state: PluginSettingsState | null) => void;

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

// Tapo/OCPP panels use PluginConfigForm, which renders fields but no Save —
// it reports dirty state up instead. Without this aggregation into the
// section header those panels cannot be saved at all.
function usePanelStates() {
  const [states, setStates] = useState<
    Record<string, PluginSettingsState | null>
  >({});
  const reporterFor = useCallback(
    (key: string): PanelReporter => (state) =>
      setStates((prev) => ({ ...prev, [key]: state })),
    [],
  );
  const live = Object.values(states).filter((s) => s !== null);
  const activeStatus = live.map((s) => s.saveStatus)
    .find((st) => st.state !== "idle");
  const saveStatus: SaveStatus = activeStatus ?? { state: "idle", tick: 0 };
  return {
    reporterFor,
    isDirty: live.some((s) => s.isDirty),
    save: () => live.filter((s) => s.isDirty).forEach((s) => s.save()),
    saveStatus,
  };
}

export function useChargersSettings() {
  const { chargers } = useChargers();
  const utils = trpc.useUtils();
  const invalidate = () => utils.charger.list.invalidate();

  const removeMutation = trpc.charger.remove.useMutation({
    onSuccess: invalidate,
  });
  const ensureMutation = trpc.charger.ensure.useMutation({
    onSuccess: invalidate,
  });
  const reorderMutation = trpc.charger.reorder.useMutation({
    onSuccess: invalidate,
  });

  const [pendingType, setPendingType] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ChargerConfirm | null>(null);
  const panels = usePanelStates();
  const smartChargers = chargers.filter(isSmartCharger);
  const needsAddConfirm = smartChargers.length === 0 && chargers.length > 0;

  const addCharger = (typeId: string) =>
    ensureMutation.mutate({ chargerAdapterType: typeId }, {
      onSuccess: () => setPendingType(null),
    });

  const confirmAdd = () => {
    if (!pendingType) return;
    if (needsAddConfirm) setConfirm({ kind: "add", typeId: pendingType });
    else addCharger(pendingType);
  };

  const requestRemove = (chargerId: string) => {
    if (smartChargers.length === 1 && smartChargers[0]?.id === chargerId) {
      setConfirm({ kind: "removeLast", chargerId });
    } else {
      removeMutation.mutate({ id: chargerId });
    }
  };

  const acceptConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === "add") addCharger(confirm.typeId);
    else removeMutation.mutate({ id: confirm.chargerId });
    setConfirm(null);
  };

  return {
    chargers,
    reorderable: chargers.length > 1,
    error: ensureMutation.error?.message ?? removeMutation.error?.message ??
      null,
    pendingType,
    confirm,
    panels,
    adding: ensureMutation.isPending,
    choose: setPendingType,
    cancelAdd: () => {
      ensureMutation.reset();
      setPendingType(null);
    },
    confirmAdd,
    requestRemove,
    acceptConfirm,
    cancelConfirm: () => setConfirm(null),
    move: (chargerId: string, direction: "up" | "down") => {
      const next = reorderedIds(
        chargers.map((c) => c.id),
        chargerId,
        direction,
      );
      if (next) reorderMutation.mutate({ order: next });
    },
  };
}

export type { ChargerWithState };
