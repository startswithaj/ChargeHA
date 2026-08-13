import { useState } from "react";
import { Badge, Text } from "@radix-ui/themes";
import {
  NetworkDeviceSearch,
  PluginTestRow,
  useDefaultSubnet,
} from "../../../hostUi.ts";
import { trpc } from "./trpc.ts";

// Guidance shown only when a locked plug turned up. Listing it with an
// explanation beats hiding it, which reads as "wrong subnet".
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

  // Defaults the subnet field to where ChargeHA itself is reachable, once,
  // while still leaving it fully editable.
  const lanSubnets = trpc.plugin.charger.tapo.lanSubnets.useQuery();
  useDefaultSubnet(lanSubnets.data, subnet, setSubnet);

  return (
    <NetworkDeviceSearch
      deviceNoun="Tapo plugs"
      subnet={subnet}
      onSubnetChange={setSubnet}
      detectedSubnets={lanSubnets.data}
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
    // Carries the plug's own name so the row can be created with it.
    onValidated?: (nickname: string) => void;
  },
) {
  const test = trpc.plugin.charger.tapo.testConnection.useMutation({
    onSuccess: (data) => {
      if (data.success) onValidated?.(data.nickname);
    },
  });
  const result = test.data;
  const incomplete = !host || !email || !password;

  const message = (() => {
    if (incomplete) {
      return "Fill in the plug address and account details first.";
    }
    if (result?.success === false) return result.error;
    return null;
  })();

  return (
    <PluginTestRow
      pending={test.isPending}
      disabled={incomplete}
      status={result?.success === true
        ? <Badge color="green" size="1">Connected</Badge>
        : undefined}
      message={message}
      tone={incomplete || result?.success === false ? "red" : "gray"}
      onTest={() => test.mutate({ host, email, password })}
    />
  );
}
