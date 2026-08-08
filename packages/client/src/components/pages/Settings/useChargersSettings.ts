import { useState } from "react";
import { pluginSettingsComponents } from "@chargeha/plugins/componentRegistry";
import { trpc } from "../../../trpc.ts";
import {
  type ChargerWithState,
  isSmartCharger,
  useChargers,
} from "../../../hooks/useChargers.ts";
import { useVehicles } from "../../../hooks/useVehicles.ts";

export type ChargerConfirm =
  // `commit` is what actually creates the charger — a type with no settings
  // panel via `addCharger`, a type with one via its panel's own save. Held
  // here rather than run immediately so declining the dialog runs nothing.
  | { kind: "add"; typeId: string; commit: () => void }
  | { kind: "removeLast"; chargerId: string };

/** Editing an existing charger, or configuring one before it is created. */
export type ChargerEditing =
  | { mode: "add"; typeId: string }
  | { mode: "edit"; typeId: string; chargerId: string };

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
  const { vehicles } = useVehicles();
  const utils = trpc.useUtils();
  const invalidate = () => utils.charger.list.invalidate();

  const removeMutation = trpc.charger.remove.useMutation({
    onSuccess: invalidate,
  });
  const createMutation = trpc.charger.create.useMutation({
    onSuccess: invalidate,
  });
  const reorderMutation = trpc.charger.reorder.useMutation({
    onSuccess: invalidate,
  });
  const setVehicleIdMutation = trpc.charger.setVehicleId.useMutation({
    onSuccess: invalidate,
  });

  const [editing, setEditing] = useState<ChargerEditing | null>(null);
  const [confirm, setConfirm] = useState<ChargerConfirm | null>(null);
  const smartChargers = chargers.filter(isSmartCharger);
  const needsAddConfirm = smartChargers.length === 0 && chargers.length > 0;

  const addCharger = (typeId: string) =>
    createMutation.mutate({ chargerAdapterType: typeId }, {
      onSuccess: () => setEditing(null),
    });

  // A charger type with nothing to configure skips straight to creation.
  const choose = (typeId: string) => {
    if (hasSettingsPanel(typeId)) {
      setEditing({ mode: "add", typeId });
      return;
    }
    if (needsAddConfirm) {
      setConfirm({ kind: "add", typeId, commit: () => addCharger(typeId) });
    } else {
      addCharger(typeId);
    }
  };

  // The panel's own save is what creates/configures the charger; this only
  // decides whether it may run yet (control-path confirm) and closes the form.
  const submitEdit = (commit: () => void) => {
    if (editing?.mode !== "add") {
      commit();
      setEditing(null);
      return;
    }
    if (needsAddConfirm) {
      setConfirm({ kind: "add", typeId: editing.typeId, commit });
      setEditing(null);
      return;
    }
    commit();
    setEditing(null);
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
    if (confirm.kind === "add") confirm.commit();
    else removeMutation.mutate({ id: confirm.chargerId });
    setConfirm(null);
  };

  return {
    chargers,
    vehicles,
    assignVehicle: (chargerId: string, vehicleId: string | null) =>
      setVehicleIdMutation.mutate({ id: chargerId, vehicleId }),
    reorderable: chargers.length > 1,
    error: createMutation.error?.message ?? removeMutation.error?.message ??
      null,
    editing,
    confirm,
    busy: createMutation.isPending,
    choose,
    edit: (charger: ChargerWithState) =>
      setEditing({
        mode: "edit",
        typeId: charger.chargerAdapterType,
        chargerId: charger.id,
      }),
    submitEdit,
    cancelEdit: () => {
      createMutation.reset();
      setEditing(null);
    },
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
