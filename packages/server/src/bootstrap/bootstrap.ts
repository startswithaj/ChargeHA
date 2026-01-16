import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";

import { createAppRouter } from "../trpc/root.ts";
import type { TrpcContext } from "../trpc/trpc.ts";

function buildHttpApp(
) {
  const appRouter = createAppRouter({
  });
  const app = new Hono();
  app.use(secureHeaders({ strictTransportSecurity: false }));
  setupTrpcEndpoint(app, appRouter, {
  });
  return app;
}

function setupTrpcEndpoint(
  app: Hono,
  appRouter: ReturnType<typeof createAppRouter>,
  ctx: {
  },
) {
  app.all("/trpc/*", async (c) => {
    const responseHeaders = new Headers();
    const response = await fetchRequestHandler({
      endpoint: "/trpc",
      req: c.req.raw,
      router: appRouter,
      createContext: (): TrpcContext => ({
      }),
    });
    [...responseHeaders.entries()].forEach(([key, value]) => {
      response.headers.append(key, value);
    });
    return response;
  });
}

export async function bootstrap(): Promise<
  { shutdown: () => Promise<void> }
> {
  const port = parseInt(Deno.env.get("PORT") ?? "8000", 10);
  const app = buildHttpApp({
  });
  const server = Deno.serve({ port }, app.fetch);
  return {
    shutdown: async () => {
      await server.shutdown();
    },
  };
}
