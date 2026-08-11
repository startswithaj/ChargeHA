import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Badge, Button, Select, Text, TextField } from "@radix-ui/themes";
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
  // Flagged red while empty — the form cannot do its job without it.
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
  // Tagged "Advanced" in the row label. Still always shown — the tag marks
  // it as tuning you can usually leave alone.
  advanced?: boolean;
  // Rendered beneath this field's row, so a control that fills it in
  // (network discovery, say) sits with it rather than orphaned at the end.
  after?: (setValue: (value: string) => void) => ReactNode;
  // Replaces the default input entirely, for a value the user shouldn't
  // normally type (discovered from the device), shown as text plus escape.
  render?: (value: string, setValue: (value: string) => void) => ReactNode;
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
  if (field.render) return <>{field.render(value, onChange)}</>;
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

// Both the settings panel and the plugin's wizard step render through this
// off the same field list, so labels, help, widgets and grouping cannot
// drift between them.
export function PluginFieldInputs(
  { fields, values, onChange, onCommit, autoFocus }: {
    fields: PluginConfigField[];
    values: Record<string, string>;
    onChange: (key: string, value: string) => void;
    // For hosts that persist per-field rather than on an explicit Save.
    onCommit?: (key: string) => void;
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

// Reports its dirty/save/status to the host panel, so the panel's standard
// header Save + dirty highlight + Saved badge cover the plugin's fields
// with no per-plugin wiring. Values edit as strings; pass `mutate` as `onSave`.
export function PluginConfigForm({
  data,
  fields,
  onSave,
  renderFooter,
  renderHeader,
  autoFocus,
}: {
  data: Record<string, unknown> | undefined;
  fields: PluginConfigField[];
  onSave: (draft: Record<string, string>, opts: SaveOpts) => void;
  // Trailing content that needs the live edited values, not the saved ones
  // — a connection test, for instance.
  renderFooter?: (values: Record<string, string>) => ReactNode;
  // Leading content, above the field rows, for setup a user must do
  // *before* the fields make sense — may itself fill one in, hence setter.
  renderHeader?: (
    values: Record<string, string>,
    setValue: (key: string, value: string) => void,
  ) => ReactNode;
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
  // Draft keys that have no row still belong here: a header can own a value
  // the field list does not render.
  const values = {
    ...Object.fromEntries(
      Object.keys(data).map((k) => [k, String(data[k] ?? "")]),
    ),
    ...draft,
  };

  return (
    <>
      {renderHeader?.(values, (key, value) => setValue(key)(value))}
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

export function PluginTestRow(
  {
    label = "Test Connection",
    pending,
    disabled,
    status,
    message,
    tone,
    onTest,
  }: {
    label?: string;
    pending: boolean;
    disabled?: boolean;
    status?: ReactNode;
    message?: string | null;
    tone?: "gray" | "red";
    onTest: () => void;
  },
) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
        marginTop: 8,
      }}
    >
      <Button
        size="2"
        variant="soft"
        disabled={pending || disabled}
        onClick={onTest}
      >
        {pending ? "Testing…" : label}
      </Button>
      {status}
      {message && <Text size="2" color={tone ?? "gray"}>{message}</Text>}
    </div>
  );
}
