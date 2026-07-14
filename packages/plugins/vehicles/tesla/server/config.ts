import { z } from "zod";
import {
  defineSection,
  type SectionKeys,
  type SectionType,
} from "@chargeha/shared/configSections";

// ── Tesla plugin config section ─────────────────────────────────────────────
// All keys use dot-namespaced format: tesla.{key}

export const teslaConfigDef = defineSection({
  teslaClientId: {
    key: "tesla.client_id",
    schema: z.string(),
    default: "",
  },
  teslaClientSecret: {
    key: "tesla.client_secret",
    schema: z.string(),
    default: "",
  },
  teslaRegion: {
    key: "tesla.region",
    schema: z.enum(["na", "eu", "cn"]),
    default: "na" as const,
  },
  teslaPublicKeyDomain: {
    key: "tesla.public_key_domain",
    schema: z.string(),
    default: "",
  },
  teslaPublicKeyHosting: {
    key: "tesla.public_key_hosting",
    schema: z.enum(["", "custom", "tunnel"]),
    default: "" as const,
  },
  teslaProxyUrl: {
    key: "tesla.proxy_url",
    schema: z.string(),
    default: "https://localhost:4443",
  },
  ecPublicKeyPem: {
    key: "tesla.ec_public_key_pem",
    schema: z.string(),
    default: "",
  },
  ecPrivateKey: {
    key: "tesla.ec_private_key",
    schema: z.string(),
    default: "",
  },
  teslaAccessToken: {
    key: "tesla.access_token",
    schema: z.string(),
    default: "",
  },
  teslaRefreshToken: {
    key: "tesla.refresh_token",
    schema: z.string(),
    default: "",
  },
  teslaTokenExpiresAt: {
    key: "tesla.token_expires_at",
    schema: z.string(),
    default: "",
  },
  teslaKeyPaired: {
    key: "tesla.key_paired",
    schema: z.string(),
    default: "",
  },
});

export type TeslaConfig = SectionType<typeof teslaConfigDef>;

export type TeslaConfigKey = SectionKeys<typeof teslaConfigDef>;

export const TESLA_SECRET_KEYS = [
  "tesla.ec_private_key",
  "tesla.client_secret",
  "tesla.access_token",
  "tesla.refresh_token",
] as const satisfies readonly TeslaConfigKey[];
