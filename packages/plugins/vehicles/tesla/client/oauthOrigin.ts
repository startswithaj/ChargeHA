export const TESLA_CALLBACK_PATH = "/api/vehicle/tesla/callback";

/**
 * True when the browser origin can be registered in Tesla's developer portal
 * as a redirect base: localhost (any port, any protocol) or any https origin.
 * Plain http on a non-localhost host (e.g. a LAN IP) is rejected by the
 * portal, so OAuth must ride the tunnel instead.
 */
export function isStableOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol === "https:") return true;
    return url.hostname === "localhost" || url.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

export interface ResolvedOAuthOrigin {
  /** Redirect base to use, or null when no usable origin exists (unstable
   *  browser origin and no tunnel running). */
  origin: string | null;
  /** True when OAuth rides the tunnel — the portal then also needs the
   *  callback in Allowed Returned URL(s), and the registration dies with the
   *  tunnel. */
  viaTunnel: boolean;
}

/**
 * Resolve the OAuth redirect base. The browser origin wins whenever Tesla's
 * portal can register it — it is stable across tunnel restarts, so the portal
 * is configured once. The ephemeral tunnel is only a fallback for origins the
 * portal refuses.
 */
export function resolveOAuthOrigin(
  browserOrigin: string,
  tunnelUrl: string | null | undefined,
): ResolvedOAuthOrigin {
  if (isStableOrigin(browserOrigin)) {
    return { origin: browserOrigin, viaTunnel: false };
  }
  if (tunnelUrl) {
    return { origin: tunnelUrl, viaTunnel: true };
  }
  return { origin: null, viaTunnel: true };
}

/** The full callback URL for a redirect base. */
export function callbackUrl(origin: string): string {
  return `${origin}${TESLA_CALLBACK_PATH}`;
}

function parseUrl(origin: string): URL | null {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

const LOCALHOST_HOSTNAMES = ["localhost", "127.0.0.1"];
const PRIVATE_IP_RANGES = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/**
 * Could Tesla's servers download the public key from this origin?
 * Tesla fetches `https://<domain>/.well-known/...` from the public internet,
 * which rules out http origins and hosts that don't exist outside this
 * machine or LAN. A `true` result means "possible", not "proven reachable".
 */
export function canTeslaFetchKeyFrom(origin: string): boolean {
  const url = parseUrl(origin);
  if (!url) return false;

  // Tesla builds the key URL with https:// — an http-only server can't answer.
  if (url.protocol !== "https:") return false;

  // Loopback and private-LAN addresses aren't reachable from the internet.
  if (LOCALHOST_HOSTNAMES.includes(url.hostname)) return false;
  if (PRIVATE_IP_RANGES.test(url.hostname)) return false;

  return true;
}
