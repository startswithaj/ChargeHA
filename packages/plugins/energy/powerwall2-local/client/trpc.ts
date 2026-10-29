import { widenTrpc } from "../../../hostUi.ts";
import type { Powerwall2LocalAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<Powerwall2LocalAppRouter>();
