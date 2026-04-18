# Phase 1 Blueprint Delta: Next.js 16.2 Reality

> Supplement to `docs/phase1_architecture_blueprint.md`. Scope: Steps 4-12 only. Steps 1-3 (schema, RLS, migrations) are correct as written and not repeated here. Step 6 (Score Engine) is pure functions with no framework dependency — no changes required.
>
> Verified against: `node_modules/next/dist/docs/` shipped with next@16.2.4, `@supabase/ssr` 0.10.2 type declarations at `node_modules/@supabase/ssr/dist/main/`, `@supabase/auth-js` GoTrueClient type declarations, Next.js upgrade guide v16 (in docs/), and nextjs.org live docs (fetched 2026-04-18).

---

## Confidence key

- **VERIFIED** — confirmed in `node_modules/next/dist/docs/` or compiled source, highest trust.
- **LIKELY** — inferred from closely related verified docs, high trust.
- **SPECULATIVE** — best guess, flag for testing before writing code.

---

## Step 4: Auth + Middleware

### 4.1 File and function rename — VERIFIED

ORIGINAL said: create `src/middleware.ts` exporting a function named `middleware`.

Next 16 reality: the `middleware` filename convention is **deprecated and renamed to `proxy`** as of Next.js 16.0. The exported function must be named `proxy`. The mental model is clarified: "proxy" signals the network boundary, not a server processing chain.

- File to create: `src/proxy.ts` (never `src/middleware.ts`)
- Export: `export function proxy(request: NextRequest)`
- The `config` object and `matcher` regex syntax are **unchanged**

Source: `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md` — "v16.0.0: Middleware is deprecated and renamed to Proxy."

### 4.2 Runtime — VERIFIED

Next 16 reality: `proxy` **defaults to Node.js runtime and the Edge runtime is not supported**. Setting `runtime` throws a build error. Zero impact for this project since Supabase SSR has no Edge-only restrictions.

### 4.3 Cookie mutation pattern — VERIFIED

`response.cookies.set()` and `NextResponse.next({ request: { headers } })` work identically. No breaking change.

### 4.4 `@supabase/ssr` 0.10.2 `createServerClient` signature — VERIFIED

ORIGINAL assumed 0.5.x with `get`/`set`/`remove` methods.

Next 16 reality (`@supabase/ssr` 0.10.2): **`get`/`set`/`remove` are deprecated**. Required pattern is `getAll`/`setAll`. **`setAll` now receives a second argument `headers: Record<string, string>`** — cache-control headers that must be forwarded to prevent CDN caching of auth-bearing responses.

Source: `node_modules/@supabase/ssr/dist/main/types.d.ts` — `SetAllCookies` type.

Required `src/proxy.ts` pattern:

```typescript
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value, options }) =>
            request.cookies.set(name, value, options)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value)
          )
        },
      },
    }
  )

  // Validate JWT — never trust getSession() for authorization
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims  // JwtPayload | null

  const path = request.nextUrl.pathname
  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/asset') ||
    path.startsWith('/changelog')

  if (isProtected && !claims) {
    return NextResponse.redirect(new URL('/login', request.url))
  }
  if (path === '/login' && claims) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/cron|api/auth).*)',
  ],
}
```

### 4.5 `getClaims()` return type — VERIFIED

Returns `Promise<{ data: { claims: JwtPayload; header; signature } | null; error: AuthError | null }>`. `claims` contains `sub` (user ID), `role`, `user_metadata`, `app_metadata`, and standard JWT fields. Access as `data?.claims` (not `data?.user`).

Source: `node_modules/@supabase/auth-js/dist/main/GoTrueClient.d.ts` lines 2362-2386.

---

## Step 5: Protected Layout Shell

### 5.1 Async `cookies()` — synchronous compat removed — VERIFIED

Next 16 reality: **the synchronous compatibility shim is fully removed**. Any call to `cookies()` without `await` throws at runtime. Same for `headers()` and `draftMode()`.

```typescript
const cookieStore = await cookies()
const token = cookieStore.get('token')
```

Source: `version-16.md` — "Starting with Next.js 16, synchronous access is fully removed."

### 5.2 Async `params` and `searchParams` — VERIFIED

`params` (in `layout.tsx`, `page.tsx`, `route.ts`) and `searchParams` (in `page.tsx`) are **Promises**. Synchronous compat shim gone.

```typescript
export default async function AssetPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
}
```

Shortcut: run `npx next typegen` once during Step 9 to generate `PageProps<'/asset/[slug]'>` and `LayoutProps` helpers with correct async param types.

---

## Step 7: Data Layer — Caching Strategy

Highest-impact delta. Two valid paths in Next.js 16; **choose one before writing data layer code.**

### PATH A: Previous Model — keep `unstable_cache` — VERIFIED

`unstable_cache` is deprecated but functional. Documented in `caching-without-cache-components.md`.

Changes from blueprint:
1. `unstable_cache` wrapping: unchanged
2. `export const revalidate = 86400` on pages: works
3. `export const dynamic = 'force-dynamic'` on cron route: works
4. `revalidateTag('macro-snapshot')` **→ must become** `revalidateTag('macro-snapshot', { expire: 0 })` (single-arg form is TS error in Next 16)

Source: `unstable_cache.md` — "This API has been replaced by `use cache` in Next.js 16. We recommend opting into Cache Components." Deprecated, not removed.

### PATH B: Cache Components Model — `cacheComponents: true` — VERIFIED (recommended)

All data layer code being written fresh → clean option.

```typescript
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
}

export default nextConfig
```

This single flag replaces the removed experimental flags `dynamicIO`, `useCache`, `ppr`.

Source: `cacheComponents.md` version history — "16.0.0: `cacheComponents` introduced. This flag controls the `ppr`, `useCache`, and `dynamicIO` flags as a single, unified configuration."

Data function pattern:

```typescript
// src/lib/data/snapshot.ts
import { cacheLife, cacheTag } from 'next/cache'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function getLatestSnapshot(assetType: string) {
  'use cache'
  cacheTag('macro-snapshot')
  cacheLife('days')    // stale 5m, revalidate 1d, expire 1w — matches 24h cron cadence

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
      },
    }
  )

  const { data } = await supabase
    .from('composite_snapshots')
    .select('*')
    .eq('asset_type', assetType)
    .order('snapshot_date', { ascending: false })
    .limit(1)
    .single()

  return data
}
```

Page level (replaces `export const revalidate = 86400`):

```typescript
// src/app/(protected)/dashboard/page.tsx
import { cacheLife, cacheTag } from 'next/cache'

export default async function DashboardPage() {
  'use cache'
  cacheTag('macro-snapshot')
  cacheLife('days')
}
```

Important: `'use cache'` **cannot be placed directly in the body of a Route Handler**. Extract to a helper function.

When `cacheComponents: true`, components that access runtime APIs (`cookies()`, `headers()`, `searchParams`) must be wrapped in `<Suspense>` boundaries. Sidebar user display reads session cookie → extract to sub-component inside `<Suspense fallback={<SidebarSkeleton />}>`.

---

## Step 8: Cron Route Handler

### 8.1 `revalidateTag` signature change — VERIFIED

ORIGINAL said: `revalidateTag('macro-snapshot')` (single argument).

Next 16 reality: single-argument form deprecated, produces TS error. Signature is now `revalidateTag(tag: string, profile: string | { expire?: number }): void`.

```typescript
revalidateTag('macro-snapshot', { expire: 0 })
revalidateTag('changelog', { expire: 0 })
```

`{ expire: 0 }` → immediate expiration, next request blocks on fresh fetch. Right for cron-driven "data is now fresh" invalidation.

Source: `revalidateTag.md` — "For webhooks or third-party services that need immediate expiration, you can pass `{ expire: 0 }` as the second argument."

### 8.2 `dynamic = 'force-dynamic'` — path-dependent — VERIFIED

- **Path A**: export still works, correct.
- **Path B** (`cacheComponents: true`): `force-dynamic` **not needed** — all routes dynamic by default. Adding it causes lint/build warning. Remove.

Source: `migrating-to-cache-components.md`.

### 8.3 `Authorization: Bearer $CRON_SECRET` — no change — VERIFIED

`request.headers.get('Authorization')` on `NextRequest` unchanged.

---

## Steps 9-11: Dashboard / Asset Detail / Changelog UI

### 9-11.1 Async `params` — VERIFIED

```typescript
// After `npx next typegen`:
export default async function AssetDetailPage(props: PageProps<'/(protected)/asset/[slug]'>) {
  const { slug } = await props.params
}

// Without typegen:
export default async function AssetDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
}
```

### 9-11.2 `<Suspense>` for auth-dependent UI — VERIFIED (Path B only)

If Path B, components calling `cookies()` at request time must be inside `<Suspense>`. The sidebar user display reads session cookie → sub-component inside `<Suspense fallback={<SidebarSkeleton />}>`.

Path A: `<Suspense>` optional, behaves as Next 15.

Source: `caching.md` — "Next.js requires you to explicitly handle components that can't complete during prerendering."

### 9-11.3 Recharts + `'use client'` — no change — LIKELY

Recharts Client Component pattern unchanged. `cacheComponents` does not affect Client Component behavior.

---

## Step 12: Vercel Deploy

### 12.1 Turbopack default — VERIFIED

Turbopack is **default bundler** in Next 16 for `next dev` and `next build`. `--turbopack` flag obsolete. Current `package.json` scripts already correct.

Custom `webpack()` config → `next build` fails with misconfiguration error. This project has none.

### 12.2 Turbopack config location — VERIFIED

Next 15: `experimental.turbopack: {}`
Next 16: top-level `turbopack: {}` in `next.config.ts`

### 12.3 `vercel.json` cron — no change — LIKELY

`vercel.json` cron schedule format and `Authorization: Bearer` are Vercel platform features, not Next.js. Unchanged.

### 12.4 Build output metrics — minor — VERIFIED

`next build` no longer outputs `size` and `First Load JS`. Use Vercel Analytics or Lighthouse instead.

---

## New Config Required

**Path B (recommended):**

```typescript
// next.config.ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  cacheComponents: true,
}

export default nextConfig
```

Do **not** add `experimental.dynamicIO`, `experimental.useCache`, `experimental.ppr` — these are removed in Next 16 and cause build errors.

**Path A**: no changes needed.

---

## Files to Update Before Implementation

```
[ ] src/proxy.ts       — Create (NEVER create src/middleware.ts)
[ ] next.config.ts     — Add cacheComponents: true if Path B
[ ] package.json       — No changes needed
```

All other blueprint file paths unchanged. Blueprint folder structure correct except `src/middleware.ts` → `src/proxy.ts`.

---

## Remaining Open Questions

1. **`revalidateTag` with `unstable_cache` tags in Path A**: Is `revalidateTag('tag', { expire: 0 })` correctly invalidating `unstable_cache` entries, or does the two-argument form only apply to `'use cache'` entries? Verify via minimal test, or fall back to `revalidatePath()` which is tag-independent and works on both models.

2. **`setAll` `headers` argument forwarding**: 0.10.2 includes `headers: Record<string, string>` with `Cache-Control: private, no-cache, ...` values. Older code samples that ignore this miss the headers, potentially allowing CDN caching of auth responses. Pattern in 4.4 is correct — verify present before deploying.

3. **`'use cache'` with Supabase client inside cached scope**: `'use cache'` requires captured values to be serializable. `SupabaseClient` is not serializable. The pattern in 7B calls `createServerClient` inside the cached function body + `await cookies()` inside it — `cookies()` is a runtime API that breaks the static shell when inside a cached scope. Safe pattern: pass cookie array as serializable argument into the cached function. Needs test on first dev-server start.

---

*Research sources: `node_modules/next/dist/docs/`, `node_modules/@supabase/ssr/dist/main/`, `node_modules/@supabase/auth-js/dist/main/GoTrueClient.d.ts`, nextjs.org live docs (2026-04-18), supabase.com docs (2026-04-18).*
