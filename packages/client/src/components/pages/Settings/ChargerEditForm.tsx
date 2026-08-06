import { type ComponentType, useState } from "react";
import { Button, Text } from "@radix-ui/themes";
import { pluginSettingsComponents } from "@chargeha/plugins/componentRegistry";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import {
  PluginAutoFocusProvider,
  PluginSettingsHostProvider,
  type PluginSettingsState,
} from "./pluginSettingsHost.ts";

function FormFields(
  { Panel, onReport, autoFocus }: {
    Panel: ComponentType | undefined;
    onReport: (state: PluginSettingsState | null) => void;
    autoFocus: boolean;
  },
) {
  if (!Panel) {
    return (
      <Text size="2" color="gray">
        This charger has no settings to configure.
      </Text>
    );
  }
  return (
    <PluginAutoFocusProvider value={autoFocus}>
      <PluginSettingsHostProvider value={onReport}>
        <ErrorBoundary label="Plugin Settings">
          <Panel />
        </ErrorBoundary>
      </PluginSettingsHostProvider>
    </PluginAutoFocusProvider>
  );
}

/** The plugin's own fields plus Cancel/Save, rendered inside the charger's
 *  row band so the two read as one block. */
export function ChargerEditForm(
  { typeId, submitLabel, error, busy, autoFocus, onSubmit, onCancel }: {
    typeId: string;
    submitLabel: string;
    error: string | null;
    busy: boolean;
    /** Put the cursor in the first field — for a freshly opened add form. */
    autoFocus?: boolean;
    onSubmit: () => void;
    onCancel: () => void;
  },
) {
  const [panel, setPanel] = useState<PluginSettingsState | null>(null);
  const Panel = pluginSettingsComponents[`${typeId}-settings`];

  const submit = () => {
    panel?.save();
    onSubmit();
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "4px 10px 10px",
      }}
    >
      <FormFields
        Panel={Panel}
        onReport={setPanel}
        autoFocus={autoFocus === true}
      />

      {error && <Text size="2" color="red">{error}</Text>}

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 4,
        }}
      >
        <Button size="2" variant="soft" color="gray" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="2" disabled={busy} onClick={submit}>
          {busy ? "Saving..." : submitLabel}
        </Button>
      </div>
    </div>
  );
}
