# Phase 3.1 — Regime Classification + KR Macro Boost (architecture blueprint)

**Status**: DRAFT 2026-04-27 (Phase 3.0 closed, Phase 3.4 closed; ECOS API key provisioned 2026-04-27)

**Companion docs**: PRD §18 Phase 3.1 row, `docs/phase3_0_data_recovery_blueprint.md` (FRED adapter pattern), `docs/phase3_4_backtest_blueprint.md` (`WEIGHTS_REGISTRY` + cutover machinery), `docs/backlog.md` (market-holiday calendar follow-up).

**Authoritative scope decisions** (user, 2026-04-27):
1. Big-scope regime engine — not just "ECOS as another input", but an explicit market-regime classifier + dynamic per-regime weights.
2. ECOS routing **A + C combined** — both `regional_overlay` extension AND `macro` category augmentation for kr_equity.
3. Korean market gets a KR-specific score system that reflects 한국시장의 특수성 (FX sensitivity, foreign-flow regime, US-KR rate differential).
4. **MODEL_VERSION = v2.1.0** cutover at Phase 3.1 close. `WEIGHTS_REGISTRY["v2.1.0-baseline"]` registered alongside the existing `v2.0.0-baseline`.

---

## §0 — Tenets carried forward

1. **Single-write-path engine**: Phase 3.4's tenet — every score in the DB is computed by exactly one engine path (no "regime engine" branch that bypasses `computeCompositeV2`). The regime layer wraps the existing engine, doesn't fork it.
2. **Loud failure on missing inputs**: a regime that the classifier can't determine renders as `regime_label = null` + `regime_confidence = null`, never silently falls back to the "previous" regime. The cron audit row records why.
3. **Backtest-replayable**: every regime decision is reproducible from the historical inputs available at that snapshot date — no live-API calls during replay. The classifier is a pure function of `(macro inputs, technical inputs)` snapshotted at that date. This means `composite_snapshots.regime_label` is part of the audit trail and can be re-derived from `contributing_indicators` for backtest.
4. **No silent global side-effects**: the dynamic-weight machinery only kicks in when `regime_label != null`. If classification fails for a day, the engine falls back to the static `WEIGHTS_REGISTRY["v2.1.0-baseline"]` weights (not v2.0.0 — see §4 cutover).
5. **KR specificity is additive, not replacing**: kr_equity gets new inputs and a new weighting view, but the existing US/global asset paths stay numerically unchanged through the v2.1.0 cutover (drift = 0 for non-KR asset types is an acceptance criterion, mirroring Phase 3.4 §5 #2).

---

## §1 — Problem statement

**The user observation** (2026-04-27): KR equity currently runs the same global-FRED `macro` categorization as US equity. Korea's market is structurally different — heavily FX-sensitive (KRW/USD), driven by foreign-flow under risk-off / risk-on regimes that differ from S&P regimes, and reactive to BOK rate decisions that are decoupled from Fed cycles. Wrapping it in the same `macro` category with US weights misses the actual signal.

**The product opportunity**: build a regime engine that (a) labels every snapshot day with one of ~5 market regimes (risk-on / risk-off / 긴축 / 완화 / 전환), (b) reweights category contributions per regime, and (c) gives kr_equity its own input layer (BOK rate, KR 10Y, M2, KRW/USD, US-KR rate differential) under a Korean-tuned macro view.

**The data gap that blocks it today**: Korean macro inputs aren't in the system. ECOS (한국은행 OpenAPI) is the canonical free source; key provisioned 2026-04-27.

---

## §2 — Architecture

### 2.1 Regime engine (new layer)

`src/lib/score-engine/regime/` — new directory.

```
regime/
  classifier.ts         pure: regime label + confidence from inputs
  rules.ts              the 4-5 regime definitions + thresholds
  weight-overlay.ts     pure: regime → category-weight multiplier
  types.ts              RegimeLabel + RegimeInputs + RegimeDecision
```

**Pipeline** (one call per `composite_snapshots` write):

```
inputs (macro + technical features)
   → classifier.classify(inputs)
   → RegimeDecision { label, confidence, contributing_features }
   → weight-overlay.applyOverlay(baseline_weights, decision)
   → effective_weights
   → computeCompositeV2(effective_weights, ...)  (existing engine)
   → composite_snapshot row stamps regime_label + regime_confidence
```

The regime layer is INSERTED between the snapshot inputs and the existing weighted-sum engine. It does not fork the engine — it preprocesses the weights vector that the engine receives.

### 2.2 Regime taxonomy (provisional, finalize in §9 approval gate)

Five regimes — to be tuned during the build with backtest evidence (Phase 3.4 backtest UI exists for this).

| Label | Definition (provisional) | Primary tells |
|---|---|---|
| `risk_on_easing` | Fed cutting + VIX < 20 + SPY > MA200 | FEDFUNDS slope, VIX, SPY trend |
| `risk_on_neutral` | Stable rates + low vol + uptrend | DGS5 stable, VIX < 18 |
| `risk_off_tightening` | Fed hiking or holding hawkish + VIX > 25 | FEDFUNDS slope, VIX, T10Y2Y |
| `risk_off_recession` | Yield-curve inverted + ISM < 50 + SPY trend down | T10Y2Y, ISM proxy, SPY |
| `transition` | Mixed signals, classifier confidence < 0.6 | catch-all when no regime above clears threshold |

**KR-specific overlays**: each regime above has a KR-specific weight multiplier set tuned to Korean market behavior — e.g. `risk_off_tightening` for kr_equity weights `regional_overlay` (KRW/USD + foreign flow proxy) much higher than the US equivalent.

### 2.3 ECOS adapter (new data source)

`src/lib/score-engine/sources/ecos.ts` — mirrors the FRED adapter pattern in `src/lib/score-engine/sources/fred*`.

**Endpoint**: `https://ecos.bok.or.kr/api/StatisticSearch/{API_KEY}/json/kr/{start}/{end}/{stat_code}/{freq}/{from_date}/{to_date}`

**Series under Phase 3.1**:

| ECOS code | Series | Frequency | Used in |
|---|---|---|---|
| `722Y001` | BOK 기준금리 (Base rate) | Monthly (effective immediate) | macro (KR), regime classifier |
| `817Y002` | 국고채 10년 (KR 10Y) | Daily | regional_overlay, regime classifier (US-KR diff) |
| `101Y004` | M2 통화량 | Monthly | macro (KR) |
| `731Y001` | KRW/USD 환율 | Daily | regional_overlay (replaces FRED `DEXKOUS` for KR) |

**Failure mode**: same loud-fail pattern as FRED — if ECOS returns nothing for a day, the cron writes `fetch_status = "error"` and the regime classifier marks `confidence = 0` for any regime that depends on the missing input. Weekend skip rule (Phase 3.0.1 hotfix `c19bd72`) does NOT apply to ECOS — Korean public holidays differ from US, but the broader fix (market-holiday calendar) is in `docs/backlog.md`.

### 2.4 ECOS routing — A + C combined

**(A) `regional_overlay` extension**: today this category has FRED `DEXKOUS` (KRW/USD via FRED) + `DTWEXBGS` (broad USD index). Phase 3.1 adds KR 10Y from ECOS as a third input under the same category for kr_equity. Weight inside the category renormalizes; the category's outer weight stays `20` per `CATEGORY_WEIGHTS.kr_equity.regional_overlay` (no change to the v2.1.0 baseline).

**(C) `macro` category augmentation for kr_equity**: today every asset's `macro` input is the same FRED basket. Phase 3.1 splits kr_equity's `macro` view into a 60/40 blend of (global FRED basket, ECOS basket: BOK rate, M2, KR-US rate differential). Other asset types' `macro` view stays 100% global FRED — they don't see ECOS at all.

A is mechanical (one new input row in an existing category); C requires the engine to support per-asset-type input lists, which is a larger refactor — see §3 schema and §4 build sequence.

### 2.5 v2.1.0 cutover machinery

Built atop Phase 3.4's `WEIGHTS_REGISTRY`. Adds `v2.1.0-baseline` as a new entry; existing `v2.0.0-baseline` stays for backtest comparison (the registry is append-only by design — Phase 3.4 §2.2 tenet 3).

`v2.1.0-baseline` differs from `v2.0.0-baseline` in:
- `categoryWeights.kr_equity` rebalanced (regional_overlay weight raised, macro split with ECOS).
- Regime overlay table populated (`weight-overlay.ts` rules).
- `indicatorConfig` extended with the 4 ECOS series.

Cutover gate (mirrors Phase 3.4 §5 #2 and Phase 3.0 §6 §4.4): drift between v2.0.0-baseline and v2.1.0-baseline replay over the trailing 90 days must be:
- Non-KR asset types (us_equity, crypto, global_etf, common): **|delta| < 0.5pp** (essentially identical — the only changes for these is the regime overlay possibly fires, but if the classifier can't determine confidence ≥ 0.6 the day, baseline weights are used → expected drift = 0).
- KR equity: **delta is not capped** — the entire point is that scores change for KR. But the change must be EXPLAINABLE — the per-day deviation table on `/backtest` must let me trace each KR delta to a specific regime overlay or ECOS input.

---

## §3 — Schema changes

### 3.1 New columns on `composite_snapshots`

```sql
-- 0013_phase31_regime.sql
ALTER TABLE public.composite_snapshots
  ADD COLUMN regime_label TEXT,
  ADD COLUMN regime_confidence NUMERIC(5,4),
  ADD COLUMN regime_features JSONB;
```

- `regime_label`: nullable; one of the regimes in §2.2 or null when classifier confidence < 0.6.
- `regime_confidence`: 0.0-1.0; nullable when classifier had insufficient inputs (loud failure surface).
- `regime_features`: JSONB with the per-feature thresholds the classifier evaluated (e.g. `{"vix": 22.4, "fedfunds_slope": -0.25, "t10y2y": -0.15}`) — used by the backtest deviation table to explain regime decisions.

### 3.2 New table `regime_decisions` (audit trail)

Optional — the data is already in `composite_snapshots.regime_*` columns. A separate audit table is overkill for the Phase 3.1 first cut. If we later want regime-only backtests (Phase 3.4.1 OOS), revisit.

### 3.3 ECOS readings table

```sql
-- 0013_phase31_regime.sql (continued)
CREATE TABLE public.ecos_readings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  series_code     TEXT NOT NULL,           -- ECOS stat code, e.g. "722Y001"
  observed_at     DATE NOT NULL,
  value_raw       NUMERIC,
  value_normalized NUMERIC,
  score_0_100     NUMERIC,
  fetch_status    public.fetch_status_enum NOT NULL DEFAULT 'success',
  source_name     TEXT NOT NULL DEFAULT 'ecos',
  ingested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_payload     JSONB,
  model_version   TEXT NOT NULL
);

CREATE UNIQUE INDEX ecos_readings_series_observed_idx
  ON public.ecos_readings (series_code, observed_at);

CREATE INDEX ecos_readings_observed_idx
  ON public.ecos_readings (observed_at DESC);

ALTER TABLE public.ecos_readings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "family read all ecos_readings"
  ON public.ecos_readings FOR SELECT
  TO authenticated
  USING (true);
-- No user-side INSERT — service-role admin only.
```

(Mirrors `indicator_readings` shape but is scoped to ECOS so the cron path is independent of FRED.)

### 3.4 `model_version_history` row

```sql
INSERT INTO public.model_version_history (model_version, cutover_date, notes)
VALUES (
  'v2.1.0',
  CURRENT_DATE,
  'Phase 3.1: regime classification + ECOS macro for kr_equity. v2.0.0-baseline preserved in WEIGHTS_REGISTRY.'
);
```

---

## §4 — Build sequence (Steps 1–9)

Mirrors Phase 3.0 / 3.4 step-by-step structure. Each step ends with vitest + tsc + build green; per CLAUDE.md Trigger 1, every step's commit is followed by a Chrome-MCP visual check + 5-agent code review on the step's diff.

1. **ECOS adapter scaffold**. New `src/lib/score-engine/sources/ecos.ts` + `ecos-parse.ts` + tests. Mirrors `fred.ts` shape: `fetchEcosSeries(code, from, to)` → `{ ok | partial | error, observations, fetch_status, source_name: "ecos" }`. Server-only; 15s timeout; no-retry. Smoke-test the 4 series codes against the live API once during dev (ECOS_API_KEY in .env.local already).

2. **`ecos_readings` schema migration** (`0013_phase31_regime.sql`). Add the columns on `composite_snapshots`, create `ecos_readings`, append `model_version_history` row. Apply via Supabase MCP; regenerate `src/types/database.ts`.

3. **`ingest-ecos` cron route** (`src/app/api/cron/ingest-ecos/route.ts`). Daily; pulls each of the 4 series and upserts into `ecos_readings`. Same `verifyCronSecret` pattern as the other crons. Add `cron-ecos.yml` workflow (daily 22:30 UTC — 30min after `cron-technical` to keep AV pacing isolated).

4. **Regime classifier (pure)**. `src/lib/score-engine/regime/classifier.ts` + `rules.ts` + tests. Inputs: a snapshotted feature vector (VIX, FEDFUNDS slope, T10Y2Y, SPY trend, BOK rate, KR 10Y, etc.). Output: `RegimeDecision { label, confidence, contributing_features }`. Pure — no DB, no env. Includes a vitest suite that verifies each regime's threshold matches §2.2 and that ambiguous inputs land in `transition` not silent fallback.

5. **Weight overlay**. `src/lib/score-engine/regime/weight-overlay.ts` + tests. Pure: `applyOverlay(baseline, decision) → effective_weights`. The overlay rules are a frozen table (`RULES.ts`) — versioned with the rest of `v2.1.0-baseline` in the registry. Per-regime KR multipliers explicitly defined per asset type.

6. **`WEIGHTS_REGISTRY["v2.1.0-baseline"]` entry**. Extend `weights-registry.ts` with the new key. Update `CURRENT_WEIGHTS_VERSION` to `v2.1.0-baseline`. Update the drift snapshot test (Phase 3.4 §5 acceptance #1) to assert the new shape.

7. **ECOS aggregator + KR macro split**. `src/lib/score-engine/aggregators/ecos-macro.ts`. Reads `ecos_readings`, normalizes per the same per-indicator `IndicatorConfig` shape, returns a per-category contribution. The `macro` aggregator for kr_equity becomes a 60/40 blend of (global FRED basket, ECOS basket). Other asset types unaffected.

8. **`composite_snapshots` writer integration**. The cron(s) that write composite snapshots (`ingest-macro` + `ingest-technical` orchestration path) call the new regime classifier before computing the composite. Stamp `regime_label`, `regime_confidence`, `regime_features` on every row written from this point forward. v2.0.0-baseline rows in the past stay null on these columns (no backfill).

9. **Dashboard surface**. `/dashboard` shows the active regime label as a top-of-page chip ("현재 국면: 긴축 위험회피"). `/asset/[slug]` for kr_equity shows the regime's KR-specific weight multipliers inline so users see WHY KR's macro weighting differs from US today. `/backtest` deviation table renders `regime_label` per row so users can correlate score deltas with regime transitions.

---

## §5 — Acceptance criteria

1. **Drift = 0 for non-KR asset types** between `v2.0.0-baseline` and `v2.1.0-baseline` over the trailing 90 days, when regime classifier confidence < 0.6 (transitions to baseline weights). Verified via `/backtest` against each non-KR asset_type.
2. **KR deltas are explainable**: every KR snapshot day where `delta > 1pp` between v2.0.0 and v2.1.0 has a non-null `regime_label` AND a populated `regime_features` JSONB that maps to the per-regime overlay rule.
3. **ECOS coverage**: `ecos_readings` has ≥ 1 row per ECOS series per day for the 7 days following Phase 3.1 launch (skipping KR public holidays, which we leave for the market-holiday calendar follow-up).
4. **Regime label coverage**: ≥ 80% of the trailing 90 days carry a non-null `regime_label`. (The 20% allowance accounts for transition periods + early-data days where features are sparse.)
5. **Loud failure on ECOS outage**: a forced-fail test (mock 500 from ECOS) lands `fetch_status = "error"` rows, the kr_equity composite snapshot for that day uses the global FRED-only macro fallback, AND the dashboard regime chip shows confidence reduced not silently zeroed.
6. **Backtest replay**: a full v2.1.0-baseline replay over the prior 30 days reproduces the live `composite_snapshots.score_0_100` within 0.01pp for each kr_equity day. (Same tenet as Phase 3.4 §5 #2.)
7. **`MOMENTUM_TURN` isn't broken**: the regime overlay never zeroes the technical category, so signal alignment continues to work as before.

---

## §6 — Risks specific to Phase 3.1

| Risk | Mitigation |
|---|---|
| ECOS API undocumented quirk (series code typos, JSON envelope shape) | Smoke-test all 4 series codes during Step 1 dev. Catch parse errors loudly with adapter unit tests. |
| Regime classifier overfits to recent 90-day history | Use Phase 3.4 backtest UI to validate against a 1-year window before cutover. Backtest deviation table shows regime-by-regime delta breakdown. |
| Korean public holidays cause ECOS gaps | Same shape as US market holidays — covered by `docs/backlog.md` market-calendar follow-up. Phase 3.1 first cut just absorbs gaps via DESC LIMIT 1. |
| v2.1.0 cutover quietly changes US/global scores | Acceptance §5 #1 (drift = 0 for non-KR) is a hard gate. CI snapshot test asserts `WEIGHTS_REGISTRY["v2.1.0-baseline"].categoryWeights.us_equity` deep-equals `WEIGHTS_REGISTRY["v2.0.0-baseline"].categoryWeights.us_equity`. |
| Regime label flips daily, confusing users | The dashboard chip shows the 7-day-mode regime, not the per-day classification. Per-day labels stay in `composite_snapshots` for the audit trail. |

---

## §7 — In scope vs out of scope for 3.1

**In scope**:
- ECOS adapter + cron + 4 series.
- Regime classifier (5 regimes, classifier function, rule table).
- Weight overlay machinery.
- v2.0.0 → v2.1.0 cutover with KR rebalance + regime-aware effective weights.
- Schema columns + migration + types regen.
- Dashboard regime chip + `/asset/[slug]` KR-specific weight visualization.
- Backtest deviation table regime column.

**Out of scope (Phase 3.1.1 or later)**:
- Korean market-holiday calendar (handled in `docs/backlog.md`).
- Foreign-flow data (KRX 외국인 매매 — KRX doesn't expose this for free; KIS API would unlock it but it requires a broker account, deferred again).
- Sector regime — overall market regime only; sector-level (반도체 vs 자동차 등) deferred to Phase 3.3.
- Regime-aware signal thresholds — signals stay on `SIGNAL_RULES_VERSION = "v1.0.0"` static thresholds. Regime-conditional signal firing is a future work item.
- Mobile-specific regime chip layout — desktop only for the first cut.

---

## §8 — Approval gate (RESOLVED 2026-04-27)

User decisions:

1. **Regime taxonomy** — **5 regimes** (`risk_on_easing`, `risk_on_neutral`, `risk_off_tightening`, `risk_off_recession`, `transition`). Start safe, expand in Phase 3.1.x if backtest evidence warrants.
2. **ECOS series** — **7 series**: BOK rate (`722Y001`), KR 10Y (`817Y002`), M2 (`101Y004`), KRW/USD (`731Y001`), **KRW/JPY** (`731Y003`, new), **CPI 물가지수** (`901Y009`, monthly), **수출입 통계** (`301Y013`, monthly). The two monthly series carry forward at the daily frequency the engine consumes — same DESC LIMIT 1 pattern that already handles weekend FRED.
3. **kr_equity macro split** — **60/40** (global FRED 60% : ECOS 40%). Re-tune via WEIGHTS_REGISTRY v2.1.x if backtest shows otherwise.
4. **Regime chip placement** — **`/dashboard` top horizontal band**. Single line, mobile-friendly, no hidden state.
5. **`/regime` history page** — **INCLUDED in Phase 3.1**, made viable by adding a **Step 0 backfill** of 1-year history for ECOS + FRED + technical inputs. The page ships with a meaningful 252-day band chart from day one, not a sparse 90-day stub.

The Step-0 backfill changes the build sequence — see §9 below. Backfill is a one-shot operation; the daily cron picks up from the day after the backfill ends.

**Overfitting risk acknowledged**: regime classifier rules will be kept simple (literature-anchored thresholds, broad bands), and validated against the 1-year backfill via Phase 3.4 backtest UI before the v2.1.0 cutover. If backtest shows the classifier overfits, thresholds widen or the regime count drops to 3 before cutover — not after.

---

## §9 — Build sequence (post-approval, IN PROGRESS 2026-04-27)

Each step ends with vitest + tsc + build green. Per CLAUDE.md Trigger 1, every step's commit is followed by user-confirmed verification (smoke test or Chrome MCP visual check) + 5-agent code review on the step's diff + fix-up for confidence ≥ 80 findings.

| Step | Title | Surface | Depends on |
|---|---|---|---|
| **1** | **ECOS adapter** (pure fetch + parse) | `src/lib/score-engine/sources/ecos.ts` + `ecos-parse.ts` + tests | (none — mirrors `fred.ts`) |
| **2** | **Schema migration** (`ecos_readings` table + `composite_snapshots` regime columns) | `supabase/migrations/0013_phase31_regime.sql` + `src/types/database.ts` regen | none |
| **3** | **`ingest-ecos` cron route** + `cron-ecos.yml` (daily 22:30 UTC) | `src/app/api/cron/ingest-ecos/route.ts` + `.github/workflows/cron-ecos.yml` | Steps 1, 2 |
| **4** | **One-shot 1-year backfill script** — pulls 252 trading days of ECOS + FRED-extra + technical history into the new schema | `scripts/backfill-phase31.ts` (or `npm run backfill:phase31`) | Steps 1, 2 |
| **5** | **Regime classifier** (pure function + rule table) | `src/lib/score-engine/regime/classifier.ts` + `rules.ts` + `types.ts` + tests | none (pure) |
| **6** | **Weight overlay** (regime → category-weight multiplier) | `src/lib/score-engine/regime/weight-overlay.ts` + tests | Step 5 |
| **7** | **`WEIGHTS_REGISTRY["v2.1.0-baseline"]`** entry + `CURRENT_WEIGHTS_VERSION` bump + drift snapshot test | `src/lib/score-engine/weights-registry.ts` + tests | Steps 5, 6 |
| **8** | **ECOS aggregator + KR macro 60/40 split** | `src/lib/score-engine/aggregators/ecos-macro.ts` + tests | Steps 1, 2, 7 |
| **9** | **`composite_snapshots` writer integration** — regime classifier called pre-composite, stamps `regime_label/confidence/features` columns. **Backfill past 252 days with regime labels** (weights stay v2.0.0, score unchanged — only the new columns populate). | `src/app/api/cron/ingest-macro/route.ts` orchestration path + backfill SQL | Steps 5, 6, 7, 8 |
| **10** | **Dashboard regime chip** (top horizontal band on `/dashboard`) | `src/app/(protected)/dashboard/*` + new `RegimeChip.tsx` | Step 9 |
| **11** | **`/regime` history page** — 252-day stacked-band chart + per-regime stats (% of days, avg duration) | `src/app/(protected)/regime/page.tsx` + `regime-content.tsx` + `regime-band-chart.tsx` | Step 9 |

**Step 0** (one-time prerequisite, NOT a numbered step): set `ECOS_API_KEY` in GH repo secrets + Vercel Production env. Currently in `.env.local` only (provisioned 2026-04-27). Target: before Step 3 cron deploy.

**Cutover gate**: Step 9's regime backfill MUST stay under the §5 acceptance criteria (drift = 0 for non-KR; KR deltas explainable). If the 252-day backfill shows wild swings, the v2.1.0 cutover is held until classifier thresholds are tuned. The cutover itself is a single commit that flips `CURRENT_WEIGHTS_VERSION` from `v2.0.0-baseline` to `v2.1.0-baseline`.
