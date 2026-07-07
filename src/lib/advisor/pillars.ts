import type {
  MacroInputs,
  OnchainInputs,
  PillarEvaluation,
  PillarStance,
  SentimentInputs,
  TrendInputs,
  VolatilityInputs,
} from "./types";

/**
 * Evidence pillars — each converts raw indicator values into a signed
 * vote on the 조정(할인) vs 추세전환 question.
 *
 * Score convention: [-1, 1], positive = "this decline looks like a
 * correction / discount", negative = "this looks like a trend
 * reversal". `strength` is informational coverage (how many of the
 * pillar's inputs were present), NOT conviction — conviction lives in
 * the magnitude of `score`.
 *
 * Thresholds are provisional, literature-anchored round numbers (the
 * same philosophy as the regime rule table in
 * `src/lib/score-engine/regime/rules.ts`): VIX 30 panic line, F&G 25/75
 * extreme bands, Sahm 0.5 recession trigger, T10Y2Y 0 inversion line,
 * HY spread 5%p stress line, MVRV-Z 0/4 value/overheat bands. They are
 * inputs to iteration, not truths.
 */

function clampSigned(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(-1, value));
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function stanceOf(score: number): PillarStance {
  if (score >= 0.15) return "discount";
  if (score <= -0.15) return "reversal";
  return "neutral";
}

function missingEvaluation(
  pillar: PillarEvaluation["pillar"],
  missing: string[],
): PillarEvaluation {
  return {
    pillar,
    stance: "neutral",
    score: 0,
    strength: 0,
    reasonKo: `입력 누락: ${missing.join(", ")}`,
    missingInputs: missing,
  };
}

/**
 * Trend pillar — is the long-term uptrend structurally intact?
 *
 * Above the 200-day MA with a golden-cross structure, a decline is
 * far more often a correction; below the 200-day MA with a
 * death-cross, declines extend. Continuous gradient on the
 * price/MA200 ratio (±7% band) plus a ±0.2 cross-structure bonus.
 */
export function evaluateTrendPillar(inputs: TrendInputs): PillarEvaluation {
  const missing: string[] = [];
  if (inputs.close === null) missing.push("close");
  if (inputs.ma200 === null) missing.push("ma200");
  if (missing.length > 0) return missingEvaluation("trend", missing);

  const close = inputs.close as number;
  const ma200 = inputs.ma200 as number;
  if (ma200 <= 0) return missingEvaluation("trend", ["ma200"]);

  const ratio = close / ma200;
  const base = clampSigned((ratio - 1) / 0.07) * 0.8;

  let crossBonus = 0;
  let crossNoteKo = "";
  const ma50Missing = inputs.ma50 === null;
  if (!ma50Missing) {
    const ma50 = inputs.ma50 as number;
    crossBonus = ma50 >= ma200 ? 0.2 : -0.2;
    crossNoteKo = ma50 >= ma200 ? " · 50일선>200일선(정배열)" : " · 50일선<200일선(역배열)";
  }

  const score = clampSigned(base + crossBonus);
  const pctVs200 = ((ratio - 1) * 100).toFixed(1);
  const reasonKo =
    ratio >= 1
      ? `200일선 위 ${pctVs200}% — 장기 추세 유지${crossNoteKo}`
      : `200일선 아래 ${pctVs200}% — 추세 이탈${crossNoteKo}`;

  return {
    pillar: "trend",
    stance: stanceOf(score),
    score,
    strength: ma50Missing ? 0.7 : 1,
    reasonKo,
    missingInputs: ma50Missing ? ["ma50"] : [],
  };
}

/**
 * Sentiment pillar — contrarian Fear & Greed read.
 *
 * Extreme fear (≤25) during a decline historically marks capitulation
 * zones → discount evidence. Extreme greed (≥75) while price falls
 * suggests distribution → mild reversal evidence. Mid-band carries no
 * information.
 */
export function evaluateSentimentPillar(
  inputs: SentimentInputs,
): PillarEvaluation {
  if (inputs.fearGreed === null)
    return missingEvaluation("sentiment", ["fearGreed"]);

  const fg = inputs.fearGreed;
  let score = 0;
  let reasonKo = `공포·탐욕지수 ${fg.toFixed(0)} — 중립 구간`;
  if (fg <= 25) {
    score = clamp01((25 - fg) / 25);
    reasonKo = `공포·탐욕지수 ${fg.toFixed(0)} — 극단적 공포(과매도), 역발상 매수 신호`;
  } else if (fg >= 75) {
    score = -clamp01((fg - 75) / 25) * 0.5;
    reasonKo = `공포·탐욕지수 ${fg.toFixed(0)} — 과열(탐욕) 구간, 조정 여지`;
  }

  return {
    pillar: "sentiment",
    stance: stanceOf(score),
    score: clampSigned(score),
    strength: 1,
    reasonKo,
    missingInputs: [],
  };
}

/**
 * VIX week-over-week move (points) below which a ≥30 spike counts as
 * "cooling" (peak passed), and above which it counts as "still
 * building". Symmetric band; |wow| under the threshold is direction-
 * neutral.
 */
export const VIX_TURN_EPS = 2;

/**
 * Volatility pillar — HOW the market is falling.
 *
 * A VIX spike ≥30 is panic capitulation, which historically clusters
 * near correction bottoms → discount evidence. Direction refines the
 * spike read: a ≥30 VIX already FALLING week-over-week means the
 * panic peak is likely behind (stronger discount evidence); one still
 * RISING means the knife is still falling (evidence tempered). A calm
 * VIX (<18) paired with a ≥10% drawdown is the "slow bleed" pattern —
 * declines without fear are more often orderly repricing (reversal
 * evidence). The 18-30 band is elevated stress, mildly negative.
 */
export function evaluateVolatilityPillar(
  inputs: VolatilityInputs,
): PillarEvaluation {
  if (inputs.vix === null) return missingEvaluation("volatility", ["vix"]);

  const vix = inputs.vix;
  const dd = inputs.drawdownPct;
  const wow = inputs.vixWow;

  const missingInputs: string[] = [];
  if (dd === null) missingInputs.push("drawdownPct");
  if (wow === null) missingInputs.push("vixWow");

  let score: number;
  let reasonKo: string;
  if (vix >= 30) {
    score = 0.4 + clamp01((vix - 30) / 15) * 0.3;
    reasonKo = `VIX ${vix.toFixed(1)} — 패닉 매도 국면(역사적으로 바닥 부근에서 빈발)`;
    if (wow !== null && wow <= -VIX_TURN_EPS) {
      score += 0.15;
      reasonKo += ` · 주간 ${wow.toFixed(1)}p 하락, 공포 정점 통과 신호`;
    } else if (wow !== null && wow >= VIX_TURN_EPS) {
      score -= 0.15;
      reasonKo += ` · 주간 +${wow.toFixed(1)}p 상승, 공포 확산 진행 중`;
    }
  } else if (vix >= 18) {
    score = -0.2 * clamp01((vix - 18) / 12);
    reasonKo = `VIX ${vix.toFixed(1)} — 변동성 상승 구간`;
  } else if (dd !== null && dd >= 0.1) {
    score = -0.4;
    reasonKo = `VIX ${vix.toFixed(1)} 안정 속 ${(dd * 100).toFixed(0)}% 하락 — 공포 없는 완만한 하락(추세 이탈 주의)`;
  } else {
    score = 0;
    reasonKo = `VIX ${vix.toFixed(1)} — 변동성 안정`;
  }

  return {
    pillar: "volatility",
    stance: stanceOf(score),
    score: clampSigned(score),
    strength: 1,
    reasonKo,
    missingInputs,
  };
}

/**
 * HY-spread thresholds (percentage points), aligned with the "미국
 * 주식 그냥 사면 손해" methodology this product implements: ≤3 안정,
 * 3–4 주의, ≥4 위험. HY_TURN_EPS is the week-over-week move that
 * counts as a direction change — the video's buy trigger is "4~5까지
 * 치솟았다가 주간 기준으로 꺾일 때".
 */
export const HY_STABLE_CEILING = 3;
export const HY_DANGER_FLOOR = 4;
export const HY_TURN_EPS = 0.1;

/**
 * Macro pillar — the anchor of the verdict. A decline against a
 * healthy macro backdrop is a discount; a decline WITH deteriorating
 * macro (Sahm trigger, curve inversion, HY-spread blowout) is how
 * bear markets start. Averages whatever sub-inputs are available;
 * strength = coverage.
 *
 * The HY-spread sub-read is direction-aware: a spread ≥4 that is
 * still RISING is credit stress building (strong reversal evidence),
 * but a spread ≥4 that has TURNED DOWN week-over-week is the
 * historical capitulation-passed buy window (strong discount
 * evidence). Level alone cannot tell these apart.
 */
export function evaluateMacroPillar(inputs: MacroInputs): PillarEvaluation {
  const subScores: number[] = [];
  const notes: string[] = [];
  const missing: string[] = [];

  if (inputs.macroScore !== null) {
    subScores.push(clampSigned((inputs.macroScore - 50) / 50));
    notes.push(`매크로 종합 ${inputs.macroScore.toFixed(0)}점`);
  } else missing.push("macroScore");

  if (inputs.sahm !== null) {
    if (inputs.sahm >= 0.5) {
      subScores.push(-1);
      notes.push(`삼 룰 ${inputs.sahm.toFixed(2)} — 침체 트리거 발동`);
    } else {
      subScores.push(clamp01((0.5 - inputs.sahm) / 0.5) * 0.4);
      notes.push(`삼 룰 ${inputs.sahm.toFixed(2)}(침체 신호 없음)`);
    }
  } else missing.push("sahm");

  if (inputs.t10y2y !== null) {
    if (inputs.t10y2y >= 0) {
      subScores.push(clamp01(inputs.t10y2y / 0.5) * 0.4);
      notes.push(`장단기금리차 +${inputs.t10y2y.toFixed(2)}%p(정상)`);
    } else {
      subScores.push(clampSigned(inputs.t10y2y / 1.0));
      notes.push(`장단기금리차 ${inputs.t10y2y.toFixed(2)}%p — 역전(침체 경고)`);
    }
  } else missing.push("t10y2y");

  if (inputs.hySpread !== null) {
    const spread = inputs.hySpread;
    const wow = inputs.hySpreadWow;
    const wowLabel =
      wow === null ? "" : ` (주간 ${wow >= 0 ? "+" : ""}${wow.toFixed(2)}%p)`;

    if (spread >= HY_DANGER_FLOOR) {
      if (wow !== null && wow <= -HY_TURN_EPS) {
        // 정점 통과: the video's buy trigger — spread spiked into the
        // danger zone and has turned down on a weekly basis.
        subScores.push(0.7);
        notes.push(
          `하이일드 스프레드 ${spread.toFixed(1)}%p${wowLabel} — 고점에서 꺾임, 역사적 매수 신호 구간`,
        );
      } else if (wow !== null && wow >= HY_TURN_EPS) {
        subScores.push(-(0.5 + clamp01((spread - HY_DANGER_FLOOR) / 3) * 0.5));
        notes.push(
          `하이일드 스프레드 ${spread.toFixed(1)}%p${wowLabel} — 신용 스트레스 확대 중`,
        );
      } else {
        subScores.push(-(0.4 + clamp01((spread - HY_DANGER_FLOOR) / 3) * 0.6));
        notes.push(
          `하이일드 스프레드 ${spread.toFixed(1)}%p${wowLabel} — 신용 스트레스`,
        );
      }
    } else if (spread >= HY_STABLE_CEILING) {
      let sub = -0.2 * (spread - HY_STABLE_CEILING);
      if (wow !== null && wow <= -HY_TURN_EPS) sub += 0.1;
      else if (wow !== null && wow >= HY_TURN_EPS) sub -= 0.1;
      subScores.push(clampSigned(sub));
      notes.push(`하이일드 스프레드 ${spread.toFixed(1)}%p${wowLabel} — 주의 구간`);
    } else {
      subScores.push(clamp01((HY_STABLE_CEILING - spread) / 1.5) * 0.3);
      notes.push(`하이일드 스프레드 ${spread.toFixed(1)}%p${wowLabel} — 안정`);
    }

    if (wow === null) missing.push("hySpreadWow");
  } else missing.push("hySpread");

  if (subScores.length === 0) return missingEvaluation("macro", missing);

  const score = clampSigned(
    subScores.reduce((sum, s) => sum + s, 0) / subScores.length,
  );

  return {
    pillar: "macro",
    stance: stanceOf(score),
    score,
    strength: subScores.length / 4,
    reasonKo: notes.join(" · "),
    missingInputs: missing,
  };
}

/**
 * Onchain pillar (crypto only) — cycle-position valuation.
 *
 * MVRV-Z below 0 marks historical accumulation zones (discount);
 * above 4 marks cycle tops (reversal risk). SOPR below 1 = holders
 * selling at a loss = capitulation (discount evidence).
 */
export function evaluateOnchainPillar(inputs: OnchainInputs): PillarEvaluation {
  const subScores: number[] = [];
  const notes: string[] = [];
  const missing: string[] = [];

  if (inputs.mvrvZ !== null) {
    const z = inputs.mvrvZ;
    if (z <= 0) {
      subScores.push(0.5 + clamp01(-z / 0.5) * 0.5);
      notes.push(`MVRV-Z ${z.toFixed(2)} — 역사적 저평가 구간`);
    } else if (z >= 4) {
      subScores.push(-(0.4 + clamp01((z - 4) / 3) * 0.6));
      notes.push(`MVRV-Z ${z.toFixed(2)} — 사이클 고점 경고`);
    } else {
      subScores.push(clampSigned((2 - z) / 2) * 0.3);
      notes.push(`MVRV-Z ${z.toFixed(2)} — 중립 구간`);
    }
  } else missing.push("mvrvZ");

  if (inputs.sopr !== null) {
    const sopr = inputs.sopr;
    if (sopr < 1) {
      subScores.push(clamp01((1 - sopr) / 0.05) * 0.6);
      notes.push(`SOPR ${sopr.toFixed(3)} — 손실 실현 매도(항복 국면)`);
    } else {
      subScores.push(-clamp01((sopr - 1.05) / 0.05) * 0.3);
      notes.push(`SOPR ${sopr.toFixed(3)}`);
    }
  } else missing.push("sopr");

  if (subScores.length === 0) return missingEvaluation("onchain", missing);

  const score = clampSigned(
    subScores.reduce((sum, s) => sum + s, 0) / subScores.length,
  );

  return {
    pillar: "onchain",
    stance: stanceOf(score),
    score,
    strength: subScores.length / 2,
    reasonKo: notes.join(" · "),
    missingInputs: missing,
  };
}
