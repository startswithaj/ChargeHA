import type { AnyRouter } from "@trpc/server";
import type { EnergySourceAdapter } from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/shared/plugins";
import { GOODWE_SEMS_SECRET_KEYS, goodweSemsConfigDef } from "./config.ts";
import { GoodweSemsAdapter } from "./GoodweSemsAdapter.ts";
import {
  GoodweSemsClient,
  type SemsStationSummary,
} from "./GoodweSemsClient.ts";
import { createGoodweSemsRouter } from "./router.ts";

export type SemsUiResult<T> =
  | ({ success: true } & T)
  | { success: false; error: string };

/** GoodWe SEMS Portal energy plugin — cloud readings for GoodWe inverters
 *  paired with a HomeKit or smart meter. */
export class GoodweSemsPlugin implements EnergyPlugin {
  readonly id = "goodwe_sems";
  readonly displayName = "GoodWe (Cloud / SEMS Portal)";
  readonly vendor = "GoodWe";
  readonly settingsComponentKey = "goodwe-sems-config";
  readonly configDef = goodweSemsConfigDef;
  readonly secretKeys = GOODWE_SEMS_SECRET_KEYS;

  /** Live client for UI-triggered calls (listStations / testConnection).
   *  SEMS rate-limits CrossLogin hard, so wizard clicks reuse one session
   *  instead of logging in per request; changed credentials replace it. */
  private uiSession: { key: string; client: GoodweSemsClient } | null = null;

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("GoodWe SEMS plugin initialized");
  }

  private clientFor(account: string, password: string): GoodweSemsClient {
    const key = `${account}\n${password}`;
    if (this.uiSession?.key !== key) {
      this.uiSession = {
        key,
        client: new GoodweSemsClient(
          account,
          password,
          this.deps.log,
          this.deps.dbLog,
        ),
      };
    }
    return this.uiSession.client;
  }

  async listStations(
    account: string,
    password: string,
  ): Promise<SemsUiResult<{ stations: SemsStationSummary[] }>> {
    this.deps.log.info("SEMS (ui) listStations requested");
    try {
      const stations = await this.clientFor(account, password).getStations();
      this.deps.log.info(
        `SEMS (ui) listStations → ${stations.length} station(s)`,
      );
      return { success: true, stations };
    } catch (err) {
      this.deps.log.warn(`SEMS (ui) listStations failed: ${err}`);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Login failed",
      };
    }
  }

  async testConnection(
    account: string,
    password: string,
    stationId: string,
  ): Promise<SemsUiResult<{ systemName: string }>> {
    this.deps.log.info(
      `SEMS (ui) testConnection requested for station ${stationId}`,
    );
    try {
      const detail = await this.clientFor(account, password)
        .getStationDetail(stationId);
      const systemName = detail.stationName ?? detail.inverterModel ??
        stationId;
      this.deps.log.info(`SEMS (ui) testConnection ok — ${systemName}`);
      return { success: true, systemName };
    } catch (err) {
      this.deps.log.warn(`SEMS (ui) testConnection failed: ${err}`);
      return {
        success: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const account = await this.deps.getConfig("account");
    const password = await this.deps.getSecret("password");
    const stationId = await this.deps.getConfig("station_id");
    if (!account || !password || !stationId) {
      throw new Error("GoodWe SEMS credentials incomplete");
    }
    return GoodweSemsAdapter.create(
      account,
      password,
      stationId,
      this.deps.log,
      this.deps.dbLog,
    );
  }

  shutdown(): Promise<void> {
    this.uiSession = null;
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createGoodweSemsRouter(this.deps, this);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
