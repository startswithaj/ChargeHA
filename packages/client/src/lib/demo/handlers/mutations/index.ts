import type { MutationHandlers } from "../types.ts";
import { wizardMutations } from "./wizard.ts";
import { configMutations } from "./config.ts";
import { authMutations } from "./auth.ts";
import { vehicleMutations } from "./vehicle.ts";
import { scheduleMutations } from "./schedule.ts";
import { tariffMutations } from "./tariff.ts";
import { energyMutations } from "./energy.ts";
import { notificationMutations } from "./notification.ts";

// TOTAL over every required (non-gated) mutation — each domain map is a typed
// slice (Pick<MutationHandlers, …>), so a missing handler is a compile error.
export const mutationHandlers: MutationHandlers = {
  ...wizardMutations,
  ...configMutations,
  ...authMutations,
  ...vehicleMutations,
  ...scheduleMutations,
  ...tariffMutations,
  ...energyMutations,
  ...notificationMutations,
};
