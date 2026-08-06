import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Badge, Select, TextField } from "@radix-ui/themes";
import { SettingsRow } from "./SettingsLayout.tsx";
import { useSaveStatus } from "../../../hooks/useSectionConfig.ts";
import {
  usePluginAutoFocus,
  usePluginSettingsHost,
} from "./pluginSettingsHost.ts";

export interface PluginConfigField {
  key: string;
  label: string;
  help?: string;
  secret?: boolean;
  width?: number;
  placeholder?: string;
  /** Flagged red while empty — the form cannot do its job without it. */
  required?: boolean;
  /** Renders a select rather than a free-text box. */
  options?: Array<{ value: string; label: string }>;
  /** Tagged "Advanced" in the row label. Still always shown — the tag marks
   *  it as tuning you can usually leave alone. */
  advanced?: boolean;
  /** Rendered directly beneath this field's row, so a control that fills the
   *  field in (network discovery, say) sits with it rather than orphaned at
   *  the end of the form. Receives a setter for this field's draft value. */
  after?: (setValue: (value: string) => void) => ReactNode;
}

type SaveOpts = { onSuccess: () => void; onError: (err: unknown) => void };

function FieldControl(
  { field, value, onChange, onCommit, autoFocus }: {
    field: PluginConfigField;
    value: string;
    onChange: (value: string) => void;
    onCommit?: () => void;
    autoFocus?: boolean;
  },
) {
  if (field.options) {
    return (
      <Select.Root
        size="2"
        value={value}
        onValueChange={(v) => {
          onChange(v);
          onCommit?.();
        }}
      >
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
      placeholder={field.placeholder}
      color={field.required && value === "" ? "red" : undefined}
      autoFocus={autoFocus}
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
      onBlur={onCommit}
      style={{ width: field.width ?? 100 }}
    />
  );
}

function FieldLabel({ field }: { field: PluginConfigField }) {
  if (!field.advanced) return <>{field.label}</>;
  return (
    <>
      {field.label} <Badge size="1" variant="soft" color="gray">Advanced</Badge>
    </>
  );
}

/**
 * The one renderer for a plugin's config fields. Both the settings panel and
 * the plugin's wizard step render through this off the same field list, so
 * labels, help, widgets and grouping cannot drift between them.
 */
export function PluginFieldInputs(
  { fields, values, onChange, onCommit, autoFocus }: {
    fields: PluginConfigField[];
    values: Record<string, string>;
    onChange: (key: string, value: string) => void;
    /** Fired when a field is done being edited (blur, or a select choice) —
     *  for hosts that persist per-field rather than on an explicit Save. */
    onCommit?: (key: string) => void;
    /** Focus the first field on mount — for a freshly opened add form. */
    autoFocus?: boolean;
  },
) {
  const row = (field: PluginConfigField, index: number) => (
    <Fragment key={field.key}>
      <SettingsRow label={<FieldLabel field={field} />} help={field.help}>
        <FieldControl
          field={field}
          value={values[field.key] ?? ""}
          onChange={(v) =>
            onChange(field.key, v)}
          onCommit={onCommit ? () => onCommit(field.key) : undefined}
          autoFocus={autoFocus && index === 0}
        />
      </SettingsRow>
      {field.after?.((v) => {
        onChange(field.key, v);
        onCommit?.(field.key);
      })}
    </Fragment>
  );

  return <>{fields.map(row)}</>;
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
  autoFocus,
}: {
  data: Record<string, unknown> | undefined;
  fields: PluginConfigField[];
  onSave: (draft: Record<string, string>, opts: SaveOpts) => void;
  /** Trailing content that needs the live edited values rather than the saved
   *  ones — a connection test, for instance. */
  renderFooter?: (values: Record<string, string>) => ReactNode;
  autoFocus?: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const { saveStatus, onMutate, onSuccess, onError } = useSaveStatus();
  const hostAutoFocus = usePluginAutoFocus();

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
      <PluginFieldInputs
        fields={fields}
        values={values}
        onChange={(key, value) => setValue(key)(value)}
        autoFocus={autoFocus ?? hostAutoFocus}
      />
      {renderFooter?.(values)}
    </>
  );
}
