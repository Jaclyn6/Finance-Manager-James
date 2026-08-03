# Session Handoff

## 1. Snapshot Timestamp

2026-08-03 09:40

## 2. Current Phase / Step

Post-MVP. Phase 1–3.4 build sequence complete; product pivoted to 할인
판독기 (advisor verdicts, `adv-1.2.0`, 2026-07-08~). Currently running
the 15-min UX 실사 improvement loop (cron f3f137d2) — 36 iterations
done, ~12 shipped feature-units. Mid-step: user just requested wiring
the missing EXTREME_FEAR sentiment arm (CNN outage) to collectable
data — STOCK_FG_PROXY substitution + `SIGNAL_RULES_VERSION` v1.1.0
bump is the planned treatment (was a backlog user-decision item; now
green-lit).

## 3. Last Commit

`23f88ec` docs(ci): PRODUCTION_URL must be the prod alias — on `main`,
pushed, deployed. Uncommitted: only untracked `.agents/`, `.codex/`
(user's own tool configs — do NOT commit) and stray scratchpad-named
files at repo root (noise).

## 4. Active Thread

- Just finished: PRODUCTION_URL incident — GH secret pointed at a
  stale immutable deployment; write-verdicts 404'd 3 days
  (2026-07-30..08-01). Fixed (secret → alias), verified on the real
  22:07Z schedule (23:02Z success, verdicts_written 4).
- In progress: EXTREME_FEAR 데이터 부족 해소 — CNN_FG is permanently
  null (418 bot-block since 06-24; bypass prohibited), so the tile
  can never resolve. Implement proxy-arm substitution with rules
  bump v1.1.0 + honest 자체 프록시 labeling, Trigger 2, deploy.
- Loop steady-state: iterations now mostly clean verification passes.

## 5. Pending User Decisions

- Supabase magic-link login (password UX for family) — proposed, no
  answer yet.
- Score-engine band label vocabulary (비중 확대 → descriptive terms)
  — `docs/backlog.md` "band labels prescribe allocation".
- Video strategies #3/#4 identification (original pivot request).
- no_drawdown card 할인 어휘 충돌 treatment (b) — backlog, needs
  wording sign-off.

## 6. Recent Context (last 5 commits)

- `23f88ec` CI postmortem note: PRODUCTION_URL must be the alias.
- `6e1fd0a` signed-delta shared module — no ±0.0 badges anywhere;
  quiet-mover line instead of silent omission.
- `71d3900` changelog mover display floor (|Δ|<0.05 hidden).
- `d18d2fb` backlog: no_drawdown bar wording collision.
- `0f7232b` glossary label tier — zero raw-id row titles remain.

## 7. Open Issues to Watch

- `docs/backlog.md` is the source of truth; top opens: EXTREME_FEAR
  proxy substitution (NOW IN PROGRESS), macro-only top_movers scope,
  news-basket US-megacap labeling + AV 25/day budget, net-liquidity
  gauge (needs ~4wk WALCL/WRESBAL/RRPONTSYD history), verdict-flip
  alerting, hit-rate report (~2026-10).
- advisor_verdicts JSONB: adv-1.2.0 rows before 2026-08-03 lack
  `verdict.evidence` — readers must fall back (`verdict-row.ts` doc).
- Backtest reads are unpaginated, guarded only by MAX_RANGE_DAYS=365
  (`src/app/api/backtest/run/route.ts` comment).
- GH cron slots drift/skip under load (off-minute schedules already);
  intervene only on 2+ consecutive misses.
- 60-day GHA auto-disable clock reset by 2026-08-02 commits.

## 8. Environment State

- Next.js 16.2.4 (`cacheComponents`), @supabase/ssr 0.10.2, Supabase
  `hhohrclmfsvpkigbdpsb` (Seoul), Vercel CLI deploys (account
  jaclyn6, no Git integration — deploy via `npx vercel --prod`).
- Tests: 800 passing (vitest). `next build` clean.
- MCP: supabase, context7, alphavantage, figma (figma + vercel-plugin
  need OAuth re-auth in an interactive session).
- `.env.local` names: NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
  FRED_API_KEY, ALPHA_VANTAGE_API_KEY (25 req/day!), CRON_SECRET,
  VERCEL_OIDC_TOKEN, FINNHUB_API_KEY, TWELVEDATA_API_KEY,
  DART_API_KEY, ECOS_API_KEY.
- GH Actions secrets: CRON_SECRET, PRODUCTION_URL (MUST stay the
  alias `https://finance-manager-james.vercel.app`).
- Crons: Vercel `ingest-macro` 06:00Z; GHA hourly cnn-fg :17, onchain
  4h :42, technical daily 22:07Z (incl. write-verdicts step 3).
- Known-broken: CNN F&G scrape (418 since 06-24 — do not bypass);
  ingest-news removed from hourly (AV quota).

## 9. How to Resume

- Read `docs/phase1_architecture_blueprint.md` v2.1 §9 to understand
  build sequence, then `docs/advisor_pivot_blueprint.md` (§7 shipped
  log) for the current product shape.
- Read `docs/backlog.md` for open items and CLAUDE.md for the
  Trigger 2 review rule (mandatory before any push).
- Next concrete action: implement EXTREME_FEAR proxy-arm substitution
  — `evaluateExtremeFear` accepts STOCK_FG_PROXY fallback with a
  viaProxy flag, bump `SIGNAL_RULES_VERSION` to v1.1.0
  (`src/lib/score-engine/weights.ts:46`), label 자체 프록시 in
  `describeSignalSituation`/`SIGNAL_THRESHOLD_KO`, wire proxy into
  `loadSignalInputs` (`src/lib/data/signals.ts`), then Trigger 2 →
  push → `npx vercel --prod` → verify the tile resolves.
