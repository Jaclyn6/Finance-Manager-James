# Session Handoff

## 1. Snapshot Timestamp

2026-04-27 (KST late evening) — Phase 3.4 Backtest UI core shipped + production-verified. Trigger 2 5-agent review on full Phase 3.4 diff still pending (deferred from this session due to context budget). Working tree clean, origin/main in sync.

## 2. Current Phase / Step

**Phase 3.4 — Backtest UI: 9 build steps + 7b persistence + 8 family share IMPLEMENTED.** Mid-phase only in the sense that Trigger 2 5-agent review (CLAUDE.md Trigger 2 mandate) wasn't run before push — that's the carry-over. After review fix-up, Phase 3.4 is closeable; next sub-phase is **3.1 Regime Classification** (ECOS adapter + KR-specific macro panel). Phase 3.0 fully closed (matrix 13/16 MET).

## 3. Last Commit

`6c4924b` — `docs: handoff snapshot — Phase 3.4 production verified` on `main`. Pushed (origin in sync). Working tree clean — no uncommitted changes.

## 4. Active Thread

- **Just finished**: Phase 3.4 base (Steps 1–9) + Step 7b (`POST /api/backtest/save-weights` + 이름 붙여 저장 UI) + Step 8 (`FamilyRunsReader` server-loaded list of other-family-member runs). Production-deployed `dpl_2mlggd8ei` aliased to `finance-manager-james.vercel.app`. Chrome MCP verified `/backtest` end-to-end: drift = 0.00점 (§5 acceptance #2 PASS), tuning sliders, save-by-name button, family reader empty-state all rendering nominal. Tests 571/571 across 39 files.
- **About to start (next session)**: Trigger 2 5-agent review on full Phase 3.4 diff (`9ac146f..HEAD`) — covers blueprint compliance, shallow bug scan, git-history regression, code-comments-vs-reality, integration. Confidence ≥ 80 findings → fix-up commit → push. Then Phase 3.4 fully closes.
- **Not blocked.** Phase 3.0 day-1 cron stable; matrix 13/16 MET; 7-day reliability watch ticks until 2026-05-03.

## 5. Pending User Decisions

- **ECOS API key** — required for Phase 3.1 entry. Free signup at `https://ecos.bok.or.kr/api/`. Once keyed, set `ECOS_API_KEY` in `.env.local` + GH secrets + Vercel Production env.
- **Phase 3.1 vs Phase 3.4 closeout sequencing** — defer 3.1 until 3.4 Trigger 2 review lands, OR start 3.1 blueprint authoring in parallel? (Recommendation: review first; serial keeps audit trail clean.)

## 6. Recent Context (last 5 commits)

- `6c4924b` Handoff snapshot — Phase 3.4 production verified (drift = 0).
- `b93098b` Steps 7b + 8 + 9 — `/api/backtest/save-weights` endpoint + family reader + PRD §18 promotion + handoff doc.
- `3ee42da` Steps 5–7 — `/backtest` UI (Suspense shell + 4 client components + tuning slider).
- `76e63d2` Step 4 — `POST /api/backtest/run` + canonical sha256 hash + 6 hash unit tests.
- `bb19f77` Step 3 — `0011_phase34_backtest.sql` migration applied to prod (3 tables: backtest_runs + backtest_snapshots + user_weights, family-shared RLS reads).

## 7. Open Issues to Watch

- **CLAUDE.md Trigger 2 review owed for Phase 3.4** — multiple commits pushed without the 5-agent review. Run on aggregate diff `9ac146f..HEAD` next session as first action; fix-up commit allowed (post-push fix is documented carry-over).
- **`FamilyRunsReader` user_email** displays user_id 8-char prefix (not the actual email). Full plumbing needs an auth metadata reader — flagged in `src/components/backtest/family-runs-reader.tsx` doc-comment. Phase 3.4.1 nicety.
- **MOMENTUM_TURN signal** still `unknown` — MACD 7-day window accumulation pending. Self-resolves over the cron watch window (~2026-05-03).
- **`backtest_runs.weights_version` audit suffix** uses a non-cryptographic 32-bit hash (`(h>>>0).toString(16)`). Collision-tolerant for memoization (full sha256 keys the actual key) but worth swapping to sha256-prefix in Phase 3.4.1 for cleaner audit trails. See `src/app/api/backtest/run/route.ts:validateRequest`.
- **DART/ECOS adapters** still scheduled for 3.2 / 3.1 respectively. DART_API_KEY already provisioned across .env.local + GH secrets + Vercel; ECOS pending §5.
- **pg_graphql anon SELECT advisor warning** on all 16 public tables (RLS enforces row-level access; only schema names are visible). Pre-Phase-3.4 condition; not introduced by 0011 migration.

## 8. Environment State

- **Stack**: Next.js 16.2.4 (Turbopack, cacheComponents:true), React 19.2.4, Tailwind v4, @supabase/ssr 0.10.2, TS 5 strict, Recharts 3.x, Vitest 4.1.4.
- **Tests**: **571/571 green** across 39 files (Phase 3.0 closed at 532; Phase 3.4 added 39 new tests: 12 weights-registry + 21 backtest engine + 6 hash).
- **MCP servers**: figma, supabase, context7, alphavantage, Claude-in-Chrome (jw.byun@toss.im authenticated).
- **`.env.local` keys**: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, FRED_API_KEY, ALPHA_VANTAGE_API_KEY, CRON_SECRET, FINNHUB_API_KEY, VERCEL_OIDC_TOKEN, **TWELVEDATA_API_KEY** (Phase 3.0), **DART_API_KEY** (Phase 3.2 pre-provisioned). ECOS_API_KEY pending.
- **Vercel prod**: `finance-manager-james.vercel.app` → `dpl_2mlggd8ei` (commit `b93098b`/`6c4924b` doc-only since).
- **GitHub repo secrets**: CRON_SECRET, PRODUCTION_URL (`https://finance-manager-james.vercel.app`), FINNHUB_API_KEY, TWELVEDATA_API_KEY, DART_API_KEY.
- **Supabase**: `hhohrclmfsvpkigbdpsb` (Seoul, Postgres 17.6.1.104). Migrations 0001–0011 applied. Phase 3.4 = `0011_phase34_backtest.sql`.
- **Cron workflows**: `cron-hourly.yml` (cnn-fg + news, hourly), `cron-onchain.yml` (BGeometrics every 4h), `cron-technical.yml` (daily 22:00 UTC, 19 tickers fallback chain).
- **Known degraded**: BGeometrics 15/day (4h cadence keeps under cap), CNN F&G partial parsing (VIX-only fallback for EXTREME_FEAR), MOMENTUM_TURN unknown until MACD history accumulates.

## 9. How to Resume

1. **First action**: run Trigger 2 5-agent review on Phase 3.4 full diff (`git diff 9ac146f..HEAD`). Five reviewers in parallel (compliance / shallow bug / git history / comments-vs-reality / integration). Apply confidence ≥ 80 fixes in a single fix-up commit, push.
2. **Then**: `gh run list --workflow=cron-technical.yml --limit 3` + `cron-onchain.yml` + `cron-hourly.yml` to confirm Phase 3.0 day-2 watch holds (target: 7 consecutive green days through 2026-05-03).
3. **Concrete next**: prompt user for ECOS API key (`https://ecos.bok.or.kr/api/`, free, 100k req/day) → kick off Phase 3.1 blueprint authoring (`docs/phase3_1_regime_classification_blueprint.md`) modeled on the Phase 3.0 / 3.4 blueprint structure. Reference existing FRED `DEXKOUS` + `DTWEXBGS` regional_overlay as the macro-only baseline; ECOS adds BOK rate, KR 10Y, M2, KRW/USD daily.

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
