// Shared IP/subnet helpers for the energy plugins' network discovery — no side effects.

/** Generate all 254 host IPs for a /24 subnet. */
export function generateSubnetIps(subnet: string): string[] {
  return Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
}

/** Extract unique non-broadcast, non-multicast IPs from ARP output. */
export function parseArpOutput(output: string): string[] {
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
export function extractSubnets(ips: string[]): string[] {
  return [...new Set(ips.map((ip) => ip.split(".").slice(0, 3).join(".")))];
}

/** Expand ARP IPs to include all hosts in their subnets. ARP IPs first. */
export function expandArpToSubnets(arpIps: string[]): string[] {
  const expanded = extractSubnets(arpIps).flatMap(generateSubnetIps);
  const seen = new Set(arpIps);
  return [...arpIps, ...expanded.filter((ip) => !seen.has(ip))];
}

/** Split an array into chunks of the given size. */
export function chunk<T>(items: T[], size: number): T[][] {
  return Array.from(
    { length: Math.ceil(items.length / size) },
    (_, i) => items.slice(i * size, (i + 1) * size),
  );
}
