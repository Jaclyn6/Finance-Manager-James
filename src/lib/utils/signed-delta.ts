/**
 * One-decimal signed-delta display shared by every score-delta badge
 * (changelog rows, dashboard 최근 밴드 전환). The invariant: SIGN AND
 * COLOR FOLLOW THE DISPLAYED MAGNITUDE, never the raw float — a raw
 * delta of ±0.03 displays as magnitude "0.0", and a colored "+0.0" /
 * "−0.0" badge reads as a glitch (UX 실사 + Trigger 2, 2026-08-03).
 * Rounding happens on the MAGNITUDE, not the signed value: JS's
 * Math.round rounds .5 halves toward +∞ (Math.round(-0.5) === -0),
 * which would make the ±0.05 boundary asymmetric (+0.05 → "+0.1" but
 * -0.05 → "0.0"). Magnitude-first keeps the boundary symmetric.
 */
export function formatSignedDelta(delta: number): string {
  const magnitude = Math.round(Math.abs(delta) * 10) / 10;
  const sign = magnitude === 0 ? "" : delta > 0 ? "+" : "−";
  return `${sign}${magnitude.toFixed(1)}`;
}

/**
 * True when the delta displays as "0.0" at one decimal — the badge
 * must then take the neutral (unsigned, muted) style even though the
 * raw float is nonzero.
 */
export function isDisplayZeroDelta(delta: number): boolean {
  return Math.round(Math.abs(delta) * 10) === 0;
}
