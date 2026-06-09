import type { MutationHandlers } from "../types.ts";

type NotificationMutations = Pick<MutationHandlers, "notification.test">;

export const notificationMutations: NotificationMutations = {
  // Nothing is sent in demo — report a fake success.
  "notification.test": () => ({ success: true as const }),
};
