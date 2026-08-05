import { type ComponentType, useState } from "react";
import { Button, Dialog, Text } from "@radix-ui/themes";
import { pluginSettingsComponents } from "@chargeha/plugins/componentRegistry";
import { ErrorBoundary } from "../../ui/ErrorBoundary.tsx";
import {
  PluginSettingsHostProvider,
  type PluginSettingsState,
} from "./pluginSettingsHost.ts";

function DialogBody(
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

export function ChargerEditDialog(
  { typeId, title, description, submitLabel, error, busy, onSubmit, onCancel }:
    {
      typeId: string;
      title: string;
      description?: string;
      submitLabel: string;
      error: string | null;
      busy: boolean;
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
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>{title}</Dialog.Title>
        {description && (
          <Dialog.Description size="2" color="gray">
            {description}
          </Dialog.Description>
        )}

        <div style={{ display: "grid", gap: 4, margin: "16px 0" }}>
          <DialogBody Panel={Panel} onReport={setPanel} />
        </div>

        {error && <Text size="2" color="red">{error}</Text>}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 16,
          }}
        >
          <Button variant="soft" color="gray" onClick={onCancel}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Saving..." : submitLabel}
          </Button>
        </div>
      </Dialog.Content>
    </Dialog.Root>
  );
}
