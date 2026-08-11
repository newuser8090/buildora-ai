import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    exclude: ["node_modules"],
    globals: true,
    environment: "node",
    // Headroom above Vitest's 5s default: slow userEvent typing tests
    // (long-string .type() calls) cross 5s only under full-suite CPU
    // contention on Windows, while passing comfortably in isolation. A
    // timeout bump — never an assertion change — keeps the gate honest.
    testTimeout: 10_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
