import "server-only";

import { timingSafeEqual } from "node:crypto";

import type { NextRequest } from "next/server";

/**
 * Shared Bearer-token verifier for every `/api/cron/*` endpoint.
 *
 * Extracted from `src/app/api/cron/ingest-macro/route.ts` (Phase 1 Step 11)
 * so the Phase 2 Step 7 family of cron routes (`ingest-technical`,
 * `ingest-prices`, `ingest-onchain`, `ingest-cnn-fg`, `ingest-news`) can
 * share one hardened implementation instead of five copies that drift.
 *
 * Rationale for the design (identical to the Phase 1 inline version):
 *
 * 1. **Constant-time compare** via `timingSafeEqual`. The timing-attack
 *    surface is small on a family-private cron with a rotating secret,
 *    but the cost is two lines and the theoretical concern goes away.
 * 2. **Fail closed when `CRON_SECRET` is unset.** A missing env var
 *    must NOT accidentally no-auth the route -- rather reject all
 *    traffic so an ops mistake can't expose a public writer.
 * 3. **No throwing.** Callers convert the `{ ok: false, reason }` shape
 *    into a 401 response. Throwing from here would bypass the
 *    cron-level ingest_runs audit write (see blueprint tenet 1:
 *    "silent success, loud failure").
 * 4. **`import "server-only"` guard.** CRON_SECRET is a server secret;
 *    any accidental client-import of this file triggers a build-time
 *    error rather than a runtime leak.
 *
 * Accepts `NextRequest | Request` — we only touch `.headers.get(...)`
 * which is on the Fetch Request base, so the helper is usable from any
 * Route Handler signature the codebase happens to use.
 */
export function verifyCronSecret(
  request: NextRequest | Request,
): { ok: true } | { ok: false; reason: string } {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return { ok: false, reason: "CRON_SECRET not configured" };
  }

  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return { ok: false, reason: "missing or malformed Authorization header" };
  }
  const presented = match[1];

  const a = Buffer.from(presented);
  const b = Buffer.from(cronSecret);
  if (a.length !== b.length) {
    return { ok: false, reason: "invalid token" };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid token" };
  }
  return { ok: true };
}
