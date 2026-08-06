import { type ComponentType, useEffect, useRef, useState } from "react";
import { Button, Text } from "@radix-ui/themes";
import { pluginSettingsComponents } from "@chargeha/plugins/componentRegistry";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import {
  PluginSettingsHostProvider,
  type PluginSettingsState,
} from "./pluginSettingsHost.ts";

function FormFields(
  { Panel, onReport }: {
    Panel: ComponentType | undefined;
    onReport: (state: PluginSettingsState | null) => void;
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
    <PluginSettingsHostProvider value={onReport}>
      <ErrorBoundary label="Plugin Settings">
        <Panel />
      </ErrorBoundary>
    </PluginSettingsHostProvider>
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
  const container = useRef<HTMLDivElement>(null);

  // The plugin panel renders nothing until its config query resolves, so the
  // first input may not exist yet on mount. Retry for a few frames, then
  // give up quietly — a missed focus is not worth more machinery.
  const frames = useRef(0);
  const raf = useRef(0);
  useEffect(() => {
    if (!autoFocus) return;
    frames.current = 0;
    const tryFocus = () => {
      const input = container.current?.querySelector("input");
      if (input) return input.focus();
      frames.current += 1;
      if (frames.current < 20) raf.current = requestAnimationFrame(tryFocus);
    };
    tryFocus();
    return () => cancelAnimationFrame(raf.current);
  }, [autoFocus]);

  const submit = () => {
    panel?.save();
    onSubmit();
  };

  return (
    <div
      ref={container}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: "4px 10px 10px",
      }}
    >
      <FormFields Panel={Panel} onReport={setPanel} />

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
