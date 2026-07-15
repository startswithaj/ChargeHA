import { widenTrpc } from "../../../hostUi.ts";
import type { EnphaseLocalAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<EnphaseLocalAppRouter>();
