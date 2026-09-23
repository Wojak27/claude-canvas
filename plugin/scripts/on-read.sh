#!/usr/bin/env bash
# PostToolUse(Read): when Claude reads an image, put it on the board so you see
# it too. Set CLAUDE_CANVAS_AUTO_SHOW=0 to turn this off.
set -u
[ "${CLAUDE_CANVAS_AUTO_SHOW:-1}" = "0" ] && exit 0
command -v python3 >/dev/null 2>&1 || exit 0

path="$(python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(0)
p = (d.get("tool_input") or {}).get("file_path") or ""
print(p)
' 2>/dev/null)" || exit 0

case "${path##*.}" in
  png|PNG|jpg|JPG|jpeg|JPEG|gif|GIF|webp|WEBP|bmp|BMP|avif|AVIF) ;;
  *) exit 0 ;;
esac
[ -f "$path" ] || exit 0

root="${CLAUDE_PROJECT_DIR:-$PWD}/.claude/canvas"
[ -d "$root" ] || exit 0
CLAUDE_CANVAS_DIR="$root" "$(dirname "$0")/../bin/canvas" show "$path" "Read by Claude" >/dev/null 2>&1
exit 0
