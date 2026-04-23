import "server-only";

import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { verifyCronSecret } from "@/lib/auth/cron-secret";
import { CACHE_TAGS } from "@/lib/data/tags";
import { writeIngestRun } from "@/lib/data/snapshot";
import {
  fetchAlphaVantageNews,
  type AlphaVantageNewsResult,
  type AlphaVantageTickerAggregate,
} from "@/lib/score-engine/sources/alpha-vantage-news";
import { newsSentimentToScore } from "@/lib/score-engine/sources/alpha-vantage-news-parse";
import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Json, TablesInsert } from "@/types/database";

/**
 * News-sentiment cron — blueprint v1.0 §9 Step 7 (Phase C).
 *
 * Source-swap note (2026-04-24): this endpoint was rewired from Finnhub's
 * `/news-sentiment` to Alpha Vantage's `NEWS_SENTIMENT` function because
 * the Finnhub endpoint is paid-only — the production smoke test against
 * the free tier returned `{"error":"You don't have access to this
 * resource."}`. AV's NEWS_SENTIMENT works on the existing free-tier key
 * and delivers per-ticker pre-computed sentiment scores. The Finnhub
 * adapter files (`finnhub.ts`, `finnhub-parse.ts`) intentionally remain
 * in the codebase as a future fallback if we ever upgrade to a paid
 * Finnhub plan.
 *
 * Pipeline (mirrors `ingest-macro` shape):
 *   1. Auth: `Authorization: Bearer ${CRON_SECRET}` constant-time compare.
 *   2. Graceful ALPHA_VANTAGE_API_KEY absence — defensive; the key is
 *      already provisioned at Phase 1, but a Vercel-env regression
 *      should not abort the hourly workflow's sibling steps (onchain +
 *      cnn-fg). Loud-log + return 200.
 *   3. Issue TWO Alpha Vantage NEWS_SENTIMENT calls, each scoping a
 *      subset of the 7 target tickers. AV's NEWS_SENTIMENT has a
 *      ticker-count cap observed around 4-5 (empirical: 7-ticker calls
 *      return items=0). We split 7 tickers into (4, 3):
 *          Call 1: SPY, QQQ, NVDA, AAPL
 *          Call 2: MSFT, GOOGL, AMZN
 *      Sleep 13s between calls for AV's 5/min limit. Budget: 2/25
 *      daily; combined with 19 technical = 21/25, leaving 4 headroom.
 *   4. Merge aggregates from both responses and for each ticker:
 *      compute `newsSentimentToScore((x + 1) * 50)` → write one row to
 *      `news_sentiment` (asset_type='us_equity'). Delete-then-insert
 *      idempotency (same functional-index rationale as before).
 *   5. Write `ingest_runs` audit row summarising per-ticker success/fail.
 *   6. `revalidateTag(CACHE_TAGS.sentiment, { expire: 0 })` if any row
 *      landed — the sentiment card on the dashboard depends on both
 *      this cron and the CNN F&G cron.
 *
 * Ticker scope (blueprint §4.1 US-focused sentiment): SPY, QQQ (broad
 * US indices) + NVDA, AAPL, MSFT, GOOGL, AMZN (5 US large-caps). Phase 2
 * keeps news-sentiment US-focused; crypto and KR-equity sentiment are
 * out of scope until a dedicated feed is added. Kept as a const so the
 * ticker set is grep-visible — silent edits would break the snapshot
 * invariant (§2.2 tenet 2). The (4, 3) split is documented below and
 * must not drift silently: AV's per-call ticker cap was discovered
 * empirically and re-grouping without re-probing will break coverage.
 *
 * Idempotency (same-day re-run safety):
 *   The `news_sentiment` unique index is a FUNCTIONAL index on
 *   `(asset_type, COALESCE(ticker, ''), observed_at, model_version)`
 *   — see migration 0005 line 101. PostgREST's `onConflict` parameter
 *   cannot target a functional index by column names alone, so we
 *   cannot use `.upsert({ onConflict: "..." })`. Instead, for each
 *   ticker we issue a `DELETE` matching the natural key then an
 *   `INSERT`. Stable across retries; worst case leaves a brief
 *   zero-row window on concurrent reruns (cron is sole writer).
 *
 * Failure model:
 *   - One AV call fails (HTTP/rate-limit/timeout) → every ticker in
 *     that group gets a `fetch_status='error'` row with score=50
 *     (neutral fallback — DB column is NOT NULL). The second call
 *     still runs and its tickers may succeed.
 *   - AV returns an article set that doesn't mention a target ticker
 *     → that ticker gets `fetch_status='partial'`, article_count=0,
 *     score=50.
 *   - AV returns valid data → `fetch_status='success'`, score from
 *     relevance-weighted mean.
 *   - ALPHA_VANTAGE_API_KEY unset → logged once, returns 200.
 *   - Supabase writer throws → captured to `ingest_runs.error_summary`
 *     best-effort, handler returns 500 if no rows landed.
 *
 * Runtime:
 *   - `maxDuration = 60` covers 2 × ~2s fetch + 13s sleep + writer
 *     overhead comfortably. The hourly GHA workflow has a shorter
 *     ceiling than the daily technical job.
 *   - Under `cacheComponents: true`, Route Handler bodies are dynamic;
 *     do NOT export `const dynamic`.
 *   - `import "server-only"` prevents ALPHA_VANTAGE_API_KEY /
 *     CRON_SECRET / SUPABASE_SERVICE_ROLE_KEY from leaking to client
 *     bundles.
 *   - No `'use cache'` directive (banned inside Route Handlers).
 *
 * Endpoint: GET /api/cron/ingest-news
 * Scheduled: hourly via `.github/workflows/cron-hourly.yml` (Agent B).
 */

/**
 * US-focused ticker set per blueprint §4.1. Frozen list; silent edits
 * are forbidden (would drift from TICKER_LIST_VERSION). To add or
 * remove a ticker, bump `TICKER_LIST_VERSION` in weights.ts AND re-probe
 * AV's per-call ticker cap to confirm the grouping still works.
 *
 * Group 1 = 4 tickers, Group 2 = 3 tickers. Discovered empirically:
 * 7-ticker AV NEWS_SENTIMENT calls return items=0 (silent hidden cap),
 * while (4, 3) splits return full coverage.
 */
const NEWS_TICKER_GROUP_1: readonly string[] = [
  "SPY",
  "QQQ",
  "NVDA",
  "AAPL",
] as const;
const NEWS_TICKER_GROUP_2: readonly string[] = [
  "MSFT",
  "GOOGL",
  "AMZN",
] as const;
const ALL_NEWS_TICKERS: readonly string[] = [
  ...NEWS_TICKER_GROUP_1,
  ...NEWS_TICKER_GROUP_2,
];

/** `news_sentiment.source_name` label. */
const AV_NEWS_SOURCE_NAME = "alpha_vantage";

/**
 * Sleep between the two AV calls. AV free tier = 5 calls/min → 12s is
 * the strict minimum; 13s gives 1s safety margin. Mirrors the value
 * used in the daily technical cron.
 */
const AV_INTER_CALL_SLEEP_MS = 13_000;

/** Maximum articles to request per call (observed free-tier cap). */
const AV_LIMIT = 50;

/** Max articles to persist on `raw_payload` per ticker (cost cap). */
const RAW_PAYLOAD_SAMPLE_SIZE = 5;

/**
 * Fallback score used when AV returns error/partial/no-mentions and
 * the DB's `news_sentiment.score_0_100` NOT NULL constraint forces a
 * value. The `fetch_status` column remains the authoritative signal of
 * data quality — the UI branches on that, not on the score value.
 * Neutral 50 is the safest placeholder.
 */
const SENTIMENT_FALLBACK_SCORE = 50;

export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  // ---- 1. Auth ----
  const authResult = verifyCronSecret(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  // ---- 2. Graceful ALPHA_VANTAGE_API_KEY absence ----
  // The fetcher throws if the key is unset (config error, not
  // transient). Detect it up front so we can log-once + return 200
  // rather than letting one exception cascade across 7 tickers. The
  // hourly workflow (Agent B) needs a 200 here so its other two steps
  // (onchain + cnn-fg) still run.
  if (!process.env.ALPHA_VANTAGE_API_KEY) {
    const errorSummary =
      "ALPHA_VANTAGE_API_KEY unset — news sentiment skipped this run";
    const durationMs = Date.now() - startMs;

    try {
      await writeIngestRun({
        model_version: MODEL_VERSION,
        indicators_attempted: ALL_NEWS_TICKERS.length,
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
        tickers_attempted: ALL_NEWS_TICKERS.length,
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
  const perTickerErrors: string[] = [];

  try {
    const supabase = getSupabaseAdminClient();

    // ---- 3. Two AV calls with a 13s pace gap ----
    const call1 = await fetchAlphaVantageNews(NEWS_TICKER_GROUP_1, {
      limit: AV_LIMIT,
    });
    await sleep(AV_INTER_CALL_SLEEP_MS);
    const call2 = await fetchAlphaVantageNews(NEWS_TICKER_GROUP_2, {
      limit: AV_LIMIT,
    });

    // ---- 4. Per-ticker write ----
    //
    // Every target ticker appears in exactly one call's `aggregates`
    // map. We iterate the flat list so the write order matches the
    // canonical ticker list (grep-friendly logs).
    for (const ticker of ALL_NEWS_TICKERS) {
      const groupResult = NEWS_TICKER_GROUP_1.includes(ticker) ? call1 : call2;
      const aggregate: AlphaVantageTickerAggregate | undefined =
        groupResult.aggregates[ticker];

      const status = resolveTickerStatus(groupResult, aggregate);
      if (status === "success") {
        successCount++;
      } else {
        failCount++;
        if (groupResult.fetch_status === "error" && groupResult.error) {
          perTickerErrors.push(`${ticker}: ${groupResult.error}`);
        }
      }

      const score = newsSentimentToScore(aggregate?.weightedMeanScore ?? null);

      const row: TablesInsert<"news_sentiment"> = {
        asset_type: "us_equity",
        ticker,
        // DB column is NOT NULL — `newsSentimentToScore` always returns
        // a valid 0-100 number (50 when weighted mean is null), so
        // this satisfies the constraint even for error/partial rows.
        // `fetch_status` is the authoritative signal the UI branches on.
        score_0_100: score,
        article_count: aggregate?.articleCount ?? 0,
        observed_at: today,
        source_name: AV_NEWS_SOURCE_NAME,
        model_version: MODEL_VERSION,
        fetch_status: status,
        raw_payload: serializeTickerAggregate(
          ticker,
          groupResult,
          aggregate ?? null,
        ),
      };

      const written = await writeSentimentRow(supabase, row);
      if (written) {
        snapshotsWritten++;
      } else {
        errorSummary =
          errorSummary ?? `news_sentiment write failed for ${ticker}`;
      }
    }

    // If either AV call failed outright, capture the summary even if
    // some rows landed (the caller can still see full-row coverage
    // with mixed fetch_status values).
    if (perTickerErrors.length > 0 && errorSummary === null) {
      errorSummary = perTickerErrors.join("; ");
    }

    // ---- 5. Cache invalidation ----
    if (snapshotsWritten > 0) {
      revalidateTag(CACHE_TAGS.sentiment, { expire: 0 });
    }
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : String(err);
    console.error("[cron:ingest-news] ingest failed:", err);
  }

  const durationMs = Date.now() - startMs;

  // ---- 6. Audit row ----
  try {
    await writeIngestRun({
      model_version: MODEL_VERSION,
      indicators_attempted: ALL_NEWS_TICKERS.length,
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
      tickers_attempted: ALL_NEWS_TICKERS.length,
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
 * Decide the `fetch_status` to persist for one ticker based on the
 * fetch-level outcome and the per-ticker aggregate.
 *
 * - AV call returned `error` → every ticker in that group is 'error'.
 * - AV call succeeded but the ticker was not mentioned in any article
 *   → 'partial' (distinguishes "no news this cycle" from "upstream
 *   broken"). article_count is 0 in this case.
 * - AV call succeeded AND the ticker has at least one valid mention
 *   → 'success'.
 * - AV call returned `partial` (empty feed) → 'partial' for all tickers.
 */
function resolveTickerStatus(
  groupResult: AlphaVantageNewsResult,
  aggregate: AlphaVantageTickerAggregate | undefined,
): "success" | "partial" | "error" {
  if (groupResult.fetch_status === "error") return "error";
  if (groupResult.fetch_status === "partial") return "partial";
  if (!aggregate || aggregate.articleCount === 0) return "partial";
  return "success";
}

/**
 * Delete-then-insert the given news_sentiment row. Returns `true` on
 * successful insert, `false` on any DB error (already logged).
 *
 * Why not `.upsert({ onConflict: '...' })`? The dedup index on
 * `news_sentiment` is a FUNCTIONAL index over `COALESCE(ticker, '')`
 * (migration 0005 line 101), which PostgREST's `onConflict` cannot
 * target by plain column names.
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
 * Build the JSONB payload persisted on `news_sentiment.raw_payload`.
 *
 * Contains:
 *   - Per-ticker aggregate (weighted mean + article count)
 *   - Fetch-level status + error (for postmortems)
 *   - A small sample of the underlying articles (titles/urls/per-ticker
 *     score) so a postmortem can audit WHICH articles drove the score
 *     without re-fetching AV. Capped at RAW_PAYLOAD_SAMPLE_SIZE to
 *     bound the JSON column size per row.
 */
function serializeTickerAggregate(
  ticker: string,
  groupResult: AlphaVantageNewsResult,
  aggregate: AlphaVantageTickerAggregate | null,
): Json {
  const sampleArticles = groupResult.feed
    .filter((item) =>
      item.ticker_sentiment.some((ts) => ts.ticker === ticker),
    )
    .slice(0, RAW_PAYLOAD_SAMPLE_SIZE)
    .map((item) => {
      const tsEntry = item.ticker_sentiment.find((ts) => ts.ticker === ticker);
      return {
        title: item.title,
        url: item.url,
        time_published: item.time_published,
        source: item.source,
        overall_sentiment_score: item.overall_sentiment_score,
        ticker_relevance: tsEntry?.relevance_score ?? null,
        ticker_sentiment_score: tsEntry?.ticker_sentiment_score ?? null,
        ticker_sentiment_label: tsEntry?.ticker_sentiment_label ?? null,
      };
    });

  return {
    ticker,
    source: AV_NEWS_SOURCE_NAME,
    fetch_status: groupResult.fetch_status,
    fetch_error: groupResult.error ?? null,
    fetched_at: groupResult.fetched_at,
    weighted_mean_score: aggregate?.weightedMeanScore ?? null,
    article_count: aggregate?.articleCount ?? 0,
    sample_articles: sampleArticles,
    sentiment_score_definition:
      groupResult.sentiment_score_definition ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
