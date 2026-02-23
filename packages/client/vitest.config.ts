import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import deno from "@deno/vite-plugin";

export default defineConfig({
  plugins: [deno(), react()],
  server: {
    fs: {
      allow: [".."],
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    globals: true,
    include: [
      "src/**/*.test.{ts,tsx}",
      "../plugins/**/client/**/*.test.{ts,tsx}",
    ],
    css: {
      modules: {
        classNameStrategy: "non-scoped",
      },
    },
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.{ts,tsx}", "../plugins/**/client/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/test-setup.ts", "**/*.test.{ts,tsx}"],
      reporter: ["text", "html"],
    },
  },
});
