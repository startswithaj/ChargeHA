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

/** The shape every discovery row needs, whatever the source. `id` is both the
 *  React key and the secondary line; `name` is the primary line. */
export interface DiscoveryResult {
  id: string;
  /** Primary line. Falls back to the id when discovery cannot name the thing. */
  name?: string;
  /** When set, the row is informational: this badge replaces the Use button. */
  unavailable?: string;
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

function ResultRowAction<T extends DiscoveryResult>(
  { item, selected, onUse }: {
    item: T;
    selected: boolean;
    onUse: (item: T) => void;
  },
) {
  if (item.unavailable) {
    return <Badge color="orange" size="1">{item.unavailable}</Badge>;
  }
  if (selected) return <Badge color="green" size="1">Selected</Badge>;
  return (
    <Button size="1" variant="soft" onClick={() => onUse(item)}>Use</Button>
  );
}

function ResultRow<T extends DiscoveryResult>(
  { item, selected, onUse }: {
    item: T;
    selected: boolean;
    onUse: (item: T) => void;
  },
) {
  return (
    <div style={styles.row}>
      <div>
        <Text size="2" weight="medium">{item.name ?? item.id}</Text>
        {item.name && (
          <Text size="1" color="gray" style={{ display: "block" }}>
            {item.id}
          </Text>
        )}
      </div>
      <ResultRowAction item={item} selected={selected} onUse={onUse} />
    </div>
  );
}

/** The result presentation shared by every discovery UI — LAN scans and cloud
 *  account listings alike: one row per find (name over identifier, with a Use
 *  button) and the orange empty state once a search has run. */
export function DiscoveryResultList<T extends DiscoveryResult>(
  { results, onUse, searched, emptyMessage, selectedId }: {
    results: T[];
    onUse: (item: T) => void;
    /** True once a search has finished, so the empty state stays hidden until
     *  the user has actually searched. */
    searched: boolean;
    emptyMessage: JSX.Element | string;
    /** Marks the already-chosen row, so the current pick stays visible. */
    selectedId?: string;
  },
) {
  return (
    <>
      {results.length > 0 && (
        <div style={styles.results}>
          {results.map((item) => (
            <ResultRow
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              onUse={onUse}
            />
          ))}
        </div>
      )}

      {searched && results.length === 0 && (
        <Text size="2" color="orange">{emptyMessage}</Text>
      )}
    </>
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

      {!isPending && (
        <DiscoveryResultList
          results={results.map((d) => ({ ...d, id: d.host }))}
          onUse={onUse}
          searched={searched}
          emptyMessage={emptyMessage}
        />
      )}

      {footer}
    </div>
  );
}
