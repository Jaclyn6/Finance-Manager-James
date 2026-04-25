# Session Handoff

## 1. Snapshot Timestamp

2026-04-25 (post-cleanup session — composite v2 category wiring + onchain source recoveries + AV outputsize compact migration shipped, prod smoke-tested with **4/6 categories rendering on us_equity / global_etf / common**, 3/6 on crypto).

## 2. Current Phase / Step

**Phase C Steps 1–12 + composite v2 category-score wiring + Phase 2 source repair COMPLETE.** Production now displays:
- `/asset/us-equity`: 4/6 (macro + technical + sentiment + valuation) — all applicable
- `/asset/global-etf`: 4/6 — all applicable
- `/asset/common` (dashboard hero): 4/6 — all applicable
- `/asset/crypto`: 3/6 (macro + onchain + sentiment) — all applicable
- `/asset/kr-equity`: 2/6 (macro + regional_overlay) — `.KS` tickers blocked by AV free-tier (technical/sentiment unreachable; see §7)

**Next: Phase C Step 13** — §10 acceptance matrix + UI polish + CLAUDE.md Trigger 2 review.

## 3. Last Commit

`b861cfa` — `fix(phase2): farside.co.uk ETF flow + AV compact + BGeometrics 429 fail-fast`. Pushed. Working tree clean.

## 4. Active Thread

**This session shipped 4 commits (39e215f → b861cfa) on top of the prior Phase C body:**

- `39e215f` Composite v2 category-score wiring — 5 aggregators (`category-aggregators.ts`) + ingest-macro extension + 36+3 tests.
- `1b394bb`, `0913313` handoff doc updates capturing the in-progress GHA timeout investigation.
- `b703bc0` First repair pass: BGeometrics for MVRV/SOPR + bitbo.io for ETF flow + ingest-technical batch-split workflow (10+9 split with 30-min gap). 5-hat review caught HIGH bug class (multi-day stale rows in technical/news aggregators); fixed via Map-based first-wins dedup. 510 tests.
- `b861cfa` Second repair pass after prod-smoke discovered:
  - BGeometrics free tier is **8 requests/hour per IP** (returns 429 with `RATE_LIMIT_HOUR_EXCEEDED`). Investigated lookintobitcoin.com (Plotly Dash SPA, non-scrapable + SOPR 404), Coin Metrics free (CapMVRVZ/SOPR are paid, 403), CBBI (normalized 0-1 only, threshold mismatch). **Decision: stay on BGeometrics with `retryOnRateLimit: false` so a single 429 doesn't burn the remaining quota.** 429 propagates to `fetch_status:'error'` with tagged audit message; UI staleness gate handles the gap.
  - bitbo.io/treasuries returns 500 from Vercel IPs (suspected ASN block; Chrome UA verified working from local). Migrated to **`https://farside.co.uk/btc/`** — canonical Bitcoin ETF flow source. Parser supports both date formats (`Mon DD, YYYY` legacy + `DD Mon YYYY` Farside) + parenthesized accountancy negatives.
  - Alpha Vantage moved `outputsize=full` to premium-only. Switched to `outputsize=compact` (100 daily bars). MA(200) and Disparity gracefully null per blueprint §2.2 tenet 1; RSI/MACD/MA(50)/Bollinger still compute. Parser strengthened to detect `Information:` / `premium feature` response bodies as `fetch_status:'error'`.
  - 518 tests green.

**Production smoke results (last run before this handoff):**
- `ingest-onchain`: status `partial`, 3/4 success in 1.4s (BGeometrics 429 on 1 metric, others through farside / alternative.me).
- `ingest-technical?batch=1`: 7/10 success in 130s (3 KR `.KS` tickers fail; under 300s comfortably).
- `ingest-technical?batch=2`: 5/9 success in 110s (4 KR `.KS` tickers fail; 5 ETFs through cleanly).
- `ingest-macro` rollup: written 5 v2 composite_snapshots with multi-category JSONB.
- Chrome MCP: us_equity 4/6 + crypto 3/6 + signal_events populated + signal alignment card showing real "1/6 신호 활성" with `ECONOMY_INTACT` firing on real data.

**GHA workflow state:**
- `cron-hourly.yml` (PRODUCTION_URL+CRON_SECRET in `env:` block): manual dispatch verified post-fix; auto-runs hourly at `0 * * * *` UTC.
- `cron-technical.yml`: renamed "Technical Cron (batch 1)" + `?batch=1`, fires at `0 22 * * *` UTC.
- `cron-technical-batch2.yml` (NEW): fires at `30 22 * * *` UTC, `?batch=2`.

## 5. Pending User Decisions

- **KR equity AV ticker format**: Alpha Vantage free tier rejects `.KS` suffix tickers (Samsung 005930.KS, SK Hynix 000660.KS, etc.) with `Invalid API call`. Need to investigate if AV expects a different KR ticker shape, or if KOSPI requires AV Premium. KR equity dashboard sits at 2/6 categories (technical + sentiment unreachable via current pipeline) until resolved. Three escape hatches: (1) try `005930.KQ` / `KS:005930` / yahoo-format like `005930.KS` shape; (2) accept and document; (3) Phase 3 ECOS / Korea Exchange direct API.
- **MVRV_Z + SOPR resilience**: BGeometrics 8/hr free quota is intermittently exhausted (Vercel IPs share). Acceptable for Phase 2 (UI shows "수집 중" gracefully) but Phase 3 should migrate to **Glassnode (~$29/mo)** for production-grade reliability. Surface to user before Phase 3 budget decision.

## 6. Recent Context (last 5 commits)

- `b861cfa` Farside ETF flow + AV compact + BGeometrics 429 fail-fast (this session's tip)
- `b703bc0` First repair pass: BGeometrics + bitbo.io + batch-split (510 tests; 5-hat review fixes)
- `39e215f` Composite v2 category-score wiring (491 tests)
- `0913313` Handoff: GHA timeout finding
- `1b394bb` Handoff: post-category wiring

## 7. Open Issues to Watch

### KR equity ticker compatibility (NEW priority)

- **All 7 KR `.KS` tickers fail with `Alpha Vantage error: Invalid API call`** on the free `TIME_SERIES_DAILY` endpoint. Prod smoke 7/10 batch-1 + 5/9 batch-2 — the 7 failed all KR.
- AV docs claim symbol formats vary by exchange; KOSPI may need a different suffix or be premium-only.
- Affected tickers per `ticker-registry.ts`: 005930.KS (Samsung), 000660.KS (SK Hynix), 373220.KS (LG Energy), 207940.KS (Samsung Bio), 005380.KS (Hyundai Motor), 069500.KS (KODEX 200 ETF), 232080.KS (KODEX KOSDAQ).
- **Workaround options**: try `005930.KOSPI`, `KS:005930`, or `005930.KQ`; or remove KR tickers from registry and let `aggregateTechnical('kr_equity')` return null until Phase 3 ECOS API.

### BGeometrics 429 (resolved-with-acceptance)

- 8/hr free tier limit. Already implemented `retryOnRateLimit: false` to not waste retries.
- `fetch_status:'error'` on 429 → `aggregateOnchain` returns null → composite renormalizes → "수집 중" amber chip.
- Long-term: Glassnode paid ($29/mo) Phase 3 deliverable.

### Stale signal_events in production

- Once `cron-hourly` fires (every hour at `:00`), each ingest tail-call writes a fresh `signal_events` row. Currently 1 row for 2026-04-25 from this session's manual triggers.

### CNN F&G partial / not blocking

- CNN_FG fetch returns `partial` (51 history rows malformed but current value salvaged). EXTREME_FEAR signal degrades gracefully via OR-arm with VIX. Phase 3 replacement (Alternative.me already serves crypto F&G; could add stocks F&G adapter from another source).

### UI polish (Step 13 fold-in)

- `ThemeToggle` + `SignOutButton` `size-9 → size-11` for 44×44 touch targets.
- `motion-safe:` prefix on residual shadcn animations.
- PNG icons for iOS A2HS reliability (currently SVG).

### Tech debt / deferred

- Finnhub adapter files unused; `FINNHUB_API_KEY` stays for paid-plan fallback.
- `ScoreTrendLine` deleted; doc references in markdown still mention it (acceptable per CLAUDE.md doc-only scope).

### Workflow gotchas

- **CRON_SECRET sync**: Vercel + GH + .env.local must all match. Re-sync via `echo $CRON | gh secret set CRON_SECRET` if rotated.
- **PRODUCTION_URL must include `https://`** prefix.
- **GHA cron-hourly `continue-on-error: true`**: silently hides individual step failures behind a green job badge. **Current workaround**: workflow uses `env:` block pattern (validated) and explicit `${PRODUCTION_URL}` shell expansion. If endpoint silently 401s/500s, only Vercel function logs catch it — `gh run view` shows green.
- **Vercel alias may lag**: after `vercel --prod`, may need explicit `vercel alias set <deployment-url> finance-manager-james.vercel.app` if the alias didn't auto-update.

## 8. Environment State

- **Stack**: Next.js 16.2.4 + Turbopack + cacheComponents:true, React 19.2.4, Tailwind v4, @supabase/ssr 0.10.2, TypeScript 5 strict, Recharts 3.x, Vitest 4.1.4. Radix Tooltip via @base-ui/react.
- **Tests**: **518/518 green** across 31 files (Phase 1 baseline 108 + Phase 2 accumulated 410 incl. this session's +27 since Step 12: 36 aggregator + 3 dedup + 4 AV-compact + 8 farside).
- **MCP servers**: figma, supabase, context7, alphavantage + **Claude-in-Chrome** (jw.byun authenticated, tabGroupId=690806389).
- **`.env.local` keys**: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, FRED_API_KEY, ALPHA_VANTAGE_API_KEY, CRON_SECRET (43-char), FINNHUB_API_KEY, VERCEL_OIDC_TOKEN.
- **Vercel prod**: alias `finance-manager-james.vercel.app` → deployment `finance-manager-ttq2h2zbq-jaclyn6s-projects.vercel.app` (commit b861cfa).
- **GitHub repo secrets**: CRON_SECRET (re-synced this session), PRODUCTION_URL (incl. https://), FINNHUB_API_KEY.
- **Supabase**: hhohrclmfsvpkigbdpsb (Seoul, Postgres 17.6.1.104). Migrations 0001–0010.
- **Data state** (2026-04-25 post-deploy):
  - `composite_snapshots`: 5 v2 rows for 2026-04-25 with multi-category JSONB. us_equity/global_etf/common at 4/6, crypto at 3/6, kr_equity at 2/6.
  - `technical_readings`: 60 + 54 = 114 rows (10 + 9 tickers × 6 indicators); 7 + 5 = 12 ticker-success rows + 7 ticker-error rows for KR `.KS` failures.
  - `price_readings`: 1095 crypto + 12 AV daily bars (post-batch-1+2 partial successes).
  - `onchain_readings`: 4 rows for 2026-04-25 (1 BGeometrics 429 error, others success).
  - `news_sentiment`: 5 success rows for 2026-04-25.
  - `signal_events`: ≥1 row for 2026-04-25.
- **Blueprint versions**: Phase 2 v1.0 (2026-04-23), PRD v3.4.

## 9. How to Resume

1. **KR equity AV format investigation** (HIGH priority — biggest remaining categories gap):
   - Try alternative KR ticker formats: `005930.KOSPI`, `KS:005930`, `005930.KS=X` (Yahoo-style), or no suffix.
   - Test via `curl "https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=005930.KOSPI&apikey=$ALPHA_VANTAGE_API_KEY&outputsize=compact"`.
   - If no free format works, document and remove KR tickers from `TICKER_REGISTRY` (kr_equity technical category will be null until Phase 3).
2. **Step 13 acceptance matrix** — walk every blueprint §10.1 + §10.2 row, produce evidence (`docs/phase2_acceptance_matrix.md`).
3. **CLAUDE.md Trigger 2** — 5-agent review over full Phase 2 diff. Surface span: `ba2b1f2..b861cfa`.
4. **UI polish**: size-11 touch targets + motion-safe + PNG icons for iOS.
5. **Lighthouse PWA audit** on production URL. Real-device A2HS test.
6. **Phase 3 Glassnode budget decision** — surface ~$29/mo cost to user; alternative is hourly-outage tolerance for crypto onchain signals.

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
