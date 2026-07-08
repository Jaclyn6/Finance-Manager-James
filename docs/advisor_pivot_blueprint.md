# Advisor Pivot — "할인 판독기" Blueprint (2026-07-08)

## 0. Product pivot

The product's core question changes from "각 자산의 종합 점수는 몇 점인가"
to **"지금 이 하락이 조정(할인 기간)인가, 추세전환인가"** — with evidence,
never a bare number. Reference methodology: 자산제곱, "미국 주식 그냥
사면 손해. 1억을 가장 빠르게 불리는 4가지 전략"
(https://www.youtube.com/watch?v=TJ3uAYxPY5k).

Confirmed strategy rules from the video (2 of 4 extracted; see §6):

1. **Fear & Greed Index** — 시장 과열/공포 게이지. 극단적 공포에서
   현금을 투입하는 역발상 매수 타이밍, 과열에서 현금비중 확보.
2. **High Yield Spread** (FRED `BAMLH0A0HYM2`) — 4%p 이상 위험 / 3%p
   이하 안정. **4~5%p까지 치솟았다가 주간 기준으로 꺾일 때가 역사적
   매수 타이밍.** 2%p 이하로 내려가면 점진적으로 현금 20~30% 확보.

The advisor covers a superset: MDD/drawdown, MA200 trend structure,
VIX (level + direction), Sahm rule, T10Y2Y, MVRV-Z/SOPR (crypto).

## 1. Architecture

```
src/lib/advisor/          ← PURE engine (no I/O, fully unit-tested)
  types.ts                  input/output shapes
  drawdown.ts               52-week peak / MDD math (MIN_SAMPLES=30)
  pillars.ts                5 evidence pillars → signed votes [-1,1]
  verdict.ts                weighted combiner → verdict + evidence
  series.ts                 computeWowDelta (direction helper)
src/lib/data/advisor.ts   ← impure shell: joins Supabase readings into
                            AdvisorInputs, runs engine, caches per day
src/components/advisor/   ← VerdictCard, MarketWeatherStrip,
                            AdvisorEvidence, DrawdownChart
```

- The score engine's §7.4 invariant ("price bars never feed scores")
  still holds — the advisor is a separate consumer, it never writes
  back into `composite_snapshots`.
- Null semantics: missing inputs → `missingInputs[]` + reduced
  confidence, never silent defaults (§0.5 tenet 1).

## 2. Pillars (rule table)

| Pillar | Inputs | Discount evidence (+) | Reversal evidence (−) |
|---|---|---|---|
| trend | close, MA50, MA200 | above MA200, 정배열 | below MA200, 역배열 |
| sentiment | CNN_FG / CRYPTO_FG | ≤25 극단적 공포 (contrarian) | ≥75 과열 (mild) |
| volatility (equity only) | VIX, vixWow, drawdownPct | ≥30 패닉 (+0.15 more if wow ≤ −2 "정점 통과") | calm VIX + ≥10% dd "slow bleed"; ≥30 & wow ≥ +2 tempered |
| macro | macroScore, Sahm, T10Y2Y, hySpread, hySpreadWow | Sahm<0.5, curve normal, HY<3 안정, **HY≥4 & wow≤−0.1 = 꺾임 매수 신호(+0.7)** | Sahm≥0.5 (−1), inversion, HY≥4 rising |
| onchain (crypto) | MVRV-Z, SOPR | Z≤0 저평가, SOPR<1 항복 | Z≥4 사이클 고점 |

Weights: equity `macro .35 / trend .30 / vol .20 / sent .15`; crypto
`onchain .30 / trend .25 / sent .25 / macro .20`. Missing pillars drop
out, weights renormalize.

Verdict bands on drawdown depth × netScore: `<5% no_drawdown`,
`5-10% healthy_pullback` (unless netScore ≤ −0.35 → early
reversal_risk), `≥10%` → netScore ≥ +0.2 discount_zone / ≤ −0.2
reversal_risk / else mixed_signals. All thresholds are provisional
literature-anchored round numbers — inputs to iteration, not truths.

## 3. Data-collection fixes shipped with this pivot

1. **GH Actions crons auto-disabled (root cause of the June 25 data
   stall).** GitHub disables scheduled workflows after 60 days of repo
   inactivity; last commit was 2026-04-27 → all three workflows
   (`cron-technical`, `cron-hourly`, `cron-onchain`) stopped after
   2026-06-25. Re-enabled via `gh workflow enable` on 2026-07-08.
   Mitigation: regular commit activity + the improvement loop watches
   `gh run list` freshness; keepalive automation is in the backlog.
2. **`price_readings` full-window upsert** (`ingest-technical`):
   previously only the latest bar per day was stored (SPY had 43
   bars). Now every fetched bar (AV 100 / TwelveData 300 / Yahoo ~2y)
   upserts idempotently on `(ticker, price_date)` — every run is a
   self-healing backfill, giving the advisor its real 52-week window.
3. **`indicator_readings` FRED full-window backfill**
   (`ingest-macro` §4.1): the cron always fetched 5y of history for
   z-scores but persisted only the latest observation. Now the whole
   window lands as RAW-ONLY rows (score/normalized null — no
   look-ahead z-scores), excluding the latest date (whose scored row
   is written by the main path). Enables `getIndicatorSeries` →
   `computeWowDelta` direction reads and future percentile context.

## 4. UI structure (post-pivot)

- `/dashboard` leads with **"지금이 할인 구간인가?"** — per-asset
  `VerdictCard`s (verdict pill, headline, drawdown stats, evidence
  balance bar, top-2 evidence lines), then the `MarketWeatherStrip`
  (VIX·F&G·삼룰·금리차·HY 스프레드 chips with 7-day ▲/▼ and 꺾임
  callout), then the pre-pivot signal/composite surfaces as
  supporting evidence.
- `/asset/[slug]` gains `AdvisorEvidence`: full verdict + 52-week
  drawdown chart (peak/MDD markers) + per-pillar breakdown with
  signed score bars and missing-input flags.
- Advisor surfaces are **latest-only**: under a historical `?date=`
  they hide rather than pair a past composite with today's judgment.

## 5. Cache & invalidation

`getAdvisorViews(endDate)` / `getIndicatorSeries(keys, endDate, days)`
are `'use cache'` + `cacheLife('days')`, keyed on the calendar day and
tagged `macroSnapshot`/`technical`/`prices`/`sentiment`/`onchain` so
every ingest route that writes an input invalidates the verdict.

## 6. Open items (also in docs/backlog.md)

- Video strategies #3/#4 not yet extracted (transcript unavailable via
  scraping; needs user confirmation or a browser-session read).
- Composite engine's sentiment category still reads raw CNN_FG (goes
  dark during the outage) — wiring STOCK_FG_PROXY into the composite
  is its own score-engine feature-unit (see backlog).
- Verdict-flip alerting + hit-rate report (needs months of persisted
  history; revisit ~2026-10).

## 7. Shipped increments (improvement loop, 2026-07-08)

All reviewed under CLAUDE.md Trigger 2 (5-agent, ≥80 fixed) before
push; engine rule-set = `ADVISOR_ENGINE_VERSION adv-1.1.0`.

| Increment | Where | Loop iter. |
|---|---|---|
| F&G 7-day deltas on weather strip (`getOnchainSeries`, `collapseToDaily`) | 63b93da, 90ff598 | 1 |
| model_version numeric-safe tiebreaks in series readers | 90ff598, 3125da4 | 1, 9 |
| 5y percentile chips ("5년 상위 X%", 250-sample floor) | 606626c | 2 |
| Cron off-:00 schedules (GHA saturated-slot skip mitigation) | 9f50067 | 3 |
| STOCK_FG_PROXY — 4-component CNN-outage fallback, 자체 산출 labeling, delta arrow suppressed on proxy path | 92cedb2, fe7bb50, a263ced | 4-6 |
| Verdict history — migration 0015, `/api/cron/write-verdicts` (cron-technical step 3), `VerdictTimeline` calendar strip with gap cells | 1f009cb, e7d3060, 1240989, 3125da4 | 7-9 |
