#!/usr/bin/env bash
# SessionStart: make sure the canvas folder exists, and bring the board up.
# Set CLAUDE_CANVAS_AUTO_OPEN=0 to keep the panel where it is.
set -u
root="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/canvas"
mkdir -p "$root/feed" 2>/dev/null || exit 0
[ -f "$root/tasks.md" ] || printf '# Tasks\n' > "$root/tasks.md"
[ "${CLAUDE_CANVAS_AUTO_OPEN:-1}" = "0" ] || : > "$root/.open"
exit 0
