/**
 * Signal Alignment sub-engine — pure functions for computing the 8
 * signals defined in PRD §10.4 + blueprint §4.5.
 *
 * Independent from the composite score (blueprint §4 category model).
 * Phase C Step 7.5 wires this module's `computeSignals` output to
 * `signal_events` via `src/lib/data/signals.ts`. The 8 signals are:
 *
 *   Base (apply to every asset type unless explicitly excluded per
 *   blueprint §4.5 lines 292–297):
 *     - EXTREME_FEAR      : VIX ≥ 35 || CNN_FG < 25
 *     - DISLOCATION       : SPY.disparity ≤ -0.25 || QQQ.disparity ≤ -0.25
 *     - ECONOMY_INTACT    : ICSA < 300000 && SAHMCURRENT < 0.5
 *     - SPREAD_REVERSAL   : BAMLH0A0HYM2_today ≥ 4 && < max(last_7d)
 *     - LIQUIDITY_EASING  : TGA_today < 20-day SMA(TGA)
 *     - MOMENTUM_TURN     : SPY MACD bullish cross within last N=7 days
 *
 *   Crypto-extra (CRYPTO_UNDERVALUED + CAPITULATION):
 *     - CRYPTO_UNDERVALUED: MVRV_Z ≤ 0
 *     - CAPITULATION      : SOPR < 1
 *
 * **Null-propagation invariant** (blueprint §2.2 tenet 1 + §4.5 line 299):
 * any signal whose inputs are missing yields `state: "unknown"`. Never
 * `false` / `"inactive"` on null — the UI must be able to distinguish
 * "signal not firing" from "we don't know yet". Silent success / loud
 * failure (plan §0.5 tenet 1) applies here: we surface the gap.
 *
 * **OR-semantics null policy** (EXTREME_FEAR, DISLOCATION):
 *  - Both arms null                        → "unknown"
 *  - One arm null + other arm fires        → "active"   (PRD §10.4 degrades gracefully)
 *  - One arm null + other arm non-firing   → "unknown"  (tenet-1 loud failure:
 *                                            can't rule out missing arm having fired)
 *  - Both arms present + neither fires     → "inactive"
 *
 * **AND-semantics null policy** (ECONOMY_INTACT, SPREAD_REVERSAL,
 * LIQUIDITY_EASING):
 *  - Any required input null → "unknown"
 *  - All inputs present      → active/inactive per threshold
 *
 * **Crypto extras** (CRYPTO_UNDERVALUED, CAPITULATION): single-input
 * signals; null → "unknown".
 *
 * **MOMENTUM_TURN**: returns "unknown" on short or misaligned histories
 * and when the recent window holds no adjacent non-null pair.
 *
 * No `server-only` import — this file is pure math, no I/O, no admin
 * client, no Next.js. Mirrors `technical.ts` / `onchain.ts` /
 * `composite-v2.ts` / `sentiment.ts`. That makes it safe to import from
 * both the cron route handlers (trusted server) AND the Phase 2 backfill
 * scripts under `scripts/`.
 */

import { isCapitulation, isCryptoUndervalued } from "./onchain";
import { macdBullishCrossWithin, type MacdResult } from "./technical";
import type { AssetType } from "./types";
import { SIGNAL_RULES_VERSION } from "./weights";

/**
 * Canonical signal name union — the public type surface covers all 8
 * signals (6 base + 2 crypto-extra). Extending rather than splitting
 * into a separate type keeps `SignalDetail` / `SignalComputation`
 * homogeneous across asset types.
 */
export type SignalName =
  | "EXTREME_FEAR"
  | "DISLOCATION"
  | "ECONOMY_INTACT"
  | "SPREAD_REVERSAL"
  | "LIQUIDITY_EASING"
  | "MOMENTUM_TURN"
  | "CRYPTO_UNDERVALUED"
  | "CAPITULATION";

/** Base 6 signals that apply to every asset type (subject to §4.5 exclusions). */
export const BASE_SIGNALS: readonly SignalName[] = [
  "EXTREME_FEAR",
  "DISLOCATION",
  "ECONOMY_INTACT",
  "SPREAD_REVERSAL",
  "LIQUIDITY_EASING",
  "MOMENTUM_TURN",
] as const;

/** Crypto-only additional signals (blueprint §4.5 line 294). */
export const CRYPTO_EXTRA_SIGNALS: readonly SignalName[] = [
  "CRYPTO_UNDERVALUED",
  "CAPITULATION",
] as const;

/** All 8 signals, canonical ordering (base then crypto-extra). */
export const ALL_SIGNALS: readonly SignalName[] = [
  ...BASE_SIGNALS,
  ...CRYPTO_EXTRA_SIGNALS,
] as const;

/**
 * Per-signal evaluation state:
 *   "active"   — inputs present, threshold condition met
 *   "inactive" — inputs present, threshold not met
 *   "unknown"  — at least one required input missing (null-propagation)
 */
export type SignalState = "active" | "inactive" | "unknown";

/**
 * Per-signal detail persisted to `signal_events.per_signal_detail`
 * (JSONB). The UI tooltip reads `inputs` + `threshold` so a user can
 * see WHY a signal is active (e.g. "VIX=37.2 ≥ 35").
 *
 * `inputs` keys vary per signal — e.g. EXTREME_FEAR carries `{vix,
 * cnnFg}`; LIQUIDITY_EASING carries `{tgaToday, tgaSma20}`. Keep the
 * map generic (`Record<string, number | null>`) so the tooltip
 * component can iterate without per-signal branching.
 */
export type SignalDetail = {
  state: SignalState;
  /** Raw input values used in the threshold evaluation. Keys vary per signal. */
  inputs: Record<string, number | null>;
  /** Human-readable formula text for the UI tooltip. */
  threshold: string;
};

/**
 * Output of {@link computeSignals}. `active` is the subset of 8 signals
 * whose state is "active"; `unknown` captures those whose inputs were
 * missing so the UI can surface an explicit amber chip rather than
 * silently treating them as inactive.
 *
 * `perSignal` is the complete map — consumers that want to render every
 * signal (active + inactive + unknown) read from this; consumers that
 * only care about counts (alignment_count = active.length) read `active`.
 */
export type SignalComputation = {
  active: SignalName[];
  unknown: SignalName[];
  perSignal: Record<SignalName, SignalDetail>;
  signalRulesVersion: typeof SIGNAL_RULES_VERSION;
};

/**
 * Shape of the input bundle consumed by {@link computeSignals}. The
 * loader (`src/lib/data/signals.ts::loadSignalInputs`) queries
 * `indicator_readings` / `onchain_readings` / `technical_readings` and
 * populates each field, using `null` whenever a reading is missing or
 * stale.
 *
 * History-array conventions:
 * - `bamlH0A0HYM2History`: oldest-first (chronological), length ≥ 7
 *   ideally. Values are the BAMLH0A0HYM2 daily observations over the
 *   last 7 days EXCLUDING today. Today's value is passed separately as
 *   `bamlH0A0HYM2Today` so the evaluator can compute `max(last_7d)`
 *   cleanly.
 * - `wdtgalHistory`: oldest-first, length ≥ 20 ideally. The last 20
 *   non-null entries (excluding today) form the 20-day SMA denominator.
 * - `spyMacdLine` / `spyMacdSignal`: oldest-first, chronologically
 *   aligned pair. At least `N + 1 = 8` pairs needed to detect a
 *   bullish cross within the last 7 daily transitions.
 */
export type SignalInputs = {
  /** VIX close (daily). Input to EXTREME_FEAR (OR-arm 1). */
  vix: number | null;
  /** CNN Fear & Greed raw 0-100 (0 = extreme fear). Input to EXTREME_FEAR (OR-arm 2). */
  cnnFg: number | null;
  /** SPY disparity = close/MA200 - 1. Input to DISLOCATION (OR-arm 1). */
  spyDisparity: number | null;
  /** QQQ disparity = close/MA200 - 1. Input to DISLOCATION (OR-arm 2). */
  qqqDisparity: number | null;
  /** FRED ICSA (initial unemployment claims). Input to ECONOMY_INTACT (AND-arm 1). */
  icsa: number | null;
  /** FRED SAHMCURRENT (Sahm recession indicator). Input to ECONOMY_INTACT (AND-arm 2). */
  sahmCurrent: number | null;
  /** FRED BAMLH0A0HYM2 today. Input to SPREAD_REVERSAL (numerator). */
  bamlH0A0HYM2Today: number | null;
  /** FRED BAMLH0A0HYM2 last-7-day history excluding today, oldest-first. */
  bamlH0A0HYM2History: readonly (number | null)[];
  /** FRED WDTGAL today. Input to LIQUIDITY_EASING (numerator). */
  wdtgalToday: number | null;
  /** FRED WDTGAL last-20-day history excluding today, oldest-first. Nulls allowed and filtered. */
  wdtgalHistory: readonly (number | null)[];
  /** SPY MACD-line history, oldest-first. Aligned with spyMacdSignal. */
  spyMacdLine: readonly (number | null)[];
  /** SPY MACD-signal-line history, oldest-first. Aligned with spyMacdLine. */
  spyMacdSignal: readonly (number | null)[];
  /** MVRV Z-Score (latest). Input to CRYPTO_UNDERVALUED. */
  mvrvZ: number | null;
  /** SOPR (latest). Input to CAPITULATION. */
  sopr: number | null;
};

// ---------------------------------------------------------------------------
// Per-signal evaluators — all pure, all return SignalDetail
// ---------------------------------------------------------------------------

/**
 * EXTREME_FEAR = `VIX ≥ 35 || CNN_FG < 25` (blueprint §4.5, PRD §10.4).
 *
 * Null semantics: OR-logic with graceful degradation.
 *   - BOTH inputs null → "unknown".
 *   - One null, the other fires its threshold → "active".
 *   - One null, the other does NOT fire → "inactive" (the null arm
 *     cannot rescue the OR; only a confirmed non-firing arm plus the
 *     other arm's presence is an "inactive" finding).
 *
 * Actually — with one arm null and the other below threshold, we still
 * know the whole OR is "inactive" from the non-null arm's perspective
 * only if the OR could not have fired via the missing arm. Since we
 * can't know, conservatively we still return "inactive" ONLY when the
 * non-null arm is non-firing; however a stricter reading would keep it
 * "unknown" in that case. Blueprint §10.4 note "EXTREME_FEAR degrades
 * gracefully" is explicit about the "active via one arm" direction but
 * silent on the asymmetric-null-inactive direction. We follow the
 * pragmatic path: if at least one arm is confirmed non-firing and the
 * other arm is missing, we return "unknown" — consistent with the
 * tenet-1 bias toward loud failure.
 */
export function evaluateExtremeFear(
  vix: number | null,
  cnnFg: number | null,
): SignalDetail {
  const threshold = "VIX >= 35 || CNN_FG < 25";
  const inputs = { vix, cnnFg };

  if (vix === null && cnnFg === null) {
    return { state: "unknown", inputs, threshold };
  }

  const vixFires = vix !== null && vix >= 35;
  const cnnFires = cnnFg !== null && cnnFg < 25;

  if (vixFires || cnnFires) {
    return { state: "active", inputs, threshold };
  }

  // Neither arm fires. If one arm is null, we can't rule out the OR
  // firing via the unseen arm — surface as "unknown" per the tenet-1
  // loud-failure bias. Both arms present and non-firing → "inactive".
  if (vix === null || cnnFg === null) {
    return { state: "unknown", inputs, threshold };
  }
  return { state: "inactive", inputs, threshold };
}

/**
 * DISLOCATION = `SPY.disparity ≤ -0.25 || QQQ.disparity ≤ -0.25`
 * (blueprint §4.5).
 *
 * Same null-semantics shape as EXTREME_FEAR: BOTH null → "unknown";
 * one fires → "active"; one null + the other not firing → "unknown".
 */
export function evaluateDislocation(
  spyDisparity: number | null,
  qqqDisparity: number | null,
): SignalDetail {
  const threshold = "SPY.disparity <= -0.25 || QQQ.disparity <= -0.25";
  const inputs = { spyDisparity, qqqDisparity };

  if (spyDisparity === null && qqqDisparity === null) {
    return { state: "unknown", inputs, threshold };
  }

  const spyFires = spyDisparity !== null && spyDisparity <= -0.25;
  const qqqFires = qqqDisparity !== null && qqqDisparity <= -0.25;

  if (spyFires || qqqFires) {
    return { state: "active", inputs, threshold };
  }

  if (spyDisparity === null || qqqDisparity === null) {
    return { state: "unknown", inputs, threshold };
  }
  return { state: "inactive", inputs, threshold };
}

/**
 * ECONOMY_INTACT = `ICSA < 300000 && SAHMCURRENT < 0.5` (blueprint §4.5).
 *
 * AND-logic: EITHER input null → "unknown" (the AND demands both halves).
 */
export function evaluateEconomyIntact(
  icsa: number | null,
  sahmCurrent: number | null,
): SignalDetail {
  const threshold = "ICSA < 300000 && SAHMCURRENT < 0.5";
  const inputs = { icsa, sahmCurrent };

  if (icsa === null || sahmCurrent === null) {
    return { state: "unknown", inputs, threshold };
  }
  if (icsa < 300_000 && sahmCurrent < 0.5) {
    return { state: "active", inputs, threshold };
  }
  return { state: "inactive", inputs, threshold };
}

/**
 * SPREAD_REVERSAL = `BAMLH0A0HYM2_today >= 4 && BAMLH0A0HYM2_today < max(last_7d)`
 * (blueprint §4.5).
 *
 * Requires:
 *   - `bamlToday` non-null, AND
 *   - at least 7 non-null history values (the "last 7d" window is a
 *     hard requirement — the max reference is undefined otherwise).
 *
 * Any null in the history array collapses to "unknown" because we
 * cannot compute `max` on partial data without risking a false
 * negative (a missing high day could mask the "not below max"
 * condition).
 */
export function evaluateSpreadReversal(
  bamlToday: number | null,
  bamlHistory7d: readonly (number | null)[],
): SignalDetail {
  const threshold = "BAMLH0A0HYM2_today >= 4 && BAMLH0A0HYM2_today < max(last_7d)";
  const maxLast7d =
    bamlHistory7d.length >= 7 &&
    bamlHistory7d.every((v): v is number => v !== null && Number.isFinite(v))
      ? Math.max(...(bamlHistory7d as number[]))
      : null;
  const inputs = { bamlToday, maxLast7d };

  if (bamlToday === null) {
    return { state: "unknown", inputs, threshold };
  }
  if (maxLast7d === null) {
    return { state: "unknown", inputs, threshold };
  }
  if (bamlToday >= 4 && bamlToday < maxLast7d) {
    return { state: "active", inputs, threshold };
  }
  return { state: "inactive", inputs, threshold };
}

/**
 * LIQUIDITY_EASING = `TGA_today < TGA_20d_MA` (blueprint §4.5).
 *
 * 20-day SMA computed over the LAST 20 non-null history values
 * (excluding today). If `tgaToday` is null or fewer than 20 usable
 * history values are available, returns "unknown".
 */
export function evaluateLiquidityEasing(
  tgaToday: number | null,
  tgaHistory20d: readonly (number | null)[],
): SignalDetail {
  const threshold = "TGA_today < SMA20(TGA)";
  const usable = tgaHistory20d.filter(
    (v): v is number => v !== null && Number.isFinite(v),
  );
  // Take the last 20 usable values (oldest-first history → tail-slice)
  // for the SMA. Slice internally so callers can pass larger windows
  // without silently widening the SMA.
  const window = usable.slice(-20);
  const sma20 =
    window.length >= 20
      ? window.reduce((acc, v) => acc + v, 0) / window.length
      : null;
  const inputs = { tgaToday, sma20 };

  if (tgaToday === null || sma20 === null) {
    return { state: "unknown", inputs, threshold };
  }
  if (tgaToday < sma20) {
    return { state: "active", inputs, threshold };
  }
  return { state: "inactive", inputs, threshold };
}

/**
 * MOMENTUM_TURN = SPY MACD bullish cross within last `withinDays` (= 7
 * per blueprint §4.5) daily transitions.
 *
 * Requires aligned `spyMacdLine` + `spyMacdSignal` arrays oldest-first
 * with length ≥ `withinDays + 1` and all latest entries non-null on
 * both sides. We defer the actual cross detection to
 * {@link macdBullishCrossWithin}, converting the pair of history arrays
 * into the `MacdResult[]` shape it expects.
 *
 * `inputs` surfaces the last two valid MACD-line / signal-line pairs
 * that would participate in the most recent transition — `currentMacd`
 * / `currentSignal` / `previousMacd` / `previousSignal`. The UI tooltip
 * (Step 8.5) uses these to show the user "MACD 0.12 vs signal 0.08
 * today, -0.03 vs 0.05 yesterday → bullish cross". If fewer than two
 * valid pairs exist (short or null-padded histories) the map is empty
 * and the state is "unknown". Configuration knobs (`withinDays`,
 * history length) are intentionally NOT stuffed into `inputs` — those
 * are evaluator metadata, not raw inputs.
 */
export function evaluateMomentumTurn(
  macdLineHistory: readonly (number | null)[],
  macdSignalHistory: readonly (number | null)[],
  withinDays = 7,
): SignalDetail {
  const threshold = `SPY MACD bullish cross within last ${withinDays} days`;

  // Alignment requirement: both histories same length.
  if (macdLineHistory.length !== macdSignalHistory.length) {
    return { state: "unknown", inputs: {}, threshold };
  }
  // Need at least `withinDays + 1` entries for `withinDays` transitions.
  if (macdLineHistory.length < withinDays + 1) {
    return { state: "unknown", inputs: {}, threshold };
  }

  // Build MacdResult[]. Any pair with either side null is treated as
  // `null` — `macdBullishCrossWithin` skips null-adjacent transitions.
  const series: (MacdResult | null)[] = [];
  for (let i = 0; i < macdLineHistory.length; i++) {
    const line = macdLineHistory[i];
    const signal = macdSignalHistory[i];
    if (line === null || signal === null) {
      series.push(null);
      continue;
    }
    series.push({ macd: line, signal, histogram: line - signal });
  }

  // Locate the last two valid (macd, signal) pairs — chronologically
  // "current" and "previous" — for the tooltip. If we can't find two,
  // leave `inputs` empty; `state` will still be decided by the
  // adjacent-pair / cross checks below.
  let currentMacd: number | null = null;
  let currentSignal: number | null = null;
  let previousMacd: number | null = null;
  let previousSignal: number | null = null;
  for (let i = series.length - 1; i >= 0; i--) {
    const s = series[i];
    if (s === null) continue;
    if (currentMacd === null) {
      currentMacd = s.macd;
      currentSignal = s.signal;
    } else {
      previousMacd = s.macd;
      previousSignal = s.signal;
      break;
    }
  }
  const inputs: Record<string, number | null> =
    currentMacd !== null && previousMacd !== null
      ? { currentMacd, currentSignal, previousMacd, previousSignal }
      : {};

  // Extra safety: the last `withinDays + 1` entries MUST contain at
  // least 2 non-null adjacent pairs to be able to detect a cross at
  // all; otherwise surface "unknown" rather than a misleading
  // "inactive" (tenet 1).
  const tail = series.slice(-(withinDays + 1));
  let hasAnyAdjacentPair = false;
  for (let i = 1; i < tail.length; i++) {
    if (tail[i - 1] !== null && tail[i] !== null) {
      hasAnyAdjacentPair = true;
      break;
    }
  }
  if (!hasAnyAdjacentPair) {
    return { state: "unknown", inputs, threshold };
  }

  const crossed = macdBullishCrossWithin(series, withinDays);
  return {
    state: crossed ? "active" : "inactive",
    inputs,
    threshold,
  };
}

/**
 * CRYPTO_UNDERVALUED = `MVRV_Z <= 0` (blueprint §4.5; helper from
 * `onchain.ts::isCryptoUndervalued`).
 *
 * Null → "unknown".
 */
export function evaluateCryptoUndervalued(mvrvZ: number | null): SignalDetail {
  const threshold = "MVRV_Z <= 0";
  const inputs = { mvrvZ };
  if (mvrvZ === null) {
    return { state: "unknown", inputs, threshold };
  }
  return {
    state: isCryptoUndervalued(mvrvZ) ? "active" : "inactive",
    inputs,
    threshold,
  };
}

/**
 * CAPITULATION = `SOPR < 1` (blueprint §4.5; helper from
 * `onchain.ts::isCapitulation`).
 *
 * Null → "unknown".
 */
export function evaluateCapitulation(sopr: number | null): SignalDetail {
  const threshold = "SOPR < 1";
  const inputs = { sopr };
  if (sopr === null) {
    return { state: "unknown", inputs, threshold };
  }
  return {
    state: isCapitulation(sopr) ? "active" : "inactive",
    inputs,
    threshold,
  };
}

// ---------------------------------------------------------------------------
// Engine entry point + per-asset mapping
// ---------------------------------------------------------------------------

/**
 * Compute all 8 signals given an input bundle. Deterministic, pure.
 *
 * Output shape:
 *   - `active`   : names where state === "active" (ordered per ALL_SIGNALS)
 *   - `unknown`  : names where state === "unknown" (ordered per ALL_SIGNALS)
 *   - `perSignal`: complete map from name → SignalDetail (all 8 keys)
 *   - `signalRulesVersion`: the SIGNAL_RULES_VERSION constant so the
 *     persisted row's rules version matches the engine that generated it
 *
 * The cron tail-call at Step 7.5 passes this straight to
 * `writeSignalEvents`, which stores:
 *   - `active_signals`   ← computation.active          (JSONB array)
 *   - `alignment_count`  ← computation.active.length   (cached for index-friendly queries)
 *   - `per_signal_detail`← computation.perSignal       (JSONB object)
 *   - `signal_rules_version` ← computation.signalRulesVersion
 */
export function computeSignals(inputs: SignalInputs): SignalComputation {
  const perSignal: Record<SignalName, SignalDetail> = {
    EXTREME_FEAR: evaluateExtremeFear(inputs.vix, inputs.cnnFg),
    DISLOCATION: evaluateDislocation(inputs.spyDisparity, inputs.qqqDisparity),
    ECONOMY_INTACT: evaluateEconomyIntact(inputs.icsa, inputs.sahmCurrent),
    SPREAD_REVERSAL: evaluateSpreadReversal(
      inputs.bamlH0A0HYM2Today,
      inputs.bamlH0A0HYM2History,
    ),
    LIQUIDITY_EASING: evaluateLiquidityEasing(
      inputs.wdtgalToday,
      inputs.wdtgalHistory,
    ),
    MOMENTUM_TURN: evaluateMomentumTurn(inputs.spyMacdLine, inputs.spyMacdSignal),
    CRYPTO_UNDERVALUED: evaluateCryptoUndervalued(inputs.mvrvZ),
    CAPITULATION: evaluateCapitulation(inputs.sopr),
  };

  const active: SignalName[] = [];
  const unknown: SignalName[] = [];
  for (const name of ALL_SIGNALS) {
    if (perSignal[name].state === "active") active.push(name);
    else if (perSignal[name].state === "unknown") unknown.push(name);
  }

  return {
    active,
    unknown,
    perSignal,
    signalRulesVersion: SIGNAL_RULES_VERSION,
  };
}

/**
 * Per-asset-type signal membership per blueprint §4.5 lines 292–297.
 *
 * - `us_equity` / `common`: all 6 base signals.
 * - `crypto`: 5 base (MOMENTUM_TURN excluded) + `CRYPTO_UNDERVALUED` +
 *   `CAPITULATION` = 7 total. Per blueprint §4.5 line 294:
 *   *"MOMENTUM_TURN replaced by crypto MACD on BTC. Add crypto-specific
 *   CRYPTO_UNDERVALUED = MVRV_Z ≤ 0 and CAPITULATION = SOPR < 1.
 *   Total 7 signals on the crypto asset page."* The SPY MACD cross
 *   has no meaning on a crypto asset page, so we exclude MOMENTUM_TURN
 *   outright here. Phase 3 replaces this exclusion with a BTC-MACD
 *   variant (different input series, same shape).
 * - `kr_equity`: 5 base signals — `DISLOCATION` is excluded (SPY/QQQ
 *   disparity is a US-specific technical signal; KR equities use their
 *   own regional overlay instead).
 * - `global_etf`: 5 base signals — `MOMENTUM_TURN` is excluded (§4.5
 *   rationale: the SPY MACD cross is a US-momentum-specific signal and
 *   is double-counted if applied to global diversified ETFs which
 *   already span multiple regions and sectors).
 *
 * This is a PURE LOOKUP — the function does no work beyond returning
 * the right subset of {@link ALL_SIGNALS}. Callers use this to filter
 * `computation.active` / `.unknown` / `.perSignal` down to the
 * asset-type-relevant set before rendering the signal-card UI.
 */
export function signalsForAssetType(
  assetType: AssetType,
): readonly SignalName[] {
  switch (assetType) {
    case "us_equity":
    case "common":
      return BASE_SIGNALS;
    case "crypto":
      return [
        ...BASE_SIGNALS.filter((s) => s !== "MOMENTUM_TURN"),
        ...CRYPTO_EXTRA_SIGNALS,
      ];
    case "kr_equity":
      return BASE_SIGNALS.filter((s) => s !== "DISLOCATION");
    case "global_etf":
      return BASE_SIGNALS.filter((s) => s !== "MOMENTUM_TURN");
  }
}
