/// <reference lib="deno.ns" />
import type { Logger } from "@chargeha/server/lib/Logger";
import { NetworkDiscovery } from "../../NetworkDiscovery.ts";
import { type EnvoyHttp, makeNodeHttpsEnvoyHttp } from "./EnphaseClient.ts";

export type EnphaseDevice = {
  host: string;
  name: string;
  model: string;
  serial: string;
};

const DISCOVERY_TIMEOUT_MS = 1500;
const INFO_PATH = "/info";

/** Extract the first XML tag value, e.g. tagValue(xml, "sn"). */
function tagValue(xml: string, tag: string): string {
  return xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? "";
}

/**
 * Fingerprint check: `/info` needs no auth on every firmware and only an
 * Envoy answers it with an `<envoy_info>` document carrying a serial.
 */
export function isEnvoyInfo(xml: string): boolean {
  return xml.includes("<envoy_info") && tagValue(xml, "sn") !== "";
}

class EnphaseDiscovery extends NetworkDiscovery<EnphaseDevice> {
  // Probes are full TLS handshakes; one gateway per site, so stop early.
  protected readonly stopAtFirstHit = true;

  constructor(
    logger: Logger,
    subnet?: string,
    command: typeof Deno.Command = Deno.Command,
    networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
    private readonly http: EnvoyHttp = makeNodeHttpsEnvoyHttp(
      DISCOVERY_TIMEOUT_MS,
    ),
  ) {
    super(logger, "Enphase discovery", subnet, command, networkInterfaces);
  }

  protected async probeHost(host: string): Promise<EnphaseDevice | null> {
    try {
      const res = await this.http.get(host, INFO_PATH, {});
      if (res.status !== 200 || !isEnvoyInfo(res.body)) {
        return null;
      }
      const serial = tagValue(res.body, "sn");
      const model = tagValue(res.body, "pn");
      return {
        host,
        name: `Enphase Envoy (${serial})`,
        model: model || "Envoy",
        serial,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.info(`${this.label}: ${host} — ${reason}`);
      return null;
    }
  }
}

/** Scan the local network for Enphase Envoy / IQ Gateway devices. */
export function discoverEnphase(
  logger: Logger,
  subnet?: string,
  command: typeof Deno.Command = Deno.Command,
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
  http?: EnvoyHttp,
): Promise<EnphaseDevice[]> {
  return new EnphaseDiscovery(
    logger,
    subnet,
    command,
    networkInterfaces,
    http ?? makeNodeHttpsEnvoyHttp(DISCOVERY_TIMEOUT_MS),
  ).discover();
}
