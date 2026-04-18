"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Renders a logout button that calls `supabase.auth.signOut()` and
 * hard-navigates to `/login`. Same hard-nav rationale as login:
 * `router.replace` can race with cookie deletion, so we force a full
 * reload and let the proxy re-evaluate auth state with a clean jar.
 */
export function SignOutButton() {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const supabase = getSupabaseBrowserClient();

  async function handleSignOut() {
    setIsSigningOut(true);
    try {
      await supabase.auth.signOut();
    } finally {
      // Always navigate — if signOut failed server-side (network error)
      // the local session is still cleared by the client, so routing to
      // /login is the right recovery.
      window.location.assign("/login");
    }
  }

  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={handleSignOut}
      disabled={isSigningOut}
    >
      {isSigningOut ? "로그아웃 중..." : "로그아웃"}
    </Button>
  );
}
