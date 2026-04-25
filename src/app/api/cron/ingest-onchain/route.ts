import "server-only";

import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import {
  loadSignalInputs,
  writeSignalEvents,
} from "@/lib/data/signals";
import { CACHE_TAGS } from "@/lib/data/tags";
import { writeIngestRun } from "@/lib/data/snapshot";
import {
  cryptoFearGreedToScore,
  etfFlowToScore,
  ETF_FLOW_SCORE_WINDOW,
  mergeEtfFlowHistory,
  mvrvZScoreToScore,
  soprToScore,
} from "@/lib/score-engine/onchain";
import { computeSignals } from "@/lib/score-engine/signals";
import { fetchAlternativeMeFng } from "@/lib/score-engine/sources/alternative-me";
import { fetchBitboMetric } from "@/lib/score-engine/sources/bitbo";
import { fetchCoinGlassEtfFlow } from "@/lib/score-engine/sources/coinglass";
import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json, TablesInsert } from "@/types/database";

/**
 * Ingest-onchain cron — blueprint §9 Step 7 (Phase 2 cron strategy v2).
 *
 * Pipeline (blueprint §3, mirrors `ingest-macro`):
 *   1. Authenticate `Authorization: Bearer ${CRON_SECRET}` (constant-time).
 *   2. Fetch 3 unofficial on-chain sources in parallel:
 *        - Bitbo mvrv-z-score      → indicator_key='MVRV_Z'
 *        - Bitbo sopr              → indicator_key='SOPR'
 *        - CoinGlass ETF net flow  → indicator_key='BTC_ETF_NETFLOW'
 *        - alternative.me F&G      → indicator_key='CRYPTO_FG'
 *      (Each source adapter owns its own `fetchWithBackOff` retry loop
 *      per blueprint §3.1 "unofficial; back-off". Back-off is NOT
 *      re-implemented here.)
 *   3. Normalize each reading through the pure helpers in
 *      `src/lib/score-engine/onchain.ts`.
 *   4. Write one row per indicator into `onchain_readings` — success
 *      rows carry numeric scores; error / partial rows carry nulls +
 *      a raw_payload error summary. Schema: migration 0005.
 *   5. Record an `ingest_runs` audit row (always, even on total
 *      failure — blueprint §0.5 tenet 1 "loud failure").
 *   6. Invalidate the `onchain` cache tag if any reading succeeded.
 *
 * Failure model (blueprint §0.5 tenet 1 + §3 "partial data > no data"):
 *   - Source failure (HTTP, parse, back-off exhausted) → that indicator
 *     gets `fetch_status='error'`, value/score nulled, never throws.
 *   - All sources fail → no revalidation; the staleness gate on the
 *     cached reader surfaces the gap instead of pretending success.
 *   - Any writer throws → captured into `ingest_runs` best-effort and
 *     the handler returns 500. Upserts make retry safe.
 *
 * asset_type handling: all four indicators are BTC-centric, so rows
 * land under `asset_type='crypto'`. The per-asset composite aggregator
 * (Step 6) decides whether ETH/SOL inherit the same BTC on-chain
 * signal or get their own later; the reading itself is single-asset.
 *
 * Runtime notes:
 *   - Under `cacheComponents: true`, Route Handler bodies are already
 *     dynamic; do NOT export `const dynamic = "force-dynamic"`.
 *   - `'use cache'` is forbidden inside a Route Handler; we don't use
 *     it. All reads (ETF-flow history lookup) go through the admin
 *     client directly.
 *   - `import "server-only"` guards CRON_SECRET /
 *     SUPABASE_SERVICE_ROLE_KEY from leaking into client bundles.
 *
 * Endpoint: GET /api/cron/ingest-onchain
 * Scheduled: hourly via `.github/workflows/cron-hourly.yml`
 *   (Vercel Hobby cron has only 1 daily slot — blueprint §3.3 /
 *    plan §0.2 #8). The hourly workflow bundles this with
 *    ingest-cnn-fg + ingest-news sequentially; each step sets
 *    `continue-on-error: true` so one source outage doesn't starve
 *    the others.
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
  const readings: TablesInsert<"onchain_readings">[] = [];

  // Total indicators this endpoint attempts. Mirrors
  // INDICATOR_KEYS.length in ingest-macro. Kept as a literal because
  // the four sources are enumerated inline below.
  const ATTEMPTED = 4;

  try {
    // ---- 2. Fetch all 4 sources in parallel ----
    // Promise.all is safe here: each adapter swallows its own errors
    // into a `fetch_status: "error"` result and never throws on
    // upstream failure.
    const [mvrv, sopr, etfFlow, cryptoFg] = await Promise.all([
      fetchBitboMetric("mvrv-z-score"),
      fetchBitboMetric("sopr"),
      fetchCoinGlassEtfFlow(),
      fetchAlternativeMeFng({ limit: 90 }),
    ]);

    // ---- 3a. MVRV_Z (Bitbo) ----
    if (mvrv.fetch_status === "success" && mvrv.latest) {
      const raw = mvrv.latest.value;
      const score = mvrvZScoreToScore(raw);
      readings.push({
        indicator_key: "MVRV_Z",
        asset_type: "crypto",
        model_version: MODEL_VERSION,
        observed_at: mvrv.latest.date,
        source_name: "bitbo",
        fetch_status: "success",
        value_raw: raw,
        value_normalized: null, // no z-score step (piecewise normalizer)
        score_0_100: score,
      });
      successCount++;
    } else {
      failCount++;
      readings.push({
        indicator_key: "MVRV_Z",
        asset_type: "crypto",
        model_version: MODEL_VERSION,
        observed_at: mvrv.latest?.date ?? today,
        source_name: "bitbo",
        fetch_status: mvrv.fetch_status === "error" ? "error" : "partial",
        value_raw: null,
        value_normalized: null,
        score_0_100: null,
        raw_payload: { error: mvrv.error ?? "unknown" } as Json,
      });
    }

    // ---- 3b. SOPR (Bitbo) ----
    if (sopr.fetch_status === "success" && sopr.latest) {
      const raw = sopr.latest.value;
      const score = soprToScore(raw);
      readings.push({
        indicator_key: "SOPR",
        asset_type: "crypto",
        model_version: MODEL_VERSION,
        observed_at: sopr.latest.date,
        source_name: "bitbo",
        fetch_status: "success",
        value_raw: raw,
        value_normalized: null,
        score_0_100: score,
      });
      successCount++;
    } else {
      failCount++;
      readings.push({
        indicator_key: "SOPR",
        asset_type: "crypto",
        model_version: MODEL_VERSION,
        observed_at: sopr.latest?.date ?? today,
        source_name: "bitbo",
        fetch_status: sopr.fetch_status === "error" ? "error" : "partial",
        value_raw: null,
        value_normalized: null,
        score_0_100: null,
        raw_payload: { error: sopr.error ?? "unknown" } as Json,
      });
    }

    // ---- 3c. BTC_ETF_NETFLOW (CoinGlass) ----
    // etfFlowToScore needs the last 90 days of net-flow history. Two
    // plausible sources:
    //   (i) the upstream payload itself — CoinGlass returns a multi-
    //       day series, so `etfFlow.observations` can seed history if
    //       it spans ≥ 2 days.
    //   (ii) prior `onchain_readings` rows — fallback when upstream
    //       only returned today (a common unofficial-API behaviour
    //       under load). We hydrate the 90-day window from DB so the
    //       z-score stays comparable across runs even if upstream
    //       truncates.
    // F-R2.1 (Trigger 2 review, 2026-04-25): the previous concat
    // `[...historyFromDb, ...historyFromUpstream]` shape duplicated
    // every overlapping date — `historyFromDb` covers
    // `[today-90, latestDate-1]` and `historyFromUpstream` covers all
    // upstream rows strictly before `latestDate`, so any day present
    // in both was double-counted in the z-score mean/stddev. Replaced
    // with a per-date Map: DB rows seed first, upstream observations
    // overlay (upstream wins on tie since it's closer to source-of-
    // truth). Iteration order is chronological so the z-score sees a
    // consistently ordered series.
    if (etfFlow.fetch_status === "success" && etfFlow.latest) {
      const currentNetFlow = etfFlow.latest.netFlow;
      const latestDate = etfFlow.latest.date;

      // Build the {date, netFlow} list from prior DB rows. Admin
      // client bypasses RLS; cache tags don't apply to writer paths.
      // The merge + dedup happens in `mergeEtfFlowHistory` below.
      const dbRows: { date: string; netFlow: number }[] = [];
      try {
        const cutoff = new Date(today);
        cutoff.setUTCDate(cutoff.getUTCDate() - ETF_FLOW_SCORE_WINDOW);
        const cutoffIso = cutoff.toISOString().slice(0, 10);

        const supabase = getSupabaseAdminClient();
        const { data: priorRows, error: priorErr } = await supabase
          .from("onchain_readings")
          .select("value_raw, observed_at")
          .eq("indicator_key", "BTC_ETF_NETFLOW")
          .eq("model_version", MODEL_VERSION)
          .eq("fetch_status", "success")
          .gte("observed_at", cutoffIso)
          .lt("observed_at", latestDate)
          .order("observed_at", { ascending: true });

        if (priorErr) {
          console.error(
            "[cron] ETF-flow history lookup failed:",
            priorErr.message,
          );
        } else if (priorRows) {
          for (const r of priorRows) {
            if (typeof r.value_raw === "number" && Number.isFinite(r.value_raw)) {
              dbRows.push({ date: r.observed_at, netFlow: r.value_raw });
            }
          }
        }
      } catch (err) {
        console.error("[cron] ETF-flow history lookup threw:", err);
      }

      const mergedHistory = mergeEtfFlowHistory(
        dbRows,
        etfFlow.observations,
        latestDate,
      );

      const score = etfFlowToScore(currentNetFlow, mergedHistory);

      if (score === null) {
        // Not enough history (< 2 points). Record as partial — we
        // have the raw value but can't score it yet. Scoring starts
        // from day 2.
        failCount++;
        readings.push({
          indicator_key: "BTC_ETF_NETFLOW",
          asset_type: "crypto",
          model_version: MODEL_VERSION,
          observed_at: latestDate,
          source_name: "coinglass",
          fetch_status: "partial",
          value_raw: currentNetFlow,
          value_normalized: null,
          score_0_100: null,
          raw_payload: {
            error: `insufficient history (${mergedHistory.length} points; need >= 2)`,
            history_points: mergedHistory.length,
          } as Json,
        });
      } else {
        readings.push({
          indicator_key: "BTC_ETF_NETFLOW",
          asset_type: "crypto",
          model_version: MODEL_VERSION,
          observed_at: latestDate,
          source_name: "coinglass",
          fetch_status: "success",
          value_raw: currentNetFlow,
          value_normalized: null,
          score_0_100: score,
          raw_payload: {
            history_points: mergedHistory.length,
          } as Json,
        });
        successCount++;
      }
    } else {
      failCount++;
      readings.push({
        indicator_key: "BTC_ETF_NETFLOW",
        asset_type: "crypto",
        model_version: MODEL_VERSION,
        observed_at: etfFlow.latest?.date ?? today,
        source_name: "coinglass",
        fetch_status: etfFlow.fetch_status === "error" ? "error" : "partial",
        value_raw: null,
        value_normalized: null,
        score_0_100: null,
        raw_payload: { error: etfFlow.error ?? "unknown" } as Json,
      });
    }

    // ---- 3d. CRYPTO_FG (alternative.me) ----
    if (cryptoFg.fetch_status === "success" && cryptoFg.latest) {
      const raw = cryptoFg.latest.value;
      // Product convention: high score = favorable for entry. Crypto
      // F&G raw 0 (extreme fear) = max favorability = score 100.
      const score = cryptoFearGreedToScore(raw);
      readings.push({
        indicator_key: "CRYPTO_FG",
        asset_type: "crypto",
        model_version: MODEL_VERSION,
        observed_at: cryptoFg.latest.date,
        source_name: "alternative_me",
        fetch_status: "success",
        value_raw: raw,
        value_normalized: null,
        score_0_100: score,
        raw_payload: {
          classification: cryptoFg.latest.classification,
        } as Json,
      });
      successCount++;
    } else {
      failCount++;
      readings.push({
        indicator_key: "CRYPTO_FG",
        asset_type: "crypto",
        model_version: MODEL_VERSION,
        observed_at: cryptoFg.latest?.date ?? today,
        source_name: "alternative_me",
        fetch_status:
          cryptoFg.fetch_status === "error" ? "error" : "partial",
        value_raw: null,
        value_normalized: null,
        score_0_100: null,
        raw_payload: { error: cryptoFg.error ?? "unknown" } as Json,
      });
    }

    // ---- 4. Persist all readings ----
    // Single round-trip upsert on the natural dedup key
    // (indicator_key, observed_at, model_version) per migration 0005
    // `onchain_readings_dedup`. Same-day re-run replaces the prior row
    // with the more-recent reading — correct when an earlier run
    // partial-failed and a retry scores successfully.
    await writeOnchainReadings(readings);
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : String(err);
    console.error("[cron] ingest-onchain failed:", err);
  }

  const durationMs = Date.now() - startMs;

  // ---- 5. Audit row (always, even on failure) ----
  //
  // Reuse the Phase 1 `ingest_runs` schema — its columns are generic
  // enough for any cron (indicators_* + snapshots_written). For this
  // endpoint "snapshots_written" doesn't apply (we write raw indicator
  // rows, not composite snapshots); record 0 there and let
  // indicators_success / indicators_failed carry the story.
  try {
    await writeIngestRun({
      model_version: MODEL_VERSION,
      indicators_attempted: ATTEMPTED,
      indicators_success: successCount,
      indicators_failed: failCount,
      snapshots_written: 0,
      error_summary: errorSummary,
      duration_ms: durationMs,
    });
  } catch (auditErr) {
    console.error(
      "[cron] ingest-onchain ingest_runs audit write failed:",
      auditErr,
    );
  }

  // ---- 6. Cache invalidation ----
  //
  // Only invalidate when at least ONE source succeeded — evicting
  // yesterday's good cache in favour of nothing would regress the UX
  // (fresh failure pretending to be fresh success). Blueprint §0.5
  // tenet 1 "silent success, loud failure": we'd rather the dashboard
  // render yesterday's on-chain card with a staleness badge than a
  // blank state.
  if (successCount > 0) {
    revalidateTag(CACHE_TAGS.onchain, { expire: 0 });
  }

  // ---- 6.5. Signal Alignment engine tail (blueprint §4.5, §5 routing) ----
  //
  // Runs even on partial ingestion (signals tolerate null inputs via
  // state:"unknown"). Soft failure — a signals-tail error does NOT
  // return 500; the main on-chain write already succeeded.
  try {
    const supabase = getSupabaseAdminClient();
    const signalInputs = await loadSignalInputs(supabase, today);
    const signalComputation = computeSignals(signalInputs);
    await writeSignalEvents(supabase, today, signalComputation);
    revalidateTag(CACHE_TAGS.signals, { expire: 0 });
  } catch (signalsErr) {
    const msg =
      signalsErr instanceof Error ? signalsErr.message : String(signalsErr);
    console.error("[cron ingest-onchain] signals tail failed:", msg);
    errorSummary = errorSummary
      ? `${errorSummary}; signals_tail: ${msg}`
      : `signals_tail: ${msg}`;
  }

  // ---- Response ----
  const status: "success" | "partial" | "error" =
    errorSummary && successCount === 0
      ? "error"
      : failCount > 0
        ? "partial"
        : "success";

  const httpStatus = status === "error" ? 500 : 200;

  return NextResponse.json(
    {
      status,
      snapshot_date: today,
      model_version: MODEL_VERSION,
      indicators_attempted: ATTEMPTED,
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

/**
 * Bulk-upsert onchain_readings rows. Mirrors `writeIndicatorReadings`
 * from `src/lib/data/snapshot.ts` but targets the on-chain table with
 * its own dedup key (indicator_key, observed_at, model_version) per
 * migration 0005 `onchain_readings_dedup`.
 *
 * Inlined here (rather than exported from snapshot.ts) because this
 * is the first on-chain writer and the cross-file shape is still
 * settling; when the news + technical cron endpoints land (Agents A
 * and C), the three writers can be consolidated into snapshot.ts in
 * a follow-up refactor without touching this cron.
 */
async function writeOnchainReadings(
  rows: TablesInsert<"onchain_readings">[],
): Promise<void> {
  if (rows.length === 0) return;
  const supabase = getSupabaseAdminClient();
  const { error } = await supabase
    .from("onchain_readings")
    .upsert(rows, {
      onConflict: "indicator_key,observed_at,model_version",
    });
  if (error) {
    throw new Error(
      `writeOnchainReadings failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }
}

/**
 * Constant-time comparison of the request's bearer token with
 * `process.env.CRON_SECRET`. Identical contract to the helper in
 * `ingest-macro/route.ts`; duplicated here (2 places < threshold for
 * extraction) to keep each cron route self-contained — extracting
 * would force every future cron to import a shared helper, and the
 * implementation is 20 lines with no behavioural variance.
 */
function verifyCronSecret(
  request: NextRequest,
): { ok: true } | { ok: false; reason: string } {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Fail closed if env var missing — never no-auth the endpoint.
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
