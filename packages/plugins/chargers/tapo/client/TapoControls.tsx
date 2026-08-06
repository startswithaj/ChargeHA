import { useState } from "react";
import { Badge, Button, Text } from "@radix-ui/themes";
import { NetworkDeviceSearch } from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";

/** Guidance shown only when a locked plug turned up. Listing it with an
 *  explanation beats hiding it, which reads as "wrong subnet". */
function LockedPlugHint() {
  return (
    <Text size="1" color="orange">
      A plug marked “Local control off” is refusing local commands. In the Tapo
      app open Me → Third-Party Services → Third-Party Compatibility and turn it
      on, then search again — it should take effect straight away. Otherwise
      power-cycle the plug.
    </Text>
  );
}

export function TapoDiscoverySection(
  { onUse }: { onUse: (host: string) => void },
) {
  const [subnet, setSubnet] = useState("");
  const discover = trpc.plugin.charger.tapo.discover.useMutation();
  const found = discover.data?.found ?? [];
  const hasLocked = found.some((d) => d.status === "locked");

  return (
    <NetworkDeviceSearch
      deviceNoun="Tapo plugs"
      subnet={subnet}
      onSubnetChange={setSubnet}
      onSearch={() => discover.mutate({ subnet: subnet || undefined })}
      isPending={discover.isPending}
      searched={discover.isSuccess || discover.isError}
      // handshake1 identifies a plug without credentials but cannot name it,
      // so the host stands in as the primary line.
      results={found.map((d) => ({
        host: d.host,
        unavailable: d.status === "locked" ? "Local control off" : undefined,
      }))}
      onUse={(d) => onUse(d.host)}
      emptyMessage="No Tapo devices found. If the plug is on a different network, set the subnet above and search again."
      footer={hasLocked && <LockedPlugHint />}
    />
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
