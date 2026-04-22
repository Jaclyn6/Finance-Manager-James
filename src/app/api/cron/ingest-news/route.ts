import "server-only";

import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { writeIngestRun } from "@/lib/data/snapshot";
import { finnhubSentimentToScore } from "@/lib/score-engine/sentiment";
import {
  fetchFinnhubSentiment,
  type FinnhubSentimentResult,
} from "@/lib/score-engine/sources/finnhub";
import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json, TablesInsert } from "@/types/database";

/**
 * News-sentiment cron — blueprint v1.0 §9 Step 7 (Phase C).
 *
 * Pipeline (mirrors `ingest-macro` shape):
 *   1. Auth: `Authorization: Bearer ${CRON_SECRET}` constant-time compare.
 *   2. Graceful FINNHUB_API_KEY absence — if the env var is missing,
 *      log once to `ingest_runs` with a descriptive `error_summary` and
 *      return 200 so the hourly workflow's other steps (onchain +
 *      cnn-fg) still run. This is the "silent degradation is evil —
 *      loud degradation that does not block" pattern (plan §0.5 tenet 1).
 *   3. Sequentially fetch Finnhub news-sentiment for the US-focused
 *      ticker list. Finnhub free tier = 60/min; 7 tickers comfortably
 *      fit in one run with safety margin for retries.
 *   4. For each ticker: normalize bullish/bearish percent to a 0-100
 *      sentiment score via `finnhubSentimentToScore` (Step 5 module),
 *      then delete-then-insert a row into `news_sentiment` (same-day
 *      idempotency — see §Idempotency below).
 *   5. Write an `ingest_runs` audit row summarising success/fail counts.
 *
 * Ticker scope (blueprint §4.1 "Finnhub news sentiment + Stock CNN
 * F&G"): SPY, QQQ (broad US indices) + NVDA, AAPL, MSFT, GOOGL, AMZN
 * (5 US large-caps). Phase 2 keeps news-sentiment US-focused; crypto
 * and KR-equity sentiment are out of scope until a dedicated feed is
 * added. Kept as a const so the ticker set is grep-visible — silent
 * edits would break the snapshot invariant (§2.2 tenet 2).
 *
 * Idempotency (same-day re-run safety):
 *   The `news_sentiment` unique index is a FUNCTIONAL index on
 *   `(asset_type, COALESCE(ticker, ''), observed_at, model_version)`
 *   — see migration 0005 line 101. PostgREST's `onConflict` parameter
 *   cannot target a functional index by column names alone, so we
 *   cannot use `.upsert({ onConflict: "..." })` the way ingest-macro
 *   does for `indicator_readings`. Instead, for each ticker we issue
 *   a `DELETE` matching the natural key then an `INSERT`. The two
 *   statements are separate round-trips (no server-side transaction
 *   wrapping in the Supabase REST client), but at the product level
 *   this is fine — the cron is the only writer of these rows, GHA
 *   workflow_dispatch retries are rare, and the natural key is stable
 *   across retries (same date, same ticker, same model_version). Worst
 *   case: a concurrent retry leaves zero rows for a moment, not a
 *   duplicate.
 *
 * Failure model:
 *   - Per-ticker Finnhub failure → one row written with
 *     `fetch_status='error'` and `score_0_100=50` (neutral fallback,
 *     because the DB column is NOT NULL; the status column is the
 *     authoritative signal, not the score value). The cron keeps
 *     going for the remaining tickers.
 *   - Partial Finnhub response (`fetch_status='partial'`, no articles)
 *     → row written with `score_0_100=50` and `fetch_status='partial'`.
 *   - Any writer throws → captured to `ingest_runs.error_summary` best-
 *     effort, handler returns 500.
 *   - FINNHUB_API_KEY unset → logged once, returns 200 (see §2 above).
 *
 * Runtime:
 *   - Under `cacheComponents: true`, Route Handler bodies are dynamic;
 *     do NOT export `const dynamic`.
 *   - `import "server-only"` prevents FINNHUB_API_KEY / CRON_SECRET /
 *     SUPABASE_SERVICE_ROLE_KEY from leaking to client bundles.
 *   - No `'use cache'` directive (banned inside Route Handlers).
 *
 * Endpoint: GET /api/cron/ingest-news
 * Scheduled: hourly via `.github/workflows/cron-hourly.yml` (Agent B).
 */

/**
 * US-focused ticker set per blueprint §4.1. Frozen list; silent edits
 * are forbidden (would drift from TICKER_LIST_VERSION). To add or
 * remove a ticker, bump `TICKER_LIST_VERSION` in weights.ts.
 */
const NEWS_SENTIMENT_TICKERS: readonly string[] = [
  "SPY",
  "QQQ",
  "NVDA",
  "AAPL",
  "MSFT",
  "GOOGL",
  "AMZN",
] as const;

const FINNHUB_SOURCE_NAME = "finnhub";

/**
 * Fallback score used when Finnhub returns error/partial and the DB's
 * `news_sentiment.score_0_100` NOT NULL constraint forces a value.
 * The `fetch_status` column remains the authoritative signal of data
 * quality — the UI branches on that, not on the score value. Neutral
 * 50 is the safest placeholder (not 0 = extreme bearish, not 100 =
 * extreme bullish).
 */
const SENTIMENT_FALLBACK_SCORE = 50;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  // ---- 1. Auth ----
  const authResult = verifyCronSecret(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // ---- 2. Graceful FINNHUB_API_KEY absence ----
  // The fetcher throws if the key is unset (config error, not
  // transient). Detect it up front so we can log-once + return 200
  // rather than letting one exception cascade across 7 tickers. The
  // hourly workflow (Agent B) needs a 200 here so its other two steps
  // (onchain + cnn-fg) still run.
  if (!process.env.FINNHUB_API_KEY) {
    const errorSummary =
      "FINNHUB_API_KEY unset — news sentiment skipped this run";
    const durationMs = Date.now() - startMs;

    try {
      await writeIngestRun({
        model_version: MODEL_VERSION,
        indicators_attempted: NEWS_SENTIMENT_TICKERS.length,
        indicators_success: 0,
        indicators_failed: 0,
        snapshots_written: 0,
        error_summary: errorSummary,
        duration_ms: durationMs,
      });
    } catch (auditErr) {
      // Audit write failing here is non-fatal — the whole point of
      // this branch is graceful degradation. Surface to server logs
      // but don't escalate to the HTTP response.
      console.error("[cron:ingest-news] audit write failed:", auditErr);
    }

    return NextResponse.json(
      {
        status: "skipped",
        snapshot_date: today,
        model_version: MODEL_VERSION,
        tickers_attempted: NEWS_SENTIMENT_TICKERS.length,
        tickers_success: 0,
        tickers_failed: 0,
        snapshots_written: 0,
        duration_ms: durationMs,
        error_summary: errorSummary,
      },
      { status: 200 },
    );
  }

  let successCount = 0;
  let failCount = 0;
  let snapshotsWritten = 0;
  let errorSummary: string | null = null;

  try {
    const supabase = getSupabaseAdminClient();

    // ---- 3. Sequential Finnhub fetch + normalize + write ----
    //
    // Sequential — NOT Promise.all — to stay well under the 60/min
    // free-tier cap with burst safety. 7 calls @ ~200ms each ≈ 1.5s
    // total, comfortably within a single Route Handler budget.
    for (const ticker of NEWS_SENTIMENT_TICKERS) {
      let result: FinnhubSentimentResult;
      try {
        result = await fetchFinnhubSentiment(ticker);
      } catch (fetchErr) {
        // `fetchFinnhubSentiment` only throws on env-missing (already
        // handled above) — defensive catch here in case the contract
        // drifts later. Treat as ticker-level failure; don't abort
        // the whole run.
        failCount++;
        const message =
          fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
        console.error(
          `[cron:ingest-news] fetchFinnhubSentiment threw for ${ticker}:`,
          message,
        );

        const errorRow: TablesInsert<"news_sentiment"> = {
          asset_type: "us_equity",
          ticker,
          score_0_100: SENTIMENT_FALLBACK_SCORE,
          article_count: 0,
          observed_at: today,
          source_name: FINNHUB_SOURCE_NAME,
          model_version: MODEL_VERSION,
          fetch_status: "error",
          raw_payload: { error: message } as Json,
        };

        const written = await writeSentimentRow(supabase, errorRow);
        if (written) snapshotsWritten++;
        continue;
      }

      const normalized = finnhubSentimentToScore(
        result.bullishPercent,
        result.bearishPercent,
        result.articleCount,
      );

      // A null normalization means "sentiment category missing" — the
      // Step 5 combiner will propagate it upward to the composite.
      // We still write a row (audit trail) but flag fetch_status
      // accordingly.
      const status: "success" | "partial" | "error" =
        result.fetch_status === "success" && normalized !== null
          ? "success"
          : result.fetch_status === "error"
            ? "error"
            : "partial";

      if (status === "success") {
        successCount++;
      } else {
        failCount++;
      }

      const row: TablesInsert<"news_sentiment"> = {
        asset_type: "us_equity",
        ticker,
        // DB column is NOT NULL — fall back to neutral 50 when the
        // normalizer returns null. `fetch_status` is the authoritative
        // signal that the UI branches on.
        score_0_100: normalized ?? SENTIMENT_FALLBACK_SCORE,
        article_count: result.articleCount,
        observed_at: today,
        source_name: FINNHUB_SOURCE_NAME,
        model_version: MODEL_VERSION,
        fetch_status: status,
        // Persist the raw Finnhub result so postmortems can audit why
        // a ticker scored the way it did without re-fetching.
        raw_payload: serializeFinnhubResult(result),
      };

      const written = await writeSentimentRow(supabase, row);
      if (written) snapshotsWritten++;
      else
        errorSummary =
          errorSummary ?? `news_sentiment write failed for ${ticker}`;
    }
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : String(err);
    console.error("[cron:ingest-news] ingest failed:", err);
  }

  const durationMs = Date.now() - startMs;

  // ---- 4. Audit row ----
  try {
    await writeIngestRun({
      model_version: MODEL_VERSION,
      indicators_attempted: NEWS_SENTIMENT_TICKERS.length,
      indicators_success: successCount,
      indicators_failed: failCount,
      snapshots_written: snapshotsWritten,
      error_summary: errorSummary,
      duration_ms: durationMs,
    });
  } catch (auditErr) {
    console.error(
      "[cron:ingest-news] ingest_runs audit write failed:",
      auditErr,
    );
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
      tickers_attempted: NEWS_SENTIMENT_TICKERS.length,
      tickers_success: successCount,
      tickers_failed: failCount,
      snapshots_written: snapshotsWritten,
      duration_ms: durationMs,
      error_summary: errorSummary,
    },
    { status: httpStatus },
  );
}

/**
 * Delete-then-insert the given news_sentiment row. Returns `true` on
 * successful insert, `false` on any DB error (already logged).
 *
 * Why not `.upsert({ onConflict: '...' })`? The dedup index on
 * `news_sentiment` is a FUNCTIONAL index over `COALESCE(ticker, '')`
 * (migration 0005 line 101), which PostgREST's `onConflict` cannot
 * target by plain column names — it would emit `ON CONFLICT
 * (asset_type, ticker, ...)` and fail because no matching constraint
 * exists. The delete-then-insert pattern is clear, works for both
 * null and non-null ticker, and stays idempotent across retries.
 */
async function writeSentimentRow(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  row: TablesInsert<"news_sentiment">,
): Promise<boolean> {
  const { error: deleteErr } = await supabase
    .from("news_sentiment")
    .delete()
    .eq("asset_type", row.asset_type)
    .eq("ticker", row.ticker ?? "")
    .eq("observed_at", row.observed_at)
    .eq("model_version", row.model_version);

  if (deleteErr) {
    console.error(
      `[cron:ingest-news] news_sentiment delete failed for ${row.ticker ?? "(null)"}:`,
      deleteErr.message,
    );
    return false;
  }

  const { error: insertErr } = await supabase
    .from("news_sentiment")
    .insert(row);

  if (insertErr) {
    console.error(
      `[cron:ingest-news] news_sentiment insert failed for ${row.ticker ?? "(null)"}:`,
      insertErr.message,
    );
    return false;
  }
  return true;
}

/**
 * Serialise {@link FinnhubSentimentResult} into the JSONB shape
 * persisted on `news_sentiment.raw_payload`. The parser's TS shape
 * already matches Json; we widen the cast at the boundary so the DB
 * column's `Json | null` type is happy without a double-cast at every
 * call site.
 */
function serializeFinnhubResult(result: FinnhubSentimentResult): Json {
  return {
    ticker: result.ticker,
    bullishPercent: result.bullishPercent,
    bearishPercent: result.bearishPercent,
    companyNewsScore: result.companyNewsScore,
    articleCount: result.articleCount,
    fetch_status: result.fetch_status,
    error: result.error ?? null,
    fetched_at: result.fetched_at,
  };
}

/**
 * Constant-time bearer-token compare. Identical contract to the
 * `ingest-macro` route's verifier — kept duplicated rather than
 * hoisted to a shared helper so each cron endpoint stays self-auditable
 * (blueprint §12 anti-pattern: no endpoint may silently lose its auth
 * by a shared-helper regression).
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
