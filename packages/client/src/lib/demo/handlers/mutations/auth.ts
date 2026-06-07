import type { MutationHandlers } from "../types.ts";
import { updateDemoState } from "../../demoState.ts";

type AuthMutations = Pick<
  MutationHandlers,
  "auth.login" | "auth.logout" | "auth.changePassword" | "auth.changeMode"
>;

export const authMutations: AuthMutations = {
  // Local auth round-trips are faked in-session — any credentials succeed.
  "auth.login": () => {
    updateDemoState((m) => ({ ...m, authenticated: true }));
    return { success: true as const };
  },

  "auth.logout": () => {
    updateDemoState((m) => ({ ...m, authenticated: false }));
    return { success: true as const };
  },

  "auth.changePassword": () => ({ success: true as const }),

  "auth.changeMode": (input) => {
    updateDemoState((m) => ({
      ...m,
      config: { ...m.config, auth_mode: input.newMode },
      authenticated: input.newMode !== "none",
    }));
    return { success: true as const };
  },
};
