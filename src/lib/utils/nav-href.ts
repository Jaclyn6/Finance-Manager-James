/**
 * Builds an `href` that preserves the currently-selected `?date=`
 * across navigation (blueprint §6.1 URL contract).
 *
 * Why a helper and not inline concatenation: all three protected
 * pages (`/dashboard`, `/asset/[slug]`, `/changelog`) honor `?date=`,
 * and users expect picking "2026-03-15" on the dashboard then clicking
 * "미국주식" in the sidebar to keep them anchored at 2026-03-15. A
 * centralized helper means the two navigation surfaces (sidebar,
 * mobile drawer) can never accidentally strip the param.
 *
 * Accepts `null`/`undefined` for the param value so callers (mostly
 * Client Components using `useSearchParams()`) can pass the hook's
 * result directly without defensive null checks. The returned string
 * is always suitable for `next/link`'s `href` prop — no leading `?`
 * if there's no date, no trailing `?` or `&` weirdness.
 *
 * Pure — no React, no Next.js imports. Testable in Vitest node env.
 */
export function buildNavHref(
  path: string,
  date: string | null | undefined,
): string {
  if (!date) return path;
  // The caller should have already validated `date` via
  // `sanitizeDateParam` if the value originated from user input, but
  // we defensively URI-encode so a malformed upstream value can't
  // break the URL shape. (`YYYY-MM-DD` doesn't need encoding, but
  // the encoding is cheap and insurance-grade.)
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}date=${encodeURIComponent(date)}`;
}
