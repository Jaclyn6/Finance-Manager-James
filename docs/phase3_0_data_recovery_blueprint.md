# Phase 3.0 — Data Source Recovery Blueprint

**Authored:** 2026-04-26
**Scope:** Sub-phase BEFORE Phase 3 product modules (3.1 regime / 3.2 portfolio / 3.3 personalization / 3.4 backtest). Recovers data inputs that became `null` or `partial` during Phase 2 due to upstream changes (Alpha Vantage `outputsize=full` paywall, KR `.KS` ticker rejection, BGeometrics 8/hr · 15/day quota).
**Constraint:** ALL FREE sources. No Glassnode ($29/mo), no AV Premium ($50/mo), no paid Polygon/Twelve Data tier. KR equity must NOT remain null.
**Estimated effort:** 1-2 days, single session.
**Dependencies:** none — Phase 2 production stable, all decisions resolved (`docs/backlog.md`).

---

## §0 — Tenets carried over from Phase 2 blueprint

These hold for all Phase 3.0 work:

1. **Loud failure, not silent averaging** (plan §0.5 tenet 1) — when a fallback path is taken, log it in `ingest_runs`. When ALL fallbacks fail for a ticker × indicator, write `fetch_status='error'` rather than zero-fill.
2. **`server-only` invariant** — sources under `src/lib/score-engine/sources/*.ts` import no DB / no Next runtime, only `fetch`. Adapters are pure-JSON-in, pure-OHLC-out.
3. **Visualization-only price layer** (blueprint §7.4 ESLint rule) — Phase 3.0 source additions feed `technical_readings` for the score engine AND `price_readings` for visualization. Both writes use the existing shared-fetch pattern in `ingest-technical/route.ts`. No new lint rules needed.
4. **Snapshot immutability** — `composite_snapshots` rows are write-once-per-(asset_type, snapshot_date, model_version). Phase 3.0 does NOT bump `MODEL_VERSION`; the underlying inputs improve but the score engine math is unchanged. (If post-implementation backtests show the new MA_200 inputs change category scores >5pp on average, we then bump to v2.1.0 — see §6.)
5. **No new Supabase migration** unless Step 5 (cron split) requires audit columns. Default: write to existing `technical_readings` schema.

---

## §1 — Problem statement

After Phase 2 ship (commit `94ae128` + `9f3b9ef`), `docs/phase2_acceptance_matrix.md` still has 5 PARTIAL rows tied to data gaps:

| PARTIAL row | Root cause | Phase 3.0 step |
|---|---|---|
| §10.1 row 1 (RSI/MACD/MA coverage) | AV `outputsize=compact` 100 bars → MA(200) + Disparity永구 null | Step 1, 3 |
| §10.1 row 8 → already MET (commit 8261924) | — | — |
| §10.3 row 1 (cron 7-day green) | cron-onchain hits BGeometrics 15/day → daily 429 spikes | Step 5 |
| §10.3 row 4 (PWA real-device A2HS) | manual user test pending | NOT in 3.0 (operational) |
| Deferred row "KR equity 2/6 categories null" | AV rejects `.KS` tickers | Step 4 |
| Deferred row "MVRV/SOPR resilience" | BGeometrics 8/hr · 15/day | Step 5 |
| Deferred row "MA_200 + Disparity always null" | AV `compact` ceiling | Step 1, 3 |
| Deferred row "Lighthouse PWA ≥ 90 on production" | already done (94 perf, 95 a11y, 100 BP, 100 SEO) | NOT in 3.0 |

Phase 3.0 closes the **technical** rows. Lighthouse + A2HS are operational tail items that close on their own.

---

## §2 — Architecture changes

### §2.1 Source adapter additions

Two new adapters under `src/lib/score-engine/sources/`:

```
src/lib/score-engine/sources/
├── alpha-vantage.ts      (existing — kept as primary US/global, kept compact)
├── twelvedata.ts         (NEW — US/global, 5y history fallback, 800/d free)
├── yahoo-finance.ts      (NEW — KR primary + US/global tertiary fallback, no key)
├── alpha-vantage-news.ts (existing)
├── bitbo.ts              (existing — BGeometrics, kept)
├── coinglass.ts          (existing — Farside, kept)
├── finnhub.ts            (existing)
└── coingecko.ts          (existing)
```

Adapters share a common output shape so the aggregator (`src/lib/score-engine/category-aggregators.ts`) doesn't branch:

```ts
// Already used by alpha-vantage.ts; new sources must conform
export type DailyBarSeries = {
  ticker: string;
  bars: ReadonlyArray<{
    date: string;          // ISO YYYY-MM-DD
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  source_name: "alpha_vantage" | "twelvedata" | "yahoo_finance";
  fetch_status: "ok" | "partial" | "error";
};
```

### §2.2 Fallback chain in `ingest-technical/route.ts`

The cron route is the only place that knows about fallbacks. Adapters themselves never call each other.

```ts
// per-ticker fallback chain. Stops at first ok response.
async function fetchDailyBars(ticker: string): Promise<DailyBarSeries> {
  // Tier 1: Alpha Vantage (current behavior). Compact = 100 bars only.
  const av = await fetchAlphaVantage(ticker);  // existing
  if (av.fetch_status === "ok" && av.bars.length >= 200) return av;

  // Tier 2: Twelve Data (free 800/d, returns up to 5000 bars).
  // Used for non-KR tickers since we want >= 200 bars for MA(200).
  if (!isKrTicker(ticker)) {
    const td = await fetchTwelveData(ticker);
    if (td.fetch_status === "ok") return td;
  }

  // Tier 3: Yahoo Finance (no key). Always tried last for non-KR;
  // for KR, this is the PRIMARY (Tier 1 + Tier 2 are skipped).
  const y = await fetchYahooFinance(ticker);
  if (y.fetch_status === "ok") return y;

  // All tiers failed. Return loud error.
  return { ticker, bars: [], source_name: "alpha_vantage", fetch_status: "error" };
}

// KR ticker detection: ends with .KS or .KQ.
function isKrTicker(ticker: string): boolean {
  return /\.(KS|KQ)$/.test(ticker);
}
```

For KR tickers (`.KS`, `.KQ`), the chain is **Yahoo only** — AV and Twelve Data both reject KR formats. This is captured by `isKrTicker()` short-circuiting the upper tiers.

### §2.3 Cron split

Current state: `.github/workflows/cron-hourly.yml` triggers `ingest-onchain` + `ingest-cnn-fg` + `ingest-news` every hour. The onchain step calls BGeometrics twice (MVRV + SOPR), totaling 48 BGeometrics calls/day → exceeds 15/day cap.

New state: split onchain into its own workflow at every 2 hours:
- `.github/workflows/cron-hourly.yml` — keeps cnn-fg + news (every hour). Removes onchain.
- `.github/workflows/cron-onchain.yml` — NEW. Calls `ingest-onchain` only, schedule `0 */2 * * *` UTC (every 2 hours). 12 fires/day × 2 endpoints = 24 calls/day.

Wait — 24 calls/day is still over 15/day. Two options:

**Option A**: every 3 hours (`0 */3 * * *`). 8 fires/day × 2 endpoints = 16 calls/day → still over by 1.
**Option B**: every 4 hours (`0 */4 * * *`). 6 fires/day × 2 endpoints = 12 calls/day → safely under.

**Decision: Option B (every 4 hours).** MVRV/SOPR are slow-moving daily-ish indicators; 4h cadence is plenty. The CNN F&G + news cron stay hourly for sentiment freshness.

This also has a side benefit: 6 fires/day × 2 endpoints leaves 3 calls/day of headroom for manual backfill or `workflow_dispatch` testing without tripping 15/day.

---

## §3 — Source matrix (post-3.0)

| Source | Used for | Free tier | Auth | Fallback role |
|---|---|---|---|---|
| FRED (`stlouisfed.org`) | macro indicators (8 series) | unlimited | API key | primary, no fallback |
| Alpha Vantage | US/global daily bars (Tier 1), news sentiment | 25/day, 5/min | API key | primary for US/global OHLC; Tier 1 |
| **Twelve Data** *(new)* | US/global daily bars (Tier 2 fallback when AV `compact` insufficient) | 800/day, 8/min | free signup key | Tier 2 |
| **Yahoo Finance** *(new)* | KR daily bars (PRIMARY); US/global daily bars (Tier 3 last-resort) | undocumented ~360/hr per IP | none | Tier 3 for US/global; primary for KR |
| BGeometrics (`bitcoin-data.com`) | MVRV Z, SOPR | 8/hr · **15/day** | none / optional token | primary, no fallback |
| Farside Investors | BTC ETF flow | undocumented | none (UA header) | primary |
| alternative.me | Crypto F&G | unlimited | none | primary |
| CNN Markets Data | Stock F&G | undocumented | none | primary |
| Finnhub | News sentiment | 60/min | API key | primary |
| CoinGecko | Crypto prices | 30/min | none | primary |

**No deletions** — we only ADD adapters. AV stays primary because (a) it's already wired with retry/parse logic, (b) its 25/day fits 12 tickers, (c) Twelve Data's free ToS is "personal/internal/non-commercial" which fits us but adds a second key to manage. AV is "good enough" for any ticker that yields ≥200 bars; only when it doesn't (i.e. always, with `compact`) do we fall through.

---

## §4 — Schema changes

### §4.1 `technical_readings` — no new columns

Existing schema accommodates the new sources. The `source_name` column already accepts arbitrary strings; we add `'twelvedata'` and `'yahoo_finance'` as allowed values in the enum-by-convention. No migration needed.

### §4.2 `price_readings` — no new columns

Same shared-fetch pattern. New sources write rows with `source_name='twelvedata'` or `'yahoo_finance'`.

### §4.3 `ingest_runs` — no schema change, but new audit values

Audit rows record per-source success/failure. After 3.0:
- `source_name='alpha_vantage'` — Tier 1 attempt count
- `source_name='twelvedata'` — Tier 2 attempt count (new)
- `source_name='yahoo_finance'` — Tier 3 / KR primary attempt count (new)

The `notes` JSONB column captures fallback reason (e.g. `{"reason":"av_compact_insufficient_bars","bars_returned":100}`).

### §4.4 No model_version bump in 3.0

`MODEL_VERSION='v2.0.0'` stays. The score engine math is unchanged; only the input completeness improves. The bump to `v2.1.0` happens only if §6 backtest shows >5pp average drift on category scores after MA(200) is populated.

---

## §5 — Build sequence (Steps 1–6)

Each step is a separate commit. Each ends with tests + manual smoke. Trigger 2 5-agent review runs after Step 6 before the final push.

### Step 1 — `twelvedata.ts` adapter

- New file `src/lib/score-engine/sources/twelvedata.ts`.
- Endpoint: `https://api.twelvedata.com/time_series?symbol={ticker}&interval=1day&outputsize=300&apikey={key}`.
- Env var: `TWELVEDATA_API_KEY` (free signup at twelvedata.com).
- Output shape conforms to `DailyBarSeries`.
- Errors: 429 → `fetch_status:'error'`. Non-200 → same. Empty `values` array → same.
- Tests: `twelvedata.test.ts` parsing happy path + 429 propagation + missing field defense.

### Step 2 — `yahoo-finance.ts` adapter

- New file `src/lib/score-engine/sources/yahoo-finance.ts`.
- Endpoint: `https://query2.finance.yahoo.com/v8/finance/chart/{ticker}?range=2y&interval=1d`.
- Headers: `User-Agent: Mozilla/5.0 (compatible; finance-manager/1.0)`.
- No env var (key-less).
- Parses `j.chart.result[0].timestamp[]` + `j.chart.result[0].indicators.quote[0].{open,high,low,close,volume}`.
- Handles KR tickers (`005930.KS`) and US tickers (`SPY`) symmetrically.
- Tests: `yahoo-finance.test.ts` Samsung happy path + SPY happy path + 429 fallback + malformed JSON defense.

### Step 3 — Wire fallback chain in `ingest-technical/route.ts`

- Replace direct `fetchAlphaVantage()` call with `fetchDailyBars()` chain (per §2.2).
- Add `isKrTicker()` helper.
- Update `ingest_runs` audit to record which tier served each ticker.
- No change to local indicator calculation (`technical.ts`); same RSI/MACD/MA/BB run on whatever bars come back.
- Tests: `ingest-technical-fallback.test.ts` mocks AV failure → Twelve Data success path; KR ticker → skips upper tiers and goes straight to Yahoo.

### Step 4 — Re-add KR tickers to registry

- Restore the 7 KR tickers in `src/app/api/cron/ingest-technical/ticker-registry.ts`:
  - `005930.KS` Samsung Electronics (kr_equity)
  - `000660.KS` SK Hynix (kr_equity)
  - `373220.KS` LG Energy Solution (kr_equity)
  - `207940.KS` Samsung Biologics (kr_equity)
  - `005380.KS` Hyundai Motor (kr_equity)
  - `069500.KS` KODEX 200 ETF (kr_equity, ETF rep)
  - `229200.KQ` KODEX KOSDAQ150 ETF (kr_equity, ETF rep)
- Total registry: 12 → 19 tickers (back to pre-carve-out count). Single-batch run estimate: 19 × ~13s = ~247s, still under Vercel Hobby 300s `maxDuration`.
- Bump `TICKER_LIST_VERSION` from `v2.0.0-2026-04-25` to `v3.0.0-2026-04-26`.

### Step 5 — Split cron-onchain (every 4 hours)

- Remove `ingest-onchain` step from `.github/workflows/cron-hourly.yml`.
- New file `.github/workflows/cron-onchain.yml`:
  ```yaml
  name: Onchain cron (BGeometrics MVRV + SOPR + ETF flow)
  on:
    schedule:
      - cron: "0 */4 * * *"  # every 4 hours UTC = 6 fires/day
    workflow_dispatch:
  concurrency:
    group: cron-onchain
    cancel-in-progress: true
  jobs:
    run:
      runs-on: ubuntu-latest
      timeout-minutes: 10
      steps:
        - name: ingest-onchain
          continue-on-error: true
          env:
            CRON_SECRET: ${{ secrets.CRON_SECRET }}
            PRODUCTION_URL: ${{ secrets.PRODUCTION_URL }}
          run: |
            curl -sS -f \
              -H "Authorization: Bearer ${CRON_SECRET}" \
              "${PRODUCTION_URL}/api/cron/ingest-onchain"
  ```
- Update `cron-hourly.yml` header comment to reflect the carve-out.
- This puts BGeometrics call count at 6 × 2 = 12/day, safely under 15/day cap.

### Step 6 — Documentation updates

- `docs/phase2_acceptance_matrix.md`:
  - PARTIAL → MET on §10.1 row 1 (technical indicators) once 3.0 ships and `value_raw` shows MA_200/Disparity populated.
  - PARTIAL → MET on §10.3 row 1 (cron 7-day green) once 7 days post-3.0 land without MVRV/SOPR 429 spikes.
  - Deferred row "KR equity 2/6 null" → resolved.
  - Deferred row "MA_200 永구 null" → resolved.
  - Deferred row "MVRV/SOPR resilience" → resolved.
- `investment_advisor_dashboard_prd_kr_v3.md` v3.6:
  - §17 risk table: Bitbo/CoinGlass migration row → mark "대응 완료 in Phase 3.0"; KR ticker rejection → "복구 완료, 7 ticker 부활"; AV `outputsize` → "Twelve Data + Yahoo fallback chain 도입".
  - §18 Phase 3 bullet list: split into 3.0 (data recovery, complete) + 3.1–3.4 (product modules, pending).
- `docs/handoff.md`: snapshot 갱신.
- `docs/backlog.md`: Phase 3 blueprint blockers section → mark resolved.

---

## §6 — Acceptance criteria

Each criterion is verifiable by a single command or query. Step 6 closes the matrix entries when ALL of these pass:

1. **MA_200 not null**:
   ```sql
   SELECT count(*) FROM technical_readings
   WHERE indicator_key='MA_200' AND value_raw IS NOT NULL
     AND observed_at::date = CURRENT_DATE - INTERVAL '1 day';
   ```
   Expected: ≥ 10 (out of 12 non-KR tickers; 2 may legitimately fail on a given day).

2. **Disparity not null** (depends on MA_200):
   ```sql
   SELECT count(*) FROM technical_readings
   WHERE indicator_key='Disparity_200' AND value_raw IS NOT NULL
     AND observed_at::date = CURRENT_DATE - INTERVAL '1 day';
   ```
   Expected: same as MA_200 row count.

3. **DISLOCATION signal exits unknown**:
   ```sql
   SELECT per_signal_detail->'DISLOCATION'->>'state'
   FROM signal_events
   ORDER BY snapshot_date DESC LIMIT 1;
   ```
   Expected: `'active'` or `'inactive'` (NOT `'unknown'`).

4. **MOMENTUM_TURN signal exits unknown**:
   ```sql
   SELECT per_signal_detail->'MOMENTUM_TURN'->>'state'
   FROM signal_events
   ORDER BY snapshot_date DESC LIMIT 1;
   ```
   Expected: `'active'` or `'inactive'`.

5. **KR equity has live technical_readings**:
   ```sql
   SELECT count(*) FROM technical_readings
   WHERE ticker LIKE '%.K_'
     AND observed_at::date = CURRENT_DATE - INTERVAL '1 day';
   ```
   Expected: 7 tickers × 5 indicators (RSI/MACD/MA_50/MA_200/Disparity) = 35 rows. (Bollinger adds 6 more if we re-run BB on KR; depends on timing.)

6. **kr_equity composite categories non-null**:
   ```sql
   SELECT contributing_indicators->'technical' FROM composite_snapshots
   WHERE asset_type='kr_equity'
   ORDER BY snapshot_date DESC LIMIT 1;
   ```
   Expected: object with non-null `score` (NOT `null`).

7. **BGeometrics zero 429s for 7 consecutive days post-3.0**:
   ```sql
   SELECT count(*) FROM ingest_runs
   WHERE source_name='bgeometrics' AND fetch_status='error'
     AND notes->>'reason' LIKE '%429%'
     AND ingested_at > now() - INTERVAL '7 days';
   ```
   Expected: 0.

8. **Composite score drift check (model_version bump trigger)**:
   ```sql
   -- compare last 7 days of us_equity composite under v2.0.0
   -- BEFORE 3.0 deploy vs AFTER 3.0 deploy.
   -- If average abs(diff) > 5 points → bump MODEL_VERSION.
   ```
   This is a one-off check after the first 7 days post-deploy; results documented in handoff. If bumped, Phase 3.0 lands a `v2.1.0` model row in `model_versions` table per Phase 1 blueprint §5 cutover protocol.

9. **All tests green**: `npm test` returns 510+ tests passing (505 baseline + ~5 new from Steps 1, 2, 3 adapter tests).

10. **Trigger 2 5-agent review** (CLAUDE.md): no findings ≥ 80 confidence remain unresolved.

---

## §7 — Risks specific to Phase 3.0

| Risk | Likelihood | Mitigation |
|---|---|---|
| Yahoo Finance starts blocking GHA runner IPs | Medium | Tier 3 only for US/global (KR is primary). For KR, falls through to pykrx (Step 8 deferred candidate, not in 3.0). Add exponential backoff + jitter. |
| Twelve Data ToS clause "personal/non-commercial" interpretation | Low | Family dashboard for 3 personal accounts is unambiguously personal. Document this in adapter file header. |
| `005930.KS` ticker shape parses differently in Supabase | Low | `technical_readings.ticker` is `text`; period in ticker is fine. Validated against existing `BTC-USD` precedent. |
| 19-ticker single batch tips over 300s `maxDuration` | Medium | Phase 2 measured 12 × 13s ≈ 156s. Adding 7 KR via Yahoo (faster than AV — no per-ticker 12s rate-limit gate): expected total ~210s, under 300s. Mitigation if measurement disagrees: split KR into `cron-technical-kr.yml` separate workflow. |
| MODEL_VERSION drift > 5pp after MA_200 unblocks (forces v2.1.0 cutover) | Medium-high | Expected outcome — DISLOCATION input changes affect us_equity/global_etf composite. Plan for the bump explicitly: prepare a `model_versions` migration row + cutover-day badge UI test. Not in 3.0 critical path (Phase 2 cutover infra exists). |
| pykrx Python fallback never gets implemented (deferred from 3.0) | Low | Yahoo as KR primary suffices. pykrx noted as Phase 3.x candidate if Yahoo unreliable for >2 days in a row. |

---

## §8 — Out of scope for 3.0 (deferred to 3.1–3.4 or later)

- **DART (OpenDART) integration** for Korean valuation (P/E, P/B from EPS/BPS) — Phase 3.x. Step 4 restores OHLC; valuation derivation is a separate adapter that needs filings parsing.
- **ECOS macro inputs** for Korean rates/FX — already partially covered via FRED `DEXKOUS` + `DTWEXBGS` (PRD §10.3). ECOS would add KR-internal CD rate, M2, etc.; deferred until Phase 3.x where we discuss whether to expand the macro panel for KR equity.
- **pykrx Python fallback** — deferred until Yahoo proves unreliable in production for >2 consecutive days.
- **MODEL_VERSION v2.1.0 cutover** — only triggered if §6 acceptance #8 shows >5pp drift. Not pre-allocated.
- **Phase 3.1/3.2/3.3/3.4 product modules** — separate blueprints. Recommended order: 3.4 backtest → 3.1 regime → 3.2 portfolio → 3.3 personalization (per orchestrator recommendation).

---

## §9 — Approval gate

This blueprint is a PROPOSAL. Before any Phase 3.0 step is implemented, the user must approve:

- [ ] §2.3 cron split cadence (every 4 hours for onchain — `Option B`).
- [ ] §3 Twelve Data signup acceptance (free key registration — small UX cost).
- [ ] §5 Step 4 KR ticker selection (the same 7 tickers that were carved out, OR substitutes).
- [ ] §6 acceptance criteria — especially the >5pp MODEL_VERSION drift trigger.
- [ ] §8 deferred items — confirm pykrx and DART are NOT in 3.0.

Once approved, implementation begins at Step 1 and proceeds sequentially. Trigger 2 5-agent review after Step 6 (CLAUDE.md mandate). Production deploy + Chrome MCP verify before marking 3.0 complete.

---

*This file is the canonical Phase 3.0 design doc. Implementation commits reference back to specific §§ (e.g. `feat(phase3.0): Step 1 — twelvedata.ts adapter (§5 Step 1)`).*
