/**
 * Validates a user-supplied post-auth redirect target and returns a safe
 * relative path. Prevents classic open-redirect payloads:
 *
 *   /dashboard                  → /dashboard            (allowed)
 *   /asset/btc?range=30d        → /asset/btc?range=30d  (allowed)
 *   //evil.com/steal            → fallback              (protocol-relative)
 *   /\evil.com                  → fallback              (backslash path-bypass)
 *   https://evil.com            → fallback              (absolute)
 *   javascript:alert(1)         → fallback              (scheme)
 *   (empty / undefined)         → fallback
 *
 * Browsers interpret `//host/path` as protocol-relative — a navigation
 * to `//evil.com` becomes `https://evil.com`. Blocking the `//` and `/\`
 * prefixes plus requiring the first byte to be `/` is sufficient to
 * force the redirect target onto the same origin.
 */
export function safeRelativePath(
  candidate: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!candidate) return fallback;
  if (!candidate.startsWith("/")) return fallback;
  if (candidate.startsWith("//")) return fallback;
  if (candidate.startsWith("/\\")) return fallback;
  return candidate;
}
