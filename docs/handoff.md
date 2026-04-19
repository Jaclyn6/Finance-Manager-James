# Session Handoff

## 1. Snapshot Timestamp

2026-04-19 (post handoff-system wiring; pre-Step 7)

## 2. Current Phase / Step

**Phase 1, about to start Step 7 (Data Layer).** Step 6 (Score Engine Core) finished and reviewed. Handoff system (slash command + auto-`/clear` hook) just wired in and tested.

Blueprint v2.1 §9 Build Sequence — Steps 1-6 ✔, Step 7 next.

## 3. Last Commit

`b1062db` — `Add auto-handoff-on-clear hook + restore rich handoff` on `main`. Working tree clean after this snapshot lands.

The real "Step 6 done" cursor remains at `9646a09`. Everything since is handoff-system infrastructure.

## 4. Active Thread

- **Just finished:**
  - Step 6 score engine (weights / normalize / composite / score-band) — 47/47 Vitest tests green.
  - Handoff infrastructure: `/handoff` slash command (`.claude/commands/handoff.md`), CLAUDE.md session-start rule, `docs/handoff.md` live file.
  - Auto-handoff-on-`/clear` hook (`.claude/hooks/auto-handoff-on-clear.sh`) registered via `UserPromptSubmit` in `.claude/settings.json`. Dry-run verified: fresh-mode skips (preserves rich), stale-mode writes mechanical + commits + pushes.
- **About to start:** Step 7 data layer — `src/lib/data/{snapshot,indicators,changelog}.ts`.
- **Not blocked.**

## 5. Pending User Decisions

None open.

## 6. Recent Context (last 5 commits)

- `b1062db` Add auto-handoff-on-clear hook + restore rich handoff
- `f3e98dc` auto-handoff mechanical snapshot on /clear — hook dry-run artifact (superseded)
- `5cb2443` Add session handoff system (/handoff command + CLAUDE.md session-start rule)
- `9646a09` Step 6 post-review fixes — Infinity/NaN weight + NaN-score guards; tightened assertion; `score-band.ts` docstring fix
- `741b90e` Step 6 score engine core + Vitest setup — 7 FRED indicators, `MODEL_VERSION="v1.0.0"`, 44 initial tests, framework-agnostic

## 7. Open Issues to Watch

- **Blueprint §7 open question #3** — `'use cache'` + `cookies()` + Supabase client serializability. Has to be resolved in Step 7. Leaning pattern (a): uncached Server Component wrapper reads cookies, passes serializable args into a separate `'use cache'` pure transformer.
- **`scoreToBand` out-of-range policy** — 120 → 강한 비중 확대 (floating-point-dust tolerance). Revisit if upstream ever produces genuinely out-of-range scores.
- **Vercel CLI not installed** — `npm i -g vercel` before Step 12 deploy.
- **Secrets hygiene** — `.env.local` contains live Supabase service_role JWT, FRED key, Alpha Vantage key, CRON_SECRET. Git-ignored but present on disk.
- **Hook overwrite behavior** — if `/clear` fires in stale-mode, `docs/handoff.md` gets overwritten with a mechanical version. Running `/handoff` immediately after `/clear` rebuilds the rich version.

## 8. Environment State

- Stack: **Next.js 16.2.4**, React 19.2.4, Tailwind v4, `@supabase/ssr` 0.10.2, TypeScript 5, `next-themes` 0.4, Recharts 3.8, Vitest 4.1, IBM Plex Sans.
- Cache model: **Path B** (`cacheComponents: true`).
- File rename: `middleware.ts` → `proxy.ts` (Next 16). Never create `middleware.ts`.
- Supabase project: `hhohrclmfsvpkigbdpsb` (ap-northeast-2 Seoul, free tier).
- Family users (UUIDs in `auth.users`): `jw.byun=beb7b8af...` / `edc0422=6dd6fbf2...` / `odete4=dbe5c5db...`. `user_metadata.persona` set at creation.
- `asset_type_enum`: `us_equity | kr_equity | crypto | global_etf | common`. `btc` renamed to `crypto` (migration `0003`).
- MCP servers (project-scope `.mcp.json`): `figma`, `supabase`, `context7`, `alphavantage`. Some may require session-level re-auth.
- `.env.local` keys (names only): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `FRED_API_KEY`, `ALPHA_VANTAGE_API_KEY`, `CRON_SECRET`.
- GitHub repo: `Jaclyn6/Finance-Manager-James` (private). `gh` CLI auth'd as `Jaclyn6`.
- Dev server: `npm run dev` via `preview_start` (`.claude/launch.json`). Port 3000.
- Handoff system: `/handoff` → rich; `.claude/hooks/auto-handoff-on-clear.sh` → mechanical fallback when `docs/handoff.md` ≥10 min stale.

## 9. How to Resume

1. Read `docs/phase1_architecture_blueprint.md` v2.1 §9 Build Sequence — you are at Step 7.
2. Read `docs/phase1_blueprint_next16_delta.md` §7 Caching Strategy before writing any data-layer code — flags the `'use cache'` + `cookies()` serializability open issue.
3. Start Step 7 by creating `src/lib/data/snapshot.ts` (writer using `getSupabaseAdminClient`), then `src/lib/data/indicators.ts` with both `getLatestCompositeSnapshots()` and `getCompositeSnapshotsForDate(date)` per blueprint §7. Use pattern (a) — thin uncached Server Component wrapper → serializable args → `'use cache'` transformer — when the serializability issue surfaces.

---

> ℹ If this snapshot shows the "auto-generated on /clear" banner at the top, it's a mechanical fallback from the bash hook. Ask the user what they were doing, then rebuild context from `git log --oneline -15`.
