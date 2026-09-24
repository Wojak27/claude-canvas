#!/usr/bin/env bash
# UserPromptSubmit: name an untitled board after the conversation's first prompt, so the panel's
# picker reads "Fix the flaky eval test" rather than a session id. `canvas title` renames it.
set -u
command -v python3 >/dev/null 2>&1 || exit 0
top="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/canvas"
[ -d "$top/sessions" ] || exit 0
CANVAS_TOP="$top" python3 -c '
import json, os, re, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
sid = re.sub(r"[^A-Za-z0-9_-]", "", d.get("session_id") or "")
meta = os.path.join(os.environ["CANVAS_TOP"], "sessions", sid, "meta.json")
if not sid or not os.path.exists(meta):
    sys.exit(0)
m = json.load(open(meta))
if m.get("title"):
    sys.exit(0)
words = " ".join((d.get("prompt") or "").split())
if not words or words.startswith("/"):
    sys.exit(0)
m["title"] = words if len(words) <= 60 else words[:57].rsplit(" ", 1)[0] + "…"
json.dump(m, open(meta, "w"), indent=2)
' 2>/dev/null
exit 0
