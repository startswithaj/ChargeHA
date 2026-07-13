/// <reference lib="deno.ns" />
import type { Logger } from "@chargeha/server/lib/Logger";
import {
  chunk,
  expandArpToSubnets,
  extractSubnets,
  generateSubnetIps,
  parseArpOutput,
} from "./networkScan.ts";

const BATCH_SIZE = 30;

/**
 * Shared local-network discovery pipeline for the energy plugins: build
 * candidate IPs (explicit subnet → ARP table → interface detection →
 * 192.168.1.* fallback), then probe them in sequential batches to avoid
 * flooding the network. Subclasses implement `probeHost` for their protocol
 * (Fronius over HTTP, Sigenergy over Modbus TCP).
 */
export abstract class NetworkDiscovery<TDevice extends { host: string }> {
  constructor(
    protected readonly logger: Logger,
    /** Log prefix, e.g. "Fronius discovery". */
    protected readonly label: string,
    private readonly subnet?: string,
    // Injected so tests can supply fakes instead of patching Deno globals.
    private readonly command: typeof Deno.Command = Deno.Command,
    private readonly networkInterfaces: typeof Deno.networkInterfaces =
      Deno.networkInterfaces,
  ) {}

  /** Probe one host; resolve null when it is not the target device. */
  protected abstract probeHost(host: string): Promise<TDevice | null>;

  /**
   * When true, discovery returns after the first batch containing a hit.
   * ChargeHA supports a single inverter, so protocols with expensive probes
   * (full TCP handshake per host) opt out of scanning the rest of the subnet.
   */
  protected abstract readonly stopAtFirstHit: boolean;

  async discover(): Promise<TDevice[]> {
    const candidates = await this.buildCandidates();
    this.logger.info(
      `${this.label}: probing ${candidates.length} IPs in batches of ${BATCH_SIZE}`,
    );
    const found = await this.probeBatchesFrom(chunk(candidates, BATCH_SIZE), 0);
    this.logger.info(
      `${this.label}: complete — ${found.length} device(s) found`,
    );
    return found;
  }

  private async buildCandidates(): Promise<string[]> {
    if (this.subnet) {
      const cleanSubnet = this.subnet.replace(/\.$/, "");
      this.logger.info(`${this.label}: scanning subnet ${cleanSubnet}.*`);
      return generateSubnetIps(cleanSubnet);
    }

    const arpIps = await this.getArpIps();
    if (arpIps.length > 0) {
      this.logger.info(
        `${this.label}: ARP table returned ${arpIps.length} candidate(s): ${
          arpIps.join(", ")
        }`,
      );
      const candidates = expandArpToSubnets(arpIps);
      this.logger.info(
        `${this.label}: expanded ARP subnets [${
          extractSubnets(arpIps).join(", ")
        }] to ${candidates.length} total candidates`,
      );
      return candidates;
    }

    const candidates = this.candidatesFromInterfaces();
    this.logger.info(
      `${this.label}: ${candidates.length} candidates from interface detection`,
    );
    return candidates;
  }

  private async getArpIps(): Promise<string[]> {
    try {
      const proc = new this.command("arp", {
        args: ["-a"],
        stdout: "piped",
        stderr: "piped",
      });
      const { stdout } = await proc.output();
      return parseArpOutput(new TextDecoder().decode(stdout));
    } catch (err) {
      this.logger.info(
        `${this.label}: arp unavailable (${err}), falling back to interface detection`,
      );
      return [];
    }
  }

  /** Detect subnets from network interfaces, or fall back to 192.168.1.*. */
  private candidatesFromInterfaces(): string[] {
    try {
      const subnets = extractSubnets(
        this.networkInterfaces()
          .filter((iface) =>
            iface.family === "IPv4" && !iface.address.startsWith("127.")
          )
          .map((iface) => iface.address),
      );
      return subnets.flatMap(generateSubnetIps);
    } catch (err) {
      this.logger.info(
        `${this.label}: interface detection failed (${err}), falling back to 192.168.1.*`,
      );
      return generateSubnetIps("192.168.1");
    }
  }

  private async probeBatchesFrom(
    batches: string[][],
    index: number,
  ): Promise<TDevice[]> {
    if (index >= batches.length) return [];
    const results = await Promise.allSettled(
      batches[index].map((host) => this.probeHost(host)),
    );
    const hits = results.flatMap((r) =>
      r.status === "fulfilled" && r.value != null ? [r.value] : []
    );
    hits.forEach((hit) =>
      this.logger.info(`${this.label}: found device at ${hit.host}`)
    );
    if (this.stopAtFirstHit && hits.length > 0) {
      this.logger.info(`${this.label}: stopping scan after first hit`);
      return [hits[0]];
    }
    return [...hits, ...(await this.probeBatchesFrom(batches, index + 1))];
  }
}
