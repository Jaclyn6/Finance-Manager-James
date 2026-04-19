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
      // The `server-only` package is a build-time guard that throws on
      // import from any client bundle (see `src/lib/supabase/admin.ts`
      // and `src/lib/score-engine/indicators/fred.ts`). Vitest's Node
      // environment has no Next.js runtime markers, so the real module
      // unconditionally throws. Aliasing to a no-op stub preserves the
      // production guard while letting tests import guarded modules.
      "server-only": path.resolve(__dirname, "./vitest.setup.server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
