# Session Handoff

## 1. Snapshot Timestamp

2026-04-27 (KST late evening) — Phase 3.4 Backtest UI **CLOSED**. Trigger 2 5-agent review complete; fix-up `feaea46` shipped + pushed (security/correctness/drift findings ≥ 80 confidence resolved). Next sub-phase = **3.1 Regime Classification** (ECOS adapter blocked on user-supplied API key).

## 2. Current Phase / Step

**Phase 3.4 = closed.** All steps shipped + production-verified + Trigger 2 reviewed + fixed up. CLAUDE.md mandate satisfied. Next: **Phase 3.1 Regime Classification** entry — first action is blueprint authoring after user supplies ECOS API key.

## 3. Last Commit

`feaea46` — `fix(phase3.4): Trigger 2 review fix-up — security + correctness + drift` on `main`. Pushed (origin in sync). Working tree clean.

## 4. Active Thread

- **Just finished**: Phase 3.4 Trigger 2 5-agent review on `9ac146f..6c4924b` aggregate diff. 5 reviewers ran in parallel covering compliance / shallow bug / git history / comments-vs-reality / security+integration. Confidence ≥ 80 findings consolidated and fixed in single commit `feaea46`. Migration `0012_phase34_backtest_fixup.sql` applied to prod (Supabase `hhohrclmfsvpkigbdpsb`). Tests 577/577 (was 571; +6 hash collision/canonical/null-routing). `next build` clean. Vercel auto-deploy will redeploy on push.
- **About to start (next session)**: Phase 3.1 blueprint authoring at `docs/phase3_1_regime_classification_blueprint.md` — modeled on Phase 3.0 / 3.4 blueprint structure. ECOS adapter (BOK rate, KR 10Y, M2, KRW/USD daily) extends FRED's `DEXKOUS` + `DTWEXBGS` regional_overlay baseline.
- **Not blocked.** 7-day reliability watch ticks until 2026-05-03; cron stable.

## 5. Pending User Decisions

- **ECOS API key** — required for Phase 3.1 entry. Free signup at `https://ecos.bok.or.kr/api/`. Once keyed, set `ECOS_API_KEY` in `.env.local` + GH secrets + Vercel Production env.

## 6. Recent Context (last 5 commits)

- `feaea46` Trigger 2 fix-up — proxy auth gap closed (`/backtest`+`/indicators`), `customWeightsId` ownership enforced, memo hash includes inline customWeights payload, `reweightSnapshot` null-routing fixed, migration 0012 (RLS form, NOT NULL+CASCADE, `raw_inputs` JSONB).
- `14b863c` Handoff snapshot pre-fix-up.
- `6c4924b` Handoff snapshot — Phase 3.4 production verified (drift = 0).
- `b93098b` Steps 7b + 8 + 9 — `/api/backtest/save-weights` + family reader + PRD §18 promotion + handoff doc.
- `3ee42da` Steps 5–7 — `/backtest` UI (Suspense shell + 4 client components + tuning slider).

## 7. Open Issues to Watch

- **`FamilyRunsReader` user_email** still displays user_id 8-char prefix (Phase 3.4.1 nicety — full plumbing needs an auth metadata reader).
- **MOMENTUM_TURN signal** still `unknown` — MACD 7-day window accumulation pending. Self-resolves over the cron watch window (~2026-05-03).
- **Phase 3.4.1 OOS**: signal-only backtest (would consume `backtest_snapshots.raw_inputs` JSONB now provisioned by migration 0012), multi-asset overlay, full email plumbing.
- **DART/ECOS adapters** still scheduled for 3.2 / 3.1 respectively. DART_API_KEY already provisioned across .env.local + GH secrets + Vercel; ECOS pending §5.
- **pg_graphql anon SELECT advisor warning** on all 16 public tables (RLS enforces row-level access; only schema names are visible). Pre-Phase-3.4 condition; not introduced by 0011/0012.

## 8. Environment State

- **Stack**: Next.js 16.2.4 (Turbopack, cacheComponents:true), React 19.2.4, Tailwind v4, @supabase/ssr 0.10.2, TS 5 strict, Recharts 3.x, Vitest 4.1.4.
- **Tests**: **577/577 green** across 39 files (Phase 3.0 closed at 532; Phase 3.4 base added 39: 12 weights-registry + 21 backtest engine + 6 hash; fix-up added 6: 4 hash collision + 2 canonical sha256 + null-routing reshape).
- **MCP servers**: figma, supabase, context7, alphavantage, Claude-in-Chrome (jw.byun@toss.im authenticated).
- **`.env.local` keys**: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, FRED_API_KEY, ALPHA_VANTAGE_API_KEY, CRON_SECRET, FINNHUB_API_KEY, VERCEL_OIDC_TOKEN, **TWELVEDATA_API_KEY** (Phase 3.0), **DART_API_KEY** (Phase 3.2 pre-provisioned). ECOS_API_KEY pending.
- **Vercel prod**: `finance-manager-james.vercel.app` → auto-deploys `feaea46` on push.
- **GitHub repo secrets**: CRON_SECRET, PRODUCTION_URL (`https://finance-manager-james.vercel.app`), FINNHUB_API_KEY, TWELVEDATA_API_KEY, DART_API_KEY.
- **Supabase**: `hhohrclmfsvpkigbdpsb` (Seoul, Postgres 17.6.1.104). Migrations 0001–0012 applied. Phase 3.4 base = `0011`; fix-up = `0012`.
- **Cron workflows**: `cron-hourly.yml` (cnn-fg + news, hourly), `cron-onchain.yml` (BGeometrics every 4h), `cron-technical.yml` (daily 22:00 UTC, 19 tickers fallback chain).
- **Known degraded**: BGeometrics 15/day (4h cadence keeps under cap), CNN F&G partial parsing (VIX-only fallback for EXTREME_FEAR), MOMENTUM_TURN unknown until MACD history accumulates.

## 9. How to Resume

1. **First action**: prompt user for ECOS API key (`https://ecos.bok.or.kr/api/`, free, 100k req/day) → kick off Phase 3.1 blueprint authoring (`docs/phase3_1_regime_classification_blueprint.md`) modeled on Phase 3.0 / 3.4 blueprint structure. Reference existing FRED `DEXKOUS` + `DTWEXBGS` regional_overlay as the macro-only baseline; ECOS adds BOK rate, KR 10Y, M2, KRW/USD daily.
2. **Then**: `gh run list --workflow=cron-technical.yml --limit 3` + `cron-onchain.yml` + `cron-hourly.yml` to confirm Phase 3.0 reliability watch holds (target: 7 consecutive green days through 2026-05-03).
3. **Watch**: Vercel deployment of `feaea46` → check `/backtest` + `/indicators` redirect to `/login` when unauthenticated (proxy fix verification).

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
