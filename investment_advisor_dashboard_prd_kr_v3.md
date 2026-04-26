# 투자 어드바이저 대시보드 PRD v3

> **v3.6 개정 (2026-04-26)** — Phase 3.0 "Data Source Recovery" 구현 반영. (1) 일별 시계열 fallback chain 도입 — Tier 1 Alpha Vantage `compact` (100바, 기존) → Tier 2 Twelve Data (300바, 신규 `TWELVEDATA_API_KEY`) → Tier 3 Yahoo Finance (2년, 키 불필요). MA(200) · Disparity · MOMENTUM_TURN 입력 복구 → §8.2 / §10.4 / §17 반영. (2) KR equity 7개 티커 부활 — `005930.KS` Samsung, `000660.KS` SK Hynix, `373220.KS` LG에너지솔루션, `207940.KS` Samsung Bio, `005380.KS` Hyundai, `069500.KS` KODEX 200, `229200.KQ` KODEX KOSDAQ150 모두 Yahoo 경로로 운용. KR equity의 `technical` 카테고리가 영구 null에서 정상 가용으로 복구 → §10.3 / §17 반영. (3) cron-onchain 분리 (`cron-onchain.yml` 신설, 매 4시간 실행) — BGeometrics 8/hr · 15/day 한도 내 운영 (12 calls/day, 3 calls 헤드룸) → §17 반영. (4) Phase 3 sub-phase 분리 명시: Phase 3.0 (data recovery, 본 개정) / 3.1 regime classification (ECOS adapter 포함) / 3.2 portfolio overlay (DART adapter 포함) / 3.3 personalization / 3.4 backtest UI → §18 반영. 제품 철학·범위·acceptance 기준 변경 없음.
>
> **v3.5 개정 (2026-04-26)** — Phase 2 구현 완료 후 PRD ↔ 코드 정합성 점검. 두 가지 큰 변경: (1) 데이터 소스 마이그레이션 — Bitbo 비공식 엔드포인트 404로 BGeometrics(bitcoin-data.com) 대체, CoinGlass v4 유료화로 Farside Investors 대체, Alpha Vantage `outputsize=full` 유료 전환으로 `compact` 100바 기반으로 운영(MA_200·Disparity 영구 null) — §7.1 / §8.2 / §8.3 / §12.1 / §17 반영. (2) 시그널 엔진 실제 출하분 — 6→8 시그널(crypto-extra `CRYPTO_UNDERVALUED` + `CAPITULATION` 추가), 자산군별 매핑(us_equity 6 / crypto 7 / kr_equity 5 / global_etf 5) — §10.4 반영. 기타: §8.2 기술적 지표는 AV API가 아니라 OHLC 기반 로컬 계산임을 명시, §11.2/§11.6 히스토리 범위는 Phase 2 90일 / Phase 3 180일로 정정, §11.7 + §18 PWA Phase 2 출하 완료 표기, §12.2 Next.js 16 `cacheLife` named preset 구조 반영. Phase 2 구현 코드와 일치시키는 정합화 개정이며 제품 철학·범위·로드맵 변경 없음.
>
> **v3.4 개정 (2026-04-23)** — 자산제곱 유튜브 영상(https://youtu.be/TJ3uAYxPY5k) "4가지 전략"의 매수 타이밍 프레임워크 분석 반영. 핵심 철학 편입: "연속 점수 요약이 아닌 독립 매수 시그널의 동시 발화 여부로 행동 근거 제공". §8.1에 `ICSA`(주간 신규 실업수당, 30만 건 임계) + TGA 잔고(재무부 현금 계정, 유동성 방향) 2개 FRED 시리즈 추가, §8.2에 "이격도(Disparity)" 기술적 파생 지표 추가, §8.4에 CNN Fear & Greed Index(주식 전용) 명시(§8.3 alternative.me 크립토 F&G와 별개 소스), §10.4 "시그널 얼라인먼트 레이어" 신설(6개 독립 boolean 시그널 + alignment_count 기반 UI), §18 Phase 2에 "매수 타이밍 시그널 엔진" bullet 추가. Phase 1 v2.3 구현과 호환(기존 7 FRED 매크로 스코어 영향 없음 — Phase 2에서만 활성).
>
> **v3.3 개정 (2026-04-23)** — §18 "개발 단계"를 canonical 로드맵으로 확정. §16.1 MVP 수용 기준에서 "최소 2개 이상의 기술적 지표(RSI, MACD)" 와 "BTC 온체인 지표(MVRV/SOPR)" 두 항목을 §16.3 (신설) Phase 2 수용 기준으로 이관. 기존 v3.2까지 §16.1과 §18 간에 있던 RSI/MACD/MVRV 배치 상충을 §18 기준으로 일원화. Phase 1 블루프린트 v2.3 구현(공통 매크로 코어 7개만 반영)과 일치. 자세한 변경 지점은 §16.1, §16.3(신설).
>
> **v3.2 개정 (2026-04-20)** — 모바일 지원 범위를 명시. §5 타겟 사용자 중 여자친구·어머니가 주로 모바일로 접근하는 사용 패턴을 반영해, 반응형 레이아웃 / 하이브리드 데이트 피커 / 터치 타깃 정책 / 네이티브 제스처 존중을 Phase 1 범위로 포함시키고, PWA는 Phase 2로 이연, 오프라인·커스텀 제스처·haptics는 명시적으로 범위 밖으로 뺌. 자세한 변경 지점은 §5, §11.7(신설), §13.3, §16.1, §18.
>
> **v3.1 개정 (2026-04-19)** — "날짜 탐색 / 히스토리 뷰" 기능을 제품 목표·기능 요구사항·수용 기준·개발 단계에 반영. Phase 1에 점수 히스토리 조회 UI를 포함하고, Phase 2에 가격 오버레이(자산군별 주요 종목 일봉) 레이어를 추가. 기존 §18 Phase 3의 "백테스트 및 산식 튜닝 UI"는 산식 재실행·버전 비교에 한정되며, 단순 날짜 조회는 Phase 1 범위로 내려옴. 자세한 변경 지점은 §4.1, §8.5, §11.6, §16.1, §18.

## 1. 문서 개요

### 1.1 문서 목적
이 문서는 개인용 투자 어드바이저 웹 대시보드의 제품 요구사항을 정의한다. 제품 목표, 사용자, 기능 범위, 데이터 파이프라인, 점수 엔진, 보안, 배포, 성공 지표를 하나의 구현 문서로 정리해 Claude Code 기반 개발과 운영 판단의 기준으로 사용한다.[web:137][web:140][web:149]

### 1.2 제품 한 줄 정의
글로벌 매크로, 시장 기술적 지표, 암호화폐 온체인 데이터를 결합해 주식·코인·ETF의 **비중 확대 / 유지 / 축소** 판단을 직관적으로 제공하는 개인용 투자 어드바이저 대시보드다.[web:145]

### 1.3 이번 v3 업데이트 방향
v2 PRD의 기본 철학은 유지하되, 아래 항목을 명시적으로 보강한다.
- 투자 모델에 **기술적 지표와 온체인 지표 레이어**를 추가한다.[web:152][web:161]
- 지표 정규화와 점수 결합 방식을 **수학적으로 더 명확히 정의**한다.[web:155][web:158]
- 기술 스택을 **Next.js 중심 서버리스 아키텍처** 기준으로 재정리한다.[web:167][web:168]
- 가족 3명만 사용하는 폐쇄형 환경을 위해 **Supabase Auth + RLS** 요구사항을 더 구체화한다.[web:172][web:175]
- Windows 환경에서 Claude Code를 쓸 때의 **MCP 설정 제약 사항**을 개발 환경 요구사항으로 반영한다.[web:173][web:176]

## 2. 제품 철학

### 2.1 핵심 철학
이 제품은 개별 종목 추천기가 아니라 **매크로 및 시장 상태 해석 도구**다. 금융여건은 정책금리 하나로 설명되지 않고 금리, 환율, 스프레드, 자산가격, 신용여건의 결합으로 설명되므로, 제품도 단일 지표가 아니라 다중 지표 수렴 구조를 채택한다.[web:12]

### 2.2 해석 구조
최종 해석 구조는 아래 4단으로 구성한다.
1. 공통 매크로 코어
2. 자산군별 기술적/심리 오버레이
3. 코인 전용 온체인 오버레이
4. 설명 가능한 행동 가이드

### 2.3 사용자 언어 원칙
사용자에게는 “매수/매도”보다 **비중 확대 / 유지 / 축소** 같은 표현을 우선 사용한다. 다만 내부 점수 엔진은 0~100의 연속 스코어를 유지해 정밀한 판단과 백테스트가 가능해야 한다.[web:145]

## 3. 문제 정의

### 3.1 현재 문제
개인 투자자는 금리, 물가, 경기, 유동성, 심리, 기술적 과매도, 온체인 저평가 신호를 함께 해석하기 어렵다. 데이터는 여러 사이트와 API에 분산되어 있고, 각각의 척도가 다르기 때문에 인간이 직관적으로 합산하기가 어렵다.[web:145][web:152][web:161]

### 3.2 해결하려는 문제
이 제품은 아래 문제를 해결해야 한다.
- 지금이 위험자산에 우호적인지 빠르게 알기 어렵다.[web:12]
- 거시와 가격 모멘텀, 온체인 데이터를 함께 해석하기 어렵다.[web:152][web:161]
- 기술적 지표와 온체인 지표를 직접 계산하거나 정규화하기 번거롭다.[web:152][web:155]
- 가족 구성원 수준에 맞는 쉬운 해석 레이어가 부족하다.[web:145]

## 4. 목표와 비목표

### 4.1 제품 목표
- 가족 3명이 같은 화면에서 각자 이해 가능한 투자 상태를 확인할 수 있게 한다.
- 거시, 기술적, 온체인 데이터를 자동 집계하고 점수화한다.[web:152][web:160][web:161]
- 미국주식, 한국주식, BTC/ETH, 글로벌 ETF를 자산군별로 분리해 해석한다.
- 초보자에게는 쉬운 행동 가이드를, 숙련자에게는 점수 근거와 차트를 제공한다.[web:145]
- 향후 백테스트 가능한 데이터 구조와 산식 버전 관리 구조를 처음부터 설계한다.[web:140]
- 과거 임의의 날짜를 선택해 그 시점의 상태·추천과 이후 실제 시장 움직임을 함께 확인해, 사용자가 모델의 해석 성능을 스스로 판단할 수 있게 한다.

### 4.2 비목표
- 자동매매 기능은 MVP에 포함하지 않는다.
- 개별 종목 추천과 목표가 산출은 초기 범위에서 제외한다.
- 초단타 실시간 트레이딩 시스템은 목표가 아니다.
- 기관용 파생상품 리스크 엔진은 범위 밖이다.

## 5. 타겟 사용자

| 사용자 | 숙련도 | 주요 니즈 | 필요한 화면 | 주 사용 디바이스 |
|---|---|---|---|---|
| 변준우 | 중급 이상 | 매크로/기술적/온체인 통합 판단, 근거 확인 | 상세 차트, 기여도, 산식 설명 | PC + 모바일 혼용 |
| 여자친구 | 초보~중급 | 지금 공격적인지 보수적인지 빠르게 확인 | 홈 카드, 핵심 변화, 쉬운 설명 | **모바일 중심** |
| 어머니 | 초보 | 위험 시기 회피, 안전 구간 확인 | 큰 상태 카드, 경고 중심 텍스트 | **모바일 중심** |

세 사용자 중 둘은 핸드폰에서 열어 보는 것이 기본 접근 경로이다. 이 때문에 모든 화면은 모바일 브라우저(iOS Safari / Android Chrome)에서 가로 스크롤 없이 렌더되고, 터치 상호작용만으로 모든 기능에 도달 가능해야 한다. 상세 규격은 §11.7·§13.3·§16.1 참조.

## 6. 핵심 제품 구조

### 6.1 상위 구조
1. 홈: 오늘의 투자 환경
2. 자산군 카드: 미국주식 / 한국주식 / BTC / 글로벌 ETF
3. 점수 변화 로그
4. 지표 라이브러리
5. 전문가용 상세 탭
6. 설정 및 가족별 개인화

### 6.2 해석 레이어
- **초보자 레이어**: 상태 색상 + 쉬운 문장 + 한 줄 행동 가이드
- **전문가 레이어**: 점수 분해, 차트, percentile, 지표 히스토리, 데이터 소스

## 7. 투자 모델 설계

### 7.1 모델 개요
투자 판단 엔진은 세 개의 하위 모델을 합성한다.
- 매크로 레짐 모델
- 기술적 모멘텀/과매도 모델
- 암호화폐 온체인 모델

이 세 모델은 자산군별로 다른 가중치로 합성된다. Alpha Vantage는 일봉 OHLC(`TIME_SERIES_DAILY`)를 제공하며, RSI/MACD/MA/볼린저밴드/이격도는 본 시스템이 OHLC를 받아 **로컬에서 직접 계산**한다 (AV의 사전 계산 지표 API는 사용하지 않음).[web:152][web:154] BTC 온체인 지표(MVRV Z-Score, SOPR)는 BGeometrics(bitcoin-data.com)의 무료 공개 API로 제공한다 — 기존 Bitbo 비공식 엔드포인트가 2026년 404 처리되어 대체됨.[web:161]

### 7.2 지표 정규화 원칙
서로 다른 단위를 갖는 지표를 합산하려면 표준화가 필요하다. 기본 방식은 Z-Score 또는 percentile 정규화를 사용한다.

기본 표준화 공식:

\[
Z_t = \frac{x_t - \mu}{\sigma}
\]

여기서 \(x_t\)는 현재 값, \(\mu\)는 기준 기간 평균, \(\sigma\)는 기준 기간 표준편차다. Z-Score는 내부 계산용으로 사용하고, 사용자 노출값은 0~100 점수나 5단 상태로 변환한다.

### 7.3 최종 합성 점수
최종 합성 점수는 가중 선형 결합을 기본값으로 사용한다.

\[
Composite\ Score = \sum_{i=1}^{n}(W_i \times S_i)
\]

여기서 \(W_i\)는 각 지표 가중치, \(S_i\)는 0~100 범위로 정규화된 지표 점수다. 내부 엔진은 연속 점수를 계산하고, UI는 상태 구간으로만 단순화한다.

### 7.4 상태 구간
- 80~100: 강한 비중 확대
- 60~79: 비중 확대
- 40~59: 유지
- 20~39: 비중 축소
- 0~19: 강한 비중 축소

이 구간은 UI용 기본값이며, 백테스트 후 조정 가능해야 한다.

## 8. 지표 체계

### 8.1 공통 매크로 코어

| 지표 | 역할 | 데이터 소스 |
|---|---|---|
| Fed Funds | 정책 금리 방향성 | FRED `FEDFUNDS`[web:12] |
| CPI | 인플레이션 압력 | FRED `CPIAUCSL` |
| 10년물 금리 | 할인율 및 장기금리 환경 | FRED `DGS10` |
| 장단기 스프레드 | 침체 선행 해석 | FRED `T10Y2Y`[web:13] |
| VIX | 공포/패닉 레벨 | FRED `VIXCLS` 또는 시장 데이터 |
| DXY (KR equity 전용) | 달러 긴축 환경 — 공통 macro composite 입력에서는 **제외**되며, KR equity의 `regional_overlay` 카테고리 입력으로만 사용 | FRED `DTWEXBGS` (Broad Dollar Index) |
| 하이일드 스프레드 | 신용 스트레스 | FRED `BAMLH0A0HYM2`[web:16] |
| 실업률 / Sahm Rule | 경기 둔화 탐지 | FRED `SAHMCURRENT`[web:129] |
| 주간 신규 실업수당 청구 | 침체 선행 시그널 (§10.4 `ECONOMY_INTACT` 입력, 임계값 30만 건) | FRED `ICSA` |
| TGA 잔고 | 재무부 현금 계정 → 시중 유동성 방향 (§10.4 `LIQUIDITY_EASING` 입력) | FRED `WDTGAL` (일간, 기본) 또는 `WTREGEN` (주간, fallback — WDTGAL 중단 시 활성화) |

### 8.2 기술적 분석 레이어
Alpha Vantage `TIME_SERIES_DAILY`에서 일봉 OHLC를 받아 **로컬에서 직접** RSI·MACD·MA·볼린저밴드·이격도를 계산한다. AV의 전용 지표 API(`/RSI`, `/MACD`, `/BBANDS` 등)는 사용하지 않는다 (Free Tier 호출량 절약 + 산식 투명성 확보 목적).[web:152][web:154]

| 지표 | 기본 해석 | 주요 소스 |
|---|---|---|
| RSI(14) | 과매도/과매수 | Alpha Vantage OHLC + 로컬 계산[web:155] |
| MACD | 추세 전환 | Alpha Vantage OHLC + 로컬 계산[web:152] |
| MA(50) | 중기 추세 | Alpha Vantage OHLC + 로컬 계산 |
| MA(200) ※ | 장기 추세 | **현재 영구 null** — Alpha Vantage가 `outputsize=full`을 유료로 전환(2026-04-25)하면서 무료 티어는 `compact` 100바만 반환. 200바 SMA 계산 불가. Phase 3에서 AV Premium 또는 대체 소스(Twelve Data 등)로 복구 예정. |
| 볼린저밴드 | 변동성 기반 이탈 | Alpha Vantage OHLC + 로컬 계산 |
| 이격도 (Disparity) ※ | 가격 / 200일 이동평균 − 1. §10.4 `DISLOCATION` 시그널 입력. 임계값 −25%. **MA(200) 의존성으로 현재 영구 null** (위와 동일 사유). | Alpha Vantage OHLC + 로컬 계산 |

> ※ `outputsize=compact` 제약 하에서도 RSI(14)·MACD(12,26,9)·MA(50)·BB(20,2)는 워밍업 후 정상 산출된다. MA(200)·Disparity만 영구 null이며 `fetch_status='partial'`로 기록된다.

### 8.3 암호화폐 온체인 레이어
BGeometrics(bitcoin-data.com)는 MVRV Z-Score·SOPR 등 BTC 온체인 지표를 무료 공개 API로 제공한다 — 기존 Bitbo 비공식 엔드포인트가 2026년 404 처리되어 대체됨.[web:158][web:161] 이 레이어는 BTC/ETH와 같은 암호화폐 자산군에만 적용한다. 현재 구현은 MVRV Z-Score와 SOPR 두 지표만 수집하며, Realized Price 등 추가 지표는 수집하지 않는다.

| 지표 | 의미 | 주요 소스 |
|---|---|---|
| MVRV Z-Score | 저평가/고평가 사이클 | BGeometrics (bitcoin-data.com — Bitbo 대체)[web:161] |
| SOPR | 이익 실현/손절 매도 상태 | BGeometrics (bitcoin-data.com — Bitbo 대체)[web:158] |
| ETF 순유입 | 기관 수급 강도 | Farside Investors (farside.co.uk/btc/ — CoinGlass v4 유료화 후 대체) |
| Crypto Fear & Greed | 시장 심리 | alternative.me[web:22] |

### 8.4 뉴스/심리 레이어
Finnhub는 뉴스 센티먼트와 시장 뉴스 데이터를 제공하며, Free Tier에서 관련 엔드포인트를 사용할 수 있다.[web:160][web:163][web:166] 단, 이 레이어는 보조 지표로 사용하고 핵심 점수에 과도한 가중치를 주지 않는다.

| 지표 | 의미 | 주요 소스 |
|---|---|---|
| 뉴스 센티먼트 | 섹터/종목 뉴스 톤 | Finnhub[web:160] |
| **CNN Fear & Greed Index (주식)** | 미국 주식시장 7개 서브지표(모멘텀·폭·풋콜 비율·VIX·안전자산 수요·정크본드 수요·52주 고가저가) 결합 0-100 지수. §10.4 `EXTREME_FEAR` 시그널 입력 (VIX와 OR 결합) | CNN Markets Data public JSON (비공식) |

CNN F&G는 §8.3의 alternative.me Crypto Fear & Greed와 **별개 지표**다. CNN은 주식시장 전용, alternative.me는 암호화폐 전용이며 구성 방식과 해석 기준이 다르다.

### 8.5 가격 히스토리 레이어 (Phase 2+ 도입)
날짜 탐색 뷰(§11.6)에서 "그때 점수가 이랬고 이후 실제 가격은 저렇게 움직였다"를 비교해 모델 신뢰도를 사용자가 검증할 수 있게 하기 위한 가격 시계열 레이어다. 핵심 원칙은 **수집 용량 최소화**.

- **자산군별 대표 종목만 수집**한다. 한국주식은 KOSPI / KOSDAQ 인덱스 ETF 및 대형 대표주, 미국주식은 S&P 500 / Nasdaq 100 인덱스 ETF, 암호화폐는 BTC / ETH, 글로벌 ETF는 VT / EEM 등 대표 티커. **구체 티커 리스트는 Phase 2 구현 시점에 확정**하며, 범용 "모든 종목" 수집은 의도적으로 배제한다.
- 수집 단위는 일봉 종가(close) 우선. 필요 시 고가·저가·거래량을 보조 필드로 저장한다.
- 저장 테이블은 `price_readings` (가칭) — `ticker`, `asset_type`, `price_date`, `close`, `open`, `high`, `low`, `volume`, `source_name`, `ingested_at` 수준으로 설계 예정.
- 데이터 소스: Alpha Vantage (기술적 지표 Phase 2 도입과 함께), CoinGecko 또는 CoinGlass (암호화폐). Phase 1 Free Tier 한도 리스크(§17)와 충돌하지 않게 배치 호출 전략 유지.
- 이 레이어는 점수 엔진에는 입력되지 않는다. 순수 **시각화 및 사후 검증**용.

## 9. 점수 변환 로직

### 9.1 RSI 변환 예시
Alpha Vantage 설명 기준 RSI는 0~100 범위의 모멘텀 지표이며, 일반적으로 30 미만은 과매도, 70 초과는 과매수로 해석된다.[web:155] 따라서 기본 변환 로직은 아래처럼 설정한다.
- RSI <= 30: 높은 매수 점수
- RSI 30~50: 점진적 중립화
- RSI 50~70: 낮은 매수 점수
- RSI >= 70: 매우 낮은 매수 점수

### 9.2 MACD 변환 예시
- MACD > Signal이며 막 상승 전환: 가점
- MACD < Signal이며 하락 확장: 감점
- 0선 상회 여부는 추세 확인용 보조 신호로 사용

### 9.3 MVRV Z-Score 변환 예시
Bitbo가 제공하는 MVRV Z-Score는 BTC 사이클 저평가/고평가 판단에 널리 쓰인다.[web:161] 기본 설계는 다음과 같다.
- 0 이하: 최고 점수 구간
- 0~3: 우호 구간
- 3~7: 중립~과열 구간
- 7 이상: 매우 낮은 점수 구간

### 9.4 SOPR 변환 예시
Bitbo 기준 SOPR는 사용된 코인이 이익 상태인지 손실 상태인지를 나타내며, 1 미만이면 손실 실현 구간을 의미한다.[web:158]
- SOPR < 1: 항복 구간 가능성, 가점
- SOPR ≈ 1: 중립
- SOPR > 1 지속: 과열 여부 보조 판단

### 9.5 매크로 필터 원칙
기술적·온체인 신호가 좋더라도 매크로 필터가 극단적으로 나쁘면 최종 점수 상한을 제한한다. 예를 들어 하이일드 스프레드 급등, Sahm Rule 악화, 달러 급등이 동시에 발생하면 “기술적 반등”의 신뢰도를 낮춘다.[web:16][web:129]

## 10. 자산군별 가중치 예시

### 10.1 미국주식
- 기술적 지표: 35
- 매크로 지표: 45
- 심리/뉴스: 10
- 밸류에이션: 10

### 10.2 BTC/ETH
- 온체인 지표: 35
- 기술적 지표: 25
- 매크로 지표: 25
- 심리/ETF 수급: 15

### 10.3 한국주식
- 매크로 지표: 45
- 기술적 지표: 25
- 환율/지역 오버레이: 20
- 심리: 10

환율/지역 오버레이 카테고리는 FRED `DTWEXBGS` (Broad Dollar Index, 50%) + `DEXKOUS` (USD/KRW, 50%) 두 시리즈의 평균으로 산출된다. 코드에서 카테고리 키는 `regional_overlay`. 한국은행 ECOS API는 인증·스키마 학습 비용 대비 효용이 낮다고 판단해 미채택(Phase 3 재검토). 현재 KR equity의 6개 카테고리 중 `technical` / `valuation`은 영구 null — Alpha Vantage 무료 티어가 KR `.KS` 티커를 지원하지 않아 ticker registry에서 제거됨. Phase 3에서 ECOS API 또는 Yahoo Finance 스크래핑으로 복구 검토.

이 가중치는 초기값이며, 백테스트 후 재조정 가능해야 한다.

### 10.4 시그널 얼라인먼트 레이어 (Phase 2+ 도입)

자산제곱 유튜브 "4가지 전략" 영상이 제시한 **"3개 시그널 동시 발화 시 최적 매수 구간"** 프레임워크의 일반화. §10.1–§10.3의 연속형 composite score (가중합 0-100)와 **병렬**로 독립 boolean 시그널을 운영한다.

**철학**: "지금 점수 몇 점인가"(상태 요약)와 "지금 몇 개 매수 시그널이 동시에 켜졌는가"(행동 근거)는 서로 다른 질문이다. 특히 초보 사용자(§5 페르소나 중 여자친구·어머니)에게 "점수 47점"은 해석이 필요하지만 "4/6 시그널 동시 발화"는 즉각 이해 가능하다.

**Phase 2 기준 8개 시그널** (base 6 + crypto-extra 2):

| 시그널 | 조건 | 입력 지표 |
|---|---|---|
| `EXTREME_FEAR` | VIX ≥ 35 **또는** CNN F&G < 25 | §8.1 VIXCLS + §8.4 CNN F&G |
| `DISLOCATION` | SPY 또는 QQQ의 200일 이동평균 대비 이격도 ≤ −25% | §8.2 이격도 (현재 MA_200 영구 null로 입력 부재 — Phase 3 복구 예정) |
| `ECONOMY_INTACT` | `ICSA` < 300K **그리고** SAHM < 0.5 | §8.1 ICSA + SAHMCURRENT |
| `SPREAD_REVERSAL` | `BAMLH0A0HYM2` ≥ 4에서 지난 7일 하향 반전 | §8.1 BAMLH0A0HYM2 |
| `LIQUIDITY_EASING` | TGA 잔고의 20일 이동평균 대비 감소 | §8.1 TGA |
| `MOMENTUM_TURN` | SPY MACD bullish cross 최근 7일 내 | §8.2 MACD (현재 compact 100바 한도로 윈도우 부족 시 unknown — Phase 3 복구 예정) |
| `CRYPTO_UNDERVALUED` (crypto-extra) | MVRV Z-Score ≤ 0 | §8.3 MVRV_Z |
| `CAPITULATION` (crypto-extra) | SOPR < 1 | §8.3 SOPR |

**출력**: `signal_events` 테이블 — `(snapshot_date, active_signals jsonb, alignment_count int, signal_rules_version text, per_signal_detail jsonb)`. composite_snapshots와 별도 버전 관리 (`SIGNAL_RULES_VERSION`이 `MODEL_VERSION`과 독립적으로 bump됨 — 시그널 임계값 튜닝과 composite 가중치 변경은 결이 다른 조정).

**UI 반영**:
- 대시보드 상단 카드: "현재 N/M 매수 시그널 활성" — composite 밴드보다 크게 배치 (Phase 2 UX 가장 중요한 의사결정 원칙). 분모 M은 자산군별 적용 가능 시그널 수 (us_equity 6, crypto 7, kr_equity 5, global_etf 5).
- `alignment_count ≥ 3`: 노란 배지 "과거 평균 매수 타이밍 조건 충족"
- `alignment_count ≥ 5`: 초록 배지 "역사적 최적 매수 구간"
- `alignment_count ≤ 1`: 회색 배지 "대기 구간" (과도한 긴장 유발 회피)
- 임계값(≥3 / ≥5 / ≤1)은 us_equity 6-시그널 기준으로 설계됨. 자산군별 분모(crypto 7, kr_equity/global_etf 5)에서도 동일 절대값 임계값을 적용한다. 비율 기반 임계값으로 전환할지 여부는 Phase 3 검토.
- 시그널 타일은 (1) 배경 색조, (2) 아이콘(체크/마이너스/물음표), (3) 상태 텍스트 칩(`조건 충족` / `조건 미충족` / `데이터 부족`)으로 색상 외 2가지 이상의 단서로 상태를 전달 (WCAG 1.4.1 non-color-alone). 각 타일에는 한 줄 설명과 라이브 "지금: ..." 입력값 요약이 함께 표시된다.
- PRD §13.2 자문 금지 준수: 카드 하단에 "실제 자산 배분은 본인 판단입니다. 모델은 과거 평균 패턴 기반 확률적 판단 도구입니다" 상시 표기.

**자산군별 시그널 매핑** (`/asset/[slug]`에서는 해당 자산에 관련된 시그널만 노출):
- **US equity / common**: BASE 6개 모두.
- **BTC/ETH (crypto)**: BASE 5개 (MOMENTUM_TURN 제외, SPY MACD는 크립토에 의미 없음) + crypto-extra `CRYPTO_UNDERVALUED` + `CAPITULATION` = **총 7개**. Phase 3에서 BTC-MACD 변형으로 MOMENTUM_TURN 대체 검토.
- **KR equity**: BASE 5개 (DISLOCATION 제외, SPY/QQQ 이격도는 KR equity에 미적용; 대신 §10.3 regional_overlay 사용).
- **Global ETF**: BASE 5개 (MOMENTUM_TURN 제외, SPY MACD는 글로벌 분산 ETF에 이중 카운트 위험).

## 11. 기능 요구사항

### 11.1 홈 대시보드
- 선택된 날짜(기본값 오늘)의 종합 상태 표시 — §11.6 날짜 탐색 기능으로 임의 과거 시점 조회 가능
- 자산군별 상태 카드 표시
- 해당 날짜 기준 최근 변화 상위 3개 표시
- 마지막 업데이트 시간 및 데이터 상태 표시
- 주요 주의사항 1~2개 노출

### 11.2 자산군 상세
- 공통 매크로 코어 점수
- 기술적/온체인/심리 오버레이 점수
- 기여도 분해 차트
- 최근 90일 점수 추이 (30/180일 범위 전환 토글은 Phase 3 예정)
- 설명 카드 및 데이터 소스 링크

### 11.3 변화 로그
- 날짜별 점수 변화
- 변화 원인 지표
- 상태 전환 전/후
- 데이터 지연 또는 실패 여부

### 11.4 지표 라이브러리
- 지표 정의
- 공식/보조 데이터 소스
- 해석 방식
- 점수 반영 방식
- 갱신 주기

### 11.5 사용자 보호 UX
- 확정적 투자 조언처럼 보이지 않는 카피 사용
- “참고용 해석 도구” 성격 명시
- 점수만이 아니라 이유와 한계를 함께 노출

### 11.6 날짜 탐색 / 히스토리 뷰
제품 목표 §4.1의 "과거 시점 상태·추천 재확인" 요구를 실현하는 크로스 페이지 기능이다. 대시보드·자산군 상세·변화 로그 모두 **선택된 날짜** 기준으로 동작한다.

- **날짜 선택 UI**: 헤더 또는 전역 위치에 날짜 피커. 기본값은 오늘. 선택 시 URL 쿼리 파라미터(`?date=YYYY-MM-DD`)에 반영돼 공유·북마크 가능.
- **범위**: Phase 1은 최소 최근 30일, Phase 2 기준 90일 (`TREND_WINDOW_DAYS = 90` 고정). 180일 이상 확장은 Phase 3 예정 (§18).
- **데이터 없음 처리**: 해당 날짜에 스냅샷이 없으면 "수집된 데이터가 없습니다" + 가장 가까운 이전 수집일 바로가기 제안. 점수를 자의적으로 추정하지 않는다.
- **산식 버전 표시**: 각 히스토리 스냅샷에는 그 시점의 `model_version`이 같이 표시되어, 같은 값이어도 "이건 v1 산식이 판단한 것"이라는 맥락이 보이게 한다.
- **Phase 1 (현재 범위)**: 점수·밴드·기여 지표의 "그때 상태"만 조회. 가격 비교는 없음.
- **Phase 2 (§8.5 도입 후)**: 선택된 날짜 이후의 실제 가격 움직임을 차트에 오버레이 — "그때 점수 72점(비중 확대) → 이후 30일 지수 +2.3%" 같은 시각 검증.
- **Phase 3 (§18)**: 현재 산식을 과거 지표 원본(`raw_payload`)에 재실행하는 본격 백테스트 UI는 이 섹션과 분리되어 §18에서 별도로 다룬다.

### 11.7 모바일 지원 범위

§5의 여자친구·어머니 사용자가 핸드폰에서 주로 접근하는 현실을 반영해, Phase 1부터 반응형 웹으로 설계한다. "네이티브 앱 같은 체험"이 아니라 "모바일 브라우저에서 잘 보이고 잘 터치된다"를 목표선으로 잡는다.

**지원 범위 (Phase 1):**
- **최소 뷰포트**: 360px 폭 (아이폰 SE · 안드로이드 일반 기종). 이하는 지원 범위 밖.
- **반응형 전환점**: `md` = 768px를 경계로 데스크톱 레이아웃 ↔ 모바일 레이아웃 전환 (iPad 세로부터 데스크톱 레이아웃).
- **내비게이션**: `<md`에서는 햄버거 버튼 → 드로어(drawer) 사이드바, `md+`에서는 고정 사이드바.
- **날짜 피커**: `<md`에서는 브라우저 네이티브 `<input type="date">`(iOS/Android OS 기본 달력), `md+`에서는 커스텀 달력 컴포넌트. 사용자가 매일 쓰는 달력 UI를 폰에서 그대로 활용.
- **차트**: 화면 폭에 맞춰 자동 재조정 (Recharts `<ResponsiveContainer>` 사용). 모바일에서 범례·축 라벨이 잘리거나 겹치지 않도록 한다.
- **터치 타깃**: 모든 버튼·링크 최소 44×44px (Apple HIG / Material 가이드 준수).
- **타이포**: 모바일-first 크기 체계 — 제목은 모바일에서 작게(`text-2xl`), 데스크톱에서 확장(`md:text-3xl`). 디스클레이머·메타 텍스트는 모바일에서도 가독성 유지.
- **네이티브 제스처 존중**: iOS 좌측 엣지 스와이프-뒤로가기, 바텀시트 드래그-닫기 등 OS 기본 제스처를 코드가 가로막지 않는다. 웹뷰가 "앱을 감싼 껍데기"처럼 느껴지지 않게 하기 위한 필수 조건.

**범위 밖 (Phase 1):**
- **오프라인 지원** — 네트워크 끊김 시 캐시된 데이터 표시. 가족 사용자 모두 안정적 인터넷 환경이므로 도입 가치 대비 구현 비용이 높다.
- **커스텀 제스처** — 좌우 스와이프 탭 이동, pull-to-refresh, long-press 등 직접 구현하는 제스처. 추가 라이브러리·버그 디버깅 공수 대비 학습 비용이 있어 Phase 1에서 제외.
- **Haptics (진동 피드백)** — iOS Safari에서 웹 haptics API가 제한되어 크로스-플랫폼 일관성이 떨어진다.

**Phase 2 출하 완료 (§18):**
- **PWA (Progressive Web App)** — `public/manifest.webmanifest` + `public/sw.js`(service worker 기반 셸 캐싱) + `src/components/shared/service-worker-registration.tsx` 모두 ship됨. 홈 화면 설치 아이콘 동작 확인. **Lighthouse PWA ≥ 90 점수 검증 및 실기기 A2HS(Add to Home Screen) 테스트는 Phase 2 운영 단계에서 진행 중** — `docs/phase2_acceptance_matrix.md` row 13 참조.

## 12. 데이터 파이프라인 요구사항

### 12.1 소스 우선순위
| 우선순위 | 유형 | 예시 |
|---|---|---|
| 1 | 공식 공공 데이터 | FRED, OECD, BLS, ISM 공식 발표[web:12][web:30][web:37] |
| 2 | 준공식 시장 데이터 | Alpha Vantage, Finnhub[web:152][web:166] |
| 3 | 온체인 특화 API | BGeometrics (bitcoin-data.com), Farside Investors (farside.co.uk/btc/) — 기존 Bitbo · CoinGlass는 2026년 유료화/엔드포인트 변경으로 대체됨[web:161][web:42] |
| 4 | 비공식 웹/스크래핑 | CNN Fear & Greed, 일부 valuation 데이터[web:31] |

### 12.2 캐싱 전략
일간·주간 지표 위주 서비스이므로 실시간 계산보다 캐싱이 우선이다. Next.js 16 `cacheLife` named preset + `revalidateTag` 이중 구조로 운영한다.

- **매크로 / 기술적 / 가격 / 합성 스냅샷 readers**: `cacheLife('days')` (stale ≈ 1d, revalidate ≈ 1d, expire ≈ 1w) + cron 후 `revalidateTag(..., { expire: 0 })`로 즉시 무효화. 따라서 effective TTL은 cron cadence(daily 22:00 UTC)에 의해 결정됨.
- **온체인 / 시그널 readers**: `cacheLife('hours')` (stale ≈ 1h) + cron 후 즉시 tag 무효화 (cron-hourly 매시 정각).
- **뉴스 센티먼트**: `cacheLife('hours')` + cron-hourly 무효화.
- **히스토리 스냅샷(과거 날짜)**: `cacheLife('weeks')` — 과거 시점 데이터는 변경되지 않으므로 길게 캐싱.

Vercel은 ISR과 시간 기반 재검증을 지원하며, App Router에서는 `'use cache'` + `cacheTag` + `cacheLife` 디렉티브 모델을 사용한다.[web:167][web:168][web:169]

### 12.3 저장 스키마 메타필드
- `indicator_key`
- `asset_type`
- `value_raw`
- `value_normalized`
- `score_0_100`
- `observed_at`
- `released_at`
- `ingested_at`
- `source_name`
- `source_url`
- `frequency`
- `window_used`
- `model_version`
- `fetch_status`
- `is_revised`

## 13. 기술 아키텍처 요구사항

### 13.1 권장 아키텍처
v3 기준 기본 권장 구조는 **Next.js 단일 저장소 중심**이다.
- Frontend: Next.js App Router + TypeScript + Tailwind + shadcn/ui
- Server layer: Next.js Route Handlers / Server Components
- Database/Auth: Supabase
- Hosting: Vercel
- Optional worker: 필요 시 별도 Python 서비스 또는 스케줄러

Next.js App Router에서는 서버 컴포넌트와 서버 측 fetch를 활용해 민감한 API Key와 데이터 처리 로직을 브라우저로 노출하지 않을 수 있다.[web:168][web:169]

### 13.2 v2 대비 변경점
기존 v2는 FastAPI 분리 아키텍처를 기본값으로 두었지만, v3에서는 운영 단순성과 서버리스 배포 편의성 때문에 **Next.js 중심 단일 앱 아키텍처를 우선안**으로 둔다. FastAPI는 아래 경우에만 2안으로 둔다.
- Python 기반 백테스트/분석 로직이 빠르게 커질 경우
- pandas 기반 배치 계산을 독립 서비스로 빼고 싶을 경우
- 온체인/매크로 계산 모듈을 Python으로 재사용하고 싶을 경우

즉, 초기 MVP는 **Next.js + Supabase + Vercel**로 충분하고, 고도화 시 Python 분석 워커를 붙이는 구조가 더 현실적이다.[web:167][web:172]

### 13.3 프론트엔드 UI 스택
- UI: shadcn/ui
- 차트: Recharts 우선 (`<ResponsiveContainer>` 필수 사용 — 모바일 폭 대응), 필요 시 Tremor 일부 참조
- 상태관리: React Query 또는 server-first fetch
- 테마: light/dark mode
- **반응형 기준**: Tailwind `md` 브레이크포인트(768px)에서 모바일 ↔ 데스크톱 레이아웃 전환
- **모바일 드로어**: shadcn `Sheet` 컴포넌트 기반 사이드바 drawer (`<md`에서 햄버거 버튼으로 열림)
- **날짜 피커 하이브리드**: `<md`에서 네이티브 `<input type="date">`, `md+`에서 shadcn `Popover + Calendar` — 두 경로를 같은 `?date=YYYY-MM-DD` 쿼리 파라미터로 통합
- **터치 타깃**: 인터랙티브 요소 최소 44×44px (`h-11 w-11` 또는 shadcn Button `size="default"` 이상)

### 13.4 보안 요구사항
Supabase는 RLS를 통해 인증 사용자별 데이터 접근 제어를 구현할 수 있으며, 모든 public 스키마 객체는 RLS 적용을 전제로 설계해야 한다.[web:172][web:175][web:178]

필수 보안 규칙:
- 공개 회원가입 비활성화
- 가족 계정 3개 수동 생성
- 인증 사용자만 데이터 접근 허용
- 사용자별 포트폴리오는 `auth.uid()` 기반 정책으로 분리[web:172][web:178]
- 모든 API Key는 서버 측 환경변수로만 관리

### 13.5 접근 통제
Next.js Middleware로 로그인 세션 없는 접근을 `/login`으로 리디렉션하는 보호 레이어를 둔다. 이 보호는 앱 레벨에서 가족 전용 폐쇄 환경을 구현하는 기본값이다.

## 14. 개발 환경 요구사항

### 14.1 Claude Code 개발 환경
- Git 설치 필수
- Node.js LTS 설치 필수
- Python 또는 `uv` 설치 권장
- 프로젝트 루트 기준 `.mcp.json` 또는 MCP 설정 관리

### 14.2 Windows 주의사항
네이티브 Windows에서 `npx` 기반 로컬 MCP 서버는 `cmd /c` 래퍼가 필요하다는 사례와 문서가 존재한다.[web:173][web:176] 다만 최근 이슈에서 `claude mcp add`가 `/c`를 잘못 파싱하는 버그도 보고되었으므로, 실제 운영 시에는 설정 파일 직접 수정 또는 버전별 테스트가 필요하다.[web:173]

### 14.3 권장 MCP 종류
- Context7: 최신 문서 조회
- Supabase MCP: 스키마 및 DB 보조 작업
- GitHub MCP: 구현 예시 탐색
- 브라우저 계열 MCP: UI 문서/샘플 참고

## 15. 인프라 및 배포 요구사항

### 15.1 배포 기본안
- GitHub 저장소 연결
- Vercel 자동 배포
- Supabase 관리형 DB/Auth 사용
- Vercel ISR 또는 revalidate 기반 데이터 캐시 사용[web:167][web:168]

### 15.2 운영 원칙
- on-demand 실시간 조회보다 사전 계산을 우선
- 사용자가 접속할 때마다 외부 API를 직접 치지 않음
- 점수는 스냅샷 테이블에 저장 후 제공

### 15.3 비용 원칙
가족 3명용 비상업 프로젝트 기준으로 무료 또는 저비용 운영을 목표로 한다. 단, Alpha Vantage Free Tier의 호출량은 매우 작으므로 기술적 지표는 배치성 호출로 제한해야 한다.[web:154][web:156]

## 16. 수용 기준

### 16.1 Phase 1 (MVP) 수용 기준
- 홈 화면에서 5초 내 현재 상태를 이해할 수 있다.
- 자산군별 카드가 분리되어 있다.
- 최소 6개 이상의 공통 매크로 코어 지표가 자동 반영된다.
- 데이터 실패 시 캐시와 상태 배지가 작동한다.
- 가족 계정 외 사용자는 데이터에 접근할 수 없다.[web:172][web:175]
- 최근 30일 범위 내의 임의 과거 날짜를 선택하면 그 시점 스냅샷(점수·밴드·기여 지표)과 그때의 `model_version`이 표시된다 (§11.6).
- 데이터가 없는 날짜를 선택하면 값을 추정하지 않고 "수집된 데이터가 없습니다" + 최근 이전 수집일 제안을 보여준다.
- **375px 폭(아이폰 SE 기준) 이상 모바일 뷰포트에서 홈 화면이 가로 스크롤 없이 렌더되고, 상단 상태 카드가 첫 화면에서 잘리지 않아 5초 내 현재 상태를 이해할 수 있다 (§11.7).**
- **모바일(<768px)에서 햄버거 버튼으로 사이드바 드로어가 열리고, 날짜 피커는 네이티브 달력으로 터치 조작 가능하다. 모든 인터랙티브 요소의 터치 타깃은 44×44px 이상이다 (§11.7).**

### 16.2 품질 기준
- 점수 산식 버전이 추적 가능해야 한다.
- 데이터 출처가 화면에 표시되어야 한다.[web:145]
- 사용자 문구는 확정적 자문처럼 보이지 않아야 한다.

### 16.3 Phase 2 수용 기준
- 최소 2개 이상의 기술적 지표(RSI, MACD)가 적용된다.[web:152][web:155]
- BTC에는 최소 1개 이상의 온체인 지표(MVRV 또는 SOPR)가 적용된다.[web:158][web:161]
- 나머지 Phase 2 수용 기준(이동평균선, 뉴스 센티먼트 보조 레이어, 점수 기여도 시각화, 가격 오버레이, PWA)은 §18 Phase 2 bullet 각각에 대응하며 구체 기준은 `docs/phase2_architecture_blueprint.md` §10에서 정의한다.
- **180일 이상 히스토리 범위는 Phase 3로 이연** (현재 90일 구현, §11.6 참조). Phase 2에서는 90일 추이를 acceptance 기준으로 본다.

## 17. 리스크와 대응

| 리스크 | 설명 | 대응 |
|---|---|---|
| Alpha Vantage 호출 제한 | Free Tier는 25/day, 5/min 수준으로 제한적[web:154][web:156] | 배치 호출, 캐시, 로컬 계산(직접 OHLC→지표). Phase 3.0 단일 배치 ≈ 12 AV-served ticker × 1 call × 일 1회로 한도 내 운영 중. |
| Alpha Vantage `outputsize` 제한 (현실화 2026-04-25 → **Phase 3.0 대응 완료 2026-04-26**) | `outputsize=full`이 유료 전환되어 Free Tier는 `compact` 100바만 반환. MA(200) · Disparity 입력 부족. | **Phase 3.0 fallback chain 도입**: AV `compact`로 1차 시도 후 200바 미만이면 Twelve Data (`outputsize=300`, free 800/d, 신규 `TWELVEDATA_API_KEY`)로 폴백, 그래도 실패 시 Yahoo Finance (`query2/v8/chart?range=2y`, 키 불필요)로 폴백. 결과적으로 MA(200) · Disparity · MOMENTUM_TURN 모두 정상 가용. 구현: `src/lib/score-engine/sources/daily-bar-fetcher.ts`. |
| BGeometrics 의존성 (Bitbo 대체, 현실화 → **Phase 3.0 대응 완료**) | bitcoin-data.com 무료 API — 8 req/hr **AND 15 req/day**(15/day가 실제 차단선). Hourly cron × 2 endpoints = 48/day → 3배 초과로 429 발생. | **Phase 3.0 cron 분리**: `ingest-onchain`을 `cron-onchain.yml` (매 4시간) 별도 워크플로로 이전. 6 fires/day × 2 endpoints = 12 calls/day로 한도 내 운영 + 3 calls 헤드룸. 변경된 cadence는 4시간 — MVRV/SOPR은 일별 변동이 작아 충분. |
| Farside ETF flow 의존성 (CoinGlass 대체, 현실화) | CoinGlass v4가 유료 키 필수로 전환되고 Bitbo CDN이 Vercel IP를 차단함. farside.co.uk 정적 HTML 스크래핑으로 대체. | 정식 contract 없는 비공식 소스. 파싱 실패 시 ETF flow 입력 null 처리. |
| Finnhub 센티먼트 범위 제한 | 일부 센티먼트 엔드포인트는 북미 기업 중심[web:160] | 보조 지표로만 사용 |
| 비공식 API 장애 | CNN F&G 등 스크래핑 리스크[web:31] | optional provider + 상태 배지. CNN F&G는 부분 파싱 오류 발생 중(history 일부 row malformed, 현재값은 살아남음); `EXTREME_FEAR`는 VIX 단독 fallback 구현. |
| KR equity 티커 미지원 (현실화 2026-04-25 → **Phase 3.0 대응 완료 2026-04-26**) | Alpha Vantage 무료 티어가 KR `.KS` / `.KQ` / 무접미사 모두 거부. | **Phase 3.0 KR ticker 부활**: 7개 티커(005930.KS, 000660.KS, 373220.KS, 207940.KS, 005380.KS, 069500.KS, 229200.KQ)를 Yahoo Finance `query2/v8/chart` 경로로 운용. AV/Twelve Data는 `isKrTicker()` 가드로 스킵. KR `technical` 카테고리 정상 가용. KR `valuation` 카테고리는 Phase 3.2(포트폴리오 오버레이)에서 DART 어댑터 도입과 함께 활성화 예정. |
| Windows MCP 불안정 | `/c` 처리 버그 및 연결 문제[web:173][web:176] | 설정 파일 직접 관리, 버전 고정 |
| 사용자 과잉신뢰 | 점수를 절대 신호로 오해 가능 | 설명형 UX, 면책 문구, 근거 병기 |

## 18. 개발 단계

### Phase 1 — Core MVP
- Next.js + Supabase + Vercel 기본 골격 구축
- 가족 전용 인증과 RLS 설정[web:172][web:175]
- 공통 매크로 코어 지표 연결
- 홈 대시보드와 자산군 카드
- 변화 로그 기본 버전
- 날짜 탐색 뷰 (점수·밴드 히스토리 전용, §11.6 Phase 1 범위)

### Phase 2 — Technical & On-chain + 가격 오버레이
- RSI, MACD, 이동평균선 반영[web:152][web:155]
- BTC MVRV / SOPR 반영[web:158][web:161]
- 뉴스 센티먼트 보조 레이어 반영[web:160]
- 점수 기여도 시각화
- **가격 히스토리 레이어 도입 (§8.5)** — 자산군별 대표 티커만 일봉 수집, 리스트는 본 단계 착수 시 확정
- **히스토리 뷰에 가격 오버레이 추가 (§11.6 Phase 2 범위)** — 점수 라인 + 대표 티커 가격 라인 동시 표시
- **PWA 대응 (§11.7)** — manifest + service worker 셸 캐싱 구현 완료. Lighthouse PWA ≥ 90 감사 및 실기기 A2HS 테스트는 Phase 2 운영 단계 진행 중.
- **매수 타이밍 시그널 엔진 (§10.4)** — composite score와 병렬로 8개 독립 boolean 시그널(base 6: `EXTREME_FEAR` / `DISLOCATION` / `ECONOMY_INTACT` / `SPREAD_REVERSAL` / `LIQUIDITY_EASING` / `MOMENTUM_TURN` + crypto-extra 2: `CRYPTO_UNDERVALUED` / `CAPITULATION`) 계산. 대시보드/자산/changelog 상단에 "N/M 시그널 활성" 얼라인먼트 카드 노출(M은 자산군별 적용 시그널 수). 신규 데이터: FRED `ICSA` + `WDTGAL`(daily, 주력) / `WTREGEN`(weekly, fallback), CNN F&G (주식 — 부분 파싱 오류 시 VIX 단독 fallback), 기술적 파생 지표 "이격도"(현재 MA_200 영구 null로 입력 부재 — Phase 3 복구 예정).

### Phase 3 — Regime & Portfolio + 백테스트

Phase 3은 4개 product 모듈 + 1개 사전 sub-phase로 나누어 순차 진행한다.

#### Phase 3.0 — Data Source Recovery (2026-04-26 출하 완료)
Phase 2 acceptance matrix의 PARTIAL 행 5건을 닫는 사전 sub-phase. 신규 product 기능 없음. 자세한 설계는 `docs/phase3_0_data_recovery_blueprint.md`.
- **일별 시계열 fallback chain**: AV `compact` → Twelve Data 800/d → Yahoo Finance. MA(200) · Disparity · MOMENTUM_TURN 입력 복구.
- **KR equity 7 ticker 부활**: Yahoo Finance 경로로 `005930.KS` 등 7개 운용.
- **cron-onchain 분리** (매 4시간): BGeometrics 15/day 한도 내 운영.
- **DART/ECOS는 본 sub-phase 범위 밖** — Phase 3.1 / 3.2에서 도입 (아래).

#### Phase 3.1 — Regime Classification (예정)
시장 국면(불황/회복/과열/침체) 분류 엔진 + 점수 해석을 국면 기준으로 재가중. **ECOS 어댑터 도입** — 한국은행 OpenAPI에서 BOK 정책금리, KR 10Y 국채, M2, KRW/USD 환율을 받아 KR equity의 macro 카테고리를 한국 매크로로 보강. KR-specific economic regime 분류 가능. ECOS API 키 등록 필요(무료, 100k req/day).

#### Phase 3.2 — Portfolio Overlay (예정)
가족 3명 보유 종목 입력 → 합성 점수와 결합해 비중 조정 가이드. **DART 어댑터 도입** — 전자공시 시스템에서 EPS/BPS를 받아 KR equity P/E·P/B 산출, KR `valuation` 카테고리 활성화. 자산 상세 페이지에 펀더멘털 카드 추가. DART API 키 (`DART_API_KEY`, 무료, 1000 req/min) 이미 환경변수 등록됨(2026-04-26).

#### Phase 3.3 — Personalization (예정)
사용자별 맞춤 해석. 가족 3명(jw.byun / 여자친구 / 어머니) 각자 위험성향·관심자산 차이를 받아 동일 점수에서 다른 해석 분기.

#### Phase 3.4 — Backtest UI (예정)
백테스트 및 산식 튜닝 UI — 현재 산식을 과거 `raw_payload`에 재실행해 버전 간 비교(§11.6 Phase 3 범위). 단순 "그 시점 결과 조회"는 Phase 1에서 이미 제공되므로 이 UI는 replay·튜닝에 집중한다.

**진행 순서**: 3.0 ✅ → 3.4 → 3.1 (ECOS) → 3.2 (DART) → 3.3. 백테스트가 기존 데이터 위에서 동작하므로 새 스키마 변경 최소이고, 사용자가 모델 신뢰도 검증 가능. 레짐은 백테스트로 검증된 후 추가하면 안전. 포트폴리오·개인화는 새 스키마+UX이므로 안정 단계 이후.

## 19. 최종 권장안
v3 기준 가장 현실적인 시작점은 **Next.js + Supabase + Vercel**을 기본 축으로 하고, 매크로 코어 위에 기술적 지표와 BTC 온체인 오버레이를 올리는 구조다.[web:167][web:172][web:152][web:161] 즉, 제품의 차별점은 단순 지표 수집이 아니라 **거시 + 기술적 + 온체인 신호를 하나의 설명 가능한 점수 엔진으로 통합하는 것**이다.[web:145][web:155][web:158]

기존 v2에서 유지해야 할 강점은 매크로 우선 철학, 자산군별 오버레이, 쉬운 UX 카피, 변화 로그, 지표 설명 레이어다. 이번 v3에서 추가된 강점은 수학적 점수화 정의, 기술적 분석 API 활용 전략, 온체인 데이터의 명시적 편입, 그리고 서버리스 운영을 전제로 한 기술 아키텍처 구체화다.[web:152][web:154][web:167]
