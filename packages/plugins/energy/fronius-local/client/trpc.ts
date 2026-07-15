import { widenTrpc } from "../../../hostUi.ts";
import type { FroniusLocalAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<FroniusLocalAppRouter>();
