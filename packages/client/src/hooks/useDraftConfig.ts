import { useCallback, useEffect, useRef, useState } from "react";
import type { SaveStatus } from "./useSectionConfig.ts";

interface DraftMutation<T> {
  mutate: (data: Partial<T>) => void;
  saveStatus: SaveStatus;
}

interface DraftConfig<T> {
  /** Merged view: server data with draft overrides applied. */
  fields: T | undefined;
  /** Update a single field in the local draft (no server call). */
  setField: <K extends keyof T>(key: K, value: T[K]) => void;
  /** Whether the draft has any unsaved changes. */
  isDirty: boolean;
  /** Send all accumulated draft changes to the server. */
  save: () => void;
  /** Discard all unsaved changes. */
  discard: () => void;
  /** Save status forwarded from the mutation. */
  saveStatus: SaveStatus;
}

/**
 * Buffers config changes locally until the user explicitly saves.
 * Sits between the existing query/mutation hooks and panel components.
 */
export function useDraftConfig<T extends object>(
  serverData: T | undefined,
  mutation: DraftMutation<T>,
): DraftConfig<T> {
  const [draft, setDraft] = useState<Partial<T>>({});
  const lastSaveTick = useRef(mutation.saveStatus.tick);

  // Clear draft after successful save
  useEffect(() => {
    if (
      mutation.saveStatus.tick !== lastSaveTick.current &&
      mutation.saveStatus.state === "saved"
    ) {
      lastSaveTick.current = mutation.saveStatus.tick;
      setDraft({});
    }
  }, [mutation.saveStatus.tick, mutation.saveStatus.state]);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const isDirty = Object.keys(draft).length > 0;

  const fields = serverData ? { ...serverData, ...draft } as T : undefined;

  const save = useCallback(() => {
    if (!isDirty) return;
    mutation.mutate(draft);
  }, [isDirty, draft, mutation]);

  const discard = useCallback(() => {
    setDraft({});
  }, []);

  return {
    fields,
    setField,
    isDirty,
    save,
    discard,
    saveStatus: mutation.saveStatus,
  };
}
