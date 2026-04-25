/**
 * Pure BTC Spot ETF net-flow response parser.
 *
 * **History.** Targets have churned three times:
 *
 *   1. CoinGlass v2 JSON (`open-api.coinglass.com/public/v2/...`) — went
 *      500 in 2026, then v4 paywalled.
 *   2. Bitbo HTML (`bitbo.io/treasuries/etf-flows/`) — works from local
 *      curl with a Chrome UA but consistently 500s from Vercel Fluid
 *      Compute IPs (production smoke 2026-04-25). Header tuning didn't
 *      recover the source — the block is IP/ASN-based, not UA-based.
 *   3. **Current — Farside Investors HTML** (`farside.co.uk/btc/`).
 *      The canonical upstream that the previous two aggregators pulled
 *      from. Free, key-free, server-side rendered. Verified working
 *      from local 2026-04-25 with the full Chrome UA + Accept-Language
 *      tuple set in `coinglass.ts` (a minimal UA gets 403).
 *
 * **HTML shape (Farside /btc/).** A single data table with a 3-row
 * thead (provider icons, ticker symbol row, fee row), then `<tbody>`
 * with one `<tr>` per trading day:
 *
 * ```html
 * <tr>
 *   <td><span class="tabletext">06 Apr 2026</span></td>
 *   <td><div align="right"><span class="tabletext">181.9</span></div></td>
 *   ... 11 more per-ETF cells ...
 *   <td><div align="right"><span class="tabletext">471.4</span></div></td>
 * </tr>
 * ```
 *
 * Per-day columns: IBIT, FBTC, BITB, ARKB, BTCO, EZBC, BRRR, HODL,
 * BTCW, MSBT, GBTC, BTC (mini), Total. Tail-end summary rows (Average,
 * Minimum, Maximum, Std Dev, Total) follow the same `<tr><td>...</td></tr>`
 * shape but their first cell is a label like "Average" — the
 * date-prefix regex filter drops them naturally.
 *
 * Two key shape differences from the old Bitbo parser:
 *
 *   1. **Date format.** Farside uses `DD Mon YYYY` ("06 Apr 2026"),
 *      British convention — opposite cell order from Bitbo's
 *      `Mon DD, YYYY`. The parser accepts BOTH so a future re-swap
 *      to a US-format mirror doesn't require parser surgery.
 *   2. **Negative values.** Farside uses accountancy parentheses with
 *      a `<span class="redFont">` highlight: `(17.1)` means -17.1.
 *      Bitbo used a leading `-`. The numeric parser strips the span
 *      then converts `(X)` → `-X` before parsing.
 *
 * Empty/non-trading days are rendered as `-` and skipped (same as
 * Bitbo). Values are millions USD.
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
 * **Unofficial caveat.** Farside is hand-styled HTML (no React/Vue/
 * Plotly Dash dynamism — pure SSR), which is good for stability but
 * means a future redesign WILL be a parser-breaking event. Mitigations:
 * the parser uses tag-stripping regex against `<tr>` blocks (immune to
 * class renames + attribute additions), and the file-header `coinglass.ts`
 * lays out the Phase 3 Glassnode escalation path if Farside ever flips
 * to a SPA / paywall.
 *
 * Why `netFlow` (not `totalFlow`): blueprint §4.1 on-chain category
 * specifies "BTC Spot ETF 순유입" (net inflow) — net of outflows.
 * Farside's rightmost column is the across-ETF Total, already net of
 * inflows and outflows across the 12 tracked spot tickers.
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
// HTML parser (Farside /btc/ — also still accepts the older Bitbo shape
// for fixture/regression continuity, since both tables look structurally
// identical from a regex POV.)
// ---------------------------------------------------------------------------

/**
 * Parse Farside's `/btc/` HTML table (also handles the legacy Bitbo
 * `/treasuries/etf-flows/` shape transparently — the only structural
 * deltas between the two are the date format and the negative-number
 * notation, both handled in `parseTableDate` / `parseSignedDecimal`).
 *
 * Strategy:
 *   1. Locate every `<tr>...</tr>` block.
 *   2. Strip tags from each block's inner content to get cell text.
 *   3. Drop rows whose first cell isn't a date — this filters the
 *      3-row Farside header (icons / ticker / fee) and the tail-end
 *      summary rows (Average, Minimum, Maximum, Std Dev, Total) without
 *      special-casing them.
 *   4. Anchor on the LAST cell as Totals. We do NOT walk left for a
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
 * Convert a date string to YYYY-MM-DD. Returns null on any non-match
 * — important for filtering out header rows ("Date") and summary rows
 * ("Total", "Average", "Maximum", "Minimum") which all fail naturally.
 *
 * Two formats are accepted:
 *   - **`DD Mon YYYY`** ("06 Apr 2026") — Farside's British convention.
 *   - **`Mon DD, YYYY`** ("Apr 23, 2026") — legacy Bitbo / US convention.
 *
 * Both formats are tried in order; the first match wins. Month names
 * may be 3-letter abbreviations or fully spelled out.
 */
function parseTableDate(raw: string): string | null {
  const trimmed = raw.trim();

  // Format A — Farside: "06 Apr 2026".
  let monthName: string | null = null;
  let dayStr: string | null = null;
  let yearStr: string | null = null;

  const farsideMatch = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec(trimmed);
  if (farsideMatch) {
    dayStr = farsideMatch[1];
    monthName = farsideMatch[2];
    yearStr = farsideMatch[3];
  } else {
    // Format B — legacy Bitbo / US: "Apr 23, 2026".
    const usMatch = /^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/.exec(trimmed);
    if (usMatch) {
      monthName = usMatch[1];
      dayStr = usMatch[2];
      yearStr = usMatch[3];
    }
  }

  if (!monthName || !dayStr || !yearStr) return null;

  const monthKey = monthName.slice(0, 3).toLowerCase();
  const month = MONTH_INDEX[monthKey];
  if (!month) return null;

  const day = dayStr.padStart(2, "0");
  const dayNum = Number(day);
  if (dayNum < 1 || dayNum > 31) return null;

  const iso = `${yearStr}-${month}-${day}`;
  return ISO_DATE.test(iso) ? iso : null;
}

/**
 * Parse a numeric cell into a finite number, or null.
 *
 * Accepts:
 *   - Plain decimals: `"1234"`, `"167.1"`, `"0"`
 *   - Comma-thousands: `"1,234.5"`
 *   - Leading-minus negatives: `"-243.3"` (Bitbo / US convention)
 *   - **Parenthesized negatives: `"(17.1)"`** (Farside / accountancy convention)
 *
 * The parenthesized-negative path is critical: Farside wraps every
 * negative net-flow in `(X)` plus a `<span class="redFont">` highlight.
 * Without this branch, every outflow day would be silently dropped as
 * "malformed" — turning the 90-day z-score into an inflows-only series
 * that would mis-fire the on-chain composite high.
 */
function parseSignedDecimal(raw: string): number | null {
  const trimmed = raw.trim();

  // Detect accountancy parentheses: "(17.1)" → negative.
  let candidate = trimmed;
  let negate = false;
  const parenMatch = /^\((.+)\)$/.exec(candidate);
  if (parenMatch) {
    candidate = parenMatch[1].trim();
    negate = true;
  }

  const stripped = candidate.replace(/,/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(stripped)) return null;
  const n = Number(stripped);
  if (!Number.isFinite(n)) return null;
  return negate ? -n : n;
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
