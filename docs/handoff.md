# Session Handoff

## 1. Snapshot Timestamp

2026-04-20 01:05 (manual `/handoff`-equivalent rewrite after mobile-scope decisions confirmed and PRD v3.2 + blueprint v2.2 edits applied)

## 2. Current Phase / Step

**Phase 1, blueprint §9 Step 8 complete ✔.** Next is **Step 9 (cron route handler)**, and a new **Step 9.5 (mobile shell retrofit, v2.2)** is queued between Step 9 and Step 10.

Note on numbering: earlier conversation turns sometimes called the data layer "Step 7" — that was a lag; the blueprint's Step numbering (§9 Build Sequence) is authoritative, and by that numbering Steps 1–8 are now ✔. Going forward all references use blueprint numbers.

## 3. Last Commit

Will be the commit made immediately after this snapshot — bundles the PRD v3.2 update, blueprint v2.2 update, and this handoff rewrite.

Prior tip on `main` is `7239685` (hook removal + rich handoff restoration). The data layer cursor is `30d7f5e`.

## 4. Active Thread

- **Just finished:**
  - Removed the `UserPromptSubmit` auto-handoff hook (`7239685`) — the `^/clear\b` matcher was firing on unrelated prompts and overwriting rich handoff narratives. Handoffs are now manual-only.
  - Audited PRD + blueprint + current components for mobile readiness (3 parallel Explore agents). Result: **mobile entirely undocumented** and **current UI mobile-hostile** (fixed `w-60` sidebar, fixed paddings, no `<ResponsiveContainer>`, no explicit viewport).
  - User confirmed all 4 mobile-scope decisions:
    1. Breakpoint `md` = 768px (iPad portrait and up = desktop layout).
    2. Hybrid date picker — native `<input type="date">` on `<md`, shadcn `Popover + Calendar` on `md+`.
    3. Step 9.5 placement — between cron (Step 9) and dashboard UI (Step 10), so all subsequent UI is authored mobile-first.
    4. Phase 1 mobile scope cap — only reactive layout + native-gesture non-interference. **Offline excluded**, **PWA deferred to Phase 2**, **custom gestures / haptics excluded** (user explicitly picked "iOS native gesture preservation" only from the gesture menu).
  - Edited PRD to v3.2: §5 타겟 사용자 (added "주 사용 디바이스" column + mobile-primary note), new §11.7 모바일 지원 범위 (full scope spec + Phase-boundary declarations), §13.3 frontend stack addendum, §16.1 두 줄 수용 기준 추가, §18 Phase 2 got PWA bullet.
  - Edited blueprint to v2.2: version history entry; §1 folder additions (`mobile-nav.tsx`, `sheet.tsx`); §6.1 date picker got device-branched rendering subsection; new §6.2 Responsive Layout with breakpoint table + touch-target rule + viewport meta snippet + native-gesture-preservation policy + Step 9.5 testing checklist; §9 Build Sequence marked Steps 6–8 as ✔, inserted new **Step 9.5 Mobile shell retrofit** with explicit substep list, updated Step 10 + 10.5 to reference mobile-first grid and hybrid picker; §10 got two new acceptance rows; §11 got trade-off #14.
- **About to start:** Step 9 (cron route handler). No blockers.
- **Not blocked** on build/tests (last run: `npm run build` green, `npm run lint` green, Vitest 56/56 green).

## 5. Pending User Decisions

None open. All 4 mobile decisions confirmed and folded into docs.

## 6. Recent Context (last 5 commits, pre-this-snapshot)

- `7239685` Remove auto-handoff-on-clear hook + rewrite handoff to rich state.
- `e41edbe` docs: auto-handoff mechanical snapshot on /clear — spurious, superseded by `7239685`.
- `30d7f5e` Step 8 (blueprint §9) post-review fixes — model_version filter + server-only guard + comment fix.
- `6aab776` Step 8: data layer (snapshot writers + cached readers + cache-tag registry).
- `9cd51d3` docs: update handoff snapshot.

## 7. Open Issues to Watch

- **`score_changelog` unique index** — missing today; `writeScoreChangelog` uses plain `.insert()`. TODO in `src/lib/data/snapshot.ts` file-level doc: add migration `0004_score_changelog_unique.sql` adding `CREATE UNIQUE INDEX score_changelog_dedup ON public.score_changelog (asset_type, change_date, model_version)` **during Step 9**, then switch the writer to an upsert on that constraint. Prevents duplicate delta rows on cron retry. The blueprint §9 Step 9 description also captures this.
- **`scoreToBand` out-of-range policy** — unchanged, tolerated as floating-point dust.
- **Vercel CLI not installed** — `npm i -g vercel` before Step 12 deploy.
- **Secrets hygiene** — `.env.local` holds live Supabase service_role JWT, FRED key, Alpha Vantage key, CRON_SECRET. Git-ignored; present on disk.
- **Mobile support** — **RESOLVED** in PRD v3.2 + blueprint v2.2. Actual code retrofit happens at Step 9.5.
- **Blueprint §7 open question #3** — **RESOLVED** at commit `6aab776`. Admin client inside `'use cache'` scopes.
- **Auto-handoff overwrite risk** — **RESOLVED** at commit `7239685` by removing the hook.

## 8. Environment State

- Stack: **Next.js 16.2.4**, React 19.2.4, Tailwind v4, `@supabase/ssr` 0.10.2, TypeScript 5, `next-themes` 0.4, Recharts 3.8, Vitest 4.1, IBM Plex Sans.
- Cache model: **Path B** (`cacheComponents: true`). Runtime APIs under `<Suspense>` or inside `'use cache'` only. Data-layer readers use the admin client inside `'use cache'` to sidestep the cookies-serializability constraint.
- File rename: `middleware.ts` → `proxy.ts` (Next 16). Never create `middleware.ts`.
- `server-only` guard live in `src/lib/supabase/admin.ts` — any `"use client"` import chain reaching it is a build-time error.
- **Blueprint version**: v2.2 (2026-04-20). **PRD version**: v3.2 (2026-04-20).
- **Mobile scope (new)**: Phase 1 supports iOS Safari / Android Chrome; `md` (768px) breakpoint; Sheet drawer on `<md`; hybrid date picker; ≥44px touch targets; native gesture non-interference. PWA / offline / custom gestures / haptics out of scope (PWA is Phase 2+, others permanently deferred unless reopened).
- Supabase project: `hhohrclmfsvpkigbdpsb` (ap-northeast-2 Seoul, free tier).
- Family users: `jw.byun=beb7b8af...` / `edc0422=6dd6fbf2...` / `odete4=dbe5c5db...`. Personas: expert / intermediate / beginner. **여자친구 and 어머니 primarily use mobile.**
- `asset_type_enum`: `us_equity | kr_equity | crypto | global_etf | common`.
- MCP servers (project-scope `.mcp.json`): `figma`, `supabase`, `context7`, `alphavantage`.
- `.env.local` keys: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `CRON_SECRET`.
- GitHub repo: `Jaclyn6/Finance-Manager-James` (private). `gh` CLI auth'd as `Jaclyn6`.
- Dev server: `npm run dev` via `preview_start`. Port 3000.
- Handoff: **manual only**. `/handoff` slash command at `.claude/commands/handoff.md`. No hooks.
- Code-review workflow: per CLAUDE.md Trigger 1 / 2, run 5-agent review on every Step completion and every pre-push feature-unit.

## 9. How to Resume

1. Read `docs/phase1_architecture_blueprint.md` v2.2 §9 Build Sequence. Current position: **Step 8 complete** (`30d7f5e`). Steps 1–8 all marked ✔.
2. Begin **Step 9 (cron route handler)**:
   - **Migration first**: create `supabase/migrations/0004_score_changelog_unique.sql` with `CREATE UNIQUE INDEX score_changelog_dedup ON public.score_changelog (asset_type, change_date, model_version);`. Apply via `mcp__supabase__apply_migration`.
   - **Regenerate types**: `mcp__supabase__generate_typescript_types` → overwrite `src/types/database.ts`.
   - **Switch `writeScoreChangelog` to upsert** on the new constraint; update the file-level TODO comment in `src/lib/data/snapshot.ts`.
   - **Create FRED fetcher**: `src/lib/score-engine/indicators/fred.ts` — one function per indicator key, returns `{ value, observed_at, released_at, fetch_status }`. Only imported by the cron handler (safety invariant §8).
   - **Create cron route**: `src/app/api/cron/ingest-macro/route.ts`:
     - `Authorization: Bearer ${CRON_SECRET}` check — 401 on mismatch.
     - Fetch all 7 FRED series in parallel (`Promise.allSettled`).
     - For each successful series: build 5-year window, `computeZScore`, `zScoreTo0100`, collect into `IndicatorScore[]`.
     - For each `AssetType`: `computeComposite(...)` → `writeCompositeSnapshot(...)` via `src/lib/data/snapshot.ts`.
     - Build changelog deltas vs prior snapshot (read prior via `getCompositeSnapshotsForDate(yesterday)` — or a dedicated admin-client read since the cron runs before any cache invalidation).
     - `writeScoreChangelog(...)` per asset class where a delta exists.
     - `writeIngestRun(...)` with counts.
     - Call `invalidateMacroSnapshotCache()` + `invalidateChangelogCache()` at the end.
   - **Add `vercel.json`** with daily cron schedule: `{ "crons": [{ "path": "/api/cron/ingest-macro", "schedule": "0 6 * * *" }] }`.
   - **Local smoke**: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/ingest-macro` and verify rows via `mcp__supabase__execute_sql`.
3. Run `/code-review:code-review` (5-agent spawn) on the Step 9 commit. Fix ≥80 findings. Push.
4. Then **Step 9.5 Mobile shell retrofit** per the blueprint v2.2 substep list (`npx shadcn@latest add sheet`, `mobile-nav.tsx`, viewport meta, responsive paddings, hidden-on-mobile sidebar). Verify at DevTools 360 / 375 / 768 / 1280 + real iPhone Safari.

---

*Handoffs are manual-only. This file is rewritten on every `/handoff` invocation.*
