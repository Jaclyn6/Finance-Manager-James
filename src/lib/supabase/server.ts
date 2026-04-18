import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import type { Database } from "@/types/database";

/**
 * Supabase client for Server Components and Route Handlers.
 *
 * Uses the anon key + the request's cookie store. Respects RLS policies
 * — callers are authenticated via the session cookie set by login /
 * refreshed by the proxy.
 *
 * Cache-safety: this function calls `await cookies()`, which is a runtime
 * API. Do NOT call it inside a `"use cache"` function body — `cookies()`
 * inside a cached scope will fail. In cached code paths, use
 * {@link getSupabaseAdminClient} (service role, no user context) and scope
 * the cache tag appropriately.
 *
 * Called once per request; cookie store is scoped to the request via
 * Next.js's async local storage.
 */
export async function getSupabaseServerClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Server Components cannot mutate cookies; this throws silently.
          // Token refresh happens in the proxy (src/proxy.ts) on navigation,
          // so skipping here is fine.
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            // Read-only context (Server Component). Swallow.
          }
        },
      },
    },
  );
}
