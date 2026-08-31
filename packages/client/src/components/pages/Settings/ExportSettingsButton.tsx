import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button, Dialog, Flex, Text } from "@radix-ui/themes";
import { trpc } from "../../../trpc.ts";
import { version } from "../../../lib/version.ts";
import type { NotificationConfig } from "@chargeha/shared/configSections";

const REDACTED = "***redacted***";
const SECRET_FIELDS = [
  "notificationTelegramBotToken",
  "notificationTelegramChatId",
  "notificationTelegramTopicId",
] as const;

function redactNotification(config: NotificationConfig): NotificationConfig {
  return SECRET_FIELDS.reduce(
    (masked, field) =>
      masked[field] === "" ? masked : { ...masked, [field]: REDACTED },
    { ...config },
  );
}

function useSettingsExport(open: boolean) {
  const opts = { enabled: open };
  const charging = trpc.config.charging.get.useQuery(undefined, opts);
  const solar = trpc.config.solar.get.useQuery(undefined, opts);
  const battery = trpc.config.battery.get.useQuery(undefined, opts);
  const equipment = trpc.config.equipment.get.useQuery(undefined, opts);
  const system = trpc.config.system.get.useQuery(undefined, opts);
  const notification = trpc.config.notification.get.useQuery(undefined, opts);
  const vehicles = trpc.vehicle.list.useQuery(undefined, opts);
  const chargers = trpc.charger.list.useQuery(undefined, opts);
  const schedules = trpc.schedule.list.useQuery(undefined, opts);
  const tariffs = trpc.tariff.list.useQuery(undefined, opts);

  const sections = [
    charging,
    solar,
    battery,
    equipment,
    system,
    notification,
    vehicles,
    chargers,
    schedules,
    tariffs,
  ];
  const loading = sections.some((q) => q.isLoading);
  const error = sections.find((q) => q.error)?.error ?? null;

  const buildJson = () => {
    if (!open || loading || error || !notification.data) return null;
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        version: version.sha,
        charging: charging.data,
        solar: solar.data,
        battery: battery.data,
        equipment: equipment.data,
        system: system.data,
        notification: redactNotification(notification.data),
        // config blobs, locations and live state stay out of the export —
        // they can hold VINs, tokens and GPS coordinates.
        vehicles: vehicles.data?.vehicles.map((v) => ({
          id: v.id,
          name: v.name,
          adapterType: v.adapterType,
          priority: v.priority,
          mode: v.mode,
        })),
        chargers: chargers.data?.map((c) => ({
          id: c.id,
          name: c.name,
          chargerAdapterType: c.chargerAdapterType,
          mode: c.mode,
          priority: c.priority,
          vehicleId: c.vehicleId,
          kind: c.kind,
          active: c.active,
        })),
        schedules: schedules.data?.schedules,
        tariffs: tariffs.data,
      },
      null,
      2,
    );
  };
  return { loading, error, json: buildJson() };
}

export function ExportSettingsButton() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const { loading, error, json } = useSettingsExport(open);

  const copy = async () => {
    if (json === null) return;
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setCopied(false);
      }}
    >
      <Dialog.Trigger>
        <Button variant="soft" color="gray">Export settings</Button>
      </Dialog.Trigger>
      <Dialog.Content maxWidth="600px">
        <Dialog.Title>Export Settings</Dialog.Title>
        <Dialog.Description size="2" color="gray">
          All configuration sections as JSON. Notification secrets are redacted.
        </Dialog.Description>
        {loading && <Text size="2" color="gray">Loading...</Text>}
        {error && <Text size="2" color="red">{error.message}</Text>}
        {json !== null && (
          <pre
            style={{
              maxHeight: 400,
              overflow: "auto",
              background: "var(--gray-2)",
              borderRadius: "var(--radius-2)",
              padding: 12,
              fontSize: 12,
            }}
          >
            {json}
          </pre>
        )}
        <Flex gap="3" mt="3" justify="end">
          <Dialog.Close>
            <Button variant="soft" color="gray">Close</Button>
          </Dialog.Close>
          <Button onClick={copy} disabled={json === null}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
