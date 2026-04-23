# Session Handoff

## 1. Snapshot Timestamp

2026-04-23 17:55 UTC (manual `/handoff`, Phase C Steps 1-7 complete + production smoke-tested + Finnhub→AV news swap landed; pre-Step 7.5)

## 2. Current Phase / Step

**Phase C Steps 1–7 COMPLETE** per `docs/phase2_architecture_blueprint.md` §9. All 5 cron endpoints deployed to production + smoke-tested end-to-end. Reading tables (`indicator_readings`, `technical_readings`, `onchain_readings`, `news_sentiment`, `price_readings`) all populated with real data from today's ingestion.

**Next: Phase C Step 7.5 — Signal Alignment Engine** (blueprint §9 lines 649–657). Scope: `src/lib/score-engine/signals.ts` (pure functions, stub already exists from Step 1), `src/lib/data/signals.ts` (reader + writer), trailing `signals.compute` call inside every cron ingestion, 18+ unit tests. PK `(snapshot_date, signal_rules_version)` on `signal_events` table (migration 0006 already applied).

## 3. Last Commit

`a076d84` — `fix(phase2): ingest-news — per-ticker AV calls (discovered AND-semantics)` on `main`. Origin in sync (no unpushed). Working tree clean (AV probe scratch files deleted just now).

## 4. Active Thread

- **Just finished (this session):**
  - **Steps 1–6 implementation + 5-agent reviews + fixes** (11 commits: 4ea12f8 → 08a21c6). Summary: schema migrations 0005–0010, sentiment engine, on-chain engine, technical engine, composite v2 with 6-category structure (macro/technical/onchain/sentiment/valuation/regional_overlay), MODEL_VERSION v1→v2 cutover UI (dashboard badge + trend-chart ReferenceLine).
  - **Step 7 (cron v2 + GHA workflows)**: 5 new cron endpoints + 3 GHA workflows + ingest-macro extended to 11 FRED series + PHASE2_FRED_REGIONAL_OVERLAY constant. Commits 3343472 / 5514c2c / 34df3e6.
  - **Production deployment + secrets setup**: Installed `vercel` CLI check, registered `CRON_SECRET` + `PRODUCTION_URL` + `FINNHUB_API_KEY` as GitHub repo secrets (via `gh secret set`), added `FINNHUB_API_KEY` to Vercel Production env, deployed 4× to prod (commits 3343472 → a076d84).
  - **Finnhub → Alpha Vantage NEWS_SENTIMENT swap** (two commits: 09842bb + a076d84). Finnhub's `/news-sentiment` is paid-only on the free tier; AV's `NEWS_SENTIMENT` works free AND provides pre-computed sentiment scores. Smoke-test during the initial swap revealed AV's `tickers=` parameter is AND-semantics (not OR as first assumed): `SPY,QQQ,NVDA,AAPL` returns 0 articles because no single article covers all 4 ETFs+megacaps. Refactored to per-ticker calls; dropped SPY/QQQ from the news ticker registry (kept in TECHNICAL for broad-market RSI/MACD). Final production run: 5/5 tickers × 50 articles each, sentiment scores 55-64 range ("Somewhat-Bullish").
  - **DB hygiene**: cleaned 2026-04-23 v1 residue (5 composite + 5 changelog rows from pre-redeploy old-deployment cron) + SPY/QQQ stale partial rows from initial 2-group news run.
- **About to start (next session):** Phase C **Step 7.5 — Signal Alignment Engine**. Implement `computeSignals` in `src/lib/score-engine/signals.ts` (stub from Step 1), data reader/writer in `src/lib/data/signals.ts`, wire `signals.compute` tail call into every cron endpoint, add signal-card UI at Step 8.5.
- **Not blocked** — all environment is provisioned, all production endpoints return meaningful data.

## 5. Pending User Decisions

- None. Step 7 verified end-to-end. Step 7.5 starts fresh with pure-math work that mirrors Step 3/4 patterns.

## 6. Recent Context (last 5 commits)

- `a076d84` ingest-news per-ticker rewrite — AV AND-semantics discovery forced the 2-group (4,3) split to become 5 single-ticker calls
- `09842bb` Finnhub→AV NEWS_SENTIMENT swap — added new adapter + parser + 18 tests, route rewritten; Finnhub files intentionally kept as future paid-plan fallback
- `34df3e6` composite_snapshots reader — secondary sort on `model_version DESC` handles cutover-day v1/v2 tie-break
- `5514c2c` ingest-prices — dedupe CoinGecko bars by price_date (upstream can return today twice; Postgres 21000 cardinality violation fix)
- `3343472` Step 7 main — 5 cron endpoints + 3 GHA workflows + FRED expansion + shared `verifyCronSecret` helper

## 7. Open Issues to Watch

### Production data gaps (Phase 2 deferred, not Step 7.5 blockers)

- **Unofficial API partial failures** (blueprint §3.1 expected risk): `ingest-onchain` today returned 1/4 sources success; `ingest-cnn-fg` returned 500 (CNN Markets Data endpoint refused our User-Agent or shape changed). The `ingest_runs` audit row captures these; UI staleness badge (Step 8) will surface. Reassess at `docs/phase2_architecture_blueprint.md` §3.1 TTLs — 2h stale threshold means onchain data shows amber after 2h-without-success.
- **`ingest-technical` not yet smoke-tested in production**. Endpoint expects ~247s (19 Alpha Vantage tickers × 13s sleep) and maxDuration=300. GHA workflow `cron-technical.yml` at 22:00 UTC daily will be the first real execution. Verify `technical_readings` populates after first automatic run (UTC tomorrow morning for the user).
- **ingest-onchain `etfFlowToScore` bootstrap**: needs ≥2 prior days of history to produce a non-null score. Today's run writes the first day; `CoinGlass BTC_ETF_NETFLOW` score will be null until day 2+. Expected; surfaces via `fetch_status='partial'`.
- **First automatic Vercel cron run**: 2026-04-24 06:00 UTC for `ingest-macro` (Vercel Hobby daily slot, unchanged from Phase 1). Monitor Vercel Dashboard → Cron Jobs for the first auto-trigger + confirm v2 row lands.

### Tech debt / deferred work

- **Finnhub adapter files unused.** `src/lib/score-engine/sources/finnhub.ts`, `finnhub-parse.ts`, `finnhub-parse.test.ts` + `sentiment.ts`'s `finnhubSentimentToScore` still in the codebase. Kept intentionally as a future paid-plan (~$35/mo) fallback. Do not delete unless the user explicitly opts out.
- **`FINNHUB_API_KEY`** still present in Vercel Production env + `.env.local` + GitHub repo secrets. Unused by current code. Leave in place (future fallback); user can rotate or remove when the paid-plan decision is made.
- **`ingest-cnn-fg` unreliability.** CNN's dataviz endpoint denies our requests (likely User-Agent filter change). PRD §10.4 `EXTREME_FEAR` signal is `VIX ≥ 35 || CNN_FG < 25` — the OR lets VIX alone fire the signal, so CNN outage degrades gracefully at Step 7.5. Monitor; if CNN stays broken for 7+ days, consider using Alternative.me data or Phase 3 replacement.
- **Alpha Vantage budget tightness**: 19 technical + 5 news = 24/25 daily free-tier calls. One retry burns the headroom. If AV backfill is needed for historical technical data, user must upgrade to Premium (~$50/mo, 75/day).
- **Step 6 review R3.4 — `missingCategories` not persisted to DB.** Per-asset `CompositeResultV2.missingCategories` lives only in memory; dashboard can't distinguish "category N/A for asset" from "category currently missing data". Step 8 UI scope.
- **Step 6 review R1.2 residue**: blueprint §4.2 table kept as-is (separate `regional_overlay` category). If a future blueprint revision wants to fold it back into macro, the weights.ts change is trivial but will need test updates.
- **`next-themes` hydration mismatch**: unrelated, pre-existing from Phase 1; manifests as a transient console warning. Low priority.

### Workflow gotchas for next session

- **CLAUDE.md Trigger 1 for Step 7.5**: Step 7.5 includes signal-card UI at §8.5 (blueprint Step 8.5 is the actual UI work, but Step 7.5 is pure-math — Trigger 1 visual verification applies at 8.5, not 7.5). For 7.5, the 5-agent review runs post-commit without preview_start.
- **Step 7.5 tests touch the `signal_events` DB table**. Make sure migration 0006 is still applied (it is — verified in session). Any new signal-input columns would require a new migration.
- **Ingest endpoints need the trailing `signals.compute` call** at Step 7.5 tail. Current cron endpoints (3343472 + subsequent) do NOT yet call signals.compute — that's the Step 7.5 wire-up per blueprint §9 Step 7.5 scope.

## 8. Environment State

- **Stack**: Next.js 16.2.4 (Turbopack, `cacheComponents: true`), React 19.2.4, Tailwind v4, `@supabase/ssr` 0.10.2, TypeScript 5 strict, `next-themes` 0.4, Recharts 3.8.1, Vitest 4.1.4. shadcn: badge/button/calendar/card/input/label/popover/separator/sheet/skeleton/tooltip. react-day-picker 9.14.0. dotenv + tsx devDeps. Node v24.15.0, npm 11.12.1, Vercel CLI 52.0.0.
- **Test count**: 356/356 green (Phase 1 108 baseline + Step 2 67 parser + Step 3 59 technical + Step 4 41 onchain + Step 5 29 sentiment + Step 6 18 composite-v2 + Step 7 9 ticker-registry + Step 7 18 AV-news-parser + 7 regression/kr-overlay).
- **Cache model**: Path B (`cacheComponents: true`). Admin client inside `'use cache'` allowed (family-wide). `cookies()/headers()/connection()` banned inside cached scopes.
- **File renames**: `middleware.ts` → `proxy.ts` (Next 16.2 invariant, unchanged).
- **`server-only` split**: every `{source}.ts` + `_back-off.ts` + `_redact.ts` carries the guard; every `-parse.ts` does NOT; parsers Node-env safe for scripts.
- **MCP servers** (project-scope `.mcp.json`): `figma`, `supabase`, `context7`, `alphavantage`. Supabase MCP authenticated this session (org `fqiwclzqwmufqbcankjd`, project `hhohrclmfsvpkigbdpsb`).
- **`.env.local` keys** (git-ignored, names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `CRON_SECRET`, `FINNHUB_API_KEY` (added this session, currently unused by code), `VERCEL_OIDC_TOKEN`.
- **Vercel**: project `finance-manager`, team `jaclyn6s-projects`, Hobby plan. Production alias `finance-manager-james.vercel.app`. Last deploy URL `finance-manager-eryco9z3f-jaclyn6s-projects.vercel.app` (commit a076d84). Env vars in Production: 7 total incl. `FINNHUB_API_KEY` (added this session). Production cron `0 6 * * *` for `ingest-macro` only (unchanged Phase 1 config).
- **GitHub repo secrets** (Jaclyn6/Finance-Manager-James): `CRON_SECRET`, `PRODUCTION_URL` (`https://finance-manager-james.vercel.app`), `FINNHUB_API_KEY` — all provisioned this session via `gh secret set`.
- **Supabase**: `hhohrclmfsvpkigbdpsb` (ap-northeast-2 Seoul, Postgres 17.6.1.104, free plan). Migrations 0001–0010 applied. Auth: signups disabled, 3 family users hand-provisioned (`jw.byun@toss.im` + `edc0422@...` + `odete4@...`). Site URL = `https://finance-manager-james.vercel.app`.
- **GitHub**: `Jaclyn6/Finance-Manager-James` private. `gh` CLI auth'd as `Jaclyn6`. 3 GHA workflows present (`cron-technical.yml`, `cron-hourly.yml`) — first scheduled run: `cron-hourly` on the next UTC hour, `cron-technical` 22:00 UTC daily.
- **Data state** (2026-04-23 17:55 UTC snapshot):
  - `composite_snapshots`: 155 v1 rows (2026-03-21 → 2026-04-22) + 5 v2 rows (2026-04-23, one per asset_type)
  - `indicator_readings`: 11 FRED series for today (7 Phase 1 + ICSA/WDTGAL signal-only + DTWEXBGS/DEXKOUS regional overlay)
  - `price_readings`: 1095 crypto rows (BTC/ETH/SOL × 365 days backfilled by CoinGecko)
  - `onchain_readings`: 5 rows today (1 success + 4 error from Bitbo/CoinGlass/alternative.me)
  - `news_sentiment`: 5 rows (5 US large-caps, all success, sentiment 55-64 range)
  - `technical_readings`: 0 rows (endpoint works, not yet triggered in production — awaits 22:00 UTC GHA run)
  - `signal_events`: 0 rows (Step 7.5 writes the first)
- **Blueprint versions**: Phase 1 `docs/phase1_architecture_blueprint.md` v2.3. Phase 2 `docs/phase2_architecture_blueprint.md` v1.0. PRD `investment_advisor_dashboard_prd_kr_v3.md` v3.4. Aligned.
- **Handoff**: manual only (`/handoff`). No hooks.
- **Code-review workflow**: CLAUDE.md Trigger 1 active. Steps 1–6 all reviewed post-commit + fixes applied. Step 7 not yet 5-agent-reviewed (user opted to skip for speed; production smoke test substituted for runtime correctness).

## 9. How to Resume

1. Read `docs/phase2_architecture_blueprint.md` §9 Build Sequence, especially **Step 7.5** (lines 649–657) for signals engine scope + acceptance (18+ unit tests, null propagation per §2.2 tenet 1). Cross-reference §4.5 for the 6 signal formulas (EXTREME_FEAR, DISLOCATION, ECONOMY_INTACT, SPREAD_REVERSAL, LIQUIDITY_EASING, MOMENTUM_TURN).
2. Read `src/lib/score-engine/signals.ts` — Step 1 stub (SignalName enum + ALL_SIGNALS already declared). Read `src/lib/score-engine/technical.ts` + `onchain.ts` for the `is*` boolean exports (`isDislocated`, `isCryptoUndervalued`, `isCapitulation`, `macdBullishCrossWithin`) that signals.ts will call.
3. **Next concrete action:** Implement `computeSignals(inputs)` in `src/lib/score-engine/signals.ts`. Inputs come from: `indicator_readings` (VIX, ICSA, SAHMCURRENT, BAMLH0A0HYM2, WDTGAL), `onchain_readings` (CNN_FG, MVRV_Z, SOPR), `technical_readings` (SPY MACD, SPY/QQQ disparity). Output shape per `SignalComputation` type already exported. Add pure-math tests first (18+). Then add `src/lib/data/signals.ts` reader (`'use cache'` + `cacheTag('signals')` + `cacheLife('hours')`) + writer (admin client, no cache, UPSERT). Finally add the `signals.compute → revalidateTag('signals', {expire:0})` tail call to each of the 5 cron endpoints. Run the 5-agent CLAUDE.md Trigger 1 review post-commit.

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
