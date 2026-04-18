# Phase 1 Implementation Blueprint — v2

> **Version history**
> - **v1** (2026-04-18, by feature-dev:code-architect): initial blueprint against PRD v3 §18 Phase 1, written assuming Next.js 15 + `@supabase/ssr` 0.5.x.
> - **v2** (2026-04-19): rewritten after Next.js 16.2.4 + React 19 + Tailwind v4 + `@supabase/ssr` 0.10.2 turned out to be the actually-installed stack, and after the user chose Path B (Cache Components model) for caching. Product requirements, scope, and schema are identical to v1. Only the Next.js-specific patterns changed.
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
│   ├── components/{ui,layout,dashboard,changelog,charts,shared}/
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

| Route | Type | Cache mechanism | Purpose |
|---|---|---|---|
| `/` | Server | static | Redirects to `/dashboard` |
| `/login` | Partial Prerender | static shell + Suspense | Email+password form |
| `/dashboard` | Server | `'use cache' + cacheTag('macro-snapshot') + cacheLife('days')` | Home: composite state + 4 asset cards + top 3 changes |
| `/asset/[slug]` | Server | `'use cache' + cacheTag('macro-snapshot') + cacheLife('days')` | Asset detail: 30-day trend + contributing indicators |
| `/changelog` | Server | `'use cache' + cacheTag('changelog') + cacheLife('days')` | Date-sorted score deltas |
| `/api/cron/ingest-macro` | Route Handler | none (write path) | Cron target |
| `/api/auth/callback` | Route Handler | none | PKCE fallback |

**shadcn components installed:** `button, card, badge, input, label, separator, skeleton, tooltip` (base-nova style, Lucide icons).

**Charts:** Recharts `LineChart` + `ReferenceLine` at 80/60/40/20 for band thresholds. Recharts requires the browser DOM, so the chart component is wrapped in `"use client"` and receives pre-fetched data as a serializable prop from the parent Server Component.

**Suspense-wrapped auth-dependent UI (required under Path B):** any component that calls `cookies()` / `headers()` at request time must be inside a `<Suspense>` boundary — otherwise the prerender fails with "Uncached data was accessed outside of `<Suspense>`". The protected layout's sidebar user display reads the session cookie to show the user name, so it is extracted to a sub-component inside `<Suspense fallback={<SidebarSkeleton />}>` in the protected layout.

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
```

Example page-level pattern (`src/app/(protected)/dashboard/page.tsx`):

```ts
'use cache'
cacheTag('macro-snapshot')
cacheLife('days')
```

**Constraint:** `'use cache'` **cannot** appear at the top of a Route Handler body. For the cron handler, keep the cache-invalidation call (`revalidateTag('macro-snapshot', { expire: 0 })`) in the handler and extract any read-only helper that needs caching into a separate `'use cache'`-directive function.

**Open item to verify at implementation time:** captured values inside a `'use cache'` scope must be serializable. A `SupabaseClient` instance is not. The pattern above calls `getSupabaseServerClient()` inside the cached scope, which in turn awaits `cookies()`. If this breaks the static shell (it may, under `cacheComponents`), the fix is to pull cookies/client-creation outside the cached function and pass a serializable query-argument set in. Test on first dev-server start; fall back to a thin uncached Server Component wrapper that fetches and then passes data into a `'use cache'` pure transformer if needed.

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
6. **Protected layout shell** (next) — `src/app/(protected)/layout.tsx` reads session via `getSupabaseServerClient`, renders sidebar + header + disclaimer banner. Auth-dependent sub-component (user display) wrapped in `<Suspense>`. Stub pages for `/dashboard`, `/asset/[slug]`, `/changelog` so the shell has real routes to link to.
7. **Score engine core** — pure functions first: `weights.ts` (`MODEL_VERSION`, `INDICATOR_CONFIG`), `normalize.ts` (`computeZScore`, `zScoreTo0100`), `composite.ts`, `score-band.ts`. Unit-testable with Vitest; exit condition is tests green without any DB.
8. **Data layer & snapshot writer** — `src/lib/data/snapshot.ts` (admin-client writer, no cache), `indicators.ts` + `changelog.ts` readers with `'use cache'` + `cacheTag` + `cacheLife('days')`.
9. **Cron route handler** — `src/app/api/cron/ingest-macro/route.ts`: CRON_SECRET check → FRED fetches → normalize → composite → snapshot write → `revalidateTag('...', { expire: 0 })`. `vercel.json` with cron schedule. Local smoke test via `curl -H "Authorization: Bearer ${CRON_SECRET}"`.
10. **Dashboard UI** — `dashboard/page.tsx` reads from `getLatestCompositeSnapshots`; `CompositeStateCard`, `AssetCard`, `RecentChanges` components; `StalenessBadge` renders `ingested_at` + `fetch_status`.
11. **Asset detail & changelog UI** — `asset/[slug]/page.tsx` (async params), 30-day `ScoreTrendLine` Recharts Client Component, changelog table with `band_changed` highlight.
12. **Vercel deploy + smoke test** — push to GitHub → Vercel auto-deploys. Add all env vars (service role / FRED / CRON_SECRET Production-only). Manually trigger cron from Vercel UI; verify data in Supabase; verify dashboard renders with `revalidateTag` working.

## 10. Acceptance Criterion Mapping

Every PRD §16 criterion mapped to the specific file / test that proves it. This table is unchanged from v1 — requirements didn't shift, only the framework did.

### §16.1 MVP Acceptance

| Criterion | Proving file / evidence |
|---|---|
| 홈 화면에서 5초 내 현재 상태를 이해할 수 있다 | `/dashboard/page.tsx` is `'use cache'` + Server Component → HTML is near-static; `CompositeStateCard` renders band + Korean label above the fold. Vercel Analytics LCP < 2s target. |
| 자산군별 카드가 분리되어 있다 | `AssetCard.tsx` rendered once per `asset_type_enum` value (4 cards). |
| 최소 6개 이상의 공통 매크로 코어 지표가 자동 반영된다 | `INDICATOR_CONFIG` in `weights.ts` defines 7 FRED series; `ingest_runs.indicators_success` must be ≥ 6 on green runs. |
| 최소 2개 이상의 기술적 지표(RSI, MACD)가 적용된다 | **Phase 2 scope** — PRD §18 places these in Phase 2. The `model_version` scheme accommodates additions without a schema migration. |
| BTC에는 최소 1개 이상의 온체인 지표(MVRV 또는 SOPR)가 적용된다 | **Phase 2 scope** — same. The `crypto` asset class will carry these when they land. |
| 데이터 실패 시 캐시와 상태 배지가 작동한다 | `fred.ts` returns `fetch_status: 'error'` on failure; `snapshot.ts` persists status; `StalenessBadge.tsx` renders red when status ≠ 'success'; cron continues with remaining indicators (partial data > no data). |
| 가족 계정 외 사용자는 데이터에 접근할 수 없다 | `proxy.ts` redirects unauth; RLS `TO authenticated` on all data tables; Supabase Dashboard has Sign Ups disabled. |

### §16.2 Quality

| Criterion | Proving file / evidence |
|---|---|
| 점수 산식 버전이 추적 가능해야 한다 | `MODEL_VERSION` in `weights.ts` flows into every row's `model_version` column; `SELECT DISTINCT model_version FROM composite_snapshots` shows version history. |
| 데이터 출처가 화면에 표시되어야 한다 | `AssetCard` tooltip shows `source_url` from `INDICATOR_CONFIG`; `StalenessBadge` shows `ingested_at`. |
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

---

*Implementation proceeds against this document. When reality drifts from the blueprint, update the blueprint first, then write code.*
