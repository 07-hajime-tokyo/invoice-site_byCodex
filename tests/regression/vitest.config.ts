import { defineConfig } from "vitest/config";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
export default defineConfig({
  root,
  resolve: {
    alias: {
      "@": path.join(root, "client/src"),
      "@shared": path.join(root, "shared"),
    },
  },
  test: {
    include: ["tests/regression/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/regression/support/network-guard.mjs"],
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 30000,
  },
});
