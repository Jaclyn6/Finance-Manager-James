import { clamp } from "../normalize";
import type { RegimeFeatures, RegimeLabel, RuleEvaluation } from "./types";

/**
 * Frozen rule table for the regime classifier — Phase 3.1 Step 5.
 *
 * Provisional thresholds per blueprint §2.2. Each rule's `evaluate`
 * returns a `RuleEvaluation` with:
 *
 *  - `matched`: true iff every binary sub-condition is on the matched
 *    side of its threshold AND every required input was non-null.
 *  - `strength`: a soft 0-1 score = average of clamped sub-scores. This
 *    gives the classifier a gradient (so two matched rules can be
 *    ranked) rather than a binary cliff at threshold.
 *  - `reasonKo`: human-readable Korean explanation for /regime tooltip.
 *
 * If any required input for a rule is null, `matched=false` and
 * `strength=0` (loud failure — missing inputs cannot vote). The
 * `reasonKo` mentions which inputs were missing so the audit trail
 * surfaces the gap.
 *
 * Rules are pure functions — no closures over module-level mutable
 * state. The exported {@link RULES} array is `as const` and treated
 * as read-only by all callers.
 */

interface RuleDefinition {
  label: RegimeLabel;
  evaluate(features: RegimeFeatures): RuleEvaluation;
}

/** Clamps to [0, 1] with non-finite (NaN/Infinity) collapsing to 0.
 * Wraps {@link clamp} from `normalize.ts` — which intentionally does NOT
 * guard against non-finite values for the indicator-engine path — and
 * adds the regime-rule's required behavior of treating "no signal"
 * (e.g. divide-by-zero in a sub-strength denominator) as 0 strength
 * rather than NaN propagating into `RuleEvaluation.strength`. */
function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 1);
}

/**
 * Lists the names of any null-valued required inputs. Caller uses
 * this to short-circuit a rule with `matched=false`, `strength=0`
 * and a reason naming the missing inputs.
 */
function missingInputs(
  features: RegimeFeatures,
  required: ReadonlyArray<keyof RegimeFeatures>,
): string[] {
  const missing: string[] = [];
  for (const key of required) {
    if (features[key] === null) missing.push(String(key));
  }
  return missing;
}

const FEDFUNDS_EASING_THRESHOLD = -0.25;
const FEDFUNDS_NEUTRAL_BAND = 0.25;
const FEDFUNDS_TIGHTENING_THRESHOLD = 0.25;
const VIX_RISK_ON_EASING_CEILING = 20;
const VIX_RISK_ON_NEUTRAL_CEILING = 18;
const VIX_RISK_OFF_FLOOR = 25;
const SPY_TREND_LINE = 1.0;
const T10Y2Y_INVERSION_LINE = 0;
const ISM_CONTRACTION_LINE = 50;

/** Risk-on / easing: Fed cutting + low vol + uptrend. */
const RISK_ON_EASING: RuleDefinition = {
  label: "risk_on_easing",
  evaluate(features) {
    const required: ReadonlyArray<keyof RegimeFeatures> = [
      "fedfundsSlope",
      "vix",
      "spyTrendRatio",
    ];
    const missing = missingInputs(features, required);
    if (missing.length > 0) {
      return {
        rule: "risk_on_easing",
        matched: false,
        strength: 0,
        reasonKo: `입력 누락: ${missing.join(", ")}`,
      };
    }

    const fedfundsSlope = features.fedfundsSlope as number;
    const vix = features.vix as number;
    const spyTrendRatio = features.spyTrendRatio as number;

    // Sub-strengths per spec:
    //   fedfunds: (-fedfundsSlope - 0.25) / 1.0   clamped to [0,1]
    //   vix:     (20 - vix) / 5                   clamped to [0,1]
    //   spy:     (spyTrendRatio - 1.0) / 0.05     clamped to [0,1]
    const fedStrength = clamp01((-fedfundsSlope - 0.25) / 1.0);
    const vixStrength = clamp01((20 - vix) / 5);
    const spyStrength = clamp01((spyTrendRatio - 1.0) / 0.05);
    const strength = (fedStrength + vixStrength + spyStrength) / 3;

    const matched =
      fedfundsSlope < FEDFUNDS_EASING_THRESHOLD &&
      vix < VIX_RISK_ON_EASING_CEILING &&
      spyTrendRatio > SPY_TREND_LINE;

    return {
      rule: "risk_on_easing",
      matched,
      strength,
      reasonKo: `Fed 완화(slope ${fedfundsSlope.toFixed(2)}) · VIX ${vix.toFixed(1)} · SPY/MA200 ${spyTrendRatio.toFixed(3)}`,
    };
  },
};

/** Risk-on / neutral: stable rates + low vol + uptrend. */
const RISK_ON_NEUTRAL: RuleDefinition = {
  label: "risk_on_neutral",
  evaluate(features) {
    const required: ReadonlyArray<keyof RegimeFeatures> = [
      "fedfundsSlope",
      "vix",
      "spyTrendRatio",
    ];
    const missing = missingInputs(features, required);
    if (missing.length > 0) {
      return {
        rule: "risk_on_neutral",
        matched: false,
        strength: 0,
        reasonKo: `입력 누락: ${missing.join(", ")}`,
      };
    }

    const fedfundsSlope = features.fedfundsSlope as number;
    const vix = features.vix as number;
    const spyTrendRatio = features.spyTrendRatio as number;

    // Stability strength: 1 when slope is exactly 0, falling linearly to
    // 0 at |slope| = 0.25. Beyond the band, clamped to 0.
    const fedStability = clamp01(
      (FEDFUNDS_NEUTRAL_BAND - Math.abs(fedfundsSlope)) / FEDFUNDS_NEUTRAL_BAND,
    );
    const vixStrength = clamp01((VIX_RISK_ON_NEUTRAL_CEILING - vix) / 5);
    const spyStrength = clamp01((spyTrendRatio - SPY_TREND_LINE) / 0.05);
    const strength = (fedStability + vixStrength + spyStrength) / 3;

    const matched =
      Math.abs(fedfundsSlope) <= FEDFUNDS_NEUTRAL_BAND &&
      vix < VIX_RISK_ON_NEUTRAL_CEILING &&
      spyTrendRatio > SPY_TREND_LINE;

    return {
      rule: "risk_on_neutral",
      matched,
      strength,
      reasonKo: `금리 안정(slope ${fedfundsSlope.toFixed(2)}) · VIX ${vix.toFixed(1)} · SPY/MA200 ${spyTrendRatio.toFixed(3)}`,
    };
  },
};

/** Risk-off / tightening: Fed hiking + elevated vol. */
const RISK_OFF_TIGHTENING: RuleDefinition = {
  label: "risk_off_tightening",
  evaluate(features) {
    const required: ReadonlyArray<keyof RegimeFeatures> = ["fedfundsSlope", "vix"];
    const missing = missingInputs(features, required);
    if (missing.length > 0) {
      return {
        rule: "risk_off_tightening",
        matched: false,
        strength: 0,
        reasonKo: `입력 누락: ${missing.join(", ")}`,
      };
    }

    const fedfundsSlope = features.fedfundsSlope as number;
    const vix = features.vix as number;

    // Sub-strengths:
    //   fedfunds: (fedfundsSlope - 0.25) / 1.0    clamped to [0,1]
    //   vix:     (vix - 25) / 10                  clamped to [0,1]
    const fedStrength = clamp01((fedfundsSlope - 0.25) / 1.0);
    const vixStrength = clamp01((vix - 25) / 10);
    const strength = (fedStrength + vixStrength) / 2;

    const matched =
      fedfundsSlope > FEDFUNDS_TIGHTENING_THRESHOLD && vix > VIX_RISK_OFF_FLOOR;

    return {
      rule: "risk_off_tightening",
      matched,
      strength,
      reasonKo: `Fed 긴축(slope ${fedfundsSlope.toFixed(2)}) · VIX ${vix.toFixed(1)}`,
    };
  },
};

/** Risk-off / recession: yield-curve inverted + ISM contraction + downtrend. */
const RISK_OFF_RECESSION: RuleDefinition = {
  label: "risk_off_recession",
  evaluate(features) {
    const required: ReadonlyArray<keyof RegimeFeatures> = [
      "t10y2y",
      "ismProxy",
      "spyTrendRatio",
    ];
    const missing = missingInputs(features, required);
    if (missing.length > 0) {
      return {
        rule: "risk_off_recession",
        matched: false,
        strength: 0,
        reasonKo: `입력 누락: ${missing.join(", ")}`,
      };
    }

    const t10y2y = features.t10y2y as number;
    const ismProxy = features.ismProxy as number;
    const spyTrendRatio = features.spyTrendRatio as number;

    // Sub-strengths:
    //   t10y2y:  (-t10y2y) / 1.0                  clamped to [0,1]
    //   ism:     (50 - ismProxy) / 5              clamped to [0,1]
    //   spy:     (1.0 - spyTrendRatio) / 0.05     clamped to [0,1]
    // The t10y2y denominator spans the historically observed inversion
    // range (0 to ~-1.1% in 2022-2023, ~-0.5% in 2006-2007). A smaller
    // divisor (e.g. 0.5) saturates for any inversion deeper than -0.5
    // and provides no gradient in the deep-recession zone.
    const curveStrength = clamp01(-t10y2y / 1.0);
    const ismStrength = clamp01((ISM_CONTRACTION_LINE - ismProxy) / 5);
    const spyStrength = clamp01((SPY_TREND_LINE - spyTrendRatio) / 0.05);
    const strength = (curveStrength + ismStrength + spyStrength) / 3;

    const matched =
      t10y2y < T10Y2Y_INVERSION_LINE &&
      ismProxy < ISM_CONTRACTION_LINE &&
      spyTrendRatio < SPY_TREND_LINE;

    return {
      rule: "risk_off_recession",
      matched,
      strength,
      reasonKo: `장단기 역전(${t10y2y.toFixed(2)}) · ISM ${ismProxy.toFixed(1)} · SPY/MA200 ${spyTrendRatio.toFixed(3)}`,
    };
  },
};

/**
 * The frozen rule registry. `transition` is intentionally absent — it
 * is the residual label the classifier emits when no rule matches with
 * sufficient confidence; it has no positive rule of its own.
 */
export const RULES: ReadonlyArray<RuleDefinition> = [
  RISK_ON_EASING,
  RISK_ON_NEUTRAL,
  RISK_OFF_TIGHTENING,
  RISK_OFF_RECESSION,
] as const;
