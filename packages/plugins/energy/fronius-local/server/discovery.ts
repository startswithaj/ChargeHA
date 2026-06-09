/// <reference lib="deno.ns" />
import type { Logger } from "@chargeha/server/lib/Logger";

type Inverter = { host: string; name: string; model: string };

// ── Pure helpers ────────────────────────────────────────────────────────────

/** Generate all 254 host IPs for a /24 subnet. */
function generateSubnetIps(subnet: string): string[] {
  return Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
}

/** Extract unique non-broadcast, non-multicast IPs from ARP output. */
function parseArpOutput(output: string): string[] {
  const ipRegex = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
  return [
    ...new Set(
      [...output.matchAll(ipRegex)]
        .map((m) => m[1])
        .filter((ip) => !ip.endsWith(".255") && !ip.startsWith("224.")),
    ),
  ];
}

/** Extract /24 subnet prefixes from a list of IPs. */
function extractSubnets(ips: string[]): string[] {
  return [...new Set(ips.map((ip) => ip.split(".").slice(0, 3).join(".")))];
}

/** Expand ARP IPs to include all hosts in their subnets. ARP IPs first. */
function expandArpToSubnets(arpIps: string[]): string[] {
  const expanded = extractSubnets(arpIps).flatMap(generateSubnetIps);
  const seen = new Set(arpIps);
  return [...arpIps, ...expanded.filter((ip) => !seen.has(ip))];
}

/** Split an array into chunks of the given size. */
function chunk<T>(items: T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(items.length / size) },
    (_, i) => items.slice(i * size, (i + 1) * size),
  );
}

// ── Discovery class ─────────────────────────────────────────────────────────

class FroniusDiscovery {
  constructor(
    private readonly logger: Logger,
    private readonly subnet?: string,
    // Injected so tests can supply fakes instead of patching Deno globals.
    private readonly command: typeof Deno.Command = Deno.Command,
    private readonly networkInterfaces: typeof Deno.networkInterfaces =
      Deno.networkInterfaces,
  ) {}

  async discover(): Promise<Inverter[]> {
    const candidates = await this.buildCandidates();
    this.logger.info(
      `Fronius discovery: probing ${candidates.length} IPs in batches of 30`,
    );
    const found = await this.probeBatches(candidates);
    this.logger.info(
      `Fronius discovery: complete — ${found.length} inverter(s) found`,
    );
    return found;
  }

  private async buildCandidates(): Promise<string[]> {
    if (this.subnet) {
      const cleanSubnet = this.subnet.replace(/\.$/, "");
      this.logger.info(
        `Fronius discovery: scanning subnet ${cleanSubnet}.*`,
      );
      return generateSubnetIps(cleanSubnet);
    }

    // Step 1: Get candidate IPs from the ARP table
    const arpIps = await this.getArpIps();

    if (arpIps.length > 0) {
      this.logger.info(
        `Fronius discovery: ARP table returned ${arpIps.length} candidate(s): ${
          arpIps.join(", ")
        }`,
      );
      const candidates = expandArpToSubnets(arpIps);
      const subnets = extractSubnets(arpIps);
      this.logger.info(
        `Fronius discovery: expanded ARP subnets [${
          subnets.join(", ")
        }] to ${candidates.length} total candidates`,
      );
      return candidates;
    }

    // No ARP results — fall back to network interface detection
    const candidates = this.candidatesFromInterfaces();
    this.logger.info(
      `Fronius discovery: ${candidates.length} candidates from interface detection`,
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
    } catch {
      this.logger.info(
        "Fronius discovery: arp command not available, falling back to interface detection",
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
    } catch {
      this.logger.info(
        "Fronius discovery: interface detection failed, falling back to 192.168.1.*",
      );
      return generateSubnetIps("192.168.1");
    }
  }

  private async probeHost(host: string): Promise<Inverter | null> {
    try {
      const res = await fetch(
        `http://${host}/solar_api/v1/GetInverterInfo.cgi`,
        { signal: AbortSignal.timeout(1500) },
      );
      if (!res.ok) {
        this.logger.info(`Fronius discovery: ${host} — HTTP ${res.status}`);
        return null;
      }
      const json = await res.json();
      const inverters = json?.Body?.Data;
      if (!inverters) {
        this.logger.info(`Fronius discovery: ${host} — no inverter data`);
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
      this.logger.info(`Fronius discovery: ${host} — ${reason}`);
      return null;
    }
  }

  /** Probe candidates in batches — sequential to avoid flooding the network. */
  private probeBatches(candidates: string[]): Promise<Inverter[]> {
    const batches = chunk(candidates, 30);
    return batches.reduce(
      async (accPromise, batch) => {
        const acc = await accPromise;
        const results = await Promise.allSettled(
          batch.map((host) => this.probeHost(host)),
        );
        const hits = results
          .filter(
            (r): r is PromiseFulfilledResult<Inverter> =>
              r.status === "fulfilled" && r.value != null,
          )
          .map((r) => r.value);
        hits.forEach((hit) =>
          this.logger.info(
            `Fronius discovery: found ${hit.name} at ${hit.host}`,
          )
        );
        return [...acc, ...hits];
      },
      Promise.resolve([] as Inverter[]),
    );
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
