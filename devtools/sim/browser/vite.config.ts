import { defineConfig } from "vite";
import { resolve } from "node:path";

const root = import.meta.dirname!;

export default defineConfig({
  root,
  resolve: {
    alias: [
      {
        find: "@chargeha/shared/simulation",
        replacement: resolve(
          root,
          "../../../packages/shared/simulation/mod.ts",
        ),
      },
      {
        find: "@chargeha/shared/engine",
        replacement: resolve(root, "../../../packages/shared/engine/mod.ts"),
      },
      {
        find: "@chargeha/shared",
        replacement: resolve(root, "../../../packages/shared"),
      },
    ],
  },
  build: {
    outDir: resolve(root, "../../output/browser"),
    emptyOutDir: true,
  },
});
