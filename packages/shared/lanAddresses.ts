/** 172.16-31 is RFC1918 but in practice Docker: default bridge 172.17.0.0/16,
 *  compose nets 172.18-31. Matches a full address or a /24 prefix. */
export function isLikelyDockerNetwork(addressOrSubnet: string): boolean {
  const [a, b] = addressOrSubnet.split(".").map(Number);
  return a === 172 && b >= 16 && b <= 31;
}

/** Preference, never exclusion — a container-only install has nothing better
 *  to offer and the UI warns instead. */
function lanAddressRank(address: string): number {
  if (address.startsWith("192.168.")) return 0;
  if (address.startsWith("10.")) return 1;
  return isLikelyDockerNetwork(address) ? 3 : 2;
}

export function sortLanAddresses(addresses: string[]): string[] {
  return [...addresses].sort((a, b) => lanAddressRank(a) - lanAddressRank(b));
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Private LAN IPv4 — something a charger on the same network could also dial.
 *  Loopback, "localhost" and hostnames fail this. */
export function isPrivateLanIpv4(hostname: string): boolean {
  const match = IPV4.exec(hostname);
  if (!match) return false;
  const octets = match.slice(1).map(Number);
  if (octets.some((o) => o > 255)) return false;
  const [a, b] = octets;
  return a === 10 || (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31);
}
