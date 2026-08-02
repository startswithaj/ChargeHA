import type { QueryHandler } from "./types.ts";

const CREATED_AT = "2026-01-01T00:00:00.000Z";

export const chargerHandlers: Record<string, QueryHandler> = {
  "charger.list": (_i, s) => {
    const now = new Date().toISOString();
    return s.chargers.map((c) => ({
      id: c.id,
      name: c.name,
      chargerAdapterType: c.chargerAdapterType,
      chargerConfig: "{}",
      mode: c.mode,
      priority: c.priority,
      vehicleId: c.vehicleId,
      createdAt: CREATED_AT,
      updatedAt: now,
      state: null,
    }));
  },
};
