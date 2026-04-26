@AGENTS.md

# Claude Code workflow rules (project)

These are persistent behavior rules for Claude on this project. They apply to every session.

## Session continuity — always start here

At the beginning of every session (including `/clear` resumes), if `docs/handoff.md` exists, read it before answering anything beyond a pure greeting. It captures where the previous session left off: current phase/step, last commit, active thread, pending user decisions, open issues, and environment state. Treat it as authoritative for "what were we doing" context.

When the user signals that context is running thin (phrases like "handoff", "context 정리", "clear 하기 전에 정리"), or when you sense the conversation is about to exceed a comfortable remaining budget, run the `/handoff` slash command (defined at `.claude/commands/handoff.md`). It snapshots the current state into `docs/handoff.md`, commits it, and pushes — so a fresh session can resume from the same point with zero briefing.

Handoffs are **manual-only**. There is no `UserPromptSubmit` / `/clear` hook. An earlier experiment (`.claude/hooks/auto-handoff-on-clear.sh`, wired via matcher `^/clear\b`) was removed because the matcher fired on prompts that were not `/clear` and overwrote rich handoff narratives with a mechanical fallback. The contract is now: the user runs `/handoff` explicitly when they want a snapshot, and that is the only way `docs/handoff.md` gets written.

Do not rely on memory files under `~/.claude/projects/...` for session continuity — those are durable high-level project facts, not live session state. `docs/handoff.md` is the live state; it is git-tracked and survives worktree switches and clones.

## Backlog — single source of truth

The project's backlog lives at `docs/backlog.md`. It is the durable, git-tracked list of deferred items, follow-ups, tech debt, and post-phase ideas. Treat it as the authoritative answer to "what's next" or "what did we leave for later."

**Always write to `docs/backlog.md` (never to `docs/handoff.md` and never scattered across blueprint docs)** when:
- The user says some variant of "백로그에 넣어줘", "나중에 하자", "이건 다음에", "보류", "defer this", "add to the backlog", or otherwise marks a discussion item as not-now.
- A code review or implementation surfaces a follow-up that is out-of-scope for the current commit.
- A phase closes with known carry-overs that the next phase will pick up.

`docs/handoff.md` is live session state — it is rewritten on every `/handoff` and may not survive a session reset. Backlog items written there get lost. Backlog items written into a phase blueprint get buried. `docs/backlog.md` is the only place the user can grep across sessions to see "what did we say we'd do later."

**Always read `docs/backlog.md`** when:
- The user asks "다음에 뭐 할까", "후속 액션 뭐가 있어", "what's next", "what should we work on", or any variant of "what's pending."
- A phase or sub-phase closes (e.g. just shipped Phase X) and the next-action recommendation needs to consider deferred work.
- The user invokes `/handoff` — pull anything still open from `docs/backlog.md` into the handoff §7 "Open Issues to Watch" as pointer references (not duplicated content).

When updating the backlog, follow the existing structure (`## UI / UX polish`, `## Phase 2 carry-overs`, `## Tech-debt nibbles`, etc.). Each entry includes WHERE it lives now (file path), THE GAP, A PROPOSED TREATMENT, and WHY IT'S DEFERRED. Don't write one-liners — future-you needs to act on the entry without this conversation's context.

## Code review workflow

Run the `/code-review:code-review` skill — five parallel Sonnet reviewers covering (1) AGENTS.md + blueprint compliance, (2) shallow bug scan, (3) blueprint drift / historical context, (4) code-comments-vs-reality, (5) security — then score findings 0-100 with Haiku agents, filter out anything below 80 confidence, dedupe overlaps, and report.

Invoke it at the two trigger points below. Do not skip.

### Trigger 1 — greenfield step completion

When implementing Phase 1 / 2 / 3 against a blueprint under `docs/phase*_architecture_blueprint.md`, after finishing each numbered Step:

1. Start the dev server via `preview_start` (config lives at `.claude/launch.json`)
2. Walk the user through a visual verification of the step's output (what URL to open, what to expect, what credentials to try)
3. Wait for the user's confirmation of the visual check
4. Spawn the 5-agent code review on the step's commit(s)
5. Fix every finding that survived the confidence ≥ 80 filter
6. Commit the fixes, push, then advance to the next Step

### Trigger 2 — feature addition or improvement (post-MVP)

Before pushing any feature-unit to `main`:

1. Spawn the 5-agent code review on the full feature diff (all commits that comprise the feature — do not review only the tip commit)
2. Fix every finding that survived the confidence ≥ 80 filter
3. Commit the fixes on top of the feature
4. Only then push

Do not batch multiple features into one review. A follow-up fix to a previously-reviewed feature is its own feature-unit for review purposes.

### Not triggered

These do not require the review workflow:

- Doc-only commits (markdown under `docs/`, this file, `README.md`)
- Config-only commits that do not change runtime behavior (e.g. `.mcp.json` MCP server list, `.claude/settings.*`)
- Pure dependency bumps with no code changes

When in doubt, run the review. The cost of running it is small compared to the cost of a missed bug.

### Why this is a CLAUDE.md rule and not a hook

The trigger points are natural development milestones ("step done", "feature done") that only Claude recognizes — not mechanical events like "file written" that a Git hook or `PostToolUse` hook could detect. A per-edit hook would either under-trigger (on edits that aren't step completions) or over-trigger (reviewing every keystroke), both waste. This rule lives here so the judgement stays with Claude.
