import { defineConfig } from "vitest/config";

// Unit tests for the pure modules under lib/ (no DOM needed - the flow hooks
// are thin wiring over these tested primitives). Run with `npm test`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
