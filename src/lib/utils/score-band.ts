/**
 * Maps a 0-100 composite score to a 5-state band per PRD §7.4.
 *
 * The band is UI-facing; the engine still operates in continuous
 * scores internally (so backtest replay and A/B'ing model versions
 * can stay precise). Keep this file pure — no React, no Tailwind —
 * so it can be imported from Server Components, Client Components,
 * and Node test environments alike. UI components translate the
 * `intensity` into Kraken color tokens at render time.
 */

export type BandIntensity =
  | "strong_overweight" // 80-100 — 강한 비중 확대
  | "overweight" //        60-79  — 비중 확대
  | "neutral" //           40-59  — 유지
  | "underweight" //       20-39  — 비중 축소
  | "strong_underweight"; // 0-19   — 강한 비중 축소

export interface Band {
  /** Korean label rendered next to the score. PRD §2.3 vocabulary. */
  label: string;
  /** Stable key for UI → Tailwind class / badge variant dispatch. */
  intensity: BandIntensity;
}

/**
 * Boundary logic: closed-open intervals. A score of exactly 80 is
 * "강한 비중 확대", 79.999 is just "비중 확대"; likewise for 60/40/20.
 * Non-finite input (NaN, ±Infinity) coerces to "유지" (neutral) as a
 * safe default — an error upstream shouldn't present as a confident
 * signal.
 *
 * Finite but out-of-range input (e.g. 120 from floating-point dust,
 * -5 from a bad caller) is NOT neutralized — it falls into the
 * closest extreme band (120 → 강한 비중 확대, -5 → 강한 비중 축소).
 * Upstream is responsible for producing scores in [0, 100]; both
 * `zScoreTo0100` and `computeComposite` do so, so the out-of-range
 * branch is effectively a floating-point-rounding tolerance rather
 * than a guard against real bugs.
 */
export function scoreToBand(score: number): Band {
  if (!Number.isFinite(score)) {
    return { label: "유지", intensity: "neutral" };
  }
  if (score >= 80) return { label: "강한 비중 확대", intensity: "strong_overweight" };
  if (score >= 60) return { label: "비중 확대", intensity: "overweight" };
  if (score >= 40) return { label: "유지", intensity: "neutral" };
  if (score >= 20) return { label: "비중 축소", intensity: "underweight" };
  return { label: "강한 비중 축소", intensity: "strong_underweight" };
}
