import "server-only";

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import {
  invalidateChangelogCache,
  invalidateMacroSnapshotCache,
  writeCompositeSnapshot,
  writeIndicatorReadings,
  writeIngestRun,
  writeScoreChangelog,
} from "@/lib/data/snapshot";
import { computeComposite } from "@/lib/score-engine/composite";
import { computeCompositeV2 } from "@/lib/score-engine/composite-v2";
import { fetchFredSeries } from "@/lib/score-engine/indicators/fred";
import { computeZScore, zScoreTo0100 } from "@/lib/score-engine/normalize";
import { computeTopMovers } from "@/lib/score-engine/top-movers";
import type {
  CategoryContribution,
  CategoryName,
  CompositeResult,
  IndicatorScore,
} from "@/lib/score-engine/types";
import {
  INDICATOR_CONFIG,
  INDICATOR_KEYS,
  MODEL_VERSION,
  PHASE2_ACTIVE_FRED_SIGNAL_KEYS,
  PHASE2_FRED_REGIONAL_OVERLAY,
  PHASE2_FRED_REGIONAL_OVERLAY_KEYS,
  PHASE2_FRED_SIGNAL_INPUTS,
} from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { scoreToBand } from "@/lib/utils/score-band";
import { Constants, type Json, type TablesInsert } from "@/types/database";

/**
 * Ingest cron — blueprint v2.2 §9 Step 9 (Phase 1) + Phase 2 §9 Step 7 extension.
 *
 * Pipeline (from blueprint §3):
 *   1. Authenticate `Authorization: Bearer ${CRON_SECRET}`
 *   2. Fetch all 7 INDICATOR_CONFIG FRED series in parallel (macro
 *      composite inputs).
 *   3. Normalize (Z-Score over 5y -> clamp 0-100).
 *   3.5a. (Phase 2) Fetch PHASE2_ACTIVE_FRED_SIGNAL_KEYS (ICSA, WDTGAL)
 *         — raw-only, no 0-100 mapping. Stored in indicator_readings for
 *         the Step 7.5 signal engine to consume.
 *   3.5b. (Phase 2) Fetch PHASE2_FRED_REGIONAL_OVERLAY_KEYS (DTWEXBGS,
 *         DEXKOUS), z-score each, weighted-average to produce the
 *         kr_equity regional_overlay category score.
 *   4. Write indicator_readings (one row per series -- success OR error).
 *   5. For each asset_type in asset_type_enum:
 *      a. computeComposite (macro) -> feeds category score.
 *      b. computeCompositeV2 (with regional_overlay for kr_equity only)
 *         -> write composite_snapshots.
 *      c. Look up prior snapshot -> build changelog delta -> upsert
 *         score_changelog.
 *   6. Write ingest_runs audit row.
 *   7. Invalidate macro-snapshot + changelog cache tags.
 *
 * Failure model (blueprint §3 + PRD §8.1 "partial data > no data"):
 *   - One indicator's HTTP / parse error -> that indicator's reading row
 *     gets `fetch_status='error'`, its score is excluded from composites.
 *     Composites with at least 1 good indicator still get written and
 *     marked `fetch_status='partial'`.
 *   - All indicators fail -> no composites written, `ingest_runs` records
 *     the failure, caches NOT invalidated (stale previous-day data is
 *     safer than "today has no data").
 *   - Any writer throws -> the error is captured into `ingest_runs`
 *     best-effort, the handler returns 500. Upserts make a retry safe.
 *
 * Runtime notes:
 *   - Under `cacheComponents: true`, Route Handler bodies are already
 *     dynamic; do NOT export `const dynamic = "force-dynamic"`.
 *   - `'use cache'` is forbidden inside a Route Handler body; we don't
 *     use it. All reads (for prior-day comparison) go through the
 *     admin client directly with no cache directive.
 *   - `import "server-only"` guards against import-chain leakage of
 *     CRON_SECRET / SUPABASE_SERVICE_ROLE_KEY / FRED_API_KEY to client
 *     bundles.
 *
 * Endpoint: GET /api/cron/ingest-macro
 * Scheduled: daily 06:00 UTC via `vercel.json`.
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
  let snapshotsWritten = 0;
  let errorSummary: string | null = null;

  try {
    // ---- 2. Fetch all FRED series in parallel ----
    const fetches = await Promise.all(
      INDICATOR_KEYS.map((key) =>
        fetchFredSeries(key, {
          windowYears: INDICATOR_CONFIG[key].windowYears,
        }).then((result) => ({ key, result })),
      ),
    );

    // ---- 3. Normalize + build indicator_readings ----
    const readings: TablesInsert<"indicator_readings">[] = [];
    const scoredIndicators: IndicatorScore[] = [];

    for (const { key, result } of fetches) {
      const config = INDICATOR_CONFIG[key];

      if (result.fetch_status !== "success" || !result.latest) {
        failCount++;
        readings.push({
          indicator_key: key,
          model_version: MODEL_VERSION,
          observed_at: result.latest?.date ?? today,
          source_name: config.sourceName,
          source_url: config.sourceUrl,
          frequency: config.frequency,
          window_used: `${config.windowYears}y`,
          fetch_status: result.fetch_status === "error" ? "error" : "partial",
          value_raw: null,
          value_normalized: null,
          score_0_100: null,
          // Persist the error detail into raw_payload so postmortems
          // can read why a series failed without grep'ing Vercel logs.
          raw_payload: { error: result.error ?? "unknown" } as Json,
        });
        continue;
      }

      // result.latest.value is non-null by parseFredResponse's invariant.
      const rawValue = result.latest.value as number;
      const zScore = computeZScore(result.window, rawValue);
      const score = zScoreTo0100(zScore, config.inverted);
      successCount++;

      readings.push({
        indicator_key: key,
        model_version: MODEL_VERSION,
        observed_at: result.latest.date,
        source_name: config.sourceName,
        source_url: config.sourceUrl,
        frequency: config.frequency,
        window_used: `${config.windowYears}y`,
        fetch_status: "success",
        value_raw: rawValue,
        value_normalized: Number.isFinite(zScore) ? zScore : null,
        score_0_100: score,
      });

      scoredIndicators.push({
        key,
        score0to100: score,
        weights: config.weights,
      });
    }

    // ---- 3.5a. Fetch + persist PHASE 2 FRED signal-only inputs ----
    //
    // ICSA + WDTGAL feed the Signal Alignment engine at Step 7.5, not
    // the composite. We fetch them here so they land in
    // `indicator_readings` alongside the INDICATOR_CONFIG series (one
    // ingest run = one consistent slice of FRED state). They carry:
    //   - `value_raw`: the raw observation (signals compute thresholds
    //     directly on this — no 0-100 mapping).
    //   - `score_0_100`: NULL (blueprint §4.5 tenet 1 — a category
    //     that isn't a composite input must not synthesize a score).
    //   - `fetch_status`: 'success' / 'error' / 'partial' as usual, so
    //     Step 7.5 can skip any signal whose input row is stale.
    //
    // Fetch failures here DO NOT count toward successCount / failCount
    // — those track composite-input indicators only, because the
    // composite-v2 pipeline's success story is about the 7-FRED macro
    // composite. Signal-input fetch errors are logged to their
    // respective rows; the signal engine at Step 7.5 handles the
    // null-propagation story.
    const signalFetches = await Promise.all(
      PHASE2_ACTIVE_FRED_SIGNAL_KEYS.map((key) =>
        fetchFredSeries(key, {
          windowYears: PHASE2_FRED_SIGNAL_INPUTS[key].windowYears,
        }).then((result) => ({ key, result })),
      ),
    );

    for (const { key, result } of signalFetches) {
      const config = PHASE2_FRED_SIGNAL_INPUTS[key];
      const rawValue = result.latest?.value ?? null;
      readings.push({
        indicator_key: key,
        model_version: MODEL_VERSION,
        observed_at: result.latest?.date ?? today,
        source_name: config.sourceName,
        source_url: config.sourceUrl,
        frequency: config.frequency,
        window_used: `${config.windowYears}y`,
        fetch_status:
          result.fetch_status === "success" && rawValue !== null
            ? "success"
            : result.fetch_status === "error"
              ? "error"
              : "partial",
        value_raw: rawValue,
        value_normalized: null,
        // Signal-only inputs deliberately leave score_0_100 null. The
        // Step 7.5 signal engine computes its thresholds on the raw
        // value; synthesizing a 0-100 score here would invite someone
        // to fold it into the composite (blueprint §4.5 violation).
        score_0_100: null,
        raw_payload:
          result.fetch_status !== "success"
            ? ({ error: result.error ?? "unknown" } as Json)
            : null,
      });
    }

    // ---- 3.5b. Fetch + score PHASE 2 regional_overlay inputs (KR) ----
    //
    // DTWEXBGS (Broad dollar index) + DEXKOUS (USD/KRW) feed the
    // `regional_overlay` composite category for kr_equity only (plan
    // §0.2 #3, blueprint §4.2 row 2). Both series:
    //   - fetched + z-scored over 5y (same normalization as the 7
    //     INDICATOR_CONFIG series);
    //   - individually scored to 0-100 via zScoreTo0100 with
    //     inverted=false (higher = worse for KR per plan §0.2 #3);
    //   - averaged with the 0.5 / 0.5 weights from
    //     PHASE2_FRED_REGIONAL_OVERLAY to produce a single category
    //     score handed to computeCompositeV2 below.
    //
    // Individual readings are still written to `indicator_readings`
    // with their own score_0_100 so the UI's category drill-down can
    // explain WHY regional_overlay moved (same pattern as the 7 macro
    // FRED series informing the macro category via macroComposite.contributing).
    const overlayFetches = await Promise.all(
      PHASE2_FRED_REGIONAL_OVERLAY_KEYS.map((key) =>
        fetchFredSeries(key, {
          windowYears: PHASE2_FRED_REGIONAL_OVERLAY[key].windowYears,
        }).then((result) => ({ key, result })),
      ),
    );

    // Per-series 0-100 scores. null-entries are preserved so the
    // weighted-average step can skip them and renormalize over
    // whichever series succeeded.
    const overlayScores: Array<{ key: string; score: number; weight: number }> =
      [];

    for (const { key, result } of overlayFetches) {
      const config = PHASE2_FRED_REGIONAL_OVERLAY[key];

      if (result.fetch_status !== "success" || !result.latest) {
        readings.push({
          indicator_key: key,
          model_version: MODEL_VERSION,
          observed_at: result.latest?.date ?? today,
          source_name: config.sourceName,
          source_url: config.sourceUrl,
          frequency: config.frequency,
          window_used: `${config.windowYears}y`,
          fetch_status: result.fetch_status === "error" ? "error" : "partial",
          value_raw: null,
          value_normalized: null,
          score_0_100: null,
          raw_payload: { error: result.error ?? "unknown" } as Json,
        });
        continue;
      }

      const rawValue = result.latest.value as number;
      const zScore = computeZScore(result.window, rawValue);
      const score = zScoreTo0100(zScore, config.inverted);

      readings.push({
        indicator_key: key,
        model_version: MODEL_VERSION,
        observed_at: result.latest.date,
        source_name: config.sourceName,
        source_url: config.sourceUrl,
        frequency: config.frequency,
        window_used: `${config.windowYears}y`,
        fetch_status: "success",
        value_raw: rawValue,
        value_normalized: Number.isFinite(zScore) ? zScore : null,
        score_0_100: score,
      });

      overlayScores.push({ key, score, weight: config.weight });
    }

    // Weighted average across present series. If both series failed,
    // regional_overlay stays null and computeCompositeV2 will add it
    // to missingCategories (loud degradation, blueprint §4.5 tenet 1).
    // If one succeeded, the single score becomes the category score
    // (renormalizing 0.5 → 1.0). This mirrors computeCompositeV2's
    // own null-propagation policy one layer down.
    const overlayWeightSum = overlayScores.reduce(
      (acc, s) => acc + s.weight,
      0,
    );
    const krRegionalOverlayScore: number | null =
      overlayWeightSum > 0
        ? overlayScores.reduce(
            (acc, s) => acc + (s.score * s.weight) / overlayWeightSum,
            0,
          )
        : null;

    // ---- 4. Write readings (single round-trip, upsert on dedup idx) ----
    await writeIndicatorReadings(readings);

    // ---- 5. Composite + changelog per asset_type ----
    // Skip composite writes entirely if zero indicators succeeded --
    // writing 5 rows of score=50 neutral-fallback would be worse than
    // leaving yesterday's data visible with a staleness badge.
    if (successCount === 0) {
      errorSummary = `all ${INDICATOR_KEYS.length} indicators failed; composites not written`;
    } else {
      const compositeStatus: "success" | "partial" =
        failCount === 0 ? "success" : "partial";

      const assetTypes = Constants.public.Enums.asset_type_enum;
      const supabase = getSupabaseAdminClient();

      for (const assetType of assetTypes) {
        // Phase 1 flat composite: weighted sum of 7 FRED indicators.
        // At v2 this result IS the "macro category score". The
        // indicator-level `contributing` map is preserved inside the
        // v2 nested shape so the dashboard can still show which FRED
        // series moved the score.
        const macroComposite = computeComposite(scoredIndicators, assetType);

        // Wrap the macro-only result in the v2 composite.
        //
        // - `technical` / `onchain` / `sentiment` / `regional_overlay`
        //   are null at Step 6 — they come online via Steps 7-8 (the
        //   technical / on-chain / sentiment cron endpoints). Null-
        //   propagation + renormalization in computeCompositeV2 means
        //   the v2 composite equals the macro score exactly while
        //   those four are missing, then gradually shifts toward the
        //   §4.2 blend as each source lands.
        //
        // - `valuation` is pinned to neutral 50 for asset types that
        //   carry a valuation weight (us_equity, global_etf, common).
        //   Phase 3 replaces the pin with a real Shiller-P/E-class
        //   module (blueprint §4.4 trade-off 7). Pinning (rather than
        //   null) prevents the valuation weight from being silently
        //   removed via renormalization; keeping it in the weighted
        //   sum at a neutral score preserves the blueprint §4.1
        //   capped-sentiment invariant (sentiment can drag the
        //   composite by at most its prescribed 10 pts, not 20).
        const pinValuation =
          assetType === "us_equity" ||
          assetType === "global_etf" ||
          assetType === "common";
        // `regional_overlay` only applies to kr_equity (blueprint §4.2
        // — other asset types have no weight for it, so passing non-
        // null here would be silently ignored by computeCompositeV2's
        // not-applicable guard). For kr_equity, pass the averaged
        // DTWEXBGS+DEXKOUS score computed at §3.5b; a null there
        // lands in `missingCategories` and triggers the amber chip.
        const compositeV2 = computeCompositeV2(
          {
            macro: macroComposite.score0to100,
            technical: null,
            onchain: null,
            sentiment: null,
            valuation: pinValuation ? 50 : null,
            regional_overlay:
              assetType === "kr_equity" ? krRegionalOverlayScore : null,
          },
          assetType,
        );

        // Nest the Phase 1 indicator-level breakdown under macro so
        // the JSONB preserves drill-down. Shape per blueprint §4.4:
        //   { macro: { score, weight, contribution, indicators: {...} } }
        // v1.0.0 rows in the same column are FLAT; model_version
        // discriminates — UI reader (Agent B + Step 8) branches on it.
        const contributingForDb: Partial<
          Record<CategoryName, CategoryContribution>
        > = { ...compositeV2.contributing };
        if (contributingForDb.macro) {
          contributingForDb.macro = {
            ...contributingForDb.macro,
            indicators: macroComposite.contributing,
          };
        }

        const band = scoreToBand(compositeV2.score0to100);

        await writeCompositeSnapshot({
          asset_type: assetType,
          snapshot_date: today,
          score_0_100: compositeV2.score0to100,
          band: band.label,
          model_version: MODEL_VERSION,
          contributing_indicators: contributingForDb as unknown as Json,
          fetch_status: compositeStatus,
        });
        snapshotsWritten++;

        // Prior snapshot lookup -- use admin client directly (NOT the
        // cached reader), because we just wrote today's row and the
        // cache hasn't been invalidated yet. We want the most recent
        // PRIOR row strictly earlier than `today`.
        const { data: priorRows, error: priorErr } = await supabase
          .from("composite_snapshots")
          .select("*")
          .eq("asset_type", assetType)
          .eq("model_version", MODEL_VERSION)
          .lt("snapshot_date", today)
          .order("snapshot_date", { ascending: false })
          .limit(1);

        if (priorErr) {
          // Changelog is a nice-to-have; don't let its failure abort
          // the whole ingest. Log and move on.
          console.error(
            `[cron] prior-snapshot lookup failed for ${assetType}:`,
            priorErr.message,
          );
          continue;
        }

        const prior = priorRows?.[0];
        if (!prior) {
          // First-ever snapshot for this asset_type+model_version.
          // No delta to compute; skip changelog.
          continue;
        }

        // Top-movers operate at the INDICATOR level (FRED series), not
        // the category level — a user watching "score moved +3 today"
        // wants to know which FRED series drove it, not "macro
        // category moved". Unpack both sides' macro.indicators blob
        // before diffing.
        //
        // Prior row's contributing_indicators is v2 nested (we just
        // filtered priorRows on MODEL_VERSION === 'v2.0.0'), so the
        // macro indicator breakdown lives under `.macro.indicators`.
        // Defensive extractor tolerates malformed JSONB.
        const priorMacroIndicators = extractMacroIndicators(
          prior.contributing_indicators,
        );

        const previousBand = prior.band;
        const currentBand = band.label;
        const topMovers = computeTopMovers(
          macroComposite.contributing,
          priorMacroIndicators,
        );

        await writeScoreChangelog({
          asset_type: assetType,
          change_date: today,
          model_version: MODEL_VERSION,
          current_score: compositeV2.score0to100,
          current_band: currentBand,
          previous_score: prior.score_0_100,
          previous_band: previousBand,
          delta: compositeV2.score0to100 - prior.score_0_100,
          band_changed: previousBand !== currentBand,
          top_movers: topMovers as unknown as Json,
        });
      }
    }
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : String(err);
    console.error("[cron] ingest failed:", err);
  }

  const durationMs = Date.now() - startMs;

  // ---- 6. Audit row (always, even on failure) ----
  try {
    await writeIngestRun({
      model_version: MODEL_VERSION,
      indicators_attempted: INDICATOR_KEYS.length,
      indicators_success: successCount,
      indicators_failed: failCount,
      snapshots_written: snapshotsWritten,
      error_summary: errorSummary,
      duration_ms: durationMs,
    });
  } catch (auditErr) {
    // If even the audit write fails, the original error (if any) still
    // takes precedence -- surface it in the HTTP response. Don't throw
    // from this handler after this point.
    console.error("[cron] ingest_runs audit write failed:", auditErr);
  }

  // ---- 7. Cache invalidation (only when we wrote something new) ----
  if (snapshotsWritten > 0) {
    invalidateMacroSnapshotCache();
    invalidateChangelogCache();
  }

  // ---- Response ----
  const status: "success" | "partial" | "error" =
    errorSummary && snapshotsWritten === 0
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
      indicators_attempted: INDICATOR_KEYS.length,
      indicators_success: successCount,
      indicators_failed: failCount,
      snapshots_written: snapshotsWritten,
      duration_ms: durationMs,
      error_summary: errorSummary,
    },
    { status: httpStatus },
  );
}

/**
 * Pulls the indicator-level contribution map out of a v2-nested
 * `composite_snapshots.contributing_indicators` JSONB blob.
 *
 * v2 shape: `{ macro: { score, weight, contribution, indicators: {
 *   FEDFUNDS: {...}, ... } } }`. This extractor walks down to the
 * nested `indicators` object so `computeTopMovers` can diff today's
 * indicator-level breakdown against yesterday's — otherwise top-
 * movers would see a single "macro" key moving by its full
 * contribution, which is useless signal.
 *
 * Returns `null` on any shape mismatch; `computeTopMovers` already
 * tolerates a null prior (treats all current keys as new).
 */
function extractMacroIndicators(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const macro = (raw as Record<string, unknown>).macro;
  if (!macro || typeof macro !== "object" || Array.isArray(macro)) return null;
  const indicators = (macro as Record<string, unknown>).indicators;
  if (!indicators || typeof indicators !== "object" || Array.isArray(indicators)) {
    return null;
  }
  return indicators as CompositeResult["contributing"];
}

/**
 * Constant-time comparison of the request's bearer token with
 * `process.env.CRON_SECRET`. Both are UTF-8 strings; timingSafeEqual
 * requires equal-length buffers, so length is checked first.
 *
 * The timing attack surface is small (family-private cron, rotating
 * secret), but the constant-time compare is two lines and removes the
 * theoretical concern entirely.
 */
function verifyCronSecret(
  request: NextRequest,
): { ok: true } | { ok: false; reason: string } {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // If the env var is missing, reject ALL requests rather than
    // no-auth'ing the endpoint. Fail closed.
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
