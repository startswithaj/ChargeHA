/// <reference lib="deno.ns" />
import type { Logger } from "@chargeha/server/lib/Logger";
import { NetworkDiscovery } from "../../../discovery/NetworkDiscovery.ts";

type TapoDevice = { host: string };

/** A KLAP device answers handshake1 with exactly 48 bytes (16-byte seed +
 *  32-byte hash) — detectable without credentials. */
class TapoDiscovery extends NetworkDiscovery<TapoDevice> {
  protected readonly stopAtFirstHit = true; // single plug v1

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
      const res = await fetch(`http://${host}/app/handshake1`, {
        method: "POST",
        body: crypto.getRandomValues(new Uint8Array(16)),
        signal: AbortSignal.timeout(1500),
      });
      const body = new Uint8Array(await res.arrayBuffer());
      if (!res.ok || body.length !== 48) return null;
      return { host };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.debug(`${this.label}: ${host} — ${reason}`);
      return null;
    }
  }
}

/** Scan the local network for KLAP-speaking Tapo devices. */
export function discoverTapo(
  logger: Logger,
  subnet?: string,
  command: typeof Deno.Command = Deno.Command,
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
): Promise<TapoDevice[]> {
  return new TapoDiscovery(logger, subnet, command, networkInterfaces)
    .discover();
}
