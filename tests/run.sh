#!/usr/bin/env bash
# Smoke tests: hooks, the canvas CLI and the extension (against tests/mock) in a throwaway
# workspace. Needs bash, python3 and node (NODE=/path/to/node to pick one).
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"; repo="$(dirname "$here")"
NODE="${NODE:-node}"
P="$repo/plugin"; C="$P/bin/canvas"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/ws/.claude" "$T/ws/results"; cd "$T/ws"
export CLAUDE_PROJECT_DIR="$T/ws"; unset CLAUDE_CODE_SESSION_ID CLAUDE_CANVAS_SESSION CLAUDE_CANVAS_DIR
fail=0
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; fail=1; fi; }

for sid in aaa111 bbb222; do
  : > "$T/env_$sid"
  echo "{\"session_id\":\"$sid\",\"source\":\"startup\"}" | CLAUDE_ENV_FILE="$T/env_$sid" "$P/scripts/session-start.sh"
done
check "SessionStart exports the conversation" "grep -q 'CLAUDE_CANVAS_SESSION=aaa111' '$T/env_aaa111'"
check "canvas folder ignores itself" "grep -qx '\*' .claude/canvas/.gitignore"

echo '{"session_id":"aaa111","prompt":"/clear"}' | "$P/scripts/on-prompt.sh"
echo '{"session_id":"aaa111","prompt":"Plot the training loss"}' | "$P/scripts/on-prompt.sh"
echo '{"session_id":"aaa111","prompt":"something else"}' | "$P/scripts/on-prompt.sh"
check "first real prompt names the board" "grep -q '\"Plot the training loss\"' .claude/canvas/sessions/aaa111/meta.json"

source "$T/env_aaa111"
"$C" note "hello A" <<< "from A" >/dev/null
CLAUDE_CANVAS_SESSION=bbb222 "$C" note "hello B" <<< "from B" >/dev/null
CLAUDE_CANVAS_SESSION=shared "$C" note "hello shared" <<< "shared" >/dev/null
check "writes stay in their conversation" "ls .claude/canvas/sessions/aaa111/feed | grep -q hello-a && ! ls .claude/canvas/sessions/aaa111/feed | grep -q hello-b && ls .claude/canvas/feed | grep -q hello-shared"
"$C" title "Depth head v5" >/dev/null
check "canvas title renames" "grep -q 'Depth head v5' .claude/canvas/sessions/aaa111/meta.json"

printf 'echo "cwd=$(basename $PWD)"\n' | "$C" live add okblk --every 30s --title "OK block" >/dev/null
printf 'echo out; echo "boom" >&2; exit 4\n' | "$C" live add bad >/dev/null 2>&1
check "failing live block records exit + stderr" "grep -q '\"exit\": 4' .claude/canvas/sessions/aaa111/live/bad.status.json && grep -q boom .claude/canvas/sessions/aaa111/live/bad.status.json"
check "live ls reports the failure" "'$C' live ls | grep -q 'FAILED exit 4'"

cp "$repo/extension/media/canvas.svg" "$T/x.png"
echo "{\"session_id\":\"bbb222\",\"tool_input\":{\"file_path\":\"$T/x.png\"}}" | "$P/scripts/on-read.sh"
check "an image Claude reads lands on its conversation's board" "ls .claude/canvas/sessions/bbb222/feed | grep -q 'x.png'"

printf 'epoch,arm,val_mAP\n1,a,0.1\n2,a,0.2\n1,b,0.15\n2,b,0.3\n' > results/train_log.csv
echo '{"type":"line","title":"mAP","src":"results/train_log.csv","x":"epoch","y":"val_mAP","series":"arm"}' | "$C" widget >/dev/null
check "valid widget is written" "ls .claude/canvas/sessions/aaa111/feed | grep -q 'map.widget.json'"
check "unknown widget type is refused" "! echo '{\"type\":\"pie\"}' | '$C' widget 2>/dev/null"
check "missing src is refused" "! echo '{\"type\":\"line\",\"src\":\"nope.csv\",\"x\":\"a\",\"y\":\"b\"}' | '$C' widget 2>/dev/null"

echo "--- mcp server"
WS="$T/ws" python3 "$here/mcp.test.py" || fail=1

echo "--- extension"
WS="$T/ws" timeout 60 "$NODE" "$here/extension.test.js" || fail=1
exit $fail
