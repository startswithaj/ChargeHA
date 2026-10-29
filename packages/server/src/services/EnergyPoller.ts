import type { CumulativeEnergyData, EnergyData } from "@chargeha/shared";
import { observable } from "@trpc/server/observable";
import type { Observable } from "@trpc/server/observable";
import type { TypedEventEmitter } from "./TypedEventEmitter.ts";
import type { EnergyAdapterManager } from "./EnergyAdapterManager.ts";
import type { ChargingPointManager } from "./ChargingPointManager.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { Logger } from "../lib/Logger.ts";
import { ServiceError } from "../lib/ServiceError.ts";

export class EnergyPoller {
  private readonly em: EnergyAdapterManager;
  private readonly chargingPoints: ChargingPointManager;
  private readonly eventEmitter: TypedEventEmitter;
  private readonly db: AppDatabase;
  private readonly logger: Logger;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private lifecycle: Promise<void> = Promise.resolve();
  private controller: AbortController | null = null;
  // In-flight poll, tracked so stop() can await it before shutdown.
  private polling: Promise<void> | null = null;
  private latestRealtime: EnergyData | null = null;
  private latestCumulative: CumulativeEnergyData | null = null;
  private consecutivePollFailures = 0;
  private lastFailureLoggedAtMs = 0;
  private reconfigurePending = false;

  constructor(
    em: EnergyAdapterManager,
    chargingPoints: ChargingPointManager,
    eventEmitter: TypedEventEmitter,
    db: AppDatabase,
    logger: Logger,
  ) {
    this.em = em;
    this.chargingPoints = chargingPoints;
    this.eventEmitter = eventEmitter;
    this.db = db;
    this.logger = logger;
    // When a config key relevant to the active adapter changes, rebuild
    // the adapter and restart the timer so the new poll interval takes
    // effect immediately. Coalesced per tick: a multi-key save emits one
    // config_changed per key, and rebuilding per event would tear down and
    // re-login the adapter once per key.
    this.eventEmitter.subscribe("config_changed", ({ key }) => {
      if (this.stopped || !this.em.isRelevantConfigKey(key)) return;
      if (this.reconfigurePending) return;
      this.reconfigurePending = true;
      queueMicrotask(() => {
        this.reconfigurePending = false;
        if (this.stopped) return;
        void this.restart(() => this.em.reconfigure());
      });
    });
    void this.restart();
  }

  private cancelLoop(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort(new Error("Energy polling stopped"));
  }

  private async drainLoop(): Promise<void> {
    this.cancelLoop();
    // Wait for any in-flight poll so it can't emit events / touch the DB
    // after stop returns.
    await this.polling;
    // Reset snapshot so stop() returns us to the pre-started state — this
    // also means restart() starts with a null snapshot until the next poll
    // populates it, which is the correct semantic when reconfiguring.
    this.latestRealtime = null;
    this.latestCumulative = null;
  }

  restart(beforeStart?: () => Promise<void>): Promise<void> {
    // Cancellation is immediate, even when another lifecycle operation is waiting.
    // Explicit stop is terminal: queued or later restart requests cannot revive it.
    if (this.stopped) return this.lifecycle;
    this.cancelLoop();
    this.lifecycle = this.lifecycle.then(async () => {
      const controller = new AbortController();
      try {
        await this.drainLoop();
        if (this.stopped) return;
        // Own cancellation throughout reconfiguration/readiness and the polling loop.
        // A queued operation gets a fresh controller only after its predecessor drains.
        this.controller = controller;
        await beforeStart?.();
        if (controller.signal.aborted) return;
        await this.em.ready();
        if (controller.signal.aborted) return;
        this.consecutivePollFailures = 0;
        this.lastFailureLoggedAtMs = 0;
        this.logger.info(
          `Polling every ${this.em.pollIntervalSeconds()}s after completion`,
        );
        this.tick(controller.signal);
      } catch (error) {
        if (!controller.signal.aborted) {
          this.logger.error("Energy poller restart failed:", error);
        }
      }
    });
    return this.lifecycle;
  }

  private tick(signal: AbortSignal): void {
    if (signal.aborted) return;
    this.polling = this.poll(signal).catch((error) => {
      if (!signal.aborted) {
        this.logger.error("Energy poll processing failed:", error);
      }
    }).finally(() => {
      this.polling = null;
      if (signal.aborted) return;
      this.timer = setTimeout(
        () => this.tick(signal),
        this.em.pollIntervalSeconds() * 1000,
      );
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.cancelLoop();
    // Drain lifecycle outside its queue: restart must never await itself.
    await this.lifecycle;
    await this.drainLoop();
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

  private async poll(
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      const load = await this.chargingPoints.getChargingLoadW();
      const realtime = await this.em.getRealtimeData(load, signal);
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

      if (this.consecutivePollFailures > 0) {
        await this.recordPluginLog(
          "info",
          `Polling recovered after ${this.consecutivePollFailures} failed poll(s)`,
        );
        this.consecutivePollFailures = 0;
        this.lastFailureLoggedAtMs = 0;
      }
    } catch (error) {
      // ChargeHA cancelled this poll (stop/restart); timeouts don't set this.
      if (signal?.aborted) {
        this.logger.debug("Poll cancelled by restart/stop");
        return;
      }
      this.logger.error("Poll failed:", error);
      await this.recordPollFailure(error);

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

  // First failure is logged immediately; repeats at most every 5 minutes,
  // carrying the consecutive-failure count, so a dead inverter fills the
  // Logs page with a heartbeat rather than one row per tick.
  private async recordPollFailure(error: unknown): Promise<void> {
    this.consecutivePollFailures++;
    const nowMs = Date.now();
    const throttleMs = 5 * 60 * 1000;
    if (
      this.lastFailureLoggedAtMs !== 0 &&
      nowMs - this.lastFailureLoggedAtMs < throttleMs
    ) return;
    this.lastFailureLoggedAtMs = nowMs;
    await this.recordPluginLog(
      "error",
      `Poll failed: ${error instanceof Error ? error.message : String(error)}`,
      this.consecutivePollFailures > 1
        ? { consecutiveFailures: this.consecutivePollFailures }
        : undefined,
    );
  }

  private async recordPluginLog(
    level: string,
    message: string,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    const pluginId = this.em.activePluginId;
    if (!pluginId) return;
    try {
      await this.db.insertPluginLog({
        pluginId,
        level,
        message,
        payload: payload ? JSON.stringify(payload) : null,
        origin: null,
        traceId: null,
      });
    } catch (err) {
      this.logger.error("Failed to persist poll log entry:", err);
    }
  }

  // Build cumulative-from-DB block; on DB error, return zeros so a poll
  // failure path still produces a usable event.
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
