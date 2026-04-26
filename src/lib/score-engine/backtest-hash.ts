/**
 * Phase 3.4 Step 4 — canonical request hashing for backtest memoization.
 *
 * The `backtest_runs.request_hash` UNIQUE index keys on
 * `(request_hash, user_id)`. Two identical requests from the same user
 * must hash to the same string so the API route can short-circuit and
 * return the cached result row.
 *
 * Canonical form:
 *   - Object keys sorted alphabetically (recursively).
 *   - Stringified via JSON.stringify (deterministic for plain
 *     objects + primitives; arrays preserve order).
 *   - sha256 hex digest of the resulting string.
 *
 * Pure: no DB, no env, no `server-only`. Importable from tests + edge.
 *
 * Reference: docs/phase3_4_backtest_blueprint.md §2.4 (memoization key)
 */

import { createHash } from "node:crypto";

import type { BacktestRequest } from "./backtest";

/** Recursively sort object keys for canonical JSON. Arrays retain order. */
function canonicalize(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  const sorted: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>).sort()) {
    sorted[k] = canonicalize((value as Record<string, unknown>)[k]);
  }
  return sorted;
}

/**
 * Returns a sha256 hex digest of the canonical-JSON form of the
 * request. Idempotent: same request → same hash byte-for-byte.
 *
 * `extras` carries data NOT stored on the BacktestRequest type but that
 * MUST disambiguate the memo key. Specifically, an inline custom-weights
 * payload from the tuning slider — two payloads that produce the same
 * lossy stamp suffix on `request.weightsVersion` would otherwise collide.
 * Resolved-from-id paths can pass `customWeightsPayload` for the same
 * reason.
 */
export function hashBacktestRequest(
  request: BacktestRequest,
  extras?: {
    customWeightsPayload?:
      | Record<string, Record<string, number>>
      | null
      | undefined;
  },
): string {
  const input =
    extras?.customWeightsPayload != null
      ? { request, customWeightsPayload: extras.customWeightsPayload }
      : request;
  const canonical = JSON.stringify(canonicalize(input));
  return createHash("sha256").update(canonical).digest("hex");
}

/** Canonical sha256 hex of an arbitrary plain-JSON value. Used to stamp
 * the `weights_version` audit suffix in a key-order-independent,
 * collision-resistant way. Exported so the API route can stamp without
 * duplicating the canonicalization logic.
 */
export function canonicalSha256Hex(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(value)))
    .digest("hex");
}
