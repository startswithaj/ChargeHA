import { type ComponentType, useEffect, useState } from "react";
import { Button, Text } from "@radix-ui/themes";
import {
  pluginSettingsComponents,
  type PluginSettingsProps,
} from "@chargeha/plugins/componentRegistry";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import {
  PluginAutoFocusProvider,
  PluginSettingsHostProvider,
  type PluginSettingsState,
} from "./pluginSettingsHost.ts";

function FormFields(
  { Panel, chargerId, onReport, autoFocus }: {
    Panel: ComponentType<PluginSettingsProps> | undefined;
    chargerId: string | null;
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
          <Panel chargerId={chargerId} />
        </ErrorBoundary>
      </PluginSettingsHostProvider>
    </PluginAutoFocusProvider>
  );
}

// Rendered inside the charger's row band so the plugin's fields and
// Cancel/Save read as one block.
export function ChargerEditForm(
  {
    typeId,
    chargerId,
    submitLabel,
    error,
    busy,
    autoFocus,
    onSubmit,
    onSaved,
    onCancel,
  }: {
    typeId: string;
    // null in add mode — the panel's own save creates the row.
    chargerId: string | null;
    submitLabel: string;
    error: string | null;
    busy: boolean;
    // Put the cursor in the first field — for a freshly opened add form.
    autoFocus?: boolean;
    // Hands the host the panel's commit rather than running it here — a
    // control-path confirm dialog must be answered before it runs, so
    // declining creates nothing.
    onSubmit: (commit: () => void) => void;
    // Called once the panel reports its save landed — the host closes the
    // form here, not in onSubmit, so a failed save stays visible.
    onSaved: () => void;
    onCancel: () => void;
  },
) {
  const [panel, setPanel] = useState<PluginSettingsState | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const Panel = pluginSettingsComponents[`${typeId}-settings`];

  const submit = () => {
    if (!panel) {
      onSubmit(() => {});
      onSaved();
      return;
    }
    setSubmitted(true);
    onSubmit(() => panel.save());
  };

  const saveState = panel?.saveStatus.state;
  useEffect(() => {
    if (!submitted) return;
    if (saveState === "saved") onSaved();
    if (saveState === "error") setSubmitted(false); // re-enable Save to retry
  }, [submitted, saveState, onSaved]);

  const panelError = saveState === "error"
    ? panel?.saveStatus.message ?? "Failed to save"
    : null;
  const pending = busy || (submitted && saveState !== "error");

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
        chargerId={chargerId}
        onReport={setPanel}
        autoFocus={autoFocus === true}
      />

      {(error ?? panelError) && (
        <Text size="2" color="red">{error ?? panelError}</Text>
      )}

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
        <Button size="2" disabled={pending} onClick={submit}>
          {pending ? "Saving..." : submitLabel}
        </Button>
      </div>
    </div>
  );
}
