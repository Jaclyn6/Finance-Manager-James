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

## Phase 3 blueprint blockers (RESOLVED 2026-04-26)

User decisions:

1. **Onchain (MVRV/SOPR)** — **DECISION: stay on BGeometrics free (8/hr).**
   Reject Glassnode $29/mo. Accept the 429 reality; smooth via cron
   pacing if possible. `cron-hourly` continues with the existing
   `retryOnRateLimit:false` + `fetch_status='error'` propagation.
2. **Daily price bars (MA_200 / Disparity / MOMENTUM_TURN)** —
   **DECISION: free alternative source, no AV Premium.** Candidates:
   Twelve Data (800/d free, 5y history), Stooq CSV (free, no key),
   Yahoo Finance via yfinance (free but aggressive rate limiting).
   Phase 3.0 Step 1 picks the winner from a parallel-research pass.
3. **KR equity source (technical + valuation categories)** —
   **DECISION: must NOT remain null.** Try ECOS API + Yahoo first; if
   neither holds, evaluate Korean brokerage open APIs (KIS / Kiwoom /
   NH / Mirae) and `pykrx` (KRX-direct Python wrapper, no key).
   Phase 3.0 Step 2 picks the winner.

These three decisions unlock Phase 3.0 = "Data Source Recovery"
sub-phase, which closes the PARTIAL acceptance rows in
`docs/phase2_acceptance_matrix.md` BEFORE the four big Phase 3 product
modules (regime classification, portfolio overlay, personalization,
backtest UI) are scoped.

## Tech-debt nibbles (low priority)

- `button.tsx` `icon-lg` (size-9) variant still exists; new
  `icon-touch` (size-11) is the migration target.
- `tw-animate-css` v1.4 missing prefers-reduced-motion handling for
  Sheet/Popover/Tooltip slide-ins. Add a CSS layer if motion sensitivity
  reports come in.
- `indicator-glossary.test.ts` jargon banlist has BB_20_2 σ exception —
  keep the test scoped to `transparency` fields only (do not widen).
