# Session Handoff

## 1. Snapshot Timestamp

2026-04-20 00:40 (manual `/handoff`-equivalent rewrite, immediately after removing the auto-handoff-on-clear hook)

## 2. Current Phase / Step

**Phase 1, Step 7 complete.** Next is **Step 8 (cron route handler)** — but a new **Step 8.5 (mobile shell retrofit)** is pending user confirmation of four decision points, and if confirmed it lands between Step 8 and Step 9 rather than displacing Step 8.

Blueprint v2.1 §9 Build Sequence — Steps 1–7 ✔.

## 3. Last Commit

Will be the commit made immediately after this handoff snapshot (removes the `UserPromptSubmit` hook + hook script + safety-net paragraph in CLAUDE.md + restores this rich handoff over the mechanical one at `e41edbe`).

Prior to that commit, `main` tip is `e41edbe` (mechanical auto-handoff — being superseded). The true "Step 7 complete + post-review fixes" cursor is `30d7f5e`. Everything before that is Step 6 and handoff-infra work.

Working tree state at snapshot time:
- `.claude/settings.json` — modified (hook config removed)
- `.claude/hooks/auto-handoff-on-clear.sh` — deleted (directory gone)
- `CLAUDE.md` — modified (safety-net paragraph replaced with "manual-only" note)
- `docs/handoff.md` — this file (rewritten)

## 4. Active Thread

- **Just finished:**
  - Step 7 data layer (`6aab776`): `src/lib/data/{tags,snapshot,indicators,changelog}.ts` + `src/lib/utils/date.ts` + tests. Resolved blueprint §7 open question #3 by using the admin (service_role) Supabase client inside `'use cache'` scopes (no `cookies()` dependency, client created fresh inside function body so serializability is moot).
  - 5-agent code review → 3 findings ≥80 confidence → all fixed in `30d7f5e`:
    1. Added `.eq("model_version", MODEL_VERSION)` to every composite/changelog reader so a future MODEL_VERSION bump can't silently mix versions (conf 85).
    2. Added `import "server-only"` to `src/lib/supabase/admin.ts` — makes any accidental `"use client"` import chain a build-time error instead of a silent runtime leak (conf 80).
    3. Fixed stale "robust to a week of ingest outages" comment (actually 6 consecutive missed days) (conf 82).
  - Mobile audit (PRD + blueprint + current components, 3 parallel Explore agents): confirmed **mobile is entirely undocumented** and the current UI is **mobile-hostile** (fixed `w-60` sidebar with no drawer, fixed `px-6` padding, no `<ResponsiveContainer>`, no explicit viewport meta, placeholder `p-12`). Only the login form is mobile-friendly.
  - Removed `UserPromptSubmit` hook: matcher `^/clear\b` was firing on unrelated prompts and overwriting rich `handoff.md` with mechanical fallbacks. Hook script + config deleted; CLAUDE.md updated to mark handoffs "manual-only".
- **About to start:** awaiting user confirmation on 4 mobile-retrofit decision points (§5). On confirmation → PRD + blueprint edits, insert Step 8.5, then Step 8 cron. If user declines mobile scope → go directly to Step 8.
- **Not blocked** on build/tests: `npm run build` green, `npm run lint` green, Vitest 56/56 green.

## 5. Pending User Decisions

Four mobile-retrofit decisions to unblock the blueprint + PRD edits:

1. **Primary breakpoint** — use `md` = 768px for the sidebar↔drawer switch? (Alt: `lg` = 1024px keeps drawer up through tablet portrait.)
2. **Mobile date picker** — use the browser-native `<input type="date">` on `<md` (free touch-friendly UX, no extra code), falling back to shadcn `Popover + Calendar` on `md+`? (Trade-off: visual inconsistency with header styling.)
3. **Step 8.5 placement** — land the mobile shell retrofit *after* Step 8 cron and *before* Step 9 dashboard UI, so all subsequent UI is authored mobile-first?
4. **Phase 1 mobile scope cap** — exclude PWA / offline / gestures / haptics from Phase 1? (They'd be Phase 2+ if we want them at all.)

Default if user says "yes to all": proceed exactly as proposed.

## 6. Recent Context (last 5 commits, pre-this-snapshot)

- `e41edbe` docs: auto-handoff mechanical snapshot on /clear — **spurious**, written by the removed hook; this handoff rewrite supersedes it.
- `30d7f5e` Step 7 post-review fixes — model_version filter + server-only guard + comment fix.
- `6aab776` Step 7: data layer — writers + 'use cache' readers + tag registry + date utils.
- `9cd51d3` docs: update handoff snapshot — pre-Step 7 rich handoff.
- `f3db835` docs: refresh handoff snapshot with post-hook-wiring state — (now-obsolete mentions of the hook.)

## 7. Open Issues to Watch

- **`score_changelog` unique index** — missing today; `writeScoreChangelog` uses plain `.insert()`. TODO in `src/lib/data/snapshot.ts` file-level doc: add migration `0004_score_changelog_unique.sql` adding `CREATE UNIQUE INDEX score_changelog_dedup ON public.score_changelog (asset_type, change_date, model_version)` **during Step 8**, then switch the writer to an upsert on that constraint. Prevents duplicate delta rows on cron retry.
- **`scoreToBand` out-of-range policy** — unchanged, tolerated as floating-point dust.
- **Vercel CLI not installed** — `npm i -g vercel` before Step 12 deploy.
- **Secrets hygiene** — `.env.local` holds live Supabase service_role JWT, FRED key, Alpha Vantage key, CRON_SECRET. Git-ignored; present on disk.
- **Mobile support** — not yet in PRD or blueprint; audit done; Step 8.5 proposed; awaiting the 4 decisions in §5 before editing docs.
- **Blueprint §7 open question #3** — **RESOLVED** at commit `6aab776`. Admin client inside `'use cache'` scopes, no cookies dependency; rationale documented in the top-of-file block of `src/lib/data/indicators.ts`.
- **Auto-handoff overwrite risk** — **RESOLVED** by removing the hook entirely.

## 8. Environment State

- Stack: **Next.js 16.2.4**, React 19.2.4, Tailwind v4, `@supabase/ssr` 0.10.2, TypeScript 5, `next-themes` 0.4, Recharts 3.8, Vitest 4.1, IBM Plex Sans.
- Cache model: **Path B** (`cacheComponents: true`). Runtime APIs under `<Suspense>` or inside `'use cache'` only. Data-layer readers use the admin client inside `'use cache'` to sidestep the cookies-serializability constraint.
- File rename: `middleware.ts` → `proxy.ts` (Next 16). Never create `middleware.ts`.
- `server-only` guard live in `src/lib/supabase/admin.ts` — any `"use client"` import chain reaching it is a build-time error.
- Supabase project: `hhohrclmfsvpkigbdpsb` (ap-northeast-2 Seoul, free tier).
- Family users in `auth.users`: `jw.byun=beb7b8af...` / `edc0422=6dd6fbf2...` / `odete4=dbe5c5db...`. `user_metadata.persona` set at creation (`expert` / `intermediate` / `beginner`).
- `asset_type_enum`: `us_equity | kr_equity | crypto | global_etf | common`. `btc` → `crypto` via migration `0003`.
- MCP servers (project-scope `.mcp.json`): `figma`, `supabase`, `context7`, `alphavantage`. Supabase token expired once mid-project; re-auth via `/mcp` if needed.
- `.env.local` keys (names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `CRON_SECRET`.
- GitHub repo: `Jaclyn6/Finance-Manager-James` (private). `gh` CLI auth'd as `Jaclyn6`.
- Dev server: `npm run dev` via `preview_start` (`.claude/launch.json`). Port 3000.
- Handoff: **manual only** now. `/handoff` slash command at `.claude/commands/handoff.md`. No hooks.
- Code-review workflow: per CLAUDE.md Trigger 1 and Trigger 2, run `/code-review:code-review` (5-agent Sonnet + Haiku scoring, filter ≥80) on every Step completion and every pre-push feature-unit.

## 9. How to Resume

1. Read `docs/phase1_architecture_blueprint.md` v2.1 §9 Build Sequence. Current position: **Step 7 complete** (both `6aab776` and `30d7f5e` landed).
2. Check §5 above — if the four mobile-retrofit decisions are still open, surface them to the user, collect answers, then:
   - Edit PRD (`docs/investment_advisor_dashboard_prd_kr_v3.md`): §5 타겟 사용자 (mobile-primary note), new §11.7 모바일 지원 범위, §13.3 stack note, §16.1 2 acceptance lines.
   - Edit blueprint to v2.2: §1 folder additions (`mobile-nav.tsx`, `ui/sheet.tsx`), §6.1 date-picker mobile branch, new §6.2 Responsive Layout, §9 insert Step 8.5, §10 new acceptance rows, §11 new trade-off #14.
   - Then proceed Step 8 → Step 8.5 → Step 9.
3. If mobile scope is declined or deferred, go straight to **Step 8 (cron route handler)**:
   - Create `src/app/api/cron/ingest-macro/route.ts`: CRON_SECRET Bearer check → fetch 7 FRED series → `computeZScore` / `zScoreTo0100` → `computeComposite` per asset class → `writeCompositeSnapshot` + `writeScoreChangelog` + `writeIngestRun` (all from `src/lib/data/snapshot.ts`) → `invalidateMacroSnapshotCache()` + `invalidateChangelogCache()`.
   - Also add migration `0004_score_changelog_unique.sql` (see §7) and switch `writeScoreChangelog` to upsert on the new index.
   - Create `src/lib/score-engine/indicators/fred.ts` (import boundary for FRED fetches, only imported by the cron handler per blueprint §8 safety invariants).
   - Add `vercel.json` cron schedule (06:00 UTC daily).
   - Local smoke via `curl -H "Authorization: Bearer ${CRON_SECRET}" http://localhost:3000/api/cron/ingest-macro`.
4. Run `/code-review:code-review` (or spawn 5 parallel reviewers per CLAUDE.md) on the Step 8 commit; fix ≥80 findings; push.

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation; there is no automation overwriting it.*
