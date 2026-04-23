/**
 * Pure Alpha Vantage `NEWS_SENTIMENT` response parser.
 *
 * Phase C Step 7 news-sentiment source. Replaces the earlier Finnhub
 * adapter because Finnhub's `/news-sentiment` endpoint requires a paid
 * plan (confirmed in production smoke test — the free tier returns
 * `{"error":"You don't have access to this resource."}`), whereas Alpha
 * Vantage's `NEWS_SENTIMENT` function works on the existing free tier
 * and returns BOTH per-article and per-ticker pre-computed sentiment
 * scores.
 *
 * Split from the fetcher (`alpha-vantage-news.ts`) so the parser can
 * be exercised from Vitest / Node scripts without the `import
 * "server-only"` guard. Framework-agnostic — no React, no Next.js, no
 * Supabase, no `process.env` reads.
 *
 * Response contract (from live AV probing, 2026-04-23):
 *
 * ```jsonc
 * {
 *   "items": "50",
 *   "sentiment_score_definition": "x <= -0.35: Bearish; ...",
 *   "relevance_score_definition": "0 < x <= 1, ...",
 *   "feed": [
 *     {
 *       "title": "...",
 *       "url": "...",
 *       "time_published": "20260423T161740",
 *       "overall_sentiment_score": 0.306972,
 *       "overall_sentiment_label": "Somewhat-Bullish",
 *       "ticker_sentiment": [
 *         {
 *           "ticker": "AAPL",
 *           "relevance_score": "0.612084",
 *           "ticker_sentiment_score": "0.313460",
 *           "ticker_sentiment_label": "Somewhat-Bullish"
 *         }
 *       ]
 *     }
 *   ]
 * }
 * ```
 *
 * Quirks this parser handles:
 *
 * 1. **AV rate-limit payloads.** Like the daily-bars endpoint, AV returns
 *    200 OK with `{ "Information": "..." }`, `{ "Note": "..." }`, or
 *    `{ "Error Message": "..." }` when you exhaust the free-tier quota
 *    or hit a malformed request. These must surface as `fetch_status:
 *    "error"` so the cron's per-call loop can distinguish "no feed
 *    today" from "rate-limited, retry later".
 * 2. **Stringly-typed numeric fields.** `relevance_score` and
 *    `ticker_sentiment_score` come back as strings. We coerce via
 *    `Number(...)` and skip the per-ticker entry (not the whole article)
 *    when non-numeric — mirrors the Phase 1 FRED parser's "one bad row
 *    doesn't poison the batch" contract.
 * 3. **Missing `ticker_sentiment` array on an article.** Legitimate
 *    upstream shape (some AV articles are general-market with no ticker
 *    attributions). Skip the article silently — don't fail the parse.
 * 4. **Missing required article field** (title or time_published): skip
 *    that article without failing the whole parse.
 * 5. **Empty feed without rate-limit shape.** Return `fetch_status:
 *    "partial"` so the cron can log "nothing to score today" without
 *    writing zero rows — distinct from a rate-limit failure.
 * 6. **Zero relevance.** Division guard — drop entries with
 *    `relevance === 0` from the weighted-mean so we don't divide by
 *    zero when aggregating.
 *
 * Aggregation contract (why this lives in the parser, not the route):
 *
 * Per-ticker aggregation is deterministic + pure — given the same
 * `feed[]` and the same target ticker, the same score falls out. Keeping
 * it here means a future Phase 3 backfill can re-aggregate historical
 * JSON payloads without re-fetching AV. The route just orchestrates IO.
 *
 * The score-map of `[-1, 1] → [0, 100]` lives here too (as
 * {@link newsSentimentToScore}). Rationale: the mapping is defined by
 * AV's documented `sentiment_score_definition` semantics, and there's
 * exactly one production consumer (the cron route). Pulling it into
 * `src/lib/score-engine/sentiment.ts` would create a dependency cycle
 * with this module's types.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlphaVantageNewsFetchStatus = "success" | "error" | "partial";

/**
 * One per-ticker sentiment attribution inside a single AV article's
 * `ticker_sentiment[]` array. All scores normalised to numbers after
 * parse (AV emits them as strings).
 */
export interface AlphaVantageTickerSentiment {
  ticker: string;
  relevance_score: number;
  ticker_sentiment_score: number;
  ticker_sentiment_label: string | null;
}

/**
 * One article in the AV NEWS_SENTIMENT `feed[]` array.
 *
 * Only the fields we actually use downstream are typed — the upstream
 * shape has many more (authors, topics, banner_image) that we store
 * verbatim on `raw_payload` but never branch on.
 */
export interface AlphaVantageFeedItem {
  title: string;
  url: string | null;
  time_published: string;
  source: string | null;
  overall_sentiment_score: number | null;
  overall_sentiment_label: string | null;
  ticker_sentiment: AlphaVantageTickerSentiment[];
}

/**
 * Per-ticker relevance-weighted mean sentiment across the AV feed.
 *
 * - `weightedMeanScore`: `Σ(score × relevance) / Σ(relevance)` over
 *   every article in the feed whose `ticker_sentiment[]` mentions the
 *   target ticker with valid numeric score + non-zero relevance. `null`
 *   when no valid mentions were found (distinct from "exactly 0" —
 *   absence is explicit).
 * - `articleCount`: number of unique articles that mentioned the ticker
 *   with at least one valid entry. Used downstream for the UI's
 *   "low-signal" affordance.
 */
export interface AlphaVantageTickerAggregate {
  weightedMeanScore: number | null;
  articleCount: number;
}

/**
 * Parsed result shape from one `fetchAlphaVantageNews` call.
 *
 * The route merges `aggregates` maps across two calls (to cover all 7
 * tickers within AV's observed per-call ticker cap) before writing
 * per-ticker rows to `news_sentiment`.
 */
export interface AlphaVantageNewsResult {
  /** The tickers this call was issued for (comma-separated in request). */
  tickers: string[];
  /** All articles from AV — already filtered for parse validity. */
  feed: AlphaVantageFeedItem[];
  /**
   * Aggregate for every requested ticker. A ticker with zero mentions
   * in `feed` still appears here with `articleCount: 0` and a null
   * score, so downstream consumers can write one row per requested
   * ticker without branching on map-miss.
   */
  aggregates: Record<string, AlphaVantageTickerAggregate>;
  fetch_status: AlphaVantageNewsFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of parse completion. */
  fetched_at: string;
  /** Copy-forward from AV response (null if error/parse-failed). */
  sentiment_score_definition?: string;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Pure parser for the Alpha Vantage NEWS_SENTIMENT endpoint. Never
 * throws. Any unexpected payload shape yields a well-formed error
 * result; one malformed article yields a partial result with the good
 * articles intact.
 */
export function parseAlphaVantageNewsResponse(
  tickers: readonly string[],
  body: unknown,
): AlphaVantageNewsResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeAvNewsError(tickers, "Alpha Vantage news response was not an object");
  }

  const bodyObj = body as Record<string, unknown>;

  // ----- AV rate-limit / error payloads (200-OK with non-data body) -----
  if (typeof bodyObj["Information"] === "string") {
    return makeAvNewsError(
      tickers,
      `Alpha Vantage news rate limit / info: ${bodyObj["Information"]}`,
    );
  }
  if (typeof bodyObj["Note"] === "string") {
    return makeAvNewsError(
      tickers,
      `Alpha Vantage news rate limit note: ${bodyObj["Note"]}`,
    );
  }
  if (typeof bodyObj["Error Message"] === "string") {
    return makeAvNewsError(
      tickers,
      `Alpha Vantage news error: ${bodyObj["Error Message"]}`,
    );
  }

  const rawFeed = bodyObj["feed"];
  if (!Array.isArray(rawFeed)) {
    return makeAvNewsError(
      tickers,
      "Alpha Vantage news response missing 'feed' array",
    );
  }

  const feed: AlphaVantageFeedItem[] = [];
  for (const rawItem of rawFeed) {
    const item = parseFeedItem(rawItem);
    if (item !== null) feed.push(item);
  }

  const definition =
    typeof bodyObj["sentiment_score_definition"] === "string"
      ? (bodyObj["sentiment_score_definition"] as string)
      : undefined;

  const aggregates = buildAggregatesMap(tickers, feed);

  if (feed.length === 0) {
    // No articles returned but no rate-limit shape either — legitimate
    // "nothing newsworthy" response. Mark partial so the cron can
    // distinguish it from a genuine upstream failure.
    return {
      tickers: [...tickers],
      feed: [],
      aggregates,
      fetch_status: "partial",
      error: "Alpha Vantage news feed was empty",
      fetched_at: new Date().toISOString(),
      ...(definition !== undefined ? { sentiment_score_definition: definition } : {}),
    };
  }

  return {
    tickers: [...tickers],
    feed,
    aggregates,
    fetch_status: "success",
    fetched_at: new Date().toISOString(),
    ...(definition !== undefined ? { sentiment_score_definition: definition } : {}),
  };
}

/**
 * Build a canonical error-shape result. Exported for reuse by the
 * fetcher wrapper on network/HTTP failure and by the route's "empty
 * tickers list" guard.
 */
export function makeAvNewsError(
  tickers: readonly string[],
  message: string,
): AlphaVantageNewsResult {
  const aggregates: Record<string, AlphaVantageTickerAggregate> = {};
  for (const t of tickers) {
    aggregates[t] = { weightedMeanScore: null, articleCount: 0 };
  }
  return {
    tickers: [...tickers],
    feed: [],
    aggregates,
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Per-ticker aggregation
// ---------------------------------------------------------------------------

/**
 * Scan `feed` for articles mentioning `ticker` and compute the
 * relevance-weighted mean of their sentiment scores:
 *
 *   weightedMean = Σ(score × relevance) / Σ(relevance)
 *
 * Only entries with finite numeric score + strictly positive relevance
 * contribute. An article may be counted toward `articleCount` only if
 * at least one of its ticker-sentiment entries for the target was
 * valid (avoids double-counting articles with multiple per-target
 * entries, which AV has been observed to emit).
 *
 * Returns `{ weightedMeanScore: null, articleCount: 0 }` when nothing
 * valid was found. The null signal is preserved (not collapsed to 0)
 * so the score-map can route it to the neutral-50 fallback explicitly.
 */
export function aggregateTickerSentiment(
  feed: readonly AlphaVantageFeedItem[],
  ticker: string,
): AlphaVantageTickerAggregate {
  let scoreSum = 0;
  let relSum = 0;
  let articleCount = 0;

  for (const item of feed) {
    let contributedInThisArticle = false;
    for (const entry of item.ticker_sentiment) {
      if (entry.ticker !== ticker) continue;
      if (!Number.isFinite(entry.ticker_sentiment_score)) continue;
      if (!Number.isFinite(entry.relevance_score)) continue;
      if (entry.relevance_score <= 0) continue; // division guard
      scoreSum += entry.ticker_sentiment_score * entry.relevance_score;
      relSum += entry.relevance_score;
      contributedInThisArticle = true;
    }
    if (contributedInThisArticle) articleCount++;
  }

  if (relSum === 0) {
    return { weightedMeanScore: null, articleCount: 0 };
  }
  return { weightedMeanScore: scoreSum / relSum, articleCount };
}

/**
 * Map AV's `[-1, 1]` signed sentiment onto the product's 0-100
 * favorability scale: `(x + 1) * 50`.
 *
 * ```
 * -1 (bearish) → 0    (min favorable)
 *  0 (neutral) → 50
 * +1 (bullish) → 100  (max favorable)
 * ```
 *
 * `null` input (no articles mentioned the ticker) collapses to 50
 * (neutral) because the `news_sentiment.score_0_100` DB column is NOT
 * NULL. The row's `fetch_status='partial'` is the authoritative signal
 * that no data was found — the UI branches on status, not on the
 * score value.
 *
 * Defensive clamp to [0, 100] guards against pathological upstream
 * values (AV has been observed to return slightly-out-of-range scores
 * for certain sparse-coverage tickers).
 */
export function newsSentimentToScore(
  weightedMeanScore: number | null,
): number {
  if (weightedMeanScore === null) return 50;
  if (!Number.isFinite(weightedMeanScore)) return 50;
  const raw = (weightedMeanScore + 1) * 50;
  if (raw < 0) return 0;
  if (raw > 100) return 100;
  return raw;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function buildAggregatesMap(
  tickers: readonly string[],
  feed: readonly AlphaVantageFeedItem[],
): Record<string, AlphaVantageTickerAggregate> {
  const map: Record<string, AlphaVantageTickerAggregate> = {};
  for (const t of tickers) {
    map[t] = aggregateTickerSentiment(feed, t);
  }
  return map;
}

function parseFeedItem(raw: unknown): AlphaVantageFeedItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const title = obj["title"];
  const timePublished = obj["time_published"];
  if (typeof title !== "string" || typeof timePublished !== "string") {
    // Missing required identifier — skip silently (Phase 1 convention).
    return null;
  }

  const rawTickerSentiment = obj["ticker_sentiment"];
  if (!Array.isArray(rawTickerSentiment)) {
    // Article with no per-ticker attributions — skip silently.
    return null;
  }

  const tickerSentiment: AlphaVantageTickerSentiment[] = [];
  for (const rawEntry of rawTickerSentiment) {
    const entry = parseTickerSentimentEntry(rawEntry);
    if (entry !== null) tickerSentiment.push(entry);
  }

  const overallScore = coerceFinite(obj["overall_sentiment_score"]);
  const overallLabel =
    typeof obj["overall_sentiment_label"] === "string"
      ? (obj["overall_sentiment_label"] as string)
      : null;

  return {
    title,
    url: typeof obj["url"] === "string" ? (obj["url"] as string) : null,
    time_published: timePublished,
    source: typeof obj["source"] === "string" ? (obj["source"] as string) : null,
    overall_sentiment_score: overallScore,
    overall_sentiment_label: overallLabel,
    ticker_sentiment: tickerSentiment,
  };
}

function parseTickerSentimentEntry(
  raw: unknown,
): AlphaVantageTickerSentiment | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;

  const ticker = obj["ticker"];
  if (typeof ticker !== "string" || ticker.length === 0) return null;

  const relevance = coerceFinite(obj["relevance_score"]);
  const sentimentScore = coerceFinite(obj["ticker_sentiment_score"]);
  if (relevance === null || sentimentScore === null) {
    // Non-numeric / missing → skip this entry but keep the article.
    return null;
  }

  const label =
    typeof obj["ticker_sentiment_label"] === "string"
      ? (obj["ticker_sentiment_label"] as string)
      : null;

  return {
    ticker,
    relevance_score: relevance,
    ticker_sentiment_score: sentimentScore,
    ticker_sentiment_label: label,
  };
}

/**
 * Coerce an unknown to a finite number. Accepts both native numbers and
 * numeric strings (AV emits sentiment/relevance fields as strings).
 * Returns null for anything non-finite (incl. NaN, Infinity, empty
 * string, non-numeric string, bool, null, object).
 */
function coerceFinite(raw: unknown): number | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === "string") {
    if (raw.length === 0) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
