import { NextResponse, type NextRequest } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { safeRelativePath } from "@/lib/utils/redirect";

/**
 * OAuth / magic-link PKCE callback.
 *
 * Phase 1 family-only login uses email + password, so this route exists
 * as a safety net rather than a primary path. If Supabase ever issues
 * a magic link (for example via the Admin API's password-reset flow),
 * the follow-up redirect lands here with a `code` param. We exchange
 * the code for a session cookie, then bounce the user back to `next`
 * (which defaults to /dashboard).
 *
 * The proxy config excludes `/api/auth/*` from redirect logic so that
 * this route can run before the session cookie is set.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Must be validated before any redirect — a raw `next` from the URL can be
  // a protocol-relative hijack target (e.g. "//evil.com/path"), see
  // lib/utils/redirect.ts for the rationale.
  const nextPath = safeRelativePath(searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const supabase = await getSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    const failureUrl = new URL("/login", origin);
    failureUrl.searchParams.set("error", error.message);
    return NextResponse.redirect(failureUrl);
  }

  return NextResponse.redirect(`${origin}${nextPath}`);
}
