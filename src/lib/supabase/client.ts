import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

/**
 * Supabase client for Client Components (browser).
 *
 * `createBrowserClient` from `@supabase/ssr` returns a singleton within
 * the browser process, so calling this repeatedly is cheap. Uses the
 * anon key + session cookies managed automatically by the SDK.
 *
 * Only call this inside `"use client"` components (login form, interactive
 * UI). For Server Components / Route Handlers use
 * {@link getSupabaseServerClient}.
 */
export function getSupabaseBrowserClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
