import { Badge } from "@/components/ui/badge";
import { getSupabaseServerClient } from "@/lib/supabase/server";

import { SignOutButton } from "./sign-out-button";

/**
 * Server Component that renders the current user's email + persona
 * badge + sign-out button. Must be rendered inside a `<Suspense>`
 * boundary because it reads `cookies()` (via the Supabase server
 * client) at request time, which is a runtime API under the
 * `cacheComponents: true` regime — rendering it at the top level of a
 * page or layout would fail the prerender.
 *
 * Uses `getClaims()` instead of `getUser()` to avoid a round-trip to
 * Supabase: the JWT already carries email + user_metadata and is
 * validated locally by `getClaims`.
 */
export async function UserDisplay() {
  const supabase = await getSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    // The proxy should have redirected unauthenticated users away from
    // protected routes before reaching this component, but render
    // defensively in case the layout is reached via an unexpected path.
    return null;
  }

  // The Supabase JWT payload carries `email` (from auth.users.email) and
  // `user_metadata` (the object passed at admin-createUser time). Neither
  // field is part of the base JwtPayload type, so we narrow explicitly.
  const narrowed = claims as { email?: string; user_metadata?: { persona?: string } };
  const email = narrowed.email ?? "";
  const persona = narrowed.user_metadata?.persona ?? "intermediate";

  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right sm:block">
        <p className="text-xs text-muted-foreground">{email}</p>
      </div>
      <Badge variant="secondary">{PERSONA_LABELS[persona] ?? persona}</Badge>
      <SignOutButton />
    </div>
  );
}

const PERSONA_LABELS: Record<string, string> = {
  beginner: "초보자",
  intermediate: "중급자",
  expert: "숙련자",
};
