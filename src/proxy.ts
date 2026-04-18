import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import type { Database } from "@/types/database";

/**
 * Next.js 16 Proxy — runs at the edge of every matched request.
 *
 * Responsibilities:
 * 1. Refresh the Supabase session cookie (so expired JWTs don't brick
 *    the app on navigation).
 * 2. Read the current JWT claims.
 * 3. Redirect unauthenticated users to /login for protected paths.
 * 4. Redirect authenticated users away from /login to /dashboard.
 *
 * File naming: Next.js 16.0 deprecated the `middleware.ts` convention in
 * favor of `proxy.ts`. Function name must be `proxy`, not `middleware`.
 *
 * Cookie handling: `@supabase/ssr` 0.10.x requires the `getAll`/`setAll`
 * pattern. The `headers` arg to `setAll` carries Cache-Control directives
 * that MUST be forwarded to the response — otherwise a CDN could cache
 * an auth-bearing response and leak it across users.
 */
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // RequestCookies only accepts (name, value) or a RequestCookie
          // object — options are ignored on the request side, which is
          // fine because the request-local copy only needs to influence
          // what the Supabase client reads back within this handler.
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          supabaseResponse = NextResponse.next({ request });
          // ResponseCookies accepts the full options object — this is
          // where we set the real persistent cookie the browser stores.
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
          // Forward cache-control headers (e.g. `Cache-Control: private,
          // no-cache, no-store, max-age=0, must-revalidate`) so that CDNs
          // never cache auth-bearing responses.
          Object.entries(headers).forEach(([key, value]) => {
            supabaseResponse.headers.set(key, value);
          });
        },
      },
    },
  );

  // Always use getClaims() over getSession() — it validates the JWT
  // signature locally, whereas getSession() returns whatever is in the
  // cookie without verification.
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  const path = request.nextUrl.pathname;
  const isProtected =
    path.startsWith("/dashboard") ||
    path.startsWith("/asset") ||
    path.startsWith("/changelog");

  if (isProtected && !claims) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("next", path);
    return withSupabaseCookies(
      NextResponse.redirect(redirectUrl),
      supabaseResponse,
    );
  }

  if (path === "/login" && claims) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return withSupabaseCookies(
      NextResponse.redirect(redirectUrl),
      supabaseResponse,
    );
  }

  return supabaseResponse;
}

/**
 * Copies every cookie written by Supabase during `getClaims()` onto an
 * outbound redirect response. Without this, a token that the Supabase
 * client silently refreshed during the guard check is discarded and the
 * next request still carries the pre-refresh cookie — at best wasting a
 * refresh-token use, at worst leaving an invalidated cookie in the
 * browser jar (when Supabase intended to clear it).
 */
function withSupabaseCookies(
  redirectResponse: NextResponse,
  supabaseResponse: NextResponse,
) {
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

export const config = {
  /**
   * Skip static assets, image optimizer, favicon, the cron route (which
   * is authenticated by `Authorization: Bearer ${CRON_SECRET}` instead
   * of a Supabase session), and the auth callback (which must not be
   * gated by the guard it is trying to establish).
   *
   * Trailing slashes on `api/cron/` and `api/auth/` anchor the exclusion
   * to a segment boundary — without them, a future route like
   * `/api/cronjob` or `/api/authentication` would silently bypass the
   * guard because the regex would still match the `api/auth` prefix.
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron/|api/auth/).*)",
  ],
};
