# Session Handoff

## 1. Snapshot Timestamp

2026-04-25 (Phase 2 functionally complete — Steps 1–13 + composite category wiring + source recoveries + Trigger 2 review + acceptance matrix shipped). Production smoke green; 4/6 categories rendering on us_equity / global_etf / common, 3/6 on crypto, 2/6 on kr_equity (Phase 3 ECOS).

## 2. Current Phase / Step

**Phase 2 IMPLEMENTATION COMPLETE.** All 13 blueprint Steps shipped. CLAUDE.md Trigger 2 final review applied. `docs/phase2_acceptance_matrix.md` records 16 criteria: 9 MET (56%) / 7 PARTIAL (44%) / 0 DEFERRED. PARTIAL items are upstream-data-dependent (cron freshness budget, source quotas) or scoped Phase 3 (KR equity AV-blocked, Glassnode upgrade for MVRV/SOPR resilience).

**Next**: Phase 2 → 7-day production reliability watch + manual Lighthouse PWA audit + iPhone/Android A2HS test. Then Phase 3 planning kickoff.

## 3. Last Commit

`8261924` — `feat(phase2): close acceptance gaps — SignalCard on /changelog + ESLint §7.4 guard`. Pushed. Working tree clean.

## 4. Active Thread

**This session shipped 6 commits (39e215f → 8261924):**

| Commit | Scope |
|---|---|
| `39e215f` | Composite v2 category-score wiring (5 aggregators + ingest-macro extension + 36+3 tests) |
| `b703bc0` | First source repair pass (BGeometrics, bitbo.io, batch-split, 5-hat fixes) |
| `b861cfa` | Second source repair pass (Farside ETF + AV compact + BGeometrics 429 fail-fast) |
| `d536141` | KR `.KS` ticker carve-out (12 tickers, single batch) |
| `f863e81` | UI polish (size-11, motion-safe, PNG icons) |
| `3d25e58` | Trigger 2 final review — 13 fixes (real ETF dedup bug + blueprint sync + version bump) |
| `8261924` | Acceptance gaps closed — SignalCard on /changelog + ESLint §7.4 rule |

**Production smoke results (post 8261924):**

- `ingest-onchain`: partial 3/4 (BGeometrics 1 of 2 hit 8/hr quota; CRYPTO_FG + ETF flow OK).
- `ingest-technical` (single batch): 12/12 success in 154s.
- `ingest-macro`: 7/7 FRED + full category-aggregator pass — 5 composite_snapshots written.
- `composite_snapshots` 2026-04-25:
  - us_equity / global_etf / common → **4/6 categories** (macro / technical / sentiment / valuation).
  - crypto → **3/6** (macro / onchain / sentiment) — all applicable.
  - kr_equity → **2/6** (macro / regional_overlay) — KR ticker AV blocked.
- `signal_events` populated with multi-asset variants. `ECONOMY_INTACT` firing on real ICSA/Sahm data.
- Chrome MCP visual: dashboard hero, all 3 asset detail pages, and `/changelog` (with newly-added SignalAlignmentCard) render cleanly.

**Cron cadence state:**
- `cron-hourly.yml`: env-block secret pattern + PRODUCTION_URL with `https://` prefix verified. Auto-fires hourly.
- `cron-technical.yml`: 12-ticker single batch (no `?batch=` query param). 22:00 UTC daily.
- Vercel Hobby cron: `ingest-macro` 06:00 UTC daily.

## 5. Pending User Decisions

- **Phase 3 budget**: $29/mo Glassnode for MVRV/SOPR reliability vs accept BGeometrics 8/hr intermittent outages indefinitely.
- **Phase 3 KR data**: ECOS API integration (free, requires API key registration) vs Yahoo Finance scrape vs accept null KR technical/sentiment.

## 6. Recent Context (last 5 commits)

- `8261924` Acceptance gap closures (changelog SignalCard + ESLint §7.4)
- `3d25e58` Trigger 2 13-fix pack (ETF dedup bug + blueprint + TICKER_LIST_VERSION bump + dead code removal + sw.js PNG cache)
- `f863e81` UI polish (44px touch targets, motion-safe, PNG icons rasterized via sharp)
- `d536141` KR `.KS` removal + batch-split revert (12 single batch)
- `b861cfa` Farside ETF + AV compact + BGeometrics 429 fail-fast

## 7. Open Issues to Watch

### Production data freshness

- **BGeometrics 8/hr quota intermittent**: 1 of 2 MVRV/SOPR queries hits 429 on each cron run from Vercel IPs. Aggregator returns null gracefully → "수집 중" amber chip. Long-term: Glassnode (~$29/mo) Phase 3.
- **CNN F&G partial**: 51 history rows malformed but current value salvaged. EXTREME_FEAR signal fires on VIX alone via OR-arm. Phase 3 alternative.me stocks adapter candidate.
- **MA(200) + Disparity always null**: Free AV `outputsize=compact` returns 100 bars only. Blueprint §10.2 row 1 was relaxed in `3d25e58` to clarify this. Phase 3 fix via AV Premium ($50/mo) or Glassnode.
- **KR equity 2/6 categories**: Samsung etc unsupported on AV free tier. Documented in blueprint §3.2 + acceptance matrix.

### Phase 3 deferrals

- KR equity ECOS integration (free, Korean Statistical Information Service API, requires registration).
- Glassnode upgrade for crypto onchain reliability.
- Real-device PWA Lighthouse audit + iOS A2HS test on iPhone 14+.
- Header copy route-aware ("오늘의 투자 환경" vs asset-specific copy on `/asset/[slug]`).
- shadcn `tw-animate-css` v1.4 lacks `prefers-reduced-motion` rule on Sheet/Popover/Tooltip slide-ins; add custom CSS layer if needed.
- `button.tsx` `icon-lg` (size-9) variant retained; new `icon-touch` (size-11) added. Migrate any legacy `icon-lg` callers to `icon-touch` if discovered.

### Workflow gotchas (preserve in next session)

- **CRON_SECRET sync** across Vercel + GH + .env.local must always match.
- **PRODUCTION_URL must include `https://`** prefix or curl breaks.
- **GHA cron-hourly `continue-on-error: true`** can hide false-success — check Vercel function logs in addition to `gh run view`.
- **Vercel alias**: after `vercel --prod` may need explicit `vercel alias set <deployment> finance-manager-james.vercel.app`.

## 8. Environment State

- **Stack**: Next.js 16.2.4 + Turbopack + cacheComponents:true, React 19.2.4, Tailwind v4, @supabase/ssr 0.10.2, TypeScript 5 strict, Recharts 3.x, Vitest 4.1.4, sharp 0.34.5 (transitive Next dep, used in `scripts/generate-icons.mjs`).
- **Tests**: **489/489 green** across 30 files. Net of: removed `sentiment.test.ts` (32 tests dead code), added 3 ETF dedup regressions, churn from KR ticker test removal.
- **Lint**: clean (1 pre-existing unused-var warning in `ingest-news/route.ts` — unrelated).
- **MCP servers**: figma, supabase, context7, alphavantage, **Claude-in-Chrome** (jw.byun authenticated; tabGroupId=690806389).
- **`.env.local`**: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, FRED_API_KEY, ALPHA_VANTAGE_API_KEY, CRON_SECRET (43-char), FINNHUB_API_KEY (unused, retained), VERCEL_OIDC_TOKEN.
- **Vercel prod**: alias `finance-manager-james.vercel.app` → deployment `finance-manager-hrqkwrvfp-jaclyn6s-projects.vercel.app` (commit `3d25e58`; will redeploy on next push).
- **GH repo secrets**: CRON_SECRET, PRODUCTION_URL (`https://finance-manager-james.vercel.app`), FINNHUB_API_KEY.
- **Supabase**: hhohrclmfsvpkigbdpsb (Seoul, Postgres 17.6.1.104). Migrations 0001–0010 applied.
- **Data state** (2026-04-25 post-final-deploy):
  - `composite_snapshots`: 5 v2 rows for 2026-04-25 with multi-category JSONB.
  - `technical_readings`: 72 success rows + 0 error rows (all 12 tickers OK).
  - `price_readings`: 1095 crypto + 12 AV daily bars.
  - `onchain_readings`: 4 rows (3 success, 1 BGeometrics 429).
  - `news_sentiment`: 5 success rows.
  - `signal_events`: ≥1 row for 2026-04-25.
- **Blueprint versions**: Phase 2 v1.0 (2026-04-23) + 2026-04-25 amendments in §3.1 / §3.2 / §10.1 / §10.2 / §11. PRD v3.4. **TICKER_LIST_VERSION bumped to v2.0.0-2026-04-25** (commit 3d25e58).

## 9. How to Resume

1. **Production reliability watch**: Days 1–7 from 2026-04-25. Check `gh run list` daily for cron-hourly + cron-technical green count. Goal: 7 consecutive days for §10.3 acceptance.
2. **Lighthouse PWA audit** on `https://finance-manager-james.vercel.app` — record score in `docs/phase2_acceptance_matrix.md` row 13. Target ≥ 90.
3. **Real-device A2HS test** — iPhone Safari 15+ + Android Chrome. Verify icon, splash, standalone display, offline shell loads in < 1s.
4. **Phase 3 budget decision** with user — Glassnode ($29/mo) and/or AV Premium ($50/mo) and/or ECOS API (free + key).
5. **Phase 3 plan authorship** — new `docs/phase3_plan.md` covering: regime classification engine, portfolio overlay, per-user personalization, backtest UI, ECOS for KR, Glassnode for crypto onchain.
6. **Optional immediate polish** if continuing in Phase 2 envelope:
   - Migrate any `icon-lg` button callers to `icon-touch`.
   - Add `tw-animate-css` reduced-motion override CSS.
   - Header route-aware copy.

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
