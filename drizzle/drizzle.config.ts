import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  schema: "./packages/server/src/db/Schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: `file:${Deno.env.get("DB_PATH") ?? "./data/chargeha.db"}`,
  },
});
