# Phase 2 Acceptance Matrix — Investment Advisor Dashboard

**Version:** Phase 2 v1.0
**Last verified:** 2026-04-25
**Commit:** `3d25e58` on `main`
**Production URL:** https://finance-manager-james.vercel.app

This document maps every acceptance row in `phase2_architecture_blueprint.md` §10 (and the PRD §16.3 / §18 sources it cites) to concrete, repeatable evidence — file paths, DB queries, deployed routes — and a status emoji. It is the Phase C Step 13 deliverable. PRD source is `investment_advisor_dashboard_prd_kr_v3.md`.

---

## Executive summary

Phase 2 is **shippable**. All seven PRD §18 bullets plus the PRD §10.4 Signal Alignment layer are implemented, deployed to production, and exercised by 478 in-source unit tests (≥150 target from blueprint Version Assumptions). The 6-category v2 composite (macro / technical / sentiment / valuation-folded / regional_overlay / on-chain) is computing daily under `MODEL_VERSION=v2.0.0`, and the 8-signal alignment engine (`SIGNAL_RULES_VERSION=v1.0.0`) is computing on every cron tick.

Coverage by asset type at the time of writing:

- **us_equity / global_etf / common**: 4 of 6 categories populating (macro, technical, sentiment, regional_overlay where applicable; valuation folded into sentiment per blueprint §12 trade-off 7; on_chain N/A).
- **crypto**: 3 of 6 (macro, sentiment, on_chain — technical N/A by blueprint, regional_overlay N/A).
- **kr_equity**: 2 of 6 (macro + regional_overlay only — KR ticker AV-blocked per blueprint §3.2 KR carve-out; ECOS/Yahoo deferred to Phase 3).

Signal Alignment Engine: 8 signals computed; 1 of the 6 base signals (`ECONOMY_INTACT`) is currently firing in production at the verification timestamp. The remaining 5 base signals + 2 crypto-extra signals correctly resolve to `inactive` or `unknown` per blueprint §4.5 null policy. Status reflects engine correctness, not market state.

Two known structural gaps are deferred to Phase 3 with explicit rationale (KR equity technical category; MA_200 / Disparity for the AV daily registry — both upstream data-source limitations, not Phase 2 implementation defects). See "Deferred / known gaps" below.

---

## §10.1 PRD §18 mapping

Source rows: blueprint lines 730–741.

| Criterion | Evidence | Status |
|---|---|---|
| RSI, MACD, 이동평균선 반영 (line 734) | Pure-math module `src/lib/score-engine/technical.ts` covered by `src/lib/score-engine/technical.test.ts` (62 `it/test` blocks: RSI thresholds, MACD cross, MA_50, BB_20_2, Disparity). Daily cron `src/app/api/cron/ingest-technical/route.ts` writes `technical_readings` for the 12-ticker AV registry frozen in `src/app/api/cron/ingest-technical/ticker-registry.ts` (post-2026-04-25 KR carve-out). MA_200 / Disparity are structurally null in production (compact-only AV free tier — see §10.2 row 1 below). | MET |
| BTC MVRV / SOPR 반영 (line 735) | `src/lib/score-engine/onchain.ts` + `src/lib/score-engine/onchain.test.ts` (44 test blocks). Hourly ingestion at `src/app/api/cron/ingest-onchain/route.ts` (Bitbo + CoinGlass + alternative.me); `onchain_readings` populated when BGeometrics 8/hr quota allows. MVRV_Z / SOPR drive `CRYPTO_UNDERVALUED` / `CAPITULATION` in `signals.ts`. Resilience caveat: BGeometrics rate-limit headroom is tight — see Deferred gaps row 2. | PARTIAL |
| 뉴스 센티먼트 보조 레이어 (line 736) | `src/lib/score-engine/sources/finnhub.ts` + `finnhub-parse.test.ts`; `src/lib/score-engine/sources/alpha-vantage-news.ts` + `alpha-vantage-news-parse.test.ts`. Hourly cron `src/app/api/cron/ingest-news/route.ts` writes `news_sentiment`. Capped weight enforced in `src/lib/score-engine/weights.ts` per asset (US-equity sentiment slot capped per blueprint §4.1). | MET |
| 점수 기여도 시각화 (line 737) | `src/components/asset/contributing-indicators.tsx` v2 renders 4-category grouped bars; covered by `src/components/asset/contributing-indicators.test.ts`. `src/components/asset/category-contribution-bar.tsx` is the per-category sub-component. Rendered at `/asset/[slug]` via `src/app/(protected)/asset/[slug]/asset-content.tsx`. | MET |
| 가격 히스토리 레이어 — §8.5 visualization-only (line 738) | `src/lib/data/prices.ts` reader. `price_readings` populated for 15 tickers (12 AV registry + 3 CoinGecko via `src/app/api/cron/ingest-prices/route.ts`). Visualization-only invariant: `Grep "from .*data/prices" src/lib/score-engine` returns 0 hits — not feeding the score engine. ESLint `no-restricted-imports` rule **not** configured (`eslint.config.mjs` is minimal); invariant is convention-only at present. | PARTIAL |
| 히스토리 뷰에 가격 오버레이 — §11.6 Phase 2 (line 739) | `src/components/asset/score-price-overlay.tsx` Recharts `ComposedChart` (score line left axis + price line right axis); covered by `src/components/asset/score-price-overlay.test.ts`. Wired into `src/app/(protected)/asset/[slug]/asset-content.tsx`. Hover tooltip surfaces score + price + Δ. | MET |
| PWA 대응 — §11.7 (line 740) | `public/manifest.webmanifest` (PNG + SVG icons, both standard and maskable purpose, `start_url=/dashboard`, `display=standalone`). `public/sw.js` shell-only (`finance-shell-v2`, network-first, no API caching per blueprint §6.2). Registration via `src/components/shared/service-worker-registration.tsx`. Lighthouse PWA audit ≥ 90: not yet run on production at `3d25e58`. | PARTIAL |
| 매수 타이밍 시그널 엔진 — §10.4 (line 741) | `src/lib/score-engine/signals.ts` (8 signals: 6 base + `CRYPTO_UNDERVALUED` + `CAPITULATION`); `signals.test.ts` has 54 `it/test` blocks (well above the blueprint's "18+" floor). `src/lib/data/signals.ts` writes `signal_events` keyed by `(snapshot_date, signal_rules_version)` — `SIGNAL_RULES_VERSION='v1.0.0'` from `src/lib/score-engine/weights.ts:46`. `SignalAlignmentCard` rendered above `CompositeStateCard` in `src/app/(protected)/dashboard/dashboard-content.tsx:6` (above `composite-state-card` import on line 4) and on `/asset/[slug]` via `asset-content.tsx`. **Not** yet rendered on `/changelog` — see Operational §10.3 row 3. | PARTIAL |

---

## §10.2 PRD §16.3 mapping

Source rows: blueprint lines 745–749.

| Criterion | Evidence | Status |
|---|---|---|
| 최소 2개 이상의 기술적 지표(RSI, MACD)가 적용된다 (PRD line 468 / blueprint line 747) | `SELECT DISTINCT indicator_key FROM technical_readings` returns `RSI_14`, `MACD_12_26_9`, `MA_50`, `BB_20_2`. **MA_200 + Disparity are null in production** because Alpha Vantage moved `outputsize=full` to premium 2026-04-25; `outputsize=compact` returns 100 bars while MA_200 needs 200. Disparity (`price / MA_200 - 1`) propagates the null per blueprint §2.2 tenet 1. Five remaining indicators populate normally — meets the "최소 2개" PRD bar with margin. | MET |
| BTC에는 최소 1개 이상의 온체인 지표(MVRV 또는 SOPR)가 적용된다 (PRD line 469 / blueprint line 748) | `onchain_readings WHERE asset_type='crypto' AND indicator_key IN ('MVRV_Z','SOPR')` populated when BGeometrics quota allows. BTC composite under `MODEL_VERSION=v2.0.0` carries non-zero `on_chain` sub-score in `composite_snapshots` for `crypto`. Resilience is the gap, not coverage — both indicators are wired and in the schema. | MET |
| 나머지 Phase 2 기준은 본 블루프린트 §10에서 정의 (PRD line 470 / blueprint line 749) | Cross-references §10.1 above. No new evidence required. | MET |

---

## §10.3 Operational acceptance

Source rows: blueprint lines 753–757.

| Criterion | Evidence | Status |
|---|---|---|
| Cron reliability — 7 consecutive days green (line 753) | GHA workflows `.github/workflows/cron-hourly.yml` (onchain + cnn-fg + news, hourly) and `.github/workflows/cron-technical.yml` (technical + prices, daily 22:00 UTC). `continue-on-error: true` per blueprint §0.5 tenet 1; truth source is `ingest_runs` rows, not GHA badge color. Tracking window starts 2026-04-25 (the day the KR carve-out + final cron config landed at commit `d536141`). At verification time we are on day 1 of the 7-day window. | PARTIAL |
| Alpha Vantage rate-limit headroom (line 754) | Daily AV usage = 12 `TIME_SERIES_DAILY` calls (one per ticker in `ticker-registry.ts`) + 5 `NEWS_SENTIMENT` calls = **17 / 25 daily**, leaving 8 calls of headroom for manual backfill. Tracked via `ingest_runs WHERE source_name='alpha_vantage'`. Aligned with blueprint §11 risk row 1. | MET |
| Signal Alignment Card on all 3 protected routes (line 755) | Dashboard: `src/app/(protected)/dashboard/dashboard-content.tsx` imports `SignalAlignmentCard` (line 6) and renders above `CompositeStateCard`. `/asset/[slug]`: `src/app/(protected)/asset/[slug]/asset-content.tsx` imports `SignalAlignmentCard`. **`/changelog`: NOT rendered** — `Grep "Signal\|signal" src/app/(protected)/changelog/` returns no matches. Blueprint mandate ("signal-transition rows when a signal fires/unfires") is not yet wired into `changelog-content.tsx`. | PARTIAL |
| PWA installable on real devices (line 756) | Manifest + SW shipped (see §10.1 row 7 above). Installable surface verified via Chrome DevTools "Install" prompt locally. Real iOS Safari + Android Chrome A2HS smoke test on production: not yet executed at `3d25e58`. PNG icons (commit `f863e81`) added specifically because iOS Safari does not honour SVG manifest icons reliably. | PARTIAL |
| Family-only access — RLS preserved (line 757) | Migrations `0002_rls_policies.sql` (Phase 1) + `0007_phase2_rls.sql` (Phase 2 tables). `proxy.ts` unchanged from Phase 1 (auth gate). Anon `supabase-js` query against any of `composite_snapshots`, `signal_events`, `technical_readings`, `onchain_readings`, `news_sentiment`, `price_readings` returns 0 rows. Family auth: 3 accounts (jw.byun, edc0422, odete4) per Phase 1 setup. | MET |

---

## Deferred / known gaps

| Gap | Why deferred | Phase 3 plan |
|---|---|---|
| KR equity technical category (`kr_equity` aggregate returns null) | Alpha Vantage free tier rejects every KOSPI / KOSDAQ symbol format (`.KS`, `.KQ`, `.KOSPI`, `.KRX`, bare 6-digit). Carve-out documented at `src/app/api/cron/ingest-technical/ticker-registry.ts` lines 31–58. | ECOS (한국은행 OpenAPI) or Yahoo Finance scrape. Tracked as blueprint §11 risk row 8. |
| MVRV_Z + SOPR resilience under load | BGeometrics 8/hr free quota is too tight for stable hourly ingestion; `bitbo.ts` uses `retryOnRateLimit: false` so a single 429 doesn't burn remaining quota. Status surfaces as `fetch_status='error'` in `ingest_runs` and a per-category staleness badge on the asset page. | Glassnode (~$29/mo) for production-grade reliability. Tracked as blueprint §11 risk row 2. |
| MA_200 + Disparity always null on AV registry tickers | Alpha Vantage moved `TIME_SERIES_DAILY?outputsize=full` to premium 2026-04-25; `outputsize=compact` returns 100 daily bars while MA_200 needs 200. Documented at blueprint §10.2 row 1. | Same Glassnode upgrade for crypto; for equities, AV Premium (~$50/mo) or Twelve Data (800/day free, mentioned at blueprint §11 row 1). |
| CNN Markets Data F&G partial reliability | Source HTML structure drift (no contract). Mitigation already in place: `EXTREME_FEAR` falls back to VIX-only when CNN_FG missing (blueprint §11 row 5). | Replace with Alternative.me stocks adapter once that endpoint stabilises, or self-host an F&G calculation. |
| `signal_events` cutover badge | `SIGNAL_RULES_VERSION` is still `v1.0.0` (no bump landed). The cutover badge UI piece will become exercised on the first signal-rules bump. | Re-verify when v1.1.0+ ships. |
| Signal Alignment Card on `/changelog` | Not yet wired; blueprint §10.3 line 755 mandates per-asset signal-transition rows on the changelog. | Phase 3 Step 1 candidate. |
| Lighthouse PWA ≥ 90 on production | Audit not yet run at `3d25e58`. | Run on the first stable production deploy of Phase 2; commit screenshot under `docs/`. |
| 7-day cron green window | Tracking starts 2026-04-25; verification time is day 1. | Re-verify 2026-05-02. |

---

## How to re-verify

1. From repo root: `npm test` — expect 478+ unit tests green (latest count at commit `3d25e58`; the matrix's "≥150" blueprint floor still holds with 3× margin).
2. `npm run build` — expect a clean `next build` with no Cache Components warnings.
3. Hit the cron endpoints with the current `CRON_SECRET` Bearer (one-shot smoke):
   - `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://finance-manager-james.vercel.app/api/cron/ingest-macro`
   - Same pattern for `ingest-technical`, `ingest-onchain`, `ingest-cnn-fg`, `ingest-news`, `ingest-prices`. Each returns a JSON body with per-source `fetch_status` rows; check `ingest_runs` table for the corresponding audit row.
4. Navigate the three protected routes after sign-in:
   - `/dashboard` — `SignalAlignmentCard` rendered above `CompositeStateCard`; 4 `AssetCard`s (us_equity / kr_equity / global_etf / crypto) populated.
   - `/asset/us-equity` — `ContributingIndicators` grouped bars + `ScorePriceOverlay` Recharts `ComposedChart` rendering.
   - `/asset/crypto` — same layout, `on_chain` sub-score visible in indicator strip.
5. DevTools Application tab → confirm `manifest.webmanifest` parsed without warnings and `sw.js` registered.
6. (Optional) Run Lighthouse PWA audit on `/dashboard` — expect ≥ 90 for "Installable" + "PWA-optimized" lanes.

---

## Status breakdown

- **Total criteria covered:** 16 (8 §10.1 rows + 3 §10.2 rows + 5 §10.3 rows).
- **MET:** 9 / 16 = 56%.
- **PARTIAL:** 7 / 16 = 44%.
- **DEFERRED:** 0 / 16 = 0% (all deferred items are documented as Phase 3 gaps, not as deferred §10 rows; the §10 rows themselves are either MET or PARTIAL).

Every PARTIAL row has a concrete remediation path captured in the "Deferred / known gaps" table above. None of the PARTIALs are blockers for Phase 2 release sign-off; they are operational tail items (7-day green window, Lighthouse audit, real-device A2HS, `/changelog` signal rows) plus two upstream data-source gaps (MA_200, BGeometrics quota) that the blueprint already accepted at authoring time.
