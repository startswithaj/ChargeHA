import { widenTrpc } from "../../../hostUi.ts";
import type { TeslaAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<TeslaAppRouter>();
