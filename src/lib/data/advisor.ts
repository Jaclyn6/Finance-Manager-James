import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { computeAdvisorVerdict } from "@/lib/advisor/verdict";
import type {
  AdvisorInputs,
  AdvisorVerdict,
  DailyClose,
} from "@/lib/advisor/types";
import type { AssetType } from "@/lib/score-engine/types";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  DASHBOARD_ASSET_ORDER,
  pickRepresentativeTicker,
} from "@/lib/utils/asset-labels";

import { computeWowDelta, percentileRank } from "@/lib/advisor/series";
import type { IndicatorSeriesPoint } from "@/lib/advisor/series";
import {
  computeStockFgProxy,
  type StockFgProxyResult,
} from "@/lib/advisor/stock-fg-proxy";

import {
  getIndicatorSeries,
  getLatestCompositeSnapshots,
  getLatestIndicatorReadings,
  getOnchainSeries,
} from "./indicators";
import { getPriceHistoryForTicker } from "./prices";
import { CACHE_TAGS } from "./tags";

/**
 * Advisor data assembly — joins the reading tables into
 * `AdvisorInputs` per asset and runs the pure verdict engine
 * (`src/lib/advisor/`).
 *
 * ─── Why this lives in `lib/data`, not `lib/advisor` ─────────────
 *
 * The advisor engine is pure (no I/O) so its verdict logic is unit-
 * testable without Supabase mocks. This file is the impure shell:
 * it knows which tables hold which indicator, which ticker represents
 * which asset, and how to degrade when a source is missing. Missing
 * data flows through as `null` — the engine reports it loudly via
 * `missingInputs` / reduced confidence rather than this layer
 * inventing defaults (§0.5 tenet 1).
 *
 * ─── §7.4 note ────────────────────────────────────────────────────
 *
 * This module DOES read `@/lib/data/prices` — that is allowed. The
 * §7.4 invariant forbids `src/lib/score-engine/**` from consuming
 * price history so the composite score stays price-free; the advisor
 * is a separate consumer whose entire job is judging price drawdowns.
 * It never feeds back into composite_snapshots.
 *
 * ─── Input sourcing map ──────────────────────────────────────────
 *
 *   series          price_readings (365d window, representative ticker)
 *   trend.close     last close of the series
 *   trend.ma50/200  technical_readings MA_50 / MA_200 (latest per
 *                   ticker), fallback: SMA computed from the series
 *                   itself when ≥50/≥200 closes exist (essential for
 *                   BTC, which has price rows but no technical rows)
 *   sentiment.fg    CNN_FG (equity/ETF) or CRYPTO_FG (crypto) — both
 *                   stored raw 0-100, low = fear; when CNN_FG has no
 *                   fresh success row (2026-06-24 outage), equity
 *                   falls back to computeStockFgProxy with isProxy
 *                   labeling
 *   volatility.vix  VIXCLS
 *   volatility.vixWow    computeWowDelta over VIXCLS 21d series
 *   macro.macroScore  latest composite snapshot for the SAME asset —
 *                     contributing_indicators.macro.score (v2 nested)
 *   macro.sahm      SAHMCURRENT
 *   macro.t10y2y    T10Y2Y
 *   macro.hySpread  BAMLH0A0HYM2
 *   macro.hySpreadWow    computeWowDelta over BAMLH0A0HYM2 21d series
 *   onchain.*       MVRV_Z / SOPR (crypto only)
 */

/** Calendar days of price history to judge — 52-week peak window. */
export const ADVISOR_SERIES_WINDOW_DAYS = 365;

/**
 * Calendar window for the direction series (VIX / HY spread). 21 days
 * gives the 7-day lookback ~2 weeks of headroom against weekends,
 * holidays, and FRED publication lag.
 */
export const DIRECTION_WINDOW_DAYS = 21;

/** Indicator keys the advisor reads direction (not just level) from. */
export const DIRECTION_KEYS = ["VIXCLS", "BAMLH0A0HYM2"] as const;

/**
 * Sentiment gauges whose 7-day direction the weather strip shows.
 * Stored in `onchain_readings` (one row per day, refreshed hourly /
 * 4h by their crons), so they read through {@link getOnchainSeries},
 * not the FRED reader.
 */
export const SENTIMENT_DIRECTION_KEYS = ["CNN_FG", "CRYPTO_FG"] as const;

/**
 * Calendar window for the 5-year percentile context ("VIX가 지난
 * 5년 중 상위 X%"). Matches the FRED fetch window the §4.1 backfill
 * persists; `percentileRank`'s 250-sample floor keeps the chip
 * hidden until the backfilled depth actually exists.
 */
export const PERCENTILE_WINDOW_DAYS = 1825;

/**
 * Calendar window for the STOCK_FG_PROXY ingredients: 125 trading
 * days (momentum MA) needs ~185 calendar days; 400 gives holiday/gap
 * headroom and doubles as the HY-spread percentile reference window.
 */
export const FG_PROXY_WINDOW_DAYS = 400;

const MA_KEYS = ["MA_50", "MA_200"] as const;

export interface AdvisorAssetView {
  assetType: AssetType;
  ticker: string;
  /** Daily close series the verdict was computed from (chart input). */
  series: DailyClose[];
  verdict: AdvisorVerdict;
}

/** Advisor asset-class mapping: crypto uses the onchain pillar set. */
function advisorClassOf(assetType: AssetType): AdvisorInputs["assetClass"] {
  return assetType === "crypto" ? "crypto" : "equity";
}

/** Simple moving average over the last `n` closes, or null if too few. */
function smaFromSeries(series: DailyClose[], n: number): number | null {
  if (series.length < n) return null;
  const tail = series.slice(-n);
  const sum = tail.reduce((s, p) => s + p.close, 0);
  return sum / n;
}

/**
 * Extracts the macro category score (0-100) from a v2 nested
 * `contributing_indicators` blob. Defensive against v1 flat rows and
 * malformed JSON — any shape mismatch returns null (loud path).
 */
function extractMacroScore(blob: unknown): number | null {
  if (typeof blob !== "object" || blob === null) return null;
  const macro = (blob as Record<string, unknown>).macro;
  if (typeof macro !== "object" || macro === null) return null;
  const score = (macro as Record<string, unknown>).score;
  return typeof score === "number" && Number.isFinite(score) ? score : null;
}

/**
 * Latest MA_50 / MA_200 per ticker from `technical_readings`.
 *
 * Own query (no reader exists for per-ticker technical rows — see
 * `getLatestIndicatorReadings`'s header for why the shared map
 * excludes them). Newest-first + first-hit-wins per (ticker, key),
 * same dedupe pattern as the shared readers.
 */
async function getLatestMaByTicker(
  tickers: string[],
): Promise<Record<string, { ma50: number | null; ma200: number | null }>> {
  "use cache";
  cacheTag(CACHE_TAGS.technical);
  cacheLife("days");

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("technical_readings")
    .select("ticker, indicator_key, observed_at, value_raw, fetch_status")
    .in("ticker", tickers)
    .in("indicator_key", [...MA_KEYS])
    .order("observed_at", { ascending: false })
    .limit(tickers.length * MA_KEYS.length * 10);

  if (error) {
    throw new Error(
      `getLatestMaByTicker(${tickers.join(",")}) failed: ${error.message} (${error.code ?? "no code"})`,
    );
  }

  const out: Record<string, { ma50: number | null; ma200: number | null }> =
    {};
  const seen = new Set<string>();
  for (const row of data ?? []) {
    if (row.fetch_status !== "success") continue;
    const hitKey = `${row.ticker}:${row.indicator_key}`;
    if (seen.has(hitKey)) continue;
    seen.add(hitKey);
    const entry = out[row.ticker] ?? { ma50: null, ma200: null };
    if (row.indicator_key === "MA_50") entry.ma50 = row.value_raw;
    if (row.indicator_key === "MA_200") entry.ma200 = row.value_raw;
    out[row.ticker] = entry;
  }
  return out;
}

/**
 * Builds the advisor view for every dashboard asset, in
 * `DASHBOARD_ASSET_ORDER`. One shared fetch of the cross-asset inputs
 * (indicator readings, composite snapshots, MA rows), then a per-asset
 * price-series fetch + pure verdict computation.
 *
 * @param endDate inclusive series upper bound (`YYYY-MM-DD`) — the
 *   caller passes `todayIsoUtc()`. Taken as an argument (not computed
 *   here) so the cache key pins to a calendar day and rolls with it.
 */
export async function getAdvisorViews(
  endDate: string,
): Promise<AdvisorAssetView[]> {
  "use cache";
  cacheTag(CACHE_TAGS.macroSnapshot);
  cacheTag(CACHE_TAGS.onchain);
  cacheTag(CACHE_TAGS.sentiment);
  cacheTag(CACHE_TAGS.technical);
  cacheTag(CACHE_TAGS.prices);
  cacheLife("days");

  const assetTypes = [...DASHBOARD_ASSET_ORDER];
  const tickers = assetTypes.map((a) => pickRepresentativeTicker(a));

  // Two Promise.all groups (not one spread array) so TypeScript keeps
  // the tuple types of the fixed group instead of collapsing to a union.
  const [[readings, snapshots, maByTicker, directionSeries, fgProxy], histories] =
    await Promise.all([
      Promise.all([
        getLatestIndicatorReadings(),
        getLatestCompositeSnapshots(),
        getLatestMaByTicker(tickers),
        getIndicatorSeries([...DIRECTION_KEYS], endDate, DIRECTION_WINDOW_DAYS),
        getStockFgProxy(endDate),
      ]),
      Promise.all(
        tickers.map((t) =>
          getPriceHistoryForTicker(t, endDate, ADVISOR_SERIES_WINDOW_DAYS),
        ),
      ),
    ]);

  const vixWow = computeWowDelta(directionSeries["VIXCLS"] ?? []);
  const hySpreadWow = computeWowDelta(directionSeries["BAMLH0A0HYM2"] ?? []);

  // Stock F&G source order: CNN when its latest row is a success
  // (it may recover — self-healing), else the in-house proxy with the
  // isProxy flag so every consumer labels it 자체 산출. Crypto F&G
  // (alternative.me) is unaffected by the CNN outage.
  const cnnFg = readings["CNN_FG"] ?? null;
  const equitySentiment =
    cnnFg !== null
      ? { fearGreed: cnnFg, isProxy: false }
      : { fearGreed: fgProxy.value, isProxy: fgProxy.value !== null };

  const macroScoreByAsset = new Map<AssetType, number | null>();
  for (const snapshot of snapshots) {
    macroScoreByAsset.set(
      snapshot.asset_type,
      extractMacroScore(snapshot.contributing_indicators),
    );
  }

  return assetTypes.map((assetType, i) => {
    const ticker = tickers[i];
    const series: DailyClose[] = histories[i].map((p) => ({
      date: p.price_date,
      close: p.close,
    }));
    const assetClass = advisorClassOf(assetType);
    const ma: { ma50: number | null; ma200: number | null } | undefined =
      maByTicker[ticker];

    const inputs: AdvisorInputs = {
      assetClass,
      series,
      trend: {
        close: series.length > 0 ? series[series.length - 1].close : null,
        ma50: ma?.ma50 ?? smaFromSeries(series, 50),
        ma200: ma?.ma200 ?? smaFromSeries(series, 200),
      },
      sentiment:
        assetClass === "crypto"
          ? { fearGreed: readings["CRYPTO_FG"] ?? null, isProxy: false }
          : equitySentiment,
      volatility: { vix: readings["VIXCLS"] ?? null, vixWow },
      macro: {
        macroScore: macroScoreByAsset.get(assetType) ?? null,
        sahm: readings["SAHMCURRENT"] ?? null,
        t10y2y: readings["T10Y2Y"] ?? null,
        hySpread: readings["BAMLH0A0HYM2"] ?? null,
        hySpreadWow,
      },
      onchain:
        assetClass === "crypto"
          ? {
              mvrvZ: readings["MVRV_Z"] ?? null,
              sopr: readings["SOPR"] ?? null,
            }
          : { mvrvZ: null, sopr: null },
    };

    return {
      assetType,
      ticker,
      series,
      verdict: computeAdvisorVerdict(inputs),
    };
  });
}

/**
 * Single-asset variant for the `/asset/[slug]` evidence view. Reuses
 * `getAdvisorViews` — the inner readers are cached, so after the
 * dashboard's first render this costs one in-memory filter.
 */
export async function getAdvisorViewForAsset(
  assetType: AssetType,
  endDate: string,
): Promise<AdvisorAssetView | null> {
  const views = await getAdvisorViews(endDate);
  return views.find((v) => v.assetType === assetType) ?? null;
}

/**
 * In-house stock F&G proxy assembled from already-collected series —
 * the CNN-outage fallback (docs/backlog.md "Stock F&G outage",
 * blueprint §0). Inner readers are all cached per calendar day, so
 * this is cheap after the dashboard's first render.
 */
export async function getStockFgProxy(
  endDate: string,
): Promise<StockFgProxyResult> {
  const toPoints = (
    rows: Array<{ price_date: string; close: number }>,
  ): IndicatorSeriesPoint[] =>
    rows.map((r) => ({ date: r.price_date, value: r.close }));

  const [spy, tlt, fredSeries] = await Promise.all([
    getPriceHistoryForTicker("SPY", endDate, FG_PROXY_WINDOW_DAYS),
    getPriceHistoryForTicker("TLT", endDate, FG_PROXY_WINDOW_DAYS),
    getIndicatorSeries(
      [...DIRECTION_KEYS],
      endDate,
      FG_PROXY_WINDOW_DAYS,
    ),
  ]);

  return computeStockFgProxy({
    spyCloses: toPoints(spy),
    tltCloses: toPoints(tlt),
    vixSeries: fredSeries["VIXCLS"] ?? [],
    hySeries: fredSeries["BAMLH0A0HYM2"] ?? [],
  });
}

/**
 * 7-day deltas for the Market Weather strip (▲/▼ + "꺾임" chip note),
 * keyed by indicator_key. Same cached series reader the verdicts use,
 * so the strip's arrows can never disagree with the pillar evidence.
 */
export async function getWeatherDeltas(
  endDate: string,
): Promise<Record<string, number | null>> {
  const [series, sentimentSeries] = await Promise.all([
    getIndicatorSeries([...DIRECTION_KEYS], endDate, DIRECTION_WINDOW_DAYS),
    getOnchainSeries(
      [...SENTIMENT_DIRECTION_KEYS],
      endDate,
      DIRECTION_WINDOW_DAYS,
    ),
  ]);
  const out: Record<string, number | null> = {};
  for (const key of DIRECTION_KEYS) {
    out[key] = computeWowDelta(series[key] ?? []);
  }
  for (const key of SENTIMENT_DIRECTION_KEYS) {
    out[key] = computeWowDelta(sentimentSeries[key] ?? []);
  }
  return out;
}

/**
 * 5-year percentile rank of each direction gauge's value, for the
 * weather strip's "5년 상위 X%" context line. The rank is computed
 * against the series' own LAST point — internally consistent, though
 * it can lag the chip's headline value by a publication day (the
 * chip reads getLatestIndicatorReadings, which may surface a newer
 * row than the daily-collapsed window). A one-day skew moves the
 * rank by well under a percent of the 5y window. Null (hidden chip
 * line) until the FRED backfill has seeded ≥250 observations.
 */
export async function getWeatherPercentiles(
  endDate: string,
): Promise<Record<string, number | null>> {
  const series = await getIndicatorSeries(
    [...DIRECTION_KEYS],
    endDate,
    PERCENTILE_WINDOW_DAYS,
  );
  const out: Record<string, number | null> = {};
  for (const key of DIRECTION_KEYS) {
    const points = series[key] ?? [];
    const latest = points.length > 0 ? points[points.length - 1] : null;
    out[key] = latest === null ? null : percentileRank(points, latest.value);
  }
  return out;
}
