import "server-only";

import { redactSecretsFromErrorMessage } from "./_redact";
import {
  parseEcosResponse,
  makeErrorResult,
  type EcosObservation,
  type EcosFetchResult,
  type EcosFetchStatus,
} from "./ecos-parse";

/**
 * ECOS (한국은행 OpenAPI) statistic-search fetcher.
 *
 * One call = one stat code (optionally narrowed by ITEM_CODE1) =
 * one chronological observation series. Phase 3.1 Step 1 — mirrors
 * the FRED adapter pattern in `fred.ts`.
 *
 * Design choices:
 *
 * 1. **Never throws on upstream failure.** Network errors, non-200 HTTP,
 *    malformed JSON, ECOS error envelopes (`INFO-100`/`INFO-200`) all
 *    return an `EcosFetchResult` with `fetch_status: "error"`. The
 *    Phase 3.1 Step 3 cron will loop over series and must not let one
 *    bad series poison the run.
 *
 * 2. **Hard 15s timeout per call** via `AbortController`. ECOS responses
 *    are normally <1s; the timeout is a circuit-breaker for the rare
 *    upstream hang.
 *
 * 3. **`cache: "no-store"`.** Cron-driven; always wants fresh data.
 *
 * 4. **Pure parser extracted to `ecos-parse.ts`.** Keeps Vitest free of
 *    the `"server-only"` guard.
 *
 * 5. **`import "server-only"` guard.** ECOS_API_KEY must never leak to
 *    browser bundles.
 *
 * 6. **API key is a path segment, not a query param.** ECOS embeds the
 *    key directly in the URL between `/StatisticSearch/` and `/json`,
 *    which is different from FRED. We `encodeURIComponent` the key so
 *    a future key with `/` or `?` in it can't break the URL parse.
 */

export type { EcosObservation, EcosFetchStatus, EcosFetchResult };
export { parseEcosResponse };

export interface FetchEcosSeriesOptions {
  /**
   * ECOS frequency code:
   *   D = daily, M = monthly, Q = quarterly, A = annual.
   *
   * Must match the cycle the underlying stat code publishes at —
   * passing `D` to a monthly-only stat returns `INFO-200`.
   */
  cycle: "D" | "M" | "Q" | "A";
  /**
   * Window start in the format ECOS expects for the chosen cycle:
   * `YYYYMMDD` for D, `YYYYMM` for M, `YYYYQ#` for Q, `YYYY` for A.
   */
  from: string;
  /**
   * Window end (same format as `from`).
   */
  to: string;
  /**
   * Optional `ITEM_CODE1` filter. Required for stat codes that group
   * multiple series under one code (e.g. `722Y001` flattens BOK base
   * rate + 정부대출금금리 + 자금조정 대출/예금금리 etc.). When omitted
   * the parser returns every row regardless of item code.
   */
  itemCode?: string;
  /**
   * 1-based pagination ceiling. ECOS caps at ~10000 rows per call;
   * default is generous enough for a 10-year daily series.
   */
  endRow?: number;
}

const ECOS_BASE_URL = "https://ecos.bok.or.kr/api/StatisticSearch";
const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_END_ROW = 10_000;

/**
 * Fetch one ECOS series and return a parsed, scoring-ready result.
 * Never throws on network/HTTP/upstream failure. Throws only when
 * `ECOS_API_KEY` is unset — a config error, not transient.
 */
export async function fetchEcosSeries(
  seriesCode: string,
  options: FetchEcosSeriesOptions,
): Promise<EcosFetchResult> {
  const apiKey = process.env.ECOS_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ECOS_API_KEY is not set — add it to .env.local (dev) or Vercel env (prod)",
    );
  }

  const startRow = 1;
  const endRow = options.endRow ?? DEFAULT_END_ROW;

  // Path-segment API: each piece is a discrete segment, so encode each
  // one individually rather than building a single template literal.
  const segments = [
    encodeURIComponent(apiKey),
    "json",
    "kr",
    String(startRow),
    String(endRow),
    encodeURIComponent(seriesCode),
    encodeURIComponent(options.cycle),
    encodeURIComponent(options.from),
    encodeURIComponent(options.to),
  ];
  const url = `${ECOS_BASE_URL}/${segments.join("/")}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });

    if (!response.ok) {
      return makeErrorResult(
        seriesCode,
        options.itemCode,
        `ECOS HTTP ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as unknown;
    return parseEcosResponse(seriesCode, body, options.itemCode);
  } catch (err) {
    const rawMessage =
      err instanceof Error && err.name === "AbortError"
        ? `ECOS request timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    // undici can include the full request URL (path-segment key and all)
    // in DNS / ECONNRESET messages. Redact before the string lands in
    // ecos_readings.fetch_status / ingest_runs.error_summary.
    return makeErrorResult(
      seriesCode,
      options.itemCode,
      redactSecretsFromErrorMessage(rawMessage),
    );
  } finally {
    clearTimeout(timeoutId);
  }
}
