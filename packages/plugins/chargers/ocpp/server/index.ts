import type { AnyRouter } from "@trpc/server";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { ChargerRow } from "@chargeha/shared";
import type {
  ChargerMiddleware,
  ChargerPlugin,
  ChargerRowConfig,
  PluginHealthCheck,
  PluginHttpRoutes,
  ResolvedChargerRow,
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

const intConfig = (raw: string | undefined, fallback: number): number =>
  parseInt(raw ?? "", 10) || fallback;

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
      (chargePointId) =>
        this.rowForChargePoint(chargePointId).then((entry) => entry !== null),
    );
    deps.log.info("OCPP plugin initialized");
  }

  /**
   * The charger row that owns a given OCPP charge point id, or null.
   *
   * The central system speaks charge point ids (what the device announces);
   * storage speaks charger row ids. This is the only translation between them,
   * and it replaces every former plugin-wide `charger_id` read.
   */
  private async rowForChargePoint(
    chargePointId: string,
  ): Promise<ResolvedChargerRow | null> {
    const entries = await this.deps.resolveChargerConfigs();
    return entries.find((e) => e.config.charger_id === chargePointId) ?? null;
  }

  /**
   * Persist the active transaction on the charger ROW that owns this charge
   * point. `null` clears the key rather than storing "" — data-layer null
   * boundary (code.md).
   *
   * Row-scoped, so two OCPP chargers keep separate sessions. This replaces the
   * single plugin-wide `active_transaction` key that the old docstring here
   * called out as the remaining single-charger assumption.
   */
  private async persistTransaction(
    chargePointId: string,
    tx: ActiveTransaction | null,
  ): Promise<void> {
    const entry = await this.rowForChargePoint(chargePointId);
    if (entry === null) {
      // A provisional pairing socket has no row yet, and cannot open a
      // transaction anyway (PAIRING_ACTIONS). Log rather than throw: the
      // central system treats persistence failures as non-fatal.
      this.deps.log.warn(
        `No charger row for charge point ${chargePointId}; ` +
          "active transaction not persisted",
      );
      return;
    }
    await this.deps.patchChargerConfig(entry.row.id, {
      active_transaction: tx === null ? null : JSON.stringify(tx),
    });
  }

  /** Seed a mid-charge session saved before a restart, from THIS row's config.
   *  Synchronous: the values are already in hand. */
  private restorePersistedTransaction(resolved: ChargerRowConfig): void {
    const raw = resolved.config.active_transaction;
    const chargePointId = resolved.config.charger_id;
    if (!raw || !chargePointId) return;
    try {
      this.centralSystem.restoreTransaction(
        chargePointId,
        JSON.parse(raw) as ActiveTransaction,
      );
    } catch (error) {
      this.deps.log.warn(`Discarding bad persisted transaction: ${error}`);
    }
  }

  /** Nothing is awaited: every value this needs arrives as an argument. */
  // deno-lint-ignore require-await
  async createChargerMiddleware(
    row: ChargerRow,
    resolved: ChargerRowConfig,
  ): Promise<ChargerMiddleware> {
    const { config } = resolved;
    const chargePointId = config.charger_id;
    // Previously this fell back to "", binding an unconfigured row to a
    // phantom charge point that looked live but could never connect. Throwing
    // registers an UnconfiguredChargerMiddleware whose message names the
    // problem on the dashboard.
    if (chargePointId === undefined) {
      throw new Error("OCPP charge point id not configured");
    }
    this.restorePersistedTransaction(resolved);
    const adapter = new OcppChargerAdapter(
      {
        chargerId: row.id,
        meterTimeoutSeconds: intConfig(config.meter_timeout_seconds, 300),
        maxAmps: intConfig(config.max_amps, 32),
        minAmps: intConfig(config.min_amps, 6),
        phases: config.phases === "3" ? 3 : 1,
      },
      this.centralSystem.forCharger(chargePointId),
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
    // One check across every OCPP row. Rows with no charge point id yet are
    // unconfigured and stay silent.
    return [{
      name: "ocpp-connection",
      timeoutMs: 2000,
      warningTitle: "OCPP charger disconnected",
      warningMessage:
        "The charger is not connected to ChargeHA. Check the charger's OCPP " +
        "server URL and network connection.",
      run: async () => {
        const entries = await this.deps.resolveChargerConfigs();
        const configured = entries
          .map((e) => ({
            name: e.row.name,
            chargePointId: e.config.charger_id,
          }))
          .filter(
            (p): p is { name: string; chargePointId: string } =>
              p.chargePointId !== undefined,
          );
        const disconnected = configured
          .filter((p) => !this.centralSystem.getData(p.chargePointId).connected)
          .map((p) => p.name);
        if (disconnected.length === 0) return { status: "ok" };
        return {
          status: "error",
          message: `Not connected: ${disconnected.join(", ")}`,
        };
      },
    }];
  }

  shutdown(): Promise<void> {
    this.centralSystem.shutdown();
    return Promise.resolve();
  }
}
