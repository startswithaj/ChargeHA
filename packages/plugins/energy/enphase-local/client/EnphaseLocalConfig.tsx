import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { SettingsRow } from "../../../../client/src/components/pages/Settings/SettingsLayout.tsx";

interface EnphaseLocalConfigValues {
  host: string;
  serial: string;
  email: string;
  password: string;
  token: string;
}

function ConfigField(
  { label, help, value, width, type, placeholder, onCommit }: {
    label: string;
    help?: string;
    value: string;
    width: number;
    type?: string;
    placeholder?: string;
    onCommit: (v: string) => void;
  },
) {
  return (
    <SettingsRow label={label} help={help}>
      <TextField.Root
        size="2"
        type={type as "text" | "password" | undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e: { target: { value: string } }) =>
          onCommit(e.target.value)}
        style={{ width }}
      />
    </SettingsRow>
  );
}

export function EnphaseLocalConfig(): JSX.Element | null {
  const { data: config } = trpc.energy.enphase_local.getConfig.useQuery();
  const utils = trpc.useUtils();
  const configMutation = trpc.energy.enphase_local.setConfig.useMutation({
    onSuccess: () => utils.energy.enphase_local.getConfig.invalidate(),
  });
  const testMutation = trpc.energy.enphase_local.testConnection.useMutation();

  if (!config) return null;

  const cfg = config as EnphaseLocalConfigValues;
  const testSuccess = testMutation.isSuccess && testMutation.data.success
    ? testMutation.data
    : null;

  return (
    <>
      <ConfigField
        label="Envoy IP address"
        help="Local IP or hostname of your Enphase Envoy / IQ Gateway."
        value={cfg.host}
        width={150}
        placeholder="192.168.1.60"
        onCommit={(v) => configMutation.mutate({ host: v })}
      />
      <ConfigField
        label="Envoy serial number"
        value={cfg.serial}
        width={150}
        placeholder="122233334444"
        onCommit={(v) => configMutation.mutate({ serial: v })}
      />
      <ConfigField
        label="Enphase account email"
        help="Used to fetch and renew the local API token automatically."
        value={cfg.email}
        width={220}
        placeholder="you@example.com"
        onCommit={(v) => configMutation.mutate({ email: v })}
      />
      <ConfigField
        label="Enphase account password"
        value={cfg.password}
        width={220}
        type="password"
        onCommit={(v) => configMutation.mutate({ password: v })}
      />
      <ConfigField
        label="Access token"
        help="Optional: paste a token instead of using email/password."
        value={cfg.token}
        width={220}
        type="password"
        onCommit={(v) => configMutation.mutate({ token: v })}
      />

      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Button
          size="2"
          variant="soft"
          disabled={!cfg.host || testMutation.isPending}
          onClick={() =>
            testMutation.mutate({
              host: cfg.host,
              serial: cfg.serial,
              email: cfg.email,
              password: cfg.password,
              token: cfg.token,
            })}
        >
          {testMutation.isPending ? "Testing..." : "Test Connection"}
        </Button>

        {testSuccess?.device && (
          <Badge color="green" size="2">
            Connected — {testSuccess.device.name}
          </Badge>
        )}
        {testMutation.isError && (
          <Text size="2" color="red">{testMutation.error.message}</Text>
        )}
        {testMutation.isSuccess && !testMutation.data.success && (
          <Text size="2" color="red">
            {testMutation.data.error ?? "Connection failed"}
          </Text>
        )}
      </div>
    </>
  );
}
