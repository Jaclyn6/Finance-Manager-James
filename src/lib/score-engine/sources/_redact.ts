/**
 * Secret redaction helpers for data-source error messages.
 *
 * Context: Node.js `fetch` (undici) has been observed to include the
 * full request URL — including query-string parameters — in some
 * network-level error messages (ECONNRESET, DNS failures, proxy
 * issues). Two of our Phase 2 sources bear API keys in the query
 * string:
 *   - Alpha Vantage: `?apikey=<key>`
 *   - Finnhub: `?token=<key>`
 *
 * If we copied `err.message` verbatim into the `fetch_status: "error"`
 * result's `error` field, a rare class of network errors could leak
 * the key into cron logs and the `ingest_runs.error_summary` DB
 * column (readable to any authenticated family member). The other
 * five Phase 2 sources are keyless so their error messages cannot
 * carry secrets.
 *
 * Intentionally pure (no `import "server-only"`) so Vitest and any
 * Node-env backfill script can exercise the regex without the
 * server-only guard. The caller files (`alpha-vantage.ts`,
 * `finnhub.ts`) still carry the guard at their module level.
 */

const SECRET_QUERY_PARAM_PATTERN =
  /([?&])(apikey|token)=[^&\s"'<>]+/gi;

// ECOS embeds the API key as a URL path segment between `/api/StatisticSearch/`
// and `/json/`. Match the segment after the endpoint name so any future ECOS
// endpoint variant (`/StatisticItemList/`, `/StatisticTableList/`, etc.) is
// covered too. Capture group 1 = endpoint name; replacement preserves it.
const ECOS_PATH_KEY_PATTERN =
  /(\/api\/[A-Za-z]+\/)[^/\s"'<>]+(\/json\/)/g;

/**
 * Return a copy of `message` with any `apikey=...`, `token=...`, or
 * ECOS path-segment keys replaced by `REDACTED`. Idempotent; safe to
 * call on already-redacted strings.
 */
export function redactSecretsFromErrorMessage(message: string): string {
  return message
    .replace(SECRET_QUERY_PARAM_PATTERN, "$1$2=REDACTED")
    .replace(ECOS_PATH_KEY_PATTERN, "$1REDACTED$2");
}
