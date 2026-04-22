import "server-only";

import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { CACHE_TAGS } from "@/lib/data/tags";
import { writeIngestRun } from "@/lib/data/snapshot";
import { fetchCnnFearGreed } from "@/lib/score-engine/sources/cnn-fear-greed";
import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json, TablesInsert } from "@/types/database";

/**
 * Ingest-CNN-F&G cron — blueprint §9 Step 7.
 *
 * Pipeline:
 *   1. Authenticate `Authorization: Bearer ${CRON_SECRET}`.
 *   2. Fetch CNN Markets Data fear-and-greed (one call; back-off
 *      handled internally by the source adapter).
 *   3. Persist the latest reading into `onchain_readings` with
 *      indicator_key='CNN_FG'. Per migration 0005 comment, CNN F&G
 *      lives in onchain_readings as a practical convenience (hourly
 *      refresh, single-score row shape) even though semantically it
 *      is a sentiment-category signal input.
 *   4. Record an `ingest_runs` audit row.
 *   5. Invalidate the `sentiment` cache tag on success — readers of
 *      the sentiment-category card depend on fresh CNN F&G, not the
 *      onchain category card.
 *
 * **Scale convention.** The parser returns a raw score in CNN's
 * native 0-100 scale where 0 = extreme fear, 100 = extreme greed.
 * The product's favorability convention is inverted (PRD §9 /
 * blueprint §4.3): high score = favorable for entry, and market
 * fear IS the favorable entry condition.
 *
 * So we write:
 *   - `value_raw`   = raw CNN score (0 = extreme fear, 100 = extreme greed)
 *   - `score_0_100` = inverted (100 - raw), matching `cryptoFearGreedToScore`
 *
 * The `EXTREME_FEAR` signal (§4.5: `VIX >= 35 || CNN_FG < 25`) uses
 * the RAW CNN score threshold (< 25) — so downstream signal-engine
 * code MUST read `value_raw`, not `score_0_100`, when evaluating the
 * threshold. The dashboard card renders `score_0_100` (favorability).
 * This split keeps both consumers honest and prevents the classic
 * fear-greed-inversion bug.
 *
 * Failure model (blueprint §0.5 tenet 1):
 *   - CNN F&G fetch failure → error row written; cache NOT evicted
 *     so yesterday's staleness badge surfaces instead of pretending
 *     fresh success.
 *   - Parser returns `partial` (e.g. only history, no current) →
 *     still error from our perspective (we need the latest reading
 *     for the card). Row stored as `partial`; cache not evicted.
 *
 * asset_type: `'common'` — CNN F&G is a US-stocks sentiment gauge
 * consumed by the `EXTREME_FEAR` signal across asset categories per
 * blueprint §4.5. It is not a BTC-only on-chain signal despite
 * sharing a table.
 *
 * Endpoint: GET /api/cron/ingest-cnn-fg
 * Scheduled: hourly via `.github/workflows/cron-hourly.yml`
 *   (sequential step 2/3: onchain -> cnn-fg -> news).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  // ---- 1. Auth ----
  const authResult = verifyCronSecret(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  let successCount = 0;
  let failCount = 0;
  let errorSummary: string | null = null;

  try {
    // ---- 2. Fetch CNN F&G (back-off handled internally) ----
    const result = await fetchCnnFearGreed();

    // ---- 3. Build reading row ----
    if (result.fetch_status === "success" && result.latest) {
      const rawScore = result.latest.score;
      // Inverted favorability score: raw 0 (extreme fear) = 100
      // favorability; raw 100 (extreme greed) = 0. Clamp defensively
      // -- parser already enforces 0-100 but a future parser change
      // shouldn't silently produce out-of-range favorability.
      const favorability = clamp0to100(100 - rawScore);

      const row: TablesInsert<"onchain_readings"> = {
        indicator_key: "CNN_FG",
        asset_type: "common",
        model_version: MODEL_VERSION,
        observed_at: result.latest.date,
        source_name: "cnn",
        fetch_status: "success",
        value_raw: rawScore,
        value_normalized: null, // no z-score step; passthrough inversion
        score_0_100: favorability,
        raw_payload: { rating: result.latest.rating } as Json,
      };
      await writeCnnFgReading(row);
      successCount = 1;
    } else {
      // `partial` (only history, no current) or outright `error`:
      // both mean we don't have a usable latest reading. Store as
      // error/partial with the parser's error message for forensics.
      const fetchStatus: "error" | "partial" =
        result.fetch_status === "partial" ? "partial" : "error";
      const row: TablesInsert<"onchain_readings"> = {
        indicator_key: "CNN_FG",
        asset_type: "common",
        model_version: MODEL_VERSION,
        observed_at: result.latest?.date ?? today,
        source_name: "cnn",
        fetch_status: fetchStatus,
        value_raw: null,
        value_normalized: null,
        score_0_100: null,
        raw_payload: { error: result.error ?? "unknown" } as Json,
      };
      await writeCnnFgReading(row);
      failCount = 1;
    }
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : String(err);
    console.error("[cron] ingest-cnn-fg failed:", err);
  }

  const durationMs = Date.now() - startMs;

  // ---- 4. Audit row (always) ----
  try {
    await writeIngestRun({
      model_version: MODEL_VERSION,
      indicators_attempted: 1,
      indicators_success: successCount,
      indicators_failed: failCount,
      snapshots_written: 0,
      error_summary: errorSummary,
      duration_ms: durationMs,
    });
  } catch (auditErr) {
    console.error(
      "[cron] ingest-cnn-fg ingest_runs audit write failed:",
      auditErr,
    );
  }

  // ---- 5. Cache invalidation ----
  //
  // Invalidates `sentiment` (NOT `onchain`) -- despite sharing the
  // `onchain_readings` table, CNN F&G is consumed by the sentiment
  // category aggregator + the EXTREME_FEAR signal, not the on-chain
  // aggregator. Per migration 0005 comment.
  if (successCount > 0) {
    revalidateTag(CACHE_TAGS.sentiment, { expire: 0 });
  }

  const status: "success" | "partial" | "error" =
    errorSummary || successCount === 0 ? "error" : "success";
  const httpStatus = status === "error" ? 500 : 200;

  return NextResponse.json(
    {
      status,
      snapshot_date: today,
      model_version: MODEL_VERSION,
      indicators_attempted: 1,
      indicators_success: successCount,
      indicators_failed: failCount,
      duration_ms: durationMs,
      error_summary: errorSummary,
    },
    { status: httpStatus },
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeCnnFgReading(
  row: TablesInsert<"onchain_readings">,
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("onchain_readings")
    .upsert(row, {
      onConflict: "indicator_key,observed_at,model_version",
    });
  if (error) {
    throw new Error(
      `writeCnnFgReading failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }
}

/**
 * Clamp a number to [0, 100]. Defensive wrapper -- the CNN parser
 * already enforces 0-100, but a future parser change or float
 * rounding error shouldn't silently produce out-of-range favorability.
 */
function clamp0to100(n: number): number {
  if (!Number.isFinite(n)) return 50;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/**
 * Constant-time bearer-token check. Same contract as
 * `ingest-macro/route.ts` + `ingest-onchain/route.ts`.
 */
function verifyCronSecret(
  request: NextRequest,
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
  const a = Buffer.from(match[1]);
  const b = Buffer.from(cronSecret);
  if (a.length !== b.length) {
    return { ok: false, reason: "invalid token" };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "invalid token" };
  }
  return { ok: true };
}
