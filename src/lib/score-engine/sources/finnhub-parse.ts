/**
 * INACTIVE 2026-04-24 — `ingest-news` was rewired to Alpha Vantage
 * NEWS_SENTIMENT because Finnhub `/news-sentiment` is paid-only. This
 * parser is retained for a future paid-Finnhub upgrade. No active
 * import path; do not delete without `grep -r fetchFinnhubSentiment`.
 * (F-R3.4 Trigger 2 review banner.)
 */
/**
 * Pure Finnhub news-sentiment response parser.
 *
 * Split out of `finnhub.ts` so that:
 *
 * - Vitest can test the parser in a plain Node env (no network, no env
 *   vars) — the wrapper `finnhub.ts` still carries `import "server-only"`
 *   to prevent FINNHUB_API_KEY from leaking to client bundles.
 * - Phase 2 backfill / sentiment-normalization scripts can reuse the
 *   parser without dragging in the `"server-only"` guard.
 *
 * Everything here is framework-agnostic — no React, no Next.js, no
 * Supabase, no `process.env` reads.
 *
 * Contract notes:
 *
 * 1. This parser ONLY extracts raw fields. The `score_0_100` value
 *    that lands on the `news_sentiment` table is computed at Step 5
 *    (sentiment module), not here (blueprint §4.4). Keeping the
 *    normalization out of the parser means we can re-score historical
 *    rows without re-fetching.
 * 2. "No articles" for a ticker is a legitimate upstream response
 *    (the `sentiment` / `buzz` objects may be absent or all-zero).
 *    We return `fetch_status: "partial"` in that case so the cron
 *    distinguishes it from a genuine upstream failure.
 * 3. Percent fields (`bullishPercent`, `bearishPercent`) are kept in
 *    their native [0, 1] range. The Step 5 normalizer maps to 0-100.
 *    Values outside [0, 1] are clamped to null — Finnhub has been
 *    observed to emit stale cached values of exactly `0` + `0` which
 *    are handled explicitly (both valid zeros vs both missing).
 */

export type FinnhubFetchStatus = "success" | "error" | "partial";

export interface FinnhubSentimentResult {
  ticker: string;
  /** Fraction in [0, 1], or null if the field was missing/invalid. */
  bullishPercent: number | null;
  /** Fraction in [0, 1], or null if the field was missing/invalid. */
  bearishPercent: number | null;
  /**
   * Finnhub's `companyNewsScore` — a pre-computed sentiment score in
   * roughly [0, 1]. Raw passthrough here; Step 5 does the final
   * 0-100 mapping.
   */
  companyNewsScore: number | null;
  /** `buzz.articlesInLastWeek`; 0 when absent. */
  articleCount: number;
  fetch_status: FinnhubFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of parse completion. */
  fetched_at: string;
}

/**
 * Pure parser for the Finnhub news-sentiment endpoint. Never throws.
 */
export function parseFinnhubSentimentResponse(
  ticker: string,
  body: unknown,
): FinnhubSentimentResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeErrorResult(ticker, "Finnhub response was not an object");
  }

  const bodyObj = body as Record<string, unknown>;

  // Finnhub returns errors as `{ "error": "..." }` at the top level.
  if (typeof bodyObj["error"] === "string") {
    return makeErrorResult(ticker, `Finnhub error: ${bodyObj["error"]}`);
  }

  const sentiment = bodyObj["sentiment"];
  const buzz = bodyObj["buzz"];

  const bullishPercent = extractPercent(sentiment, "bullishPercent");
  const bearishPercent = extractPercent(sentiment, "bearishPercent");
  const companyNewsScore = extractFinite(bodyObj["companyNewsScore"]);
  const articleCount = extractArticleCount(buzz);

  // If the sentiment object is missing entirely and buzz shows zero
  // articles, this is "no data yet" — loud success isn't right. Mark
  // partial so Step 5 can distinguish it from a transient upstream
  // failure.
  const sentimentMissing = bullishPercent === null && bearishPercent === null;
  if (sentimentMissing) {
    return {
      ticker,
      bullishPercent: null,
      bearishPercent: null,
      companyNewsScore,
      articleCount,
      fetch_status: "partial",
      error:
        articleCount === 0
          ? "no articles for ticker in the last week"
          : "sentiment object missing from Finnhub response",
      fetched_at: new Date().toISOString(),
    };
  }

  return {
    ticker,
    bullishPercent,
    bearishPercent,
    companyNewsScore,
    articleCount,
    fetch_status: "success",
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Build a canonical error-shape result. Exported for the fetcher
 * wrapper's network/HTTP failure paths.
 */
export function makeErrorResult(
  ticker: string,
  message: string,
): FinnhubSentimentResult {
  return {
    ticker,
    bullishPercent: null,
    bearishPercent: null,
    companyNewsScore: null,
    articleCount: 0,
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}

function extractPercent(
  container: unknown,
  key: "bullishPercent" | "bearishPercent",
): number | null {
  if (!container || typeof container !== "object" || Array.isArray(container)) {
    return null;
  }
  const raw = (container as Record<string, unknown>)[key];
  const n = extractFinite(raw);
  if (n === null) return null;
  // Valid fraction in [0, 1]; anything outside is treated as invalid
  // (stale / miscalibrated upstream value) and dropped to null so it
  // doesn't skew the Step 5 normalizer.
  if (n < 0 || n > 1) return null;
  return n;
}

function extractFinite(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

function extractArticleCount(buzz: unknown): number {
  if (!buzz || typeof buzz !== "object" || Array.isArray(buzz)) return 0;
  const raw = (buzz as Record<string, unknown>)["articlesInLastWeek"];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return 0;
  return Math.trunc(raw);
}
