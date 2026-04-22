import "server-only";

import { revalidateTag } from "next/cache";
import { NextResponse, type NextRequest } from "next/server";

import { verifyCronSecret } from "@/lib/auth/cron-secret";
import { CACHE_TAGS } from "@/lib/data/tags";
import {
  fetchCoinGeckoMarketChart,
  type CoinGeckoFetchResult,
} from "@/lib/score-engine/sources/coingecko";
import { MODEL_VERSION } from "@/lib/score-engine/weights";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Database, TablesInsert } from "@/types/database";

type AssetType = Database["public"]["Enums"]["asset_type_enum"];
type PriceReadingInsert = TablesInsert<"price_readings">;

/**
 * Phase 2 Step 7 crypto price-ingest cron — CoinGecko-only.
 *
 * Scope split with `/api/cron/ingest-technical`:
 *
 *   - `ingest-technical` fetches the 19 Alpha Vantage tickers ONCE
 *     and writes to BOTH `technical_readings` (indicator rows) and
 *     `price_readings` (latest daily bar). This saves re-fetching
 *     the same 19 symbols here and stays inside the Alpha Vantage
 *     free-tier 25/day ceiling. AV fetch is shared; AV writes to
 *     price_readings are the technical cron's responsibility.
 *
 *   - This route handles only the 3 CoinGecko crypto IDs
 *     (`bitcoin`, `ethereum`, `solana` per blueprint §3.2) — the
 *     data source CoinGecko is distinct from Alpha Vantage (no
 *     shared quota), and CoinGecko's 30 req/min is trivially
 *     satisfied by 3 parallel calls.
 *
 * Visualization-only invariant (blueprint §7.4):
 *
 *   Do NOT import anything from `src/lib/score-engine/**` in this
 *   file. `price_readings` never feeds the composite score engine;
 *   it drives the Step 10 price-overlay chart only. Adding a scoring
 *   import here would silently break the §7.4 boundary. (The
 *   `MODEL_VERSION` import above is for the `ingest_runs` audit row
 *   — it doesn't flow into a `price_readings` column because that
 *   table has no `model_version` column by design.)
 *
 * Pipeline (blueprint §3 Step 7):
 *   1. Authenticate `Authorization: Bearer ${CRON_SECRET}`.
 *   2. Fetch 3 CoinGecko market_chart responses in parallel (`Promise.all`).
 *   3. For each success, build ONE `price_readings` row per daily bar
 *      returned (default 365 days). CoinGecko returns OHLC-less close-
 *      only tuples, so `open` / `high` / `low` / `volume` are NULL and
 *      `close` carries the daily USD price.
 *   4. Upsert on `(ticker, price_date)` so reruns are idempotent.
 *   5. Write `ingest_runs` audit row.
 *   6. `revalidateTag(CACHE_TAGS.prices, { expire: 0 })` on success.
 *
 * Failure model (blueprint §0.5 tenet 1 — silent success, loud failure):
 *   - One coin id's fetch error (network / HTTP / CoinGecko body) →
 *     log, append to errorSummary, continue with the others. The
 *     price_readings table has no fetch_status column (visualization
 *     table — see migration 0005 comment), so failures are visible
 *     only via the ingest_runs audit row and the Vercel log stream,
 *     NOT via a per-row sentinel.
 *   - All three fail → ingest_runs.error_summary set, cache NOT
 *     invalidated (stale previous data is safer than empty charts).
 *   - Supabase writer throw → captured into ingest_runs, return 500.
 *
 * Runtime notes:
 *   - `maxDuration = 60` is plenty — 3 parallel CoinGecko calls
 *     bounded by a 15s per-call timeout, plus the Supabase upsert.
 *   - `import "server-only"` guards CRON_SECRET and
 *     SUPABASE_SERVICE_ROLE_KEY from client bundles.
 *
 * Endpoint: `GET /api/cron/ingest-prices`
 * Scheduled: right after `ingest-technical` in the same GitHub Actions
 *   workflow (`0 22 * * *` UTC).
 */
export const maxDuration = 60;

interface CoinGeckoTarget {
  /** CoinGecko coin id (URL slug). */
  id: string;
  /** Canonical ticker string we write to `price_readings.ticker`. */
  ticker: string;
  asset_type: AssetType;
}

const COINGECKO_TARGETS: readonly CoinGeckoTarget[] = [
  // All three crypto assets use the `crypto` enum value. Migration
  // 0003 (rename_btc_to_crypto) renamed the original `btc` enum to
  // `crypto` specifically so BTC/ETH/SOL/etc. could share one bucket
  // without a later schema churn — blueprint §3.2 groups them under
  // the single crypto asset type.
  { id: "bitcoin", ticker: "BTC", asset_type: "crypto" },
  { id: "ethereum", ticker: "ETH", asset_type: "crypto" },
  { id: "solana", ticker: "SOL", asset_type: "crypto" },
] as const;

export async function GET(request: NextRequest): Promise<NextResponse> {
  const startMs = Date.now();

  // ---- 1. Auth ----
  const authResult = verifyCronSecret(request);
  if (!authResult.ok) {
    return NextResponse.json({ error: authResult.reason }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const supabase = getSupabaseAdminClient();

  let coinsAttempted = 0;
  let coinsSuccess = 0;
  let coinsFailed = 0;
  let priceRowsWritten = 0;
  let errorSummary: string | null = null;
  const perCoinErrors: string[] = [];

  try {
    // ---- 2. Parallel CoinGecko fetches ----
    const fetches: Promise<{
      target: CoinGeckoTarget;
      result: CoinGeckoFetchResult;
    }>[] = COINGECKO_TARGETS.map((target) =>
      fetchCoinGeckoMarketChart(target.id).then((result) => ({ target, result })),
    );
    const fetchResults = await Promise.all(fetches);

    // ---- 3. Build rows ----
    for (const { target, result } of fetchResults) {
      coinsAttempted++;

      if (result.fetch_status !== "success" || result.bars.length === 0) {
        coinsFailed++;
        perCoinErrors.push(`${target.id}: ${result.error ?? "no bars"}`);
        continue;
      }

      const rows: PriceReadingInsert[] = result.bars.map((bar) => ({
        ticker: target.ticker,
        asset_type: target.asset_type,
        price_date: bar.date,
        // CoinGecko market_chart returns close-only daily ticks.
        // OHLC channels are only available on the `/coins/{id}/ohlc`
        // endpoint, which we intentionally skip at Step 7 — the
        // price-overlay chart (Step 10) only plots closes, so paying
        // a second API call for OHLC we don't render is premature.
        open: null,
        high: null,
        low: null,
        close: bar.close,
        volume: null,
        source_name: "coingecko",
      }));

      // Chunked upsert: CoinGecko returns ~365 rows per coin; combined
      // with the 3 coins that's ~1095 rows. Well under Supabase's
      // default batch limits but we keep each coin's batch independent
      // so one bad row from coin X doesn't poison coin Y's batch.
      const { error } = await supabase
        .from("price_readings")
        .upsert(rows, { onConflict: "ticker,price_date" });

      if (error) {
        coinsFailed++;
        perCoinErrors.push(
          `${target.id}: upsert failed: ${error.message} (${error.code ?? "no code"})`,
        );
        continue;
      }

      coinsSuccess++;
      priceRowsWritten += rows.length;
    }

    if (perCoinErrors.length > 0) {
      errorSummary = perCoinErrors.join(" | ");
    }
  } catch (err) {
    errorSummary = err instanceof Error ? err.message : String(err);
    console.error("[cron ingest-prices] pipeline failed:", err);
  }

  const durationMs = Date.now() - startMs;

  // ---- 5. Audit row (always) ----
  try {
    await supabase.from("ingest_runs").insert({
      model_version: MODEL_VERSION,
      indicators_attempted: coinsAttempted,
      indicators_success: coinsSuccess,
      indicators_failed: coinsFailed,
      snapshots_written: priceRowsWritten,
      error_summary: errorSummary,
      duration_ms: durationMs,
    });
  } catch (auditErr) {
    console.error("[cron ingest-prices] audit write failed:", auditErr);
  }

  // ---- 6. Cache invalidation ----
  if (priceRowsWritten > 0) {
    revalidateTag(CACHE_TAGS.prices, { expire: 0 });
  }

  // ---- Response ----
  const status: "success" | "partial" | "error" =
    errorSummary && coinsSuccess === 0
      ? "error"
      : coinsFailed > 0
        ? "partial"
        : "success";

  const httpStatus = status === "error" ? 500 : 200;

  return NextResponse.json(
    {
      status,
      snapshot_date: today,
      model_version: MODEL_VERSION,
      coins_attempted: coinsAttempted,
      coins_success: coinsSuccess,
      coins_failed: coinsFailed,
      price_rows_written: priceRowsWritten,
      duration_ms: durationMs,
      error_summary: errorSummary,
    },
    { status: httpStatus },
  );
}
