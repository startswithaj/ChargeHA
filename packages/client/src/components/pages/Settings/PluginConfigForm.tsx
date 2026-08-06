import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Select, TextField } from "@radix-ui/themes";
import { SettingsRow } from "./SettingsLayout.tsx";
import { useSaveStatus } from "../../../hooks/useSectionConfig.ts";
import { usePluginSettingsHost } from "./pluginSettingsHost.ts";

export interface PluginConfigField {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
  width?: number;
  /** Renders a select rather than a free-text box. */
  options?: Array<{ value: string; label: string }>;
  /** Rendered directly beneath this field's row, so a control that fills the
   *  field in (network discovery, say) sits with it rather than orphaned at
   *  the end of the form. Receives a setter for this field's draft value. */
  after?: (setValue: (value: string) => void) => ReactNode;
}

type SaveOpts = { onSuccess: () => void; onError: (err: unknown) => void };

function FieldControl(
  { field, value, onChange }: {
    field: PluginConfigField;
    value: string;
    onChange: (value: string) => void;
  },
) {
  if (field.options) {
    return (
      <Select.Root size="2" value={value} onValueChange={onChange}>
        <Select.Trigger />
        <Select.Content>
          {field.options.map((option) => (
            <Select.Item key={option.value} value={option.value}>
              {option.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    );
  }
  return (
    <TextField.Root
      size="2"
      type={field.secret ? "password" : undefined}
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
      style={{ width: field.width ?? 100 }}
    />
  );
}

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

  // Panels pass `onSave` as an inline arrow, so its identity changes on every
  // render. Reading it from a ref keeps `save` stable — otherwise reporting it
  // to the host re-renders this component, which mints another `onSave`, and
  // the report effect loops forever.
  const latest = useRef({ onSave, draft, isDirty });
  latest.current = { onSave, draft, isDirty };

  const save = useCallback(() => {
    const current = latest.current;
    if (!current.isDirty) return;
    onMutate();
    current.onSave(current.draft, {
      onSuccess: () => {
        onSuccess();
        setDraft({});
      },
      onError,
    });
  }, [onMutate, onSuccess, onError]);

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
            <FieldControl
              field={field}
              value={values[field.key]}
              onChange={setValue(field.key)}
            />
          </SettingsRow>
          {field.after?.(setValue(field.key))}
        </Fragment>
      ))}
      {renderFooter?.(values)}
    </>
  );
}
