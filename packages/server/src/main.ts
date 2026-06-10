import { loadEnv } from "./lib/loadEnv.ts";
import { bootstrap } from "./bootstrap/bootstrap.ts";

// Load .env into the environment before bootstrap reads it.
await loadEnv();

const { shutdown } = await bootstrap();

Deno.addSignalListener("SIGINT", async () => {
  console.log("\n[Server] Shutting down...");
  await shutdown();
  Deno.exit(0);
});
Deno.addSignalListener("SIGTERM", async () => {
  await shutdown();
  Deno.exit(0);
});
