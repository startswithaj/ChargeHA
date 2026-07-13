import type { CumulativeEnergyData, EnergyData } from "@chargeha/shared";
import { observable } from "@trpc/server/observable";
import type { Observable } from "@trpc/server/observable";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { Logger } from "../lib/Logger.ts";
import { ServiceError } from "../lib/ServiceError.ts";

export class EnergyPoller {
  private readonly em: EnergyAdapterManager;
  private readonly eventEmitter: TypedEventEmitter;
  private readonly db: AppDatabase;
  private readonly logger: Logger;
  private timer: Promise<ReturnType<typeof setInterval>> | null = null;
  /** In-flight poll, tracked so stop() can await it before shutdown. */
  private polling: Promise<void> | null = null;
  private latestRealtime: EnergyData | null = null;
  private latestCumulative: CumulativeEnergyData | null = null;

  constructor(
    em: EnergyAdapterManager,
    eventEmitter: TypedEventEmitter,
    db: AppDatabase,
    logger: Logger,
  ) {
    this.em = em;
    this.eventEmitter = eventEmitter;
    this.db = db;
    this.logger = logger;
    // When a config key relevant to the active adapter changes, rebuild
    // the adapter and restart the timer so the new poll interval takes
    // effect immediately.
    this.eventEmitter.subscribe("config_changed", ({ key }) => {
      if (!this.em.isRelevantConfigKey(key)) return;
      void this.em.reconfigure().then(() => this.restart());
    });
    this.timer = this.start();
  }

  private async start(): Promise<ReturnType<typeof setInterval>> {
    await this.em.ready();
    this.polling = this.poll();
    const intervalSeconds = this.em.pollIntervalSeconds();
    this.logger.info(`Polling every ${intervalSeconds}s`);
    return setInterval(() => {
      this.polling = this.poll();
    }, intervalSeconds * 1000);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(await this.timer);
      this.timer = null;
    }
    // Wait for any in-flight poll so it can't emit events / touch the DB
    // after stop returns.
    if (this.polling) await this.polling.catch(() => {});
    this.polling = null;
    // Reset snapshot so stop() returns us to the pre-started state — this
    // also means restart() starts with a null snapshot until the next poll
    // populates it, which is the correct semantic when reconfiguring.
    this.latestRealtime = null;
    this.latestCumulative = null;
  }

  /** Stop and restart polling (picks up new adapter poll interval). */
  async restart(): Promise<void> {
    await this.stop();
    this.timer = this.start();
    await this.timer;
  }

  getRealtimeSnapshot(): {
    timestamp: string;
    realtime: EnergyData;
    cumulative: CumulativeEnergyData;
  } {
    const snapshot = this.tryGetRealtimeSnapshot();
    if (!snapshot) {
      throw new ServiceError("No data available yet", "PRECONDITION_FAILED");
    }
    return snapshot;
  }

  tryGetRealtimeSnapshot(): {
    timestamp: string;
    realtime: EnergyData;
    cumulative: CumulativeEnergyData;
  } | null {
    if (!this.latestRealtime || !this.latestCumulative) return null;
    return {
      timestamp: new Date().toISOString(),
      realtime: this.latestRealtime,
      cumulative: this.latestCumulative,
    };
  }

  /** Returns an Observable that emits the initial snapshot (if any) then live energy updates. */
  subscribeToUpdates(): Observable<EnergyData & CumulativeEnergyData, unknown> {
    return observable<EnergyData & CumulativeEnergyData>((emit) => {
      // Initial snapshot (replaces WS onopen behavior)
      if (this.latestRealtime && this.latestCumulative) {
        emit.next({ ...this.latestRealtime, ...this.latestCumulative });
      }

      // Subscribe to live updates
      const unsubscribe = this.eventEmitter.subscribe(
        "energy_update",
        (data) => {
          emit.next(data);
        },
      );

      return unsubscribe;
    });
  }

  private async poll(): Promise<void> {
    try {
      const realtime = await this.em.getRealtimeData();
      const adapterName = this.em.constructor.name;
      this.logger.debug(
        `${adapterName} → solar=${realtime.solarProductionW}W grid=${realtime.gridPowerW}W consumption=${realtime.homeConsumptionW}W` +
          (realtime.batteryPowerW != null
            ? ` battery=${realtime.batteryPowerW}W soc=${realtime.batterySoc}%`
            : ""),
      );

      // Build cumulative data from local DB recordings
      // Use the configured timezone (IANA) so the "today" boundary matches
      // the user's local day, not the server's system timezone.
      const timezone = (await this.db.getConfig("timezone")) ?? "";
      const todaySummary = await this.db.getTodayEnergySummary(timezone);
      const cumulative: CumulativeEnergyData = {
        solarProducedWh: 0,
        gridImportedWh: 0,
        gridExportedWh: 0,
        dailySolarProducedWh: todaySummary.solarWh,
        dailyGridImportWh: todaySummary.gridImportWh,
        dailyGridExportWh: todaySummary.gridExportWh,
      };

      this.latestRealtime = realtime;
      this.latestCumulative = cumulative;

      // Emit energy update for tRPC subscriptions and DataRecorder
      this.eventEmitter.emit("energy_update", { ...realtime, ...cumulative });

      // Emit poll success for notification listener
      this.eventEmitter.emit("energy_poll_success", {});
    } catch (error) {
      this.logger.error("Poll failed:", error);

      // Record the failure as a zero-valued breadcrumb so DataRecorder writes a
      // row with poll_failed=1 instead of silently re-recording the previous
      // good reading every minute. Daily totals come from DB so we still need
      // to fetch them — fall back to zeros if even that fails.
      const failedRealtime: EnergyData = {
        solarProductionW: 0,
        gridPowerW: 0,
        homeConsumptionW: 0,
        batteryPowerW: null,
        batterySoc: null,
        gridVoltageV: null,
        lastUpdated: new Date().toISOString(),
        pollFailed: true,
        pollError: error instanceof Error ? error.message : String(error),
      };
      const failedCumulative = await this.buildCumulativeFromDb();

      this.latestRealtime = failedRealtime;
      this.latestCumulative = failedCumulative;
      this.eventEmitter.emit("energy_update", {
        ...failedRealtime,
        ...failedCumulative,
      });

      // Emit poll failure for notification listener
      this.eventEmitter.emit("energy_poll_failure", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Don't rethrow — polling continues on next interval
    }
  }

  /** Build cumulative-from-DB block; on DB error, return zeros so a poll
   *  failure path still produces a usable event. */
  private async buildCumulativeFromDb(): Promise<CumulativeEnergyData> {
    try {
      const timezone = (await this.db.getConfig("timezone")) ?? "";
      const todaySummary = await this.db.getTodayEnergySummary(timezone);
      return {
        solarProducedWh: 0,
        gridImportedWh: 0,
        gridExportedWh: 0,
        dailySolarProducedWh: todaySummary.solarWh,
        dailyGridImportWh: todaySummary.gridImportWh,
        dailyGridExportWh: todaySummary.gridExportWh,
      };
    } catch {
      return {
        solarProducedWh: 0,
        gridImportedWh: 0,
        gridExportedWh: 0,
        dailySolarProducedWh: 0,
        dailyGridImportWh: 0,
        dailyGridExportWh: 0,
      };
    }
  }
}
