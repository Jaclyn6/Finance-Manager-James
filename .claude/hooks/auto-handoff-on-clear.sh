#!/usr/bin/env bash
#
# Triggered by a UserPromptSubmit hook when the user types /clear.
#
# Two-mode behavior:
#   1. If docs/handoff.md was updated within the last 10 minutes, the user
#      most likely just ran the /handoff slash command (which writes a rich,
#      Claude-authored snapshot). Do nothing — preserve that richer version.
#   2. Otherwise, write a MECHANICAL fallback snapshot (git state only) so
#      at least the last-commit cursor and recent history survive the /clear.
#
# This hook cannot invoke Claude or reason about the conversation. It is an
# insurance net against "I forgot to /handoff before /clear", not a
# replacement for /handoff.

set -eu

HANDOFF_FILE="docs/handoff.md"
FRESH_WINDOW_SEC=600   # 10 minutes
NOW_EPOCH=$(date +%s)

# -----------------------------------------------------------------------------
# Skip if the user already handed off recently.
# -----------------------------------------------------------------------------
if [ -f "$HANDOFF_FILE" ]; then
  # GNU stat (Linux/Git Bash on Windows) uses -c; BSD stat (macOS) uses -f.
  FILE_MTIME=$(stat -c %Y "$HANDOFF_FILE" 2>/dev/null \
    || stat -f %m "$HANDOFF_FILE" 2>/dev/null \
    || echo 0)
  AGE=$((NOW_EPOCH - FILE_MTIME))
  if [ "$AGE" -lt "$FRESH_WINDOW_SEC" ]; then
    echo "📝 docs/handoff.md is fresh (${AGE}s old) — skipping auto-handoff; user already ran /handoff."
    exit 0
  fi
fi

# -----------------------------------------------------------------------------
# Collect a mechanical snapshot. Keep this resilient — don't fail the hook
# (and thus block /clear) just because a git command returned nonzero.
# -----------------------------------------------------------------------------
LAST_COMMIT=$(git log -1 --format='%h %s' 2>/dev/null || echo 'unknown')
BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'unknown')
UNCOMMITTED=$(git status --short 2>/dev/null || echo '')
RECENT=$(git log --oneline -5 2>/dev/null || echo 'unknown')
NOW_ISO=$(date '+%Y-%m-%d %H:%M')

UNCOMMITTED_BLOCK="(clean)"
if [ -n "$UNCOMMITTED" ]; then
  UNCOMMITTED_BLOCK=$(printf '%s' "$UNCOMMITTED")
fi

# -----------------------------------------------------------------------------
# Write the mechanical handoff. OVERWRITES the previous file — but only in
# the non-fresh branch above, so rich handoffs are preserved.
# -----------------------------------------------------------------------------
cat > "$HANDOFF_FILE" <<EOF
# Session Handoff (auto-generated on /clear)

> ⚠ This is a **mechanical fallback** written by \`.claude/hooks/auto-handoff-on-clear.sh\`.
> The user ran \`/clear\` without first running \`/handoff\`, so no Claude-authored
> narrative is available. Sections below are git-derived only.

## 1. Snapshot Timestamp

${NOW_ISO} (auto, mechanical)

## 2. Current Phase / Step

Unknown — no manual narrative captured. Inspect the last commit(s) below and
\`docs/phase1_architecture_blueprint.md\` §9 Build Sequence to reconstruct.

## 3. Last Commit

\`${LAST_COMMIT}\` on \`${BRANCH}\`.

### Uncommitted changes at /clear time

\`\`\`
${UNCOMMITTED_BLOCK}
\`\`\`

## 4. Active Thread

Unknown — no synthesis possible from a bash hook.

## 5. Pending User Decisions

Unknown.

## 6. Recent Context (last 5 commits)

\`\`\`
${RECENT}
\`\`\`

## 7. Open Issues to Watch

Unknown — grep the codebase for TODO / FIXME / blueprint "open questions"
if you need to rebuild this list.

## 8. Environment State

See \`docs/phase1_architecture_blueprint.md\` §1 + §8 for stack + secrets.
See \`.mcp.json\` for active MCP servers.

## 9. How to Resume

1. Read \`docs/phase1_architecture_blueprint.md\` v2.1 §9 Build Sequence.
2. Run \`git log --oneline -15\` and skim commit messages for the latest work.
3. If possible, ask the user what they were doing before \`/clear\` — this
   mechanical snapshot is a safety net, not a substitute for their context.
EOF

# -----------------------------------------------------------------------------
# Commit + push. Never fail the hook on git errors — /clear proceeding
# matters more than a perfect snapshot, and the file is still on disk.
# -----------------------------------------------------------------------------
git add "$HANDOFF_FILE" 2>/dev/null || true
if git diff --cached --quiet 2>/dev/null; then
  echo "ℹ️  docs/handoff.md unchanged — nothing to commit."
else
  if git commit -m "docs: auto-handoff mechanical snapshot on /clear" 2>/dev/null; then
    if git push origin HEAD 2>&1 | tail -3; then
      echo "✅ mechanical handoff committed and pushed."
    else
      echo "⚠ push failed — mechanical snapshot is local only (commit still recorded)."
    fi
  else
    echo "⚠ commit failed — snapshot written to disk but not versioned."
  fi
fi

exit 0
