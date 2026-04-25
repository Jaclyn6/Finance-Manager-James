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

## Phase 3 blueprint blockers (must resolve before authoring)

1. **Glassnode $29/mo vs BGeometrics free** — affects MVRV/SOPR
   reliability and CRYPTO_UNDERVALUED / CAPITULATION uptime.
2. **AV Premium $50/mo vs alternate daily-bar source (Twelve Data 800/d
   free?, Yahoo Finance scrape, Polygon)** — affects DISLOCATION,
   MOMENTUM_TURN, MA(200), Disparity.
3. **KR equity source — ECOS API (free, key registration) vs Yahoo
   Finance scrape vs permanent null** — affects 2/6 KR categories.

## Tech-debt nibbles (low priority)

- `button.tsx` `icon-lg` (size-9) variant still exists; new
  `icon-touch` (size-11) is the migration target.
- `tw-animate-css` v1.4 missing prefers-reduced-motion handling for
  Sheet/Popover/Tooltip slide-ins. Add a CSS layer if motion sensitivity
  reports come in.
- `indicator-glossary.test.ts` jargon banlist has BB_20_2 σ exception —
  keep the test scoped to `transparency` fields only (do not widen).
