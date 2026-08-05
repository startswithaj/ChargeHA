import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";
import { TextField } from "@radix-ui/themes";
import { SettingsRow } from "./SettingsLayout.tsx";
import { useSaveStatus } from "../../../hooks/useSectionConfig.ts";
import { usePluginSettingsHost } from "./pluginSettingsHost.ts";

export interface PluginConfigField {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
  width?: number;
  /** Rendered directly beneath this field's row, so a control that fills the
   *  field in (network discovery, say) sits with it rather than orphaned at
   *  the end of the form. Receives a setter for this field's draft value. */
  after?: (setValue: (value: string) => void) => ReactNode;
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
  renderFooter,
}: {
  data: Record<string, unknown> | undefined;
  fields: PluginConfigField[];
  onSave: (draft: Record<string, string>, opts: SaveOpts) => void;
  /** Trailing content that needs the live edited values rather than the saved
   *  ones — a connection test, for instance. */
  renderFooter?: (values: Record<string, string>) => ReactNode;
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

  const setValue = (key: string) => (value: string) =>
    setDraft((d) => ({ ...d, [key]: value }));
  const values = Object.fromEntries(
    fields.map((f) => [f.key, draft[f.key] ?? String(data[f.key] ?? "")]),
  );

  return (
    <>
      {fields.map((field) => (
        <Fragment key={field.key}>
          <SettingsRow label={field.label} help={field.help}>
            <TextField.Root
              size="2"
              type={field.secret ? "password" : undefined}
              value={values[field.key]}
              onChange={(e: { target: { value: string } }) =>
                setValue(field.key)(e.target.value)}
              style={{ width: field.width ?? 100 }}
            />
          </SettingsRow>
          {field.after?.(setValue(field.key))}
        </Fragment>
      ))}
      {renderFooter?.(values)}
    </>
  );
}
