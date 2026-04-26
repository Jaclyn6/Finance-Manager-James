import "server-only";

import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { verifyCronSecret } from "@/lib/auth/cron-secret";
import {
  loadSignalInputs,
  writeSignalEvents,
} from "@/lib/data/signals";
import { CACHE_TAGS } from "@/lib/data/tags";
import { fetchDailyBars } from "@/lib/score-engine/sources/daily-bar-fetcher";
import type {
  DailyBar,
  DailyBarSeries,
} from "@/lib/score-engine/sources/daily-bar-types";
import { computeSignals } from "@/lib/score-engine/signals";
import {
  bollingerBands,
  bollingerToScore,
  disparity,
  disparityToScore,
  macdSeries,
  macdToScore,
  rsi,
  rsiToScore,
  simpleMovingAverage,
} from "@/lib/score-engine/technical";
import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, Json, TablesInsert } from "@/types/database";

import {
  ALPHA_VANTAGE_SLEEP_MS,
  INDICATOR_KEYS,
  TICKER_REGISTRY,
  type TickerRegistryEntry,
} from "./ticker-registry";

type FetchStatus = Database["public"]["Enums"]["fetch_status_enum"];
type TechnicalReadingInsert = TablesInsert<"technical_readings">;
type PriceReadingInsert = TablesInsert<"price_readings">;

/**
 * Phase 2 Step 7 technical-ingest cron.
 *
 * Pipeline (blueprint §3 + §9 Step 7):
 *   1. Authenticate `Authorization: Bearer ${CRON_SECRET}`
 *   2. For each of the 12 AV tickers (from {@link TICKER_REGISTRY}):
 *      a. Fetch daily bars from Alpha Vantage TIME_SERIES_DAILY.
 *      b. Derive closes[] in chronological ascending order.
 *      c. Compute RSI(14), MACD(12,26,9), MA(50), MA(200),
 *         Bollinger(20,2), Disparity and map each to a 0-100 score
 *         via the blueprint §4.3 normalizers.
 *      d. Write one row per indicator into `technical_readings`.
 *      e. Upsert the most recent bar into `price_readings` — shared
 *         fetch, two writes (blueprint §3.3 + §7.4 comment: price
 *         history is visualization-only, but we piggyback on the
 *         AV fetch to avoid burning a second ~12-call quota).
 *      f. sleep(13_000ms) — Alpha Vantage free tier is 5/min.
 *   3. Write `ingest_runs` audit row (always, even on partial failure).
 *   4. `revalidateTag(CACHE_TAGS.technical, { expire: 0 })` and
 *      `revalidateTag(CACHE_TAGS.prices, { expire: 0 })` if any rows
 *      landed.
 *
 * Failure model (blueprint §3 + PRD §8.1 "partial data > no data"):
 *   - One ticker's HTTP / parse error → all 6 of that ticker's rows
 *     get `fetch_status='error'`, value/score columns NULL, and the
 *     loop moves to the next ticker (never throws).
 *   - Insufficient closes (e.g. fewer than 26 for MACD warmup):
 *     the affected indicator rows are written with `fetch_status =
 *     'partial'`, value/score NULL, while other indicators that CAN
 *     compute with the available closes still get scored rows. This
 *     matches the "write NULL rather than skip" rule in the Agent A
 *     spec so the dashboard reader can render a definitive "waiting
 *     on history" state instead of an ambiguous missing row.
 *   - MA(200) and Disparity (which depends on MA200) are STRUCTURALLY
 *     null on the free Alpha Vantage tier as of 2026-04-25 — AV moved
 *     `outputsize=full` behind a paid plan, leaving free callers with
 *     100-bar `compact` responses that can't form a 200-bar SMA. Both
 *     rows are written with `fetch_status='partial'` per the rule
 *     above. Blueprint §2.2 tenet 1 ("null-propagation") makes the
 *     composite engine tolerate this without crashing.
 *   - Supabase writer throw → captured into ingest_runs.error_summary
 *     best-effort; handler returns 500.
 *
 * Runtime notes:
 *   - `maxDuration = 300` matches Vercel Fluid Compute's default cap.
 *     12 × 13s ≈ 156s of pure sleeps, plus fetch latency (~180s total).
 *   - `import "server-only"` guards ALPHA_VANTAGE_API_KEY /
 *     SUPABASE_SERVICE_ROLE_KEY / CRON_SECRET from client bundles.
 *   - No `cookies()` / `headers()` / `connection()` calls —
 *     cacheComponents sees this as pure dynamic.
 *   - No `export const dynamic = "force-dynamic"` (Route Handlers under
 *     `cacheComponents: true` are already dynamic by default).
 *
 * Endpoint: `GET /api/cron/ingest-technical`
 * Scheduled: `0 22 * * *` UTC via `.github/workflows/cron-technical.yml`
 *
 * Single-batch design (2026-04-25): an earlier C2 split partitioned
 * the registry into `?batch=1|2` halves to dodge the Vercel Hobby
 * 300s `maxDuration` ceiling when the registry held 19 tickers. After
 * the KR carve-out (see ticker-registry.ts header) the registry is 12
 * tickers — 11 × 13s sleeps + fetches ≈ 180s total — so the split is
 * unnecessary and the route reverts to a single sequential walk over
 * the full {@link TICKER_REGISTRY}.
 */
export const maxDuration = 300;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  // ---- 1. Auth ----
  const authResult = verifyCronSecret(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const supabase = getSupabaseAdminClient();

  // Weekend short-circuit (Phase 3.0.1 hotfix). On Sat/Sun the upstream
  // markets are closed and AV/Twelve Data return empty bars by design.
  // Writing `fetch_status='error'` rows on those days makes the
  // aggregator pick a stale-but-newer null row over Friday's good
  // data, surfacing as "데이터 부족" on the dashboard. Skip the write
  // pipeline entirely so `loadSignalInputs` / category aggregators
  // naturally fall back to Friday's row via their existing
  // `ORDER BY observed_at DESC LIMIT 1` paths. The signal recompute
  // step is also skipped — Friday's `signal_events` row remains
  // authoritative through the weekend.
  //
  // Only weekday detection here; US/KR market-holiday calendar is
  // tracked as a follow-up backlog item (would currently still write
  // null rows on e.g. July 4 and silence the Friday data the same way).
  const todayDow = new Date().getUTCDay(); // 0=Sun, 6=Sat
  const isWeekend = todayDow === 0 || todayDow === 6;

  let tickersAttempted = 0;
  let tickersSuccess = 0;
  let tickersFailed = 0;
  let technicalRowsWritten = 0;
  let priceRowsWritten = 0;
  let errorSummary: string | null = null;
  const perTickerErrors: string[] = [];

  if (isWeekend) {
    // Audit row still written so cron health monitoring sees the
    // green tick, but the pipeline is a deliberate no-op.
    const durationMs = Date.now() - startMs;
    try {
      await supabase.from("ingest_runs").insert({
        model_version: MODEL_VERSION,
        indicators_attempted: 0,
        indicators_success: 0,
        indicators_failed: 0,
        snapshots_written: 0,
        error_summary: "weekend_skip: markets closed, no write",
        duration_ms: durationMs,
      });
    } catch (auditErr) {
      console.error(
        "[cron ingest-technical] weekend audit write failed:",
        auditErr,
      );
    }
    return NextResponse.json({
      ok: true,
      skipped: "weekend",
      today,
      duration_ms: durationMs,
    });
  }

  try {
    for (let i = 0; i < TICKER_REGISTRY.length; i++) {
      const entry = TICKER_REGISTRY[i];
      tickersAttempted++;

      // ----- 2a. Fetch through Phase 3.0 fallback chain -----
      // KR tickers (`.KS` / `.KQ`) skip AV/Twelve Data and go
      // straight to Yahoo Finance per `daily-bar-fetcher.ts`.
      let outcome: Awaited<ReturnType<typeof fetchDailyBars>>;
      try {
        outcome = await fetchDailyBars(entry.ticker);
      } catch (err) {
        // Adapter throws are config errors (missing API key) — bail
        // the loop rather than burn 11 × 13s of useless sleeps.
        throw err;
      }

      const fetchResult: DailyBarSeries = outcome.result;

      if (fetchResult.fetch_status === "error" || fetchResult.bars.length === 0) {
        tickersFailed++;
        perTickerErrors.push(
          `${entry.ticker}: ${fetchResult.error ?? "no bars"} (tiers tried: ${outcome.tiersAttempted.join(",")})`,
        );
        // Write 6 error-rows so the staleness badge can show "last
        // attempt failed today" instead of silently reading yesterday.
        const errorRows = buildErrorTechnicalRows(
          entry,
          today,
          fetchResult.error,
          fetchResult.source_name,
        );
        await upsertTechnicalRows(supabase, errorRows);
        technicalRowsWritten += errorRows.length;

        // Sleep ONLY if Tier 1 (AV) was actually attempted on this
        // ticker — KR tickers skip AV entirely and don't need pacing.
        if (
          i < TICKER_REGISTRY.length - 1 &&
          outcome.tiersAttempted.includes("alpha_vantage")
        ) {
          await sleep(ALPHA_VANTAGE_SLEEP_MS);
        }
        continue;
      }

      // ----- 2b. Derive closes + indicator computations -----
      const { technicalRows, priceRow } = computeTickerRows(
        entry,
        fetchResult.bars,
        fetchResult.source_name,
      );

      // ----- 2d. Write technical_readings -----
      await upsertTechnicalRows(supabase, technicalRows);
      technicalRowsWritten += technicalRows.length;

      // ----- 2e. Upsert price_readings for the latest bar -----
      // Visualization-only (blueprint §7.4). Shared fetch, two writes.
      if (priceRow) {
        await upsertPriceRow(supabase, priceRow);
        priceRowsWritten++;
      }

      tickersSuccess++;

      // ----- 2f. Sleep for AV 5/min compliance (only if AV was hit) -----
      if (
        i < TICKER_REGISTRY.length - 1 &&
        outcome.tiersAttempted.includes("alpha_vantage")
      ) {
        await sleep(ALPHA_VANTAGE_SLEEP_MS);
      }
    }

    if (perTickerErrors.length > 0) {
      errorSummary = perTickerErrors.slice(0, 5).join(" | ");
      if (perTickerErrors.length > 5) {
        errorSummary += ` | +${perTickerErrors.length - 5} more`;
      }
    }
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : String(err);
    console.error("[cron ingest-technical] pipeline failed:", err);
  }

  const durationMs = Date.now() - startMs;

  // ---- 3. Audit row (always) ----
  // TODO(phase3.x R1.1+R1.3): per-source breakdown. The current
  // ingest_runs row records aggregate ticker counts only; the per-tier
  // diagnostic (which tier of `daily-bar-fetcher.ts` served each
  // ticker) is logged into `error_summary` strings on failure but is
  // not structured. Phase 3.0 blueprint §4.3 calls for a `notes`
  // JSONB column (or per-source rows) so a future audit query can
  // attribute coverage by tier. Deferring to a follow-up because the
  // schema column doesn't exist yet — adding it requires a migration
  // + audit-reader updates that are outside Phase 3.0 scope.
  try {
    await supabase.from("ingest_runs").insert({
      model_version: MODEL_VERSION,
      indicators_attempted: tickersAttempted,
      indicators_success: tickersSuccess,
      indicators_failed: tickersFailed,
      snapshots_written: technicalRowsWritten + priceRowsWritten,
      error_summary: errorSummary,
      duration_ms: durationMs,
    });
  } catch (auditErr) {
    console.error("[cron ingest-technical] audit write failed:", auditErr);
  }

  // ---- 4. Cache invalidation ----
  if (technicalRowsWritten > 0) {
    revalidateTag(CACHE_TAGS.technical, { expire: 0 });
  }
  if (priceRowsWritten > 0) {
    revalidateTag(CACHE_TAGS.prices, { expire: 0 });
  }

  // ---- 4.5. Signal Alignment engine tail (blueprint §4.5, §5 routing) ----
  //
  // Runs even if the main ingestion was partial — signals tolerate
  // null inputs via state:"unknown" per blueprint §4.5 line 299. Soft
  // failure (plan §0.5 carve-out): do NOT return 500 if signals-tail
  // fails; the main ingestion already succeeded. Append error-summary
  // best-effort instead.
  try {
    const signalInputs = await loadSignalInputs(supabase, today);
    const signalComputation = computeSignals(signalInputs);
    await writeSignalEvents(supabase, today, signalComputation);
    revalidateTag(CACHE_TAGS.signals, { expire: 0 });
  } catch (signalsErr) {
    const msg =
      signalsErr instanceof Error ? signalsErr.message : String(signalsErr);
    console.error("[cron ingest-technical] signals tail failed:", msg);
    errorSummary = errorSummary
      ? `${errorSummary}; signals_tail: ${msg}`
      : `signals_tail: ${msg}`;
  }

  // ---- 5. Response ----
  const status: "success" | "partial" | "error" =
    errorSummary && tickersSuccess === 0
      ? "error"
      : tickersFailed > 0 || errorSummary
        ? "partial"
        : "success";

  const httpStatus = status === "error" ? 500 : 200;

  return NextResponse.json(
    {
      status,
      snapshot_date: today,
      model_version: MODEL_VERSION,
      tickers_attempted: tickersAttempted,
      tickers_success: tickersSuccess,
      tickers_failed: tickersFailed,
      technical_rows_written: technicalRowsWritten,
      price_rows_written: priceRowsWritten,
      duration_ms: durationMs,
      error_summary: errorSummary,
    },
    { status: httpStatus },
  );
}

// ---------------------------------------------------------------------------
// Per-ticker computation — kept as a pure helper so a future unit test
// can exercise indicator math on a fixture bars array without touching
// Supabase or Alpha Vantage.
// ---------------------------------------------------------------------------

interface ComputedRows {
  technicalRows: TechnicalReadingInsert[];
  priceRow: PriceReadingInsert | null;
}

function computeTickerRows(
  entry: TickerRegistryEntry,
  bars: ReadonlyArray<DailyBar>,
  sourceName: DailyBarSeries["source_name"],
): ComputedRows {
  // Parser returns bars ascending. Defensive sort to survive a future
  // parser refactor that breaks the invariant — the indicator math
  // fundamentally requires chronological input.
  const ordered = [...bars].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = ordered[ordered.length - 1]!;
  const closes = ordered.map((b) => b.close);
  const observedAt = latest.date;

  const technicalRows: TechnicalReadingInsert[] = [];

  // ---- RSI(14) ----
  // Requires >= period + 1 = 15 closes. Under that, write NULL /
  // 'partial' so the dashboard can show "waiting on history".
  const rsiValue = rsi(closes, 14);
  technicalRows.push(
    buildTechnicalRow({
      entry,
      indicator_key: INDICATOR_KEYS.RSI_14,
      observed_at: observedAt,
      value_raw: rsiValue,
      value_normalized: null,
      score_0_100: rsiValue === null ? null : rsiToScore(rsiValue),
      status: rsiValue === null ? "partial" : "success",
      source_name: sourceName,
    }),
  );

  // ---- MACD(12,26,9) ----
  // Requires slowPeriod + signalPeriod - 2 = 33 closes to produce a
  // first non-null MacdResult. Score needs MACD_SCORE_WINDOW (=90) of
  // histogram history for the z-score (capped to last 90 internally);
  // anything less than 2 history points ⇒ null score.
  const macdFullSeries = macdSeries(closes, 12, 26, 9);
  const latestMacd = macdFullSeries[macdFullSeries.length - 1] ?? null;
  let macdScore: number | null = null;
  if (latestMacd !== null) {
    // Histogram history EXCLUDING the current bar (macdToScore treats
    // `current` as the not-yet-seen observation for the z-score).
    const histogramHistory: number[] = [];
    for (let i = 0; i < macdFullSeries.length - 1; i++) {
      const seriesEntry = macdFullSeries[i];
      if (seriesEntry !== null) histogramHistory.push(seriesEntry.histogram);
    }
    // macdToScore internally slices to the last MACD_SCORE_WINDOW (90)
    // histogram points for the z-score. Passing the full history is
    // fine; the slicing is the function's contract.
    macdScore = macdToScore(latestMacd, histogramHistory);
  }
  technicalRows.push(
    buildTechnicalRow({
      entry,
      indicator_key: INDICATOR_KEYS.MACD_12_26_9,
      observed_at: observedAt,
      // Store the raw histogram (signed magnitude of momentum).
      // macd-line and signal-line go into raw_payload so a debugger
      // can reconstruct the full MACD tuple.
      value_raw: latestMacd?.histogram ?? null,
      value_normalized: null,
      score_0_100: macdScore,
      status:
        latestMacd === null
          ? "partial"
          : macdScore === null
            ? "partial"
            : "success",
      raw_payload:
        latestMacd === null
          ? null
          : ({
              macd: latestMacd.macd,
              signal: latestMacd.signal,
              histogram: latestMacd.histogram,
            } satisfies Json),
      source_name: sourceName,
    }),
  );

  // ---- MA(50) / MA(200) — raw trend lines, no score mapping per blueprint §4.3 ----
  // The MAs feed Disparity (below) rather than scoring independently.
  // We still persist them as rows so the dashboard can render the
  // "price vs MA" micro-chart without a second fetch.
  const ma50 = simpleMovingAverage(closes, 50);
  technicalRows.push(
    buildTechnicalRow({
      entry,
      indicator_key: INDICATOR_KEYS.MA_50,
      observed_at: observedAt,
      value_raw: ma50,
      value_normalized: null,
      score_0_100: null,
      status: ma50 === null ? "partial" : "success",
      source_name: sourceName,
    }),
  );

  const ma200 = simpleMovingAverage(closes, 200);
  technicalRows.push(
    buildTechnicalRow({
      entry,
      indicator_key: INDICATOR_KEYS.MA_200,
      observed_at: observedAt,
      value_raw: ma200,
      value_normalized: null,
      score_0_100: null,
      status: ma200 === null ? "partial" : "success",
      source_name: sourceName,
    }),
  );

  // ---- Bollinger(20, 2) ----
  const bands = bollingerBands(closes, 20, 2);
  const bollingerScore =
    bands === null ? null : bollingerToScore(latest.close, bands);
  technicalRows.push(
    buildTechnicalRow({
      entry,
      indicator_key: INDICATOR_KEYS.BB_20_2,
      observed_at: observedAt,
      // Store %B-like position (how close to upper band) as value_raw
      // for quick visual inspection; full band tuple in raw_payload.
      value_raw:
        bands === null || bands.upper === bands.lower
          ? null
          : (latest.close - bands.lower) / (bands.upper - bands.lower),
      value_normalized: null,
      score_0_100: bollingerScore,
      status: bands === null ? "partial" : "success",
      raw_payload:
        bands === null
          ? null
          : ({
              middle: bands.middle,
              upper: bands.upper,
              lower: bands.lower,
              close: latest.close,
            } satisfies Json),
      source_name: sourceName,
    }),
  );

  // ---- Disparity (price / MA200 - 1) ----
  const disparityValue = disparity(latest.close, ma200);
  technicalRows.push(
    buildTechnicalRow({
      entry,
      indicator_key: INDICATOR_KEYS.DISPARITY,
      observed_at: observedAt,
      value_raw: disparityValue,
      value_normalized: null,
      score_0_100:
        disparityValue === null ? null : disparityToScore(disparityValue),
      status: disparityValue === null ? "partial" : "success",
      source_name: sourceName,
    }),
  );

  // ---- Price readings row for the latest bar ----
  // Visualization-only (blueprint §7.4). Source matches whichever tier
  // of the fallback chain served the bars, so a future audit-trail
  // query can attribute price coverage by tier.
  const priceRow: PriceReadingInsert = {
    ticker: entry.ticker,
    asset_type: entry.asset_type,
    price_date: observedAt,
    open: latest.open,
    high: latest.high,
    low: latest.low,
    close: latest.close,
    volume: latest.volume,
    source_name: sourceName,
  };

  return { technicalRows, priceRow };
}

// ---------------------------------------------------------------------------
// Row builders + writers
// ---------------------------------------------------------------------------

interface BuildTechnicalRowArgs {
  entry: TickerRegistryEntry;
  indicator_key: string;
  observed_at: string;
  value_raw: number | null;
  value_normalized: number | null;
  score_0_100: number | null;
  status: FetchStatus;
  raw_payload?: Json | null;
  source_name: DailyBarSeries["source_name"];
}

function buildTechnicalRow(args: BuildTechnicalRowArgs): TechnicalReadingInsert {
  return {
    ticker: args.entry.ticker,
    indicator_key: args.indicator_key,
    asset_type: args.entry.asset_type,
    value_raw: args.value_raw,
    value_normalized: args.value_normalized,
    score_0_100: args.score_0_100,
    observed_at: args.observed_at,
    source_name: args.source_name,
    model_version: MODEL_VERSION,
    fetch_status: args.status,
    raw_payload: args.raw_payload ?? null,
  };
}

/**
 * Build 6 error-status rows for a ticker whose fetch failed across
 * all attempted tiers. Lets the dashboard staleness badge distinguish
 * "today attempted, all 6 failed" from "today not attempted"
 * (blueprint §0.5 tenet 1 — loud failure surface, not silence).
 */
function buildErrorTechnicalRows(
  entry: TickerRegistryEntry,
  today: string,
  error: string | undefined,
  sourceName: DailyBarSeries["source_name"],
): TechnicalReadingInsert[] {
  const payload: Json = { error: error ?? "unknown" };
  return Object.values(INDICATOR_KEYS).map((indicator_key) => ({
    ticker: entry.ticker,
    indicator_key,
    asset_type: entry.asset_type,
    value_raw: null,
    value_normalized: null,
    score_0_100: null,
    observed_at: today,
    source_name: sourceName,
    model_version: MODEL_VERSION,
    fetch_status: "error" as FetchStatus,
    raw_payload: payload,
  }));
}

async function upsertTechnicalRows(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  rows: TechnicalReadingInsert[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from("technical_readings")
    .upsert(rows, {
      onConflict: "ticker,indicator_key,observed_at,model_version",
    });
  if (error) {
    throw new Error(
      `technical_readings upsert failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }
}

async function upsertPriceRow(
  supabase: ReturnType<typeof getSupabaseAdminClient>,
  row: PriceReadingInsert,
): Promise<void> {
  const { error } = await supabase
    .from("price_readings")
    .upsert(row, { onConflict: "ticker,price_date" });
  if (error) {
    throw new Error(
      `price_readings upsert failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
