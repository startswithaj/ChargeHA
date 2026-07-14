import { widenTrpc } from "../../../../client/src/trpc.ts";
import type { EnphaseLocalAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<EnphaseLocalAppRouter>();
