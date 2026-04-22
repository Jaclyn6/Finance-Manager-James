import "server-only";

/**
 * Exponential back-off fetch helper for unofficial-API sources.
 *
 * Phase 2 blueprint §3.1 calls out Bitbo, CoinGlass, and CNN F&G as
 * unofficial endpoints with soft/unpublished rate limits. Unlike FRED
 * (120/min contract) or Alpha Vantage (5/min, 25/day contract) where
 * the cron paces calls at schedule time, these unofficial APIs can
 * flap on load and a single 429/503 would mean zero data that cycle.
 * One retry lifts success rate materially without courting runaway
 * retry storms.
 *
 * Retry policy:
 *   - 429 (rate limit) → retry
 *   - 5xx (server error) → retry
 *   - 4xx other than 429 (client error, invalid request) → no retry
 *   - Network errors → no retry here; the per-attempt AbortController
 *     + `timeoutMs` handles hung connections, and the outer fetcher
 *     catches the rejection to return `fetch_status: "error"`. Wrapping
 *     network-error retry logic in here would double-handle the concern
 *     and mask real connectivity issues during cron runs.
 *   - JSON parse errors → not our concern; caller parses.
 *
 * Delay: exponential, starting at `initialDelayMs` and doubling each
 * retry (500ms, 1s, 2s, …). Defaults give ~3.5s of retry wall time,
 * well under the 15s per-attempt timeout and the 300s Vercel Fluid
 * Compute cap.
 *
 * **Fresh AbortController per attempt.** A retry that reused an already
 * aborted signal would error out before the request even fires; each
 * attempt gets its own controller + timeout pair.
 *
 * NOT used for FRED / Alpha Vantage / Finnhub (official rate-limit
 * contracts — cron paces at schedule time, retries there would just
 * eat into the daily budget).
 */

export interface BackOffOptions {
  /**
   * Additional retry attempts AFTER the first attempt. `2` means up to
   * 3 total attempts (initial + 2 retries). Default 2.
   */
  maxRetries?: number;
  /** First retry delay in ms (doubles each subsequent retry). Default 500. */
  initialDelayMs?: number;
  /** Per-attempt wall-clock timeout in ms. Default 15_000. */
  timeoutMs?: number;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Fetch `url` with retry-on-429/5xx back-off. Returns the final
 * `Response` — whether that's a 200 (success), a terminal 4xx the
 * caller must inspect, or the final 429/5xx if all retries were
 * exhausted. The caller reads `.ok` / `.status` to decide `fetch_status`.
 *
 * Throws only if the per-attempt AbortController timeout fires AND
 * the retry budget is exhausted (bubbles the `AbortError`), or if
 * the underlying `fetch` throws a network error AND the retry budget
 * is exhausted. Both cases are caught by the outer fetcher's
 * try/catch and folded into the standard error-shape result.
 *
 * This function does not itself swallow errors — that would violate
 * the "silent success, loud failure" tenet. Terminal failures propagate
 * to the caller in the shape the caller expects (Response for HTTP
 * failures, thrown error for network/timeout failures).
 */
export async function fetchWithBackOff(
  url: string,
  init: RequestInit,
  options: BackOffOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Fresh AbortController per attempt — a retry must never reuse an
    // already-aborted signal from the previous attempt's timeout.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Honour the caller's signal if they passed one; otherwise use ours.
      const response = await fetch(url, {
        ...init,
        signal: init.signal ?? controller.signal,
      });
      lastResponse = response;
      lastError = null;

      // Retry only on 429 + 5xx. 4xx other than 429 is terminal —
      // retrying a 400/401/403/404 won't change the answer and wastes
      // the budget.
      const shouldRetry =
        response.status === 429 ||
        (response.status >= 500 && response.status < 600);

      if (!shouldRetry) {
        return response;
      }

      // If this was the last attempt, return the bad response and let
      // the caller log .status. Don't synthesize a throw — the Response
      // object carries more useful info than a string message.
      if (attempt === maxRetries) {
        return response;
      }
    } catch (err) {
      // Network error or abort. Record and fall through to the retry
      // gate — but on the last attempt, re-throw so the outer fetcher
      // can fold it into its standard error-shape result.
      lastError = err;
      lastResponse = null;
      if (attempt === maxRetries) {
        throw err;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    // Exponential delay before next attempt: 500ms, 1s, 2s, …
    const delayMs = initialDelayMs * 2 ** attempt;
    await sleep(delayMs);
  }

  // Unreachable in practice — either we return the last response inside
  // the loop or we throw. This satisfies the TS return-type check and
  // is a defensive last-resort guard if the loop structure is ever
  // edited carelessly.
  if (lastResponse) return lastResponse;
  throw lastError ?? new Error("fetchWithBackOff exhausted without a response");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
