import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Button, Select, TextField } from "@radix-ui/themes";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  /** Tucked behind the Advanced disclosure. The field list is shared by the
   *  wizard step and the settings panel, so this is a declared decision
   *  rather than an artefact of which file someone edited. */
  advanced?: boolean;
  /** Rendered directly beneath this field's row, so a control that fills the
   *  field in (network discovery, say) sits with it rather than orphaned at
   *  the end of the form. Receives a setter for this field's draft value. */
  after?: (setValue: (value: string) => void) => ReactNode;
}

type SaveOpts = { onSuccess: () => void; onError: (err: unknown) => void };

function FieldControl(
  { field, value, onChange, onCommit }: {
    field: PluginConfigField;
    value: string;
    onChange: (value: string) => void;
    onCommit?: () => void;
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
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
      onBlur={onCommit}
      style={{ width: field.width ?? 100 }}
    />
  );
}

/**
 * The one renderer for a plugin's config fields. Both the settings panel and
 * the plugin's wizard step render through this off the same field list, so
 * labels, help, widgets and grouping cannot drift between them.
 */
export function PluginFieldInputs(
  { fields, values, onChange, onCommit }: {
    fields: PluginConfigField[];
    values: Record<string, string>;
    onChange: (key: string, value: string) => void;
    /** Fired when a field is done being edited (blur, or a select choice) —
     *  for hosts that persist per-field rather than on an explicit Save. */
    onCommit?: (key: string) => void;
  },
) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const basic = fields.filter((f) => !f.advanced);
  const advanced = fields.filter((f) => f.advanced);

  const row = (field: PluginConfigField) => (
    <Fragment key={field.key}>
      <SettingsRow label={field.label} help={field.help}>
        <FieldControl
          field={field}
          value={values[field.key] ?? ""}
          onChange={(v) => onChange(field.key, v)}
          onCommit={onCommit ? () => onCommit(field.key) : undefined}
        />
      </SettingsRow>
      {field.after?.((v) => {
        onChange(field.key, v);
        onCommit?.(field.key);
      })}
    </Fragment>
  );

  return (
    <>
      {basic.map(row)}
      {advanced.length > 0 && (
        <div
          style={{
            marginTop: 4,
            paddingTop: 8,
            borderTop: "1px solid var(--gray-a4)",
          }}
        >
          <Button
            size="1"
            variant="ghost"
            color="gray"
            onClick={() => setShowAdvanced((v) => !v)}
            // Ghost buttons outdent themselves; zero the inline margin so the
            // chevron starts on the same column as the field labels.
            style={{ marginLeft: 0, marginRight: 0 }}
          >
            {showAdvanced
              ? <ChevronDown size={14} />
              : <ChevronRight size={14} />}
            Advanced
          </Button>
        </div>
      )}
      {showAdvanced && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 12,
            padding: "10px 12px",
            borderRadius: 6,
            background: "var(--gray-a2)",
            border: "1px solid var(--gray-a5)",
          }}
        >
          {advanced.map(row)}
        </div>
      )}
    </>
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
      <PluginFieldInputs
        fields={fields}
        values={values}
        onChange={(key, value) => setValue(key)(value)}
      />
      {renderFooter?.(values)}
    </>
  );
}
