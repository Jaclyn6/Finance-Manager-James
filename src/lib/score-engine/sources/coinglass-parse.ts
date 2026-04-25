/**
 * Pure BTC Spot ETF net-flow response parser.
 *
 * **History.** Originally targeted CoinGlass's unofficial public-tier
 * JSON endpoint at `https://open-api.coinglass.com/public/v2/indicator/
 * bitcoin_etf_flow`. That endpoint started returning HTTP 500 in 2026
 * and the v4 API now requires a paid `coinglassSecret` API key (401
 * "API key missing" without one). Free unauth alternatives surveyed:
 *
 *  - Farside Investors (`farside.co.uk/btc/`) — Cloudflare-blocked for
 *    bot UAs, hard to use server-side without scraping rotation.
 *  - Bitbo (`https://bitbo.io/treasuries/etf-flows/`) — public HTML
 *    table, server-renderable with a normal UA. Same dataset shape as
 *    Farside (Bitbo aggregates 13 spot ETF tickers).
 *  - SoSoValue / Newhedge — paid API tiers.
 *
 * The fetcher was repointed at Bitbo's HTML page — same domain we
 * scrape elsewhere for treasuries data. Verified working 2026-04-25.
 *
 * **HTML shape (Bitbo /treasuries/etf-flows/).** A single data table
 * with header row:
 *
 *   `Date | IBIT | FBTC | GBTC | BTC | BITB | ARKB | HODL | BTCO |
 *    BRRR | EZBC | MSBT | BTCW | DEFI | Totals`
 *
 * Body rows are ETF-flow values in **millions of USD**, with date
 * formatted "Mon DD, YYYY" (e.g. "Apr 23, 2026"). Negative values use
 * a leading `-`. Empty/non-trading days render as `-` and are skipped.
 *
 * The parser pulls the Date and Totals columns, converts dates to
 * ISO YYYY-MM-DD, and multiplies the millions value by 1_000_000 to
 * land net-flow as raw USD — matching the historical CoinGlass shape
 * and the `etfFlowToScore` consumer in `onchain.ts` which expects USD.
 *
 * The exported types ("CoinGlass*") are kept for blast-radius reasons —
 * the consumer route in `ingest-onchain/route.ts` and downstream tests
 * import these symbols. The semantics — fetch BTC Spot ETF daily net
 * flow from a key-free public source — are unchanged.
 *
 * **Unofficial caveat.** Bitbo's HTML structure can change without
 * notice. The parser uses regex-based row scanning to stay robust
 * against trivial markup churn (class renames, attribute additions),
 * but a wholesale table redesign would break it — at which point the
 * right move is Phase 3 Glassnode migration, NOT another HTML scrape
 * patch.
 *
 * Why `netFlow` (not `totalFlow`): blueprint §4.1 on-chain category
 * specifies "BTC Spot ETF 순유입" (net inflow) — net of outflows.
 * Bitbo's "Totals" column is already net of inflows and outflows
 * across the 13 tracked ETFs.
 *
 * Signal mapping (§4.5): ETF flow is NOT a boolean signal; it's an
 * on-chain composite input (§4.1). A failed parse therefore returns
 * `fetch_status: "error"` so the composite's staleness gate triggers
 * rather than silently using a zero flow.
 */

/**
 * One daily observation of BTC Spot ETF net flow.
 */
export interface CoinGlassEtfFlowObservation {
  /** Calendar date of the observation, YYYY-MM-DD. */
  date: string;
  /** Net flow in USD (inflows minus outflows). */
  netFlow: number;
}

export type CoinGlassFetchStatus = "success" | "error" | "partial" | "stale";

export interface CoinGlassEtfFlowResult {
  /** All observations in chronological ascending order. */
  observations: CoinGlassEtfFlowObservation[];
  /** Most recent observation, or null if none could be parsed. */
  latest: CoinGlassEtfFlowObservation | null;
  fetch_status: CoinGlassFetchStatus;
  /** Populated when fetch_status !== "success". */
  error?: string;
  /** ISO timestamp of parse completion. */
  fetched_at: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const MONTH_INDEX: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

/**
 * Pure parser for the BTC Spot ETF flow response.
 *
 * Accepts two shapes for forwards/backwards compat:
 *  1. **HTML string** (current path) — Bitbo `/treasuries/etf-flows/`
 *     table markup. Parsed via tag-stripping regex; we pull the Date
 *     column and the last numeric column (Totals).
 *  2. **JSON object** (legacy CoinGlass shape) — `{code, msg, data: [...]}`
 *     with `data[].{date, netFlow}`. Kept so legacy fixtures + a future
 *     swap back to a JSON source don't require parser surgery.
 *
 * Never throws. Any unexpected payload shape yields a well-formed
 * error result; individual malformed rows are skipped so one bad
 * entry does not poison the batch.
 */
export function parseCoinGlassEtfFlowResponse(
  body: unknown,
): CoinGlassEtfFlowResult {
  if (body === null || body === undefined) {
    return makeErrorResult("CoinGlass response was null/undefined");
  }

  if (typeof body === "string") {
    return parseHtml(body);
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    return makeErrorResult("CoinGlass response was not an object");
  }

  return parseJson(body as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// HTML parser (Bitbo treasuries/etf-flows)
// ---------------------------------------------------------------------------

/**
 * Parse Bitbo's `/treasuries/etf-flows/` HTML table.
 *
 * Strategy:
 *   1. Locate every `<tr>...</tr>` block.
 *   2. Strip tags from each block's inner content to get cell text.
 *   3. Drop rows whose first cell isn't a "Mon DD, YYYY" date — this
 *      filters header rows + summary rows ("Total", "Average", etc).
 *   4. Anchor on the LAST cell as Totals. Bitbo's table puts Totals
 *      after 13 individual ETF columns. We do NOT walk left for a
 *      fallback: if the Totals cell is `-` (non-trading day or partial
 *      render), walking left would pick a per-ETF column and produce a
 *      ~10× wrong netFlow. Skip the row instead.
 *   5. Multiply by 1_000_000 (table values are in US$m).
 *   6. Skip rows where the Totals cell is `-` or empty (non-trading days).
 */
function parseHtml(html: string): CoinGlassEtfFlowResult {
  const observations: CoinGlassEtfFlowObservation[] = [];
  let droppedRows = 0;

  // Match <tr>...</tr> non-greedy across newlines.
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;

  let match: RegExpExecArray | null;
  while ((match = rowRegex.exec(html)) !== null) {
    const inner = match[1];
    const cells = extractCells(inner);
    if (cells.length < 2) continue;

    const date = parseTableDate(cells[0]);
    if (date === null) {
      // Header / summary / non-data row — silently skip. Don't count
      // as dropped: those rows are expected.
      continue;
    }

    // Anchor on the LAST cell — the Totals column. If that specific
    // cell is `-` / `—` / empty (non-trading day or partial render),
    // skip the row. Critically, do NOT walk left for a fallback: the
    // next-rightmost cell is a per-ETF column whose value is ~10× too
    // small to use as the aggregate netFlow.
    const totalsCell = cells[cells.length - 1];
    const totalsTrim = (totalsCell ?? "").trim();
    if (totalsTrim === "" || totalsTrim === "-" || totalsTrim === "—") {
      // Non-trading day — expected, not a parse error. Don't count
      // as dropped (matches the "header row" skip semantics above).
      continue;
    }

    const millions = parseSignedDecimal(totalsTrim);
    if (millions === null) {
      droppedRows++;
      continue;
    }

    observations.push({
      date,
      netFlow: Math.round(millions * 1_000_000),
    });
  }

  if (observations.length === 0) {
    // No data rows at all — could be Cloudflare interstitial or markup
    // overhaul. Treat as error so the staleness gate triggers and the
    // dashboard renders a "stale" badge rather than a zero-flow score.
    return {
      observations: [],
      latest: null,
      fetch_status: "error",
      error:
        droppedRows > 0
          ? `parsed ${droppedRows} row(s) but extracted 0 observations`
          : "no ETF-flow rows found in HTML",
      fetched_at: new Date().toISOString(),
    };
  }

  // Sort ascending by date — defensive against upstream order drift.
  observations.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  const status: CoinGlassFetchStatus = droppedRows > 0 ? "partial" : "success";
  return {
    observations,
    latest: observations[observations.length - 1],
    fetch_status: status,
    error:
      droppedRows > 0
        ? `dropped ${droppedRows} malformed row(s) during HTML parse`
        : undefined,
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Pull `<td>` / `<th>` cell text from a row's inner HTML. Strips
 * tags within each cell and trims whitespace + non-breaking spaces.
 */
function extractCells(rowInner: string): string[] {
  const cells: string[] = [];
  const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m: RegExpExecArray | null;
  while ((m = cellRegex.exec(rowInner)) !== null) {
    const text = m[1]
      .replace(/<[^>]+>/g, " ") // strip nested tags
      .replace(/&nbsp;/gi, " ")
      .replace(/&amp;/gi, "&")
      .replace(/\s+/g, " ")
      .trim();
    cells.push(text);
  }
  return cells;
}

/**
 * Convert a "Mon DD, YYYY" string to YYYY-MM-DD. Returns null on any
 * non-match — important for filtering out header rows ("Date") and
 * summary rows ("Total", "Average", "Maximum", "Minimum") which all
 * fail this regex naturally.
 */
function parseTableDate(raw: string): string | null {
  // Examples that should match: "Apr 23, 2026", "Apr  23, 2026",
  //   "April 23, 2026" (some Bitbo months are unabbreviated).
  const m = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(raw.trim());
  if (!m) return null;

  const monthKey = m[1].slice(0, 3).toLowerCase();
  const month = MONTH_INDEX[monthKey];
  if (!month) return null;

  const day = m[2].padStart(2, "0");
  if (Number(day) < 1 || Number(day) > 31) return null;

  const year = m[3];
  const iso = `${year}-${month}-${day}`;
  return ISO_DATE.test(iso) ? iso : null;
}

/**
 * Parse "1,234.5" or "-243.3" or "0" into a finite number, or null.
 */
function parseSignedDecimal(raw: string): number | null {
  const stripped = raw.replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(stripped)) return null;
  const n = Number(stripped);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Legacy JSON parser (kept for fixture compat + future re-swap)
// ---------------------------------------------------------------------------

function parseJson(bodyObj: Record<string, unknown>): CoinGlassEtfFlowResult {
  // CoinGlass wraps responses with `code: "0"` for success; anything
  // else is an error payload. Treat non-success codes as a fetch error
  // even when HTTP status was 200.
  if ("code" in bodyObj) {
    const code = bodyObj["code"];
    const codeStr = typeof code === "string" ? code : String(code);
    if (codeStr !== "0") {
      const msg = typeof bodyObj["msg"] === "string" ? bodyObj["msg"] : codeStr;
      return makeErrorResult(`CoinGlass error code ${codeStr}: ${msg}`);
    }
  }

  const rawData = bodyObj["data"];
  if (!Array.isArray(rawData)) {
    return makeErrorResult("CoinGlass response missing data[]");
  }

  const observations: CoinGlassEtfFlowObservation[] = [];
  for (const entry of rawData) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const rec = entry as { date?: unknown; netFlow?: unknown };
    if (typeof rec.date !== "string" || !ISO_DATE.test(rec.date)) continue;
    if (typeof rec.netFlow !== "number" || !Number.isFinite(rec.netFlow))
      continue;
    observations.push({ date: rec.date, netFlow: rec.netFlow });
  }

  if (observations.length === 0) {
    return {
      observations: [],
      latest: null,
      fetch_status: "partial",
      error: "no observations after parsing",
      fetched_at: new Date().toISOString(),
    };
  }

  observations.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );

  return {
    observations,
    latest: observations[observations.length - 1],
    fetch_status: "success",
    fetched_at: new Date().toISOString(),
  };
}

/**
 * Build a canonical error-shape result. Exported for reuse by the
 * fetcher wrapper on network/HTTP failure.
 */
export function makeErrorResult(message: string): CoinGlassEtfFlowResult {
  return {
    observations: [],
    latest: null,
    fetch_status: "error",
    error: message,
    fetched_at: new Date().toISOString(),
  };
}
