# Session Handoff

## 1. Snapshot Timestamp

2026-04-25 (session end; composite v2 category-score wiring shipped + deployed + Chrome MCP visually verified in production with real multi-category data).

## 2. Current Phase / Step

**Phase C Steps 1–12 COMPLETE + composite v2 category-score wiring COMPLETE.** Phase 2 now produces real per-category breakdowns on every `ingest-macro` run:
- `/asset/us-equity` → "3/6 카테고리 반영" (macro + sentiment + valuation)
- `/asset/crypto` → "2/6 카테고리 반영" (macro + sentiment; onchain null due to stale source-table error rows)
- Composite scores for 2026-04-25 shifted (e.g. us_equity 48.85) because new 4-category renormalization now contributes beyond macro-only.

**Next: Phase C Step 13** (blueprint §9 lines 719–727). Scope: §10 acceptance matrix + UI polish (`size-11`, `motion-safe:`, PNG icons) + CLAUDE.md **Trigger 2** (5-agent review over full Phase 2 diff from `main` divergence).

## 3. Last Commit

`39e215f` — `feat(phase2): composite v2 category-score wiring — fill 4-5/6 categories` on `main`. Pushed. Working tree clean.

## 4. Active Thread

**Landed this session (2026-04-25):**

- Started at commit `dfb4ec2` (handoff post Phase C Step 12).
- Shipped `39e215f` — composite v2 category-score wiring:
  - NEW `src/lib/score-engine/category-aggregators.ts` (520 lines): 5 pure aggregators (`aggregateTechnical` / `aggregateOnchain` / `aggregateSentiment` / `aggregateValuation` / `aggregateRegionalOverlay`) with first-wins dedup (matching `latestOnchain` precedent), null propagation per §2.2 tenet 1, `common → us_equity` weight-mirror fallback for technical.
  - MODIFIED `src/app/api/cron/ingest-macro/route.ts`: reads `technical_readings` (limit 500 DESC) / `onchain_readings` / `news_sentiment` under `MODEL_VERSION=v2.0.0`, each in try/catch so category-level failures don't abort the cron; calls `computeCompositeV2` with full `CategoryScores`; writes nested `contributing_indicators` JSONB.
  - 36 aggregator unit tests + 3 regression tests for the dedup fix (SPY RSI_14 today=70 vs yesterday=40 → expects 70; NVDA news today=80 vs yesterday=20 → expects 80; `aggregateTechnical('common')` → us_equity fallback fires).
  - 2-hat review (R1-3 blueprint/bugs/drift + R4-5 comments/security) caught a HIGH bug class that hit both technical AND news aggregators — `.limit(500)` returned ~4 days of data and the aggregator was averaging multi-day rows into "today's" score. Fix: first-wins `Map<ticker|indicator_key>` dedup on DESC-sorted rows.
- **Production deployed** — `vercel --prod --yes` → `finance-manager-lku0h60yc-jaclyn6s-projects.vercel.app` (aliased `finance-manager-james.vercel.app`).
- **Manual production smoke** — `POST /api/cron/ingest-macro` with CRON_SECRET Bearer returned `{"status":"success", "snapshots_written":5, "duration_ms":8888}`. Five `composite_snapshots` rows for 2026-04-25 with multi-category JSONB.
- **Chrome MCP visual verification** (`mcp__Claude_in_Chrome__*`):
  - `/asset/us-equity` displays "3/6 카테고리 반영" stacked bar + nested indicator rows (매크로 46.2 / 뉴스·심리 59.7 [NVDA 63.6, GOOGL 61.9, AMZN 59.3, AAPL 58.0, MSFT 55.8] / 밸류에이션 50.0).
  - `/asset/crypto` displays "2/6 카테고리 반영" + "1/7 신호 활성" SignalAlignmentCard.
  - `/dashboard` hero: "1/6 신호 활성" — `ECONOMY_INTACT` fires on real data (ICSA=214,000 < 300,000, Sahm=0.2 < 0.5).
  - **Step 7.5 `signal_events` table NOW POPULATED** in production — first row written by the ingest-macro tail-call after deploy.
  - Zero console errors, all pages render.

**GHA `cron-technical` state (at session end):**
- Manually dispatched run `24920958904` FAILED at 4m18s with **HTTP 500** after writing partial data (18 `technical_readings` rows = 3/19 tickers succeeded). Likely root cause: **Vercel Hobby 300s `maxDuration` timeout** — 19 tickers × 13s sleep ≈ 247s + AV fetch + Supabase writes pushes right up against the 300s wall. Solutions:
  - Split cron into 2 batches (10 + 9 tickers) triggered 30 min apart OR
  - Reduce AV sleep to 12s (still under 5/min = 12s floor) OR
  - Upgrade to Vercel Pro (900s timeout) OR
  - Move full ingestion to GHA runner (generous timeout, runs ingestion locally and writes direct to Supabase via service-role key)
- Two earlier runs failed at 9s each due to `PRODUCTION_URL` secret value missing the `https://` prefix. Fixed via `gh secret set PRODUCTION_URL`.
- `CRON_SECRET` also re-synced from `.env.local` → GH repo secret (was out of sync after earlier rotation, causing 401 in the second attempt).

## 5. Pending User Decisions

- None. Step 13 is polish + acceptance matrix — proceed.

## 6. Recent Context (last 5 commits)

- `39e215f` composite v2 category-score wiring — 5 aggregators + ingest-macro extension + 3 dedup regression tests
- `dfb4ec2` Handoff snapshot pre-category-wiring
- `224a63c` Step 11 + 12 — 180-day extension + PWA shell (manifest + sw.js + SVG icons)
- `2f4d36d` Step 9 + 10 — prices reader + ComposedChart overlay (deleted dead ScoreTrendLine)
- `0f8211c` Step 8 + 8.5 — 4-category contributing + SignalAlignmentCard hero

## 7. Open Issues to Watch

### Data source issues that make UI show < 4/6

- **`technical_readings` empty / partial** (18 rows as of handoff — only 3 of 19 tickers from earliest GHA partial run). Awaiting GHA `cron-technical.yml` run `24920958904` to complete with all 19 tickers × 6 indicators = 114 rows. Once populated, `ingest-macro` next-run will upgrade `us_equity` / `kr_equity` / `global_etf` / `common` to 4/6 categories (+ technical).
- **`onchain_readings` all-error/stale**: MVRV_Z, SOPR, BTC_ETF_NETFLOW fetch_status=`error`; CNN_FG=`partial`; CRYPTO_FG=`success`. Latest observed_at=2026-04-23 (2 days stale). Aggregator correctly returns null → crypto onchain missing. Root causes:
  - Bitbo MVRV/SOPR scraping — likely UA/header issue (same class as CNN F&G).
  - CoinGlass BTC_ETF_NETFLOW — may need API-key upgrade or shape change.
  - alternative.me CRYPTO_FG works.
  - CNN F&G partial — source shape refused our requests recently.
  - **Not a code bug**; upstream data-freshness problem. Phase 3 replacement candidate for broken sources.
- **`news_sentiment` 2 days stale** (latest 2026-04-23). Aggregator still returns usable score because rows are used regardless of age — but fresher data is better. Check why cron-hourly GHA hasn't populated today's rows.

### UI polish (Step 13 fold-in)

- `ThemeToggle` + `SignOutButton` `size-9 → size-11` for 44×44 touch targets.
- `motion-safe:` prefix on residual shadcn animations (Sheet slide-in).
- PNG icons for iOS A2HS reliability — current SVG fallback works on Safari ≥ 14 but fragile.
- Header "오늘의 투자 환경" route-branch desktop vs mobile copy.

### Tech debt / deferred

- Finnhub adapter files kept as paid-plan fallback (unused today; `FINNHUB_API_KEY` in both Vercel + GH + `.env.local`).
- Alpha Vantage 24/25 daily budget — one retry burns headroom. Premium (~$50/mo) enables backfill.
- Signal cutover badge (`isRulesCutoverDay`) fires only on version mismatch — no actual cutover yet. Re-verify at v1.1.0+.
- `common` technical fallback now maps to `us_equity` rows (F3 in this session's review) — verified in test but not production-exercised until technical_readings populates.

### Workflow gotchas

- **`CRON_SECRET` sync across Vercel Production + GH repo secret + `.env.local` must match**. If any rotation, re-run `echo $CRON | gh secret set CRON_SECRET` from `.env.local`. 401s trip GHA silently.
- **`PRODUCTION_URL` must include `https://` prefix** — otherwise curl parses `/api/cron/...` as a flag. Comment in `cron-technical.yml` warns about this.
- **GHA cron-technical takes ~5 minutes** — 19 AV tickers × 13-15s sleeps + CoinGecko leg. Set GitHub Actions `timeout-minutes: 10`.

## 8. Environment State

- **Stack**: Next.js 16.2.4 (Turbopack, `cacheComponents: true`), React 19.2.4, Tailwind v4, `@supabase/ssr` 0.10.2, TypeScript 5 strict, Recharts 3.x, Vitest 4.1.4. shadcn base-nova + Radix tooltip.
- **Tests**: **491/491 green** across 31 files (Phase 1 baseline 108 + Phase 2 accumulated 383 including 39 this session: 36 aggregator unit + 3 dedup regressions).
- **MCP servers**: figma, supabase, context7, alphavantage + **Claude-in-Chrome** (jw.byun@toss.im authenticated, tabGroupId=690806389).
- **`.env.local` keys**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `CRON_SECRET` (43-char), `FINNHUB_API_KEY`, `VERCEL_OIDC_TOKEN`.
- **Vercel prod**: project `finance-manager`, Hobby. Alias `finance-manager-james.vercel.app`. Last deploy `dpl_XXX` aliased to `finance-manager-lku0h60yc-jaclyn6s-projects.vercel.app` (commit 39e215f). Daily cron `0 6 * * *` for `ingest-macro` — will re-run tomorrow 06:00 UTC automatically.
- **GitHub repo secrets** (Jaclyn6/Finance-Manager-James): `CRON_SECRET` (re-synced today from .env.local), `PRODUCTION_URL=https://finance-manager-james.vercel.app` (re-set today; earlier value was missing `https://`), `FINNHUB_API_KEY`.
- **Supabase**: `hhohrclmfsvpkigbdpsb` (ap-northeast-2 Seoul, Postgres 17.6.1.104). Migrations 0001–0010.
- **Data state** (2026-04-25 post-deploy):
  - `composite_snapshots`: 15 v2 rows (2026-04-23/24/25, 5 per day) + 155 v1 pre-cutover. 2026-04-25 rows show 2-3 categories per asset (macro always + sentiment sometimes + valuation sometimes + regional_overlay for KR).
  - `signal_events`: **≥1 row for 2026-04-25** (first production row, written by ingest-macro tail this session).
  - `indicator_readings`: 11 FRED series × daily.
  - `price_readings`: 1095 crypto + (AV price rows will land once GHA cron-technical completes).
  - `technical_readings`: **18 rows** currently (3 tickers × 6 indicators from partial GHA; full 114 rows after run `24920958904` completes).
  - `onchain_readings`: 5 rows, stale since 2026-04-23 + mostly error status.
  - `news_sentiment`: 5 rows, stale since 2026-04-23.
- **Blueprint versions**: Phase 2 v1.0 (2026-04-23), PRD v3.4.

## 9. How to Resume

1. **Check GHA cron-technical completion** — `gh run view 24920958904 --log | tail -30`. If success, re-run `POST /api/cron/ingest-macro` (with CRON_SECRET Bearer) to pick up the fresh `technical_readings` rows. Expect us_equity / global_etf / common to upgrade to **4/6 카테고리** in the dashboard.
2. **Trigger cron-hourly GHA** — refresh `news_sentiment` + `onchain_readings`. Check `gh run list --workflow=cron-hourly.yml --limit 3` for recent runs.
3. **Diagnose onchain failures** — Bitbo (MVRV_Z, SOPR) + CoinGlass (BTC_ETF_NETFLOW) + CNN F&G. Likely UA / source-shape issues. Either repair or flag for Phase 3 replacement.
4. **Step 13 acceptance matrix** — walk every §10.1 + §10.2 row, produce evidence (`docs/phase2_acceptance_matrix.md`).
5. **CLAUDE.md Trigger 2** — 5-agent review over full Phase 2 diff (`ba2b1f2..39e215f`). Focus on cross-step interactions, cache tag churn, category-wiring correctness under realistic multi-asset scenarios.
6. **UI polish**: `size-11` touch targets + `motion-safe:` + PNG icons. Quick 1-commit pass.
7. **Optional**: Lighthouse PWA audit on production URL. Real-device iPhone + Android A2HS test.

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
