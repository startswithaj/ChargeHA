import { useEffect, useRef } from "react";
import { Badge, Button, Spinner, Text, TextField } from "@radix-ui/themes";
import { Search } from "lucide-react";
import { isLikelyDockerNetwork } from "@chargeha/shared/lanAddresses";

export function useDefaultSubnet(
  detectedSubnets: string[] | undefined,
  subnet: string,
  onSubnetChange: (value: string) => void,
): void {
  const applied = useRef(false);
  useEffect(() => {
    if (applied.current) return;
    if (!detectedSubnets || detectedSubnets.length === 0) return;
    if (subnet !== "") return;
    applied.current = true;
    onSubnetChange(detectedSubnets[0]);
  }, [detectedSubnets, subnet, onSubnetChange]);
}

export interface NetworkSearchResult {
  host: string;
  name?: string;
  unavailable?: string;
}

const styles = {
  section: { display: "flex", flexDirection: "column", gap: 8 },
  searchRow: { display: "flex", alignItems: "center", gap: 8 },
  results: { display: "flex", flexDirection: "column", gap: 4 },
  row: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 10px",
    borderRadius: 6,
    background: "var(--gray-a2)",
  },
} as const;

function ResultRow<T extends NetworkSearchResult>(
  { device, onUse }: { device: T; onUse: (device: T) => void },
) {
  return (
    <div style={styles.row}>
      <div>
        <Text size="2" weight="medium">{device.name ?? device.host}</Text>
        {device.name && (
          <Text size="1" color="gray" style={{ display: "block" }}>
            {device.host}
          </Text>
        )}
      </div>
      {device.unavailable && (
        <Badge color="orange" size="1">{device.unavailable}</Badge>
      )}
      {!device.unavailable && (
        <Button
          size="1"
          variant="soft"
          onClick={() => onUse(device)}
        >
          Use
        </Button>
      )}
    </div>
  );
}

export function NetworkDeviceSearch<T extends NetworkSearchResult>(
  {
    deviceNoun,
    subnet,
    onSubnetChange,
    onSearch,
    isPending,
    searched,
    results,
    onUse,
    emptyMessage,
    footer,
    detectedSubnets,
  }: {
    deviceNoun: string;
    subnet: string;
    onSubnetChange: (value: string) => void;
    onSearch: () => void;
    isPending: boolean;
    searched: boolean;
    results: T[];
    onUse: (device: T) => void;
    emptyMessage: JSX.Element | string;
    footer?: JSX.Element | false;
    detectedSubnets?: string[];
  },
) {
  const alternateSubnets = (detectedSubnets ?? []).filter((s) => s !== subnet);
  return (
    <div style={styles.section}>
      <div style={styles.searchRow}>
        <Button size="1" variant="soft" disabled={isPending} onClick={onSearch}>
          {isPending ? <Spinner /> : <Search size={14} />}
          {isPending ? "Scanning..." : "Search Network"}
        </Button>
        <Text size="1" color="gray">limit to subnet (optional):</Text>
        <TextField.Root
          size="1"
          placeholder="e.g. 192.168.0"
          value={subnet}
          onChange={(e: { target: { value: string } }) =>
            onSubnetChange(e.target.value)}
          style={{ width: 110 }}
          aria-label="Subnet"
        />
      </div>

      {alternateSubnets.length > 0 && (
        <div style={styles.searchRow}>
          <Text size="1" color="gray">also detected:</Text>
          {alternateSubnets.map((s) => (
            <Button
              key={s}
              size="1"
              variant="ghost"
              onClick={() => onSubnetChange(s)}
            >
              {s}.*
            </Button>
          ))}
        </div>
      )}

      {isLikelyDockerNetwork(subnet) && (
        <Text size="1" color="orange">
          {subnet}.* looks like a Docker internal network, not your real one —
          scanning it will find nothing. Enter the network your {deviceNoun}
          {" "}
          are on, usually starting with 192.168.
        </Text>
      )}

      {isPending && (
        <Text size="1" color="gray">
          Scanning {subnet ? `subnet ${subnet}.*` : "your local network"} for
          {" "}
          {deviceNoun}...
        </Text>
      )}

      {!isPending && results.length > 0 && (
        <div style={styles.results}>
          {results.map((d) => (
            <ResultRow key={d.host} device={d} onUse={onUse} />
          ))}
        </div>
      )}

      {!isPending && searched && results.length === 0 && (
        <Text size="2" color="orange">{emptyMessage}</Text>
      )}

      {footer}
    </div>
  );
}
