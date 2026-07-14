import { ServiceError } from "../lib/ServiceError.ts";
import type { AppDatabase } from "../db/AppDatabase.ts";
import type { Logger } from "../lib/Logger.ts";
import type { VehiclePluginRegistry } from "@chargeha/server/bootstrap/VehiclePluginRegistry";
import type { TunnelManager } from "./TunnelManager.ts";
import type { VehicleManager } from "./VehicleManager.ts";
import type { AuthService, ChangeModeInput } from "./AuthService.ts";
import { buildSessionCookie } from "./AuthService.ts";
import { maybeEncrypt } from "../lib/Encryption.ts";
import type { OidcService } from "./OidcService.ts";
import type {
  WizardSaveOidcConfigInput,
  WizardSetAuthModeInput,
} from "@chargeha/shared/schemas";

export class WizardService {
  constructor(
    private db: AppDatabase,
    private encryptionKey: string | null,
    private logger: Logger,
    private vehiclePlugins: VehiclePluginRegistry,
    private tunnelManager: TunnelManager,
    private vehicleManager: VehicleManager,
    private authService: AuthService,
    private oidcService: OidcService,
  ) {}

  async getStatus() {
    const wizardCompleted = await this.db.getConfig("wizard_completed");
    const completed = wizardCompleted === "true";

    const vehicles = await this.db.getVehicles();
    const adapterType = await this.db.getConfig("energy_adapter_type");
    const noVehiclesOrAdapter = vehicles.length === 0 &&
      (!adapterType || adapterType === "");
    const firstRun = !completed && noVehiclesOrAdapter;

    return {
      completed,
      firstRun,
    };
  }

  async complete() {
    // Auto-stop tunnel if running
    if (this.tunnelManager.isRunning) {
      await this.tunnelManager.stop();
      this.logger.info("Tunnel stopped on wizard completion");
    }

    // Clear wizard navigation state from DB
    await this.db.setConfig("wizard_step", "");
    await this.db.setConfig("wizard_vehicle_type", "");
    await this.db.setConfig("wizard_energy_type", "");

    // Clear OIDC pending flag if set
    await this.db.setConfig("wizard_oidc_pending", "");

    await this.db.setConfig("wizard_completed", "true");
    this.logger.info("Wizard completed");
    return { completed: true };
  }

  // ── Wizard navigation state (persisted to DB config keys) ────────────────

  async getStep(): Promise<string> {
    return (await this.db.getConfig("wizard_step")) ?? "";
  }

  async setStep(stepId: string): Promise<void> {
    await this.db.setConfig("wizard_step", stepId);
  }

  async getVehicleType(): Promise<string> {
    return (await this.db.getConfig("wizard_vehicle_type")) ?? "";
  }

  async setVehicleType(type: string): Promise<void> {
    await this.db.setConfig("wizard_vehicle_type", type);
  }

  async getEnergyType(): Promise<string> {
    return (await this.db.getConfig("wizard_energy_type")) ?? "";
  }

  async setEnergyType(type: string): Promise<void> {
    await this.db.setConfig("wizard_energy_type", type);
  }

  async startTunnel() {
    try {
      // Pull plugin-provided tunnel routes at call time — registry already
      // holds every registered vehicle plugin.
      const routes = this.vehiclePlugins.getAll().flatMap((p) =>
        p.getTunnelRoutes()
      );
      const url = await this.tunnelManager.start(routes);
      this.logger.info(`Tunnel started: ${url}`);
      return { url };
    } catch (err) {
      this.logger.error("Failed to start tunnel", err);
      throw new ServiceError(
        err instanceof Error ? err.message : "Failed to start tunnel",
        "INTERNAL_SERVER_ERROR",
        { cause: err },
      );
    }
  }

  async stopTunnel() {
    await this.tunnelManager.stop();
    this.logger.info("Tunnel stopped");
    return { stopped: true };
  }

  getTunnelStatus() {
    return {
      active: this.tunnelManager.isRunning,
      url: this.tunnelManager.tunnelUrl,
    };
  }

  async setAuthMode(
    input: WizardSetAuthModeInput,
    responseHeaders?: Headers,
    isHttps?: boolean,
  ): Promise<{ success: true }> {
    // During wizard setup there is no existing auth to re-auth against,
    // so we use changeMode with no currentPassword (currentMode is "none")
    const sessionId = await this.authService.changeMode(
      this.buildChangeModeInput(input),
    );

    // Set session cookie so the wizard isn't locked out on the next step
    if (sessionId) {
      const secure = isHttps ?? false;
      responseHeaders?.append(
        "Set-Cookie",
        buildSessionCookie(sessionId, secure),
      );
    }

    this.logger.info(`Wizard: auth mode set to '${input.mode}'`);
    return { success: true as const };
  }

  private buildChangeModeInput(input: WizardSetAuthModeInput): ChangeModeInput {
    if (input.mode === "local") {
      if (!input.localConfig) {
        throw new Error("localConfig is required for local auth mode");
      }
      return { newMode: "local", localConfig: input.localConfig };
    }
    if (input.mode === "oidc") {
      if (!input.oidcConfig) {
        throw new Error("oidcConfig is required for oidc auth mode");
      }
      return { newMode: "oidc", oidcConfig: input.oidcConfig };
    }
    return { newMode: "none" };
  }

  /**
   * Save OIDC config during wizard without activating auth mode.
   * Tests discovery, saves config to DB, refreshes OidcService cache.
   * The actual mode switch happens on successful OIDC callback.
   */
  async saveOidcConfig(
    input: WizardSaveOidcConfigInput,
  ): Promise<{ success: true }> {
    // Test OIDC discovery endpoint reachability
    const result = await this.oidcService.testDiscovery(input.issuerUrl);
    if (!result.success) {
      throw new ServiceError(
        result.error ?? "OIDC discovery failed",
        "BAD_REQUEST",
      );
    }

    // Encrypt client secret if encryption key available
    const { value: clientSecret, isEncrypted } = await maybeEncrypt(
      input.clientSecret,
      this.encryptionKey,
    );

    // Save OIDC config to DB
    await this.db.upsertOidcConfig({
      issuerUrl: input.issuerUrl,
      clientId: input.clientId,
      clientSecret,
      isEncrypted,
      baseUrl: input.baseUrl,
    });

    // Mark that OIDC wizard flow is pending
    await this.db.setConfig("wizard_oidc_pending", "true");

    // OidcService.getState() reads the new config on next /auth/oidc/login.
    this.logger.info("Wizard: OIDC config saved (pending verification)");
    return { success: true as const };
  }

  async demoSetup(input: {
    adapterType: string;
    timezone?: string | null;
  }) {
    try {
      await this.db.upsertVehicle({
        id: "DEMO-001",
        name: "Demo EV",
        adapterType: input.adapterType,
        priority: 1,
        config: JSON.stringify({ batteryCapacityKwh: 60 }),
        mode: "auto",
      });

      await this.db.setConfig("home_latitude", "-33.8688");
      await this.db.setConfig("home_longitude", "151.2093");

      if (input.timezone) {
        await this.db.setConfig("timezone", input.timezone);
      }

      // Fetch the full persisted row (with createdAt/updatedAt) and hand
      // it to the manager so the vehicle is immediately usable.
      const row = await this.db.getVehicle("DEMO-001");
      if (row) await this.vehicleManager.addVehicle(row);

      this.logger.info("Demo setup completed");
      return { success: true as const };
    } catch (err) {
      this.logger.error("Demo setup failed", err);
      throw new ServiceError("Demo setup failed", "INTERNAL_SERVER_ERROR", {
        cause: err,
      });
    }
  }
}
