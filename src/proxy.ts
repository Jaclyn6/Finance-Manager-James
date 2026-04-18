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
    return NextResponse.redirect(redirectUrl);
  }

  if (path === "/login" && claims) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    redirectUrl.search = "";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}

export const config = {
  /**
   * Skip static assets, image optimizer, favicon, the cron route (which
   * is authenticated by `Authorization: Bearer ${CRON_SECRET}` instead
   * of a Supabase session), and the auth callback (which must not be
   * gated by the guard it is trying to establish).
   */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/cron|api/auth).*)",
  ],
};
