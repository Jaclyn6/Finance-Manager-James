# Session Handoff

## 1. Snapshot Timestamp

2026-04-23 06:45 (manual `/handoff`, Phase 1 fully shipped, pre-Phase C)

## 2. Current Phase / Step

**Phase 1 COMPLETE.** Production live at `https://finance-manager-james.vercel.app`. All 12 blueprint Steps green.

Phase 2 blueprint `docs/phase2_architecture_blueprint.md` v1.0 authored + reviewed. Next is **Phase C Step 1 (Schema migration 0005–0010)** per blueprint §9.

Phase 1 blueprint v2.3 Steps: 1✔ 2✔ 3✔ 4✔ 5✔ 6✔ 7✔ 8✔ 9✔ 9.5✔ 10✔ 10.5✔ 11✔ 11.5✔ **12✔ (deployed + smoke tested)**.

## 3. Last Commit

`3917323` — `fix: double-cast TopMover[] to Json in backfill script` on `main`. Origin in sync (no unpushed).

**Uncommitted (noise):** `.gitignore` has 2 duplicate lines (`. vercel` and `.env*.local`) auto-appended by `vercel link`. Both already covered by earlier patterns — safe to revert or leave. Not flagged as work.

## 4. Active Thread

- **Just finished (this session):**
  - **Doc lane:** PRD v3.3 (§18 canonical, §16.3 신설) + PRD v3.4 (자산제곱 video framework — §8.1 ICSA/TGA, §8.2 이격도, §8.4 CNN F&G, §10.4 Signal Alignment) + `docs/phase2_plan.md` (9 ambiguities resolved, 4 cross-cutting tenets) + `docs/phase2_architecture_blueprint.md` v1.0 (836 lines, 15 Steps incl. 7.5 Signal Engine + 8.5 Signal UI Card). B.3 review gate: P0 1건 + P1 5건 수정 적용. New ambiguity #10 (US equity valuation source) flagged for later.
  - **Phase 1 closure:** Vercel deploy + smoke test. `vercel link` (finance-manager project, jaclyn6s-projects team, Hobby) → 6 env vars injected to Production scope → `vercel --prod` (44s build) → Production URL live. Domain renamed to `finance-manager-james.vercel.app`. Deployment Protection tuned to Standard (prod + custom aliases public). Supabase Auth: Redirect URL `/api/auth/callback` added + Site URL bumped to prod. HTTP smoke (7 checks: redirect/login/protected/cron auth) all green. Manual cron trigger: 200 + 7 indicators success + 5 snapshots written + 8.6s duration + 2026-04-22 row live in Supabase. User confirmed browser login flow on 3 accounts + mobile visual.
- **About to start (next session):** Phase C Step 1 — Supabase schema migrations 0005–0010 (new Phase 2 tables + `MODEL_VERSION v2.0.0` / `SIGNAL_RULES_VERSION v1.0.0` / `TICKER_LIST_VERSION` constants + RLS).
- **Not blocked.**

## 5. Pending User Decisions

None. All Phase 2 ambiguities resolved except #10 (valuation data source) which is Phase 3-soft-deadline, not Phase C Step 1 blocker.

## 6. Recent Context (last 5 commits)

- `3917323` backfill TS cast fix — unblocked `npm run build` for Vercel deploy.
- `c517595` Phase 2 blueprint v1.0 + B.3 review fixes + ambiguity #10 — architecture contract for Phase C.
- `11a28bf` PRD v3.3/v3.4 + Phase 2 plan — 9 ambiguities resolved, 자산제곱 video framework编入.
- `b0a99bc` previous handoff (2026-04-20) — snapshot pre-Step 12.
- `cfb813e` Step 11.5 post-review — dotenv override fix + NaN guard + blueprint H1 alignment.

## 7. Open Issues to Watch

- **Ambiguity #10 (US equity valuation)** — blueprint absorbs weight 10 into sentiment until Phase 3 (blueprint §12 trade-off 7). Real decision needed before Phase 3 backtest work.
- **Alpha Vantage budget** — Phase 2 uses 19/25 daily calls; only 6 calls headroom for manual backfill + retries. Adding more tickers = Twelve Data switch or Pro upgrade.
- **GitHub Actions CRON_SECRET sync** — Phase C Step 7 needs the same CRON_SECRET added to GitHub repo Actions secrets (manual sync, no OIDC). Value is in Vercel Production env already.
- **`.gitignore` duplicate lines** from `vercel link` — redundant with earlier patterns, cosmetic.
- **Phase 1 blueprint §5 Routing table** — still says `'use cache'` page-level but impl is Partial Prerender (documented at §7). Low priority docs drift.
- **`ThemeToggle` + `SignOutButton` size-9** (36×36, <44×44) — Phase 2 UI polish candidate during Step 8/8.5.
- **Header "오늘의 투자 환경"** — desktop still route-static (mobile hides). Phase 2 polish candidate.
- **Motion-safe prefix** not applied to Recharts/Popover/Calendar/Sheet animations systemically — Phase 2 §6.4 handles it.
- **First automatic Vercel cron run** — 2026-04-24 06:00 UTC. Monitor Vercel Dashboard → Cron Jobs for success; confirms `revalidateTag` evicts and daily row appears in `composite_snapshots`.
- **Crypto-specific signals** (`CRYPTO_UNDERVALUED` + `CAPITULATION`) introduced in blueprint §4.5 beyond PRD §10.4 "고려" — PRD revision note needed at Phase C Step 7.5 implementation time.

## 8. Environment State

- **Stack**: Next.js 16.2.4 (Turbopack, `cacheComponents: true`), React 19.2.4, Tailwind v4, `@supabase/ssr` 0.10.2, TypeScript 5, `next-themes` 0.4, Recharts 3.8.1, Vitest 4.1.4. shadcn: badge/button/calendar/card/input/label/popover/separator/sheet/skeleton/tooltip. react-day-picker 9.14.0. dotenv + tsx devDeps.
- **Runtime**: Node v24.15.0, npm 11.12.1, Vercel CLI 52.0.0, bash on Windows 11.
- **Cache model**: Path B (`cacheComponents: true`). Admin client inside `'use cache'` is allowed (family-wide data); `cookies()/headers()/connection()` banned inside cached scopes.
- **File renames**: `middleware.ts` → `proxy.ts` (Next 16.2). Never create `middleware.ts`.
- **`server-only` split**: `admin.ts` + `fred.ts` guarded; `fred-parse.ts` guard-free for Node-env scripts. Phase 2 replicates this pattern for every new source (`alpha-vantage.ts` + `-parse.ts`, etc.).
- **MCP servers** (project-scope `.mcp.json`): `figma`, `supabase`, `context7`, `alphavantage`.
- **`.env.local` keys** (git-ignored, names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `CRON_SECRET`, `VERCEL_OIDC_TOKEN` (auto-managed by Vercel CLI, 12h refresh).
- **Vercel**: project `finance-manager`, team `jaclyn6s-projects`, Hobby plan. Production alias `finance-manager-james.vercel.app`. Other aliases: `iota-two`, `jaclyn6-jaclyn6s-projects`, `jaclyn6s-projects` (4 total, all point to same deployment). Deployment Protection: Standard. Production Function region: default (not pinned).
- **Supabase**: `hhohrclmfsvpkigbdpsb` (ap-northeast-2 Seoul, free). Migrations 0001–0004 applied. Auth: signups disabled, 3 family users hand-provisioned (`jw.byun@toss.im` + `edc0422@...` + `odete4@...`). Site URL = `https://finance-manager-james.vercel.app`. Redirect URLs whitelist = `localhost:3000` + production.
- **GitHub**: `Jaclyn6/Finance-Manager-James` private. `gh` CLI auth'd as `Jaclyn6`. No Actions workflows yet (Phase C Step 7 will add).
- **Data state**: 30-day backfill (2026-03-21 → 2026-04-19) + today's row (2026-04-22 via manual cron trigger). `composite_snapshots` total ≈ 155 rows, `indicator_readings` ≈ 83, `score_changelog` ≈ 145. All `model_version: v1.0.0`.
- **Secret expiry watch**: `SUPABASE_SERVICE_ROLE_KEY` JWT exp 2092 (no concern). `VERCEL_OIDC_TOKEN` 12h (auto-refresh). No API keys on rotating schedule.
- **Blueprint versions**: Phase 1 `docs/phase1_architecture_blueprint.md` v2.3. Phase 2 `docs/phase2_architecture_blueprint.md` v1.0. PRD `investment_advisor_dashboard_prd_kr_v3.md` v3.4. All aligned.
- **Handoff**: manual only (`/handoff`). No hooks.
- **Code-review workflow**: CLAUDE.md Trigger 1/2 active. Phase C Steps will each get the 5-agent review after commit.

## 9. How to Resume

1. Read `docs/phase2_architecture_blueprint.md` v1.0 §9 Build Sequence (primary work governance). Cross-reference `docs/phase1_architecture_blueprint.md` v2.3 §7 for invariants you must preserve (Path B cacheComponents / `'use cache'` with admin client OK / `server-only` split / composite_snapshots immutability).
2. Read `docs/phase2_plan.md` §0.2 (9 resolutions + #10 open) and §0.5 (4 cross-cutting tenets: Silent success loud failure / Snapshot immutability / Family-wide / Actionable over aggregate). These frame every implementation decision.
3. **Next concrete action:** Phase C Step 1 — author migrations `supabase/migrations/0005_phase2_schema.sql` through `0010_phase2_indexes.sql` per blueprint §8. Tables: `technical_readings`, `onchain_readings`, `news_sentiment`, `price_readings`, `signal_events` (PK `(snapshot_date, signal_rules_version)`). Add `MODEL_VERSION = "v2.0.0"`, `SIGNAL_RULES_VERSION = "v1.0.0"`, `TICKER_LIST_VERSION = "v1.0.0-2026-04-23"` constants to `src/lib/score-engine/weights.ts` + `signals.ts` stub. RLS family-read / service_role-write on all new tables. Apply via Supabase MCP `apply_migration`. Commit + push + run CLAUDE.md Trigger 1 5-agent review before Step 2.

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
