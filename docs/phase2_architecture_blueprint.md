# Phase 2 Architecture Blueprint — Investment Advisor Dashboard

**v1.0 (2026-04-23)** — initial authorship. Phase 2 scope is defined by PRD v3.4 §18 Phase 2 bullets (lines 493–501) with the signal-alignment layer added by PRD §10.4 (lines 242–268). Decisions are grounded in `docs/phase2_plan.md` §0.1–§0.5 and PRD v3.4 citations inline. Phase 1 Blueprint v2.3 (`docs/phase1_architecture_blueprint.md`) is the structural and pattern template — this document does not duplicate its content, only extends it.

> **Document contract.** The PRD at `../investment_advisor_dashboard_prd_kr_v3.md` defines the **what** and **why**. This blueprint defines the **how** for Phase 2 and is deliberately prescriptive about files, data flow, schema, and sequencing. When implementation reality drifts, update this document first, then write code (Phase 1 discipline carried forward).

## Version Assumptions

Phase 2 continues on the Phase 1 stack unchanged. Any runtime upgrade is out of Phase 2 scope unless a mandatory CVE or vendor EOL forces it.

- **Next.js 16.2.4** (App Router, Turbopack default, `proxy.ts`, `cacheComponents: true`) — Phase 1 blueprint §Version Assumptions.
- **React 19.2.4**.
- **Tailwind CSS v4** with `@tailwindcss/postcss`.
- **`@supabase/ssr` 0.10.2** (`getAll`/`setAll` cookie pattern, `setAll` 2-arg headers forwarding).
- **`@supabase/supabase-js` 2.103.x** (service-role admin client).
- **Node.js 20 LTS** runtime on Vercel + GitHub Actions.
- **TypeScript 5.x**.
- **shadcn/ui** (`base-nova` style, Lucide icons) — Phase 2 adds `progress`, `tabs` components.
- **Recharts 3.x** for client-side charting (extended in §6 for price overlay).
- **Vitest 4.x** for pure-function unit tests — target ≥ 150 tests green at Phase 2 close.

## 1. Product Scope Recap

### 1.1 In scope

Phase 2 delivers the seven PRD §18 bullets (lines 494–501) plus the §10.4 signal-alignment layer that PRD v3.4 introduced:

1. **Technical overlay** — RSI(14), MACD(12,26,9), MA(50), MA(200), Bollinger(20,2), and the derived **Disparity (이격도)** = `price / MA200 − 1` (PRD §8.2 line 159). Computed locally from Alpha Vantage OHLC to conserve the 25/day Free Tier budget (PRD §17 line 476).
2. **On-chain overlay for crypto** — MVRV Z-Score, SOPR (Bitbo), Spot ETF 순유입 (CoinGlass), Crypto Fear & Greed (alternative.me) (PRD §8.3 lines 164–169).
3. **News sentiment** — Finnhub 뉴스 센티먼트 as a **보조 지표** only, with capped weight per PRD §8.4 line 172.
4. **Score contribution visualization** — expanded `ContributingIndicators` (Phase 1) to 4 categories (macro / technical / on-chain / sentiment) with grouped visual (PRD §18 line 497).
5. **Price history layer** — `price_readings` table populated for 22 frozen tickers (§3.2 below), **visualization-only — MUST NOT feed the score engine** (PRD §8.5 line 188).
6. **Price overlay in the history view** — Recharts `ComposedChart` on `/asset/[slug]` combining score line (left axis) with price line (right axis) (PRD §11.6 Phase 2 range, line 312).
7. **PWA** — web app manifest + service worker shell caching (no offline data) + installable icon (PRD §11.7 line 335, §18 line 500).
8. **Signal Alignment Engine** (PRD §10.4, §18 line 501, `docs/phase2_plan.md` §0.5 tenet 4) — 6 independent boolean buy signals, an `alignment_count`, and a hero UI card placed **above** `CompositeStateCard` in dashboard hero zone.

Dependent ops enablers also in scope:
- **Per-category staleness badges** — extend Phase 1's single `StalenessBadge` to a badge per category (plan §0.5 tenet 1, "silent success / loud failure").
- **GitHub Actions scheduled workflows** — hourly + daily cadences that Vercel Hobby's 1/day cron cannot provide (plan §0.2 item 8 resolution).
- **MODEL_VERSION v2.0.0 greenfield cutover** — v1 historical rows preserved; v2 rows populate forward from deploy date (plan §0.2 item 9).

### 1.2 PRD v3.3 / v3.4 resolution notes

The PRD v3.3 rewrite resolved the historical §16.1 vs §18 contradiction: RSI/MACD and MVRV/SOPR rows moved from §16.1 (Phase 1 acceptance) to new §16.3 (Phase 2 acceptance). Phase 1 blueprint v2.3 (7 FRED macro series only) is the correct Phase 1 shipping scope. Phase 2 is the first time those technical/on-chain indicators become acceptance-blocking (PRD §16.3 line 468–470).

PRD v3.4 added §10.4 signal alignment after observing the 자산제곱 YouTube "4가지 전략" framework (`https://youtu.be/TJ3uAYxPY5k`). The philosophy: continuous composite scores summarize *how the model sees the market*; discrete independent signals tell the user *whether multiple independent buy conditions are firing at once*. For the beginner personas (어머니 / 여자친구, PRD §5 line 76), "4/6 signals active" is immediately actionable in a way that "score 47" is not. This drives the Phase 2 UX rule: **SignalAlignmentCard is rendered above CompositeStateCard in the dashboard hero** (plan §0.5 tenet 4 — "actionable over aggregate").

### 1.3 Out of scope

**Deferred to Phase 3** (PRD §18 lines 503–507):
- Regime classification engine.
- Portfolio overlay.
- Per-user personalization (맞춤 해석, preferred assets, push rules) — plan §0.2 item 4 resolution: family members (jw.byun / edc0422 / odete4) see the identical dashboard in Phase 2.
- Backtest UI (산식 replay on `raw_payload` + version-to-version comparison).

**Permanently out of scope** (PRD §4.2 lines 64–68):
- 자동매매.
- 개별 종목 추천 / 목표가 산출.
- 초단타 실시간 트레이딩.
- 기관용 파생상품 리스크 엔진.

**Mobile ergonomics still deferred** (PRD §11.7 lines 329–333, plan §0.2 item 5 resolution):
- Offline cached data reads (service worker shell only).
- Custom gestures (pull-to-refresh, swipe navigation, long-press).
- Web haptics API.

**No new NFRs** (plan §0.2 item 6 resolution): no SLA commitment, no Sentry/external error tracking, no i18n (Korean only), Vercel Analytics retained from Phase 1.

## 2. Architecture Decisions

### 2.1 The 9 ambiguities and their resolutions

Each of the nine ambiguities in `docs/phase2_plan.md` §0.2 was resolved on 2026-04-23. This table is the canonical decision record for Phase 2 — deviating from any row requires revising this blueprint, not silent code changes.

| # | Question | Decision | Reasoning (verbatim from plan §0.2 where possible) | Source |
|---|----------|----------|----------------------------------------------------|--------|
| 1 | PRD §16.1 vs §18 contradiction | **§18 is canonical**; PRD v3.3 moved RSI/MACD + MVRV/SOPR rows into new §16.3 Phase 2 acceptance. Phase 1 blueprint v2.3 (7 FRED series) remains complete and unchanged. | v3.3 rewrite settled the ambiguity at the PRD level. | PRD §16.1, §16.3, §18 |
| 2 | Phase 2 ticker list | **22 tickers frozen at authoring time**: 19 via Alpha Vantage + 3 via CoinGecko. List in §3.2 below. Budget = 19 AV calls/day, 6 calls/day headroom. | AV Free 25/day, 5/min. 5y OHLC fetched once per day per ticker, RSI/MACD/MA/Bollinger computed locally. Plan §0.2 item 2 analysis. | PRD §8.5, §17; plan §0.2 #2 |
| 3 | KR-specific indicators | **Two FRED series** fill the PRD §10.3 "환율·지역 오버레이 20" weight: `DTWEXBGS` (Broad Dollar, weight 10) + `DEXKOUS` (USD/KRW, weight 10). No Bank of Korea ECOS API integration. | `IRLTLT01KRM156N` monthly cadence mismatches daily cron. ECOS auth cost > value. KOSPI % as input is self-referential (KR equity score using KOSPI). KRX 외국인 수급 has no official free API. | Plan §0.2 #3 |
| 4 | Per-persona UX for Phase 2 | **No persona branching.** All three family members see the identical dashboard. Per-user personalization deferred to Phase 3 per PRD §18 line 506. | Phase 1 already provides easy-copy + color bands as the "beginner layer" and detail charts as the "expert layer" in the same view. | PRD §5, §6.2; plan §0.2 #4 |
| 5 | Mobile ergonomics in Phase 2 | **PWA only.** Manifest + service worker shell caching + installable icon. Offline data reads / custom gestures / haptics stay out of scope. | PRD §11.7 lines 329–333 enumerated the deferred items. Shell-only keeps implementation cost low relative to the "app feel" payoff. Family always has stable internet. | PRD §11.7, §18; plan §0.2 #5 |
| 6 | Non-functional (SLA, WCAG, i18n, monitoring) | **No new NFRs.** Vercel Analytics + GitHub Actions email notifications + staleness badges for user-visible failure. No Sentry. Korean only. | Internal family tool; external-grade SLA/i18n not warranted at Phase 2 maturity. | Plan §0.2 #6 |
| 7 | CoinGecko vs CoinGlass vs Bitbo | **Three sources, each owning its speciality.** Bitbo = MVRV Z + SOPR; CoinGlass = ETF flow; alternative.me = Crypto F&G; CoinGecko = BTC/ETH/SOL daily price (visualization only). Each uses the Phase 1 `{source}.ts` + `{source}-parse.ts` split. | Each API is specialized for its domain. Consolidating through one provider increases data-quality risk and creates a single point of failure. | PRD §8.3, §8.5; plan §0.2 #7 |
| 8 | Vercel Hobby cron 1/day limit | **GitHub Actions for all non-daily cron.** Vercel Cron keeps its single daily slot (macro at 06:00 UTC, unchanged). Technical runs at 22:00 UTC via GitHub Actions. Hourly bundle (onchain + news + CNN F&G) via GitHub Actions. | GHA free tier = 2,000 min/month on a private repo. Hourly × 720 runs × 30s = ~360 min/mo — well under cap. Endpoint-per-ingestion-type (Phase 1 pattern) gives error isolation; workflow-bundling at the runner saves minutes. | Plan §0.2 #8 |
| 9 | Score engine version bump | **MODEL_VERSION = v2.0.0, greenfield from deploy date.** Existing v1 rows (30-day backfill) preserved but not re-computed. Dashboard reader filters on current `MODEL_VERSION`; any historical date before the v2 cutover shows the v1 row with a "모델 전환일" badge. | Bitbo/CoinGlass historical data reliability unknown (unofficial APIs). Replay could fabricate unreliable historical composites. PRD §11.6 "180d after Phase 2" is met by natural accumulation, not immediate backfill. | PRD §11.6, §16.2; plan §0.2 #9 |

### 2.2 Cross-cutting design tenets (plan §0.5)

Four principles govern every Phase 2 implementation decision. These are woven through §§3–9 below.

1. **"성공은 조용히, 실패는 시끄럽게" (Silent success, loud failure)** — Every ingestion failure (FRED / Alpha Vantage / Bitbo / CoinGlass / alternative.me / CNN F&G / Finnhub / CoinGecko) surfaces to the user via a staleness badge, an `ingest_runs` row, or a hard-fail banner. No silent fallback to stale data presented as fresh. Phase 1 shipped the single-source template via `StalenessBadge`; Phase 2 extends it to per-category badges and a 7-day-failure banner. *Used in §3 (staleness policy), §7 (reader invariants), §11 (risk table).*

2. **"Snapshot immutability"** — `composite_snapshots(asset_type, snapshot_date, model_version)` is write-once. Corrections happen only via `MODEL_VERSION` bump. `raw_payload` retained for Phase 3 backtest replay. This is the Phase 1 invariant carried forward unchanged. *Used in §4 (MODEL_VERSION v2.0.0), §8 (`signal_events` PK choice).*

3. **"Family-wide, not per-user"** — All Phase 2 readers serve the same data to all three family members. Admin client (service_role) is permitted inside `'use cache'` scopes because the cache key has no per-user dependency; this also avoids the banned `cookies()` call inside cache. *Used in §7 (data flow), every reader in §9 build steps.*

4. **"Actionable over aggregate"** (PRD v3.4 §10.4) — The Signal Alignment card ("N/6 signals active") is rendered **larger and higher** than `CompositeStateCard` ("score 47") in the dashboard hero. Discrete simultaneous signals drive beginner-persona comprehension where continuous scores don't. *Used in §6 (UI layout), §8 (signal_events schema), §9 Step 8.5.*

### 2.3 Frozen constants (to land in code at Phase 2 Step 1)

These strings + versions are the authoritative source — editing them requires a blueprint revision, not a silent code change.

- `MODEL_VERSION = "v2.0.0"` (was `"v1.0.0"` in Phase 1; see §4, plan §0.2 #9).
- `SIGNAL_RULES_VERSION = "v1.0.0"` (independent from `MODEL_VERSION` — signal threshold tuning and composite weight tuning are different cadences; see §4, plan C.1 + C.7.5).
- `TICKER_LIST_VERSION = "v2.0.0-2026-04-25"` (snapshot of the 15-ticker list — 12 AV + 3 CoinGecko — after the 2026-04-25 KR carve-out; ticker replacement forces a bump; see §3.2).

## 3. Data Sources + Cadences

Every source follows the Phase 1 split convention: `src/lib/score-engine/sources/{source}.ts` (fetcher, `import "server-only"`) + `src/lib/score-engine/sources/{source}-parse.ts` (pure parser, Node-env reusable from `scripts/`). The `-parse.ts` split was introduced for FRED at Phase 1 Step 11.5 (`fred-parse.ts`) and is now mandatory for every new source — it lets the Phase 2 backfill script (§9 Step 12) reuse parsing without tripping `"server-only"`.

### 3.1 Source matrix

| Source | Scope | Auth | Rate limit | Phase 2 TTL (PRD §12.2) | Staleness threshold (tenet 1, plan §0.5) | Files |
|--------|-------|------|-----------|------------------------|--------------------------------------------|-------|
| **FRED** (expanded) | 9 series — 7 existing + **`ICSA`** (weekly claims, §10.4 `ECONOMY_INTACT`) + **`WDTGAL`** (daily TGA balance primary, §10.4 `LIQUIDITY_EASING`; `WTREGEN` weekly is documented fallback if `WDTGAL` becomes unavailable) | `FRED_API_KEY` (Phase 1, reused) | ~120/min effectively unlimited for our scale | 24h | 48h | `fred.ts` + `fred-parse.ts` (existing, extended) |
| **Alpha Vantage** | 12 tickers (§3.2) → `TIME_SERIES_DAILY` daily bars, local RSI/MACD/MA/Bollinger/Disparity | `ALPHA_VANTAGE_API_KEY` (Phase 1 placeholder now active) | **25/day, 5/min (Free)** — the tight constraint | 12–24h | 48h | `alpha-vantage.ts` + `alpha-vantage-parse.ts` (new) |
| **CoinGecko** | 3 tickers — `bitcoin`, `ethereum`, `solana` — daily price only (visualization-only per §8.5) | public (no key) | ~30/min, effectively unlimited for 3 tickers/day | 24h | 48h | `coingecko.ts` + `coingecko-parse.ts` (new) |
| **BGeometrics** (`api.bitcoin-data.com/v1/`) | MVRV Z-Score, SOPR — replaced Bitbo (2026-04-25). 8 requests/hour free quota; `retryOnRateLimit: false` fail-fast policy in `bitbo.ts`. Phase 3 candidate: Glassnode (~$29/mo) for production-grade reliability. | unofficial, no key | 8/hr per IP (429 with `RATE_LIMIT_HOUR_EXCEEDED`); fail-fast | 1h | 2h | `bitbo.ts` + `bitbo-parse.ts` |
| **Farside** (`farside.co.uk/btc/`) | BTC Spot ETF flows — HTML scrape, parses `Mon DD, YYYY` and `DD Mon YYYY` date formats plus parenthesized accountancy negatives. Migrated 2026-04-25 from CoinGlass v2 (returned 500 from Vercel ASN; v4 paid). | unofficial, no key | unofficial; back-off | 1h | 2h | `coinglass.ts` + `coinglass-parse.ts` |
| **alternative.me** | Crypto Fear & Greed Index | public (no key) | generous | 1h | 2h | `alternative-me.ts` + `alternative-me-parse.ts` (new) |
| **CNN Markets Data** | CNN Fear & Greed Index (**stocks**, distinct from alternative.me crypto F&G — PRD §8.4 line 179) | unofficial public JSON | unofficial; back-off | 1h | 2h | `cnn-fear-greed.ts` + `cnn-fear-greed-parse.ts` (new) |
| **Finnhub** | 뉴스 센티먼트 (보조 지표, PRD §8.4) | `FINNHUB_API_KEY` (new env var) | 60/min (Free) | 1h | 2h | `finnhub.ts` + `finnhub-parse.ts` (new) |

**Staleness policy** (plan §0.5 tenet 1): per category, the UI surfaces the oldest last-success ingest. Threshold = 2 × category TTL (macro 48h, technical 48h, onchain 2h, sentiment 2h). Beyond that, `StalenessBadge` renders `destructive`. If any category has zero successful ingests for 7 consecutive days, a hard-fail red banner renders at page top across all protected routes. Never return stale data silently as fresh — the Phase 1 `fred.ts → fetch_status` pattern is the template.

**`server-only` guard** (Phase 1 invariant preserved): every `{source}.ts` that reads an API key or contacts an upstream service carries `import "server-only"` at the top. `{source}-parse.ts` is guard-free so backfill scripts (`scripts/backfill-*.ts`) can import it under `npx tsx` Node env. Violating this split is an anti-pattern (§12).

### 3.2 Ticker registry (TICKER_LIST_VERSION v2.0.0-2026-04-25)

Frozen at authoring time. Plan §0.2 item 2 resolution. Changing this list requires bumping `TICKER_LIST_VERSION` + a blueprint revision — silent code edits forbidden (see §11 risk row 5, §12 trade-off 5).

The current registry is **15 tickers (12 AV + 3 CoinGecko)**.

**US equity (7 — Alpha Vantage)**
- `SPY`, `QQQ` (broad indices; MOMENTUM_TURN signal uses SPY MACD)
- `NVDA`, `AAPL`, `MSFT`, `GOOGL`, `AMZN` (top-5 caps at authoring; the **top-5 list must be re-verified at Phase 2 Step 1** and bumped if drift observed)

**Region ETF (3 — Alpha Vantage)**
- `EWJ`, `MCHI`, `INDA`

**Macro-hedge ETF (2 — Alpha Vantage)**
- `GLD` (gold; risk-off hedge complement to macro category)
- `TLT` (20y Treasury; long-duration rate inverse complement to `DGS10`)

**Crypto (3 — CoinGecko IDs)**
- `bitcoin`, `ethereum`, `solana`

**Alpha Vantage Free-tier budget audit**: 12 AV tickers × 1 `TIME_SERIES_DAILY`/day = 12 calls/day. Combined with the AV NEWS_SENTIMENT layer (5 AV news calls/day, see Step 7) the daily total is 17/25, leaving 8 calls headroom for manual backfill + transient retries. Crypto budget is independent — CoinGecko free tier is effectively unlimited at 3 tickers/day.

**2026-04-25 KR carve-out**: 7 KR `.KS` tickers (`005930.KS` Samsung, `000660.KS` SK Hynix, `373220.KS` LGES, `207940.KS` Samsung Bio, `005380.KS` Hyundai Motor, `069500.KS` KODEX 200, `232080.KS` TIGER KOSDAQ150) were removed from the registry after Alpha Vantage free tier was verified to reject every KOSPI / KOSDAQ symbol format (`.KS`, `.KQ`, `.KOSPI`, `.KRX`, bare 6-digit). KR equity technical category is therefore null at Phase 2 — `aggregateTechnical('kr_equity')` returns null, surfaced in `missingCategories` per §2.2 tenet 1. Phase 3 candidate sources: ECOS (한국은행 OpenAPI) or Yahoo Finance scrape. See `src/app/api/cron/ingest-technical/ticker-registry.ts` header for the full carve-out rationale.

### 3.3 Cron cadence plan

Following plan §0.2 item 8 resolution — Vercel Cron keeps its single daily slot; GitHub Actions drives everything else.

| Cron | Host | Schedule (UTC) | Endpoint | Rationale |
|------|------|----------------|----------|-----------|
| Macro ingest (existing) | Vercel Cron (Hobby) | `0 6 * * *` | `/api/cron/ingest-macro` | Unchanged from Phase 1. FRED publish schedule settled by this hour. |
| Technical ingest | GitHub Actions | `0 22 * * *` | `/api/cron/ingest-technical` | ~1h after US close; AV daily OHLC settled. Respect 5/min limit with 15s sleeps between 19 calls (~5 min total). |
| Hourly bundle (on-chain + news + CNN F&G) | GitHub Actions | `0 * * * *` | `/api/cron/ingest-onchain` then `/api/cron/ingest-news` then `/api/cron/ingest-cnn-fg` (sequential in one workflow) | Per plan §0.2 #8: endpoint-per-type for isolation, workflow-bundling for minute savings. Runner calls each sequentially with `curl`. |
| Signal recompute | Chained inside each cron (macro/technical/hourly) | N/A | `signals.compute()` + `revalidateTag('signals', { expire: 0 })` | Plan C.7.5: signal engine invoked at end of every ingestion path whose inputs affect any of the 6 signals. Avoids a separate cron. |
| Price-history ingest | GitHub Actions | `0 22 * * *` (bundled with technical) | `/api/cron/ingest-prices` | Daily bars; shares the AV 5/min budget with technical within the same workflow run. |

**GitHub Actions secret**: all 4 GHA workflow files (`cron-technical.yml`, `cron-hourly.yml`, `cron-prices.yml`) use `${{ secrets.CRON_SECRET }}` in the `Authorization: Bearer` header. The secret is **manually kept in sync** between Vercel Production env and GitHub repo secrets (no OIDC for Phase 2 — operational simplicity over rotation convenience; risk-tracked in §11).

**GHA drift tolerance** (plan §0.2 #8 anti-pattern): schedules can drift by 10+ minutes during peak load. Downstream readers must treat "last hour's data" as the contract, not "on-the-hour precision". The staleness thresholds in §3.1 already bake this in (2× TTL is 2h for hourly → one missed run remains healthy).

### 3.4 Backfill strategy

Phase 1 Step 11.5 seeded 30 days via `scripts/backfill-snapshots.ts` against per-date 5-year windows. Phase 2 extends this for each new source, but with a **crucial constraint from plan §0.2 #9**:

- **v1 rows preserved, not replayed.** The 30-day macro-only backfill at `2026-03-21 → 2026-04-19` under `MODEL_VERSION=v1.0.0` remains in DB. Phase 2 does not recompute these rows against v2.0.0.
- **v2 backfill scope**: from the Phase 2 deploy date forward, the daily cron accumulates naturally. No historical v2 composites get written for pre-deploy dates.
- **Technical/on-chain backfill**: optional per-category `scripts/backfill-technical.ts`, `scripts/backfill-onchain.ts`, `scripts/backfill-prices.ts` to seed a small recent window (e.g. 30 days) before UI verification. Each script mirrors `backfill-snapshots.ts`: pure score-engine functions, service-role client directly, `{source}-parse.ts` reuse (no server-only).
- **UI impact**: `/asset/[slug]` trend line renders a vertical separator at the v2 cutover date. Score bands pre-cutover = v1 color; post-cutover = v2 color. Hover tooltip documents the discontinuity (plan §0.2 #9 cutover checklist).

## 4. Score Engine v2

Pure TypeScript, framework-agnostic (Phase 1 §4 invariant preserved). Next.js version and Cache Components model do not touch this layer.

### 4.1 Category model

Phase 1 composites were 100% macro (7 FRED indicators with equal asymmetric weights). Phase 2 introduces **four categories** producing four sub-scores that are then weighted per asset type:

- **Macro score** — 9 FRED indicators (Phase 1 seven + `ICSA` + TGA). Normalization unchanged from Phase 1: per-indicator 5-year z-score → `zScoreTo0100(z, inverted)` linear-clamped to [0, 100].
- **Technical score** — RSI(14), MACD(12,26,9), MA(50), MA(200), Bollinger(20,2), Disparity. PRD §9.1 transforms for RSI (≤30 high, 30–50 mid, 50–70 low, ≥70 very low). PRD §9.2 for MACD (bullish cross = gain, bearish expansion = loss, 0-line for trend context). MA/Bollinger/Disparity use standard-deviation distance thresholds calibrated per-asset at Step 3.
- **On-chain score** — MVRV Z (PRD §9.3: ≤0 max, 0–3 favorable, 3–7 mid, ≥7 very low), SOPR (PRD §9.4: <1 gain, ≈1 neutral, >1 persistent = overheat flag), ETF flow (CoinGlass — normalized by net flow / circulating supply daily), Crypto F&G (alternative.me — 0–100 passthrough, inverted: fear high → score high).
- **Sentiment modifier** — Finnhub news sentiment + Stock CNN F&G. **Capped weight** per PRD §8.4 line 172 ("보조 지표로만 사용"). Never drives the composite alone.

### 4.2 Per-asset weight tables (PRD §10)

These weights are the PRD v3.4 initial values and are the authoritative input to `src/lib/score-engine/weights.ts` v2.0.0. Initial values only — backtest-driven re-tuning is Phase 3 per PRD §10 line 240.

**US equity (PRD §10.1)**
| Category | Weight |
|----------|-------:|
| Macro | 45 |
| Technical | 35 |
| Sentiment | 10 |
| Valuation | 10 |

(Phase 2 does not implement a dedicated "밸류에이션" category — the 10 weight is folded into the sentiment layer via a neutral 50 sub-score until Phase 3 delivers the valuation module. This is a documented trade-off; see §12 trade-off 7.)

**BTC/ETH (PRD §10.2)**
| Category | Weight |
|----------|-------:|
| On-chain | 35 |
| Macro | 25 |
| Technical | 25 |
| Sentiment (incl. ETF 수급) | 15 |

**KR equity (PRD §10.3)**
| Category | Weight |
|----------|-------:|
| Macro | 45 |
| Technical | 25 |
| Regional overlay (DTWEXBGS 10 + DEXKOUS 10) | 20 |
| Sentiment | 10 |

Plan §0.2 #3 resolved the regional overlay: dollar strength and USD/KRW both act as negative signals on KR equity (foreign-capital outflow and FX-debt burden dominate over export benefit). z positive → score lowered.

**Global ETF** (`EWJ` / `MCHI` / `INDA` regional + `GLD` / `TLT` macro-hedge per §3.2 ticker registry)
| Category | Weight |
|----------|-------:|
| Macro | 45 |
| Technical | 35 |
| Sentiment | 10 |
| Valuation | 10 |

Initial weights mirror US equity — Phase 2 decision, not PRD-prescribed. Rationale: the Phase 2 global-ETF scope is regional/hedge ETFs rather than company-specific tickers; their primary drivers are the same macro + technical factors used for US equity. A dedicated "regional dispersion" or "risk-off strength" modifier is Phase 3 scope. If backtest in Phase 3 shows this weight mix underperforms for these specific tickers, revisit. **This paragraph IS the documented decision referenced by the anti-pattern** "don't silently fall back to US-equity weights without a documented decision" — silently copying US-equity weights without landing a decision here would still be a violation.

### 4.3 Normalization formulas

Three new normalizers land in `src/lib/score-engine/normalize.ts` (extending Phase 1 `computeZScore` + `zScoreTo0100`):

```
// RSI: piecewise-linear per PRD §9.1
rsiToScore(rsi): number {
  if (rsi <= 30) return lerp(100, 80, (rsi - 0) / 30);
  if (rsi <= 50) return lerp(80, 55, (rsi - 30) / 20);
  if (rsi <= 70) return lerp(55, 30, (rsi - 50) / 20);
  return lerp(30, 5, clamp((rsi - 70) / 30, 0, 1));
}
```

MACD score = sign of (MACD − Signal) × magnitude-normalized by 90-day rolling stdev of the MACD histogram → zScoreTo0100.

MVRV Z-Score score = piecewise-linear per PRD §9.3 boundaries: `{≤0: 100, 0–3: 80, 3–7: 40, ≥7: 10}` with lerp between boundaries.

SOPR score = piecewise per PRD §9.4: `<1: 80 + (1-SOPR)*20`, `[1, 1.05]: 55`, `>1.05: 40 - min(40, (SOPR-1.05)*100)`.

Disparity score for technical category = linear-clamped: price/MA200 ratio − 1 mapped `[-0.25, +0.25]` → `[85, 15]`; beyond clamped.

### 4.4 `MODEL_VERSION` v2.0.0 greenfield cutover

Plan §0.2 #9 resolution, Phase 2 Step 6:

1. Bump `MODEL_VERSION = "v2.0.0"` in `src/lib/score-engine/weights.ts`.
2. All data readers in `src/lib/data/indicators.ts` already filter on `.eq('model_version', MODEL_VERSION)` (Phase 1 Step 8 post-review) — no change needed; the filter becomes v2-only automatically.
3. Dashboard hero adds a "모델 v2.0.0 — 2026-MM-DD 전환" badge (MM-DD = deploy date) with a hover tooltip explaining the v1→v2 change.
4. `/asset/[slug]` score trend chart renders a vertical `ReferenceLine` at the cutover date in the rolling window (Recharts supports this without extra libs).
5. For any historical date `d < cutover`, readers return the v1 row and the `StalenessBadge` sub-component renders a "v1 모델" suffix inline — v1 rows survive per the snapshot-immutability tenet (§2.2 tenet 2).

Invariant (tenet 2, snapshot immutability): v1 rows are never rewritten in place. Corrections happen only via `MODEL_VERSION` bump. The `raw_payload` column already stores upstream FRED JSON so a Phase 3 backtest can replay historical series against updated formulas without re-fetching.

### 4.5 Signal Alignment sub-engine (PRD §10.4, plan C.7.5)

Independent from the composite. Plan §0.5 tenet 4 ("actionable over aggregate") makes it the product's primary action-driver.

**6 signals** (exact formulas, copy from plan C.7.5 with PRD §10.4 input sources):

| Signal | Formula | Inputs |
|--------|---------|--------|
| `EXTREME_FEAR` | `VIX ≥ 35 \|\| CNN_FG < 25` | `VIXCLS` (FRED) + CNN F&G |
| `DISLOCATION` | `SPY.disparity ≤ -0.25 \|\| QQQ.disparity ≤ -0.25` | Technical engine (SPY + QQQ disparity) |
| `ECONOMY_INTACT` | `ICSA < 300000 && SAHMCURRENT < 0.5` | `ICSA` + `SAHMCURRENT` (FRED) |
| `SPREAD_REVERSAL` | `BAMLH0A0HYM2_today ≥ 4 && BAMLH0A0HYM2_today < max(last_7d)` | `BAMLH0A0HYM2` (FRED) |
| `LIQUIDITY_EASING` | `TGA_today < TGA_20d_MA` (20-day SMA of daily closing balance) | `WDTGAL` (FRED, daily primary; `WTREGEN` weekly as fallback) |
| `MOMENTUM_TURN` | SPY MACD bullish cross within last `N=7` days | Technical engine (SPY MACD) |

**`SIGNAL_RULES_VERSION`** is a standalone constant independent of `MODEL_VERSION` — the threshold tuning cadence differs from composite-weight tuning (plan §0.2 item 9 commentary).

**`signal_events` table** (§8 schema):
- PK `(snapshot_date, signal_rules_version)`. Per §2.2 tenet 2, write-once per version × date — no in-place update; corrections via `SIGNAL_RULES_VERSION` bump.
- Columns: `snapshot_date DATE`, `active_signals JSONB` (array of signal names currently true), `alignment_count INT` (len of active_signals, cached for index-friendly queries), `signal_rules_version TEXT`, `computed_at TIMESTAMPTZ`, `per_signal_detail JSONB` (each signal's input values + threshold comparison for UI tooltip rendering).

**Per-asset signal mapping** (PRD §10.4 line 268):
- `us_equity`: all 6 signals.
- `crypto` (BTC/ETH/SOL): `MOMENTUM_TURN` replaced by crypto MACD on BTC. Add crypto-specific `CRYPTO_UNDERVALUED` = `MVRV_Z ≤ 0` and `CAPITULATION` = `SOPR < 1`. Total 7 signals on the crypto asset page.
- `kr_equity`: 5 signals (all except `DISLOCATION` — KR disparity not a calibrated signal at Phase 2; revisit Phase 3).
- `global_etf`: 5 signals (all except `MOMENTUM_TURN` — no single representative MACD; use EWJ/MCHI/INDA dispersion as a Phase 3 signal).
- `common` / dashboard hero: the full US-equity 6, since the dashboard is the family's primary entry point and the 자산제곱 framework was designed around US-equity signals.

**Null/unknown handling** (§2.2 tenet 1, plan §0.5 #1): if any input to a signal is missing (e.g. CNN F&G ingestion failed today), the signal is `null`/unknown — **never defaulted to `false`**. UI renders the amber "unknown" state, not the grey "off" state. Otherwise a silent upstream failure would mimic a signal-off condition and mislead the user.

## 5. Routing Changes

**No new protected routes in Phase 2.** The Phase 1 three-route surface (`/dashboard`, `/asset/[slug]`, `/changelog`) carries all Phase 2 data by extension, not by adding pages. Data flows through the existing `searchParams.date` plumbing (Phase 1 Step 10.5).

| Route | Phase 2 change |
|-------|----------------|
| `/` | Unchanged (redirect to `/dashboard`). |
| `/login` | Unchanged. |
| `/dashboard?date=` | New `SignalAlignmentCard` rendered **above** `CompositeStateCard`. Per-category staleness badges in card headers. Hard-fail banner at top when any category has 7-day 0-success. |
| `/asset/[slug]?date=` | `ScoreTrendLine` gains a right-axis price line (`ComposedChart`). `ContributingIndicators` expands to 4-category grouping. Per-asset signal mapping (§4.5) displayed in a new section below the chart. |
| `/changelog?date=` | Unchanged surface; rows now include technical/on-chain/sentiment deltas when `top_movers` contains them. `band_changed` highlight unchanged. |
| `/api/cron/ingest-macro` | Extended to 9 FRED series (+ `ICSA` + TGA). Also invokes `signals.compute()` at the end. |
| `/api/cron/ingest-technical` (new) | 19 AV tickers → daily bars → local technical indicator compute → technical_readings upsert → signals.compute + revalidateTag. |
| `/api/cron/ingest-onchain` (new) | Bitbo + CoinGlass + alternative.me → `onchain_readings` upsert → signals.compute + revalidateTag. |
| `/api/cron/ingest-news` (new) | Finnhub → `news_sentiment` upsert → revalidateTag. |
| `/api/cron/ingest-cnn-fg` (new) | CNN Markets Data JSON → `onchain_readings` or `news_sentiment` (TBD at Step 2) → signals.compute. |
| `/api/cron/ingest-prices` (new) | Alpha Vantage + CoinGecko → `price_readings` upsert. **Does not invoke signals.compute** (price is visualization-only, §8.5). |

**Partial Prerender model** (Phase 1 §7, §9 Step 10 pattern): every extended protected page keeps the Phase 1 split — static shell in `page.tsx` + `<Suspense>` + dynamic subtree calling data readers. `'use cache'` pushes down to `src/lib/data/*` — never at page level when `searchParams` or wall-clock dates enter.

**Phase 1 blueprint §5 routing table drift** (handoff §7 open item): Phase 1 §5 table still says `'use cache'` at page level, but the actual implementation is Partial Prerender (§7 in Phase 1 blueprint was updated to reflect this; §5 was not). Phase 2 inherits the Partial Prerender pattern, which is correct. Phase 1 §5 stays cosmetic drift to be cleaned in the first Phase 2 UI-polish pass (§9 Step 13 below, or a dedicated docs-only commit).

## 6. Mobile + A11y (PWA)

Plan §0.2 item 5 resolution: **PWA shell only**. No offline data reads, no custom gestures, no haptics. Phase 1's responsive foundation (§6.2 Phase 1 blueprint: 768px breakpoint, hamburger `Sheet`, native `<input type="date">` on `<md`, 44×44 touch targets) is preserved unchanged.

### 6.1 Web App Manifest

File: `public/manifest.webmanifest`.

```json
{
  "name": "Investment Advisor Dashboard",
  "short_name": "InvestDash",
  "description": "가족 3명용 매크로/기술적/온체인 투자 상태 대시보드",
  "start_url": "/dashboard",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait-primary",
  "background_color": "#0b0b0f",
  "theme_color": "#0b0b0f",
  "lang": "ko",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

`src/app/layout.tsx` adds `<link rel="manifest" href="/manifest.webmanifest">` and iOS-specific apple-touch-icon links.

### 6.2 Service worker — shell caching only

File: `public/sw.js` (framework-agnostic; no Workbox to avoid bundling a dependency for a Phase 2 shell-only use case).

Caching strategy:
- **Install event**: precache the static shell — `/dashboard` HTML skeleton (without data), CSS bundles, the shell JavaScript, icons, manifest.
- **Fetch event**: for HTML navigations, serve the cached shell first (stale-while-revalidate). For `/_next/static/*`, cache-first with long expiry. For data endpoints and API routes, **network only — no caching**.
- **Activation**: delete old cache buckets on version bump.

**Why not Workbox**: Phase 2 shell is < 200 lines of vanilla SW code; Workbox adds ~25KB JS + opinionated abstractions that later prevent easy custom logic when Phase 3 needs a background sync for on-chain alerts.

**Offline behavior**: per plan §0.2 #5 and PRD §11.7 line 330, offline data reads are out of scope. When the SW serves the cached shell but the user is offline, a small "오프라인 — 데이터 없음" banner renders at top. Never show stale score data as current.

### 6.3 Installable flow

- **iOS Safari**: Share → Add to Home Screen. Verified on real iPhone (plan A.2 Step 12 pattern — real device, not DevTools emulation).
- **Android Chrome**: Chrome shows a "Install app" prompt automatically once the manifest + SW + https conditions are met; also installable via menu.
- **Acceptance criterion (§10)**: user installs on iOS + Android, launches from home icon, sees the cached dashboard shell during cold start, then live data streams in once the network resolves.

### 6.4 Motion-safe compliance (handoff §7 open item)

Phase 1 has systemic pre-existing shadcn animation classes that don't respect `prefers-reduced-motion`. Handoff flagged this for Phase 2 polish. Phase 2 adds `motion-safe:` prefix to the following classes as part of Step 13 UI polish (dedicated step below, not folded silently):

- Recharts animation attributes on `ScoreTrendLine` and the new price-overlay `ComposedChart` (set `isAnimationActive={motionOk}` via a `usePrefersReducedMotion` hook).
- shadcn `Popover` / `Calendar` / `Sheet` animation classes — prefix `motion-safe:` on the `animate-*` utilities in their embedded markup.

### 6.5 Signal Alignment Card a11y

PRD §10.4 lines 261–266 sets the UI invariants. A11y-specific rules:

- Outer container: `role="region"` + `aria-label="매수 시그널 얼라인먼트: 6개 중 N개 활성"`.
- 6-item grid: `role="list"`; each signal = `role="listitem"` with state conveyed as **text**, not color alone (color-blindness WCAG 1.4.1). Example: "EXTREME_FEAR — 켜짐 (VIX 37, CNN F&G 22)".
- Tooltip on hover/tap shows signal name (Korean), formula, current input values, threshold.
- Touch targets 44×44 (Phase 1 §6.2 rule) on every signal tile — this matters for the mobile 2×3 grid layout at 375px.

## 7. Data Flow + Invariants

### 7.1 Path B model preserved

Phase 1 chose Cache Components (Path B) with `cacheComponents: true` in `next.config.ts`. Phase 2 does not touch this. Every new reader follows the Phase 1 pattern:

```ts
import { cacheLife, cacheTag } from 'next/cache';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export async function getLatestTechnicalSnapshots() {
  'use cache';
  cacheTag('technical-snapshot');
  cacheLife('hours');  // matches technical cron cadence

  const supabase = getSupabaseAdminClient();
  // ...
}
```

**Admin client inside `'use cache'`** (Phase 1 tenet 3): data is family-wide; no per-user gating inside the reader; `proxy.ts` handles auth upstream. The pattern was resolved at Phase 1 commit `6aab776`; Phase 2 reuses it for every new reader.

### 7.2 Cache tags — per category (§3.1 staleness)

`src/lib/data/tags.ts` extends from 2 to 5 tags:

```ts
export const CACHE_TAGS = {
  macroSnapshot: 'macro-snapshot',     // existing
  changelog: 'changelog',              // existing
  technicalSnapshot: 'technical-snapshot',   // new
  onchainSnapshot: 'onchain-snapshot',       // new
  sentimentSnapshot: 'sentiment-snapshot',   // new
  priceHistory: 'price-history',             // new (visualization-only)
  signals: 'signals',                        // new (signal_events)
} as const;
```

Each cron endpoint invalidates only its own tag + `'signals'` (if the ingested data feeds any of the 6 signals). The signal engine invalidates `'signals'` independently after its `signal_events` upsert. No tag represents cross-category aggregate — each category evicts on its own cadence.

### 7.3 Signal engine chain

Every ingestion endpoint ends with:

```ts
const signals = await computeSignals(/* latest inputs */);
await writeSignalEvent(signals, today, SIGNAL_RULES_VERSION);
revalidateTag('signals', { expire: 0 });
```

**Idempotency**: `signal_events` PK `(snapshot_date, signal_rules_version)` + upsert. Multiple daily invocations on the same date overwrite each other deterministically — the **last computed** state wins. This is acceptable because signal inputs only change hourly at most; the last run reflects the latest ingestion state.

### 7.4 Price history — visualization-only invariant

**Critical** (PRD §8.5 line 188): `price_readings` **MUST NOT** feed the score engine. `src/lib/score-engine/*` has zero imports from `@/lib/data/prices`. This boundary is enforced by convention + §12 anti-pattern list + optional ESLint rule: `no-restricted-imports` for `@/lib/data/prices` from `src/lib/score-engine/**`.

Reader: `getPriceHistoryForAsset(ticker, endDate, days)` in `src/lib/data/prices.ts`. Feeds only `/asset/[slug]` chart client props.

### 7.5 `server-only` boundary per source

Every new `{source}.ts` fetcher carries `import "server-only"` at the top (Phase 1 §8 invariant). Every `{source}-parse.ts` is guard-free (Phase 1 Step 11.5 pattern). `scripts/backfill-*.ts` imports only from `-parse.ts` + `@supabase/supabase-js` directly + `@/lib/score-engine/*` pure modules — bypassing the `admin.ts` chain that carries `server-only`.

## 8. Schema Migrations

Phase 1 shipped 4 migrations (`0001`–`0004`). Phase 2 adds 6 more, following the existing numbering convention.

### 8.1 `supabase/migrations/0005_phase2_schema.sql`

Four new reading tables, mirroring `indicator_readings` shape (PRD §12.3 metadata fields). Each table has `model_version NOT NULL` per Phase 1 invariant (§2.2 tenet 2, snapshot immutability).

**`technical_readings`**
```sql
CREATE TABLE public.technical_readings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker           TEXT NOT NULL,
  indicator_key    TEXT NOT NULL,    -- 'RSI_14', 'MACD_12_26_9', 'MA_50', 'MA_200', 'BB_20_2', 'DISPARITY'
  asset_type       public.asset_type_enum NOT NULL,
  value_raw        NUMERIC,
  value_normalized NUMERIC,
  score_0_100      NUMERIC,
  observed_at      DATE NOT NULL,    -- daily bar date
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name      TEXT NOT NULL,    -- 'alpha_vantage' (ingestion source)
  model_version    TEXT NOT NULL,
  fetch_status     public.fetch_status_enum NOT NULL DEFAULT 'success',
  raw_payload      JSONB
);
CREATE UNIQUE INDEX technical_readings_dedup
  ON public.technical_readings (ticker, indicator_key, observed_at, model_version);
CREATE INDEX technical_readings_ticker_obs
  ON public.technical_readings (ticker, observed_at DESC);
```

**`onchain_readings`**
```sql
CREATE TABLE public.onchain_readings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  indicator_key    TEXT NOT NULL,    -- 'MVRV_Z', 'SOPR', 'BTC_ETF_NETFLOW', 'CRYPTO_FG', 'CNN_FG'
  asset_type       public.asset_type_enum NOT NULL,
  value_raw        NUMERIC,
  value_normalized NUMERIC,
  score_0_100      NUMERIC,
  observed_at      DATE NOT NULL,
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name      TEXT NOT NULL,    -- 'bitbo' | 'coinglass' | 'alternative_me' | 'cnn'
  model_version    TEXT NOT NULL,
  fetch_status     public.fetch_status_enum NOT NULL DEFAULT 'success',
  raw_payload      JSONB
);
CREATE UNIQUE INDEX onchain_readings_dedup
  ON public.onchain_readings (indicator_key, observed_at, model_version);
```

**`news_sentiment`**
```sql
CREATE TABLE public.news_sentiment (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_type       public.asset_type_enum NOT NULL,
  ticker           TEXT,             -- nullable for category-level summaries
  score_0_100      NUMERIC NOT NULL, -- normalized sentiment 0 (bearish) - 100 (bullish)
  article_count    INT NOT NULL DEFAULT 0,
  observed_at      DATE NOT NULL,
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  source_name      TEXT NOT NULL,    -- 'finnhub'
  model_version    TEXT NOT NULL,
  fetch_status     public.fetch_status_enum NOT NULL DEFAULT 'success',
  raw_payload      JSONB
);
CREATE UNIQUE INDEX news_sentiment_dedup
  ON public.news_sentiment (asset_type, COALESCE(ticker, ''), observed_at, model_version);
```

**`price_readings`** (PRD §8.5 line 186)
```sql
CREATE TABLE public.price_readings (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker           TEXT NOT NULL,
  asset_type       public.asset_type_enum NOT NULL,
  price_date       DATE NOT NULL,
  close            NUMERIC NOT NULL,
  open             NUMERIC,
  high             NUMERIC,
  low              NUMERIC,
  volume           NUMERIC,
  source_name      TEXT NOT NULL,    -- 'alpha_vantage' | 'coingecko'
  ingested_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX price_readings_dedup
  ON public.price_readings (ticker, price_date);
CREATE INDEX price_readings_ticker_date
  ON public.price_readings (ticker, price_date DESC);
```

No `model_version` on `price_readings` — it's visualization-only (PRD §8.5 line 188), not a scoring artifact.

### 8.2 `supabase/migrations/0006_signal_events.sql`

```sql
CREATE TABLE public.signal_events (
  snapshot_date         DATE NOT NULL,
  signal_rules_version  TEXT NOT NULL,
  active_signals        JSONB NOT NULL,       -- ["EXTREME_FEAR", "LIQUIDITY_EASING", ...]
  alignment_count       INT NOT NULL,
  per_signal_detail     JSONB NOT NULL,       -- per-signal inputs, threshold, on/off/unknown
  computed_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (snapshot_date, signal_rules_version)
);
CREATE INDEX signal_events_date
  ON public.signal_events (snapshot_date DESC);
```

### 8.3 `supabase/migrations/0007_phase2_rls.sql`

Identical pattern to Phase 1 `0002_rls_policies.sql`: every new table gets `ENABLE ROW LEVEL SECURITY`, `FOR SELECT TO authenticated USING (true)`, and write-path policies `TO service_role WITH CHECK (true)`. No per-user isolation — all family members see the same rows (§2.2 tenet 3).

### 8.4 `supabase/migrations/0008_indicator_config_additions.sql`

New rows in the (Phase 1) `indicator_config` table — a row per new indicator/signal input. Populated as seed data, not inferred at runtime. Also bumps any enum if needed (e.g. adding `'finnhub'` or `'bitbo'` to a hypothetical `source_name_enum` if Phase 1 defined one — verify at Step 1; Phase 1 used plain `TEXT` per `0001_initial_schema.sql` so no enum change needed).

### 8.5 `supabase/migrations/0009_model_version_bump_marker.sql`

Pure documentation — `INSERT` into a small `model_version_history` table (create if absent) recording the v1→v2 cutover date so the UI badge at §4.4 Step 3 can read it at runtime rather than hard-coding.

### 8.6 `supabase/migrations/0010_phase2_indexes.sql`

Query-optimized indexes discovered at Steps 7–11 implementation time. Leave empty at Step 1 authoring; populate as Step 9 readers are profiled.

## 9. Build Sequence

13 numbered Steps. Each Step is independently testable, follows the Phase 1 discipline (CLAUDE.md Trigger 1: commit → preview_start visual verification → user confirms → 5-agent review at confidence ≥80 → fix → push → advance). Steps 7.5 and 8.5 are the signal engine + signal UI card per plan C.7.5 / C.8.5, intentionally placed with fractional numbering to preserve the narrative "engine then UI" ordering.

### Step 1 — Schema migration & constants

**Scope**: apply `0005_phase2_schema.sql`, `0006_signal_events.sql`, `0007_phase2_rls.sql`, `0008_indicator_config_additions.sql`, `0009_model_version_bump_marker.sql` via Supabase MCP. Regenerate `src/types/database.ts`. Bump `MODEL_VERSION` to `v2.0.0` and introduce `SIGNAL_RULES_VERSION = 'v1.0.0'` + `TICKER_LIST_VERSION = 'v1.0.0-2026-04-23'` in `src/lib/score-engine/weights.ts`. Re-verify the top-5 US caps against current data (plan §0.2 #2 ticker-drift guard).

**Acceptance**: `npm run build` green; `supabase/types/database.ts` contains the new tables; `SELECT DISTINCT model_version FROM composite_snapshots` still returns only `v1.0.0` (no data written under v2 yet).

**Review**: CLAUDE.md Trigger 1. Mostly DDL + constant changes; small-surface review.

**Effort**: ~2h.

### Step 2 — Data source adapters

**Scope**: create `src/lib/score-engine/sources/{alpha-vantage, bitbo, coinglass, alternative-me, cnn-fear-greed, finnhub, coingecko}.ts` each paired with `*-parse.ts`. Extend `fred.ts` with `ICSA` + `WDTGAL` (daily TGA primary) fetch logic; register `WTREGEN` (weekly) as documented fallback but do not activate unless `WDTGAL` becomes unavailable (plan C.2). Every fetcher: `server-only` guard, `fetch_status` return shape matching Phase 1 `FredFetchResult`, back-off on 429/5xx for unofficial APIs. Every parser: pure, fixture-tested (Vitest) with at least one happy-path + one malformed-payload fixture.

**Acceptance**: `npm test` adds ≥ 14 new parser unit tests (2 per new source × 7 sources). Each parser rejects non-object / missing-field input gracefully (Phase 1 `parseFredResponse` pattern).

**Review**: CLAUDE.md Trigger 1. Review focuses on unofficial-API resilience (back-off, no silent error swallowing) + env-var boundary.

**Effort**: ~1 day.

### Step 3 — Technical indicator engine

**Scope**: `src/lib/score-engine/technical.ts` — pure math for RSI(14), MACD(12,26,9), MA(50), MA(200), Bollinger(20,2), Disparity. Inputs: array of daily-close numbers. Outputs: numeric indicator + `score_0_100` + optional signal flags (e.g. `macdBullishCross: boolean`) for consumption by the signal engine in Step 7.5.

**Acceptance**: known-answer unit tests — RSI threshold boundary values (29.99, 30.01, 69.99, 70.01), MACD cross detection on 3 crafted series, Disparity hits exactly `-0.25` at boundary. 12+ new tests.

**Review**: CLAUDE.md Trigger 1. Math correctness verified against TA-Lib reference values for the same fixtures.

**Effort**: ~1 day.

### Step 4 — On-chain indicator engine

**Scope**: `src/lib/score-engine/onchain.ts` — pure normalizers for MVRV Z (PRD §9.3 piecewise), SOPR (PRD §9.4), Crypto F&G passthrough (inverted), ETF flow normalization (net flow / circulating supply standard-deviated 90d). Output shape matches `technical.ts` for consistent downstream wiring.

**Acceptance**: boundary unit tests for each normalizer. 8+ new tests.

**Review**: CLAUDE.md Trigger 1.

**Effort**: ~0.5 day.

### Step 5 — News sentiment module

**Scope**: `src/lib/score-engine/sentiment.ts` — Finnhub passthrough + CNN F&G weighted combine. `score_0_100` + article-count metadata. Capped weight per PRD §8.4 line 172 ("보조 지표로만 사용") — sentiment cannot drive composite alone.

**Acceptance**: unit test asserts capped contribution (sentiment at 0 with all else at 100 cannot drop US equity composite by more than its 10-weight).

**Review**: CLAUDE.md Trigger 1.

**Effort**: ~0.5 day.

### Step 6 — Score engine v2 + `MODEL_VERSION` bump

**Scope**: rewrite `src/lib/score-engine/composite.ts` to handle 4 categories. Per-asset weight tables per §4.2 above. Update `src/lib/score-engine/weights.ts` category structure (not just flat indicator weights). Dashboard header renders the model-version badge (§4.4 Step 3). `/asset/[slug]` trend chart renders the cutover `ReferenceLine`. Reader layer unchanged (already filters on current `MODEL_VERSION`).

**Acceptance**: a fresh dev server + manual cron trigger writes v2.0.0 rows for today. Historical v1.0.0 rows remain untouched (`SELECT snapshot_date, model_version FROM composite_snapshots` shows both versions side by side on cutover date). Dashboard renders v2; `/dashboard?date=2026-04-01` renders v1 with v1 suffix in the staleness badge.

**Review**: CLAUDE.md Trigger 1 — focus on regression: Phase 1's 108 tests must stay green.

**Effort**: ~1 day.

### Step 7 — Cron strategy v2 + GitHub Actions workflows

**Scope**: create 4 new endpoints — `/api/cron/ingest-technical`, `/api/cron/ingest-onchain`, `/api/cron/ingest-news`, `/api/cron/ingest-cnn-fg`, `/api/cron/ingest-prices` — each mirroring `ingest-macro`'s shape (CRON_SECRET check → fetch → normalize → write → revalidate). Extend `ingest-macro` to 9 FRED series + trailing signals call. Add `.github/workflows/cron-technical.yml`, `.github/workflows/cron-hourly.yml`, `.github/workflows/cron-prices.yml` per §3.3. Add `FINNHUB_API_KEY` to Vercel env (Production) and to GitHub repo Actions secrets. Manually sync `CRON_SECRET` into GitHub Actions secrets (plan §0.2 #8 — no OIDC).

**Acceptance**: local smoke test via `curl` against each endpoint; rows land in expected tables; `ingest_runs` records success for each. A single GHA workflow manual-dispatch from the Actions UI succeeds end-to-end on a preview deployment.

**Review**: CLAUDE.md Trigger 1. Focus on: (a) no endpoint missing `CRON_SECRET` Bearer check (§12 anti-pattern); (b) Alpha Vantage 5/min respected via `setTimeout` sleeps or explicit spacing; (c) GHA workflow file uses `secrets.CRON_SECRET`, not plaintext.

**Effort**: ~1–1.5 days.

### Step 7.5 — Signal Alignment Engine (plan C.7.5)

**Scope**: `src/lib/score-engine/signals.ts` — pure functions `computeSignals(inputs) → { active: SignalName[], unknown: SignalName[], perSignal: Record<SignalName, SignalDetail> }`. `src/lib/data/signals.ts` — reader (`'use cache'` + `cacheTag('signals')` + `cacheLife('hours')`) and writer (direct admin client, no cache). Every cron ingestion endpoint's trailing block calls `computeSignals` → upsert `signal_events` → `revalidateTag('signals', { expire: 0 })`. Per-asset signal mapping (§4.5) implemented as pure lookup function.

**Acceptance**: 18+ unit tests covering each signal's boundary cases (directly above/below threshold), alignment_count sum, and null/unknown propagation (§2.2 tenet 1: missing input = `null`, never `false`). Integration test: cron run with mock inputs produces expected `signal_events` row.

**Review**: CLAUDE.md Trigger 1. Focus: no hard-coded threshold outside `signals.ts`; `SIGNAL_RULES_VERSION` stored on every `signal_events` row.

**Effort**: ~1 day.

### Step 8 — Contributing Indicators UI v2

**Scope**: extend `src/components/asset/contributing-indicators.tsx` from 7 FRED indicators to 4-category grouping (macro / technical / on-chain / sentiment), each with its own sub-section + staleness badge. Dashboard hero gains per-category staleness badges (§7.2 tags). Score contribution visualization (PRD §18 line 497): stacked horizontal bar per category using Recharts `BarChart` with `role="img"` + aria-label.

**Acceptance**: dashboard at 375px viewport renders all 4 category sections with no horizontal scroll. Screen-reader traversal announces category + staleness + score per section.

**Review**: CLAUDE.md Trigger 1 + visual verification at 375px / 768px / 1280px real devices.

**Effort**: ~1 day.

### Step 8.5 — Signal Alignment UI Card (plan C.8.5, §0.5 tenet 4)

**Scope**: `src/components/dashboard/signal-alignment-card.tsx` — Client Component using shadcn `Progress` tiles (per version assumptions §0) + tooltips. Rendered in `/dashboard` **above** `CompositeStateCard` in the hero zone (plan §0.5 tenet 4 mandate). Large "N/6" display typography; 6-tile grid (mobile 2×3, desktop 3×2) with green/grey/amber state; hover/tap tooltip with signal name, formula, current inputs, threshold. Badge ladder: `alignment_count ≥ 3` yellow "과거 평균 매수 타이밍 조건 충족" / `≥ 5` green "역사적 최적 매수 구간" / `≤ 1` grey "대기 구간". Disclaimer strip at bottom: "실제 자산 배분은 본인 판단입니다. 모델은 과거 평균 패턴 기반 확률적 판단 도구입니다" (PRD §13.2 자문 금지 준수). `/asset/[slug]` variant using per-asset signal mapping (§4.5). Date-nav integration: `?date=` param reads `signal_events` for that day; if `signal_rules_version` differs from current, render "규칙 전환일" badge.

**Acceptance**: all 3 protected routes surface the card when applicable. A11y: `role="region"` + `role="list"` + text-conveyed state (§6.5). Touch targets 44×44 on every tile.

**Review**: CLAUDE.md Trigger 1 + visual verification on dashboard + `/asset/us-equity` + `/asset/crypto`.

**Effort**: ~1–1.5 days.

### Step 9 — Price history layer

**Scope**: `src/lib/score-engine/sources/alpha-vantage.ts` already covers 19 AV tickers from Step 2 — extend its daily cron to also write to `price_readings` (shared fetch, two writes). `src/lib/score-engine/sources/coingecko.ts` for 3 crypto tickers. `src/lib/data/prices.ts` reader with `cacheLife('days')`. `/api/cron/ingest-prices` endpoint per §5 routing table. **No feed into score engine** (§7.4 invariant).

**Acceptance**: `SELECT DISTINCT ticker FROM price_readings ORDER BY ticker` returns exactly the 22 tickers from §3.2. ESLint rule (if enabled) / convention guard (if not): no import of `@/lib/data/prices` from `src/lib/score-engine/**`.

**Review**: CLAUDE.md Trigger 1.

**Effort**: ~0.5 day.

### Step 10 — Price overlay chart

**Scope**: `src/components/asset/score-price-overlay.tsx` — Client Component wrapping Recharts `ComposedChart` with `LineChart` (score, left axis) + `LineChart` (price, right axis). Shared `Tooltip` showing score + price + Δ since selected date. 44×44 legend targets. `motion-safe:` prefix on animation classes (§6.4). PRD §11.6 line 312 annotation "그때 점수 72점 → 이후 30일 +2.3%" computed from `price_readings` diff at render time.

**Acceptance**: `/asset/us-equity?date=2026-05-01` (sample post-deploy date) renders both lines on the same chart; hover coordinates align; mobile 375px fits without horizontal scroll.

**Review**: CLAUDE.md Trigger 1 + visual verification.

**Effort**: ~1 day.

### Step 11 — 180-day history extension

**Scope**: extend `src/lib/utils/asset-slug.ts` / `src/components/layout/date-picker.tsx` clamp floor from 30d to 180d per PRD §11.6 line 308. Phase 1 `PROJECT_EPOCH = 2026-01-01` already permits this — the clamp was a Phase 1 safety. Run `scripts/backfill-snapshots.ts` extended to 180 days under `v2.0.0` (post-Step 6 cutover) if desired, respecting AV daily budget (180 days × 19 tickers is NOT 180-day replay; daily OHLC is fetched once covering 5y, local indicator compute replays are cheap). Alpha Vantage budget audit confirms safety.

**Acceptance**: dashboard date picker extends floor to `max(PROJECT_EPOCH, today - 180)`. `/dashboard?date={180d-ago}` renders real data (after backfill completes) or `NoSnapshotNotice` with closest-earlier link otherwise.

**Review**: CLAUDE.md Trigger 1.

**Effort**: ~0.5 day.

### Step 12 — PWA shell

**Scope**: `public/manifest.webmanifest` (§6.1). `public/sw.js` (§6.2 — vanilla shell caching). Icons at `public/icons/{192,512,maskable-512}.png`. `src/app/layout.tsx` registers the SW via a small `<script>` tag (`navigator.serviceWorker.register('/sw.js')`). iOS apple-touch-icon links.

**Acceptance**: Lighthouse PWA score ≥ 90 on production URL. Real iPhone + real Android: "Add to Home Screen" works, launched-from-home icon loads cached shell in < 1s, online state then streams data.

**Review**: CLAUDE.md Trigger 1 + manual device test (plan A.2 Step 12 pattern — real device, not DevTools).

**Effort**: ~1 day.

### Step 13 — Phase 2 deploy + smoke test + UI polish

**Scope**: add `FINNHUB_API_KEY` to Vercel Production env. Verify all GHA workflows trigger manually. Run Step-13 smoke matrix (every PRD §18 Phase 2 bullet + every PRD §16.3 acceptance row). Fold in handoff §7 open items: ThemeToggle + SignOutButton `size-9` → `size-11`, Phase 1 §5 routing table documentation sync, header "오늘의 투자 환경" desktop route-branch, `motion-safe:` on residual shadcn animation classes.

**Acceptance**: the §10 acceptance matrix below is fully green.

**Review**: CLAUDE.md Trigger 2 (feature completion — Phase 2 is a feature-unit). 5-agent review over the full Phase 2 diff, not just the tip commit.

**Effort**: ~1 day.

**Total Phase 2 effort**: ~11–14 developer-days across 13 Steps. Each Step individually testable + reviewable. Step ordering ensures every N's acceptance can be verified before N+1 begins (Phase 1 discipline).

## 10. Acceptance Criteria

Map PRD §18 Phase 2 bullets + PRD §16.3 to concrete, verifiable evidence. Extends Phase 1 blueprint §10.

### 10.1 PRD §18 Phase 2 mapping

| PRD §18 bullet | Proving evidence |
|----------------|------------------|
| RSI, MACD, 이동평균선 반영 | Step 3 unit tests green (RSI thresholds, MACD cross, MA). `technical_readings` table populated for 12 AV tickers × 6 indicators daily via Step 7 cron (post 2026-04-25 KR carve-out). |
| BTC MVRV / SOPR 반영 | Step 4 unit tests. `onchain_readings` populated hourly via Step 7 `/api/cron/ingest-onchain`. |
| 뉴스 센티먼트 보조 레이어 | Step 5 module + capped-weight test. `news_sentiment` populated hourly. Sentiment contribution ≤ 10 weight at US equity. |
| 점수 기여도 시각화 | Step 8 `ContributingIndicators` v2 renders 4-category grouped bars. Real-device render at 375px + 768px + 1280px. |
| 가격 히스토리 레이어 (§8.5) | Step 9 `price_readings` populated for 15 tickers (12 AV + 3 CoinGecko, post 2026-04-25 KR carve-out). Zero import of `@/lib/data/prices` from `src/lib/score-engine/**` (convention / ESLint). |
| 히스토리 뷰에 가격 오버레이 (§11.6 Phase 2) | Step 10 `ComposedChart` on `/asset/[slug]`. Hover tooltip shows score + price + Δ. |
| PWA 대응 (§11.7 이연 항목) | Step 12 Lighthouse PWA ≥ 90. Real iPhone + Android install success. |
| 매수 타이밍 시그널 엔진 (§10.4) | Steps 7.5 + 8.5. 18+ signal unit tests green. `SignalAlignmentCard` renders above `CompositeStateCard` on dashboard. `signal_events` populated at every cron invocation. |

### 10.2 PRD §16.3 Phase 2 수용 기준 mapping

| §16.3 criterion (line) | Proving evidence |
|-----------------------|------------------|
| 최소 2개 이상의 기술적 지표(RSI, MACD)가 적용된다 (line 468) | `SELECT DISTINCT indicator_key FROM technical_readings` returns at least `RSI_14`, `MACD_12_26_9`, `MA_50`, `BB_20_2`, `DISPARITY`. **MA_200 is structurally null at Phase 2** because the free Alpha Vantage `TIME_SERIES_DAILY` `outputsize=compact` returns only 100 daily bars (the previous `outputsize=full` was moved to AV premium 2026-04-25); MA_200 needs 200 bars and falls through to null per §2.2 tenet 1, with Disparity (which divides by MA_200) doing the same. The remaining five indicators populate normally. |
| BTC에는 최소 1개 이상의 온체인 지표(MVRV 또는 SOPR)가 적용된다 (line 469) | `onchain_readings.asset_type = 'crypto' AND indicator_key IN ('MVRV_Z', 'SOPR')` returns daily rows. BTC composite under `MODEL_VERSION=v2.0.0` shows non-zero on-chain sub-score contribution. |
| 나머지 Phase 2 기준은 본 블루프린트 §10에서 정의 (line 470) | This mapping table. |

### 10.3 Operational acceptance

- **Cron reliability**: 7 consecutive days of green GHA + Vercel Cron runs. Failures emit GHA email notifications (plan §0.2 #8).
- **Alpha Vantage rate-limit headroom**: 7-day rolling AV call count ≤ 25/day. Monitor via `ingest_runs` where `source_name = 'alpha_vantage'`.
- **Signal Alignment Card rendered on all 3 protected routes** (plan §0.5 tenet 4 mandate). Dashboard = 6-signal US variant. `/asset/[slug]` = per-asset mapping (§4.5). `/changelog` = signal-transition rows when a signal fires/unfires.
- **PWA installable confirmed** on real iOS Safari + Android Chrome (not DevTools only).
- **Family-only access** — Phase 1 invariant preserved. Anon `supabase-js` client returns 0 rows for all new tables (RLS). `proxy.ts` unchanged.

## 11. Risks + Mitigations

| Risk | Severity | Mitigation | Owner |
|------|----------|------------|-------|
| Alpha Vantage 25/day rate limit (PRD §17, plan §0.2 #2) | High | Batch `TIME_SERIES_DAILY` to 12 calls/day with 15s sleeps (5/min). Combined with 5 AV NEWS_SENTIMENT calls = 17/25 daily, 8 calls headroom for manual backfill. Compute RSI/MACD/MA/Bollinger/Disparity locally. Upgrade to Twelve Data (800/day free) triggers Phase 3 re-plan. | Dev |
| BGeometrics 8/hr free quota (MVRV_Z, SOPR) | High | `retryOnRateLimit: false` in `bitbo.ts` so a single 429 doesn't burn remaining quota. 429 propagates to `fetch_status: 'error'` with tagged audit message; UI staleness gate handles the gap (§3.1, tenet 1). Phase 3 migration to Glassnode (~$29/mo) for production-grade reliability. | Dev + monitor |
| Farside HTML-scrape BTC ETF flow — silent layout change | High | `coinglass-parse.ts` split rejects off-schema payloads. Tolerant date parser supports both `Mon DD, YYYY` (legacy CoinGlass shape) and `DD Mon YYYY` (Farside shape) plus parenthesized accountancy negatives. Per-category staleness badge + 7-day 0-success hard-fail banner. | Dev + monitor |
| alternative.me | Generally stable | Staleness badge sufficient. | — |
| CNN Markets Data JSON | Highest uncertainty (no contract at all) | Staleness badge + fallback: if CNN F&G input missing, `EXTREME_FEAR` signal evaluated on VIX alone — **not** silently `false` (tenet 1, §4.5 null handling). | Dev |
| GitHub Actions 5-min cron precision drift (plan §0.2 #8) | Medium | 2× TTL staleness policy absorbs a missed hourly run. Hard-fail banner only at 7 consecutive days. | Ops |
| `MODEL_VERSION` greenfield cutover visual discontinuity | Medium | Explicit "모델 전환일" badge + `ReferenceLine` vertical on trend chart (§4.4 Step 3–4). Tooltip explains v1→v2 change. Users see the seam, don't misread it as a data bug. | Dev |
| `CRON_SECRET` drift between Vercel + GitHub secrets (plan §0.2 #8) | Medium | Manual sync checklist in Step 7 commit message. Rotation = two-step coordinated update; any mismatch surfaces as 401 on the GHA run side. | Ops |
| `FINNHUB_API_KEY` free tier 60/min — sentiment spike may throttle | Low | Hourly cron × 4 asset types × 1 request = 4/hr, well under. | — |
| iOS PWA install path differs from Android (no auto-prompt, requires Share → Add to Home) | Low | Step 12 smoke test covers both. Document in-app help tooltip: "iOS: Share → Add to Home Screen". | Dev |
| Ticker-drift silent code edit (plan §0.2 #2) | Medium | `TICKER_LIST_VERSION` constant (§2.3). Replacement requires bumping the version + blueprint revision. Anti-pattern in §12. | Dev |
| `SIGNAL_RULES_VERSION` missed on an insert (breaks historical replay) | High | `signal_events` PK is `(snapshot_date, signal_rules_version)` — NOT NULL enforced at DB level, insert fails fast rather than silently defaulting. | Dev |
| Price history reader imported into score-engine (§7.4 violation) | High | `no-restricted-imports` ESLint rule + code review checklist. Snapshot immutability also enforces: composite doesn't even know prices exist. | Dev |
| Service Worker caching an old shell past a deploy | Medium | SW version bump on every deploy (`CACHE_VERSION` constant in `sw.js`). Activation deletes old caches. | Dev |
| Phase 3 ECOS API for KR equity (currently null at Phase 2) | Medium | KR equity technical category is null at Phase 2 because Alpha Vantage free tier rejects every KOSPI/KOSDAQ symbol format (see §3.2 carve-out). `aggregateTechnical('kr_equity')` returns null, surfaced in `missingCategories` per §2.2 tenet 1. Phase 3 candidate: ECOS (한국은행 OpenAPI) or Yahoo Finance scrape. | Dev |

## 12. Trade-offs

Numbered list following Phase 1 §11 / §12 style. These are decisions made knowing their downside — not accidental debt.

1. **Signal engine coexists with composite score, not replaces it** — The composite answers "how does the model see the market today?" (plan §0.5 tenet 4). Signal alignment answers "how many independent buy conditions are firing simultaneously?". They're complementary, not redundant; the UI puts signal first for actionability.

2. **Greenfield v2 cutover vs replay backfill** (plan §0.2 #9) — Replay against `raw_payload` is theoretically possible (Phase 1 `raw_payload` preservation was explicitly for this — blueprint v2.3 trade-off #6). Rejected because Bitbo/CoinGlass historical availability is unreliable (unofficial APIs). A failed replay produces dangerously-looking "v2 historical" data that's actually reconstructed from incomplete sources. Cost of the trade-off: 30-day v1 history stays v1, visible discontinuity at cutover date — mitigated by the cutover badge + `ReferenceLine`.

3. **Three on-chain sources vs consolidation** (plan §0.2 #7) — Rejected "consolidate via CoinGecko" because CoinGecko doesn't provide MVRV Z / SOPR / ETF flow. Each of Bitbo / CoinGlass / alternative.me / CNN F&G is a specialist source for its exact domain. Cost: 4 ingestion paths instead of 1, 4 staleness badges, 4 potential failure surfaces. Benefit: specialist data quality, no inferior fallback.

4. **Endpoint-per-ingestion-type + workflow-bundling at the runner** (plan §0.2 #8) — Rejected "one mega-endpoint that calls all 4 APIs" because one API's 500 would fail the others via exception propagation. Current shape: endpoint isolation (failure of onchain fetch doesn't kill news sentiment) + GHA workflow calls 3 endpoints sequentially in one runner invocation (minute savings). Cost: 4 endpoint files instead of 1. Benefit: error isolation + clear per-category `ingest_runs` logs.

5. **Ticker list frozen at blueprint authoring + `TICKER_LIST_VERSION` drift constant** (§2.3, §3.2) — Top-5 US caps change over time; silent code edits are forbidden. Any ticker swap requires a `TICKER_LIST_VERSION` bump + a documented blueprint revision. Cost: operational friction for a ticker swap. Benefit: historical `price_readings` / `technical_readings` rows' provenance is tied to a frozen list; a silent swap would poison historical comparisons.

6. **`SIGNAL_RULES_VERSION` independent from `MODEL_VERSION`** (§2.3, plan C.1) — Signal threshold tuning ("lower `ICSA` threshold from 300K to 280K") is a different cadence from composite weight tuning ("US equity macro weight 45 → 40"). Composite bumps are rarer but bigger; signal bumps are more frequent and surgical. Keeping them independent avoids a composite bump being forced by a signal tune or vice versa.

7. **US equity valuation sub-category at weight 10 is folded into sentiment until Phase 3** — PRD §10.1 specifies "밸류에이션: 10" but Phase 2 has no dedicated valuation module. The 10 weight is temporarily absorbed into the sentiment layer at neutral 50. Cost: the US equity composite slightly over-weights sentiment by ~10 points until Phase 3. Benefit: Phase 2 ships without waiting for a valuation data-source decision (Shiller P/E? FRED `SP500PE`? Alpha Vantage fundamentals?). Documented here so the Phase 3 blueprint can unambiguously split it out.

8. **Admin client inside `'use cache'`** — Phase 1 trade-off preserved (§2.2 tenet 3). Not re-litigated.

9. **Path B Cache Components** — Phase 1 choice preserved (§7). Not re-litigated.

10. **PWA shell only, no offline data** (plan §0.2 #5) — The offline data story (cache composites + signals + price history for last 30d for read-only offline viewing) is tempting but out of scope. Cost: if the user's Wi-Fi drops mid-flight, the installed app shows "오프라인 — 데이터 없음" banner. Benefit: Phase 2 PWA ships in 1 day not 5; no IndexedDB / background sync surface to regress.

11. **Vanilla service worker, not Workbox** (§6.2) — Workbox adds ~25KB JS for an abstraction we barely use. Vanilla SW = ~200 lines, no dependency, future-flexible.

12. **No OIDC for GHA → Vercel** (plan §0.2 #8) — Manual `CRON_SECRET` sync across two secret stores. Cost: a rotation = two-step coordinated update. Benefit: no OIDC setup complexity; GHA Actions secrets + Vercel env is the simplest credential surface for a family project.

## Anti-patterns (Do NOT)

Phase 1 anti-patterns (plan §0.3) carried forward, plus Phase-2-specific additions. Every one of these is a review-blocking finding at CLAUDE.md Trigger 1/2.

**From Phase 1 (preserved):**

- **Do NOT** create `middleware.ts` — file is `src/proxy.ts` (Next 16.2 rename).
- **Do NOT** call `cookies()` / `headers()` / `connection()` inside any `'use cache'` scope.
- **Do NOT** import `server-only`-guarded modules (`admin.ts`, `fred.ts`, new `{source}.ts`) from `scripts/` run under `npx tsx` — use the `-parse.ts` split.
- **Do NOT** recompute composite score on request — always read from `composite_snapshots` by `(asset_type, snapshot_date, model_version)`.
- **Do NOT** skip the `CRON_SECRET` Bearer check on any cron endpoint. The check uses `timingSafeEqual` (Phase 1 `verifyCronSecret` helper).
- **Do NOT** emit investment-advice CTAs — PRD §13.2 bans 추천/목표가 language. Signal Alignment Card disclaimer is non-optional.
- **Do NOT** amend already-pushed commits — new commits only (CLAUDE.md workflow).
- **Do NOT** skip the 5-agent code review on Step completion or Phase 2 feature completion (CLAUDE.md Trigger 1/2).
- **Do NOT** silently swallow data-source errors. Every failure surfaces via `StalenessBadge`, `ingest_runs`, or hard-fail banner. Tenet 1 (§2.2).

**Phase 2-specific (new):**

- **Do NOT** feed `price_readings` into the score engine. PRD §8.5 line 188. Enforced by convention + optional ESLint `no-restricted-imports`. §7.4 invariant.
- **Do NOT** hard-code signal thresholds anywhere outside `src/lib/score-engine/signals.ts`. The signal module is the single source of truth; thresholds scattered across UI components produce drift.
- **Do NOT** insert `signal_events` rows without `signal_rules_version` — DB NOT NULL constraint enforces this, but writers must supply it explicitly. Defaulting to `'unknown'` is prohibited.
- **Do NOT** default a missing-input signal to `false`. `null`/unknown is the correct state (§4.5, tenet 1). Rendering unknown as "signal off" masks an upstream failure.
- **Do NOT** edit the 22-ticker list in `src/lib/score-engine/weights.ts` without bumping `TICKER_LIST_VERSION`. Silent swaps poison historical `technical_readings` / `price_readings` provenance.
- **Do NOT** ship a new cron endpoint without ending it in `signals.compute()` + `revalidateTag('signals', { expire: 0 })` **if** any of its ingested indicators feeds one of the 6 signals. Price-only ingestion is the only exempt category (visualization-only per §7.4).
- **Do NOT** bundle all 4 hourly cron calls into a single `/api/cron/ingest-hourly` mega-endpoint. Keep one endpoint per category (§12 trade-off 4).
- **Do NOT** put `CRON_SECRET` or any API key into a GitHub Actions workflow file as plaintext. Use `${{ secrets.CRON_SECRET }}`.
- **Do NOT** assume on-the-hour GHA cron precision. Design readers tolerant of ±10 min drift (§3.3).
- **Do NOT** cache API / data endpoints in the service worker. Shell only. Stale data masquerading as current violates tenet 1.
- **Do NOT** add `motion-safe:` prefix in isolation — each Recharts / Popover / Calendar / Sheet animation needs the prefix; half-done is cosmetically worse than untouched (§6.4).
- **Do NOT** render `SignalAlignmentCard` below `CompositeStateCard`. The hero-zone ordering is an explicit tenet-4 mandate, not an aesthetic preference.

---

*Implementation proceeds against this document. When reality drifts, update this blueprint first, then write code.*
