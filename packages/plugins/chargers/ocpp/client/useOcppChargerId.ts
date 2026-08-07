import { trpc } from "./trpc.ts";

/**
 * The OCPP charger row this UI acts on.
 *
 * INTERIM. The wizard and settings panel are not yet given a charger id
 * (ChargerEditForm passes only a typeId), so the single OCPP row is used.
 * Correct while ensureCharger still allows one row per adapter type.
 * Change set 04 passes the id down as a prop and deletes this hook.
 *
 * `undefined` while the list is loading — callers skip their query.
 */
export function useOcppChargerId(): string | undefined {
  // Interim: core's charger.list, not a plugin-namespaced procedure. Deleted
  // along with this whole hook in change set 04.
  // deno-lint-ignore custom-main-refs/no-main-trpc
  const { data } = trpc.charger.list.useQuery();
  return data?.find((c) => c.chargerAdapterType === "ocpp")?.id;
}
