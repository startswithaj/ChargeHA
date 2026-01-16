import { bootstrap } from "./bootstrap/bootstrap.ts";

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
