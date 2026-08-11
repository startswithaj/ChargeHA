/// <reference lib="deno.ns" />
import type { Logger } from "@chargeha/server/lib/Logger";
import { NetworkDiscovery } from "../../../discovery/NetworkDiscovery.ts";
import { KlapHttp } from "./KlapHttp.ts";

// `locked` is a Tapo device that answered but has local control switched off
// — reported rather than dropped, so the UI can explain the fix.
export type TapoDeviceStatus = "usable" | "locked";

type TapoDevice = { host: string; status: TapoDeviceStatus };

const PROBE_TIMEOUT_MS = 1500;

// A KLAP device answers handshake1 with exactly 48 bytes (16-byte seed +
// 32-byte hash) — detectable without credentials. A 403 is equally
// identifying: only a Tapo device serves that path at all.
class TapoDiscovery extends NetworkDiscovery<TapoDevice> {
  // Sweep the whole subnet so a locked plug cannot mask a usable one further along.
  protected readonly stopAtFirstHit = false;

  constructor(
    logger: Logger,
    subnet?: string,
    command: typeof Deno.Command = Deno.Command,
    networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
  ) {
    super(logger, "Tapo discovery", subnet, command, networkInterfaces);
  }

  protected async probeHost(host: string): Promise<TapoDevice | null> {
    try {
      const res = await KlapHttp.post(
        host,
        "/app/handshake1",
        crypto.getRandomValues(new Uint8Array(16)),
        null,
        PROBE_TIMEOUT_MS,
      );
      if (res.status === 403) return { host, status: "locked" };
      if (!res.ok || res.body.length !== 48) return null;
      return { host, status: "usable" };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.debug(`${this.label}: ${host} — ${reason}`);
      return null;
    }
  }
}

export function discoverTapo(
  logger: Logger,
  subnet?: string,
  command: typeof Deno.Command = Deno.Command,
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
): Promise<TapoDevice[]> {
  return new TapoDiscovery(logger, subnet, command, networkInterfaces)
    .discover();
}
