import type { ChargerStatus } from "@chargeha/shared";

export const CHARGER_STATUS_LABELS: Record<ChargerStatus, string> = {
  available: "Available",
  preparing: "Preparing",
  charging: "Charging",
  suspended: "Paused",
  faulted: "Fault",
  finishing: "Finishing",
  no_draw: "No draw",
  unconfigured: "Setup needed",
};
