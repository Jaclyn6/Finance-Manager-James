# Session Handoff

## 1. Snapshot Timestamp

2026-04-19 (end of Step 6)

## 2. Current Phase / Step

**Phase 1, about to start Step 7 (Data Layer).** Step 6 (Score Engine Core) finished and reviewed.

Blueprint v2.1 §9 Build Sequence — Steps 1-6 ✔, Step 7 next.

## 3. Last Commit

`9646a09` — `Step 6 post-review fixes` on `main`. Clean working tree except for the handoff infrastructure (`.claude/commands/handoff.md`, `CLAUDE.md` session-continuity block, this `docs/handoff.md`) which lands in the commit that introduces this handoff system.

## 4. Active Thread

- **Just finished:** Step 6 score engine (weights / normalize / composite / score-band) + Vitest setup + 5-agent code review + 4 review fixes. Tests 47/47 green, `next build` clean.
- **About to start:** Step 7 data layer — `src/lib/data/{snapshot,indicators,changelog}.ts`. Patterns per blueprint §7 (Path B `'use cache'` + `cacheTag` + `cacheLife`).
- **Not blocked.**

## 5. Pending User Decisions

None open. Previous session confirmed Step 7 go-ahead implicitly by approving this handoff setup.

## 6. Recent Context (last 5 commits)

- `9646a09` Step 6 post-review fixes — Infinity/NaN weight + NaN-score guards in `computeComposite`; tightened assertion; fixed `score-band.ts` docstring
- `741b90e` Step 6 score engine core + Vitest setup — 7 FRED indicators, `MODEL_VERSION="v1.0.0"`, 44 initial tests, framework-agnostic
- `b167473` Blueprint v2.1 build-sequence fix for date-navigation insertion
- `e34d999` PRD v3.1 + Blueprint v2.1 — date-navigation feature planned (Phase 1 Level 1, Phase 2 price overlay deferred)
- `795e8e4` Step 5 post-review fixes (SignOut error handling, prototype-key slug, etc.)

## 7. Open Issues to Watch

- **Blueprint §7 open question #3** — `'use cache'` + `cookies()` + Supabase client serializability. Has to be resolved in Step 7. Two patterns on the table: (a) uncached Server Component wrapper fetches cookies, passes serializable args into a separate `'use cache'` pure transformer, or (b) use the admin (service_role) client in cached scope since it doesn't need cookies. Phase 1 reads go through (authenticated) server client, so leaning (a).
- **`scoreToBand` out-of-range policy** — current code lets 120 → 강한 비중 확대 (floating-point-dust tolerance). If upstream ever produces genuinely out-of-range scores, revisit.
- **Vercel CLI not installed** on this machine — `npm i -g vercel` before Step 12 deploy.
- **Secrets hygiene** — `.env.local` contains live Supabase service_role JWT, FRED key, Alpha Vantage key, CRON_SECRET, and SUPABASE_URL. Git-ignored but present on disk. Rotate before sharing the machine or the project dir.

## 8. Environment State

- Stack: **Next.js 16.2.4**, React 19.2.4, Tailwind v4, `@supabase/ssr` 0.10.2, TypeScript 5, `next-themes` 0.4, Recharts 3.8, Vitest 4.1, IBM Plex Sans.
- Cache model: **Path B** (`cacheComponents: true`) — all runtime APIs must be under `<Suspense>` or inside `'use cache'` scopes.
- File rename: `middleware.ts` is `proxy.ts` (Next 16 rename). Never create `middleware.ts`.
- Supabase project: `hhohrclmfsvpkigbdpsb` (ap-northeast-2 Seoul, free tier).
- Family users (UUIDs in `auth.users`): `jw.byun=beb7b8af...` / `edc0422=6dd6fbf2...` / `odete4=dbe5c5db...`. `user_metadata.persona` set at creation.
- `asset_type_enum` values: `us_equity | kr_equity | crypto | global_etf | common`. `btc` was renamed to `crypto` in migration `0003`.
- MCP servers (project-scope `.mcp.json`): `figma` (currently disconnected this session, re-auth only if needed), `supabase` (re-auth if token expires), `context7` (stdio), `alphavantage` (stdio, env-var substitution).
- `.env.local` keys (names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `CRON_SECRET`.
- GitHub repo: `Jaclyn6/Finance-Manager-James` (private). `gh` CLI auth'd as `Jaclyn6`.
- Dev server: `npm run dev` via `preview_start` (`.claude/launch.json`). Port 3000.

## 9. How to Resume

1. Read `docs/phase1_architecture_blueprint.md` v2.1 §9 (Build Sequence) — you are at Step 7.
2. Read `docs/phase1_blueprint_next16_delta.md` §7 (Caching Strategy) before writing any data-layer code — it flags the `'use cache'` + `cookies()` open issue you must resolve during Step 7.
3. Start Step 7 by creating `src/lib/data/snapshot.ts` (writer using `getSupabaseAdminClient`), then `src/lib/data/indicators.ts` with both `getLatestCompositeSnapshots()` and `getCompositeSnapshotsForDate(date)` per blueprint §7; fall back to pattern (a) — thin uncached wrapper → serializable args → `'use cache'` transformer — when the serializability issue surfaces.
