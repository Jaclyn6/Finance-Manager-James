"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

/**
 * Renders a logout button that calls `supabase.auth.signOut()` and
 * hard-navigates to `/login`. Same hard-nav rationale as login:
 * `router.replace` can race with cookie deletion, so we force a full
 * reload and let the proxy re-evaluate auth state with a clean jar.
 *
 * Error handling: if `signOut()` returns an error whose status is
 * anything other than "already signed out" (401 / 403 / 404), the
 * Supabase client does not clear the local session — so navigating to
 * `/login` anyway would infinite-loop (proxy sees a still-valid cookie,
 * redirects back to `/dashboard`). We surface the failure to the user
 * and let them retry instead.
 */
export function SignOutButton() {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const supabase = getSupabaseBrowserClient();

  async function handleSignOut() {
    setErrorMessage(null);
    setIsSigningOut(true);

    const { error } = await supabase.auth.signOut();

    if (error) {
      // Statuses 401/403/404 mean the session is already gone from the
      // server's perspective — safe to navigate anyway. Any other error
      // means the session is likely still valid server-side; don't
      // navigate or we'll loop.
      const isAlreadyGone =
        error.status === 401 || error.status === 403 || error.status === 404;
      if (!isAlreadyGone) {
        setErrorMessage("로그아웃에 실패했습니다. 잠시 후 다시 시도해 주세요.");
        setIsSigningOut(false);
        return;
      }
    }

    window.location.assign("/login");
  }

  return (
    <div className="flex items-center gap-2">
      {errorMessage && (
        <span role="alert" className="text-xs text-destructive">
          {errorMessage}
        </span>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={handleSignOut}
        disabled={isSigningOut}
        className="h-11 min-w-11 px-3"
      >
        {isSigningOut ? "로그아웃 중..." : "로그아웃"}
      </Button>
    </div>
  );
}
