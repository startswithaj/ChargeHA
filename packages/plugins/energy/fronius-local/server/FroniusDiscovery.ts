/// <reference lib="deno.ns" />
import type { Logger } from "@chargeha/server/lib/Logger";
import { NetworkDiscovery } from "../../NetworkDiscovery.ts";

type Inverter = { host: string; name: string; model: string };

class FroniusDiscovery extends NetworkDiscovery<Inverter> {
  protected readonly stopAtFirstHit = false;

  constructor(
    logger: Logger,
    subnet?: string,
    command: typeof Deno.Command = Deno.Command,
    networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
  ) {
    super(logger, "Fronius discovery", subnet, command, networkInterfaces);
  }

  protected async probeHost(host: string): Promise<Inverter | null> {
    try {
      const res = await fetch(
        `http://${host}/solar_api/v1/GetInverterInfo.cgi`,
        { signal: AbortSignal.timeout(1500) },
      );
      if (!res.ok) {
        this.logger.info(`${this.label}: ${host} — HTTP ${res.status}`);
        return null;
      }
      const json = await res.json();
      const inverters = json?.Body?.Data;
      if (!inverters) {
        this.logger.info(`${this.label}: ${host} — no inverter data`);
        return null;
      }
      const firstId = Object.keys(inverters)[0];
      const info = inverters[firstId];
      return {
        host,
        name: info?.CustomName ?? "Fronius Inverter",
        model: info?.DT?.toString() ?? "Unknown",
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.info(`${this.label}: ${host} — ${reason}`);
      return null;
    }
  }
}

/** Scan local network for Fronius inverters. */
export function discoverFronius(
  logger: Logger,
  subnet?: string,
  command: typeof Deno.Command = Deno.Command,
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
): Promise<Inverter[]> {
  return new FroniusDiscovery(logger, subnet, command, networkInterfaces)
    .discover();
}
