# Session Handoff

## 1. Snapshot Timestamp

2026-04-26 (Phase 2 사용자 친화 layer 완성 — 23-지표 글로서리 + 점수 투명성 (raw value + 방향 + 계산 방식) 모두 production 배포·시각 검증 완료)

## 2. Current Phase / Step

**Phase 2 IMPLEMENTATION COMPLETE.** Blueprint §9 Build Sequence Steps 1–13 + composite v2 category wiring + source recoveries + Trigger 2 review + acceptance matrix + 23-indicator beginner glossary + scoring transparency layer 모두 `main`에 shipped. 다음 단계는 implementation이 아니라 **운영 단계**: 7-day reliability watch + Lighthouse PWA audit + Phase 3 planning.

## 3. Last Commit

`94ae128` — `feat(phase2): scoring transparency — direction + method + raw value rendering` on `main`. Pushed (origin in sync). Working tree clean.

## 4. Active Thread

- **Just finished**: 사용자 두 차례 피드백 수용 완료 — (a) 23-지표 한국어 글로서리 + popover/페이지 (b) 점수 방향 + 점수 계산 + 자산 페이지 raw value column. 통계 용어(z-score/표준편차/σ) 일상 표현으로 전부 풀어쓴 톤 검증 통과.
- **Production 시각 검증 통과** (Chrome MCP): `/indicators` 🧭 점수 읽는 법 info box + 23 카드 점수 방향/계산 섹션, `/asset/us-equity` "VIX 19.31 포인트" raw value 표시, popover에 "지금: 19.31 포인트 (보통 15~25)" 라인 모두 정상.
- **About to start (next session)**: 7-day reliability watch (Day 1=2026-04-26) / Lighthouse PWA audit / 실기기 A2HS 테스트 / Phase 3 budget 결정 (Glassnode $29/mo, AV Premium $50/mo, ECOS API).
- **Not blocked.** All deployments green; signal_events / composite_snapshots / technical_readings 모두 today's row 보유.

## 5. Pending User Decisions

- **Phase 3 budget**: $29/mo Glassnode (MVRV/SOPR 안정화) vs BGeometrics 8/hr 무료 유지.
- **Phase 3 KR equity**: ECOS API (무료, 키 등록) vs Yahoo Finance scrape vs KR technical 영구 null.

## 6. Recent Context (last 5 commits)

- `94ae128` 점수 투명성 — 방향(거꾸로 보는 vs 그대로 보는) + 계산 방식(통계 용어 0개) + 자산 row raw value column. 505/505 tests, 사용자가 점수 의미를 직관적으로 이해 가능.
- `540466a` Glossary 도입 직후 handoff 동기화.
- `b5c3c83` 23-지표 초보자 글로서리 — popover + `/indicators` 페이지 + 사이드바 "참고" 그룹. §0.5 tenet 4 actionable 갭 메움.
- `2f8b72c` Phase 2 implementation 완료 시점의 final handoff (acceptance 9 MET / 7 PARTIAL).
- `8261924` `/changelog`에 SignalAlignmentCard 추가 + ESLint §7.4 invariant guard. Trigger 2 surfaced 갭 마감.

## 7. Open Issues to Watch

- **GHA cron-technical 어제 22:00 UTC 자동 run** 결과 미확인 — `gh run list --workflow=cron-technical.yml --limit 3`로 확인. 12-ticker single batch 154s 예상.
- **BGeometrics 8/hr quota**: cron-hourly 매번 1-2 매트릭에서 429 hit (예상 동작; `fetch_status:'error'` 정상 propagate).
- **MA(200) + Disparity 영구 null** until Phase 3 (AV `outputsize=compact` 100바 한도). 글로서리에 명시되어 있음.
- **KR equity 2/6 categories** 영구 (ECOS Phase 3 대기).
- **shadcn `tw-animate-css` v1.4** prefers-reduced-motion 룰 미포함 — Sheet/Popover/Tooltip slide-in에 영향. 별도 CSS layer 필요 시 추가.
- **`button.tsx` `icon-lg` (size-9) variant** 잔존; 새 `icon-touch` (size-11)로 마이그레이션 candidate.
- **`indicator-glossary.test.ts` jargon banlist** scoping에 `BB_20_2.shortKo`/`beginnerExplanationKo`의 "2σ" 표기 예외 처리 필요 (Bollinger 표준 표기). 현재 test가 transparency 필드만 검사하도록 명시되어 있음 — 이 컨벤션 유지할 것.

## 8. Environment State

- **Stack**: Next.js 16.2.4 (Turbopack, cacheComponents:true), React 19.2.4, Tailwind v4, @supabase/ssr 0.10.2, TS 5 strict, Recharts 3.x, Vitest 4.1.4, sharp 0.34.5 (Next 트랜지티브, `scripts/generate-icons.mjs` 사용).
- **Tests**: **505/505 green** across 32 files.
- **MCP servers**: figma, supabase, context7, alphavantage, **Claude-in-Chrome** (jw.byun@toss.im 인증, tabGroupId 690806389).
- **`.env.local` keys**: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, FRED_API_KEY, ALPHA_VANTAGE_API_KEY, CRON_SECRET (43-char), FINNHUB_API_KEY (INACTIVE 배너), VERCEL_OIDC_TOKEN.
- **Vercel prod**: alias `finance-manager-james.vercel.app` → 최근 deployment `finance-manager-m806gug8m-jaclyn6s-projects.vercel.app` (commit 94ae128).
- **GitHub repo secrets**: CRON_SECRET, PRODUCTION_URL (`https://...` 프리픽스 포함), FINNHUB_API_KEY.
- **Supabase**: hhohrclmfsvpkigbdpsb (Seoul, Postgres 17.6.1.104). Migrations 0001–0010 applied.
- **Known integrations broken / degraded**:
  - BGeometrics MVRV/SOPR — 8/hr 무료 한도 (cron-hourly 부분 실패 정상).
  - CNN F&G — partial (51 history rows malformed; 현재값 살아남음).
  - AV `outputsize=full` paid-only → compact 100바.
  - KR `.KS` tickers AV 미지원 (registry에서 제거됨).

## 9. How to Resume

- Read `docs/phase2_architecture_blueprint.md` v1.0 §9 Build Sequence + 2026-04-25 amendments (§3.1/§3.2/§10.1/§10.2/§11) to understand the as-built state.
- Read `docs/phase2_acceptance_matrix.md` for the 16-criterion status table (9 MET / 7 PARTIAL / 0 DEFERRED) — surface what's still PARTIAL and why.
- **Concrete next action**: run `gh run list --workflow=cron-technical.yml --limit 3` + `gh run list --workflow=cron-hourly.yml --limit 3` to confirm overnight cron health (Day 1 of 7-day reliability watch). Then run a Lighthouse PWA audit on `https://finance-manager-james.vercel.app` and record the score in `docs/phase2_acceptance_matrix.md` row 13 (target ≥ 90).

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
