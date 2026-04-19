# Phase 1 Implementation Blueprint — v2.2

> **Version history**
> - **v1** (2026-04-18, by feature-dev:code-architect): initial blueprint against PRD v3 §18 Phase 1, written assuming Next.js 15 + `@supabase/ssr` 0.5.x.
> - **v2** (2026-04-19): rewritten after Next.js 16.2.4 + React 19 + Tailwind v4 + `@supabase/ssr` 0.10.2 turned out to be the actually-installed stack, and after the user chose Path B (Cache Components model) for caching. Product requirements, scope, and schema are identical to v1. Only the Next.js-specific patterns changed.
> - **v2.1** (2026-04-19 later): date-navigation feature (PRD v3.1 §11.6 Phase 1 range) folded into Phase 1 build. All protected pages take an optional `?date=YYYY-MM-DD` query param; data-layer readers become date-parameterized; a new `src/components/layout/date-picker.tsx` lands. Price-overlay is Phase 2 so this document only prepares the hook.
> - **v2.2** (2026-04-20): mobile support added as first-class Phase 1 scope (PRD v3.2 §11.7). §1 gets `mobile-nav.tsx` + `sheet.tsx`. §6.1 date picker splits into native (`<md`) + Popover (`md+`) paths. New §6.2 Responsive Layout section. §9 gets new **Step 9.5 Mobile shell retrofit** between cron and dashboard UI. §10 gets two mobile acceptance rows. §11 gets trade-off #14 explaining the retrofit-over-up-front-design choice.
> - **v2.3** (2026-04-20 later): historical backfill tooling folded in as **Step 11.5**. `scripts/backfill-snapshots.ts` replays the past 30 days of FRED data against each date's own 5-year z-score window so the dashboard trend + changelog populate with real data before the Step 12 Vercel deploy, allowing the family to sanity-check the score pipeline end-to-end rather than wait for the daily cron to accumulate history organically. Also splits `fred.ts` into `fred.ts` (fetcher, `server-only`) + `fred-parse.ts` (pure parser + `findObservationAsOf`) so the Node-env script can reuse the parser without dragging the `"server-only"` guard.
>
> The Next 15 → Next 16 research that drove the v2 rewrite is preserved unchanged at [`phase1_blueprint_next16_delta.md`](./phase1_blueprint_next16_delta.md) as a reference artifact — consult it when you need the evidence behind a v2 decision.
>
> This document is the source of truth for the Phase 1 implementation. The PRD at [`../investment_advisor_dashboard_prd_kr_v3.md`](../investment_advisor_dashboard_prd_kr_v3.md) defines the **what** and **why**; this blueprint defines the **how** and is deliberately prescriptive about files, data flow, and sequencing.

## Version Assumptions

- **Next.js 16.2.4** (App Router, Turbopack as default bundler, `proxy.ts` file convention replacing `middleware.ts`, `cacheComponents: true` enabling the `'use cache'` directive)
- **React 19.2.4** (stable server-first APIs)
- **Tailwind CSS v4** with `@tailwindcss/postcss` plugin
- **`@supabase/ssr` 0.10.2** (`getAll`/`setAll` cookie pattern; `setAll` receives a 2nd `headers` argument)
- **`@supabase/supabase-js` 2.103.x** (service-role admin client)
- **Node.js 20 LTS** runtime
- **TypeScript 5.x**
- **shadcn/ui** via CLI (`base-nova` style, Lucide icons)
- **Recharts 3.x** for client-side charting

## 1. Folder Structure

```
finance-manager/
├── supabase/migrations/
│   ├── 0001_initial_schema.sql            # ✔ applied
│   └── 0002_rls_policies.sql              # ✔ applied
│   (Family user bootstrap is done via the Supabase Admin API, not a
│   migration — account UUIDs shouldn't be baked into replayable SQL.)
├── src/
│   ├── app/
│   │   ├── layout.tsx                     # Root layout, fonts, metadata
│   │   ├── page.tsx                       # Root: redirect(/dashboard)
│   │   ├── globals.css                    # Tailwind v4 imports + shadcn vars
│   │   │
│   │   ├── (auth)/
│   │   │   └── login/
│   │   │       ├── page.tsx               # Server Component, Suspense-wrap
│   │   │       └── login-form.tsx         # "use client" form
│   │   │
│   │   ├── (protected)/
│   │   │   ├── layout.tsx                 # Sidebar + header; cookies() in
│   │   │   │                              #   Suspense-wrapped sub-component
│   │   │   ├── dashboard/page.tsx         # 'use cache' + cacheLife('days')
│   │   │   ├── asset/[slug]/page.tsx      # async params: Promise<{ slug }>
│   │   │   └── changelog/page.tsx
│   │   │
│   │   └── api/
│   │       ├── cron/ingest-macro/route.ts # Vercel Cron target
│   │       └── auth/callback/route.ts     # PKCE fallback
│   │
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── server.ts                  # createServerClient for RSC/Route Handlers
│   │   │   ├── client.ts                  # createBrowserClient for "use client"
│   │   │   └── admin.ts                   # service_role client for cron
│   │   │
│   │   ├── score-engine/
│   │   │   ├── weights.ts                 # MODEL_VERSION + INDICATOR_CONFIG
│   │   │   ├── normalize.ts               # Z-Score + zScoreTo0100 (pure)
│   │   │   ├── composite.ts               # Weighted sum (pure)
│   │   │   └── indicators/{fred,types}.ts
│   │   │
│   │   ├── data/
│   │   │   ├── indicators.ts              # 'use cache' snapshot readers
│   │   │   ├── changelog.ts               # 'use cache' delta reader
│   │   │   └── snapshot.ts                # Writers (admin client, no cache)
│   │   │
│   │   └── utils/{score-band,date}.ts
│   │
│   ├── components/
│   │   ├── ui/                        # shadcn primitives (incl. sheet.tsx v2.2)
│   │   ├── layout/                    # sidebar, header, date-picker (v2.1),
│   │   │                              #   mobile-nav (v2.2), user-display,
│   │   │                              #   sign-out-button
│   │   ├── shared/                    # disclaimer-banner, staleness-badge
│   │   ├── dashboard/
│   │   ├── changelog/
│   │   └── charts/                    # Recharts wrappers, always inside
│   │                                  #   <ResponsiveContainer> (v2.2)
│   ├── types/database.ts                  # ✔ generated via supabase MCP
│   └── proxy.ts                           # Next 16 auth guard (was middleware.ts)
├── vercel.json                            # Cron schedule
├── next.config.ts                         # cacheComponents: true
└── .env.local                             # git-ignored secrets
```

Note the v1→v2 structural diffs:
- `src/middleware.ts` → `src/proxy.ts` (Next 16 rename; function name is `proxy`).
- `src/lib/supabase/middleware.ts` helper is not needed — the proxy embeds its own `createServerClient` call.
- `src/app/(auth)/login/` is split into `page.tsx` (Server Component) + `login-form.tsx` (Client Component) — required because `searchParams` reads force a dynamic boundary under `cacheComponents`.
- The 24h `export const revalidate = 86400` annotation on protected pages is gone; cache lifetimes live in `'use cache'` scopes with `cacheLife('days')`.

## 2. Supabase Schema

**Tables** (all in `public` schema):
- `indicator_readings` — every fetched data point, 15 PRD §12.3 fields + `raw_payload JSONB` for backtest replay. Unique index on `(indicator_key, observed_at, model_version)` makes cron re-runs idempotent.
- `composite_snapshots` — per `(asset_type, snapshot_date, model_version)` weighted composite. Dashboard reads this directly; weighted sum is never recomputed on request.
- `score_changelog` — delta vs previous snapshot with `top_movers JSONB` and `band_changed` flag. Written by the cron after `composite_snapshots` upsert.
- `user_preferences` — per-user persona (`beginner` | `intermediate` | `expert`), RLS via `(SELECT auth.uid()) = user_id`.
- `ingest_runs` — audit row per cron execution (attempts/success/failure counts, error summary, duration).

**Enums:**
- `fetch_status_enum('success', 'error', 'stale', 'partial')` — PRD §12 staleness semantics.
- `asset_type_enum('us_equity', 'kr_equity', 'crypto', 'global_etf', 'common')` — 4 asset classes + `common` for macro-core indicators not bound to any single asset class. The `crypto` value covers the broader cryptocurrency market (BTC + ETH + majors) rather than being narrowed to Bitcoin — the PRD's "BTC/ETH" phrasing is shorthand for this category. Enum was renamed from the original `'btc'` in migration `0003_rename_btc_to_crypto.sql`.

**RLS pattern:**
- All data tables: `FOR SELECT TO authenticated USING (true)`. Writes restricted to `TO service_role WITH CHECK (true)` — direct client writes impossible.
- `user_preferences`: per-user isolation via `(SELECT auth.uid()) = user_id`. The SELECT wrapper caches the function call per-statement instead of per-row.
- Public signup disabled in Supabase Dashboard (not code) — enforced at the Auth layer, not SQL.

**Family auth bootstrap:** 3 accounts created via Supabase Admin API with `user_metadata.persona` set at creation time (so the persona is JWT-accessible even before `user_preferences` reads). `user_preferences` rows were then backfilled via a one-off `INSERT ... SELECT` from `auth.users.raw_user_meta_data`.

## 3. Data Ingestion Pipeline

**Chosen:** Vercel Cron (Hobby plan, 1/day limit) → `GET /api/cron/ingest-macro` at 06:00 UTC.

**Flow:**
```
Vercel Cron (06:00 UTC)
 → Route Handler authenticates via Authorization: Bearer ${CRON_SECRET}
 → Fetch 7 FRED series (FEDFUNDS, CPIAUCSL, DGS10, T10Y2Y, VIXCLS,
   BAMLH0A0HYM2, SAHMCURRENT)
 → Normalize (Z-Score over 5y window → clamp 0-100)
 → Composite (weighted sum per asset class)
 → Upsert indicator_readings, composite_snapshots, score_changelog,
   ingest_runs via the admin/service_role Supabase client (bypasses RLS)
 → revalidateTag('macro-snapshot', { expire: 0 })
 → revalidateTag('changelog',      { expire: 0 })
```

**Idempotency:** the unique index on `(indicator_key, observed_at, model_version)` makes cron re-runs safe. Duplicate dates produce no-ops; new data is written.

**Cache invalidation:** the `{ expire: 0 }` second argument to `revalidateTag` is mandatory under Next 16 (single-arg form is a TypeScript error). `expire: 0` causes immediate cache expiration — the next user request blocks on fresh data rather than serving stale-while-revalidating, which is the right semantic for a daily data-pipeline signal.

**Trade-offs considered and rejected:**
- GitHub Actions scheduled workflows: separate secret management, extra infra surface.
- Supabase `pg_cron` + Edge Functions: 150ms CPU cap kills multi-HTTP fetches.
- cron-job.org → Route Handler: third-party trust for an ops-critical cron path.

## 4. Score Engine

Pure TypeScript, framework-agnostic. Next 15 → Next 16 migration did not touch this layer.

- **`weights.ts`** exports `MODEL_VERSION = 'v1.0.0'` + per-asset weight table with `inverted: boolean` per indicator (e.g., BAMLH0A0HYM2 and VIX both have `inverted: true` — higher values mean worse conditions, so high Z-Score should map to low score).
- **`normalize.ts`**: `computeZScore(series, current)` → standard Z-Score over a rolling window; `zScoreTo0100(z, inverted)` → maps to 0-100 via `clamp(50 - z * 50/3, 0, 100)` (linear within ±3σ, clamped outside).
- **`composite.ts`**: weighted sum → 0-100 + resolved band.
- **`score-band.ts`**: 80/60/40/20 cuts → `{ band: '강한 비중 확대' | '비중 확대' | '유지' | '비중 축소' | '강한 비중 축소', intensity, color }`.

**Versioning contract:** bumping `MODEL_VERSION` writes new rows that coexist with old under a different version tag. Full history preserved for backtest. The `model_version` column is a hard-required NOT NULL on every row, so this is impossible to forget.

## 5. Auth & Proxy (Next.js 16)

The auth surface was redesigned in v2 for Next 16's `proxy.ts` file convention.

### 5.1 `src/proxy.ts` — auth guard

Runs at the network boundary of every matched request (matcher excludes `_next/static`, `_next/image`, `favicon.ico`, `api/cron/*`, `api/auth/*`).

Responsibilities:
1. Refresh the Supabase session cookie — expired JWTs must not brick the app on navigation.
2. Read the current JWT claims via `supabase.auth.getClaims()` — validates signature locally, unlike `getSession()` which blindly trusts the cookie.
3. Redirect unauthenticated users to `/login?next=<original-path>` for protected paths (`/dashboard`, `/asset/*`, `/changelog`).
4. Redirect authenticated users away from `/login` to `/dashboard`.

Cookie handling follows the `@supabase/ssr` 0.10 `getAll`/`setAll` pattern. Critically, the `setAll` handler receives a second argument — `headers: Record<string, string>` — carrying cache-control directives like `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`. These must be forwarded to the `supabaseResponse` headers, otherwise a CDN could cache an auth-bearing response and leak it across users.

Runtime: `proxy.ts` runs on **Node.js only** in Next 16 (Edge runtime is not supported for proxy). Zero impact for this project since `@supabase/ssr` has no Edge-only dependencies.

### 5.2 Supabase client factories — `src/lib/supabase/`

Three factories, one per call-site:

- **`server.ts`** (`getSupabaseServerClient`): for Server Components and Route Handlers. Uses `createServerClient` with `await cookies()` from `next/headers`. The `setAll` handler is a no-op that swallows write errors (Server Components can't mutate cookies; the proxy handles refresh).

- **`client.ts`** (`getSupabaseBrowserClient`): for `"use client"` components (login form, any interactive UI). `createBrowserClient` returns a browser-singleton.

- **`admin.ts`** (`getSupabaseAdminClient`): uses `SUPABASE_SERVICE_ROLE_KEY` to bypass RLS. Import chain must never reach a Client Component — the service role key is a write-everywhere credential and must not ship to browsers.

All three are typed with `Database` from `src/types/database.ts` for full column-level type safety.

### 5.3 Login flow

- `src/app/(auth)/login/page.tsx`: **Server Component** with a `<Suspense>` boundary. Under `cacheComponents: true`, awaiting `searchParams` at the top level turns the whole page into blocking dynamic content and fails the prerender. The fix: wrap a small `<LoginFormSlot>` sub-component inside `<Suspense fallback={<Skeleton />}>`, pass the `searchParams` Promise down, and await it inside the boundary. The static shell (`<main>` wrapper + Suspense fallback) renders immediately.
- `src/app/(auth)/login/login-form.tsx`: **Client Component** (`"use client"`) that receives `nextPath: string` as a prop and calls `supabase.auth.signInWithPassword()`. On success it does a hard navigation via `window.location.assign(nextPath)` — this avoids a race where `router.replace` + `router.refresh` might execute before the new cookie is readable on the server.

### 5.4 Auth callback — `src/app/api/auth/callback/route.ts`

Runs on `GET /api/auth/callback?code=…&next=…` for PKCE code exchange. Phase 1 primary login is email + password, so this route is a safety net for flows like Admin-API-triggered password-reset magic links. If no `code` arrives, bounces back to `/login`.

## 6. UI Routes

All three protected routes accept an optional `?date=YYYY-MM-DD` query parameter (see §6.1). When absent, the route resolves "latest" (today's snapshot if present, otherwise the most recent available).

| Route | Type | Cache mechanism | Purpose |
|---|---|---|---|
| `/` | Server | static | Redirects to `/dashboard` |
| `/login` | Partial Prerender | static shell + Suspense | Email+password form |
| `/dashboard?date=` | Server | `'use cache'(date) + cacheTag('macro-snapshot') + cacheLife('days')` | Home: composite state + 4 asset cards + top 3 changes for the chosen date |
| `/asset/[slug]?date=` | Server | `'use cache'(slug, date) + cacheTag('macro-snapshot') + cacheLife('days')` | Asset detail: trend anchored at selected date + contributing indicators |
| `/changelog?date=` | Server | `'use cache'(date) + cacheTag('changelog') + cacheLife('days')` | Score deltas around the selected date |
| `/api/cron/ingest-macro` | Route Handler | none (write path) | Cron target |
| `/api/auth/callback` | Route Handler | none | PKCE fallback |

### 6.1 Date Navigation (PRD §11.6)

**Date picker location:** header (global, persists across page navigation). Lives in `src/components/layout/date-picker.tsx` alongside the user display.

**URL contract:** `?date=YYYY-MM-DD`. Absent means "latest". The date picker updates the URL; `Link` components in the sidebar preserve the current `date` param when navigating between pages so the user stays anchored in their chosen time window.

**Device-branched rendering (v2.2):** the date-picker component is a single Client Component that branches internally on a CSS media-query hook:
- `<md` (mobile): renders `<input type="date" min={epoch} max={today} value={date} onChange={updateUrl}>`. iOS and Android replace this with their OS-native calendar UI (wheel picker on iOS, Material calendar on Android) — zero extra code, fully touch-native, and the browser guarantees the returned value is already a valid `YYYY-MM-DD` string.
- `md+` (desktop): renders the original shadcn `Popover + Calendar` pair for mouse interaction and visual consistency with the rest of the header UI.

Both paths write to the same `?date=YYYY-MM-DD` query param, so all downstream `searchParams.date` plumbing (pages, sidebar links, data-layer readers) is identical regardless of how the user picked the date. The breakpoint is evaluated once on mount and re-evaluated on viewport change (e.g. iPad rotation); no SSR-vs-client mismatch because both branches render the same initial `<input>` shell until hydration completes.

**Validation:** the date string is parsed and clamped to the range [project_epoch, today]. Invalid input falls back to "latest" with a toast (Phase 2) or silent fallback (Phase 1). Dates before the earliest `composite_snapshots.snapshot_date` render an empty-state with a link to the earliest available day.

**Missing-data UX:** when `snapshot_date = ?date` produces no row, show:
- "수집된 데이터가 없습니다" message,
- the closest earlier `snapshot_date` as a quick-jump link.

Never render an interpolated or extrapolated score — the PRD §11.6 rule forbids "score estimation" for missing days.

**Phase 2 extension (gated by PRD §8.5):** when the price-overlay feature lands, the same `?date=` param also anchors the price timeline on asset-detail pages. No additional URL plumbing needed.

**shadcn components installed:** `button, card, badge, input, label, separator, skeleton, tooltip` (base-nova style, Lucide icons). v2.2 adds `sheet` for the mobile nav drawer.

**Charts:** Recharts `LineChart` + `ReferenceLine` at 80/60/40/20 for band thresholds. Recharts requires the browser DOM, so the chart component is wrapped in `"use client"` and receives pre-fetched data as a serializable prop from the parent Server Component. **Every chart must be wrapped in `<ResponsiveContainer>`** (v2.2) — fixed-pixel widths break on mobile viewports and break the mobile-first grid layout.

**Suspense-wrapped auth-dependent UI (required under Path B):** any component that calls `cookies()` / `headers()` at request time must be inside a `<Suspense>` boundary — otherwise the prerender fails with "Uncached data was accessed outside of `<Suspense>`". The protected layout's sidebar user display reads the session cookie to show the user name, so it is extracted to a sub-component inside `<Suspense fallback={<SidebarSkeleton />}>` in the protected layout.

### 6.2 Responsive Layout (PRD §11.7) — v2.2

Phase 1 supports mobile browsers (iOS Safari / Android Chrome) as a first-class target because two of three family users primarily read the dashboard on their phones. The scope is "responsive web", not "native-app experience": PWA / offline / custom gestures / haptics are out of Phase 1 per PRD §11.7.

**Breakpoint policy:**
- Single primary breakpoint: Tailwind `md` = 768px.
- `<md` (phones, small tablets): single-column layout, hamburger → drawer sidebar, mobile-first paddings (`px-4`), native `<input type="date">`.
- `md+` (iPad portrait, laptops, desktops): existing fixed sidebar, wider paddings (`px-6`), 2-column asset card grid, Popover date picker.
- No separate tablet styling — `md` is the sole toggle. If Phase 2 needs it, add a second breakpoint then.

**Layout tokens by viewport:**

| Element | `<md` | `md+` |
|---|---|---|
| Sidebar | Hidden; opened via hamburger button in header, renders as shadcn `Sheet` drawer from the left | Fixed `w-60`, always visible |
| Header padding | `px-4` | `px-6` |
| Main content padding | `px-4 py-6` | `px-6 py-8` |
| Asset card grid | `grid-cols-1` (stacked) | `grid-cols-2` (2×2 grid) |
| Heading size | `text-2xl` | `text-3xl` |
| Disclaimer text | `text-xs` | `text-sm` |
| Date picker | Native `<input type="date">` | shadcn `Popover + Calendar` |

**Touch-target rule:** any element the user taps (buttons, icon buttons, links in the sidebar, date picker, hamburger) must render at **≥44×44 CSS pixels**. In Tailwind this means `size-11` or `h-11 w-11`, which maps to 44×44 on a 16px root font. shadcn `Button` default size satisfies this; icon buttons must be sized explicitly.

**Viewport meta:** `src/app/layout.tsx` exports a Next-recognized `viewport` object:

```ts
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // allow user zoom — accessibility WCAG 1.4.4
};
```

Next's default is close to this but explicit is safer and lets us set `maximumScale` (do **not** use `maximumScale: 1` — it defeats the user's pinch-to-zoom).

**Native gesture preservation:** Phase 1 adds **no** custom gestures (no pull-to-refresh, no swipe navigation, no haptics). Instead, code must not break the OS-native ones:
- Do not intercept `touchstart` / `touchmove` on scrollable areas unless functionally necessary.
- Do not apply `overscroll-behavior: none` on the root — it blocks iOS rubber-band and pull-to-refresh.
- Sheet drawer (`<md` sidebar) uses shadcn's default swipe-to-close which maps to iOS bottom-sheet semantics.
- Do not register global `preventDefault` on navigation events — iOS left-edge swipe-back must keep working.

**Out of Phase 1 scope (deferred to Phase 2+):**
- PWA manifest, service worker, installable icon (PRD §18 Phase 2)
- Offline cached reads
- Custom gestures (pull-to-refresh, swipe between asset tabs)
- Web haptics API (not supported in iOS Safari anyway)

**Testing checklist for Step 9.5:**
- Chrome DevTools device toolbar at 360×640, 375×812, 768×1024, 1280×800.
- Real iPhone Safari and Android Chrome if available.
- Pinch-zoom works (fails if `maximumScale: 1` slipped in).
- Left-edge swipe-back on iOS still navigates (regression check).
- Native date input pops the OS calendar on tap.

## 7. Caching Strategy (Path B — Cache Components)

`next.config.ts` has `cacheComponents: true`. This single flag supersedes the removed experimental `dynamicIO` / `useCache` / `ppr` flags. With it enabled:

- **All routes are dynamic by default.** `export const dynamic = 'force-dynamic'` is unnecessary and triggers a warning.
- **Route-segment `revalidate` exports are replaced by in-function cache directives.** No more `export const revalidate = 86400`.
- **Cached data functions use the `'use cache'` directive** at the top of their body, plus `cacheTag('…')` and `cacheLife('days' | 'hours' | 'seconds' | …)` helpers from `next/cache`.
- **Runtime APIs (`cookies()`, `headers()`, `searchParams`) must be wrapped in `<Suspense>`** when they appear in a prerender-eligible route.

Example data-layer pattern (`src/lib/data/indicators.ts`):

```ts
import { cacheLife, cacheTag } from 'next/cache'
import { getSupabaseServerClient } from '@/lib/supabase/server'

// "latest" variant — no date argument, serves today's snapshot when present.
export async function getLatestCompositeSnapshots() {
  'use cache'
  cacheTag('macro-snapshot')
  cacheLife('days')      // stale 5m / revalidate 1d / expire 1w — aligns with 24h cron

  const supabase = await getSupabaseServerClient()
  const { data } = await supabase
    .from('composite_snapshots')
    .select('*')
    .order('snapshot_date', { ascending: false })
    .limit(4)             // 4 asset classes
  return data
}

// Date-parameterized variant — date becomes part of the cache key so each
// historical day gets its own entry. Feeds the Phase 1 date-navigation UI.
export async function getCompositeSnapshotsForDate(date: string) {
  'use cache'
  cacheTag('macro-snapshot')
  cacheLife('weeks')     // historical entries don't change — cache longer

  const supabase = await getSupabaseServerClient()
  const { data } = await supabase
    .from('composite_snapshots')
    .select('*')
    .eq('snapshot_date', date)
  return data
}
```

**Why a separate function rather than an optional param on `getLatestCompositeSnapshots`:** cache keys are derived from function arguments in Next.js's `'use cache'`. A single function with an optional date would cache `undefined` and `"2026-03-15"` as different keys, which works, but splitting makes the cadence explicit: `latest` recycles daily with the cron, `forDate` persists for weeks since history is immutable.

Example page-level pattern — **Partial Prerender** (used by `src/app/(protected)/dashboard/page.tsx` as of Step 10, commit `ce23056`):

```tsx
// page.tsx  — static shell, prerendered at build
import { Suspense } from "react";
import { DashboardContent } from "./dashboard-content";
import { DashboardSkeleton } from "./dashboard-skeleton";

export default function DashboardPage() {
  return (
    <>
      <h1>오늘 시장 상황</h1>
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}

// dashboard-content.tsx  — dynamic subtree, gated by connection()
import { connection } from "next/server";

export async function DashboardContent() {
  await connection();                              // opt out of prerender
  const today = new Date().toISOString().slice(0, 10);
  const [snaps, changes] = await Promise.all([
    getLatestCompositeSnapshots(),                 // 'use cache'
    getChangelogAroundDate(today, 14),             // 'use cache' (keyed on today)
  ]);
  // …render…
}
```

**Why the split (not one-file `'use cache'`):** under Next 16 `cacheComponents: true`, calling `new Date()` (or any wall-clock API) inside a `'use cache'` body throws `next-prerender-current-time` because the prerender pass cannot pick a stable "today". The page-level split pushes `'use cache'` down to the data readers (`src/lib/data/indicators.ts`, `src/lib/data/changelog.ts`), which already tag with `cacheTag('macro-snapshot')` / `cacheTag('changelog')` and set `cacheLife('days')`. `cron → revalidateTag('macro-snapshot', { expire: 0 })` still evicts on new data as intended. The `connection()` call opts this specific render path out of the static prerender pass, not out of runtime cache hits — same-day reloads still hit the cached readers.

**Step 10.5 migration:** once `searchParams.date` lands, `DashboardContent` will accept a `date: string` prop (its own cache key) and `page.tsx` will read `await searchParams` and pass it down. The `connection()` call can then disappear because `date` becomes request-derived, not wall-clock-derived.

**Constraint:** `'use cache'` **cannot** appear at the top of a Route Handler body. For the cron handler, keep the cache-invalidation call (`revalidateTag('macro-snapshot', { expire: 0 })`) in the handler and extract any read-only helper that needs caching into a separate `'use cache'`-directive function.

**Resolved (formerly open) — admin client inside `'use cache'` scopes:** Data readers use the admin (service_role) client, not the user-authenticated server client. Rationale: (1) the data is family-wide, not per-user; (2) the user-auth client awaits `cookies()` which is a runtime API banned in cached scopes; (3) the admin client is cache-compatible because it captures nothing from the outer request context. Landed at commit `6aab776` (Step 8).

## 8. Secrets

**`.env.local`** (git-ignored):
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
FRED_API_KEY
ALPHA_VANTAGE_API_KEY       # Phase 2+
CRON_SECRET
```

**Vercel project env vars:** all six above. Service role + FRED + CRON_SECRET + Alpha Vantage should be Production-only.

**Alpha Vantage key special handling:** also exported into the host OS environment via `setx` so that Claude Code's `.mcp.json` `${ALPHA_VANTAGE_API_KEY}` substitution resolves at MCP-server spawn time. The committed `.mcp.json` uses the substitution reference, not the literal key.

**Safety invariants:**
- `SUPABASE_SERVICE_ROLE_KEY` never appears in any import chain reachable by a `"use client"` file.
- `FRED_API_KEY` only used inside `src/lib/score-engine/indicators/fred.ts`, which is only imported by the cron Route Handler.
- `.gitignore` covers `.env*`, `.next/`, `node_modules/`, `.claude/settings.local.json`, `.vercel/`.

## 9. Build Sequence — actual progress + remaining steps

Steps are ordered so the repo never enters a broken state. ✔ marks steps already completed in the repo history (visible via `git log`).

1. ✔ **GitHub repo + Supabase project provisioning** — private repo `Jaclyn6/Finance-Manager-James`, Supabase project `hhohrclmfsvpkigbdpsb` in `ap-northeast-2` (Seoul). Public signup disabled in Supabase Dashboard.
2. ✔ **Family accounts** — 3 users created via Supabase Admin API with `user_metadata.persona` set (expert / intermediate / beginner).
3. ✔ **Next.js 16 + shadcn scaffold** — `create-next-app --typescript --tailwind --eslint --app --src-dir --turbopack`, then `shadcn@latest init` + 8 components, plus `@supabase/ssr`, `@supabase/supabase-js`, `recharts`.
4. ✔ **Supabase migrations** — `0001_initial_schema.sql` + `0002_rls_policies.sql` applied via MCP. TypeScript types generated into `src/types/database.ts`. `user_preferences` seeded from `auth.users.raw_user_meta_data`.
5. ✔ **Auth & proxy** — `next.config.ts` with `cacheComponents: true`, 3 Supabase client factories, `src/proxy.ts`, login page split (Server + Client), auth callback Route Handler, root `/` → `/dashboard` redirect. `next build` passes.
6. ✔ **Protected layout shell** — `src/app/(protected)/layout.tsx` reads session via `getSupabaseServerClient`, renders sidebar + header + disclaimer banner. Auth-dependent sub-component (user display) wrapped in `<Suspense>`. Stub pages for `/dashboard`, `/asset/[slug]`, `/changelog` so the shell has real routes to link to. Kraken design tokens + `next-themes` dark mode also landed here.
7. ✔ **Score engine core** — pure functions: `weights.ts` (`MODEL_VERSION`, `INDICATOR_CONFIG`), `normalize.ts` (`computeZScore`, `zScoreTo0100`), `composite.ts`, `score-band.ts`. Vitest 47 tests green. Post-review fixes added `Number.isFinite` + `typeof === "number"` narrowing for non-finite weight/score guards.
8. ✔ **Data layer & snapshot writer** — `src/lib/data/{tags,snapshot,indicators,changelog}.ts` + `src/lib/utils/date.ts`. Writers use admin client (no cache); readers use `'use cache'` + `cacheTag` + `cacheLife('days' / 'weeks')` with the admin client **inside** the cached scope (resolves open question #3 from §7). Post-review fixes added `.eq("model_version", MODEL_VERSION)` to every reader and `import "server-only"` to `supabase/admin.ts`. Vitest 56 tests green.
9. **Cron route handler** (next) — `src/app/api/cron/ingest-macro/route.ts`: CRON_SECRET check → FRED fetches → normalize → composite → snapshot write → `invalidateMacroSnapshotCache()` + `invalidateChangelogCache()` (wrappers around `revalidateTag(tag, { expire: 0 })` in `src/lib/data/snapshot.ts`). `vercel.json` with cron schedule. Local smoke test via `curl -H "Authorization: Bearer ${CRON_SECRET}"`. Also adds migration `0004_score_changelog_unique.sql` creating `score_changelog_dedup` unique index on `(asset_type, change_date, model_version)`, then switches `writeScoreChangelog` from plain insert to upsert on that constraint (closes the idempotency TODO in `snapshot.ts`).
9.5. **Mobile shell retrofit (v2.2)** — execute between Step 9 and Step 10 so all subsequent UI is authored mobile-first. Substeps:
   - `npx shadcn@latest add sheet` — installs the drawer primitive.
   - Create `src/components/layout/mobile-nav.tsx`: a Client Component rendering a hamburger `Button` and a `Sheet` containing the sidebar's nav links. Opens on tap, dismisses via tap outside, `Esc`, or swipe-left (Sheet default).
   - Edit `src/components/layout/header.tsx`: show hamburger on `<md`, hide sidebar on `<md`; swap `px-6` → `px-4 md:px-6`.
   - Edit `src/app/(protected)/layout.tsx`: hide the fixed `<Sidebar>` on `<md` (`hidden md:flex`), add `<MobileNav>` always in the header; main padding becomes `px-4 py-6 md:px-6 md:py-8`.
   - Edit `src/app/layout.tsx`: export `viewport` per §6.2 (explicit `width: device-width` / `initialScale: 1` / `maximumScale: 5`).
   - Retrofit existing dashboard placeholder page: replace `p-12` with `p-4 md:p-12`, `text-3xl` with `text-2xl md:text-3xl`. The stub stays; Step 10 replaces it with the real composite UI.
   - Verify no regressions in dev (`npm run dev`) at DevTools viewports 360 / 375 / 768 / 1280. Verify iOS edge-swipe-back is not intercepted.
   - **No DB / cron / data-layer changes** in this step — it's UI plumbing only.
10. **Dashboard UI (latest-only variant, mobile-first)** — `dashboard/page.tsx` is a static shell + Suspense-gated `DashboardContent` (calls `await connection()` then reads from `getLatestCompositeSnapshots`). Components: `CompositeStateCard`, `AssetCard`, `RecentChanges`. `StalenessBadge` derives age from `snapshot_date` and combines it with `fetch_status` into a 4-state label (최신 / N일 지연 amber / N일 지연 destructive / non-success). `composite_snapshots` has no `ingested_at` column (see §4) so `snapshot_date` is the freshness proxy — this is the "business day age" semantic documented in §10 acceptance. Cards use `grid-cols-1 md:grid-cols-2` (v2.2). At this step the page is always "today"; the `?date=` support lands at Step 10.5.
10.5. **Date-navigation UI (v2.1 + v2.2)** — `src/components/layout/date-picker.tsx` (Client Component) renders the hybrid picker per §6.1: native `<input type="date">` on `<md`, shadcn `Popover + Calendar` on `md+`. `?date=YYYY-MM-DD` query param plumbed through the header and preserved by all sidebar + mobile-nav `<Link>`s via a `buildNavHref` helper. `getCompositeSnapshotsForDate(date)` read function in `src/lib/data/indicators.ts` (already landed in Step 8). Dashboard page branches on `searchParams.date` (inside its Suspense boundary) between "latest" and "forDate" reads. `src/components/shared/no-snapshot-notice.tsx` empty-state with a link to the closest earlier `snapshot_date`.
11. **Asset detail & changelog UI** — `asset/[slug]/page.tsx` (async params + async searchParams); `ScoreTrendLine` Recharts Client Component shows a rolling window ending at the selected date; changelog page renders deltas around the selected date with `band_changed` highlight; both pages consume the `?date=` param already plumbed in Step 10.5.
11.5. **Historical backfill (30-day seed, v2.3)** — run once before Step 12 so the dashboard trend chart and changelog page carry real data instead of the Phase 1 smoke-test's single point. Operational tooling, not part of the runtime app:
   - Split `src/lib/score-engine/indicators/fred.ts` into `fred.ts` (fetcher, keeps `import "server-only"`) + `fred-parse.ts` (pure parser + `findObservationAsOf` helper, no guard). The wrapper re-exports the parser so existing cron + Vitest callers are unchanged.
   - `scripts/backfill-snapshots.ts` (run via `npx tsx`): fetches 5-year history for each of the 7 FRED series once, then for every date D in the 30-day backfill window recomputes z-scores against the window `[D - 5y, D]` (a **per-date** window, not today-anchored — otherwise future data would leak into past scores). Writes ~83 deduped `indicator_readings`, 150 `composite_snapshots` (30 × 5 asset types), 145 `score_changelog` rows via upserts on the existing unique indexes — idempotent and overwrite-safe.
   - Bypasses `src/lib/supabase/admin.ts` + `src/lib/data/snapshot.ts` (both carry `import "server-only"` that throws in a Node-env script) by using `@supabase/supabase-js` directly with the service-role key. Pure score-engine functions (`weights`, `normalize`, `composite`, `top-movers`, `score-band`) are reused.
   - After running, dev server restart (or next daily cron) triggers `revalidateTag('macro-snapshot' / 'changelog')` to evict the stale `cacheLife('days')` entries.
   - Script prints a min/mean/max score summary so the operator can eyeball whether the resulting distribution looks reasonable without opening the dashboard.
   - **No schema changes, no runtime app changes.** The migration 0004 unique indexes shipped at Step 9 already make re-runs idempotent.
12. **Vercel deploy + smoke test** — push to GitHub → Vercel auto-deploys. Add all env vars (service role / FRED / CRON_SECRET Production-only). Manually trigger cron from Vercel UI; verify data in Supabase; verify dashboard renders with `revalidateTag` working; verify `?date=` navigation round-trips correctly on production build.

## 10. Acceptance Criterion Mapping

Every PRD §16 criterion mapped to the specific file / test that proves it. v2.2 adds the two mobile rows at the end of §10.1 per PRD §11.7 / §16.1 additions.

### §16.1 MVP Acceptance

| Criterion | Proving file / evidence |
|---|---|
| 홈 화면에서 5초 내 현재 상태를 이해할 수 있다 | `/dashboard/page.tsx` is `'use cache'` + Server Component → HTML is near-static; `CompositeStateCard` renders band + Korean label above the fold. Vercel Analytics LCP < 2s target. |
| 최근 30일 범위 내 임의 과거 날짜를 선택하면 그 시점 스냅샷과 `model_version`이 표시된다 (PRD v3.1 §16.1 추가) | Step 9.5 outputs: `date-picker.tsx` updates `?date=` query; `getCompositeSnapshotsForDate(date)` returns the row; `CompositeStateCard` + `AssetCard` both read `model_version` out of the snapshot and surface it next to the band label. |
| 데이터가 없는 날짜를 선택하면 값을 추정하지 않고 안내 + 최근 이전 수집일 제안 (PRD v3.1 §16.1 추가) | `src/components/shared/no-snapshot-notice.tsx` rendered when `getCompositeSnapshotsForDate(date)` returns empty; a sibling helper `getClosestEarlierSnapshotDate(date)` generates the quick-jump link. |
| 자산군별 카드가 분리되어 있다 | `AssetCard.tsx` rendered once per `asset_type_enum` value (4 cards). |
| 최소 6개 이상의 공통 매크로 코어 지표가 자동 반영된다 | `INDICATOR_CONFIG` in `weights.ts` defines 7 FRED series; `ingest_runs.indicators_success` must be ≥ 6 on green runs. |
| 최소 2개 이상의 기술적 지표(RSI, MACD)가 적용된다 | **Phase 2 scope** — PRD §18 places these in Phase 2. The `model_version` scheme accommodates additions without a schema migration. |
| BTC에는 최소 1개 이상의 온체인 지표(MVRV 또는 SOPR)가 적용된다 | **Phase 2 scope** — same. The `crypto` asset class will carry these when they land. |
| 데이터 실패 시 캐시와 상태 배지가 작동한다 | `fred.ts` returns `fetch_status: 'error'` on failure; `snapshot.ts` persists status; `StalenessBadge.tsx` renders red when status ≠ 'success'; cron continues with remaining indicators (partial data > no data). |
| 가족 계정 외 사용자는 데이터에 접근할 수 없다 | `proxy.ts` redirects unauth; RLS `TO authenticated` on all data tables; Supabase Dashboard has Sign Ups disabled. |
| 375px 폭 모바일에서 홈 화면이 가로 스크롤 없이 5초 내 이해 가능 (PRD v3.2 §16.1 추가) | Step 9.5 + Step 10 outputs: `src/app/(protected)/layout.tsx` gated sidebar (`hidden md:flex`) + hamburger-triggered `mobile-nav.tsx` drawer; dashboard grid uses `grid-cols-1 md:grid-cols-2`; `CompositeStateCard` renders band + score above the fold at 375px. Verified via Chrome DevTools device toolbar at 375×812 and real iOS Safari. |
| 모바일에서 날짜 탐색 터치 조작 + 터치 타깃 ≥44×44px (PRD v3.2 §16.1 추가) | Step 10.5 output: `date-picker.tsx` branches to `<input type="date">` on `<md` (OS-native calendar, touch-native). Hamburger button, date picker, and all sidebar/drawer links use `size-11` or shadcn Button default size (44px). Smoke test script in Step 9.5 walks both picker paths. |

### §16.2 Quality

| Criterion | Proving file / evidence |
|---|---|
| 점수 산식 버전이 추적 가능해야 한다 | `MODEL_VERSION` in `weights.ts` flows into every row's `model_version` column; `SELECT DISTINCT model_version FROM composite_snapshots` shows version history. |
| 데이터 출처가 화면에 표시되어야 한다 | `AssetCard` tooltip shows `source_url` from `INDICATOR_CONFIG` (Phase 2 — lands with the contributing-indicator breakdown in Step 11); `StalenessBadge` shows `fetch_status` + days since `snapshot_date` (the `composite_snapshots` table's business-day column; no separate `ingested_at` column exists on that table). |
| 사용자 문구는 확정적 자문처럼 보이지 않아야 한다 | `DisclaimerBanner` fixed to layout; band labels are "비중 확대 / 유지 / 축소" not "매수 / 매도"; all copy reviewed against PRD §2.3 and §11.5. |

## 11. Key Trade-off Decisions

1. **`proxy.ts` over `middleware.ts`** — not optional; Next 16 removed the `middleware` convention in 16.0. Function name `proxy`, runtime Node.js only. Codemod exists but we're greenfield.
2. **Cache Components (Path B) over deprecated `unstable_cache` (Path A)** — chosen because we're writing all data-layer code from scratch. `unstable_cache` still works but is deprecated; choosing the new model avoids a forced migration 6 months later. Cost: `<Suspense>` boundaries around runtime-API-dependent UI, and the `'use cache'` serializability gotcha flagged in §7.
3. **`revalidateTag(tag, { expire: 0 })` over stale-while-revalidate** — the cron is a "data is now fresh" signal; users opening the dashboard immediately after the cron should see fresh data, not be handed yesterday's snapshot while a background revalidation runs.
4. **Layout-level auth check vs proxy** — proxy wins. Layout `redirect()` creates a flash of unprotected content before the server renders the layout. Proxy runs before any rendering.
5. **Hard navigation (`window.location.assign`) after login vs `router.replace + refresh`** — hard nav wins. Supabase cookie writes can race with `router.refresh`, leaving Server Components re-rendering against a stale session. A full reload is slightly slower but reliably correct.
6. **`raw_payload JSONB` storage** — kept for Phase 3 backtest replay (negligible cost, enables reprocessing history without re-fetching FRED).
7. **Separate `composite_snapshots` table** — cheaper single-row reads than recomputing a weighted sum from `indicator_readings` on every request; also creates a stable, version-tagged record of what the engine decided on a given day.
8. **Vercel Cron Hobby vs GitHub Actions** — Hobby plan 1/day matches the 24h refresh cadence exactly. Zero extra infra. Upgrade to Pro unlocks precise-minute crons if Phase 2 demands sub-daily refresh (it probably won't).
9. **Family accounts via Admin API vs SQL seed migration** — Admin API wins because real UUIDs shouldn't live in replayable SQL migrations. A `supabase db reset` would then re-execute a seed referencing UUIDs that no longer exist. The migration file `0003_seed_family_users.sql` from v1's plan was dropped for this reason.
10. **Login form: Server Component page wrapping Client Component form** — the Server Component reads `searchParams` and passes `nextPath` as a prop to the Client form. `useSearchParams()` inside a Client Component under `cacheComponents` forces a blocking dynamic render; prop-drilling the resolved value from a Suspense-wrapped Server Component avoids it.
11. **Date in URL, not local state** (v2.1) — the selected date lives as a `?date=YYYY-MM-DD` query param rather than React state or a global store. Trade-offs: shareable links, deep-linking, browser-back semantics, SSR-friendly (Server Components read `searchParams` directly). Cost: every sidebar `<Link>` must preserve the current date param, which a small helper `buildNavHref(pathname, searchParams)` centralizes.
12. **Two data-layer functions per resource, not one with an optional arg** (v2.1) — `getLatestCompositeSnapshots()` and `getCompositeSnapshotsForDate(date)` are separate because `'use cache'` keys on arguments. Splitting makes cache cadence explicit: latest = `cacheLife('days')` (matches cron), historical = `cacheLife('weeks')` (immutable). One function with an optional arg would conflate the two.
13. **Price-overlay deferred to Phase 2** (v2.1) — PRD §8.5 + §11.6 Phase 2 range. Phase 1 date-navigation only touches scores. The `?date=` URL contract is designed so Phase 2 can add a price axis to the same chart without URL changes.
14. **Mobile-first retrofit, not up-front design** (v2.2) — Steps 1-8 were built desktop-first; §11.7's responsive requirement arrived after the data layer landed. Cost of a full top-to-bottom rewrite: ~1 day. Cost of the targeted Step 9.5 retrofit (header/sidebar/viewport/padding) before Step 10 dashboard UI: ~2-3 hours, and every subsequent UI step is authored mobile-first. Trade-off accepted: the retrofit adds one build step, but the UI component library (shadcn `Sheet`, native `<input type="date">`) shoulders most of the complexity. Also: **native `<input type="date">` over a custom picker on mobile** — OS calendars are familiar to mom / 여자친구 and free; visual inconsistency with the header's Kraken styling is accepted since consistency matters less than familiarity for the two non-technical users. **Custom gestures and PWA deferred to Phase 2+** — pull-to-refresh, swipe navigation, and PWA add surface area that could delay MVP; native-gesture non-interference gets us 80% of the "mobile-app feel" for 5% of the work.

---

*Implementation proceeds against this document. When reality drifts from the blueprint, update the blueprint first, then write code.*
