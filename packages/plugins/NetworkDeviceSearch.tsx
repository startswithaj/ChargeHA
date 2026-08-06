// The one local-network device search control, shared by every plugin that can
// discover hardware on the LAN.
//
// Imports nothing from hostUi.ts: hostUi is what plugin client code imports
// from, and componentRegistry imports hostUi in turn, so pulling hostUi in
// here would close a cycle. Spinner therefore comes from Radix rather than
// the client's own, and JSX.Element is used instead of importing React's
// ReactNode. See the dependency rules in docs/code.md.
import { Badge, Button, Spinner, Text, TextField } from "@radix-ui/themes";
import { Search } from "lucide-react";

export interface NetworkSearchResult {
  host: string;
  /** Primary line. Falls back to the host when discovery cannot name the
   *  device — Tapo's handshake probe yields no name without credentials. */
  name?: string;
  /** When set, the row is informational: this badge replaces the Use button.
   *  Lets a protocol surface a device it found but cannot drive, instead of
   *  dropping it and leaving the user staring at an empty result. */
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

/** Scan button, optional subnet scope, scanning line, result rows and empty
 *  state. Every discovery-capable plugin renders this rather than keeping its
 *  own copy — five near-identical copies had already drifted apart in wording
 *  and layout. */
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
  }: {
    /** Plural, e.g. "Fronius inverters" — reads as "...for Fronius inverters". */
    deviceNoun: string;
    subnet: string;
    onSubnetChange: (value: string) => void;
    onSearch: () => void;
    isPending: boolean;
    /** True once a scan has finished, so the empty state stays hidden until the
     *  user has actually searched. */
    searched: boolean;
    results: T[];
    onUse: (device: T) => void;
    emptyMessage: JSX.Element | string;
    /** Extra guidance below the results, e.g. Tapo's locked-plug fix. */
    footer?: JSX.Element | false;
  },
) {
  return (
    <div style={styles.section}>
      <div style={styles.searchRow}>
        <Button size="1" variant="soft" disabled={isPending} onClick={onSearch}>
          {isPending ? <Spinner /> : <Search size={14} />}
          {isPending ? "Scanning..." : "Search Network"}
        </Button>
        {/* Not an alternative to the button — it narrows the same scan. */}
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
