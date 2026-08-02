import { widenTrpc } from "../../../hostUi.ts";
import type { TapoAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<TapoAppRouter>();
