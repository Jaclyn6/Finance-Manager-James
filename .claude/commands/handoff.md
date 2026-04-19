---
description: Snapshot the current session state into docs/handoff.md so the next session (or a /clear) can resume without losing context.
---

Overwrite `docs/handoff.md` (it is a live snapshot, not an append-only log) with the following seven sections. Keep each tight — the whole file should fit on one screen so the next session can absorb it fast.

## Before writing, collect these inputs

1. `git log -1 --format="%H %s"` — last commit SHA + title
2. `git log origin/main..HEAD --oneline` — any unpushed commits
3. `git log --oneline -15` on main — recent commit history
4. `git status --short` — any uncommitted changes (flag these; don't hide them)
5. TodoWrite state — what's in-progress / pending
6. `docs/phase1_architecture_blueprint.md` §9 Build Sequence — which step we're on
7. `CLAUDE.md` — is there an active workflow trigger (code review queued, visual verify pending)?

## File sections

Write each heading as an `##`. Do not add other sections. Do not wax poetic — bullets and one-line facts.

### 1. Snapshot Timestamp

One line: `YYYY-MM-DD HH:MM` (use the current date from context; do not invent future dates).

### 2. Current Phase / Step

Which PRD phase and which blueprint Build Sequence step the work is on. If mid-step, say mid-step and what sub-task.

### 3. Last Commit

SHA (short) + title + branch. If uncommitted changes exist, list the changed files and whether they are important or noise.

### 4. Active Thread

What just finished, what is about to start, what is blocked. 2-4 bullets.

### 5. Pending User Decisions

Questions currently waiting on the user. One bullet per item. Empty list is fine — say "None".

### 6. Recent Context (last 5 commits)

One line per commit. Include the SHA (short) + a terse "why it mattered" summary.

### 7. Open Issues to Watch

Tech-debt items, deferred problems, follow-ups flagged by reviewers, or gotchas for upcoming work. Cite file paths.

### 8. Environment State

Stack versions, active MCP server list, secrets in `.env.local` (names only — never values), any auth tokens expiring soon, any known-broken integrations.

### 9. How to Resume

A three-bullet "if you are a fresh session, do this" checklist that starts with "Read `docs/phase1_architecture_blueprint.md` v2.1 §9 to understand build sequence" and ends with a specific concrete next action.

## After writing

- `git add docs/handoff.md`
- `git commit -m "docs: update handoff snapshot"`
- `git push`

Commit always. The handoff must be durable — that is the entire point.
