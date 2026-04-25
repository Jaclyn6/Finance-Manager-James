/**
 * Beginner-friendly Korean glossary for all 23 Phase 2 indicators
 * (PRD §5 personas: 어머니 / 여자친구).
 *
 * Phase 2 dashboard surfaces 0-100 scores per indicator but no
 * human-readable explanation. This module is the canonical content
 * source for the glossary page (`/glossary`) and indicator popovers
 * across the dashboard. It is a PURE module (no `server-only`,
 * no DB) so it can be imported from both server and client
 * components.
 *
 * Coverage matches the four scoring layers + signal-only inputs:
 * - 7 macro composite (INDICATOR_CONFIG)
 * - 2 signal-only (PHASE2_FRED_SIGNAL_INPUTS)
 * - 2 regional overlay (PHASE2_FRED_REGIONAL_OVERLAY)
 * - 6 technical (per-ticker AV-derived)
 * - 5 on-chain (BTC + crypto sentiment)
 * - 1 news sentiment (Alpha Vantage)
 *
 * Bullish/bearish framing follows PRD §13.2: never a guarantee, always
 * "역사적으로 평균적으로 / 확률적으로". The glossary is education, not
 * advice. Source URLs are kept in sync with INDICATOR_CONFIG /
 * PHASE2_FRED_SIGNAL_INPUTS / PHASE2_FRED_REGIONAL_OVERLAY for the
 * 11 FRED series; technical / on-chain / news entries point to canonical
 * documentation per the spec.
 *
 * NOTE: This file does NOT modify INDICATOR_CONFIG. It is an additive
 * presentation layer — the score engine is unaffected.
 *
 * ─ 점수 투명성 (scoring transparency) — `scoreDirectionKo` /
 *   `scoringMethodKo` / `unitKo` ────────────────────────────────────
 *
 * 어머니/여자친구 페르소나가 점수를 보고 "이게 매수 신호야 매도 신호야?"
 * "19.3이 어떻게 50점이 됐어?" 두 가지 질문에 즉시 답할 수 있도록
 * 추가된 필드입니다. 톤은 친근한 존댓말, 통계 용어 금지 (z-score / 표준편차
 * / σ / 정규분포 / normalize 등은 사용하지 않습니다).
 */

export type IndicatorCategory =
  | "macro"
  | "macro_signal"
  | "regional_overlay"
  | "technical"
  | "onchain"
  | "sentiment";

export interface IndicatorGlossaryEntry {
  /** Canonical key matching INDICATOR_CONFIG / PHASE2_FRED_* / technical_readings.indicator_key etc. */
  key: string;
  /** Short Korean label. */
  labelKo: string;
  /** Source organization + URL for "데이터 출처" disclosure (PRD §16.2). */
  sourceName: string;
  sourceUrl: string;
  /** Which Phase 2 category this indicator feeds. Drives glossary page grouping. */
  category: IndicatorCategory;
  /** 1-line summary for popover (≤ 50 chars Korean). */
  shortKo: string;
  /** What the indicator measures + why it matters (1-2 sentences). */
  beginnerExplanationKo: string;
  /** "이 지표가 상승하면 ..." asset-allocation case (1-2 sentences). */
  bullishCaseKo: string;
  /** "이 지표가 하락하면 ..." asset-allocation case (1-2 sentences). */
  bearishCaseKo: string;
  /** Typical-range / threshold note (e.g. "보통 20-30, 35 이상이면 극단 공포"). */
  typicalRangeKo: string;
  /** Optional: caveats / blind spots — undefined = none authored. */
  caveatKo?: string;
  /**
   * 점수 방향성 — "값이 오를수록 점수가 어떻게 변하는지" 1-2 문장.
   * 통계 용어 금지. 정방향 / 거꾸로 보는 지표 표현 사용.
   */
  scoreDirectionKo: string;
  /**
   * 점수 계산 방식 — "지난 5년 흐름과 비교해 ~" 2-3 문장. 통계 용어 금지.
   * (z-score / 표준편차 / σ / 정규분포 / normalize 등 사용 금지.)
   */
  scoringMethodKo: string;
  /**
   * 원시값 단위 힌트 — ContributingIndicators 행과 popover에서
   * `${formatRawValue(rawValue)} ${unitKo}` 형태로 출력됩니다.
   * 단위가 필요 없는 무차원 지수는 빈 문자열을 사용하세요.
   */
  unitKo: string;
}

export const INDICATOR_GLOSSARY: Record<string, IndicatorGlossaryEntry> = {
  // ─────────────────────────── Macro (7) ──────────────────────────
  FEDFUNDS: {
    key: "FEDFUNDS",
    labelKo: "연방기금 실효금리",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/FEDFUNDS",
    category: "macro",
    shortKo: "미국 연준의 정책금리 — 자금 조달 비용의 기준",
    beginnerExplanationKo:
      "연준이 결정하는 미국 단기 정책금리로, 전 세계 자금 조달 비용의 기준이 되는 가장 중요한 거시 변수입니다. 금리가 높으면 기업 이익과 주식·암호화폐 같은 위험자산 가치가 할인되며, 낮으면 그 반대 효과가 나타납니다.",
    bullishCaseKo:
      "금리가 빠르게 하락할 때는 시장에 유동성이 풀리는 국면으로, 역사적으로 위험자산 비중을 늘리는 것이 평균적으로 유리했습니다. 채권 비중을 줄이고 주식·암호화폐 비중을 확대하는 전략이 권장됩니다.",
    bearishCaseKo:
      "금리가 가파르게 상승할 때는 자금 조달 비용이 커지고 밸류에이션 압박이 강해지는 국면이라 위험자산 변동성이 커지기 쉽습니다. 안전자산·현금 비중을 일부 늘려 두는 것을 고려할 수 있습니다.",
    typicalRangeKo:
      "장기 평균은 2-4% 부근이며, 5% 이상이면 긴축 사이클 후반, 0-1% 이하이면 완화 사이클로 분류됩니다.",
    caveatKo:
      "금리 자체보다 변화 속도와 시장 기대 대비 서프라이즈가 자산 가격에 더 큰 영향을 미치는 경우가 많습니다.",
    scoreDirectionKo:
      "기준금리는 거꾸로 보는 지표입니다. 금리가 낮을수록 시장에 돈이 더 많이 풀려 주식·암호화폐 같은 위험자산이 오르기 좋아지므로 점수가 높아집니다.",
    scoringMethodKo:
      "지난 5년 동안 미국 기준금리가 어디쯤이었는지를 비교합니다. 보통 3~5% 사이에서 움직였고, 1% 이하면 매우 완화적인 상태로 보고 점수를 높게, 6% 이상이면 5년 중에서도 손꼽힐 정도로 빡빡한 상태로 보고 점수를 크게 낮춥니다.",
    unitKo: "%",
  },

  CPIAUCSL: {
    key: "CPIAUCSL",
    labelKo: "소비자물가지수 (CPI)",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/CPIAUCSL",
    category: "macro",
    shortKo: "미국 소비자물가지수 — 인플레이션 압력의 핵심 지표",
    beginnerExplanationKo:
      "미국 가계의 장바구니 물가 변화를 측정하는 대표 인플레이션 지표로, 연준의 금리 결정에 가장 직접적으로 영향을 줍니다. 물가가 높으면 연준이 금리를 더 오래 높게 유지할 가능성이 커지므로 위험자산에 부담입니다.",
    bullishCaseKo:
      "CPI 상승률이 둔화되는 국면에서는 연준의 긴축 압력이 약해지면서 위험자산 랠리 가능성이 커집니다. 주식·장기채 비중을 늘리는 것이 역사적으로 평균적으로 유리했습니다.",
    bearishCaseKo:
      "CPI 상승률이 다시 가속하면 금리가 더 오래 더 높게 유지되는 시나리오로 회귀하면서 위험자산이 약세를 보이는 경향이 있습니다. 단기채·현금 비중을 늘려 변동성에 대비하는 것이 권장됩니다.",
    typicalRangeKo:
      "전년 대비 상승률 기준 연준 목표는 2%이며, 3% 이하면 안정권, 4% 이상이면 인플레 우려 구간으로 분류됩니다.",
    caveatKo:
      "헤드라인 CPI는 에너지·식품 변동성에 영향을 받기 때문에, 기조적 흐름은 근원 CPI(Core)를 함께 보는 것이 안전합니다.",
    scoreDirectionKo:
      "CPI는 거꾸로 보는 지표입니다. 물가지수가 낮을수록 인플레이션 부담이 적어 연준이 금리를 천천히 가져갈 수 있으니 점수가 높아집니다.",
    scoringMethodKo:
      "지난 5년 동안 미국 소비자물가지수가 어디쯤이었는지를 비교합니다. 지수 자체는 계속 우상향하지만 5년 평균과 비교한 위치로 점수를 매기며, 평균보다 낮은 편이면 점수를 높게, 5년 중에서도 손꼽힐 정도로 높으면 점수를 크게 낮춥니다.",
    unitKo: "포인트",
  },

  DGS10: {
    key: "DGS10",
    labelKo: "10년물 미국 국채 금리",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/DGS10",
    category: "macro",
    shortKo: "장기 할인율의 기준 — 글로벌 자산 가격의 닻",
    beginnerExplanationKo:
      "미국 정부가 10년 만기로 빌리는 비용으로, 전 세계 위험자산의 장기 할인율 기준이 되는 가장 중요한 채권 금리입니다. 이 금리가 오르면 미래 현금흐름의 현재가치가 줄어들면서 주식·부동산·암호화폐 모두에 압박이 가해집니다.",
    bullishCaseKo:
      "10년물 금리가 하락할 때는 장기 할인율이 낮아져 성장주·고PER 자산이 유리한 환경이 만들어지는 경향이 있습니다. 기술주·장기채 비중을 늘리는 전략이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "10년물 금리가 가파르게 상승하는 구간에서는 밸류에이션 멀티플 압축이 일어나면서 성장주가 특히 약세를 보입니다. 단기채·가치주·현금 비중을 늘려 두는 것을 고려할 수 있습니다.",
    typicalRangeKo:
      "최근 10년 평균은 2-3% 부근이며, 4% 이상이면 긴축 후반, 1.5% 이하이면 침체 우려 구간으로 분류됩니다.",
    scoreDirectionKo:
      "10년물 금리는 거꾸로 보는 지표입니다. 금리가 낮을수록 미래 수익을 더 후하게 쳐 주는 셈이라 주식·암호화폐 같은 위험자산이 오르기 좋아지므로 점수가 높아집니다.",
    scoringMethodKo:
      "지난 5년 동안 미국 10년물 국채 금리가 어디쯤이었는지를 비교합니다. 보통 2~4% 사이에서 움직였고, 1.5% 이하면 5년 중에서도 손꼽힐 정도로 낮은 상태로 보고 점수를 높게, 5% 이상이면 5년 중 가장 빡빡한 상태로 보고 점수를 크게 낮춥니다.",
    unitKo: "%",
  },

  T10Y2Y: {
    key: "T10Y2Y",
    labelKo: "10Y-2Y 국채 스프레드",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/T10Y2Y",
    category: "macro",
    shortKo: "장단기 금리차 — 침체 선행 지표",
    beginnerExplanationKo:
      "10년물과 2년물 금리 차이로, 단기보다 장기 금리가 낮아지는 '역전' 상태가 역사적으로 1-2년 뒤 경기침체를 강하게 예고해 왔습니다. 이 지표는 다른 거시 지표와 달리 양수가 정상적·건강한 상태이므로 점수 계산에서도 반대 방향으로 해석됩니다.",
    bullishCaseKo:
      "스프레드가 양수로 회복되거나 가팔라질 때는 경기 정상화 국면으로 해석되어 위험자산에 우호적입니다. 주식·하이일드 채권 비중을 늘리는 것이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "스프레드가 마이너스로 깊게 역전될 때는 1-2년 안에 경기침체가 올 확률이 통계적으로 매우 높습니다. 안전자산·장기 국채 비중을 늘려 두는 것이 권장됩니다.",
    typicalRangeKo:
      "정상 구간은 +0.5%p ~ +2.5%p이며, 0% 이하면 역전, -0.5%p 이하이면 깊은 역전으로 분류됩니다.",
    caveatKo:
      "역전 후 실제 침체까지의 시차가 6-24개월로 들쭉날쭉하기 때문에, 시점 매매 신호로 직접 쓰기보다 자산 배분의 보조 지표로 활용하는 것이 안전합니다.",
    scoreDirectionKo:
      "10년-2년 금리차는 그대로 봅니다. 차이가 크게 양수일수록 경제가 정상이라는 뜻이라 점수가 높아지고, 마이너스로 떨어지는 '역전' 상태가 되면 침체 신호로 받아들여 점수가 크게 낮아집니다.",
    scoringMethodKo:
      "지난 5년 동안 이 금리차가 어디쯤이었는지를 비교합니다. 보통 +0.5%p~+2%p 사이에서 움직이며, 0보다 낮은 마이너스 구간(역전)이 길어지면 5년 중에서도 손꼽힐 정도로 위험한 상태로 보고 점수를 크게 낮춥니다.",
    unitKo: "%p",
  },

  VIXCLS: {
    key: "VIXCLS",
    labelKo: "VIX 변동성 지수",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/VIXCLS",
    category: "macro",
    shortKo: "S&P 500 옵션 시장의 변동성·공포 지수",
    beginnerExplanationKo:
      "S&P 500 옵션 가격에서 추출한 향후 30일 예상 변동성으로, 시장 참여자들이 느끼는 단기 공포 수준을 수치화한 대표 지표입니다. VIX가 높으면 시장이 공포에 빠진 상태, 낮으면 안정·낙관 상태로 해석됩니다.",
    bullishCaseKo:
      "VIX가 35 이상으로 치솟을 때는 시장이 단기 공포에 빠진 상태로, 역사적으로 위험자산 매수 적기였습니다. 안전자산 비중을 줄이고 주식·암호화폐 비중을 확대하는 것이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "VIX가 12 이하로 안정될 때는 시장이 과도하게 낙관적일 수 있어 변동성 충격에 취약합니다. 일부 비중을 안전자산으로 옮겨 두는 것을 고려할 수 있습니다.",
    typicalRangeKo:
      "장기 평균은 18-20, 15 이하면 저변동성, 25 이상이면 경계, 35 이상이면 극단 공포 구간으로 분류됩니다.",
    caveatKo:
      "VIX는 후행 반응이 빠르기 때문에 공포가 정점을 찍은 직후 바로 반등이 오는 경우가 많아, 신호 한 번에 전량 매수보다는 분할 매수가 안전합니다.",
    scoreDirectionKo:
      "VIX는 거꾸로 보는 지표입니다. VIX 숫자가 높을수록 시장이 공포에 빠진 상태인데, 역사적으로 그때가 매수하기 좋은 타이밍이었기 때문에 점수도 높아집니다.",
    scoringMethodKo:
      "지난 5년 동안 매일의 VIX 값들과 비교해 오늘 값이 어디쯤인지로 점수를 매깁니다. VIX는 보통 15~25 사이를 오가며, 35를 넘으면 5년 중에서도 손꼽힐 정도로 공포가 큰 상태라 점수를 매우 높게 줍니다.",
    unitKo: "포인트",
  },

  BAMLH0A0HYM2: {
    key: "BAMLH0A0HYM2",
    labelKo: "미국 하이일드 OAS",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
    category: "macro",
    shortKo: "하이일드 회사채 신용 스프레드 — 신용 스트레스 지표",
    beginnerExplanationKo:
      "투자등급이 낮은 미국 회사채와 국채의 금리 차이로, 시장이 부도 위험에 매기는 프리미엄을 보여 주는 신용 스트레스 지표입니다. 스프레드가 벌어질수록 투자자들이 기업 부도 가능성을 크게 보고 있다는 뜻입니다.",
    bullishCaseKo:
      "하이일드 스프레드가 좁혀질 때는 신용 시장이 안정 국면이라는 신호로, 위험자산 전반에 우호적입니다. 주식·하이일드 채권 비중을 늘리는 것이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "스프레드가 빠르게 벌어지는 구간에서는 신용 경색이 진행 중일 수 있어 주식·암호화폐 같은 위험자산도 함께 약세를 보이는 경향이 있습니다. 안전자산·현금 비중을 늘리는 것이 권장됩니다.",
    typicalRangeKo:
      "정상 구간은 3-5%p, 6%p 이상이면 신용 경계, 8%p 이상이면 신용 위기 국면으로 분류됩니다.",
    scoreDirectionKo:
      "하이일드 스프레드는 거꾸로 보는 지표입니다. 차이가 좁을수록 시장이 부도 위험을 작게 보고 있다는 뜻이라 점수가 높아지고, 차이가 빠르게 벌어지면 신용 경색 신호로 받아들여 점수가 낮아집니다.",
    scoringMethodKo:
      "지난 5년 동안 이 스프레드가 어디쯤이었는지를 비교합니다. 보통 3~5%p 사이에서 움직이며, 8%p 이상이면 5년 중에서도 손꼽힐 정도로 신용 경색이 심한 상태로 보고 점수를 크게 낮춥니다.",
    unitKo: "%p",
  },

  SAHMCURRENT: {
    key: "SAHMCURRENT",
    labelKo: "Sahm Rule 침체 지표",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/SAHMCURRENT",
    category: "macro",
    shortKo: "실업률 추세 기반 실시간 침체 탐지 지표",
    beginnerExplanationKo:
      "최근 3개월 평균 실업률이 지난 12개월 최저 대비 얼마나 올랐는지를 측정하는 실시간 경기침체 탐지 지표로, 0.5%p를 넘으면 역사적으로 거의 매번 침체가 진행 중이었습니다. 다른 침체 지표가 후행적인 데 반해 비교적 빠르게 신호를 줍니다.",
    bullishCaseKo:
      "Sahm 값이 0.3 미만으로 안정되어 있을 때는 고용 시장이 견조하다는 의미로 위험자산에 우호적입니다. 주식 비중을 늘리는 전략이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "Sahm 값이 0.5를 넘기면 침체 국면에 진입했을 가능성이 매우 높으므로 안전자산 비중을 즉시 늘리는 것이 권장됩니다. 장기 국채·현금 비중 확대가 평균적으로 안전했습니다.",
    typicalRangeKo:
      "정상 구간은 0-0.3, 0.5 이상이면 침체 신호, 1.0 이상이면 깊은 침체 국면으로 분류됩니다.",
    caveatKo:
      "실업률 통계 자체에 노이즈가 있어 단일 월 데이터보다 2-3개월 추세를 함께 보는 것이 안전합니다.",
    scoreDirectionKo:
      "Sahm 지표는 거꾸로 보는 지표입니다. 값이 작을수록 고용 시장이 안정적이라는 뜻이라 점수가 높아지고, 값이 0.5를 넘으면 침체 진입 신호로 받아들여 점수가 크게 낮아집니다.",
    scoringMethodKo:
      "지난 5년 동안 이 값이 어디쯤이었는지를 비교합니다. 보통 0~0.3 사이에서 움직이며, 0.5를 넘으면 5년 중에서도 손꼽힐 정도로 고용이 식고 있는 상태로 보고 점수를 크게 낮춥니다.",
    unitKo: "%p",
  },

  // ─────────────────── Macro signal-only (2) ────────────────────
  ICSA: {
    key: "ICSA",
    labelKo: "주간 실업수당 청구건수",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/ICSA",
    category: "macro_signal",
    shortKo: "주간 신규 실업수당 신청 건수 — 고용시장 실시간 지표",
    beginnerExplanationKo:
      "매주 발표되는 미국 신규 실업수당 청구 건수로, 고용 시장이 식고 있는지 빠르게 확인할 수 있는 가장 빈도 높은 거시 데이터입니다. 시그널 정렬 엔진에서 ECONOMY_INTACT(경제 양호) 신호의 핵심 입력으로 사용됩니다.",
    bullishCaseKo:
      "30만 건 이하로 안정될 때는 고용 시장이 견조하다는 신호로 위험자산 비중을 유지·확대하는 전략이 평균적으로 유리했습니다. 경기 둔화 우려가 줄어들기 때문입니다.",
    bearishCaseKo:
      "40만 건 이상으로 빠르게 상승할 때는 침체 국면 진입 신호로 해석되어 안전자산 비중을 늘리는 것이 권장됩니다. 주가가 본격적으로 빠지기 전 선행 신호인 경우가 많습니다.",
    typicalRangeKo:
      "확장 국면 평균은 20-25만 건이며, 30만 건 이하는 정상, 40만 건 이상이면 침체 경계 구간으로 분류됩니다.",
    caveatKo:
      "주간 데이터라 변동성이 크기 때문에 4주 이동평균을 함께 보는 것이 추세 판단에 안전합니다.",
    scoreDirectionKo:
      "이 지표는 합성 점수에는 반영되지 않고 시그널 엔진에서만 쓰는 보조 지표입니다. 30만 건 이하면 'ECONOMY_INTACT(경제 양호)' 신호를 켜고, 그 위로 올라가면 신호가 꺼집니다.",
    scoringMethodKo:
      "별도 0~100 점수 환산 없이 원시 건수를 그대로 시그널 엔진에 넣습니다. 보통 20~25만 건 사이에서 움직이며, 30만 건이 정상/경계 경계선, 40만 건 이상이면 5년 중에서도 손꼽힐 정도로 고용이 식고 있는 상태로 봅니다.",
    unitKo: "건",
  },

  WDTGAL: {
    key: "WDTGAL",
    labelKo: "재무부 일반계정 (TGA) 잔액",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/WDTGAL",
    category: "macro_signal",
    shortKo: "미국 재무부 운영 자금 잔액 — 시장 유동성 지표",
    beginnerExplanationKo:
      "미국 재무부가 연준에 보유하고 있는 운영 자금 잔액으로, 이 계정이 늘면 시장에서 그만큼 현금이 빨려나가고 줄면 시장에 유동성이 풀리는 효과가 있습니다. 시그널 엔진에서 LIQUIDITY_EASING(유동성 완화) 신호의 핵심 입력입니다.",
    bullishCaseKo:
      "TGA 잔액이 20일 평균 아래로 내려갈 때는 시장에 유동성이 풀리는 국면으로, 위험자산 랠리 가능성이 커집니다. 주식·암호화폐 비중을 늘리는 것이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "TGA 잔액이 빠르게 쌓이는 구간(예: 부채한도 협상 후 재충전)에서는 시중 유동성이 흡수되어 위험자산이 약세를 보이는 경향이 있습니다. 일부 비중을 현금·단기채로 옮기는 것을 고려할 수 있습니다.",
    typicalRangeKo:
      "최근 평균 운영 잔액은 5,000-8,000억 달러 수준이며, 1조 달러 이상이면 유동성 흡수 국면으로 분류됩니다.",
    caveatKo:
      "TGA는 정부 지출·세수 일정에 따라 단기적으로 크게 출렁이므로 절대 수준보다 20일 평균 대비 변화를 보는 것이 안전합니다.",
    scoreDirectionKo:
      "이 지표도 합성 점수에는 반영되지 않고 시그널 엔진에서만 쓰는 보조 지표입니다. 오늘 잔액이 최근 20일 평균보다 낮으면 'LIQUIDITY_EASING(유동성 완화)' 신호를 켜고, 평균보다 높으면 신호가 꺼집니다.",
    scoringMethodKo:
      "별도 0~100 점수 환산 없이 오늘 잔액과 최근 20일 평균을 비교합니다. 보통 5,000~8,000억 달러 수준에서 움직이며, 1조 달러 이상으로 빠르게 쌓이면 시중 유동성이 흡수되는 국면으로 봅니다.",
    unitKo: "백만 달러",
  },

  // ────────────────── Regional overlay (KR) (2) ─────────────────
  DTWEXBGS: {
    key: "DTWEXBGS",
    labelKo: "Broad Dollar Index",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/DTWEXBGS",
    category: "regional_overlay",
    shortKo: "광역 달러 지수 — 신흥국 자금 흐름 압박 지표",
    beginnerExplanationKo:
      "미국 달러가 주요 교역상대국 통화 대비 얼마나 강한지를 종합한 광역 달러 지수로, 강달러 국면일수록 한국 같은 신흥국 주식에서 외국인 자금 이탈이 강해지는 경향이 있습니다. KR 주식의 지역 오버레이 카테고리에서 핵심 입력입니다.",
    bullishCaseKo:
      "달러 지수가 약세 흐름을 보일 때는 외국인 자금이 한국 주식으로 유입될 가능성이 커지면서 코스피에 우호적인 환경이 됩니다. KR 주식 비중을 늘리는 것이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "달러 지수가 빠르게 강세를 보일 때는 외국인 매도 압력이 커지면서 한국 주식이 평균적으로 약세를 보였습니다. KR 주식 비중을 줄이고 미국 자산·달러 현금 비중을 늘리는 것을 고려할 수 있습니다.",
    typicalRangeKo:
      "장기 정상 구간은 95-105, 110 이상이면 강달러 충격, 90 이하면 달러 약세 국면으로 분류됩니다.",
    scoreDirectionKo:
      "달러 지수는 한국 주식 입장에서 거꾸로 보는 지표입니다. 달러가 약할수록 외국인 자금이 한국으로 들어오기 좋아지므로 점수가 높아지고, 강달러로 치솟으면 외국인 매도 압력이 커져 점수가 낮아집니다.",
    scoringMethodKo:
      "지난 5년 동안 광역 달러 지수가 어디쯤이었는지를 비교합니다. 보통 95~105 사이에서 움직이며, 110 이상이면 5년 중에서도 손꼽힐 정도로 강달러가 심한 상태로 보고 점수를 크게 낮춥니다.",
    unitKo: "포인트",
  },

  DEXKOUS: {
    key: "DEXKOUS",
    labelKo: "USD/KRW 환율",
    sourceName: "FRED",
    sourceUrl: "https://fred.stlouisfed.org/series/DEXKOUS",
    category: "regional_overlay",
    shortKo: "원·달러 환율 — 외국인 자금·외화부채 부담 지표",
    beginnerExplanationKo:
      "원화 1달러를 사기 위해 필요한 원화 금액으로, 환율이 오를수록 원화가 약해지고 외국인 자금이 한국 주식에서 빠져나갈 압력이 커집니다. 동시에 외화부채를 보유한 한국 기업의 상환 부담도 커집니다.",
    bullishCaseKo:
      "환율이 안정·하락 흐름일 때는 외국인 매수가 들어오기 좋은 환경으로, 코스피·코스닥에 우호적입니다. KR 주식 비중을 늘리는 전략이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "환율이 1,400원을 넘는 가파른 약세 구간에서는 외국인 매도와 환차손이 동시에 발생하기 쉽습니다. KR 주식 비중을 줄이고 달러 자산 비중을 늘리는 것을 고려할 수 있습니다.",
    typicalRangeKo:
      "최근 정상 구간은 1,200-1,350원이며, 1,400원 이상이면 약세 충격, 1,150원 이하면 원화 강세 구간으로 분류됩니다.",
    caveatKo:
      "환율은 한국 수출 기업 실적에는 오히려 단기 호재로 작용할 수 있어, 자산 배분 신호로 쓸 때는 반드시 외국인 수급과 함께 봐야 안전합니다.",
    scoreDirectionKo:
      "원·달러 환율은 한국 주식 입장에서 거꾸로 보는 지표입니다. 환율이 낮을수록(원화 강세) 외국인 자금이 들어오기 좋아 점수가 높아지고, 1,400원을 넘는 약세 구간이면 외국인 매도 압력이 커져 점수가 낮아집니다.",
    scoringMethodKo:
      "지난 5년 동안 원·달러 환율이 어디쯤이었는지를 비교합니다. 보통 1,200~1,350원 사이에서 움직이며, 1,400원 이상이면 5년 중에서도 손꼽힐 정도로 원화가 약한 상태로 보고 점수를 크게 낮춥니다.",
    unitKo: "원",
  },

  // ────────────────────── Technical (6) ─────────────────────────
  RSI_14: {
    key: "RSI_14",
    labelKo: "RSI (14일 상대강도지수)",
    sourceName: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Relative_strength_index",
    category: "technical",
    shortKo: "최근 14일 상승·하락폭 비율 — 단기 과매수·과매도 지표",
    beginnerExplanationKo:
      "최근 14일 동안의 상승폭과 하락폭 비율로 단기 과열·과매도 정도를 0-100 사이 값으로 표현한 모멘텀 지표입니다. 대시보드에서는 추적 종목군 전체에 적용해 시장 전반의 단기 쏠림을 보여 줍니다.",
    bullishCaseKo:
      "RSI가 30 이하로 떨어진 종목군이 많을 때는 단기 과매도 구간으로 해석되어 반등 가능성이 커집니다. 매수 분할 진입을 고려해 볼 수 있는 국면입니다.",
    bearishCaseKo:
      "RSI가 70 이상에 머무르는 종목이 많을 때는 단기 과매수 구간으로, 단기 조정 가능성에 대비해 일부 차익실현이 권장됩니다. 신규 매수는 보수적으로 접근하는 것이 안전합니다.",
    typicalRangeKo:
      "정상 구간은 30-70이며, 30 이하면 과매도, 70 이상이면 과매수, 20 미만/80 초과는 극단 구간으로 분류됩니다.",
    caveatKo:
      "강한 추세장에서는 RSI가 70 이상에서 오랫동안 머무를 수 있어 단독 매도 신호로 쓰기에는 위험합니다.",
    scoreDirectionKo:
      "RSI는 거꾸로 보는 지표에 가깝습니다. 30 이하로 너무 많이 떨어졌을 때(많이 빠진 상태)는 반등 가능성이 높다고 보고 점수가 높아지고, 70 이상으로 너무 올랐을 때는 단기 조정 가능성을 보고 점수가 낮아집니다.",
    scoringMethodKo:
      "추적 종목별로 14일 RSI를 계산하고, 50을 가운데로 두고 30·70 임계값에서 멀어진 정도를 0~100 점수로 바꿉니다. 그렇게 만든 종목별 점수를 평균내 시장 전반의 단기 쏠림 점수를 만듭니다.",
    unitKo: "포인트",
  },

  MACD_12_26_9: {
    key: "MACD_12_26_9",
    labelKo: "MACD (12-26-9)",
    sourceName: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/MACD",
    category: "technical",
    shortKo: "단기·장기 이동평균의 수렴·발산 모멘텀 지표",
    beginnerExplanationKo:
      "12일과 26일 지수이동평균의 차이(MACD 선)와 그 9일 평균(시그널 선)을 비교해 추세 전환을 잡는 가장 보편적인 모멘텀 지표입니다. MACD가 시그널을 위로 뚫으면 강세, 아래로 뚫으면 약세 신호로 해석됩니다.",
    bullishCaseKo:
      "여러 종목에서 MACD 골든크로스가 동시에 발생할 때는 시장 전반의 단기 모멘텀이 우호적으로 전환되는 신호일 수 있습니다. 위험자산 비중 확대가 평균적으로 유리했습니다.",
    bearishCaseKo:
      "데드크로스가 광범위하게 발생할 때는 단기 추세가 약세로 전환된다는 신호로, 일부 비중을 줄여 두는 것이 권장됩니다. 추세 추종 전략에서는 매도 신호로 쓰입니다.",
    typicalRangeKo:
      "절대 수치보다 영(0)선 돌파 여부와 시그널선 교차 시점이 의미 있으며, 히스토그램이 0에서 멀어질수록 추세가 강한 것으로 해석됩니다.",
    caveatKo:
      "횡보장에서는 잦은 거짓 신호가 발생하기 쉬우니 추세 강도가 약할 때는 비중 조정 폭을 작게 가져가는 것이 안전합니다.",
    scoreDirectionKo:
      "MACD는 그대로 봅니다. MACD 선이 시그널 선보다 위에 있고 위로 뚫었으면 강세 모멘텀으로 점수가 높아지고, 아래로 뚫고 내려갔으면 약세 모멘텀으로 점수가 낮아집니다.",
    scoringMethodKo:
      "추적 종목별로 MACD 선과 시그널 선의 차이(히스토그램)를 계산하고, 양수 폭이 클수록 강세 점수, 음수 폭이 클수록 약세 점수를 매깁니다. 그렇게 만든 종목별 점수를 평균내 시장 전반의 추세 점수를 만듭니다.",
    unitKo: "포인트",
  },

  MA_50: {
    key: "MA_50",
    labelKo: "50일 이동평균",
    sourceName: "Investopedia",
    sourceUrl: "https://www.investopedia.com/terms/m/movingaverage.asp",
    category: "technical",
    shortKo: "최근 50일 평균 가격 — 중기 추세선",
    beginnerExplanationKo:
      "최근 50거래일 종가의 평균값으로, 중기 추세를 한눈에 보여 주는 가장 흔한 추세선입니다. 가격이 50일선 위에 있으면 중기 상승 추세, 아래에 있으면 중기 하락 추세로 해석됩니다.",
    bullishCaseKo:
      "추적 종목 다수가 50일선 위에 안착할 때는 중기 추세가 살아 있다는 신호로 위험자산 비중을 유지·확대하는 것이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "다수 종목이 50일선 아래로 내려가는 구간에서는 중기 추세가 꺾였을 가능성이 커서 일부 비중 축소가 권장됩니다. 50일선이 200일선 아래로 떨어지는 데드크로스가 함께 나타나면 더 보수적으로 접근하는 것이 안전합니다.",
    typicalRangeKo:
      "지표 자체에 임계값은 없으며, '현재가 vs 50일선' 격차(이격도)와 50-200일선 교차 시점이 의미 있습니다.",
    scoreDirectionKo:
      "50일선은 그대로 봅니다. 현재가가 50일선보다 위에 있으면 중기 상승 추세로 점수가 높아지고, 아래로 떨어지면 추세가 꺾인 것으로 보고 점수가 낮아집니다.",
    scoringMethodKo:
      "추적 종목별로 현재가가 50일선 대비 몇 % 위·아래에 있는지를 계산하고, 위에 있으면 후한 점수, 멀리 아래에 있을수록 낮은 점수를 매깁니다. 그렇게 만든 종목별 점수를 평균내 시장 전반의 중기 추세 점수를 만듭니다.",
    unitKo: "",
  },

  MA_200: {
    key: "MA_200",
    labelKo: "200일 이동평균",
    sourceName: "Investopedia",
    sourceUrl: "https://www.investopedia.com/terms/m/movingaverage.asp",
    category: "technical",
    shortKo: "최근 200일 평균 가격 — 장기 추세선",
    beginnerExplanationKo:
      "최근 200거래일 종가의 평균값으로, 장기 추세를 가장 보편적으로 정의하는 기준선입니다. 가격이 200일선 위에 있으면 장기 강세장, 아래에 있으면 장기 약세장으로 정의되는 경우가 많습니다.",
    bullishCaseKo:
      "주요 지수가 200일선을 회복할 때는 장기 추세가 강세로 돌아섰다는 강력한 신호로, 위험자산 비중을 본격적으로 늘리는 전략이 역사적으로 유리했습니다.",
    bearishCaseKo:
      "200일선을 명확히 이탈한 약세장에서는 추가 하락 가능성에 대비해 위험자산 비중을 보수적으로 가져가는 것이 권장됩니다. 안전자산·현금 비중을 늘려 두는 것이 안전했습니다.",
    typicalRangeKo:
      "장기 강세장 정의는 '현재가 > 200일선', 약세장은 '현재가 < 200일선'이며, 이격도 ±10% 이상이면 추세 강도가 강한 것으로 해석됩니다.",
    scoreDirectionKo:
      "200일선은 그대로 봅니다. 현재가가 200일선 위에 안착해 있으면 장기 강세장으로 점수가 높아지고, 아래로 이탈해 있으면 장기 약세장으로 점수가 낮아집니다.",
    scoringMethodKo:
      "추적 종목별로 현재가가 200일선 대비 몇 % 위·아래에 있는지를 계산하고, 위에 있으면 후한 점수, 멀리 아래에 있을수록 낮은 점수를 매깁니다. 그렇게 만든 종목별 점수를 평균내 시장 전반의 장기 추세 점수를 만듭니다.",
    unitKo: "",
  },

  BB_20_2: {
    key: "BB_20_2",
    labelKo: "볼린저 밴드 (20, 2σ)",
    sourceName: "Wikipedia",
    sourceUrl: "https://en.wikipedia.org/wiki/Bollinger_Bands",
    category: "technical",
    shortKo: "20일 평균 ±2 표준편차 — 변동성 채널",
    beginnerExplanationKo:
      "20일 이동평균을 중심으로 위·아래에 표준편차 2배만큼 그어 놓은 채널로, 가격이 통계적으로 머물 가능성이 높은 정상 범위를 시각화한 지표입니다. 밴드 폭이 좁을수록 변동성이 낮고, 넓을수록 변동성이 큰 시장입니다.",
    bullishCaseKo:
      "가격이 하단 밴드 근처에서 반등하는 구간은 단기 과매도 후 평균 회귀 가능성이 커지는 국면입니다. 분할 매수 전략이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "가격이 상단 밴드 위로 강하게 돌출한 뒤 모멘텀이 약해질 때는 단기 과열 신호로 해석되어 일부 차익실현이 권장됩니다. 밴드 수축 후 확장 국면에서는 양방향 변동성이 커질 수 있어 보수적 운용이 안전합니다.",
    typicalRangeKo:
      "이론상 가격의 약 95%가 ±2σ 밴드 안에 머무르며, 밴드 돌파는 통계적으로 드문 이벤트로 해석됩니다.",
    caveatKo:
      "강한 추세장에서는 가격이 밴드를 따라 한참 동안 워킹할 수 있어 단독 매매 신호로는 약합니다.",
    scoreDirectionKo:
      "볼린저 밴드는 거꾸로 보는 지표에 가깝습니다. 가격이 하단 밴드 근처로 떨어졌을 때는 평균 회귀 매수 기회로 보고 점수가 높아지고, 상단 밴드 위로 강하게 튀어 올랐을 때는 단기 과열 신호로 보고 점수가 낮아집니다.",
    scoringMethodKo:
      "추적 종목별로 현재가가 20일 평균 대비 위·아래 채널의 어느 위치에 있는지를 계산해 0~100 점수로 바꿉니다. 채널 한가운데(평균선 부근)는 50점 근처, 하단 채널 밖이면 매수 기회로 후한 점수, 상단 채널 밖이면 과열로 낮은 점수를 매깁니다.",
    unitKo: "",
  },

  DISPARITY: {
    key: "DISPARITY",
    labelKo: "이격도 (200일선 대비)",
    sourceName: "Investopedia",
    sourceUrl: "https://www.investopedia.com/terms/d/disparityindex.asp",
    category: "technical",
    shortKo: "현재가가 200일선과 얼마나 떨어져 있는지의 비율",
    beginnerExplanationKo:
      "현재 종가가 200일 이동평균 대비 몇 % 위·아래에 있는지를 나타내는 지표로, 장기 평균 대비 단기 쏠림 정도를 측정합니다. 값이 100에 가까우면 평균 부근, 110이면 평균보다 10% 위, 90이면 10% 아래라는 뜻입니다.",
    bullishCaseKo:
      "이격도가 90 이하로 깊이 떨어졌을 때는 평균 회귀 매수 기회가 만들어진 경우가 많습니다. 분할 매수 진입이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "이격도가 115를 넘는 강한 단기 과열 구간에서는 평균 회귀 압력이 커지므로 일부 차익실현이 권장됩니다. 신규 매수는 보수적으로 접근하는 것이 안전합니다.",
    typicalRangeKo:
      "정상 구간은 95-105, 110 이상이면 단기 과열, 90 이하면 단기 과매도로 해석되는 것이 보편적입니다.",
    scoreDirectionKo:
      "이격도는 거꾸로 보는 지표에 가깝습니다. 현재가가 200일선보다 너무 많이 떨어졌을 때(90 이하)는 매수 기회로 보고 점수가 높아지고, 너무 많이 올라갔을 때(115 이상)는 과열로 보고 점수가 낮아집니다.",
    scoringMethodKo:
      "추적 종목별로 이격도 값(현재가 ÷ 200일선 × 100)을 계산하고, 100을 가운데로 두고 너무 멀리 떨어진 정도를 0~100 점수로 바꿉니다. 그렇게 만든 종목별 점수를 평균내 시장 전반의 평균 회귀 점수를 만듭니다.",
    unitKo: "",
  },

  // ─────────────────────── On-chain (5) ─────────────────────────
  MVRV_Z: {
    key: "MVRV_Z",
    labelKo: "MVRV Z-Score (Bitcoin)",
    sourceName: "BGeometrics",
    sourceUrl: "https://bitcoin-data.com/bitcoin-mvrv-zscore",
    category: "onchain",
    shortKo: "BTC 시가총액과 실현가총액의 표준화된 차이",
    beginnerExplanationKo:
      "비트코인의 시가총액과 실현가총액(보유자가 마지막으로 옮겼을 때 가격 기준)의 차이를 표준화한 점수로, 시장 전체가 평균 매수가 대비 얼마나 과열·저평가됐는지를 보여 주는 핵심 온체인 지표입니다. 사이클 정점·바닥을 가장 잘 잡아 온 지표 중 하나로 평가됩니다.",
    bullishCaseKo:
      "Z-Score가 0 이하로 깊이 떨어진 구간은 역사적으로 사이클 바닥 근처였습니다. 분할 매수로 BTC 비중을 늘리는 전략이 평균적으로 매우 유리했습니다.",
    bearishCaseKo:
      "Z-Score가 7을 넘기는 극단 과열 구간에서는 사이클 정점 신호일 가능성이 크기 때문에 일부 차익실현이 권장됩니다. BTC 비중을 줄이고 안전자산·스테이블코인 비중을 늘리는 것이 평균적으로 안전했습니다.",
    typicalRangeKo:
      "정상 구간은 0-3, 5 이상이면 과열 경계, 7 이상이면 사이클 정점, 0 이하면 사이클 바닥 후보로 분류됩니다.",
    caveatKo:
      "BTC ETF 도입 이후 시장 구조가 바뀌면서 과거 사이클 임계값이 그대로 적용되지 않을 수 있다는 의견도 있어 단독 지표로 의존하기보다 여러 신호를 함께 보는 것이 안전합니다.",
    scoreDirectionKo:
      "MVRV는 거꾸로 보는 지표입니다. 숫자가 마이너스로 깊이 떨어질수록 비트코인이 저평가된 상태로 매수하기 좋은 타이밍이라 점수가 높아지고, 7 이상으로 치솟으면 사이클 정점으로 보고 점수가 크게 낮아집니다.",
    scoringMethodKo:
      "비트코인이 지금 평균 매수가 대비 얼마나 비싸거나 싼지를 보여주는 지표로, 0 근처면 적정가, 0 이하로 내려가면 저평가 구간(매수 적기), 7 이상이면 과열 구간(주의)으로 봅니다. 이 임계값을 기준으로 0~100 점수로 환산합니다.",
    unitKo: "",
  },

  SOPR: {
    key: "SOPR",
    labelKo: "SOPR (Spent Output Profit Ratio)",
    sourceName: "BGeometrics",
    sourceUrl: "https://bitcoin-data.com/bitcoin-sopr",
    category: "onchain",
    shortKo: "최근 옮겨진 비트코인의 평균 손익 비율",
    beginnerExplanationKo:
      "최근 블록체인 위에서 움직인 비트코인이 평균적으로 이익을 보고 팔렸는지 손해를 보고 팔렸는지를 보여 주는 지표로, 1보다 크면 이익 실현, 작으면 손절 상태로 해석됩니다. 시장 참여자들의 평균 손익 심리를 직접 측정한다는 점에서 유용합니다.",
    bullishCaseKo:
      "SOPR이 1 아래에서 다시 1을 뚫고 올라올 때는 손절이 멈추고 시장 심리가 회복되는 신호로, 매수 진입 타이밍으로 자주 활용됐습니다. 분할 매수 비중 확대가 평균적으로 유리했습니다.",
    bearishCaseKo:
      "SOPR이 1 아래로 깊이 떨어진 구간이 길게 이어질 때는 항복 매도 국면일 가능성이 크므로 단기 트레이딩보다는 분할 매수 호흡으로 접근하는 것이 안전합니다.",
    typicalRangeKo:
      "강세장 정상 구간은 1.0-1.05, 1.05 이상이면 차익실현 과열, 1.0 미만이면 손절 우위 국면으로 분류됩니다.",
    caveatKo:
      "거래소 내부 이동·자전 거래 등이 SOPR 값을 일시적으로 왜곡할 수 있어 단일 일자보다 7일 평균을 보는 것이 안전합니다.",
    scoreDirectionKo:
      "SOPR은 거꾸로 보는 지표에 가깝습니다. 1 아래로 깊이 떨어졌을 때(손절 우위 = 항복 매도)는 바닥 신호로 점수가 높아지고, 1.05 이상으로 올라갔을 때(차익실현 과열)는 단기 조정 가능성을 보고 점수가 낮아집니다.",
    scoringMethodKo:
      "최근 블록체인에서 움직인 비트코인의 평균 손익 비율을 1을 가운데로 두고 0~100 점수로 바꿉니다. 1.0 근처는 50점, 1 아래로 깊이 떨어졌을수록 매수 기회로 후한 점수, 1.05 이상으로 올라갔을수록 과열로 낮은 점수를 줍니다.",
    unitKo: "",
  },

  BTC_ETF_NETFLOW: {
    key: "BTC_ETF_NETFLOW",
    labelKo: "BTC 현물 ETF 순유입",
    sourceName: "Farside Investors",
    sourceUrl: "https://farside.co.uk/btc/",
    category: "onchain",
    shortKo: "미국 BTC 현물 ETF 일일 순유입·순유출 금액",
    beginnerExplanationKo:
      "미국 비트코인 현물 ETF의 일일 순유입·순유출을 합산한 지표로, 기관 자금이 비트코인 시장에 들어오고 있는지 빠지고 있는지를 가장 직접적으로 보여 주는 지표입니다. 2024년 이후 BTC 가격에 매우 강한 단기 영향을 주고 있습니다.",
    bullishCaseKo:
      "ETF에 5거래일 연속 순유입이 발생하는 구간에서는 기관 매수세가 본격화되는 신호로 해석되어 BTC 강세장 가능성이 커집니다. 비중 확대가 평균적으로 유리했습니다.",
    bearishCaseKo:
      "ETF에서 대규모 순유출이 며칠 이어지는 구간에서는 기관 자금 이탈로 단기 약세 압력이 커집니다. 일부 비중을 스테이블코인·현금으로 옮겨 두는 것을 고려할 수 있습니다.",
    typicalRangeKo:
      "최근 정상 구간은 일일 ±3억 달러 이내이며, +5억 달러 이상이면 강한 매수, -5억 달러 이하이면 강한 매도 신호로 분류됩니다.",
    caveatKo:
      "ETF 데이터는 거래소·수탁사 일정에 따라 공휴일에 공백이 생기므로 단일 일자 0원보다 5일 합계 추세를 보는 것이 안전합니다.",
    scoreDirectionKo:
      "ETF 순유입은 그대로 봅니다. 매일 들어오는 돈(순유입)이 많을수록 기관 매수세가 강하다는 뜻이라 점수가 높아지고, 빠져나가는 돈(순유출)이 많을수록 점수가 낮아집니다.",
    scoringMethodKo:
      "미국 BTC 현물 ETF의 일일 순유입·순유출 금액을 0을 가운데로 두고 0~100 점수로 바꿉니다. 0 근처는 50점, +5억 달러 이상이면 5년 중에서도 손꼽힐 정도로 강한 매수세로 보고 후한 점수, -5억 달러 이하면 강한 매도세로 낮은 점수를 줍니다.",
    unitKo: "백만 달러",
  },

  CRYPTO_FG: {
    key: "CRYPTO_FG",
    labelKo: "Crypto Fear & Greed Index",
    sourceName: "Alternative.me",
    sourceUrl: "https://alternative.me/crypto/fear-and-greed-index/",
    category: "onchain",
    shortKo: "암호화폐 시장의 공포·탐욕 지수 (0-100)",
    beginnerExplanationKo:
      "변동성·거래량·소셜 미디어·도미넌스 등을 종합해 암호화폐 시장 참여자들의 심리를 0-100 사이 값으로 매일 발표하는 지수입니다. 0에 가까울수록 극단 공포, 100에 가까울수록 극단 탐욕 상태로 해석됩니다.",
    bullishCaseKo:
      "지수가 20 이하 극단 공포 구간에 들어갈 때는 역사적으로 매수 기회였습니다. 분할 매수로 암호화폐 비중을 늘리는 전략이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "지수가 80 이상 극단 탐욕 구간에 머물 때는 단기 조정 가능성이 커지므로 일부 차익실현이 권장됩니다. 단기 과열에 대비해 보수적으로 운용하는 것이 안전했습니다.",
    typicalRangeKo:
      "정상 구간은 30-70, 25 이하면 공포·극단 공포, 75 이상이면 탐욕·극단 탐욕 구간으로 분류됩니다.",
    caveatKo:
      "심리 지표 특성상 후행성이 강해 단독 매매 신호보다는 다른 온체인 지표와 결합해 활용하는 것이 안전합니다.",
    scoreDirectionKo:
      "Crypto F&G는 거꾸로 보는 지표입니다. 지수가 낮을수록(공포가 클수록) 역사적으로 매수 기회였기 때문에 점수가 높아지고, 80 이상 극단 탐욕 구간이면 단기 조정 가능성을 보고 점수가 낮아집니다.",
    scoringMethodKo:
      "이미 0~100 사이 값으로 발표되는 지수를 우리 점수 방향(공포 = 매수 기회 = 고점수)에 맞춰 뒤집어 사용합니다. 원본 지수가 20이면 우리 점수는 80에 가깝고, 원본이 80이면 우리 점수는 20에 가까워집니다.",
    unitKo: "포인트",
  },

  CNN_FG: {
    key: "CNN_FG",
    labelKo: "CNN Markets Fear & Greed",
    sourceName: "CNN Business",
    sourceUrl: "https://www.cnn.com/markets/fear-and-greed",
    category: "sentiment",
    shortKo: "CNN의 미국 주식시장 공포·탐욕 지수 (0-100)",
    beginnerExplanationKo:
      "주가 모멘텀·풋콜비율·VIX·하이일드 스프레드 등 7개 하위 지표를 합산해 미국 주식시장의 단기 심리를 0-100 사이로 점수화한 지수입니다. 시장이 단기적으로 과열인지 위축인지를 한눈에 파악하는 데 유용합니다.",
    bullishCaseKo:
      "지수가 25 이하 극단 공포 구간에 들어갈 때는 단기 반등 가능성이 커지는 국면이었습니다. 위험자산 분할 매수가 평균적으로 유리했습니다.",
    bearishCaseKo:
      "지수가 75 이상 극단 탐욕 구간에 머물 때는 단기 조정 위험이 누적되고 있다는 신호로 일부 차익실현이 권장됩니다. 신규 매수는 보수적으로 접근하는 것이 안전합니다.",
    typicalRangeKo:
      "정상 구간은 30-70, 25 이하면 공포·극단 공포, 75 이상이면 탐욕·극단 탐욕 구간으로 분류됩니다.",
    caveatKo:
      "심리 지표는 후행성이 있어 단독 신호보다는 거시·기술 지표와 함께 보는 것이 안전합니다.",
    scoreDirectionKo:
      "CNN F&G는 거꾸로 보는 지표입니다. 지수가 낮을수록(공포가 클수록) 역사적으로 단기 반등 가능성이 높았기 때문에 점수가 높아지고, 75 이상 극단 탐욕 구간이면 점수가 낮아집니다.",
    scoringMethodKo:
      "CNN이 매일 발표하는 0~100 지수를 우리 점수 방향(공포 = 매수 기회 = 고점수)에 맞춰 뒤집어 사용합니다. 원본 지수가 25이면 우리 점수는 75에 가깝고, 원본이 75이면 우리 점수는 25에 가까워집니다. 합성 점수에서 차지하는 비중은 10% 이내로 제한됩니다.",
    unitKo: "포인트",
  },

  // ──────────────────────── News (1) ────────────────────────────
  NEWS_SENTIMENT: {
    key: "NEWS_SENTIMENT",
    labelKo: "뉴스 센티먼트 (Alpha Vantage)",
    sourceName: "Alpha Vantage",
    sourceUrl: "https://www.alphavantage.co/documentation/#news-sentiment",
    category: "sentiment",
    shortKo: "주요 종목 관련 뉴스의 평균 센티먼트 점수",
    beginnerExplanationKo:
      "Alpha Vantage가 주요 금융 매체 기사를 NLP로 분석해 추적 종목별 평균 센티먼트 점수를 매일 산출한 결과를 집계한 지표입니다. 점수가 양수면 호의적인 뉴스 흐름, 음수면 부정적인 뉴스 흐름이라는 뜻입니다.",
    bullishCaseKo:
      "센티먼트가 +0.15 이상으로 강하게 우호적일 때는 단기 모멘텀이 받쳐 주는 환경으로 위험자산에 우호적입니다. 추세 추종 매수 전략이 평균적으로 유리했습니다.",
    bearishCaseKo:
      "센티먼트가 -0.15 이하로 강하게 부정적일 때는 단기 약세 모멘텀이 누적되고 있다는 신호입니다. 단기 매수는 보수적으로, 일부 비중 축소를 고려하는 것이 안전합니다.",
    typicalRangeKo:
      "정상 구간은 -0.15 ~ +0.15이며, ±0.15 이상이면 강한 센티먼트, ±0.35 이상이면 극단 구간으로 분류됩니다.",
    caveatKo:
      "뉴스 센티먼트는 단기 노이즈가 크고 후행성이 있어 단독 신호보다는 거시·온체인 지표와 결합해 활용하는 것이 권장됩니다.",
    scoreDirectionKo:
      "뉴스 심리 점수는 그대로 봅니다. 뉴스가 긍정적일수록 점수가 높아집니다. 다만 이 지표는 보조 지표라 합성 점수에 미치는 영향은 10% 이내로 제한됩니다.",
    scoringMethodKo:
      "Alpha Vantage가 매일 모은 미국 대형주 관련 뉴스의 긍정/부정 감성을 -1에서 1 사이 값으로 평균낸 후, 0~100 점수로 환산합니다. 50점 근처는 중립, 70점 이상이면 시장 분위기가 꽤 우호적인 상태입니다.",
    unitKo: "",
  },
};

/**
 * Indicator entries grouped by category, derived from
 * {@link INDICATOR_GLOSSARY}. Used by the glossary page to render one
 * section per category in canonical order.
 *
 * The entry order within each category matches insertion order in
 * {@link INDICATOR_GLOSSARY}, which mirrors the spec's grouping
 * (FRED composite first, then signal-only, then technical / on-chain
 * / sentiment). Re-deriving on import is cheap (23 entries) and keeps
 * the two structures from drifting.
 */
export const INDICATORS_BY_CATEGORY: Record<
  IndicatorCategory,
  IndicatorGlossaryEntry[]
> = {
  macro: [],
  macro_signal: [],
  regional_overlay: [],
  technical: [],
  onchain: [],
  sentiment: [],
};

for (const entry of Object.values(INDICATOR_GLOSSARY)) {
  INDICATORS_BY_CATEGORY[entry.category].push(entry);
}

/**
 * Display order of categories on the glossary page. Macro first
 * (composite drivers), then signal-only and regional overlay
 * (specialized macro), then technical / on-chain / sentiment.
 */
export const INDICATOR_CATEGORY_ORDER: readonly IndicatorCategory[] = [
  "macro",
  "macro_signal",
  "regional_overlay",
  "technical",
  "onchain",
  "sentiment",
] as const;

/**
 * Korean labels for each category — used as section headings on
 * the glossary page.
 */
export const INDICATOR_CATEGORY_LABEL_KO: Record<IndicatorCategory, string> = {
  macro: "거시 (Macro)",
  macro_signal: "거시 시그널 (Signal-only)",
  regional_overlay: "지역 오버레이 (KR)",
  technical: "기술적 지표 (Technical)",
  onchain: "온체인 (On-chain)",
  sentiment: "심리·뉴스 (Sentiment)",
};

/**
 * Format a raw indicator value for display alongside a score row.
 *
 * - `null` / non-finite → "—" (graceful empty state)
 * - integers ≥ 1000: thousands-separated (e.g. "300,000")
 * - non-integers: 2-decimal rounding (e.g. "19.30", "4.50")
 * - integers < 1000: bare integer (e.g. "42")
 *
 * The formatter is unit-agnostic — callers append the indicator's
 * `unitKo` separately so a number like `300000` next to `"건"` reads
 * "300,000 건" without bespoke per-indicator formatting.
 */
export function formatRawValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  // Detect integer-vs-decimal at the tolerance the engine writes
  // (FRED feeds round to 2-3 dp; we display at 2).
  const rounded2 = Math.round(value * 100) / 100;
  const isInteger = Math.abs(rounded2 - Math.trunc(rounded2)) < 1e-9;
  if (isInteger) {
    const intVal = Math.trunc(rounded2);
    if (Math.abs(intVal) >= 1000) {
      return intVal.toLocaleString("en-US");
    }
    return String(intVal);
  }
  // 2-dp decimals; large magnitudes still get thousands separators on the
  // integer part so values like "12,345.67" render cleanly.
  return rounded2.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
