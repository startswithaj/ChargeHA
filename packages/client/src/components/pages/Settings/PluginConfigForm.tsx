import { useCallback, useEffect, useState } from "react";
import { TextField } from "@radix-ui/themes";
import { SettingsRow } from "./SettingsLayout.tsx";
import { useSaveStatus } from "../../../hooks/useSectionConfig.ts";
import { usePluginSettingsHost } from "./pluginSettingsHost.ts";

export interface PluginConfigField {
  key: string;
  label: string;
  help?: string;
}

type SaveOpts = { onSuccess: () => void; onError: (err: unknown) => void };

/**
 * Drop-in settings form for a plugin's config. Renders `fields` as editable
 * rows, buffers edits, and reports its dirty/save/status to the host panel — so
 * the panel's standard header Save + dirty highlight + Saved badge cover the
 * plugin's fields with no per-plugin wiring. Values edit as strings (the
 * mutation coerces); pass the mutation's `mutate` straight through as `onSave`.
 */
export function PluginConfigForm({
  data,
  fields,
  onSave,
}: {
  data: Record<string, unknown> | undefined;
  fields: PluginConfigField[];
  onSave: (draft: Record<string, string>, opts: SaveOpts) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();

  const isDirty = Object.keys(draft).length > 0;
  const save = useCallback(() => {
    if (!isDirty) return;
    onMutate();
    onSave(draft, {
      onSuccess: () => {
        onSuccess();
        setDraft({});
      },
      onError,
    });
  }, [isDirty, draft, onSave, onMutate, onSuccess, onError]);

  const report = usePluginSettingsHost();
  useEffect(() => {
    report?.({ isDirty, save, saveStatus });
  }, [report, isDirty, save, saveStatus]);
  useEffect(() => () => report?.(null), [report]);

  if (!data) return null;

  return (
    <>
      {fields.map((field) => (
        <SettingsRow key={field.key} label={field.label} help={field.help}>
          <TextField.Root
            size="2"
            value={draft[field.key] ?? String(data[field.key] ?? "")}
            onChange={(e: { target: { value: string } }) =>
              setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
            style={{ width: 100 }}
          />
        </SettingsRow>
      ))}
    </>
  );
}
