import path from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest config — only used by the score engine + util unit tests.
 * These are pure-function tests that don't need a DOM, a Next.js
 * runtime, or a Supabase client. Running under the Node environment
 * keeps startup fast (<1s).
 *
 * The `@/...` alias matches Next.js's tsconfig path alias so test
 * files can import the code they're exercising with the same specifier
 * the app uses.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
