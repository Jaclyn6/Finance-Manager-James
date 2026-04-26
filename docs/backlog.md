# Backlog

Live list of deferred items. Triaged manually — not auto-generated. Each
entry includes WHY it's deferred and a pointer to the surface where it
will eventually land. Items move into a Phase blueprint when a phase
picks them up.

---

## UI / UX polish

### Distinguish 일시 vs 영구 "데이터 부족" on signal tiles

**Where it lives now:** `src/components/dashboard/signal-alignment-card.tsx`
+ `src/lib/utils/signal-labels.ts::describeSignalSituation`. Both
treatments currently render the same `데이터 부족` pill regardless of
whether the gap is recoverable.

**The gap (verified 2026-04-26 against `signal_events.snapshot_date =
2026-04-25`):**

- **Permanent until Phase 3 budget decision** — DISLOCATION
  (`spyDisparity`/`qqqDisparity` null) and MOMENTUM_TURN (SPY MACD
  history empty). Both blocked by Alpha Vantage free tier's
  `outputsize=compact` 100-bar limit; the 200-day MA / sustained MACD
  windows never have enough history.
- **Transient (recovers on next cron)** — EXTREME_FEAR (CNN F&G
  occasionally null from scraper), LIQUIDITY_EASING (TGA 20-day SMA null
  during early backfill).

**Proposed treatment:** add a per-signal `unknownReasonKo` field (or a
discriminated `unknownKind: "transient" | "permanent"`) so the tile can
render `데이터 부족 (수집 중)` vs `데이터 부족 (Phase 3 예정)` without
collapsing the two failure modes. Keep the engine pure — the
classification belongs in the UI module (`signal-labels.ts`), keyed off
the SignalName + which input is null.

**Why deferred:** small UX gain compared to Phase 3's regime/portfolio
work. Revisit during Phase 3 §UI step or as part of the post-Phase-3
overall review.

---

## Phase 2 carry-overs (also in `docs/phase2_acceptance_matrix.md` PARTIAL rows)

- **MA(200) + Disparity permanently null** until Phase 3 (AV Premium
  $50/mo or alternate daily-bar source). Glossary already discloses
  this; signal tiles do not.
- **KR equity 2/6 categories null** until Phase 3 (ECOS API or scraper
  decision pending — see handoff §5).
- **BGeometrics 8/hr free quota** — `cron-hourly` partial 429s are
  expected; `fetch_status:"error"` propagates correctly. Phase 3 may
  swap to Glassnode ($29/mo) for stable MVRV/SOPR.

## Phase 3 blueprint blockers (RESOLVED 2026-04-26 — IMPLEMENTED in 3.0)

All three decisions landed in Phase 3.0 (`docs/phase3_0_data_recovery_blueprint.md`):

1. **Onchain (MVRV/SOPR)** — Stayed on BGeometrics free. Solved
   via **cron split** (`cron-onchain.yml` every 4h, 12/day under
   15/day cap) instead of paid tier. Step 5 of Phase 3.0.
2. **Daily price bars (MA_200 / Disparity / MOMENTUM_TURN)** —
   **Twelve Data primary + Yahoo Finance fallback** chain shipped
   in `daily-bar-fetcher.ts`. Free `TWELVEDATA_API_KEY` registered
   in `.env.local`, GH secrets, Vercel Production. Steps 1-3.
3. **KR equity source** — **Yahoo Finance** wins as the
   only-free option that serves `.KS` / `.KQ` symbols without
   broker account / desktop COM / Python dependency. KIS API
   rejected (broker account onboarding); pykrx deferred as a
   Phase 3.x fallback if Yahoo proves unreliable. Steps 3-4.

## Phase 3.x DART / ECOS adapters (committed, not in 3.0)

User confirmed 2026-04-26: DART and ECOS WILL be implemented as part
of Phase 3 scope, just NOT in 3.0. Both API keys provisioned ahead
of time.

| Adapter | Phase | Why | Key state |
|---|---|---|---|
| **ECOS** (한국은행 OpenAPI) | Phase 3.1 | Regime classification engine needs Korean macro inputs (BOK rate, KR 10Y, M2, KRW/USD) to define KR-specific market regimes. ECOS adapter ships alongside the regime engine. | Not yet provisioned. Will request when Phase 3.1 starts (free key, https://ecos.bok.or.kr/api/, 100k req/day). |
| **DART** (전자공시 OpenAPI) | Phase 3.2 | Portfolio overlay needs P/E and P/B for held KR equities. DART exposes EPS / BPS via 정기보고서 endpoint; the adapter computes the ratios and feeds the KR `valuation` category, completing KR's 6/6 category coverage. | **Provisioned 2026-04-26**: `DART_API_KEY` in `.env.local`, GH secrets, Vercel Production env. Live smoke tested (Samsung 005930 임원공시 list returned 200). |

## Data-pipeline reliability

### Market-holiday calendar integration (option 3)

**Where it lives now:** `src/app/api/cron/ingest-technical/route.ts`
weekend short-circuit (commit `c19bd72`, Phase 3.0.1 hotfix).

**The gap:** the current weekend skip uses
`new Date().getUTCDay() === 0 || === 6` — covers Sat/Sun only.
Market-specific holidays (NYSE: ~9-10 days/yr; KRX: ~10 days/yr,
including Lunar New Year, Chuseok, etc.) still pass through and write
`fetch_status='error'` rows that null out the technical category for
those days exactly the same way weekends did before the hotfix.

**Proposed treatment:** integrate a market-calendar source so
holiday detection matches actual closures. Three candidate sources:

1. **Polygon.io `/v1/marketstatus/upcoming`** — paid (free tier
   has rate limits but probably enough for one daily call).
2. **Alpha Vantage `/query?function=MARKET_STATUS`** — free, but
   returns "open/closed now" not a forward calendar; would need
   to be called at the moment of the cron each day.
3. **Hardcoded annual list** — small JSON keyed by `(market, year,
   date)` checked into the repo; manual update once a year.
   Zero new dependency, zero quota.

Recommendation: **option 3** (hardcoded annual list) for the same
reasons the project chose Yahoo over KIS in Phase 3.0 — no broker
account / no quota / no auth surface. The annual update is a
calendar entry, not engineering.

**Why deferred:** weekend skip already covers ~52 × 2 = 104 days/yr
out of the ~120 total market-closed days. Holiday coverage adds the
remaining ~16 days/yr — small marginal gain compared to a clean
Phase 3.1 entry. Revisit after Phase 3.1.

**Acceptance check when done:**
- A backtest run that includes 2026-12-25 (Christmas Day) shows
  a populated technical category (carrying forward 2026-12-24).
- `ingest-technical` audit row on a US holiday says
  `error_summary: "holiday_skip: NYSE closed, no write"` (same
  shape as the current `weekend_skip` marker).

## Tech-debt nibbles (low priority)

- `button.tsx` `icon-lg` (size-9) variant still exists; new
  `icon-touch` (size-11) is the migration target.
- `tw-animate-css` v1.4 missing prefers-reduced-motion handling for
  Sheet/Popover/Tooltip slide-ins. Add a CSS layer if motion sensitivity
  reports come in.
- `indicator-glossary.test.ts` jargon banlist has BB_20_2 σ exception —
  keep the test scoped to `transparency` fields only (do not widen).
