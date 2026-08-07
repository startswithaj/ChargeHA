/// <reference lib="deno.ns" />

// Single place that reads Deno.networkInterfaces() and turns it into the LAN
// addresses ChargeHA itself is reachable on. Used both to tell a charger
// where to dial (OCPP's connection URL) and to default a subnet-scan field
// in the discovery plugins (Fronius/Enphase/Sigenergy/Tapo) — one filter,
// not one copy per caller.

/** Virtual interfaces nothing on the LAN can route to: container bridges,
 *  VPN tunnels, virtual-machine adapters. Offering these as scan/connect
 *  candidates sends the user down a dead end. */
const VIRTUAL_IFACE = /^(docker|br-|veth|utun|tun|tap|vmnet|vboxnet|zt|wg)/i;

function isRealLanAddress(iface: Deno.NetworkInterfaceInfo): boolean {
  return iface.family === "IPv4" &&
    !VIRTUAL_IFACE.test(iface.name) &&
    !iface.address.startsWith("127.") &&
    !iface.address.startsWith("169.254.") &&
    // A .0 host part is a network address, never a reachable host.
    !iface.address.endsWith(".0");
}

/** This machine's real LAN IPv4 addresses, filtered of loopback, link-local,
 *  virtual/container/VPN interfaces, and bare network addresses. Empty when
 *  interface reads are unavailable (no `--allow-sys`) rather than throwing —
 *  callers on a settings page must degrade, not fail. */
export function detectLanAddresses(
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
): string[] {
  try {
    return networkInterfaces()
      .filter(isRealLanAddress)
      .map((i) => i.address);
  } catch (error) {
    // Reading interfaces needs --allow-sys, which the test task does not
    // grant. A settings page must not fail over a missing permission.
    if (!(error instanceof Deno.errors.NotCapable)) throw error;
    return [];
  }
}

/** The distinct /24 subnet prefixes (e.g. "192.168.1") this machine is
 *  reachable on. A machine can sit on more than one LAN, so every plausible
 *  candidate is returned rather than just the first. */
export function detectLanSubnets(
  networkInterfaces: typeof Deno.networkInterfaces = Deno.networkInterfaces,
): string[] {
  return [
    ...new Set(
      detectLanAddresses(networkInterfaces).map((address) =>
        address.split(".").slice(0, 3).join(".")
      ),
    ),
  ];
}
