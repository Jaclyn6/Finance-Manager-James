# Session Handoff

## 1. Snapshot Timestamp

2026-04-26 (UTC ~20:50 / KST 2026-04-26 05:50) — **Phase 3.0 "Data Source Recovery" production deploy 완료** (`52601f8`). Trigger 2 5-agent review 4건 fix 적용 → push → vercel deploy → alias swap 모두 완료. 기다리는 단계: 다음 scheduled cron-technical fire (2026-04-25 22:00 UTC, 약 1시간 뒤)에서 새 fallback chain이 실제 데이터를 채워야 acceptance SQL 검증 가능. 시각 검증 결과: 페이지 렌더링 정상, 데이터는 어제 cron 결과 (변화 미반영 — 다음 cron fire가 진정한 검증).

## 2. Current Phase / Step

**Phase 3.0 Step 6 (docs) 진행 중 → Trigger 2 review 대기.** 본 push 후 Phase 3.0 closeout (production deploy + Chrome MCP verify + acceptance matrix MET 행 promote).

다음 sub-phase 후보 (사용자 추천 순서대로): **Phase 3.4 백테스트 → 3.1 레짐 (ECOS adapter 포함) → 3.2 포트폴리오 (DART adapter 포함) → 3.3 개인화**.

## 3. Last Commit (pushed to origin/main)

`52601f8` — `fix(phase3.0): Trigger 2 review fixes (4 findings ≥80 confidence)`. Phase 3.0 모든 commits (96865e8..52601f8) push 완료. Production deployment `dpl_qn9lb996w` (READY), alias `finance-manager-james.vercel.app` 신규 배포로 갱신 완료.

## 4. Active Thread

- **Just finished**:
  1. Phase 3.0 blueprint authored (`docs/phase3_0_data_recovery_blueprint.md`, 9 sections + 6 build steps), 사용자 §9 게이트 5건 모두 승인.
  2. **API 키 등록 완료**: `TWELVEDATA_API_KEY` (4dd6b...) + `DART_API_KEY` (ebb499...) 모두 .env.local + GH secrets + Vercel Production env 3곳에 입력. 둘 다 라이브 curl 검증 (SPY 일봉 / Samsung 임원공시 200 OK).
  3. **Phase 3.0 Step 1**: `twelvedata.ts` + parse + 10 tests (커밋 ~~~).
  4. **Phase 3.0 Step 2**: `yahoo-finance.ts` + parse + 11 tests (KR-offset 케이스 포함). Live curl로 SPY/.KS/.KQ 모두 200 검증.
  5. **Phase 3.0 Step 3+4**: `daily-bar-fetcher.ts` 3-tier fallback chain + `ticker-registry.ts` KR 7개 부활 (19 tickers) + `TICKER_LIST_VERSION` v3.0.0-2026-04-26 + ticker-registry.test.ts 갱신.
  6. **Phase 3.0 Step 5**: `cron-hourly.yml` 에서 ingest-onchain 제거 + `cron-onchain.yml` 신설 (매 4시간, 12 BGeometrics calls/day).
  7. **Phase 3.0 Step 6**: PRD v3.6 (§17 4건 risk를 "대응 완료"로 promote, §18 Phase 3 sub-phase 4개로 분리 + DART → 3.2 / ECOS → 3.1 명시), acceptance matrix Phase 3.0 section 추가, backlog.md 업데이트.
  8. Tests **532/532 green** (505 → 532, +27 신규: 10 twelvedata-parse + 11 yahoo-finance-parse + 5 daily-bar-fetcher + 4 ticker-registry 갱신 = 30 추가, -3 빠진 KR carve-out assertion 갱신).
- **About to start (next session)**:
  - Trigger 2 5-agent review on Phase 3.0 full diff (`96865e8..HEAD`).
  - Confidence ≥ 80 findings 수정.
  - Push to `main`.
  - Vercel production deploy.
  - Chrome MCP visual verify (KR 자산 페이지에 RSI/MACD/MA 등이 실제로 렌더되는지).
  - Acceptance matrix §10.1 row 1 + §10.3 row 1 + 3 deferred rows의 SQL acceptance criteria 검증 후 PARTIAL → MET promote.
- **Not blocked** — 남은 작업은 모두 자동/순차.

## 5. Pending User Decisions

- **ECOS API 키 발급** — Phase 3.1 진입 시 요청 예정. https://ecos.bok.or.kr/api/ 에서 무료 키 등록 (가입 + 메일 인증). 사용자가 발급 후 키 전달하면 환경 3곳 등록.
- **Phase 3 sub-phase 진입 시점** — Phase 3.0 closeout 완료 후 즉시 3.4 백테스트 시작? 아니면 7일 cron watch 마무리 (2026-05-02) 후?

## 6. Recent Context (Phase 3.0 commits, local only, not yet pushed)

- `54fed3a` Step 5 — cron-onchain.yml split (every 4h, 12 BGeometrics calls/day, under 15/day cap)
- `<step3+4 commit sha>` Step 3+4 — daily-bar-fetcher.ts 3-tier fallback chain + KR ticker reinstatement (12 → 19, TICKER_LIST_VERSION bump)
- `<step2 commit sha>` Step 2 — yahoo-finance.ts adapter (Tier 3 / KR primary, no key, KR-offset case tested)
- `<step1 commit sha>` Step 1 — twelvedata.ts adapter (Tier 2, free 800/d)
- `96865e8` (last pushed) Phase 3.0 blueprint authored + budget decisions resolved in backlog
- `3ce87ac` (pushed) docs: day-1 ops snapshot — Lighthouse 94/95/100/100 + cron health
- `2058bd9` (pushed) docs: PRD v3.5 — align with Phase 2 shipped reality

## 7. Open Issues to Watch

- **Phase 3.0 push 전 Trigger 2 review 미실행** (CLAUDE.md 위반 방지). 다음 행동.
- **Phase 3.0 acceptance criteria SQL 검증 미실행** — 다음 cron-technical fire 후 SQL 6건 (MA_200 not null, Disparity not null, DISLOCATION/MOMENTUM_TURN unknown 탈출, KR row count, kr_equity composite categories non-null) 실행 + 결과 acceptance matrix에 기록.
- **MODEL_VERSION 5pp drift check** — Phase 3.0 후 7일 동안 us_equity composite 평균 |drift| > 5pp 시 v2.1.0 cutover. 7일 후 측정.
- **cron-technical 다음 schedule fire** — 2026-04-25 22:00 UTC (KST 2026-04-26 07:00). 19-ticker walltime ≈ 181s 예상 (300s 한도 내). 결과 확인 필요.
- **BGeometrics 8/hr · 15/day** — 4시간 cadence에서 정상 작동 확인 (다음 cron-onchain fire 결과로 검증).
- **CNN F&G partial 파싱** — 여전히 history row malformed 발생 가능 (Phase 3.0 범위 밖, EXTREME_FEAR VIX-only fallback 운용 중).
- **shadcn `tw-animate-css` v1.4** prefers-reduced-motion 미포함 — tech-debt.
- **`button.tsx` `icon-lg` (size-9) variant** 잔존 — `icon-touch` (size-11) 마이그레이션 candidate.

## 8. Environment State

- **Stack**: Next.js 16.2.4 (Turbopack, cacheComponents:true), React 19.2.4, Tailwind v4, @supabase/ssr 0.10.2, TS 5 strict, Recharts 3.x, Vitest 4.1.4, sharp 0.34.5.
- **Tests**: **532/532 green** across 35 files (Phase 3.0에서 +27).
- **MCP servers**: figma, supabase, context7, alphavantage, Claude-in-Chrome (jw.byun@toss.im 인증).
- **`.env.local` keys** (이번 세션 추가분 굵게):
  - NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, FRED_API_KEY, ALPHA_VANTAGE_API_KEY, CRON_SECRET (43-char), FINNHUB_API_KEY, VERCEL_OIDC_TOKEN
  - **TWELVEDATA_API_KEY** (Phase 3.0 신규)
  - **DART_API_KEY** (Phase 3.2 사전 등록)
- **Vercel prod env vars**: 위 모든 키 + TWELVEDATA_API_KEY + DART_API_KEY 등록 완료.
- **GitHub repo secrets**: CRON_SECRET, PRODUCTION_URL, FINNHUB_API_KEY, **TWELVEDATA_API_KEY**, **DART_API_KEY**.
- **Supabase**: hhohrclmfsvpkigbdpsb (Seoul, Postgres 17.6.1.104). Migrations 0001–0010. Phase 3.0 마이그레이션 없음 (스키마 변경 0건).
- **Cron workflows**: cron-hourly.yml (cnn-fg + news, 매시), **cron-onchain.yml (신규, 매 4시간, BGeometrics)**, cron-technical.yml (daily 22:00 UTC, 19 tickers via fallback chain).

## 9. How to Resume

1. **첫 액션**: Phase 3.0 5개 commits를 push하기 전에 Trigger 2 5-agent review 실행.
   - 대상 diff: `git diff 96865e8..HEAD`
   - 5 agents: AGENTS.md/blueprint compliance / shallow bug scan / git history regression / code-comments-vs-reality / a11y+i18n.
   - confidence ≥ 80 findings 수정 후 별도 commit, 그 다음 push.
2. **Production deploy**: `vercel deploy --prod --yes` + `vercel alias set <new-url> finance-manager-james.vercel.app`.
3. **Chrome MCP visual verify**: `/asset/kr-equity` 페이지에서 005930.KS 가격/MA/RSI 등이 실제로 렌더되는지 + composite 점수의 technical 카테고리 non-null 확인. `/asset/us-equity` 에서 SPY MA(200) / Disparity 시리즈가 채워지는지 확인 (다음 cron-technical fire 후).
4. **Acceptance criteria SQL 검증** (다음 cron-technical fire 후):
   - `SELECT count(*) FROM technical_readings WHERE indicator_key='MA_200' AND value_raw IS NOT NULL AND observed_at::date = CURRENT_DATE - INTERVAL '1 day';` (≥ 10 expected)
   - `SELECT per_signal_detail->'DISLOCATION'->>'state' FROM signal_events ORDER BY snapshot_date DESC LIMIT 1;` (active/inactive expected, NOT unknown)
   - 같은 패턴으로 MOMENTUM_TURN, KR row count, kr_equity composite categories 검증.
5. **Phase 3.0 closeout commit**: acceptance matrix의 PARTIAL 행을 MET으로 promote + handoff 갱신.
6. **참고 문서**: `docs/phase3_0_data_recovery_blueprint.md` (as-built), `docs/phase2_acceptance_matrix.md` (현재 11/16 MET → Phase 3.0 후 13–14/16 예상), `docs/backlog.md` (Phase 3.x DART/ECOS 일정), `investment_advisor_dashboard_prd_kr_v3.md` v3.6.

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
