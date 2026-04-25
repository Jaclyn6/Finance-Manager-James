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
 *   - 429 (rate limit) → retry by default; opt-out via `retryOnRateLimit:false`
 *     for sources with a hard per-window quota (e.g. BGeometrics 8/hr)
 *     where in-window retries can never succeed and only burn quota.
 *   - 5xx (server error) → retry
 *   - 4xx other than 429 (client error, invalid request) → no retry
 *   - Network errors / per-attempt timeouts → retried up to `maxRetries`
 *     with the same exponential delay as HTTP-level retries. On the
 *     final attempt the error is re-thrown so the outer fetcher can
 *     fold it into its standard `fetch_status: "error"` result. This
 *     matches how 429/5xx are handled (both are transient-ish); a
 *     single unlucky DNS blip shouldn't zero out a cron cycle.
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
  /**
   * Whether to retry on HTTP 429 (rate-limit). Default `true`.
   *
   * Set to `false` when the upstream's rate limit is a HARD per-window
   * quota that won't replenish within back-off seconds — e.g.
   * BGeometrics' "8 requests per hour per IP" tier. Retrying inside the
   * window just burns more slots and guarantees the same 429 on the
   * next attempt; instead, fail fast and let the caller fold the 429
   * into a `fetch_status: "error"` result so the staleness gate
   * triggers cleanly. 5xx retries remain on regardless of this flag —
   * server errors are typically transient and worth retrying.
   */
  retryOnRateLimit?: boolean;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INITIAL_DELAY_MS = 500;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRY_ON_RATE_LIMIT = true;

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
  const retryOnRateLimit =
    options.retryOnRateLimit ?? DEFAULT_RETRY_ON_RATE_LIMIT;

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Fresh AbortController per attempt — a retry must never reuse an
    // already-aborted signal from the previous attempt's timeout.
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // Always pass the per-attempt controller's signal to fetch — a
      // `init.signal ?? controller.signal` merge would silently bypass
      // the timeout whenever a caller happens to set `signal` on init
      // (our Phase 2 callers currently don't, but the merge is a
      // latent foot-gun). If a future caller needs parent-cancel
      // chaining, extend this helper to `addEventListener("abort", ...)`
      // on `init.signal` and forward to `controller.abort()`.
      const { signal: _callerSignalIgnored, ...initWithoutSignal } = init;
      void _callerSignalIgnored;
      const response = await fetch(url, {
        ...initWithoutSignal,
        signal: controller.signal,
      });
      lastResponse = response;
      lastError = null;

      // Retry only on 429 + 5xx. 4xx other than 429 is terminal —
      // retrying a 400/401/403/404 won't change the answer and wastes
      // the budget. Callers facing a HARD per-hour quota (BGeometrics
      // 8/hr) can opt out of the 429 branch via `retryOnRateLimit:false`
      // so retries don't drain remaining slots inside the window.
      const shouldRetry =
        (response.status === 429 && retryOnRateLimit) ||
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
