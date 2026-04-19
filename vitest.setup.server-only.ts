/**
 * Stub for the `server-only` package, used only by Vitest.
 *
 * In production, `import "server-only"` throws if it's reached from a
 * client bundle — that's the whole point of the guard we put on
 * `src/lib/supabase/admin.ts` and `src/lib/score-engine/indicators/fred.ts`.
 *
 * Vitest runs tests in a Node environment without Next.js's runtime
 * markers, so the real `server-only` module throws when the test
 * file's import graph reaches a guarded file. Aliasing `server-only`
 * to this empty module sidesteps the guard in tests while leaving
 * production behavior untouched. The alias is set in `vitest.config.ts`.
 */
export {};
