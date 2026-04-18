# Phase 1 Implementation Blueprint

> Generated 2026-04-18 by feature-dev:code-architect based on PRD v3 §18 Phase 1 scope.
> This document is the source of truth for the Phase 1 implementation. Changes should be reviewed before code is written against them.

## Version Assumptions
- Next.js 15.x (App Router, `cookies()` returns Promise)
- `@supabase/ssr` 0.5.x, `@supabase/supabase-js` 2.x
- Node.js 20 LTS, TypeScript 5.4+, Tailwind 3.4+
- shadcn/ui via CLI

## 1. Folder Structure
```
finance-manager/
├── supabase/migrations/
│   ├── 0001_initial_schema.sql
│   ├── 0002_rls_policies.sql
│   └── 0003_seed_family_users.sql
├── src/
│   ├── app/
│   │   ├── (auth)/login/page.tsx              # Client Component
│   │   ├── (protected)/
│   │   │   ├── layout.tsx                     # Session guard + shell
│   │   │   ├── dashboard/page.tsx             # revalidate=86400
│   │   │   ├── asset/[slug]/page.tsx
│   │   │   └── changelog/page.tsx
│   │   └── api/
│   │       ├── cron/ingest-macro/route.ts     # Vercel Cron target
│   │       └── auth/callback/route.ts
│   ├── lib/
│   │   ├── supabase/{server,client,middleware}.ts
│   │   ├── score-engine/
│   │   │   ├── weights.ts                     # MODEL_VERSION + INDICATOR_CONFIG
│   │   │   ├── normalize.ts                   # Z-Score + zScoreTo0100
│   │   │   ├── composite.ts                   # Weighted sum
│   │   │   └── indicators/{fred,types}.ts
│   │   ├── data/{indicators,changelog,snapshot}.ts
│   │   └── utils/{score-band,date}.ts
│   ├── components/{ui,layout,dashboard,changelog,charts,shared}/
│   ├── types/database.ts                      # supabase gen types
│   └── middleware.ts
├── vercel.json                                # Cron schedule
└── .env.local
```

## 2. Supabase Schema

**Tables:**
- `indicator_readings` — every fetched data point, 15 PRD fields + `raw_payload JSONB` for backtest replay. Unique index on `(indicator_key, observed_at, model_version)`.
- `composite_snapshots` — per (asset_type, date, model_version) weighted composite. Dashboard reads this (never recomputes on request).
- `score_changelog` — delta vs previous snapshot, with `top_movers JSONB` and `band_changed` flag.
- `user_preferences` — per-user persona (beginner/intermediate/expert), RLS via `auth.uid()`.
- `ingest_runs` — audit log per cron execution.

**Enums:** `fetch_status_enum('success','error','stale','partial')`, `asset_type_enum('us_equity','kr_equity','btc','global_etf','common')`.

**RLS pattern:**
- All data tables: `TO authenticated USING (true)` for SELECT, `TO service_role` for INSERT.
- `user_preferences`: `(SELECT auth.uid()) = user_id` for all ops (SELECT wrapper caches per-statement).
- Public signup disabled in Supabase Dashboard (not code).

**Family auth bootstrap:** manual via Supabase Dashboard > Auth (3 accounts), documented in `0003_seed_family_users.sql`.

## 3. Data Ingestion Pipeline

**Chosen:** Vercel Cron (Hobby plan, 1/day) → `GET /api/cron/ingest-macro` at 06:00 UTC.

**Flow:**
```
Vercel Cron
 → Auth: Bearer CRON_SECRET
 → Fetch 7 FRED series (FEDFUNDS, CPIAUCSL, DGS10, T10Y2Y, VIXCLS, BAMLH0A0HYM2, SAHMCURRENT)
 → Normalize (Z-Score over 5y window, clamp 0-100)
 → Composite (weighted sum per asset class)
 → Upsert indicator_readings, composite_snapshots, score_changelog, ingest_runs (service_role)
 → revalidateTag('macro-snapshot') + revalidateTag('changelog')
```

**Idempotency:** unique index on `(indicator_key, observed_at, model_version)` makes re-runs safe.

**Trade-off rejected:** GitHub Actions (extra infra), Supabase pg_cron (150ms CPU limit), cron-job.org (3rd-party trust).

## 4. Score Engine

- `weights.ts` exports `MODEL_VERSION = 'v1.0.0'` + per-asset weight table with `inverted: bool` per indicator (BAMLH0A0HYM2, VIX = higher is worse).
- `normalize.ts`: `computeZScore(series, current)` → `zScoreTo0100(z, inverted)` with `clamp(50 - z*50/3, 0, 100)`.
- `composite.ts`: weighted sum → 0-100 + band.
- `score-band.ts`: 80/60/40/20 cuts → `{ band: '강한 비중 확대'|'비중 확대'|'유지'|'비중 축소'|'강한 비중 축소', intensity, color }`.
- **Versioning contract:** bumping `MODEL_VERSION` writes new rows that coexist with old. Full history preserved for backtest.

## 5. Auth & Middleware

- `src/middleware.ts`: calls `supabase.auth.getClaims()` (not `getSession()`), writes refreshed cookies back, redirects unauth→`/login`, auth-at-login→`/dashboard`.
- Matcher excludes `_next/static`, `_next/image`, `favicon.ico`, `api/cron/*`, `api/auth/*`.
- Login: Client Component using browser client, `signInWithPassword()`, redirects to `/dashboard` on success.
- `SUPABASE_SERVICE_ROLE_KEY` only imported by `/api/cron/*` route — never in Client Component import chain.

## 6. UI & Routes

| Route | Type | revalidate | Purpose |
|---|---|---|---|
| `/` | Server | — | Redirect to `/dashboard` |
| `/login` | Client | dynamic | Email+password form |
| `/dashboard` | Server | 86400 | Home, 4 asset cards + composite state + top 3 changes |
| `/asset/[slug]` | Server | 86400 | Detail: 30-day trend + contributing indicators |
| `/changelog` | Server | 86400 | Date-sorted score deltas |
| `/api/cron/ingest-macro` | Handler | force-dynamic | Cron target |

**shadcn components:** `card badge button input label separator skeleton tooltip`.
**Charts:** Recharts `LineChart` with `ReferenceLine` at 80/60/40/20. Wrapped in Client Component, data passed as props from Server parent.

## 7. Caching Strategy

- Page-level `export const revalidate = 86400` (24h safety net).
- Supabase queries wrapped in `unstable_cache` with tags `'macro-snapshot'`, `'changelog'`.
- Cron calls `revalidateTag()` on success → invalidates ISR immediately, fresh data on next request.
- `unstable_cache` required because Supabase client uses pg wire protocol, not `fetch()` (fetch cache doesn't intercept).

## 8. Secrets

**`.env.local`:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`, `CRON_SECRET`.

**Vercel env vars:** all 5 above. Service role + FRED + CRON_SECRET scoped to Production only.

**Rules:** Service role key never in a file reachable by Client Component. `.gitignore` must include `.env.local`.

## 9. Build Sequence

1. **GitHub repo + Supabase project** — create, disable signup, keys in hand.
2. **Next.js scaffold** — `create-next-app` + shadcn init + deps.
3. **Supabase migrations** — run SQL, `supabase gen types` → `database.ts`.
4. **Auth + middleware** — server/client/middleware Supabase clients, login page, callback, 3 family accounts.
5. **Protected layout shell** — sidebar, header, disclaimer banner.
6. **Score engine core** — pure functions, unit-testable (vitest).
7. **Data layer** — snapshot writer + read functions with `unstable_cache`.
8. **Cron route handler** — wire everything, local curl test.
9. **Dashboard UI** — composite card, asset cards, staleness badge, recent changes.
10. **Asset detail + chart** — 30-day trend Recharts component.
11. **Changelog page** — table with band-change highlight.
12. **Vercel deploy + smoke test** — env vars, cron registration, live data verification.

Each step has a defined exit condition — never leave broken state.

## 10. Acceptance Mapping (PRD §16)

| PRD criterion | File / evidence |
|---|---|
| 5초 내 현재 상태 이해 | `dashboard/page.tsx` Server Component + ISR, `CompositeStateCard` above the fold |
| 자산군별 카드 분리 | `AssetCard.tsx` × 4 (asset_type_enum) |
| 매크로 지표 ≥6 | `INDICATOR_CONFIG` 7 series; `ingest_runs.indicators_success` ≥6 |
| RSI/MACD ≥2 | **Phase 2** — schema accommodates via `model_version` without migration |
| BTC 온체인 ≥1 | **Phase 2** |
| 데이터 실패 캐시+배지 | `fred.ts` 오류 시 `fetch_status='error'`; `StalenessButton.tsx` 렌더링 |
| 가족 외 접근 차단 | `middleware.ts` + RLS `TO authenticated` + signup disabled |
| 산식 버전 추적 | `MODEL_VERSION` 모든 insert에 기록 |
| 출처 표시 | `AssetCard` tooltip에 `source_url`, 디테일 페이지 링크 |
| 확정적 자문 방지 | `DisclaimerBanner` fixed, "비중 확대/유지/축소" 사용 |

## Key Trade-off Decisions

1. **Middleware vs layout auth guard** — middleware wins (no flash of protected content).
2. **`unstable_cache` vs fetch cache** — `unstable_cache` required for Supabase (pg protocol).
3. **`raw_payload JSONB` storage** — kept for Phase 3 backtest replay (negligible cost).
4. **Separate `composite_snapshots` table** — cheap single-row reads vs recomputing weighted sum from `indicator_readings` on every request.
5. **Vercel Cron Hobby vs GitHub Actions** — Hobby 1/day matches 24h refresh exactly, zero extra infra.
