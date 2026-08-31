import { widenTrpc } from "../../../hostUi.ts";
import type { GoodweSemsAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<GoodweSemsAppRouter>();
