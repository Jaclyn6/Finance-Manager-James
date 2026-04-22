/**
 * Pure-math on-chain indicator engine (Phase 2 Step 4).
 *
 * Consumed by:
 * - The per-snapshot score pipeline (Step 6 — `composite.ts` extension),
 *   which feeds crypto-asset score payloads (BTC/ETH/SOL) through the
 *   MVRV Z and SOPR normalizers plus the Crypto F&G passthrough.
 * - The signal alignment engine (Step 7.5 — `signals.ts` extension),
 *   via the exported flag helpers `isCryptoUndervalued` and
 *   `isCapitulation` (blueprint §4.5: `CRYPTO_UNDERVALUED` and
 *   `CAPITULATION` crypto-specific signals).
 * - The Phase 2 backfill tooling under `scripts/`, which is why this
 *   file is pure-math — no `import "server-only"`, no Next.js, no
 *   Supabase, no React. Mirrors `technical.ts` in shape so downstream
 *   wiring stays homogeneous.
 *
 * Normalization formulas copy the blueprint §4.3 spec (derived from
 * PRD §9.3 / §9.4 calibration):
 *
 * - **MVRV Z-Score**: piecewise linear with anchor points at
 *   `{≤0: 100, 3: 80, 7: 40, ≥10: 10}`, lerped between boundaries.
 *   See `mvrvZScoreToScore` JSDoc for the anchor-point interpretation
 *   of blueprint §4.3's compact `{≤0: 100, 0–3: 80, 3–7: 40, ≥7: 10}`
 *   notation. The ≥7 branch is extended to [7, 10] → [40, 10] lerp
 *   so the decay stays continuous with the rest of the curve (the
 *   alternative — jumping from 40 at 7 to 10 immediately above 7 —
 *   contradicts the blueprint's "lerp between boundaries" qualifier).
 *
 * - **SOPR**: piecewise per blueprint §4.3 /
 *   PRD §9.4: `<1: 80 + (1 - SOPR) * 20`, `[1, 1.05]: 55` (flat band),
 *   `>1.05: 40 - min(40, (SOPR - 1.05) * 100)`. The transition at
 *   exactly 1.05 is, by the blueprint's explicit interval notation
 *   `[1, 1.05]: 55`, inclusive on the left branch (1.05 → 55). Strict
 *   `> 1.05` uses the descending branch. The jump from 55 at 1.05 to
 *   40 immediately above 1.05 is intentional per spec — profit-taking
 *   momentum above the noise band materially changes the signal.
 *
 * - **Crypto F&G** (passthrough, inverted): raw 0–100 input (extreme
 *   fear = 0, extreme greed = 100) → `100 - raw`, clamped. The
 *   product's convention is "high score = favorable for entry", and
 *   market-fear IS the favorable entry condition, so a raw F&G of 0
 *   (max fear) becomes a favorability score of 100.
 *
 * - **ETF flow**: BTC spot-ETF daily net flow in USD, z-scored against
 *   the last 90 days of net-flow history, piped through
 *   `zScoreTo0100(z, inverted=true)` — positive inflow is bullish and
 *   therefore more favorable. See `etfFlowToScore` JSDoc for why the
 *   blueprint's "divided by circulating supply" normalization drops
 *   out of a same-asset z-score.
 *
 * Null/unknown handling (blueprint §2.2 tenet 1, §4.5 tenet 1): on
 * valid-but-insufficient input these helpers return `null` — never
 * throw, never default to a misleading numeric score. Upstream code
 * renders the amber "unknown" state instead of the grey "off" state.
 *
 * All exports are pure (no side effects, deterministic) and free of
 * `any`. Matches the Phase 2 standard set by `technical.ts`.
 */

import { clamp, computeZScore, lerp, zScoreTo0100 } from "./normalize";

// ---------------------------------------------------------------------------
// MVRV Z-Score
// ---------------------------------------------------------------------------

/**
 * Map a raw MVRV Z-Score to a 0-100 favorability score per blueprint
 * §4.3 (derived from PRD §9.3 calibration).
 *
 * **Anchor-point interpretation** of the blueprint's compact notation
 * `{≤0: 100, 0–3: 80, 3–7: 40, ≥7: 10}`:
 *
 * ```
 * mvrvZ ≤  0  → 100   (flat floor — deep undervaluation, max favorability)
 * mvrvZ  0 ..  3 → lerp 100 → 80
 * mvrvZ  3 ..  7 → lerp  80 → 40
 * mvrvZ  7 .. 10 → lerp  40 → 10
 * mvrvZ ≥ 10  →  10   (flat ceiling of unfavorability)
 * ```
 *
 * Rationale for extending the ≥7 branch to [7, 10]: the blueprint
 * qualifier "with lerp between boundaries" is incompatible with a
 * jump from 40 at 7 to 10 immediately above 7. An extra 3-unit lerp
 * window is the minimal extension that preserves continuity while
 * honouring the `≥7: 10` terminal value — analogous to the RSI curve's
 * 70→100 tail in `technical.ts`.
 *
 * Non-finite inputs collapse to the neutral 50 rather than propagating
 * `NaN` into composites (matches `disparityToScore`'s convention).
 *
 * Reference: Coinmetrics MVRV primer (https://coinmetrics.io/mvrv-z/);
 * Puell Multiple and MVRV Z historically bottom near 0 during deep
 * bear markets and peak above 7 at cycle tops.
 */
export function mvrvZScoreToScore(mvrvZ: number): number {
  if (!Number.isFinite(mvrvZ)) return 50;
  if (mvrvZ <= 0) return 100;
  if (mvrvZ <= 3) return lerp(100, 80, mvrvZ / 3);
  if (mvrvZ <= 7) return lerp(80, 40, (mvrvZ - 3) / 4);
  if (mvrvZ <= 10) return lerp(40, 10, (mvrvZ - 7) / 3);
  return 10;
}

/**
 * Hard boolean: is BTC undervalued per the `CRYPTO_UNDERVALUED` signal?
 * Blueprint §4.5: `CRYPTO_UNDERVALUED = MVRV_Z ≤ 0` (inclusive).
 *
 * Parameterised so a signal-tuning sweep in Phase 3 can revisit the
 * threshold without code churn; the default (`0`) matches the spec.
 */
export function isCryptoUndervalued(mvrvZ: number, threshold = 0): boolean {
  return mvrvZ <= threshold;
}

// ---------------------------------------------------------------------------
// SOPR (Spent Output Profit Ratio)
// ---------------------------------------------------------------------------

/**
 * Map a raw SOPR value to a 0-100 favorability score per blueprint
 * §4.3 (derived from PRD §9.4 calibration).
 *
 * ```
 * SOPR < 1        → 80 + (1 - SOPR) * 20, clamped at 100
 *                   (selling at a loss — capitulation territory, high
 *                    favorability for dip-buying)
 * SOPR in [1, 1.05] → 55 (flat — profit-taking noise band; no strong
 *                         directional signal)
 * SOPR > 1.05     → 40 - min(40, (SOPR - 1.05) * 100), clamped at 0
 *                   (sustained profit-taking momentum — unfavorable)
 * ```
 *
 * **Discontinuity at SOPR = 1.05**: by the blueprint's explicit
 * interval notation `[1, 1.05]: 55`, the flat-band branch wins at the
 * exact boundary — `SOPR = 1.05` scores 55, not 40. The descending
 * branch applies for strict `SOPR > 1.05`. The resulting jump (55 →
 * 40 as SOPR crosses 1.05) is intentional per spec: crossing out of
 * the noise band materially changes the regime.
 *
 * **Left-tail clamp at 100**: pure arithmetic allows the score to
 * exceed 100 when SOPR is far below 0 (theoretical, never happens in
 * practice — SOPR is a ratio of USD prices at spend vs acquisition,
 * so realistic floors are near 0.5 in the deepest capitulation). The
 * clamp keeps the output strictly in [0, 100] so composite
 * arithmetic downstream doesn't exceed band boundaries.
 *
 * Non-finite inputs collapse to the neutral 50.
 *
 * Reference: Renato Shirakashi's SOPR indicator
 * (https://insights.glassnode.com/the-spent-output-profit-ratio/).
 */
export function soprToScore(sopr: number): number {
  if (!Number.isFinite(sopr)) return 50;
  if (sopr < 1) {
    return clamp(80 + (1 - sopr) * 20, 0, 100);
  }
  if (sopr <= 1.05) {
    return 55;
  }
  // sopr > 1.05
  const penalty = Math.min(40, (sopr - 1.05) * 100);
  return clamp(40 - penalty, 0, 100);
}

/**
 * Hard boolean: is the chain in capitulation per the `CAPITULATION`
 * signal? Blueprint §4.5: `CAPITULATION = SOPR < 1` (strict
 * inequality — SOPR exactly 1 means break-even sellers on aggregate,
 * not capitulation).
 *
 * Parameterised for Phase 3 threshold tuning; default (`1`) matches
 * the spec.
 */
export function isCapitulation(sopr: number, threshold = 1): boolean {
  return sopr < threshold;
}

// ---------------------------------------------------------------------------
// Crypto Fear & Greed (passthrough, inverted)
// ---------------------------------------------------------------------------

/**
 * Invert the Alternative.me Crypto Fear & Greed index onto the
 * product's favorability scale:
 *
 * ```
 * raw = 0   (extreme fear)  → score = 100 (max favorable for entry)
 * raw = 50  (neutral)       → score =  50
 * raw = 100 (extreme greed) → score =   0 (min favorable)
 * ```
 *
 * Pure passthrough — `100 - raw` with clamp. No piecewise; the raw
 * index is already hand-tuned by its publisher to the 0-100 scale and
 * re-shaping it here would double-count that calibration.
 *
 * Values outside [0, 100] are clamped, not rejected — blueprint §4.5
 * tenet 1 mandates null-propagation for MISSING data; out-of-band
 * values from a live feed are a different error class and collapsing
 * them to the nearest valid boundary is the least-surprise response.
 * If the upstream `ingest-daily.ts` sees a persistent out-of-band
 * value it should null the cell explicitly at the ingestion layer.
 *
 * Non-finite inputs collapse to the neutral 50.
 */
export function cryptoFearGreedToScore(raw: number): number {
  if (!Number.isFinite(raw)) return 50;
  const clamped = clamp(raw, 0, 100);
  return 100 - clamped;
}

// ---------------------------------------------------------------------------
// ETF Flow (BTC Spot ETF net flow)
// ---------------------------------------------------------------------------

/** History window used for the ETF-flow z-score. Blueprint §4.3. */
export const ETF_FLOW_SCORE_WINDOW = 90;

/**
 * Map a BTC spot-ETF daily net flow (USD) to a 0-100 favorability
 * score by z-scoring against the last {@link ETF_FLOW_SCORE_WINDOW}
 * days of net-flow history, then piping through
 * `zScoreTo0100(z, inverted=true)`.
 *
 * **Why `inverted=true`**: positive net inflow is bullish demand
 * (institutional accumulation), which is favorable for entry under the
 * product's convention. A large-positive z-score should map toward 100.
 *
 * **Simplification vs blueprint §4.3 wording**: the blueprint text
 * specifies "CoinGlass — normalized by net flow / circulating supply
 * daily standard-deviated 90d". The "/ circulating supply" divisor is
 * a dimensional convenience for cross-asset comparison. Since Phase 2
 * ETF flow is BTC-only, circulating supply moves < 0.5% over 90 days
 * (≈ 180 blocks × 3.125 BTC per block / ~19.8M outstanding ≈ 0.003)
 * and is effectively constant across the z-score window, so it drops
 * out of both numerator and denominator of `(x - mean) / stddev`. We
 * operate directly on raw USD net-flow values — cheaper, identical z.
 *
 * Returns `null` when the history has fewer than 2 observations — a
 * single-point series has no meaningful variance. Matches the
 * `null`-return convention of `macdToScore` and the Phase 1 staleness
 * plumbing.
 *
 * @param currentNetFlow Today's net flow in USD (positive = inflow).
 * @param history        Prior days' net flows in USD. Only the last
 *                       {@link ETF_FLOW_SCORE_WINDOW} entries are
 *                       considered; older values are ignored per
 *                       blueprint §4.3 ("90-day rolling"). Slicing
 *                       internally lets callers pass an unbounded
 *                       multi-year history without silently widening
 *                       the z-score window.
 */
export function etfFlowToScore(
  currentNetFlow: number,
  history: number[],
): number | null {
  // Blueprint §4.5 tenet 1: missing data MUST surface as null (amber
  // "unknown" state), never as a misleading neutral 50. Guard NaN /
  // Infinity on both current and history — computeZScore would
  // otherwise propagate NaN through mean/stddev and zScoreTo0100
  // would collapse it to 50, silently pretending we have a valid
  // reading when we don't.
  if (!Number.isFinite(currentNetFlow)) return null;
  const window = history.slice(-ETF_FLOW_SCORE_WINDOW);
  if (window.length < 2) return null;
  for (const v of window) {
    if (!Number.isFinite(v)) return null;
  }
  const z = computeZScore(window, currentNetFlow);
  return zScoreTo0100(z, true);
}

