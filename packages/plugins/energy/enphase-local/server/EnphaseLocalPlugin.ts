import type { AnyRouter } from "@trpc/server";
import type {
  DeviceInfo,
  EnergyData,
  EnergySourceAdapter,
} from "@chargeha/shared";
import type { PluginDependencies } from "@chargeha/server/bootstrap/PluginDependencies";
import type { EnergyPlugin, PluginHealthCheck } from "@chargeha/shared/plugins";
import { PluginDbLogger } from "@chargeha/server/lib/PluginDbLogger";
import { ENPHASE_LOCAL_SECRET_KEYS, enphaseLocalConfigDef } from "./config.ts";
import { EnphaseClient, makeNodeHttpsEnvoyHttp } from "./EnphaseClient.ts";
import { INFO_PATH, isEnvoyInfo, tagValue } from "./envoyInfo.ts";
import { EnphaseLocalAdapter } from "./EnphaseLocalAdapter.ts";
import { createEnphaseLocalRouter } from "./router.ts";

// Enphase Local energy plugin — reads an Enphase Envoy / IQ Gateway
// (firmware 7+) on the local network over its token-authenticated HTTPS API.
export class EnphaseLocalPlugin implements EnergyPlugin {
  readonly id = "enphase_local";
  readonly displayName = "Enphase (Local)";
  readonly vendor = "Enphase";
  readonly settingsComponentKey = "enphase-local-config";
  readonly configDef = enphaseLocalConfigDef;
  readonly secretKeys = ENPHASE_LOCAL_SECRET_KEYS;

  constructor(private readonly deps: PluginDependencies) {
    deps.log.info("Enphase Local plugin initialized");
  }

  async createAdapter(): Promise<EnergySourceAdapter> {
    const host = await this.deps.getConfig("host");
    if (!host) {
      throw new Error("Enphase host not configured");
    }
    const email = (await this.deps.getConfig("email")) ?? "";
    const password = (await this.deps.getSecret("password")) ?? "";
    const token = (await this.deps.getSecret("token")) ?? "";

    const client = new EnphaseClient(
      host,
      {
        email,
        password,
        // A wizard-saved token is renewable; only call it manual when there are no credentials.
        manualToken: email && password ? "" : token,
        cachedToken: email && password ? token : "",
      },
      (fresh) => this.deps.setSecret("token", fresh),
      this.deps.log,
    );
    return new EnphaseLocalAdapter(client, this.deps.log, this.deps.dbLog);
  }

  // The Envoy's serial from its unauthenticated /info endpoint, or null when
  // nothing at that host answers as an Envoy.
  private async envoySerial(host: string): Promise<string | null> {
    const info = await makeNodeHttpsEnvoyHttp().get(host, INFO_PATH, {});
    if (info.status !== 200 || !isEnvoyInfo(info.body)) return null;
    return tagValue(info.body, "sn");
  }

  async testConnection(
    credentials: {
      host: string;
      email?: string;
      password?: string;
      token?: string;
    },
  ): Promise<
    | {
      success: true;
      device: DeviceInfo;
      realtime: EnergyData;
      serial: string;
      fetchedToken: string | null;
    }
    | { success: false; error: string }
  > {
    try {
      const serial = await this.envoySerial(credentials.host);
      if (serial === null) {
        return {
          success: false,
          error: `No Enphase Envoy found at ${credentials.host}`,
        };
      }
      const fetchedTokens: string[] = [];
      const client = new EnphaseClient(
        credentials.host,
        {
          email: credentials.email ?? "",
          password: credentials.password ?? "",
          manualToken: credentials.token ?? "",
          cachedToken: "",
        },
        (token) => {
          fetchedTokens.push(token);
          return Promise.resolve();
        },
        this.deps.log,
      );
      // Interactive test — results go to the caller, nothing is written to the plugin log.
      const noopDbLog = new PluginDbLogger(
        () => Promise.resolve(),
        this.deps.log,
      );
      const adapter = new EnphaseLocalAdapter(client, this.deps.log, noopDbLog);
      try {
        await adapter.connect();
        const [device, realtime] = await Promise.all([
          adapter.getDeviceInfo(),
          adapter.getRealtimeData(),
        ]);
        return {
          success: true,
          device,
          realtime,
          serial,
          fetchedToken: fetchedTokens.at(-1) ?? null,
        };
      } finally {
        await adapter.disconnect();
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Connection failed",
      };
    }
  }

  shutdown(): Promise<void> {
    return Promise.resolve();
  }

  getRouter(): AnyRouter {
    return createEnphaseLocalRouter(this.deps, this);
  }

  getHealthChecks(): PluginHealthCheck[] {
    return [];
  }
}
