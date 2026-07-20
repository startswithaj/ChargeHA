import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Tesla plugin config section ─────────────────────────────────────────────
// Keys are relative — PluginDependencies prefixes them with the plugin id.

export const teslaConfigDef = defineSection({
  teslaClientId: {
    key: "client_id",
    schema: z.string(),
    default: "",
  },
  teslaClientSecret: {
    key: "client_secret",
    schema: z.string(),
    default: "",
  },
  teslaRegion: {
    key: "region",
    schema: z.enum(["na", "eu", "cn"]),
    default: "na" as const,
  },
  teslaPublicKeyDomain: {
    key: "public_key_domain",
    schema: z.string(),
    default: "",
  },
  teslaPublicKeyHosting: {
    key: "public_key_hosting",
    schema: z.enum(["", "custom", "tunnel"]),
    default: "" as const,
  },
  teslaProxyUrl: {
    key: "proxy_url",
    schema: z.string(),
    default: "https://localhost:4443",
  },
  ecPublicKeyPem: {
    key: "ec_public_key_pem",
    schema: z.string(),
    default: "",
  },
  ecPrivateKey: {
    key: "ec_private_key",
    schema: z.string(),
    default: "",
  },
  teslaAccessToken: {
    key: "access_token",
    schema: z.string(),
    default: "",
  },
  teslaRefreshToken: {
    key: "refresh_token",
    schema: z.string(),
    default: "",
  },
  teslaTokenExpiresAt: {
    key: "token_expires_at",
    schema: z.string(),
    default: "",
  },
  teslaKeyPaired: {
    key: "key_paired",
    schema: z.string(),
    default: "",
  },
});

export type TeslaConfig = SectionType<typeof teslaConfigDef>;

export type TeslaConfigKey = SectionKeys<typeof teslaConfigDef>;

export const TESLA_SECRET_KEYS = [
  "ec_private_key",
  "client_secret",
  "access_token",
  "refresh_token",
] as const satisfies readonly TeslaConfigKey[];

/** Config resetOnboarding always keeps: the EC keypair. The public key domain
 *  and its hosting mode are kept too, but only when self-hosted — a tunnel URL
 *  is ephemeral and dead after a reset, so it is cleared (see resetOnboarding).
 *  The user hosts a self-hosted key themselves, so wiping it would force them to
 *  re-host or re-type a still-valid setup. */
export const TESLA_RESET_PRESERVED_KEYS = [
  "ec_private_key",
  "ec_public_key_pem",
] as const satisfies readonly TeslaConfigKey[];
