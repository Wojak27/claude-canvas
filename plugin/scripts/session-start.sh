#!/usr/bin/env bash
# SessionStart: give this conversation its own board, point every later `canvas` call at it, and
# bring the panel up. CLAUDE_CANVAS_AUTO_OPEN=0 keeps the panel where it is.
set -u
command -v python3 >/dev/null 2>&1 || exit 0
top="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/canvas"
input="$(cat)"
sid="$(printf '%s' "$input" | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("session_id") or "")
except Exception: pass' 2>/dev/null | tr -cd 'A-Za-z0-9_-')"

mkdir -p "$top/feed" 2>/dev/null || exit 0
[ -f "$top/tasks.md" ] || printf '# Tasks\n' > "$top/tasks.md"
[ -f "$top/.gitignore" ] || printf '# Claude Canvas board state: local, per machine\n*\n' > "$top/.gitignore"

if [ -n "$sid" ]; then
  board="$top/sessions/$sid"
  mkdir -p "$board/feed"
  [ -f "$board/tasks.md" ] || printf '# Tasks\n' > "$board/tasks.md"
  [ -f "$board/meta.json" ] || CANVAS_META="$board/meta.json" CANVAS_ID="$sid" python3 -c '
import json, os, datetime
json.dump({"id": os.environ["CANVAS_ID"], "title": "", "started": datetime.datetime.now().isoformat(timespec="seconds")},
          open(os.environ["CANVAS_META"], "w"), indent=2)'
  # every Bash call in this session now writes to this conversation's board
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    { printf 'export CLAUDE_CANVAS_DIR=%q\n' "$top"; printf 'export CLAUDE_CANVAS_SESSION=%q\n' "$sid"; } >> "$CLAUDE_ENV_FILE"
  fi
fi
[ "${CLAUDE_CANVAS_AUTO_OPEN:-1}" = "0" ] || printf '%s\n' "${sid:-shared}" > "$top/.open"
exit 0
