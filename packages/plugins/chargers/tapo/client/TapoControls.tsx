import { useState } from "react";
import { Badge, Button, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";

// Inline styles: plugin client code has no CSS modules wired up, so this
// matches the surrounding convention rather than introducing one.
const discoveryStyles = {
  section: { display: "flex", flexDirection: "column", gap: 8 },
  searchRow: { display: "flex", alignItems: "center", gap: 8 },
  results: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--gray-a2)",
    border: "1px solid var(--gray-a5)",
    alignSelf: "flex-start",
    minWidth: 220,
  },
  resultRow: { display: "flex", alignItems: "center", gap: 8 },
  resultHost: { fontFamily: "var(--code-font-family, monospace)" },
} as const;

/** A locked plug is listed rather than hidden: seeing it with an explanation
 *  beats an empty result, which reads as "wrong subnet". */
function DiscoveredDeviceRow(
  { host, status, onUse }: {
    host: string;
    status: "usable" | "locked";
    onUse: (host: string) => void;
  },
) {
  return (
    <div style={discoveryStyles.resultRow}>
      <Text size="2" style={discoveryStyles.resultHost}>{host}</Text>
      {status === "usable" && (
        <Button
          size="1"
          variant="soft"
          onClick={() => onUse(host)}
        >
          Use
        </Button>
      )}
      {status === "locked" && (
        <Badge color="orange" size="1">Local control off</Badge>
      )}
    </div>
  );
}

export function TapoDiscoverySection(
  { onUse }: { onUse: (host: string) => void },
) {
  const [subnet, setSubnet] = useState("");
  const discover = trpc.plugin.charger.tapo.discover.useMutation();
  const found = discover.data?.found ?? [];
  const searched = discover.isSuccess || discover.isError;
  const hasLocked = found.some((d) => d.status === "locked");

  return (
    <div style={discoveryStyles.section}>
      <div style={discoveryStyles.searchRow}>
        <Button
          size="1"
          variant="soft"
          disabled={discover.isPending}
          onClick={() => discover.mutate({ subnet: subnet || undefined })}
        >
          {discover.isPending ? "Scanning..." : "Search Network"}
        </Button>
        {/* Not an alternative to the button — it narrows the same scan. */}
        <Text size="1" color="gray">limit to subnet (optional):</Text>
        <TextField.Root
          size="1"
          placeholder="e.g. 192.168.0"
          value={subnet}
          onChange={(e: { target: { value: string } }) =>
            setSubnet(e.target.value)}
          style={{ width: 110 }}
          aria-label="Subnet"
        />
      </div>

      {searched && found.length === 0 && (
        <Text size="2" color="orange">
          No Tapo devices found. If the plug is on a different network, set the
          subnet above and search again.
        </Text>
      )}

      {found.length > 0 && (
        <div style={discoveryStyles.results}>
          <Text size="1" color="gray">
            {found.length === 1
              ? "Found 1 device"
              : `Found ${found.length} devices`}
          </Text>
          {found.map((d) => (
            <DiscoveredDeviceRow
              key={d.host}
              host={d.host}
              status={d.status}
              onUse={onUse}
            />
          ))}
        </div>
      )}

      {hasLocked && (
        <Text size="1" color="orange">
          A plug marked “Local control off” is refusing local commands. In the
          Tapo app open Me → Third-Party Services → Third-Party Compatibility
          and turn it on, then search again — it should take effect straight
          away. Otherwise power-cycle the plug.
        </Text>
      )}
    </div>
  );
}

export function TapoTestButton(
  { host, email, password, onValidated }: {
    host: string;
    email: string;
    password: string;
    onValidated?: () => void;
  },
) {
  const test = trpc.plugin.charger.tapo.testConnection.useMutation({
    onSuccess: (data) => {
      if (data.success) onValidated?.();
    },
  });
  const result = test.data;
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
      {result?.success === true && (
        <Badge color="green" size="1">Connected</Badge>
      )}
      {result?.success === false && (
        <Text size="2" color="red">{result.error}</Text>
      )}
    </div>
  );
}
