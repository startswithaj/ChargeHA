import { useState } from "react";
import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { SettingsRow } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";

export function TapoDiscoverySection(
  { onUse }: { onUse: (host: string) => void },
) {
  const [subnet, setSubnet] = useState("");
  const discover = trpc.plugin.charger.tapo.discover.useMutation();
  const found = discover.data?.found ?? [];

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="1"
          variant="soft"
          disabled={discover.isPending}
          onClick={() => discover.mutate({ subnet: subnet || undefined })}
        >
          {discover.isPending ? "Scanning..." : "Search Network"}
        </Button>
        <Text size="1" color="gray">or enter subnet:</Text>
        <TextField.Root
          size="1"
          placeholder="e.g. 192.168.0"
          value={subnet}
          onChange={(e: { target: { value: string } }) =>
            setSubnet(e.target.value)}
          style={{ width: 100 }}
        />
      </div>
      {(discover.isSuccess || discover.isError) && found.length === 0 && (
        <Text size="2" color="orange">
          No Tapo devices found. Try entering your subnet above.
        </Text>
      )}
      {found.map((d) => (
        <div key={d.host} style={{ display: "flex", gap: 8 }}>
          <Text size="2">{d.host}</Text>
          <Button size="1" variant="soft" onClick={() => onUse(d.host)}>
            Use
          </Button>
        </div>
      ))}
    </>
  );
}

export function TapoTestButton(
  { host, email, password, onValidated }: {
    host: string;
    email: string;
    password: string;
    onValidated: () => void;
  },
) {
  const test = trpc.plugin.charger.tapo.testConnection.useMutation({
    onSuccess: (data) => {
      if (data.success) onValidated();
    },
  });
  const ok = test.isSuccess && test.data.success ? test.data : null;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <Button
        size="2"
        variant="soft"
        disabled={!host || !email || !password || test.isPending}
        onClick={() => test.mutate({ host, email, password })}
      >
        {test.isPending ? "Testing..." : "Test Connection"}
      </Button>
      {ok && (
        <Badge color="green" size="2">
          Connected — {ok.model} (fw {ok.firmwareVersion})
        </Badge>
      )}
      {test.isSuccess && !test.data.success && (
        <Text size="2" color="red">{test.data.error}</Text>
      )}
    </div>
  );
}

export function TapoSettings(): JSX.Element | null {
  const { data: config } = trpc.plugin.charger.tapo.getConfig.useQuery();
  const utils = trpc.useUtils();
  const configMutation = trpc.plugin.charger.tapo.setConfig.useMutation({
    onSuccess: () => utils.plugin.charger.tapo.getConfig.invalidate(),
  });

  if (!config) return null;

  const field = (
    key:
      | "tapoHost"
      | "tapoEmail"
      | "tapoFixedDrawAmps"
      | "tapoDetectionThresholdW"
      | "tapoPollIntervalSeconds",
    width = 150,
  ) => (
    <TextField.Root
      size="2"
      value={config[key]}
      onChange={(e: { target: { value: string } }) =>
        configMutation.mutate({ [key]: e.target.value })}
      style={{ width }}
    />
  );

  return (
    <>
      <SettingsRow
        label="Plug IP address"
        help="Local IP of your Tapo plug. Use Search to auto-detect it."
      >
        {field("tapoHost")}
      </SettingsRow>
      <TapoDiscoverySection
        onUse={(host) => configMutation.mutate({ tapoHost: host })}
      />
      <SettingsRow label="Tapo account email">
        {field("tapoEmail", 220)}
      </SettingsRow>
      <SettingsRow
        label="Tapo account password"
        help="Stored encrypted. Only used locally to authenticate with the plug."
      >
        <TextField.Root
          size="2"
          type="password"
          value={config.tapoPassword}
          onChange={(e: { target: { value: string } }) =>
            configMutation.mutate({ tapoPassword: e.target.value })}
          style={{ width: 220 }}
        />
      </SettingsRow>
      <SettingsRow
        label="EVSE draw (amps)"
        help="The current your EVSE draws from this socket. The plug's continuous rating must be at or above this."
      >
        {field("tapoFixedDrawAmps", 80)}
      </SettingsRow>
      <SettingsRow
        label="Charging detection threshold (W)"
        help="Measured draw at or above this counts as charging; below it the plug reports no draw."
      >
        {field("tapoDetectionThresholdW", 80)}
      </SettingsRow>
      <SettingsRow
        label="Poll interval (seconds)"
        help="How often the plug is polled. Local and free — 10s tracks solar closely."
      >
        {field("tapoPollIntervalSeconds", 80)}
      </SettingsRow>
      <TapoTestButton
        host={config.tapoHost}
        email={config.tapoEmail}
        password={config.tapoPassword}
        onValidated={() => {}}
      />
    </>
  );
}
