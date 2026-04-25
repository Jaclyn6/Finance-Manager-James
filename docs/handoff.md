# Session Handoff

## 1. Snapshot Timestamp

2026-04-26 (UTC 20:01 / KST 2026-04-26 05:01) — Phase 2 운영 단계 day-1, PRD v3.5 정합화 완료, 시그널 카드 사용자 친화 카피 + Lighthouse 점수 확보. Phase 3 구현 시작 전 사용자 의사결정 대기.

## 2. Current Phase / Step

**Phase 2 운영 단계 (Day 1 of 7-day reliability watch).** Implementation 완료, 운영 검증 진행 중. 다음 단계 후보: (a) Phase 3 budget 결정 → blueprint 저작 → 구현, (b) 운영 검증 7일 마무리 후 Phase 3 진입.

## 3. Last Commit

`2058bd9` — `docs: PRD v3.5 — align with Phase 2 shipped reality` on `main`. 이전 코드 커밋은 `9f3b9ef` (signal tile clarity). Pushed, 작업 트리 clean (단, 본 핸드오프 추가 시 staged됨).

## 4. Active Thread

- **Just finished (이번 세션)**:
  1. **시그널 카드 카피 정정** — `켜짐/꺼짐/불명` → `조건 충족/조건 미충족/데이터 부족`. 8개 시그널별 `SIGNAL_DESCRIPTION_KO` 한 줄 설명 + 라이브 `describeSignalSituation()` "지금: ..." 입력값 요약 추가. Tile에 4단 레이아웃(라벨+상태칩 → 설명 → 지금 라인) 적용. (`9f3b9ef`)
  2. **5-agent code review (Trigger 2)** — 1건 confidence 85 발견 (`describeSignalSituation` default 부재 → 미래 SignalName 추가 시 `"undefined"` 렌더). `never`-cast exhaustiveness guard로 수정.
  3. **Production deploy** — `dpl_9LFchLniR92q5z4n4htUE94P7cYw` (READY). `finance-manager-james.vercel.app` alias 갱신.
  4. **백로그 신설** (`docs/backlog.md`, `106e072`) — 일시 vs 영구 "데이터 부족" 구분 + Phase 3 blueprint 저작을 막는 budget 결정 3건 + 잡다한 tech-debt 기록.
  5. **PRD v3.5 정합화** (`2058bd9`) — Bitbo→BGeometrics, CoinGlass→Farside, AV outputsize=full→compact + MA_200/Disparity 영구 null caveat, 6→8 시그널 + per-asset 매핑(us_equity 6 / crypto 7 / kr_equity 5 / global_etf 5), 90일 history 범위 정정, PWA shipped 표기, cacheLife 모델 반영, §17 4건 risk를 현실화로 promote.
  6. **acceptance matrix 갱신** — SignalCard `/changelog` 출하로 §10.1 row 8 + §10.3 row 3 PARTIAL→MET. 합계 11/16 MET.
  7. **Day-1 운영 점검**:
     - cron-hourly: 최근 8/8 SUCCESS (last 2026-04-25 19:43Z, 1m12s–1m22s 범위).
     - cron-technical: 다음 schedule fire = 2026-04-25 22:00 UTC (KST 07:00) — 이 핸드오프 작성 시점에서 ~2시간 뒤. 기존 5건 FAILURE는 모두 fix 커밋(`d536141` KR carve-out + 단일배치 복귀) 이전 — 다음 fire가 진정한 day-1 검증.
     - Lighthouse 13.1.0 mobile audit (production `/login?next=%2Fdashboard` — auth 게이트로 dashboard 직접 audit 불가): Performance 94 / Accessibility 95 / Best Practices 100 / SEO 100. Lighthouse 13에서 PWA 카테고리 deprecated. manifest 6/6 icons HTTP 200, sw.js HTTP 200 3,118 bytes 검증. 색상 대비 1건 fail(login 페이지 한정 추정), LCP 2.7s.
- **About to start (next session)**:
  - 2026-04-25 22:00 UTC scheduled cron-technical fire 결과 확인 — `gh run list --workflow=cron-technical.yml --limit 3`. SUCCESS면 day-1 fully green, 7일 watch가 정상 진행.
  - 사용자가 Phase 3로 넘어가기로 결정하면, `docs/backlog.md` "Phase 3 blueprint blockers" 3건 결정 → `docs/phase3_architecture_blueprint.md` 저작.
- **Not blocked.** All deployments green; 다음 자연 cron fire 결과만 대기.

## 5. Pending User Decisions

- **Phase 3 진입 시점**: 7일 watch 완료(2026-05-02)까지 기다릴지 vs 즉시 blueprint 저작 시작.
- **Phase 3 blueprint blockers** (`docs/backlog.md` 참조):
  - **Glassnode $29/mo** vs BGeometrics 8/hr 무료 유지 → MVRV/SOPR 안정성.
  - **AV Premium $50/mo** vs Twelve Data(800/d 무료) / Yahoo Finance / Polygon → MA_200·Disparity·MOMENTUM_TURN 복구.
  - **KR equity 소스**: ECOS API(무료, 키 등록) vs Yahoo Finance scrape vs 영구 null 유지.

## 6. Recent Context (last 5 commits)

- `2058bd9` PRD v3.5 — Phase 2 출하 현실과 정합화 (소스 마이그레이션 + 시그널 6→8 + 90일 history + PWA shipped + cacheLife + §17 risks 현실화). acceptance matrix 11/16 MET.
- `106e072` `docs/backlog.md` 신설 — 일시 vs 영구 "데이터 부족" 구분 + Phase 3 blockers + tech-debt.
- `9f3b9ef` signal tile clarity — `조건 충족/조건 미충족/데이터 부족` + 한 줄 설명 + 라이브 "지금: ..." + exhaustiveness guard. 5-agent review confidence 85 1건 수정 후 푸시.
- `23dbc1d` 직전 handoff snapshot.
- `94ae128` 점수 투명성 — 방향(거꾸로 보는 vs 그대로 보는) + 계산 방식 + 자산 row raw value column.

## 7. Open Issues to Watch

- **cron-technical 첫 정상 schedule fire** — 2026-04-25 22:00 UTC (KST 2026-04-26 07:00). 이 결과가 day-1 진정한 검증. SUCCESS이어야 7일 watch가 실질적으로 시작됨.
- **Lighthouse audit `/login` 한계** — production dashboard는 auth 게이트로 unauthenticated audit 불가. 실기기 A2HS 테스트(iOS Safari + Android Chrome)는 사용자가 직접 수행해야 함. Lighthouse 색상 대비 1건 fail은 /login 페이지 한정으로 추정 (dashboard에서 재확인 필요).
- **BGeometrics 8/hr quota** — cron-hourly에서 1-2 매트릭 429 hit 정상 (fetch_status='error' propagate). Phase 3 Glassnode 검토.
- **MA(200) + Disparity 영구 null** — AV `outputsize=compact` 100바 한도. 글로서리 + PRD §8.2 + §17에 명시됨. Phase 3 dependency.
- **KR equity 2/6 categories null** — `.KS` 티커 AV 미지원. ECOS API Phase 3 대기.
- **CNN F&G 부분 파싱 오류** — history row malformed, EXTREME_FEAR는 VIX 단독 fallback 운용 중.
- **shadcn `tw-animate-css` v1.4** prefers-reduced-motion 룰 미포함 — Sheet/Popover/Tooltip slide-in 영향, 별도 CSS layer 필요 시 추가.
- **`button.tsx` `icon-lg` (size-9) variant** 잔존; `icon-touch` (size-11)로 마이그레이션 candidate.
- **`indicator-glossary.test.ts` jargon banlist** scoping에 BB_20_2 σ 예외 처리 유지 — test가 transparency 필드만 검사하는 컨벤션 유지.

## 8. Environment State

- **Stack**: Next.js 16.2.4 (Turbopack, cacheComponents:true), React 19.2.4, Tailwind v4, @supabase/ssr 0.10.2, TS 5 strict, Recharts 3.x, Vitest 4.1.4, sharp 0.34.5.
- **Tests**: **505/505 green** across 32 files. 본 세션에서 신규 helper 추가했으나 기존 테스트 모두 유지.
- **MCP servers**: figma, supabase, context7, alphavantage, Claude-in-Chrome (jw.byun@toss.im 인증).
- **`.env.local` keys**: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, FRED_API_KEY, ALPHA_VANTAGE_API_KEY, CRON_SECRET (43-char), FINNHUB_API_KEY, VERCEL_OIDC_TOKEN.
- **Vercel prod**: `finance-manager-james.vercel.app` → `dpl_9LFchLniR92q5z4n4htUE94P7cYw` (commit `9f3b9ef`; 이후 PRD/handoff는 doc-only 커밋이라 재배포 불필요).
- **GitHub repo secrets**: CRON_SECRET, PRODUCTION_URL (`https://finance-manager-james.vercel.app`), FINNHUB_API_KEY.
- **Supabase**: hhohrclmfsvpkigbdpsb (Seoul, Postgres 17.6.1.104). Migrations 0001–0010 applied.
- **Known integrations broken / degraded** (PRD §17 v3.5에도 명시):
  - BGeometrics MVRV/SOPR — 8/hr 무료 한도 (cron-hourly 부분 실패 정상).
  - CNN F&G — partial (history row malformed; 현재값 살아남음).
  - AV `outputsize=full` paid-only → compact 100바.
  - KR `.KS` tickers AV 미지원 (registry에서 제거됨).

## 9. How to Resume

1. **첫 액션**: `gh run list --workflow=cron-technical.yml --limit 3` 으로 2026-04-25 22:00 UTC (KST 2026-04-26 07:00) 스케줄 fire 결과 확인. SUCCESS면 day-1 fully green; FAILURE면 logs 분석 후 즉시 대응.
2. **Day-1~7 운영 watch** (2026-04-25 → 2026-05-02): 매일 cron-hourly + cron-technical 각각 SUCCESS 비율 점검. `signal_events` / `composite_snapshots` / `technical_readings` today's row 존재 확인.
3. **Phase 3 진입 결정**:
   - 사용자가 §5의 budget 결정 3건을 내려주면 → `docs/phase3_architecture_blueprint.md` 저작 시작 (Phase 2 blueprint와 동일 구조: §3 sources / §4 engine / §5 schema / §9 build sequence).
   - 또는 7일 watch 완료까지 implementation 미진입.
4. **참고 문서**: `docs/phase2_architecture_blueprint.md` (as-built), `docs/phase2_acceptance_matrix.md` (11/16 MET), `docs/backlog.md` (Phase 3 blockers + tech-debt), `investment_advisor_dashboard_prd_kr_v3.md` v3.5 (정합화 완료).

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
