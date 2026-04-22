/**
 * Pure CoinGlass BTC Spot ETF net-flow response parser.
 *
 * **Unofficial API caveat.** CoinGlass (open-api.coinglass.com) exposes
 * a public indicator endpoint for BTC Spot ETF flow, but the endpoint
 * is NOT covered by a versioned stability contract. The response shape
 * below is a defensive best-effort based on observable behaviour at
 * authoring time (2026-04-23):
 *
 * ```json
 * {
 *   "code": "0",
 *   "msg": "success",
 *   "data": [
 *     { "date": "2026-04-22", "netFlow": 135000000, "totalFlow": 155000000 }
 *   ]
 * }
 * ```
 *
 * The real live endpoint MUST be verified at Phase 2 Step 7 (cron
 * implementation). If the shape differs (e.g. different key names,
 * timestamps in place of date strings, absence of top-level `code`),
 * update this parser and coinglass.test.ts — don't paper over the
 * mismatch inside the fetcher.
 *
 * Why `netFlow` (not `totalFlow`): blueprint §4.1 on-chain category
 * specifies "BTC Spot ETF 순유입" (net inflow) — net of outflows. That
 * is the signal-relevant quantity. `totalFlow` (gross) is kept out of
 * the parsed result to keep downstream consumers from reaching for the
 * wrong field.
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

/**
 * Pure parser for the CoinGlass BTC Spot ETF flow response.
 *
 * Never throws. Any unexpected payload shape yields a well-formed error
 * result; individual malformed rows are skipped so one bad entry does
 * not poison the batch.
 */
export function parseCoinGlassEtfFlowResponse(
  body: unknown,
): CoinGlassEtfFlowResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return makeErrorResult("CoinGlass response was not an object");
  }

  const bodyObj = body as Record<string, unknown>;

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

  // Sort ascending by date — cheap insurance against upstream order drift.
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
