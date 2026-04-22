# Phase 1 Finish + Phase 2 Plan

**Authored:** 2026-04-23
**Source facts baseline:** PRD v3.2 (`investment_advisor_dashboard_prd_kr_v3.md`), Phase 1 Blueprint v2.3 (`docs/phase1_architecture_blueprint.md`), Handoff (`docs/handoff.md`).
**Status at authoring:** Phase 1 Steps 1–11.5 complete (`cfb813e`); Step 12 (Vercel deploy + smoke test) pending. Phase 2 not started — no Phase 2 blueprint exists yet.

This plan is designed to be executed consecutively across multiple chat contexts. Each Phase is self-contained with its own doc references, verification checklist, and anti-pattern guards. Do not skip Phase B — Phase 2 cannot start coding until its blueprint is authored and reviewed.

---

## Phase 0 — Documentation Discovery (Reference Pack)

### 0.1 Allowed source facts

| Fact | Source | Exact citation |
|------|--------|---------------|
| Phase 1 scope | PRD §18 lines 440–446 | 6 bullets (골격/인증/매크로/카드/변화 로그/30일 날짜 탐색) |
| Phase 2 scope | PRD §18 lines 448–455 | 7 bullets (RSI·MACD·MA / MVRV·SOPR / 뉴스 센티먼트 / 기여도 viz / 가격 오버레이 / PWA) |
| Phase 3 scope | PRD §18 lines 457–461 | 레짐 분류 / 포트폴리오 / 맞춤 해석 / 백테스트 |
| Phase 1 acceptance | PRD §16.1 lines 409–420 | 5초 이해 / 카드 분리 / ≥6 매크로 / 30일 범위 / 모바일 44×44 |
| Technical indicator spec | PRD §8.2 lines 144–152, §9.1–9.2 lines 178–188, §10.1–10.3 lines 208–224 | RSI(14), MACD, 50/200MA, Bollinger; Alpha Vantage source; RSI ≤30 high→≥70 very low normalization |
| On-chain indicator spec | PRD §8.3 lines 154–162, §9.3–9.4 lines 190–201 | MVRV Z (Bitbo), SOPR (Bitbo), ETF 순유입 (CoinGlass), Fear & Greed (alternative.me); MVRV ≤0 top→≥7 very low normalization |
| News sentiment spec | PRD §8.4 line 164, §18 line 451 | Finnhub 뉴스 센티먼트, "보조 지표로만 사용" |
| Price history layer | PRD §8.5 lines 167–174 | `price_readings` table sketch; KR=KOSPI/KOSDAQ ETF+대형주 / US=S&P/Nasdaq ETF / Crypto=BTC/ETH / ETF=VT/EEM; Alpha Vantage + CoinGecko or CoinGlass; "점수 엔진에 입력되지 않음 — 시각화 전용" |
| Phase 2 ticker decision | PRD §8.5 line 170 | "구체 티커 리스트는 Phase 2 구현 시점에 확정" |
| History range ≥180d | PRD §11.6 line 266 | "Phase 2 이후 180일 이상 범위 보장" |
| PWA spec | PRD §11.7 lines 292–293, §18 line 455 | Web app manifest, service worker 셸 캐싱, 홈 설치 아이콘 |
| Out-of-scope (perma) | PRD §4.2 lines 60–64 | 자동매매 / 개별 목표가 / 초단타 / 기관 파생상품 리스크 엔진 |
| Out-of-scope (mobile) | PRD §11.7 lines 287–290 | 오프라인 지원 / 커스텀 제스처 / haptics — Phase 1 이연, Phase 2 재진입 명시 없음 |
| Persona layers | PRD §5 lines 66–74, §6.2 lines 86–88 | 초보자(상태 색상+행동 가이드) vs 전문가(점수 분해+차트+percentile) — 원칙만 명시, Phase 2 acceptance 부재 |
| Caching TTLs | PRD §12.2 lines 306–312 | 매크로 24h / 기술적 12–24h / 온체인 1h / 뉴스 1h |
| Security | PRD §13.4 lines 361–369 | RLS 전 스키마 / 공개 회원가입 off / 수동 3계정 / API key 서버 전용 |
| Risks to mitigate | PRD §17 lines 429–436 | Alpha Vantage 25/day 5/min / Finnhub 북미 중심 / Bitbo 비공식 |
| Phase 1 Step 12 spec | Blueprint v2.3 §9 line 435 | push → env vars(Prod only) → 수동 cron 트리거 → Supabase 데이터 확인 → `revalidateTag` 확인 → `?date=` 왕복 확인 |
| Blueprint env vars | Blueprint v2.3 lines 386–394 | 6 keys; service_role/FRED/CRON_SECRET/Alpha Vantage는 Production only |
| Cron cadence (current) | Blueprint v2.3 §3 line 121 + `vercel.json` | 06:00 UTC daily, Hobby 1/day limit |
| Score engine v1 | Blueprint v2.3 §4 lines 146–155 | 7 FRED / MODEL_VERSION v1.0.0 / 5y z-score / zScoreTo0100 / bands 80-60-40-20 |
| server-only invariant | Blueprint v2.3 line 414, 429 | `admin.ts` + `fred.ts` guarded; `fred-parse.ts` guard-free for Node scripts |
| Admin-in-cache decision | Blueprint v2.3 line 380 (commit `6aab776`) | 데이터 family-wide → admin client inside `'use cache'` 허용 |
| Composite snapshot invariant | Blueprint v2.3 §2 Supabase Schema — `composite_snapshots` unique index `(asset_type, snapshot_date, model_version)` + §11 trade-off #7 (별도 스냅샷 테이블) | 같은 키 한 번만 쓰임; 가중합 재계산 금지; model_version 공존 구조적 허용 |

### 0.2 Known ambiguities the PRD does NOT resolve

These MUST be resolved at the start of Phase B (Phase 2 blueprint authorship) before any code is written. Do not guess — document the decision with reasoning in the blueprint.

1. ~~**PRD §16.1 vs §18 contradiction**~~ — **RESOLVED 2026-04-23 in PRD v3.3**: §18 is canonical. §16.1 renamed to "Phase 1 (MVP) 수용 기준" with the RSI/MACD and MVRV/SOPR rows removed; those rows now live in new §16.3 "Phase 2 수용 기준". Blueprint v2.3 Phase 1 scope (7 FRED indicators only) is confirmed complete per the updated §16.1.
2. ~~**Phase 2 ticker list**~~ — **RESOLVED 2026-04-23**: 총 22 티커. Alpha Vantage 경유 19 + CoinGecko 경유 3.

   **KR (7, Alpha Vantage `.KS` 심볼):**
   - `005930.KS` 삼성전자
   - `000660.KS` SK하이닉스
   - `373220.KS` LG에너지솔루션
   - `207940.KS` 삼성바이오로직스
   - `005380.KS` 현대차
   - `069500.KS` KODEX 200 (KOSPI 200 proxy — native index not in AV)
   - `232080.KS` TIGER 코스닥150

   **US (7, Alpha Vantage):**
   - `SPY`, `QQQ` (broad indices)
   - `NVDA`, `AAPL`, `MSFT`, `GOOGL`, `AMZN` (대형 기술주 5종 — Phase 2 구현 착수 시점에 시총 Top 5 재확인 필수)

   **Region ETF (3, Alpha Vantage):**
   - `EWJ` (iShares MSCI Japan)
   - `MCHI` (iShares MSCI China)
   - `INDA` (iShares MSCI India)

   **Macro-hedge ETF (2, Alpha Vantage):**
   - `GLD` (gold — risk-off hedge, macro 카테고리 보조)
   - `TLT` (20y US Treasury — long-duration 금리 역방향 노출, DGS10 보완)

   **Crypto (3, CoinGecko IDs):**
   - `bitcoin`, `ethereum`, `solana`

   **API budget (Alpha Vantage Free 25/day):**
   - 19 AV 티커 × 1 `TIME_SERIES_DAILY`/day (5년 OHLC 한 번에 받고 RSI/MACD/MA/Bollinger 로컬 계산) = **19 calls/day**.
   - 여유 = **6 calls/day** (수동 backfill + transient 재시도용). 빡빡하지만 안전.
   - 추가 티커는 AV 유료 전환 또는 Twelve Data(800/day free) 이전 없이는 Phase 3로 이연.
   - Crypto budget 독립 — CoinGecko free ~30/min, 3 티커 × 1/day는 사실상 무제한.

   **Ticker drift 리스크:** 시총 Top 5는 주기적으로 바뀜. Phase C Step 9에서 `TICKER_LIST_VERSION` 상수 + snapshot 시점 주석. 티커 교체는 블루프린트 리비전 사유, 코드 silent edit 금지.
3. ~~**KR-specific indicators**~~ — **RESOLVED 2026-04-23**: PRD §10.3 "환율·지역 오버레이: 20" 가중치를 FRED 기반 2개 지표로 채운다. Bank of Korea ECOS API 불필요.

   - **DXY / Broad Dollar Index (`DTWEXBGS`, weight 10)** — 달러 강세 → 외국인 원화 자산 매도 → KR equity 음(-) 시그널. z 양수 → 점수 하락.
   - **USD/KRW (`DEXKOUS`, weight 10)** — 원화 약세 → 외국인 자금 이탈 + 외화 부채 기업 부담. 수출주 수혜보다 자금 유출 효과가 더 크다고 가정 → KR equity 음(-) 시그널. z 양수 → 점수 하락.

   **What was rejected:**
   - `IRLTLT01KRM156N` (한국 10년 금리, FRED) — 월간 데이터. 일일 cron과 cadence 불일치.
   - 한국은행 ECOS API — 인증 + 스키마 학습 비용이 효용 대비 큼.
   - KOSPI 상승률 — KR equity 점수를 KOSPI로 산출하는 것은 자기참조. 제외.
   - KRX 외국인 수급 — 공식 무료 API 없음, 스크래핑 리스크.

   **Integration cost:** `cron-macro`의 FRED series 7 → 9. Batch 호출이라 API 횟수 변화 없음.
4. ~~**Per-persona Phase 2 UX**~~ — **RESOLVED 2026-04-23**: Phase 2는 페르소나 분기 UI를 추가하지 않는다. PRD §6.2 초보자/전문가 레이어 원칙은 Phase 1 수준으로 유지 (쉬운 문장 + 색상 밴드 + 상세 차트 병존). 세 가족 구성원(jw.byun / edc0422 / odete4)은 동일한 대시보드를 본다. 사용자별 개인화(맞춤 해석, 선호 자산, 푸시 규칙)는 PRD §18 line 460 "사용자별 맞춤 해석"에 따라 **Phase 3로 이연**.
5. ~~**Mobile ergonomics in Phase 2**~~ — **RESOLVED 2026-04-23**: Phase 2는 **PWA만** 재진입. 나머지 PRD §11.7 이연 항목 (오프라인 데이터 캐시 / 커스텀 제스처 pull-to-refresh·swipe·long-press / web haptics)은 Phase 2에서도 범위 밖 유지. PWA 구현 범위 = web app manifest + service worker **셸 캐싱 (오프라인 데이터 없이 앱 셸만)** + 홈 설치 아이콘. iOS Safari + Android Chrome에서 "홈 화면에 추가" 가능 확인이 acceptance.
6. ~~**Non-functional: SLA, WCAG level, i18n, monitoring, observability**~~ — **RESOLVED 2026-04-23**: Phase 2는 새 NFR을 추가하지 않는다. Phase 1이 이미 제공 중인 수준(staleness 배지, model_version 추적, Vercel Analytics, 키보드 포커스 + 44×44 터치로 WCAG AA 부분 충족) 유지. SLA/Uptime 약속 없음 (가족 3명 내부 도구). i18n 없음 (한국어 고정). Sentry/에러 트래킹 외부 도구 도입 없음 (Vercel 로그 + GitHub Actions 알림으로 충분). 제품 성숙도가 올라가는 Phase 3에서 재평가.
7. ~~**CoinGecko vs CoinGlass vs Bitbo priority**~~ — **RESOLVED 2026-04-23**: PRD §8.3 그대로 3개 소스 분리. 각자 자기 분야 전문이라 품질 리스크가 가장 낮은 경로.
   - **Bitbo**: MVRV Z-Score + SOPR
   - **CoinGlass**: BTC Spot ETF 순유입
   - **alternative.me**: Crypto Fear & Greed Index
   - **CoinGecko** (별도, 가격 전용): BTC/ETH/SOL 일봉
   - **Alpha Vantage**: BTC 기술적 지표용 OHLC 필요 시 `TIME_SERIES_DAILY symbol=BTC-USD` 또는 CoinGecko 가격으로 RSI/MACD 로컬 계산 — Phase B 블루프린트에서 확정.

   **Implementation pattern:** 각 소스마다 `{source}.ts` (fetcher, server-only) + `{source}-parse.ts` (pure, Node-env 재사용용) split. Phase 1의 `fred.ts` + `fred-parse.ts`를 그대로 복제.

   **Failure policy** (see §0.5 cross-cutting tenet 1): 모든 소스의 실패는 staleness 배지 + `ingest_runs` 로그 + 필요 시 hard-fail 배너로 surface. 비공식 API (Bitbo, alternative.me)의 다운타임은 "열화 신호"로 흡수되어야지 "최신 데이터인 척" 제공되면 안 됨.
8. ~~**Vercel Hobby cron 1/day limit**~~ — **RESOLVED 2026-04-23**: GitHub Actions scheduled workflows will drive all non-daily crons. Vercel Cron keeps the one daily macro slot (06:00 UTC, unchanged from Phase 1).

   **Sub-decisions:**
   - **Cadence assignment:**
     - 매크로 (FEDFUNDS, CPIAUCSL, DGS10, T10Y2Y, VIXCLS, BAMLH0A0HYM2, SAHMCURRENT) → Vercel Cron `0 6 * * *` (existing). Unchanged.
     - 기술적 (RSI, MACD, MA, Bollinger × 4 assets) → GitHub Actions `0 22 * * *` (22:00 UTC, ≈ 1h after US close so daily OHLC is settled at Alpha Vantage).
     - 온체인 (MVRV, SOPR, ETF flow, F&G) → GitHub Actions `0 * * * *` (hourly).
     - 뉴스 센티먼트 → bundled into the same hourly workflow as 온체인 (single runner invocation calls both endpoints).
   - **Endpoint separation vs workflow bundling:** follow Phase 1 convention — one Vercel API route per ingestion type (`/api/cron/ingest-technical`, `/api/cron/ingest-onchain`, `/api/cron/ingest-news`). One GitHub workflow file per cadence (`cron-technical.yml` daily / `cron-hourly.yml` hourly calling both onchain+news endpoints sequentially). Error isolation at the endpoint layer; minute savings at the workflow layer.
   - **Secret management:** same `CRON_SECRET` stored in (a) Vercel Production env (already exists), (b) GitHub repo Actions secrets (new — must be added during Phase C Step 7). Manually kept in sync. No OIDC for now.
   - **Budget:** private repo → GitHub Actions free tier = 2,000 min/month. Hourly workflow × 720 runs × ~30s = ~360 min/mo. Daily technical workflow = ~15 min/mo. Total headroom ≈ 1,600 min/mo unused. Safe. If repo is made public later, cap disappears.
   - **Region:** GitHub runners in US; they hit the Vercel Production public URL (`https://…vercel.app/api/cron/*`) via `curl -H "Authorization: Bearer $CRON_SECRET"`. Vercel Function then talks to Supabase Seoul. No regional performance issue — ingest latency is not user-facing.
   - **Observability:** GitHub Actions UI shows success/failure per run + log. Vercel Function logs capture the endpoint side. Both layers must 200 for a run to count as healthy. Failure alerts = GitHub Actions email notifications (default) for now; consider Discord/Slack webhook in Phase 3.
   - **Rate-limit guard (Alpha Vantage Free 25/day, 5/min, PRD §17 line 431):** technical cron must batch — ≤16 calls/day (4 indicators × 4 assets, or fewer by reusing OHLC base series). Budget 9 calls/day headroom for manual backfill. Cron must sleep between calls to respect 5/min.

   **Anti-patterns to avoid (Phase C Step 7 implementation):**
   - Do NOT call `/api/cron/*` from GitHub Actions without the `Authorization: Bearer $CRON_SECRET` header — endpoints reject unauthenticated calls.
   - Do NOT put the secret in the workflow file as plaintext. Use `${{ secrets.CRON_SECRET }}`.
   - Do NOT schedule with minute-level precision (`* * * * *`) — GitHub Actions enforces 5-min minimum and quietly drops sub-5-min triggers.
   - Do NOT assume exact on-the-hour execution — GitHub Actions schedules can drift by 10+ minutes during peak load. Downstream readers must tolerate stale-by-minutes freshness.
   - Do NOT rely on the schedule trigger for a repo that has been inactive for 60+ days — GitHub auto-disables it. Not a risk for an active project but worth noting.
9. ~~**Score engine version bump**~~ — **RESOLVED 2026-04-23**: MODEL_VERSION v2.0.0, **greenfield from deploy date** (option b). 기존 v1 composite_snapshots 행(30일치 backfill)은 그대로 유지, 같은 날짜에 대한 v2 재계산 없음. 대시보드 기본은 v2; `date < v2 시작일`이면 v1 표시 + UI 상단에 "모델 전환일: YYYY-MM-DD" 배지로 불연속을 투명하게 표기.

   **Why greenfield over replay:**
   - Bitbo MVRV/SOPR, CoinGlass ETF flow의 과거 데이터 가용성이 비공식 API라 불확실. 신뢰도 낮은 숫자로 replay 시 되돌리기 비쌈.
   - PRD §11.6 "Phase 2 이후 180일 이상" 요구는 시간이 지나면서 자연 축적으로 충족. 배포 즉시 180일 요구 아님.
   - 블루프린트 v2.3 §2 스키마 — `composite_snapshots` unique index `(asset_type, snapshot_date, model_version)` 가 이미 model_version 공존을 구조적으로 허용.

   **Cutover checklist (Phase C Step 6):**
   - `MODEL_VERSION` 상수 bump (`src/lib/score-engine/weights.ts`)
   - `composite_snapshots` reader가 `.eq('model_version', MODEL_VERSION)` 필터링 (v1 잔재 안 읽음)
   - 대시보드 헤더에 "모델 v2.0.0" 뱃지 + hover 툴팁으로 변경 이유 설명
   - `/asset/[slug]` trend line이 모델 전환일에 수직 구분선 렌더
   - 30일 기존 backfill은 DB에 남겨두되 readers가 v1.0.0 행을 건너뜀

10. **US equity "valuation" (§10.1, weight 10) 데이터 소스** — PRD §10.1은 "밸류에이션: 10" 가중치를 명시하지만 구체 지표/소스 미지정. 후보: Shiller P/E (비공식 `multpl.com` 스크래핑 또는 `MULTPL` series), FRED `SP500PE` (공식이지만 저빈도 갱신), Alpha Vantage fundamentals endpoint (Free Tier 25/day 부담 가중). **상태: 미해소**. Phase 2 블루프린트 §12 trade-off 7에서 임시 처리(sentiment 카테고리에 10 흡수)로 Phase 3까지 이연하되, Phase C Step 6 전에 공식 결정 필요. 흡수 방식을 유지할지(단순), 정식 밸류에이션 소스를 Phase 2에 통합할지(정확) 선택.

### 0.3 Anti-patterns to avoid (from handoff + blueprint)

- **Do NOT** create `middleware.ts` — file is `proxy.ts` (Next 16.2 rename).
- **Do NOT** call `cookies()` / `headers()` / `connection()` inside a `'use cache'` scope.
- **Do NOT** import `server-only` modules from `scripts/` (tsx) — use the `-parse.ts` split pattern from `fred-parse.ts`.
- **Do NOT** recompute composite score on request — always read from `composite_snapshots` by `(asset_type, snapshot_date, model_version)`.
- **Do NOT** skip the `CRON_SECRET` Bearer check on any cron endpoint.
- **Do NOT** emit an investment-advice CTA — PRD §13.2 lines 349–355 bans 추천/목표가 language.
- **Do NOT** amend an already-pushed commit — create a new commit (CLAUDE.md workflow).
- **Do NOT** skip the 5-agent code review on step completion or feature completion (CLAUDE.md Trigger 1/2).
- **Do NOT** silently swallow data-source errors (FRED/AV/Bitbo/CoinGlass/alternative.me/Finnhub/CoinGecko). Every failure must surface via staleness badge, `ingest_runs` row, or hard-fail banner — see §0.5 tenet 1.

### 0.4 Copy-ready patterns (from Phase 1)

| Pattern | Source | Use for |
|---------|--------|---------|
| `'use cache'` reader with `cacheTag` + `cacheLife` | `src/lib/data/indicators.ts` | New Phase 2 readers (`getLatestTechnicalSnapshots`, etc.) |
| `server-only` fetcher + parse-ts split | `src/lib/score-engine/indicators/fred.ts` + `fred-parse.ts` | Alpha Vantage / Bitbo / CoinGlass clients |
| Cron endpoint with `CRON_SECRET` | `src/app/api/cron/ingest-macro/route.ts` | New cron endpoints |
| Normalization to 0–100 | `src/lib/score-engine/normalize.ts` | Technical and onchain normalizers |
| Composite snapshot writer | `src/lib/score-engine/snapshot.ts` | Extend to category-based writer in Phase 2 |
| Backfill script with Node-env imports | `scripts/backfill-snapshots.ts` | Phase 2 backfill (180d) |
| Partial Prerender shell + Suspense + `connection()` | `src/app/(protected)/dashboard/page.tsx` | Any new dynamic route reading `searchParams` |
| Recharts Client Component + ResponsiveContainer + aria-label | `src/components/asset/score-trend-line.tsx` | Price overlay chart |
| hybrid DatePicker (native on mobile / Popover on desktop) | `src/components/ui/date-picker.tsx` | Any new date-range UI |

### 0.5 Cross-cutting design tenets

1. **"성공은 조용히, 실패는 시끄럽게" (Silent success, loud failure)** — 모든 데이터 수집 경로(FRED / Alpha Vantage / Bitbo / CoinGlass / alternative.me / Finnhub / CoinGecko)의 실패는 사용자에게 가시적인 신호로 노출된다. Phase 1이 `StalenessBadge.tsx`로 매크로 composite에 한해 구현했고, Phase 2는 카테고리별로 확장한다.
   - **Per-category staleness 배지**: dashboard + `/asset/[slug]`에 카테고리별(매크로 / 기술적 / 온체인 / 센티먼트) 배지. 카테고리 안 최악 소스의 "마지막 성공 ingest 시각" 노출. Stale 기준 = 해당 카테고리 TTL의 2배 경과 (매크로 48h / 기술적 48h / 온체인 2h / 센티먼트 2h).
   - **Hard-fail 배너**: 어느 카테고리든 최근 7일간 성공 수집이 0건이면 페이지 상단 빨간 배너 ("매크로 데이터 수집이 일주일간 실패했습니다 — 점수 신뢰도 저하"). 오늘 점수가 녹색이어도 배너는 숨기지 않음.
   - **No silent stale fallback**: reader가 stale 데이터를 fresh인 척 반환 금지. 마지막 성공값이 stale이면 UI가 반드시 플래그. Phase 1 `StalenessBadge` 패턴이 template.
   - **Ingest run logging**: 모든 `/api/cron/ingest-*` 엔드포인트가 `ingest_runs`에 `{source, status, error, indicators_success, indicators_failed}` 행 기록. `indicators_failed > 0`이면 per-indicator 에러 리스트를 UI가 surface 가능.
   - **GitHub Actions job failure**: hourly workflow 실패 → GitHub 이메일 (repo owner 기본 수신). Phase 2에서 Slack/Discord webhook 추가 없음 (Phase 3 고려).
   - **Anti-pattern (금지)**: 에러를 삼키고 `null` / 빈 배열 / 0점 반환. 이는 이 원칙 위배.

2. **"Snapshot immutability"** (Phase 1 상속) — `composite_snapshots(asset_type, snapshot_date, model_version)`은 한 번 쓰면 in-place 업데이트 불가. 수정은 `MODEL_VERSION` bump으로만. `raw_payload` replay용으로 보존 (PRD §11.6 line 271 Phase 3 백테스트 기반).

3. **"Family-wide, not per-user"** (Phase 1 상속) — Phase 2 reader도 가족 전체 공용. Admin client(service_role)를 `'use cache'` 안에서 쓰는 게 OK인 이유: 데이터가 per-user 스코프가 아닌 가족 공유라 캐시 key가 동일해도 정상. `cookies()` inside cache 금지 회피.

4. **"Actionable over aggregate"** (PRD v3.4 신설, §10.4 기반) — composite score는 모델이 시장을 *어떻게 보는가*의 요약이고, signal alignment는 사용자가 *무엇을 할까*를 판단하는 근거다. 둘은 병렬로 제공되어야 하고, UI는 signal alignment를 composite 밴드보다 **더 눈에 띄게** 배치한다. 초보자 페르소나(어머니/여자친구)에게 "점수 47점"은 해석이 필요하지만 "4/6 시그널 동시 발화"는 즉각 이해 가능하다. 이 원칙이 Phase 2 UX의 가장 중요한 의사결정 기준. 대시보드 hero zone = SignalAlignmentCard > CompositeStateCard 순서.

---

## Phase A — Close Phase 1

**Goal:** Ship Phase 1 to Vercel Production, verify all §16.1 acceptance criteria on production domain, and decide whether to invest in Phase 1 polish before Phase 2.

### A.1 Pre-deploy ops

**What to do:**
1. `npm i -g vercel` — install Vercel CLI (not currently installed).
2. `vercel login` with the account that owns the repo integration.
3. `vercel link` inside the repo root — associate with a Vercel project. Choose existing or create new. Match the project name to repo (`finance-manager` or `investment-advisor-dashboard`).
4. `vercel env add` for each of the 6 keys, scope = Production. Mirror the contents of `.env.local` exactly:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (Production only)
   - `FRED_API_KEY` (Production only)
   - `ALPHA_VANTAGE_API_KEY` (Production only — unused in Phase 1 but prepare for Phase 2)
   - `CRON_SECRET` (Production only)
5. Confirm `vercel.json` cron still reads `{ "path": "/api/cron/ingest-macro", "schedule": "0 6 * * *" }` — already set at commit Step 9.
6. `vercel env pull .env.vercel` to round-trip and diff against `.env.local`. They should match byte-for-byte except for Vercel system env vars.

**Verification:**
- `vercel env ls` shows 6 keys with Production scope.
- `vercel.json` untouched (no diff).
- Git working tree clean.

**Anti-pattern guard:**
- Do NOT paste service_role or CRON_SECRET into the `NEXT_PUBLIC_` scope by accident. Server-side keys must be unprefixed.
- Do NOT commit `.env.vercel` — add to `.gitignore` if not already.

### A.2 Step 12 — Deploy + Smoke Test

**What to do:**
1. Push any small doc commit (or just trigger deploy via `vercel deploy --prod` if no code needs changing). Blueprint v2.3 §9 line 435 requires a production deploy, not preview.
2. Wait for Vercel to report the deployment green (build logs clean, 3 protected routes `◐ Partial Prerender`).
3. Visit the production URL. Execute the smoke-test matrix below — each item maps to a PRD §16.1 acceptance line.

**Smoke-test matrix:**

| Check | Acceptance source | How to verify |
|-------|-------------------|---------------|
| Login with `jw.byun@toss.im` succeeds | PRD §16.1 line 416 | `/login` → dashboard. Login with `edc0422@...` + `odete4@...` also works. |
| Dashboard renders backfilled 30-day data | PRD §16.1 line 410, line 417 | CompositeStateCard shows ~47.0 "유지"; 4 asset cards grid; changelog 29 entries. LCP < 5s on 4G. |
| Cron runs on schedule | PRD §16.1 line 412 | Vercel Dashboard → Cron Jobs → `Run Now` → 200 response. Check Supabase: new row in `composite_snapshots` for today's date; `ingest_runs.indicators_success ≥ 6`. |
| `revalidateTag` evicts cache | Blueprint v2.3 §9 Step 12 | After manual cron run, reload dashboard — today's data appears without waiting for `cacheLife('days')` TTL. |
| Staleness badge surfaces on failure | PRD §16.1 line 415 | Temporarily rotate `FRED_API_KEY` in Vercel (break it), redeploy, confirm stale badge. Restore key. |
| `?date=` round-trips | Blueprint v2.3 §9 Step 12 | Navigate to `/dashboard?date=2026-04-15` → sidebar + hamburger nav preserve `?date=`. AssetCard tap → `/asset/us-equity?date=2026-04-15`. Changelog tab → `/changelog?date=2026-04-15` 14-day window. |
| No-snapshot notice + closest-earlier link | PRD §16.1 line 418 | DatePicker → 2026-03-15 (before backfill floor 2026-03-21) → NoSnapshotNotice shows "데이터 없음" + link to 2026-03-21. |
| Mobile 375px < 5s | PRD §16.1 line 419 | Real iOS Safari (not Chrome DevTools). Dashboard loads, hero card above fold, no horizontal scroll. |
| 44×44 touch targets + native date picker | PRD §16.1 line 420 | On iOS, DatePicker renders native date input (CSS branching, not JS). Hamburger opens Sheet. Asset cards tappable. |
| Family-only access | PRD §16.1 line 416 | Sign up with a random non-family email → `proxy.ts` should reject or Supabase should fail login (public signup disabled). |

**Step-12 completion criteria:** every row above returns green. If any fails, fix and redeploy.

**Code review rule (CLAUDE.md Trigger 1):** Step 12 is mostly config; per CLAUDE.md "Not triggered" clause a pure env-var + cron-config step may be review-exempt. Use judgment: if the Step 12 commit includes any runtime-behavior code, run the 5-agent review. If it's purely `vercel env add` sequence + no code diff, skip review.

### A.3 (Optional) Phase 1 polish before Phase 2

These items were flagged by handoff §7 but are not PRD §16.1 acceptance criteria. Defer to Phase 2 unless the user wants cleanup first.

1. **ThemeToggle + SignOutButton touch targets** — handoff §7: `size-9` (36×36) below ≥44×44. Upgrade to `size-11` or `h-11 w-11`.
2. **Header "오늘의 투자 환경" route-branch on desktop** — handoff §7: mobile hides, desktop always shows. Route-aware heading (e.g., "자산 상세" on `/asset/*`, "변화 기록" on `/changelog`).
3. **Blueprint §5 Routing table sync** — handoff §7: still says `'use cache'` page-level but impl is Partial Prerender. Purely docs.
4. **Recharts motion-safe prefix** — handoff §7: systemic pre-existing from shadcn scaffolds. Add `motion-safe:` to Recharts/Popover/Calendar/Sheet animation classes for `prefers-reduced-motion`.
5. **`scoreToBand` out-of-range policy** — handoff §7: floating-point dust tolerance. Documented, no action needed unless a test fails.

Recommendation: skip A.3 and roll these into Phase 2's first UI-polish pass (Phase C Step 8 or a dedicated C Step).

---

## Phase B — Phase 2 Architecture Blueprint (no code yet)

**Goal:** Produce `docs/phase2_architecture_blueprint.md` v1.0 — the single authoritative source for Phase 2 implementation. Phase 2 coding does NOT start until this blueprint is reviewed and accepted by the user.

**Why a separate blueprint phase:** Phase 1 required a v1→v2 rewrite (`docs/phase1_blueprint_next16_delta.md`) because Next.js 16 patterns changed under the feet of a training-era blueprint. Phase 2 introduces four new data sources, three new indicator categories, a new cron-cadence problem (Hobby 1/day limit), and a PWA shell. Deciding these up-front in one document avoids mid-stream thrashing.

### B.1 Decisions workshop (to be resolved in the blueprint)

Work through each ambiguity in §0.2 above and commit to a decision. For each, document: the decision, the alternatives considered, the reasoning, and the PRD/blueprint sections to update if any.

**Required outputs of this workshop** (these land as blueprint sections):
- Phase 2 indicator registry: exact identifiers (e.g., `AV_RSI_14`, `BITBO_MVRV_Z`, `COINGLASS_ETF_FLOW_BTC`, `AM_FEAR_GREED`, `FH_SENTIMENT_BTC`), data source, cadence, normalization formula, z-score window (if any), weight per asset.
- Ticker list: concrete tickers per asset_type. Consider Alpha Vantage free-tier 25/day, 5/min.
- Cron cadence plan: which endpoints, which cadences, hosted where (Vercel Hobby vs GitHub Actions vs Pro upgrade).
- MODEL_VERSION v2.0.0 rollout strategy: greenfield from deploy date OR replay backfill onto pre-Phase-2 dates.
- KR-specific indicator list (or explicit deferral).
- Per-persona UX scope for Phase 2 (recommended: none beyond Phase 1 principles).

### B.2 Author `docs/phase2_architecture_blueprint.md`

**What to do:** Write the blueprint following the same section layout as Phase 1 v2.3.

**Required sections (mirror phase1_architecture_blueprint.md):**

- **§1 Product scope recap** — Phase 2 only (RSI/MACD/MA/Bollinger + MVRV/SOPR/F&G/ETF flow + news sentiment + price overlay + 180d history + PWA). Out of scope → Phase 3.
- **§2 Architecture decisions** — table of decisions from B.1 workshop.
- **§3 Data sources + cadences** — per source: auth, rate limits, error handling, caching TTL (PRD §12.2), server-only guard, backfill strategy.
- **§4 Score engine v2** — category model (macro / technical / onchain / sentiment), per-asset weight table, normalization formulas from PRD §9, MODEL_VERSION v2.0.0 contract, backward compatibility with v1.0.0 rows.
- **§5 Routing changes** — new routes? (e.g., `/asset/[slug]/history`?) or reuse existing with expanded data. Address Phase 1 blueprint §5/§7 staleness from handoff.
- **§6 Mobile + a11y** — PWA manifest shape, service worker caching strategy (shell only, no offline data per §11.7), installable icon requirements, reduced-motion compliance.
- **§7 Data flow + new invariants** — how new readers compose with `'use cache'`; price_readings is visualization-only (§8.5) and MUST NOT enter score calculation.
- **§8 Schema migrations** — table DDL: `technical_readings`, `onchain_readings`, `news_sentiment`, `price_readings` (shape per PRD §8.5 line 172). New rows in `indicator_config`. Enum expansions if any.
- **§9 Build sequence (numbered Steps)** — draft 10–13 steps; each step must be independently testable, reviewable (CLAUDE.md Trigger 1), and < 1 day of work.
- **§10 Acceptance criteria** — map each PRD §18 bullet to a verifiable test. Add ops criteria (cron reliability, rate-limit headroom, error-budget).
- **§11 Risks + mitigations** — Alpha Vantage 25/day (schedule + cache), Bitbo non-official API (fallback CoinGlass or cached fallback), Finnhub North-America bias (caveat in UI), cron 1/day constraint (GitHub Actions plan), MODEL_VERSION migration risk.
- **§12 Trade-offs** — same format as Phase 1 v2.3 trade-offs list.

**Verification for Phase B completion:**
- Blueprint file exists at `docs/phase2_architecture_blueprint.md`.
- Every PRD §18 Phase 2 bullet has a matching blueprint §9 Step.
- Every ambiguity in §0.2 above has an explicit decision in the blueprint.
- All anti-patterns in §0.3 are re-stated in the blueprint's own Anti-pattern section.
- User has read and approved the blueprint.

**Anti-pattern guard:**
- Do NOT import Phase 1 blueprint sections wholesale — author fresh. Phase 1 sections become inputs, not content.
- Do NOT ship a blueprint with open ambiguities. If a decision cannot be made, list it under §11 Risks with a "needs user input" tag.
- Do NOT skip the context7 / official-docs lookup for any new dependency (Alpha Vantage SDK, PWA workbox, etc.). PRD v2 rewrite was triggered by out-of-date training data — same risk applies.

### B.3 Blueprint review gate

Before moving to Phase C:
1. Spawn a single-agent review (blueprint compliance vs PRD + internal consistency). Not the 5-agent code review — that's for code, not docs.
2. Commit blueprint as `docs: phase 2 architecture blueprint v1.0`.
3. Push. No code changes in this commit.

---

## Phase C — Phase 2 Implementation

**Goal:** Execute Phase 2 blueprint §9 Steps in numbered order, matching the Phase 1 discipline: each Step = commit → visual verification (if UI) → 5-agent code review (CLAUDE.md Trigger 1) → fix ≥80 confidence findings → push.

**Scope note:** The exact Step list is authored in Phase B §9. The outline below is a *draft* — treat it as the starting sketch, not a contract.

### C.1 (draft) Schema migration
- New tables: `technical_readings`, `onchain_readings`, `news_sentiment`, `price_readings`, `signal_events` (PRD §10.4).
- Expand `indicator_config` with technical + onchain + sentiment rows + 2 new macro rows (`ICSA`, `WTREGEN`/`WDTGAL`).
- RLS policies on all new tables (family-only read, service_role write).
- Add `model_version` column to composite/readings tables; add `signal_rules_version` column to `signal_events` (독립 버전 관리 — composite 가중치와 시그널 임계값 튜닝은 다른 조정 단위).

### C.2 (draft) Data source adapters
- `src/lib/score-engine/sources/alpha-vantage.ts` + `alpha-vantage-parse.ts` (parse/fetch split).
- `src/lib/score-engine/sources/bitbo.ts` + parse split.
- `src/lib/score-engine/sources/coinglass.ts` + parse split.
- `src/lib/score-engine/sources/alternative-me.ts` — Crypto F&G (알고리즘 암호화폐 전용).
- `src/lib/score-engine/sources/cnn-fear-greed.ts` + parse split — **주식 전용** CNN F&G, Markets Data 비공식 JSON endpoint. alternative.me와 별개 소스. §10.4 `EXTREME_FEAR` 시그널에 VIX와 OR 결합 입력.
- `src/lib/score-engine/sources/finnhub.ts` + parse split.
- 기존 FRED 확장: `fred.ts`에 `ICSA` + `WTREGEN`(주간) 또는 `WDTGAL`(일간) series 추가. `fred-parse.ts`는 그대로 재사용.
- Unit tests per parser (vitest) using fixture payloads.

### C.3 (draft) Technical indicator engine
- Pure math module: `src/lib/score-engine/technical.ts` — RSI(14), MACD(12,26,9), MA(50), MA(200), Bollinger(20,2), **이격도 (disparity, `price / MA200 − 1`)**.
- Normalization per PRD §9.1–9.2 (RSI thresholds, MACD signal crossovers). 이격도는 category score(기술적)에 0-100 normalize 입력 **동시에** §10.4 `DISLOCATION` boolean 시그널 (≤ -25% → true) 입력 — 동일한 계산값을 두 소비자가 공유.
- Unit tests with known-answer fixtures (RSI 임계값 경계, MACD cross 감지, 이격도 −25% 정확 매칭).

### C.4 (draft) On-chain indicator engine
- Pure math module: `src/lib/score-engine/onchain.ts` — MVRV Z normalization, SOPR normalization, F&G passthrough, ETF flow normalization (TBD during Phase B).
- Thresholds per PRD §9.3–9.4.
- Unit tests.

### C.5 (draft) News sentiment module
- Weighted passthrough per PRD §8.4 "보조 지표".
- Integration: post-composite, display-only modifier? Or small weight in composite? Decide in Phase B.

### C.6 (draft) Score engine v2
- Bump `MODEL_VERSION` to `v2.0.0` in `weights.ts`.
- New weight tables per asset (PRD §10.1–10.3): US 35/45/10/10, BTC/ETH 35/25/25/15, KR 45/25/20/10.
- Composite writer now multi-category: macro score + technical score + onchain score + sentiment modifier → weighted 0–100.
- v1 rows preserved; v2 rows coexist via `composite_snapshots` unique index on `(asset_type, snapshot_date, model_version)`.
- Backfill: replay against `raw_payload` if Phase B chose rewrite, else greenfield from deploy.

### C.7 (draft) Cron strategy v2
- Decide Phase B: Vercel Pro vs GitHub Actions vs cache-longer.
- If GitHub Actions: add `.github/workflows/cron-technical.yml`, `.github/workflows/cron-onchain.yml`, `.github/workflows/cron-sentiment.yml`. Each hits `/api/cron/*` with `CRON_SECRET`.
- New cron endpoints: `/api/cron/ingest-technical`, `/api/cron/ingest-onchain`, `/api/cron/ingest-sentiment`. Each mirrors `/api/cron/ingest-macro` pattern (CRON_SECRET check → fetch → normalize → write → revalidate).
- **CNN F&G**는 hourly workflow 번들에 추가 (onchain + news와 같은 cadence). 비공식 JSON이라 staleness 배지 정책 엄격 적용 (§0.5 tenet 1).

### C.7.5 (draft) Signal Alignment Engine (PRD §10.4)
- 새 테이블 `signal_events` — `(snapshot_date DATE, active_signals JSONB, alignment_count INT, signal_rules_version TEXT)`, PK `(snapshot_date, signal_rules_version)`, RLS family-only.
- 순수 모듈 `src/lib/score-engine/signals.ts` — 6 boolean 계산:
  - `EXTREME_FEAR` = `VIX ≥ 35 || CNN_FG < 25`
  - `DISLOCATION` = `SPY_disparity ≤ -0.25 || QQQ_disparity ≤ -0.25`
  - `ECONOMY_INTACT` = `ICSA < 300000 && SAHMCURRENT < 0.5`
  - `SPREAD_REVERSAL` = `BAMLH0A0HYM2_today ≥ 4 && BAMLH0A0HYM2_today < max(BAMLH0A0HYM2_last_7d)`
  - `LIQUIDITY_EASING` = `TGA_today < TGA_20d_MA`
  - `MOMENTUM_TURN` = `SPY MACD bullish cross within last N days` (N=7 초안, 블루프린트 확정)
- `SIGNAL_RULES_VERSION` 상수 별도 관리 (composite `MODEL_VERSION`과 독립). 시그널 임계값 튜닝은 composite 가중치 조정과 결이 다름.
- 각 cron ingestion의 마지막 단계에서 signals.compute() 호출 → `signal_events` upsert → `revalidateTag('signals', { expire: 0 })`.
- Readers: `getLatestSignalEvent()` + `getSignalEventForDate(date)` — 둘 다 `'use cache'` + `cacheTag('signals')` + `cacheLife('hours')` (hourly cron이 evict).
- Unit tests: 각 시그널 boundary case (경계값 직상/직하), alignment_count 합산, 누락 입력 데이터 시 해당 시그널을 `false`가 아니라 `null`/unknown 처리 (§0.5 tenet 1 "silent fallback 금지").

### C.8 (draft) Contributing indicators UI v2
- Expand `ContributingIndicators` (Phase 1 component) to 3 categories: 매크로 (7) / 기술적 (4 per asset) / 온체인 (3 for BTC). Grouped visual.
- Score contribution viz per PRD §18 bullet "점수 기여도 시각화" — stacked bar or waterfall chart.
- Mobile: collapsible category sections.

### C.8.5 (draft) Signal Alignment UI Card (§0.5 tenet 4 "Actionable over aggregate")
- 새 컴포넌트 `src/components/dashboard/signal-alignment-card.tsx` — 대시보드 **CompositeStateCard 위에** 배치 (hero zone 최상단).
- 렌더링:
  - 큰 숫자 "N / 6" (Display 타이포, 중앙 정렬) — 활성 시그널 / 전체.
  - 6개 시그널 개별 상태 바 (켜짐=초록, 꺼짐=회색, unknown=호박색). hover/tap 시 시그널 이름 + 임계값 + 현재값 툴팁.
  - `alignment_count ≥ 3`: 노란 배지 "과거 평균 매수 타이밍 조건 충족"
  - `alignment_count ≥ 5`: 초록 배지 "역사적 최적 매수 구간"
  - `alignment_count ≤ 1`: 회색 배지 "대기 구간" (과도한 긴장 유발 회피)
- 면책 문구: 카드 하단 "실제 자산 배분은 본인 판단입니다. 모델은 과거 평균 패턴 기반 확률적 판단 도구입니다" 상시 표기 (PRD §13.2 자문 금지 준수).
- Mobile (375px): 시그널 상태 바가 2행 × 3열 그리드 줄바꿈. 터치 타깃 44×44 준수.
- 날짜 탐색 (§11.6): `?date=` 파라미터로 `signal_events` 과거 행 조회. 당시 어느 시그널이 켜져 있었는지 재현. 시그널 규칙이 당시 `signal_rules_version`이면 그 버전 룩업, 다르면 "규칙 전환일" 배지.
- `/asset/[slug]` 자산 상세: **자산별 시그널 매핑** 적용 — US equity는 6개 모두, BTC/ETH는 MOMENTUM_TURN 대신 crypto MACD로 대체 + MVRV/SOPR 기반 crypto-only 시그널 고려, KR equity는 DISLOCATION 제외한 4개 (Phase B 블루프린트 §4에서 자산별 매핑 표 확정).
- A11y: `role="region"` + `aria-label="매수 시그널 얼라인먼트 N of 6 active"`. 시그널 상태 바는 `role="list"` + `role="listitem"` + 상태를 text로 표현 (색상만 의존 금지).

### C.9 (draft) Price history layer
- Implement `price_readings` writer for representative tickers from B.1 decision.
- Alpha Vantage daily bars + CoinGecko (or CoinGlass) for crypto.
- Cron at appropriate cadence (market close → 06:00 UTC like macro).
- Reader: `getPriceHistoryForAsset(asset, endDate, days)` with `cacheLife('days')`.

### C.10 (draft) Price overlay chart
- Dashboard `CompositeStateCard` optionally overlays common-index price.
- `/asset/[slug]` adds Recharts `ComposedChart` — score LineChart (left axis) + price LineChart (right axis).
- Click-through from history picker to "그때 점수 72점 → 이후 30일 +2.3%" annotation per PRD §11.6 line 270.
- 44×44 touch targets, motion-safe animations.

### C.11 (draft) 180-day history extension
- Update `asset-slug.ts` / `date-picker.tsx` clamp floor from 30d to 180d per PRD §11.6 line 266.
- Extend `scripts/backfill-snapshots.ts` to cover 180 days (re-run against v2.0.0).
- Confirm Alpha Vantage rate-limit budget tolerates the backfill.

### C.12 (draft) PWA shell
- `public/manifest.webmanifest` per PRD §18 line 455.
- Service worker with shell-only caching (no offline data per PRD §11.7).
- App icons (192, 512, maskable).
- iOS install flow tested on real device.
- Verify lighthouse PWA score ≥ 90.

### C.13 (draft) Vercel deploy v2 + smoke test
- Follow Phase A.2 pattern but with Phase 2 data present.
- Add any new env vars (Alpha Vantage, Bitbo, CoinGlass, alternative.me, Finnhub keys).
- Smoke-test matrix covers every PRD §18 bullet.
- Validate cron schedule works (manual trigger + wait-for-scheduled).

**Review + push discipline for every Step:** CLAUDE.md Trigger 1 — start dev server → visual verification → user confirms → 5-agent code review → fix ≥80 confidence findings → commit fixes → push → advance.

---

## Phase D — Final Verification

**Goal:** Prove Phase 1 + Phase 2 together satisfy PRD v3.2 §16.1 (Phase 1 acceptance) AND §18 Phase 2 bullets (every one testable).

### D.1 Acceptance matrix
Walk through every row of PRD §16.1 + every bullet of PRD §18 lines 448–455. For each, cite the file/commit that proves it and attach a screenshot or test output.

### D.2 Anti-pattern sweep
Grep for known bad patterns:
- `middleware.ts` (should not exist).
- `cookies()` / `headers()` / `connection()` inside any `'use cache'` scope.
- Missing `CRON_SECRET` Bearer check on cron endpoints.
- `model_version` IS NULL in `composite_snapshots`.
- Recharts without `role="img"` + aria-label.
- Touch targets < 44×44 (ThemeToggle, SignOutButton, chart legend).

### D.3 Test suites
- `npm test` — target 150+ tests green (up from 108 at Phase 1 close).
- `npm run lint` — clean.
- `npm run build` — green; verify all Phase 2 routes report `◐ Partial Prerender` or documented equivalent.

### D.4 Ops smoke
- Vercel production: all crons green for 7 consecutive days.
- Supabase: no RLS leaks (test with anon key — should see zero rows).
- Alpha Vantage: 7-day rate-limit log shows < 25/day usage.

### D.5 Handoff
Write a `/handoff` snapshot closing out Phase 2 and opening Phase 3 preparation.

---

## Appendix — Ordering rationale

Why Phase A before Phase B:
- Step 12 proves the Phase 1 production deploy path works before Phase 2 complicates the env/cron surface.
- If Step 12 uncovers a fatal prod-only issue (cache, auth, cron), Phase 2 planning can absorb the fix.

Why Phase B before Phase C:
- Phase 1's v1→v2 rewrite proved that blueprint-up-front pays off under framework churn.
- Phase 2 has 8 open ambiguities (§0.2) that each could thrash implementation if decided mid-code.
- Blueprint is cheap (one session); a mid-Phase-2 pivot is expensive (multiple commits + reviews).

Why Phase D is a distinct phase:
- CLAUDE.md Trigger 2 (feature completion) requires 5-agent review of the full feature diff. Phase 2 IS a feature-unit. D.1–D.4 feeds that review with evidence.
