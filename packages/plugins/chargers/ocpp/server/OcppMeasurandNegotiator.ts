// ChargeHA never used to ask a charger what to report, so a charger shipping
// the 1.6 minimum (Energy.Active.Import.Register and nothing else) left the
// controller with no current and no voltage. This negotiates
// MeterValuesSampledData once per charge point, on BootNotification.
import type { Logger } from "@chargeha/server/lib/Logger";
import type { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { changeConfigurationRes, getConfigurationRes } from "./OcppMessages.ts";
import {
  alreadySatisfied,
  type MeasurandNegotiation,
  MEASURANDS_KEY,
  MEASURANDS_MAX_LENGTH_KEY,
  type NegotiationStatus,
  parseMeasurandCsv,
  SAMPLE_INTERVAL_KEY,
  SAMPLE_INTERVAL_SECONDS,
  selectMeasurands,
} from "./OcppMeasurands.ts";

/** How long before a charge point that did not settle is asked again. A
 *  charger stuck in a two-second reconnect loop boots constantly; without
 *  this it would be interrogated on every one of those boots. */
const RETRY_AFTER_MS = 10 * 60_000;

/** Outcomes no retry can improve. "satisfied" is the charger already doing
 *  what we want; "not-supported" means the key itself is unknown to it. */
const TERMINAL: ReadonlySet<NegotiationStatus> = new Set([
  "satisfied",
  "not-supported",
]);

const STATUS_MAP: Record<string, NegotiationStatus> = {
  Accepted: "accepted",
  RebootRequired: "reboot-required",
  NotSupported: "not-supported",
  Rejected: "rejected",
};

/** An unrecognised vendor status is treated as a refusal: that is the
 *  outcome with the safest handling, and it is certainly not an acceptance. */
const mapStatus = (status: string): NegotiationStatus =>
  STATUS_MAP[status] ?? "rejected";

/** What the charger said about one configuration key. */
interface ConfigEntry {
  value: string | null;
  readonly: boolean;
}

type Outcome = Omit<MeasurandNegotiation, "at">;

const readNumber = (value: string | null | undefined): number | null => {
  const parsed = parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

/** Set equality: the charger's own list arrives in its order, not ours. */
const sameSet = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((item) => b.includes(item));

/** Negotiates what a charger reports. State is in memory and keyed by charge
 *  point id, held here rather than on the connection — the very reconnect
 *  this has to survive destroys the connection object. Nothing is persisted:
 *  the charger is the durable store for its own configuration, and a cached
 *  copy goes stale the moment someone edits it in the charger's portal. */
export class OcppMeasurandNegotiator {
  private readonly results = new Map<string, MeasurandNegotiation>();
  /** Charge points with a round trip in flight. Separate from `results` so a
   *  second BootNotification arriving mid-negotiation is dropped instead of
   *  starting a duplicate conversation on the same socket. */
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly call: (
      chargePointId: string,
      action: string,
      payload: unknown,
    ) => Promise<unknown>,
    private readonly logger: Logger,
    private readonly dbLog: PluginDbLogger,
  ) {}

  outcome(chargePointId: string): MeasurandNegotiation | undefined {
    return this.results.get(chargePointId);
  }

  /** Runs at most once per charge point per process for a settled outcome,
   *  and at most once per RETRY_AFTER_MS otherwise. Never throws: a charger
   *  that vanishes mid-negotiation is a recorded outcome, not an error for
   *  the message handler that kicked this off. */
  async negotiate(chargePointId: string): Promise<void> {
    if (!this.shouldRun(chargePointId)) return;
    this.inFlight.add(chargePointId);
    try {
      this.record(chargePointId, await this.run(chargePointId));
    } catch (error) {
      this.logger.warn(
        `OCPP measurand negotiation failed for ${chargePointId}: ${error}`,
      );
      this.record(chargePointId, { status: "failed", requested: [] });
    } finally {
      this.inFlight.delete(chargePointId);
    }
  }

  private shouldRun(chargePointId: string): boolean {
    if (this.inFlight.has(chargePointId)) return false;
    const previous = this.results.get(chargePointId);
    if (previous === undefined) return true;
    if (TERMINAL.has(previous.status)) return false;
    return Date.now() - previous.at > RETRY_AFTER_MS;
  }

  private record(chargePointId: string, outcome: Outcome): void {
    const negotiation = { ...outcome, at: Date.now() };
    this.results.set(chargePointId, negotiation);
    const payload = { chargePointId, ...negotiation };
    const text =
      `Measurand negotiation ${negotiation.status} (${chargePointId})`;
    // Rate-limited above, so this is at most one row per charge point per ten
    // minutes — safe at info/warn rather than debug.
    const settled = negotiation.status === "satisfied" ||
      negotiation.status === "accepted";
    if (settled) {
      this.dbLog.info(text, { payload });
      return;
    }
    this.dbLog.warn(text, { payload });
  }

  /** Read first. A charger already reporting what the controller needs is
   *  never written to, and the same read tells us the max list length, the
   *  sample interval, and whether the key is read-only. */
  private async run(chargePointId: string): Promise<Outcome> {
    const config = await this.readConfig(chargePointId);
    await this.alignInterval(chargePointId, config);
    return await this.chooseMeasurands(chargePointId, config);
  }

  private async chooseMeasurands(
    chargePointId: string,
    config: Map<string, ConfigEntry>,
  ): Promise<Outcome> {
    const sampled = config.get(MEASURANDS_KEY);
    // Absent from configurationKey means the charger listed it under
    // unknownKey, or did not mention it at all. Either way the key does not
    // exist on this charger and no retry will ever help.
    if (sampled === undefined) {
      return { status: "not-supported", requested: [] };
    }
    const current = parseMeasurandCsv(sampled.value ?? "");
    if (alreadySatisfied(current)) {
      return { status: "satisfied", requested: current };
    }
    if (sampled.readonly) return { status: "read-only", requested: current };
    const maxLength = readNumber(config.get(MEASURANDS_MAX_LENGTH_KEY)?.value);
    const requested = selectMeasurands(null, maxLength);
    const status = await this.change(chargePointId, MEASURANDS_KEY, requested);
    if (status !== "rejected") return { status, requested };
    return await this.narrow(chargePointId, maxLength);
  }

  /** Rejected: the charger would not take our list, and 1.6 gives no key
   *  listing what it does support. Its own MeterValuesSampledData value is
   *  the only list it will ever hand us, so re-read it and offer the
   *  intersection — once. A second refusal is final; retrying the same list
   *  forever is how a charger gets hammered. */
  private async narrow(
    chargePointId: string,
    maxLength: number | null,
  ): Promise<Outcome> {
    const config = await this.readConfig(chargePointId);
    const listed = parseMeasurandCsv(config.get(MEASURANDS_KEY)?.value ?? "");
    const requested = selectMeasurands(listed, maxLength);
    // Nothing new to offer — asking again with the value it already holds
    // would be a round trip that cannot change anything.
    if (requested.length === 0 || sameSet(requested, listed)) {
      return { status: "rejected", requested: listed };
    }
    const status = await this.change(chargePointId, MEASURANDS_KEY, requested);
    return { status, requested };
  }

  /** Best effort, and never a user-facing warning: the measurands are the
   *  point, and a charger sampling too slowly already surfaces as a faulted
   *  charger via the meter-staleness timeout. Only ever speeds a charger up
   *  — one already sampling every 10 s is left alone rather than slowed to
   *  our 30. */
  private async alignInterval(
    chargePointId: string,
    config: Map<string, ConfigEntry>,
  ): Promise<void> {
    const entry = config.get(SAMPLE_INTERVAL_KEY);
    if (entry === undefined || entry.readonly) return;
    const currentSeconds = readNumber(entry.value);
    if (currentSeconds !== null && currentSeconds <= SAMPLE_INTERVAL_SECONDS) {
      return;
    }
    const target = String(SAMPLE_INTERVAL_SECONDS);
    const res = await this.call(chargePointId, "ChangeConfiguration", {
      key: SAMPLE_INTERVAL_KEY,
      value: target,
    });
    this.dbLog.debug(`Sample interval set (${chargePointId})`, {
      payload: { chargePointId, target, result: res },
    });
  }

  private async change(
    chargePointId: string,
    key: string,
    values: string[],
  ): Promise<NegotiationStatus> {
    const res = await this.call(chargePointId, "ChangeConfiguration", {
      key,
      value: values.join(","),
    });
    return mapStatus(changeConfigurationRes.parse(res).status);
  }

  private async readConfig(
    chargePointId: string,
  ): Promise<Map<string, ConfigEntry>> {
    const res = await this.call(chargePointId, "GetConfiguration", {
      key: [MEASURANDS_KEY, MEASURANDS_MAX_LENGTH_KEY, SAMPLE_INTERVAL_KEY],
    });
    const parsed = getConfigurationRes.parse(res);
    return new Map(
      (parsed.configurationKey ?? []).map((entry) => [
        entry.key,
        { value: entry.value ?? null, readonly: entry.readonly === true },
      ]),
    );
  }
}
