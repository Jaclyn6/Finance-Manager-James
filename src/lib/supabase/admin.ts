import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Supabase admin client — uses the service-role key. Bypasses RLS.
 *
 * Use exclusively from trusted server-side code paths that need to write
 * data on behalf of the system (Phase 1: the cron route handler at
 * `/api/cron/ingest-macro`). Never import from a Client Component or any
 * file reachable via a `"use client"` import chain — the service role
 * key is a write-everywhere credential and must not ship to browsers.
 *
 * Not a singleton: create per-invocation so that long-lived server
 * instances don't accidentally share auth state. Auth session management
 * is disabled since there is no user to refresh tokens for.
 */
export function getSupabaseAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
