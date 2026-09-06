import { defineConfig } from "vitest/config";

// Explicit opt-in command. Missing credentials/model fail, rather than silently skip.
export default defineConfig({
  test: { environment: "node", include: ["tests/integration/**/*.test.ts"] },
});
