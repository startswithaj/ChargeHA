// Shared IP/subnet helpers for network discovery — no side effects.

export class NetworkScan {
  static generateSubnetIps(subnet: string): string[] {
    return Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
  }

  // Extract unique non-broadcast, non-multicast IPs from ARP output.
  static parseArpOutput(output: string): string[] {
    const ipRegex = /\b(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\b/g;
    return [
      ...new Set(
        [...output.matchAll(ipRegex)]
          .map((m) => m[1])
          .filter((ip) => !ip.endsWith(".255") && !ip.startsWith("224.")),
      ),
    ];
  }

  static extractSubnets(ips: string[]): string[] {
    return [...new Set(ips.map((ip) => ip.split(".").slice(0, 3).join(".")))];
  }

  // Expand ARP IPs to include all hosts in their subnets. ARP IPs first.
  static expandArpToSubnets(arpIps: string[]): string[] {
    const expanded = NetworkScan.extractSubnets(arpIps)
      .flatMap(NetworkScan.generateSubnetIps);
    const seen = new Set(arpIps);
    return [...arpIps, ...expanded.filter((ip) => !seen.has(ip))];
  }

  static chunk<T>(items: T[], size: number): T[][] {
    return Array.from(
      { length: Math.ceil(items.length / size) },
      (_, i) => items.slice(i * size, (i + 1) * size),
    );
  }
}
