import { trpc } from "../trpc.ts";

/** Charging points with live state; kept fresh by chargers_changed +
 *  charger_update SSE events (see RealtimeSync). */
export function useChargers() {
  const query = trpc.charger.list.useQuery();
  return {
    chargers: query.data ?? [],
    isLoading: query.isLoading,
  };
}
