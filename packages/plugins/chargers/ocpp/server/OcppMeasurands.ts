// What ChargeHA needs an OCPP charger to report, and how to pick a list the
// charger will actually accept. Pure: no sockets and no state, so the rules
// can be tested on their own and the negotiation flow next door stays short.
//
// Which measurands a 1.6 charger sends is charger-side configuration — the
// MeterValuesSampledData key — and the only measurand it MUST support is
// Energy.Active.Import.Register. Chargers ship reporting only that, which
// leaves ChargeHA with no current and no voltage.

/** How often we ask the charger to sample, in seconds.
 *
 *  Hardcoded rather than a per-charger setting on purpose: one
 *  OcppCentralSystem serves every OCPP row, so a value injected once at
 *  construction would be silently wrong for every row but the first.
 *
 *  30 s is a compromise. The controller re-decides on its own loop and reacts
 *  to solar changes at that cadence, so samples much slower than that make it
 *  steer on stale amps; much faster buys nothing and costs the charger's
 *  uplink. */
export const SAMPLE_INTERVAL_SECONDS = 30;

export const MEASURANDS_KEY = "MeterValuesSampledData";
export const MEASURANDS_MAX_LENGTH_KEY = "MeterValuesSampledDataMaxLength";
export const SAMPLE_INTERVAL_KEY = "MeterValueSampleInterval";

/** Priority-ordered, and every entry has a consumer in this plugin:
 *  register  → sessionEnergyKwh + the tier-2 power derivation
 *  current   → state.chargeAmps, the quantity the engine limits against
 *  voltage   → state.chargerVoltage + the tier-3 derivation's multiplier
 *  power     → state.chargePowerKw and isChargingNow
 *  The order is also the drop order when MeterValuesSampledDataMaxLength
 *  binds: power goes first because it is the only one we can derive without
 *  it, and the register goes last because it is the only one the spec
 *  guarantees. */
export const DESIRED_MEASURANDS = [
  "Energy.Active.Import.Register",
  "Current.Import",
  "Voltage",
  "Power.Active.Import",
] as const;

export const parseMeasurandCsv = (value: string): string[] =>
  value.split(",").map((token) => token.trim()).filter((t) => t.length > 0);

/** Chargers exist that write "Voltage.L1" where the phase belongs in
 *  sampledValue.phase. Reading that as "no voltage" would trigger a needless
 *  write to a charger that is already reporting fine, so a dotted suffix
 *  still counts as the measurand. */
const matches = (token: string, measurand: string): boolean =>
  token === measurand || token.startsWith(`${measurand}.`);

const contains = (tokens: string[], measurand: string): boolean =>
  tokens.some((token) => matches(token, measurand));

/** Is the charger's own list already everything we would ask for?
 *
 *  All four, not just the three control needs: the tier-3 current × voltage
 *  estimate assumes a power factor of 1 and takes its phase count from a
 *  configured value rather than from measurement, so a measured power figure
 *  is strictly better wherever a charger will give one. One extra write to a
 *  charger already reporting three is a fair price for that. */
export const alreadySatisfied = (current: string[]): boolean =>
  DESIRED_MEASURANDS.every((measurand) => contains(current, measurand));

/** The list to ask for: our priority order, kept to what the charger allows
 *  (when it has told us) and truncated to MaxLength (when it has told us).
 *  A charger claiming a max of 0 still gets one entry — that is a nonsense
 *  answer, and sending nothing at all guarantees no telemetry. */
export function selectMeasurands(
  allowed: string[] | null,
  maxLength: number | null,
): string[] {
  const wanted = DESIRED_MEASURANDS.filter((measurand) =>
    allowed === null || contains(allowed, measurand)
  );
  if (maxLength === null) return [...wanted];
  return wanted.slice(0, Math.max(1, maxLength));
}

export type NegotiationStatus =
  | "satisfied"
  | "accepted"
  | "reboot-required"
  | "rejected"
  | "not-supported"
  | "read-only"
  | "failed";

export interface MeasurandNegotiation {
  status: NegotiationStatus;
  /** When the attempt settled. Anchors the retry rate limit, and is the
   *  cutoff that decides which MeterValues count as evidence — a reading
   *  that predates the attempt says nothing about whether it worked. */
  at: number;
  /** What we asked for, for the log. */
  requested: string[];
}

/** Written for the user, not the log. Each names the state the charger is
 *  actually in, because "no current" has several very different fixes. */
const REASONS: Record<NegotiationStatus, string> = {
  satisfied:
    "lists current in its own configuration but is not sending it — its " +
    "meter may not be wired up.",
  accepted:
    "accepted ChargeHA's request to report current and voltage, but is not " +
    "sending them.",
  "reboot-required":
    "stored ChargeHA's request to report current and voltage but needs a " +
    "restart to apply it. Restart it from its own app, or at the breaker, " +
    "when no car is charging.",
  rejected: "refused to report current and voltage.",
  "not-supported": "does not let ChargeHA configure what it measures. Set " +
    "MeterValuesSampledData in the charger's own settings if it has one.",
  "read-only":
    "has a read-only measurement list that does not include current.",
  failed:
    "disconnected before ChargeHA could ask it what to report. ChargeHA " +
    "will try again on its next reconnect.",
};

/** Why this charger's telemetry is degraded, or null.
 *
 *  Verify, do not trust — an outcome on its own never warns. A charger can
 *  answer Accepted and change nothing, and it can refuse everything and still
 *  report current. Only arriving data settles it, so:
 *   - no MeterValues since the attempt: say nothing. An idle charger with no
 *     car plugged in sends none, and accusing it would warn every install
 *     overnight.
 *   - MeterValues arriving and currentA is non-null: it works, whatever the
 *     charger said.
 *   - MeterValues arriving with no current in them: that is the warning.
 *
 *  currentA and not currentSumA: currentSumA is null for every charger that
 *  reports one unphased current, which is most single-phase installs. */
export function measurandWarningFor(
  negotiation: MeasurandNegotiation | undefined,
  data: { currentA: number | null; lastMeterValuesAt: number | null },
): string | null {
  if (negotiation === undefined) return null;
  const seenAt = data.lastMeterValuesAt;
  if (seenAt === null || seenAt <= negotiation.at) return null;
  if (data.currentA !== null) return null;
  return REASONS[negotiation.status];
}
