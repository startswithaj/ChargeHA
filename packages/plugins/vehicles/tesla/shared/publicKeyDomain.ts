export type PublicKeyHosting = "" | "custom" | "tunnel";

/** The key domain is live state, never storage: custom mode trusts the saved
 *  domain; tunnel mode is only valid while the tunnel is actually up. */
export function resolvePublicKeyDomain(
  hosting: PublicKeyHosting,
  savedDomain: string | null,
  tunnelUrl: string | null,
): string | null {
  if (hosting === "tunnel") return tunnelUrl;
  return savedDomain || null;
}
