# Session Handoff

## 1. Snapshot Timestamp

2026-04-25 (session end; Phase C Steps 7.5–12 all shipped in one continuous session; production deployed + Chrome MCP visual-verified). Pre-Step 13 final feature-unit review.

## 2. Current Phase / Step

**Phase C Steps 1–12 COMPLETE** per `docs/phase2_architecture_blueprint.md` §9. Production aliased at `https://finance-manager-james.vercel.app` (deployment `dpl_6UR1Jjwr5ej9qa3QSLbpdx2LdFMa`, URL `finance-manager-2sauplute-jaclyn6s-projects.vercel.app`). 452 tests green. tsc clean. Turbopack build green.

**Next: Phase C Step 13 — Phase 2 deploy + smoke matrix + UI polish + handoff** (blueprint §9 lines 719–727). Scope: run the §10 acceptance matrix end-to-end, fold in residual polish (`size-9→size-11` on theme-toggle / sign-out per handoff-old §7, Phase 1 §5 routing table doc sync, `motion-safe:` on residual shadcn animations), and run CLAUDE.md **Trigger 2** (feature-completion review — 5-agent pass over the FULL Phase 2 diff from `main` divergence, not just the tip commit).

## 3. Last Commit

`224a63c` — `feat(phase2): Step 11 + 12 — 180-day history extension + PWA shell` on `main`. Pushed to origin. Working tree clean.

## 4. Active Thread

- **This session shipped 5 numbered steps + 5 commits (71fd1be → 224a63c):**
  - `71fd1be` Step 7.5 — Signal Alignment Engine (8 evaluators, 54 tests, 5-cron tail wire-up, cache tag, 10 review fixes)
  - `0f8211c` Step 8 + 8.5 — Contributing Indicators UI v2 (6-category grouping + Recharts stacked bar) + SignalAlignmentCard (6/7-tile, per-asset filtering, Radix tooltips, disclaimer) + 9 review fixes including F1 duplicate-removal (filterSignalsForAsset → engine's signalsForAssetType single source of truth)
  - `2f4d36d` Step 9 + 10 — `src/lib/data/prices.ts` reader (visualization-only, `server-only`, §7.4 invariant guarded) + `ScorePriceOverlay` Recharts ComposedChart (dual Y-axis score/price, Δ% tooltip, cutover ReferenceLine preserved) + REPRESENTATIVE_TICKER_BY_ASSET (SPY / 005930.KS / BTC / GLD — all in §3.2 registry) + 6 review fixes including F4 deletion of now-dead ScoreTrendLine
  - `224a63c` Step 11 + 12 — 180d date-picker floor (`HISTORY_WINDOW_DAYS = 180` + `computePickerFloor(today)`) + PWA shell (manifest.webmanifest, sw.js shell cache, 3 SVG icons, ServiceWorkerRegistration Client Component in layout.tsx) + 3 review fixes (F1 SW skips non-OK, F2 SW bypasses RSC/_next/data/?_rsc=, F3 iOS A2HS PNG-todo comment)
- **Production deployment verified this session (Chrome MCP `mcp__Claude_in_Chrome__*`):**
  - Local `http://localhost:3000/dashboard` + `/asset/crypto` confirmed SignalAlignmentCard **above** CompositeStateCard (plan §0.5 tenet 4), 7-tile crypto variant, empty-state "대기 구간" (signal_events empty — expected), Step 8 v2 "1/6 카테고리 반영" chip + nested FRED indicator rows, Step 10 overlay with aria-label "점수 38.6~47.0, BTC 최근가 $77.8k, 2026-04-23 모델 v2.0.0 전환".
  - Production `https://finance-manager-james.vercel.app/dashboard` renders identical UX after deploy. Zero console errors.
- **Test count**: 452/452 green (+96 from last handoff: 54 signals + 22 UI parsers + 20 mergeByDate/computeDeltaPercent/findReferencePrice).
- **No blockers**. Step 13 is a polish + acceptance-matrix run.

## 5. Pending User Decisions

- None. Step 13 scope is well-defined in blueprint; proceed to acceptance matrix + Trigger 2 review + prod smoke of the cron cadence over the next 7 days.

## 6. Recent Context (last 5 commits)

- `224a63c` Step 11 + 12 — 180-day extension + PWA (manifest, SW, icons). Fix pack: SW skips 4xx/5xx, RSC/_next/data bypass, iOS A2HS TODO.
- `2f4d36d` Step 9 + 10 — prices reader + ComposedChart overlay. F4 deleted ScoreTrendLine; palette migrated to `--chart-1`/`--chart-2` theme tokens.
- `0f8211c` Step 8 + 8.5 — 4-category contributing grouping + signal alignment card hero placement. 9 review fixes including dedupe of filterSignalsForAsset, cutover-day badge wired, chart tokens for regional_overlay (`--chart-6` added).
- `71fd1be` Step 7.5 — Signal Alignment Engine 8 evaluators + 5-cron tail wire-up. 10 review fixes including CryptoAssetType 7-not-8 signals, computed_at refresh, DISPARITY split-per-ticker, file-level null-policy JSDoc rewrite.
- `ba2b1f2` Handoff snapshot pre-7.5.

## 7. Open Issues to Watch

### Production data gaps (expected bootstrap state)

- **`signal_events` table empty** until next cron tail runs post-deploy. Chrome MCP confirmed empty-state "대기 구간" on production dashboard — will flip to N/6 on first successful `/api/cron/ingest-*` run. Tail is wired in 5 endpoints (macro/technical/onchain/news/cnn-fg); expect first signals row by `2026-04-25 22:00 UTC` (GHA cron-technical).
- **Production `ingest-technical` still awaiting its first GHA automatic run**. Manual dispatch possible via `gh workflow run cron-technical.yml`. Once triggered, verify `technical_readings` populates 19 tickers × 6 indicators and `price_readings` gains AV bars (currently only crypto via CoinGecko, 1095 rows).
- **Composite v2 only populated for `macro` category** today. `/asset/crypto` shows "1/6 카테고리 반영" — the UI correctly surfaces the transparency. technical/onchain/sentiment categories will come online as `ingest-macro` at 06:00 UTC starts consuming the Step 7 reading tables into `composite_snapshots.contributing_indicators.{technical|onchain|sentiment}` (TODO: wire category-specific score computation into ingest-macro; blueprint §4.2 hook currently only computes macro).
  - **This is NOT a Step 13 bug — it's the gradual-rollout model per plan §0.2 #9. But it IS Phase 2 scope.** Logging as follow-up before Trigger 2.
- **ingest-cnn-fg 500s persist**. CNN UA block not resolved. PRD §10.4 `EXTREME_FEAR = VIX ≥ 35 || CNN_FG < 25` — OR degrades gracefully, signal fires on VIX alone. Phase 3 replacement candidate.
- **ingest-onchain 1/4 success rate** (CoinGlass ETF flow + alternative.me CryptoFG fail intermittently). Bootstrap condition: etfFlow score requires ≥ 2 prior days to produce non-null.

### UI polish carried to Step 13

- `ThemeToggle` + `SignOutButton` `size-9` → `size-11` for 44×44 touch targets on mobile (PRD §6.5 a11y floor).
- Header "오늘의 투자 환경" desktop vs mobile route-aware text — switches on `/asset/[slug]` on desktop currently; verify mobile.
- `motion-safe:` prefix on residual shadcn animation utilities (particularly the Sheet slide-in).
- Phase 1 §5 routing-table docs mention legacy Step 10 behaviors; bring in line with Step 10 v2.
- PNG icon generation for iOS Safari A2HS reliability (currently SVG; Phase 3 TODO in layout.tsx).

### Tech debt / deferred

- **Finnhub adapter files** (`finnhub.ts`, `finnhub-parse.ts`, `finnhub-parse.test.ts`, `finnhubSentimentToScore`) remain in the codebase unused. Keep as future paid-plan (~$35/mo) fallback. `FINNHUB_API_KEY` still provisioned in Vercel prod + `.env.local` + GH repo secrets — unused today.
- **Alpha Vantage budget tightness**: 24/25 daily free-tier calls (19 technical + 5 news). One retry burns headroom. Backfill requires Premium upgrade (~$50/mo).
- **Signal rules cutover badge (`isRulesCutoverDay`)**: wired at Step 8.5 F4 fix; fires only when a historical signal_events row's `signal_rules_version` mismatches the engine's current `SIGNAL_RULES_VERSION`. No actual cutover has happened yet (still v1.0.0). Re-verify rendering when v1.1.0+ lands.
- **`ScoreTrendLine` deleted** at Step 10 F4. Any external doc that still references it should be updated (no callers in-repo; blueprint markdown cross-references still point at the old name — leave alone per CLAUDE.md doc-only scope rule).
- **`FINNHUB_API_KEY` Vercel env var** still present; safe to leave.

### Workflow gotchas for Step 13

- **CLAUDE.md Trigger 2** — full Phase 2 diff review, NOT just tip commit. Diff span: from last Phase-1 commit through 224a63c. Use `git log --oneline ba2b1f2..224a63c` as the surface.
- **GHA workflows** — `cron-technical.yml` @ 22:00 UTC + `cron-hourly.yml` @ 0 * * * * UTC. First post-deploy technical run tonight.
- **Production deploy freshness**: today's deploy URL is `dpl_6UR1Jjwr5ej9qa3QSLbpdx2LdFMa` aliased to `finance-manager-james.vercel.app`. Vercel daily cron for `/api/cron/ingest-macro` @ 06:00 UTC already uses the freshest deploy.
- **Service worker cache name `finance-shell-v1`** — future SW updates must bump the version OR the old SW will serve stale shell HTML until its `finance-shell-v1` cache is manually purged. Plan to bump to `v2` on the next material layout change.
- **Session cookies persist across Chrome MCP navigation** — `jw.byun@toss.im` is already authenticated in the current `tabGroupId=690806389`. Future Chrome MCP checks don't need login if the tab is reused.

## 8. Environment State

- **Stack**: Next.js 16.2.4 (Turbopack, `cacheComponents: true`), React 19.2.4, Tailwind v4, `@supabase/ssr` 0.10.2, TypeScript 5 strict, Recharts 3.x, Vitest 4.1.4. shadcn: badge/button/calendar/card/input/label/popover/separator/sheet/skeleton/tooltip + (deps since Step 8.5: Radix tooltip via `@base-ui/react`). Lucide icons. Node v24.15.0, npm 11.12.1, Vercel CLI 52.0.0.
- **Tests**: 452/452 green across 30 files (Phase 1 baseline 108 + Phase 2 Steps 2–12 accumulated 344).
- **Cache model**: Path B. `'use cache'` scopes use admin client; cookies/headers/connection banned. `proxy.ts` unchanged.
- **`server-only` split**: every `{source}.ts` + `data/{x}.ts` (incl. new `data/prices.ts`) + redact/backoff carry the guard; every `{x}-parse.ts` and every `score-engine/*.ts` pure module do NOT.
- **MCP servers**: `figma`, `supabase`, `context7`, `alphavantage` in project `.mcp.json`. Claude-in-Chrome connected to the user's Chrome instance — already has an authenticated `jw.byun@toss.im` session cookie in `tabGroupId=690806389`.
- **`.env.local` keys**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `CRON_SECRET`, `FINNHUB_API_KEY`, `VERCEL_OIDC_TOKEN`.
- **Vercel**: project `finance-manager`, team `jaclyn6s-projects`, Hobby. Production alias `finance-manager-james.vercel.app`. Last deploy `dpl_6UR1Jjwr5ej9qa3QSLbpdx2LdFMa` (commit 224a63c). Daily cron `0 6 * * *` for `ingest-macro`.
- **GitHub repo secrets** (Jaclyn6/Finance-Manager-James): `CRON_SECRET`, `PRODUCTION_URL`, `FINNHUB_API_KEY`.
- **Supabase**: `hhohrclmfsvpkigbdpsb` (ap-northeast-2 Seoul, Postgres 17.6.1.104). Migrations 0001–0010.
- **Data state** (2026-04-25 per inspection):
  - `composite_snapshots`: 155 v1 (2026-03-21 → 2026-04-22) + 10 v2 (2026-04-23 → 2026-04-24, 5 per day). Only `macro` category populated; technical/onchain/sentiment/valuation/regional_overlay categories are null-placeholders in contributing JSONB.
  - `indicator_readings`: 11 FRED series daily (7 Phase 1 + ICSA/WDTGAL + DTWEXBGS/DEXKOUS).
  - `price_readings`: ~1095 crypto rows (BTC/ETH/SOL × 365). AV bars (19 tickers × daily) populate on first `ingest-technical` GHA run.
  - `onchain_readings`: ~5 rows/day; CoinGlass + alternative.me partial failures.
  - `news_sentiment`: ~5 rows/day (5 US large-caps via AV `NEWS_SENTIMENT`).
  - `technical_readings`: **0 rows in production**. Awaits first GHA cron-technical run.
  - `signal_events`: **0 rows in production**. Awaits first post-deploy `ingest-*` tail.
- **Blueprint versions**: Phase 2 v1.0 (2026-04-23), PRD v3.4. Aligned.

## 9. How to Resume

1. **Step 13 acceptance matrix** (blueprint §10). Walk through every row of §10.1 + §10.2, produce evidence per cell. For each green cell, add a one-line citation (test file + test name, or DB query + output, or deployed-URL + inspection). Build a small `docs/phase2_acceptance_matrix.md` or inline in handoff as §11.
2. **Manual GHA dispatch** — `gh workflow run cron-technical.yml` to trigger the first production `/api/cron/ingest-technical` run WITHOUT waiting for 22:00 UTC. Verify `technical_readings` populates + `signal_events` gets its first row.
3. **Composite v2 category wiring** (Phase 2 scope gap surfaced at Step 8): extend `ingest-macro` to compute `technical_category_score`, `onchain_category_score`, `sentiment_category_score` per asset type (aggregate respective reading tables → 0–100) and write them into `composite_snapshots.contributing_indicators.{category}.{score,weight,contribution}`. Then category-level scores render in the UI. This is pre-Step 13 work; without it, the composite under-represents Phase 2 data sources.
4. **CLAUDE.md Trigger 2** — 5-agent review over `ba2b1f2..224a63c` full diff. Focus on cross-step interactions (cache tag churn, model_version v1↔v2 at read time, §7.4 invariant, §4.5 null policy, §10 a11y).
5. **UI polish fold-in**: `size-11` touch targets, `motion-safe:`, Phase 1 §5 docs sync, PNG icon generation.
6. **Optional**: Lighthouse PWA audit on the production URL (blueprint §9 Step 12 acceptance). Real-device A2HS test on iPhone + Android (plan A.2 pattern — not DevTools).

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
