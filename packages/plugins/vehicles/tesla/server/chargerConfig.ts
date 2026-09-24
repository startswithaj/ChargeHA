import { z } from "zod";
import { defineSection } from "@chargeha/shared/configSections";

export const DEFAULT_MIN_AMPS = 5;

// ── Tesla charging-point config ─────────────────────────────────────────────
// Stored on the vehicle_api charger row, like OCPP's min_amps. Row-scoped
// rather than plugin-wide: two Teslas on the same account can differ.
export const teslaChargerConfigDef = defineSection({
  teslaMinAmps: {
    key: "min_amps",
    schema: z.enum(["1", "2", "3", "4", "5"]),
    default: String(DEFAULT_MIN_AMPS) as "5",
  },
});
