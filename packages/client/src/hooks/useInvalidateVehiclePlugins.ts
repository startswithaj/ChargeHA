import { trpc } from "../trpc.ts";

/** Host-provided refresh for the vehicle plugin list. A plugin calls this after
 *  it configures or clears itself so the main Vehicle settings page re-evaluates
 *  which plugins are configured (flipping "+ Set up" cards on/off). */
export function useInvalidateVehiclePlugins(): () => void {
  const utils = trpc.useUtils();
  return () => {
    utils.vehicle.list.invalidate();
    utils.vehicle.getPlugins.invalidate();
  };
}
