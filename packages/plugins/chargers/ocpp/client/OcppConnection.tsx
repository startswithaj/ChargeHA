import { useEffect, useState } from "react";
import { Badge, Button, Code, Text, TextField } from "@radix-ui/themes";
import { trpc } from "./trpc.ts";
import { Spinner, TestResultBadge, type TestStatus } from "../../../hostUi.ts";
import {
  isLikelyDockerNetwork,
  isPrivateLanIpv4,
} from "@chargeha/shared/lanAddresses";

const WS_PATH = "/api/charger/ocpp";
const PLACEHOLDER_HOST = "<chargeha-lan-ip-address>";

const hostOf = (wsUrl: string): string =>
  wsUrl.split("://")[1]?.split(":")[0] ?? "";

const wsUrlFor = (host: string): string => {
  const port = globalThis.location.port ? `:${globalThis.location.port}` : "";
  return `ws://${host}${port}${WS_PATH}`;
};

type AddressWarning = "docker" | "unknown" | null;

/** Inside a container the host's LAN address is invisible to the server, but
 *  the address the user reached us on is routable by definition. */
function chooseBase(
  serverUrls: string[],
): { base: string; warn: AddressWarning } {
  const { hostname } = globalThis.location;
  const candidates = isPrivateLanIpv4(hostname)
    ? [...serverUrls, wsUrlFor(hostname)]
    : serverUrls;
  const best = candidates.find((u) => !isLikelyDockerNetwork(hostOf(u))) ??
    candidates[0];
  if (best === undefined) {
    return { base: wsUrlFor(PLACEHOLDER_HOST), warn: "unknown" };
  }
  return {
    base: best,
    warn: isLikelyDockerNetwork(hostOf(best)) ? "docker" : null,
  };
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

/** Same row treatment as the LAN device search: filled row, identity on top,
 *  detail beneath, action pinned right. A charger arriving over OCPP is the
 *  same kind of "found a device, pick it" list, so it should not look like a
 *  different one. */
const resultRow = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  padding: "6px 10px",
  borderRadius: 6,
  background: "var(--gray-a2)",
} as const;

/** How long before we suggest the charger cannot reach us at all. */
const QUIET_MS = 60_000;

const mmss = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

export interface ChargerInfo {
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
function AddressStep(
  { base, others, warn }: {
    base: string;
    others: string[];
    warn: AddressWarning;
  },
) {
  return (
    <div>
      <Code size="2">{base}</Code>
      {warn === "docker" && (
        <Text size="1" color="orange" as="div" style={{ marginTop: 6 }}>
          {hostOf(base)}{" "}
          looks like a Docker internal address, not your real network address —
          your charger cannot reach it. Use the LAN address of the machine
          running ChargeHA, usually starting with 192.168.
        </Text>
      )}
      {warn === "unknown" && (
        <Text size="1" color="orange" as="div" style={{ marginTop: 6 }}>
          ChargeHA could not detect its own network address. Replace{" "}
          <Code size="1">{PLACEHOLDER_HOST}</Code>{" "}
          with the LAN address of the machine running ChargeHA — usually starts
          with 192.168.
        </Text>
      )}
      <Text size="1" color="gray" as="div" style={{ marginTop: 6 }}>
        Leave your charger's own ID field as it is. If your charger has only one
        URL field, put any name on the end{" "}
        (<Code size="1">{`${base}/mycharger`}</Code>) — ChargeHA reports back
        the ID the charger actually uses.
      </Text>
      {others.length > 0 && (
        <Text size="1" color="gray" as="div" style={{ marginTop: 6 }}>
          This server, the one that ChargeHA is running on, has more than one
          address — use the one on the same network as your charger:{" "}
          {others.join("   ")}
        </Text>
      )}
    </div>
  );
}

/** Three bars bouncing in sequence. The wait has no measurable pace, so this
 *  says "still going" without implying progress toward a deadline — the only
 *  real number, the window countdown, is in step 1. */
function WaitingBars() {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          style={{
            width: 3,
            height: 14,
            borderRadius: 2,
            background: "var(--blue-9)",
            animation: `waitBounce 1s ${i * 0.15}s infinite`,
          }}
        />
      ))}
    </span>
  );
}

/** One charger that answered the pairing window. */
function SeenRow(
  { charger, selected, onUse }: {
    charger: SeenCharger;
    selected: boolean;
    onUse: () => void;
  },
) {
  return (
    <div style={resultRow}>
      <div>
        <Text size="2" weight="medium">{charger.chargerId}</Text>
        {charger.info && (
          <Text size="1" color="gray" style={{ display: "block" }}>
            {charger.info.vendor} · {charger.info.model} · fw{" "}
            {charger.info.firmwareVersion}
          </Text>
        )}
      </div>
      {selected && <Badge color="green" size="1">Selected</Badge>}
      {!selected && (
        <Button size="1" variant="soft" onClick={onUse}>
          Use
        </Button>
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
  { seen, chargerId, connected, listening, info, onDetected }: {
    seen: SeenCharger[];
    chargerId: string;
    /** Nothing is being waited *for* until the window is open, so the spinner
     *  would otherwise claim work that has not started. */
    listening: boolean;
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
  if (seen.length === 0 && !listening) {
    return (
      <Text size="1" color="gray">
        Nothing yet — press "Listen for charger" above, then save on the
        charger.
      </Text>
    );
  }
  if (seen.length === 0) {
    return (
      <div style={row}>
        <WaitingBars />
        <Text size="1" color="gray">
          Waiting for a charger to connect — some reboot before reconnecting, so
          give it a minute and keep this page open.
        </Text>
      </div>
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
        <SeenRow
          key={c.chargerId}
          charger={c}
          selected={c.chargerId === chargerId}
          onUse={() => onDetected(c.chargerId)}
        />
      ))}
    </div>
  );
}

/** Manual escape hatch for the charger that never announces itself.
 *
 *  Detection fills the same field, so the box doubles as a readout — no
 *  "set manually" toggle, which only hid the one control that matters when
 *  nothing turned up. */
function ChargerIdStep(
  { chargerId, onDetected }: {
    chargerId: string;
    onDetected: (id: string) => void;
  },
) {
  return (
    <div>
      <Text size="1" color="gray" as="div">
        Enter your charger's ID here:
      </Text>
      <TextField.Root
        size="1"
        value={chargerId}
        placeholder="not detected yet"
        onChange={(e: { target: { value: string } }) =>
          onDetected(e.target.value)}
        style={{ width: 220, marginTop: 6 }}
      />
    </div>
  );
}

/** Proves the charger answers a request ChargeHA initiates, not merely that a
 *  socket exists. Addressed by charge point id rather than a charger row —
 *  in the wizard no row exists until Next saves. */
function TestStep({ chargePointId }: { chargePointId: string }) {
  const test = trpc.plugin.charger.ocpp.testConnection.useMutation();
  const result = test.data;

  const testResult: TestStatus = (() => {
    if (test.isPending) return { status: "testing" };
    if (test.isError) return { status: "error", message: test.error.message };
    if (result?.success === false) {
      return { status: "error", message: result.error };
    }
    if (result?.success === true) {
      return { status: "success", detail: `${result.latencyMs} ms` };
    }
    return { status: "idle" };
  })();

  return (
    <div style={row}>
      <Button
        size="1"
        variant="soft"
        disabled={chargePointId === "" || test.isPending}
        onClick={() => test.mutate({ chargePointId })}
      >
        {test.isPending && <Spinner />}
        {test.isPending ? "Testing..." : "Test Connection"}
      </Button>
      <TestResultBadge testResult={testResult} />
      {chargePointId === "" && (
        <Text size="1" color="gray">
          Detect or enter a Charger ID first.
        </Text>
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

/** The pairing window: its state, its countdown, and the two buttons that
 *  open and close it. Kept out of the block itself, which is otherwise just
 *  five steps of markup. */
function usePairingWindow() {
  const [now, setNow] = useState(() => Date.now());
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const begin = trpc.plugin.charger.ocpp.beginPairing.useMutation();
  const cancel = trpc.plugin.charger.ocpp.cancelPairing.useMutation();
  // Pairing is a property of the listener, not of any charger row, so this
  // query takes no input and works identically with or without a saved row.
  const status = trpc.plugin.charger.ocpp.pairingStatus.useQuery(
    undefined,
    { refetchInterval: 2000 },
  );

  const pairing = status.data?.pairing;
  const listening = pairing?.armed === true;
  const baseUrls = status.data?.baseUrls ?? [];
  const { base, warn } = chooseBase(baseUrls);
  const expiresAt = pairing?.expiresAt ?? null;

  // The deadline on the local clock. Taken from the server's own "time left"
  // and re-anchored whenever a new window opens, so clock skew between the two
  // machines cannot show a five-minute window as 5:04.
  const [deadline, setDeadline] = useState<number | null>(null);
  const expiresInMs = pairing?.expiresInMs ?? null;
  useEffect(() => {
    setDeadline(expiresInMs === null ? null : Date.now() + expiresInMs);
  }, [expiresAt]);

  // Ticks the countdown only. The window is not renewed behind the user's
  // back: the deadline on screen is then the real one, and a charger that
  // took too long is a press of Listen away from another window.
  useEffect(() => {
    if (!listening) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [listening]);

  return {
    listening,
    seen: (pairing?.seen ?? []) as SeenCharger[],
    base,
    warn,
    // The chosen address is shown on its own; this is only the alternates.
    baseUrls: baseUrls.filter((u) => u !== base),
    port: base.split(":")[2]?.split("/")[0] ?? "",
    remainingMs: (deadline ?? now) - now,
    /** How long this window has been open with the user watching. Zero while
     *  closed, so callers cannot mistake "never started" for "silent". */
    quietFor: listening && startedAt !== null ? now - startedAt : 0,
    starting: begin.isPending,
    start: () => {
      setStartedAt(Date.now());
      begin.mutate();
    },
    stop: () => {
      setStartedAt(null);
      cancel.mutate();
    },
  };
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
  { chargerId, connected, info, onDetected }: {
    chargerId: string;
    /** null means "nothing saved yet, so not knowable" — add mode / the
     *  first-run wizard has no row to have connected. Whichever host DOES
     *  have a saved row (the settings panel) passes its own `status` query
     *  data through instead. */
    connected: boolean | null;
    info: ChargerInfo | null;
    onDetected: (id: string) => void;
  },
) {
  const pairing = usePairingWindow();
  const { listening, seen, base, baseUrls, port, remainingMs, warn } = pairing;

  // Adopt the id the charger announced. Detecting it and then still showing
  // "not detected yet" until the user clicks a link is the contradiction this
  // whole flow exists to remove; the manual override remains for the rare
  // charger that needs a different value.
  // Adopt automatically only when exactly one charger answered. With several,
  // choosing is the user's call — guessing would silently bind the wrong one.
  useEffect(() => {
    if (seen.length === 1 && chargerId === "") onDetected(seen[0].chargerId);
  }, [seen.length, chargerId]);

  const quiet = pairing.quietFor > QUIET_MS && seen.length === 0 &&
    connected !== true;

  return (
    <div style={block}>
      <Text size="2" color="gray">
        Chargers connect to ChargeHA, not the other way round — you will set
        this up in the charger's own app or web page.
      </Text>

      <Step n={1} title="Click Listen for Chargers below">
        <ListenStep
          listening={listening}
          remainingMs={remainingMs}
          pending={pairing.starting}
          onStart={pairing.start}
          onStop={pairing.stop}
        />
      </Step>

      <Step n={2} title="Put this address into your charger">
        <AddressStep
          base={base}
          others={baseUrls}
          warn={warn}
        />
      </Step>

      <Step n={3} title="Save on the charger">
        <ResultStep
          seen={seen}
          chargerId={chargerId}
          connected={connected === true}
          listening={listening}
          info={info}
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

      <Step n={4} title="If your charger isn't detected, enter its ID">
        <ChargerIdStep chargerId={chargerId} onDetected={onDetected} />
      </Step>

      <Step n={5} title="Test the connection">
        {
          /* Keyed by id: a different charger is a different test, so the old
            verdict is dropped rather than left standing against the new one. */
        }
        <TestStep key={chargerId.trim()} chargePointId={chargerId.trim()} />
      </Step>
    </div>
  );
}
