import type { AnyRouter } from "@trpc/server";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { ChargerRow } from "@chargeha/shared";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  PluginHealthCheck,
  PluginHttpRoutes,
} from "@chargeha/shared/plugins";
import { PollingChargerMiddleware } from "../../PollingChargerMiddleware.ts";
import { OCPP_SECRET_KEYS, ocppConfigDef } from "./config.ts";
import {
  type ActiveTransaction,
  OcppCentralSystem,
} from "./OcppCentralSystem.ts";
import { OcppChargerAdapter } from "./OcppChargerAdapter.ts";
import { createOcppWsRoutes } from "./wsRoutes.ts";
import { createOcppRouter } from "./router.ts";

export class OcppChargerPlugin implements ChargerPlugin {
  readonly id = "ocpp";
  readonly displayName = "OCPP Smart Charger";
  readonly vendor = "OCPP 1.6J";
  readonly settingsComponentKey = "ocpp-settings";
  readonly configDef = ocppConfigDef;
  readonly secretKeys = OCPP_SECRET_KEYS;

  private readonly centralSystem: OcppCentralSystem;

  constructor(private readonly deps: PluginDependencies) {
    this.centralSystem = new OcppCentralSystem(
      deps.log,
      deps.dbLog,
      (chargePointId, tx) => this.persistTransaction(chargePointId, tx),
    );
    deps.log.info("OCPP plugin initialized");
  }

  /** setConfig(key, null) clears — data-layer null boundary (code.md).
   *  Still one key while the plugin drives a single charger; the charge point
   *  id is threaded through so per-charger storage is a change of key, not a
   *  change of shape. */
  private async persistTransaction(
    _chargePointId: string,
    tx: ActiveTransaction | null,
  ): Promise<void> {
    await this.deps.setConfig(
      "active_transaction",
      tx === null ? null : JSON.stringify(tx),
    );
  }

  private async restorePersistedTransaction(): Promise<void> {
    const raw = await this.deps.getConfig("active_transaction");
    if (!raw) return;
    try {
      const configuredId = await this.deps.getConfig("charger_id");
      if (!configuredId) return;
      this.centralSystem.restoreTransaction(
        configuredId,
        JSON.parse(raw) as ActiveTransaction,
      );
    } catch (error) {
      this.deps.log.warn(`Discarding bad persisted transaction: ${error}`);
    }
  }

  async createChargerMiddleware(row: ChargerRow): Promise<ChargerMiddleware> {
    await this.restorePersistedTransaction();
    const [timeoutRaw, maxRaw, minRaw, phasesRaw, chargePointId] = await Promise
      .all([
        this.deps.getConfig("meter_timeout_seconds"),
        this.deps.getConfig("max_amps"),
        this.deps.getConfig("min_amps"),
        this.deps.getConfig("phases"),
        // Which charge point this row drives. Still plugin-wide, so all rows
        // resolve to the same one until per-row config lands.
        this.deps.getConfig("charger_id"),
      ]);
    const adapter = new OcppChargerAdapter(
      {
        chargerId: row.id,
        meterTimeoutSeconds: parseInt(timeoutRaw ?? "300", 10) || 300,
        maxAmps: parseInt(maxRaw ?? "32", 10) || 32,
        minAmps: parseInt(minRaw ?? "6", 10) || 6,
        phases: phasesRaw === "3" ? 3 : 1,
      },
      this.centralSystem.forCharger(chargePointId ?? ""),
    );
    return new PollingChargerMiddleware(adapter, this.deps.log);
  }

  getRouter(): AnyRouter {
    return createOcppRouter(this.deps, this.centralSystem);
  }

  getChargerHttpRoutes(): PluginHttpRoutes | null {
    return {
      routes: createOcppWsRoutes(this.deps, this.centralSystem),
      public: true,
    };
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [{
      name: "ocpp-connection",
      timeoutMs: 2000,
      warningTitle: "OCPP charger disconnected",
      warningMessage:
        "The charger is not connected to ChargeHA. Check the charger's OCPP " +
        "server URL and network connection.",
      run: async () => {
        const chargerId = await this.deps.getConfig("charger_id");
        if (!chargerId) return { status: "ok" }; // unconfigured — silent
        return this.centralSystem.getData(chargerId).connected
          ? { status: "ok" }
          : { status: "error", message: "Charger not connected" };
      },
    }];
  }

  shutdown(): Promise<void> {
    this.centralSystem.shutdown();
    return Promise.resolve();
  }
}
