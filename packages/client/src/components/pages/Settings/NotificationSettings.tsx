import { useCallback } from "react";
import { Bell, CheckCircle, Send } from "lucide-react";
import { Button, Select, Switch, Text, TextField } from "@radix-ui/themes";
import type { NotificationConfig } from "@chargeha/shared/configSections";
import { NOTIFICATION_EVENTS } from "@chargeha/shared";
import { trpc } from "../../../trpc.ts";
import {
  useNotificationConfig,
  useNotificationConfigMutation,
} from "../../../hooks/useSectionConfig.ts";
import { useDraftConfig } from "../../../hooks/useDraftConfig.ts";
import { SettingsRow, SettingsSection } from "./SettingsLayout.tsx";

// ---- Provider field type from API ----

interface ProviderConfigField {
  key: string;
  label: string;
  help: string;
  type: "text" | "toggle";
  placeholder?: string;
}

// Human-readable provider names
const PROVIDER_DISPLAY_NAMES: Record<string, string> = {
  telegram: "Telegram",
};

// ---- Component ----

function ProviderFieldsBlock(
  { fields, currentProviderFields, setField }: {
    fields: NotificationConfig;
    currentProviderFields: ProviderConfigField[];
    setField: <K extends keyof NotificationConfig>(
      k: K,
      v: NotificationConfig[K],
    ) => void;
  },
) {
  return (
    <>
      {currentProviderFields.map((field) => {
        if (field.type === "toggle") {
          return (
            <SettingsRow key={field.key} label={field.label} help={field.help}>
              <Switch
                checked={(fields as Record<string, unknown>)[field.key] ===
                  true}
                onCheckedChange={(v) =>
                  setField(field.key as keyof NotificationConfig, v)}
              />
            </SettingsRow>
          );
        }
        return (
          <SettingsRow key={field.key} label={field.label} help={field.help}>
            <TextField.Root
              value={String(
                (fields as Record<string, unknown>)[field.key] ?? "",
              )}
              onChange={(e) =>
                setField(
                  field.key as keyof NotificationConfig,
                  e.target.value,
                )}
              placeholder={field.placeholder ?? ""}
              style={{ width: 240 }}
            />
          </SettingsRow>
        );
      })}
    </>
  );
}

function TestButtonContent(
  { testMutation }: {
    testMutation: { isPending: boolean; isSuccess: boolean };
  },
) {
  if (testMutation.isPending) {
    return (
      <>
        <Send size={14} /> Sending...
      </>
    );
  }
  if (testMutation.isSuccess) {
    return (
      <>
        <CheckCircle size={14} /> Sent!
      </>
    );
  }
  return (
    <>
      <Send size={14} /> Send Test Notification
    </>
  );
}

function EventToggles(
  { enabledEvents, setField, toggleEvent, testMutation }: {
    enabledEvents: string[];
    setField: (k: "notificationEnabledEvents", v: string) => void;
    toggleEvent: (key: string) => void;
    testMutation: ReturnType<typeof trpc.notification.test.useMutation>;
  },
) {
  return (
    <>
      <div style={{ marginTop: 4 }}>
        <Text size="2" weight="bold">Events</Text>
        <Text
          size="1"
          color="gray"
          style={{ display: "block", marginTop: 2 }}
        >
          Choose which events trigger notifications.
        </Text>
      </div>
      <SettingsRow label="Toggle All" help="Enable or disable all events">
        <Switch
          checked={NOTIFICATION_EVENTS.every((evt) =>
            enabledEvents.includes(evt.key)
          )}
          onCheckedChange={(checked) => {
            const newEvents = checked
              ? NOTIFICATION_EVENTS.map((evt) => evt.key)
              : [];
            setField("notificationEnabledEvents", newEvents.join(","));
          }}
        />
      </SettingsRow>
      {NOTIFICATION_EVENTS.map((evt) => (
        <SettingsRow key={evt.key} label={evt.label} help={evt.description}>
          <Switch
            checked={enabledEvents.includes(evt.key)}
            onCheckedChange={() =>
              toggleEvent(evt.key)}
          />
        </SettingsRow>
      ))}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 4,
        }}
      >
        <Button
          size="2"
          variant="soft"
          onClick={() => testMutation.mutate()}
          disabled={testMutation.isPending}
        >
          <TestButtonContent testMutation={testMutation} />
        </Button>
        {testMutation.isError && (
          <Text size="2" color="red">
            {testMutation.error instanceof Error
              ? testMutation.error.message
              : "Failed to send"}
          </Text>
        )}
      </div>
    </>
  );
}

export function NotificationSettings() {
  const { data: config } = useNotificationConfig();
  const mutation = useNotificationConfigMutation();
  const { fields, setField, isDirty, save, saveStatus } = useDraftConfig(
    config,
    mutation,
  );

  const { data: providerFields = {} } = trpc.notification.providers.useQuery(
    undefined,
    {
      select: (data) => data as Record<string, ProviderConfigField[]>,
    },
  );

  const testMutation = trpc.notification.test.useMutation({
    onSuccess: (result) => {
      if (!result.success) {
        throw new Error(
          "error" in result ? result.error : "Unknown error",
        );
      }
      setTimeout(() => testMutation.reset(), 3000);
    },
  });

  const provider = fields?.notificationProvider ?? "";
  const enabledEvents = (fields?.notificationEnabledEvents ?? "")
    .split(",")
    .map((s: string) => s.trim())
    .filter(Boolean);

  const currentProviderFields = providerFields[provider] ?? [];

  const toggleEvent = useCallback(
    (eventKey: string) => {
      const current = new Set(enabledEvents);
      if (current.has(eventKey)) {
        current.delete(eventKey);
      } else {
        current.add(eventKey);
      }
      setField("notificationEnabledEvents", [...current].join(","));
    },
    [enabledEvents, setField],
  );

  if (!fields) return null;

  return (
    <SettingsSection
      icon={<Bell size={16} />}
      title="Notifications"
      description="Get notified about charging events, errors, and schedule changes."
      saveStatus={saveStatus}
      isDirty={isDirty}
      onSave={save}
    >
      {/* Provider selection */}
      <SettingsRow label="Provider" help="Select your notification service.">
        <Select.Root
          value={provider || "__none__"}
          onValueChange={(v) =>
            setField("notificationProvider", v === "__none__" ? "" : v)}
        >
          <Select.Trigger style={{ minWidth: 200 }} />
          <Select.Content>
            <Select.Item value="__none__">Disabled</Select.Item>
            {Object.keys(providerFields).map((key) => (
              <Select.Item key={key} value={key}>
                {PROVIDER_DISPLAY_NAMES[key] ?? key}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
      </SettingsRow>

      {provider && (
        <ProviderFieldsBlock
          fields={fields}
          currentProviderFields={currentProviderFields}
          setField={setField}
        />
      )}

      {provider && (
        <EventToggles
          enabledEvents={enabledEvents}
          setField={setField}
          toggleEvent={toggleEvent}
          testMutation={testMutation}
        />
      )}
    </SettingsSection>
  );
}
