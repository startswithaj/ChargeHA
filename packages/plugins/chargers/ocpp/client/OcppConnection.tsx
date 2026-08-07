import { useEffect, useState } from "react";
import { skipToken } from "@tanstack/react-query";
import { Badge, Button, Code, Link, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { useOcppChargerId } from "./useOcppChargerId.ts";

/** Fallback only, for the moment before the server reports its own addresses.
 *  The browser's location is the wrong answer — it is the address *you* typed,
 *  not one the charger can route to. */
function browserGuessUrl(): string {
  const port = globalThis.location.port ? `:${globalThis.location.port}` : "";
  return `ws://${globalThis.location.hostname}${port}/api/charger/ocpp`;
}

const block = {
  display: "flex",
  flexDirection: "column",
  gap: 14,
  padding: "14px 16px",
  borderRadius: 8,
  background: "var(--gray-a2)",
  border: "1px solid var(--gray-a5)",
} as const;

const stepGrid = {
  display: "grid",
  gridTemplateColumns: "18px 1fr",
  gap: "0 10px",
  alignItems: "start",
} as const;

const row = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
} as const;

/** How long before we suggest the charger cannot reach us at all. */
const QUIET_MS = 60_000;

const mmss = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

interface ChargerInfo {
  vendor: string;
  model: string;
  firmwareVersion: string;
}

interface SeenCharger {
  chargerId: string;
  info: ChargerInfo | null;
}

function Step(
  { n, title, children }: { n: number; title: string; children: JSX.Element },
) {
  return (
    <div style={stepGrid}>
      <Text size="2" weight="bold" color="gray">{n}</Text>
      <div>
        <Text size="2" weight="medium" as="div">{title}</Text>
        <div style={{ marginTop: 6 }}>{children}</div>
      </div>
    </div>
  );
}

/** The address, plus the two shapes a charger's settings screen can take.
 *  Both get equal billing because chargers split roughly evenly between them —
 *  some want URL and ID separately, others one combined URL. */
function AddressStep({ base, others }: { base: string; others: string[] }) {
  return (
    <div>
      <Code size="2">{base}</Code>
      <Text size="1" color="gray" as="div" style={{ marginTop: 6 }}>
        Leave your charger's own ID field as it is. If your charger has only one
        URL field, put any name on the end{" "}
        (<Code size="1">{`${base}/mycharger`}</Code>) — ChargeHA reports back
        the ID the charger actually uses.
      </Text>
      {others.length > 0 && (
        <Text size="1" color="gray" as="div" style={{ marginTop: 6 }}>
          This server has more than one address — use the one on the same
          network as your charger: {others.join("   ")}
        </Text>
      )}
    </div>
  );
}

/** What turned up, or why nothing has yet.
 *
 *  More than one charger can answer a single window — two in the household, or
 *  an old id still retrying beside a new one. Picking is the user's call, so
 *  the list is shown rather than us keeping whichever happened to connect
 *  last. A single arrival is adopted without a click. */
function ResultStep(
  { seen, chargerId, connected, info, onDetected }: {
    seen: SeenCharger[];
    chargerId: string;
    /** A charger whose id is already saved connects normally rather than
     *  through pairing, so it never appears in `seen` — without this the step
     *  would claim we are still waiting for a charger that is plainly here. */
    connected: boolean;
    info: ChargerInfo | null;
    onDetected: (id: string) => void;
  },
) {
  if (seen.length === 0 && connected) {
    return (
      <div style={row}>
        <Badge color="green" size="2">Connected</Badge>
        <Code size="1">{chargerId}</Code>
        {info && (
          <Text size="1" color="gray">
            {info.vendor} · {info.model} · fw {info.firmwareVersion}
          </Text>
        )}
      </div>
    );
  }
  if (seen.length === 0) {
    return (
      <Text size="1" color="gray">
        Some chargers reboot before reconnecting — give it a minute, and keep
        this page open.
      </Text>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {seen.length > 1 && (
        <Text size="1" color="gray">
          {seen.length} chargers answered — choose the one to use.
        </Text>
      )}
      {seen.map((c) => (
        <div key={c.chargerId} style={row}>
          <Badge color={c.chargerId === chargerId ? "green" : "gray"} size="2">
            {c.chargerId}
          </Badge>
          {c.info && (
            <Text size="1" color="gray">
              {c.info.vendor} · {c.info.model} · fw {c.info.firmwareVersion}
            </Text>
          )}
          {c.chargerId === chargerId && (
            <Text size="1" color="green">selected</Text>
          )}
          {c.chargerId !== chargerId && (
            <Link
              size="1"
              onClick={() => onDetected(c.chargerId)}
            >
              use this
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

/** The discovered id, with a manual escape hatch for chargers that need one. */
function ChargerIdRow(
  { chargerId, onDetected }: {
    chargerId: string;
    onDetected: (id: string) => void;
  },
) {
  const [editing, setEditing] = useState(false);
  return (
    <div style={row}>
      <Text size="1" color="gray">Charger ID</Text>
      {editing && (
        <TextField.Root
          size="1"
          autoFocus
          value={chargerId}
          onChange={(e: { target: { value: string } }) =>
            onDetected(e.target.value)}
          onBlur={() => setEditing(false)}
          style={{ width: 180 }}
        />
      )}
      {!editing && chargerId === "" && (
        <Text size="1" color="gray">not detected yet</Text>
      )}
      {!editing && chargerId !== "" && <Code size="1">{chargerId}</Code>}
      {!editing && (
        <Link size="1" onClick={() => setEditing(true)}>set manually</Link>
      )}
    </div>
  );
}

/** Start/stop listening, with the deadline on screen so nothing is hidden. */
function ListenStep(
  { listening, remainingMs, pending, onStart, onStop }: {
    listening: boolean;
    remainingMs: number;
    pending: boolean;
    onStart: () => void;
    onStop: () => void;
  },
) {
  return (
    <div style={row}>
      {!listening && (
        <Button size="1" variant="soft" disabled={pending} onClick={onStart}>
          Listen for charger
        </Button>
      )}
      {listening && (
        <>
          <Badge color="blue" size="1">
            Listening — {mmss(remainingMs)} left
          </Badge>
          <Button size="1" variant="soft" color="gray" onClick={onStop}>
            Stop
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * The whole "get your charger talking to ChargeHA" step.
 *
 * The step order is deliberately the opposite of the obvious one: listening
 * starts *before* the user touches the charger. A charger that dials in while
 * no window is open is rejected, and many then back off for minutes — so
 * telling someone to configure the charger first sets them up to wait.
 *
 * The user supplies nothing here. A charge point id cannot be invented: OCPP-J
 * 1.6 carries it in the URL, and on many chargers it is the serial number and
 * cannot be changed. So we take whatever id turns up and report it back rather
 * than demanding one up front.
 */
export function OcppConnectBlock(
  { chargerId, onDetected }: {
    chargerId: string;
    onDetected: (id: string) => void;
  },
) {
  const chargerRowId = useOcppChargerId();
  const [now, setNow] = useState(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const begin = trpc.plugin.charger.ocpp.beginPairing.useMutation();
  const stop = trpc.plugin.charger.ocpp.cancelPairing.useMutation();
  const urls = trpc.plugin.charger.ocpp.connectionUrls.useQuery(
    chargerRowId === undefined ? skipToken : { chargerRowId },
  );
  const status = trpc.plugin.charger.ocpp.status.useQuery(
    chargerRowId === undefined ? skipToken : { chargerRowId },
    { refetchInterval: 2000 },
  );

  const pairing = status.data?.pairing;
  const listening = pairing?.armed === true;
  const seen: SeenCharger[] = pairing?.seen ?? [];
  const candidates = urls.data?.candidates ?? [];
  const base = candidates[0]?.base ?? browserGuessUrl();
  const port = base.split(":")[2]?.split("/")[0] ?? "";
  const expiresAt = pairing?.expiresAt ?? null;

  // Ticks the countdown, and renews the window while the panel is open:
  // chargers often need a reboot to pick up new OCPP settings, which can
  // outlast a single window while the user is still at the charger.
  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if ((expiresAt ?? 0) - Date.now() < 45_000) begin.mutate();
    }, 1000);
    return () => clearInterval(timer);
  }, [listening, expiresAt]);

  // Adopt the id the charger announced. Detecting it and then still showing
  // "not detected yet" until the user clicks a link is the contradiction this
  // whole flow exists to remove; the manual override remains for the rare
  // charger that needs a different value.
  // Adopt automatically only when exactly one charger answered. With several,
  // choosing is the user's call — guessing would silently bind the wrong one.
  useEffect(() => {
    if (seen.length === 1 && chargerId === "") onDetected(seen[0].chargerId);
  }, [seen.length, chargerId]);

  const quiet = listening && startedAt !== null && seen.length === 0 &&
    status.data?.connected !== true && now - startedAt > QUIET_MS;

  return (
    <div style={block}>
      <Text size="2" color="gray">
        Chargers connect to ChargeHA, not the other way round — you will set
        this up in the charger's own app or web page.
      </Text>

      <Step n={1} title="Start listening here first">
        <ListenStep
          listening={listening}
          remainingMs={(expiresAt ?? now) - now}
          pending={begin.isPending}
          onStart={() => {
            setStartedAt(Date.now());
            begin.mutate();
          }}
          onStop={() => {
            setStartedAt(null);
            stop.mutate();
          }}
        />
      </Step>

      <Step n={2} title="Put this address into your charger">
        <AddressStep
          base={base}
          others={candidates.slice(1).map((c) => c.base)}
        />
      </Step>

      <Step n={3} title="Save on the charger">
        <ResultStep
          seen={seen}
          chargerId={chargerId}
          connected={status.data?.connected === true}
          info={status.data?.info ?? null}
          onDetected={onDetected}
        />
      </Step>

      {quiet && (
        <Text size="1" color="orange">
          Still nothing after a minute. Usually the charger cannot reach this
          server — check it is on the same network (not a guest or IoT VLAN) and
          that nothing blocks port {port}.
        </Text>
      )}

      <ChargerIdRow chargerId={chargerId} onDetected={onDetected} />
    </div>
  );
}
