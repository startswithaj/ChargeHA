import { useState } from "react";
import { pluginSettingsComponents } from "@chargeha/plugins/componentRegistry";
import { trpc } from "../../../trpc.ts";
import {
  type ChargerWithState,
  isSmartCharger,
  useChargers,
} from "../../../hooks/useChargers.ts";

export type ChargerConfirm =
  | { kind: "add"; typeId: string }
  | { kind: "removeLast"; chargerId: string };

/** Which dialog is open: adding a new charger of a type, or editing one. */
export type ChargerEditing =
  | { mode: "add"; typeId: string }
  | { mode: "edit"; typeId: string; name: string };

export const hasSettingsPanel = (typeId: string): boolean =>
  `${typeId}-settings` in pluginSettingsComponents;

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

  const [editing, setEditing] = useState<ChargerEditing | null>(null);
  const [confirm, setConfirm] = useState<ChargerConfirm | null>(null);
  const smartChargers = chargers.filter(isSmartCharger);
  const needsAddConfirm = smartChargers.length === 0 && chargers.length > 0;

  const closeDialog = () => {
    ensureMutation.reset();
    setEditing(null);
  };

  const addCharger = (typeId: string) =>
    ensureMutation.mutate({ chargerAdapterType: typeId }, {
      onSuccess: () => setEditing(null),
    });

  // Adding a charger with no settings panel has nothing to configure, so it
  // skips the dialog entirely.
  const choose = (typeId: string) => {
    if (hasSettingsPanel(typeId)) setEditing({ mode: "add", typeId });
    else if (needsAddConfirm) setConfirm({ kind: "add", typeId });
    else addCharger(typeId);
  };

  const submitDialog = () => {
    if (editing?.mode !== "add") {
      setEditing(null);
      return;
    }
    if (needsAddConfirm) {
      setConfirm({ kind: "add", typeId: editing.typeId });
      setEditing(null);
    } else {
      addCharger(editing.typeId);
    }
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
    editing,
    confirm,
    busy: ensureMutation.isPending,
    choose,
    edit: (charger: ChargerWithState) =>
      setEditing({
        mode: "edit",
        typeId: charger.chargerAdapterType,
        name: charger.name,
      }),
    submitDialog,
    closeDialog,
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
