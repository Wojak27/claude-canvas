#!/usr/bin/env python3
"""MCP server round trip: handshake, tool list, every tool, error reporting, and that the board
follows the session recorded against this (parent) process, including a /clear. Run by run.sh."""
import json, os, subprocess, sys

ws, repo = os.environ["WS"], os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
top = os.path.join(ws, ".claude", "canvas")
os.makedirs(os.path.join(top, ".pids"), exist_ok=True)
pidfile = os.path.join(top, ".pids", str(os.getpid()))   # the server's parent is this process
open(pidfile, "w").write("mcp111\n")

env = {k: v for k, v in os.environ.items() if not k.startswith("CLAUDE_CANVAS") and k != "CLAUDE_CODE_SESSION_ID"}
env["CLAUDE_PROJECT_DIR"] = ws
srv = subprocess.Popen([sys.executable, os.path.join(repo, "plugin", "mcp", "server.py")], cwd=ws, env=env,
                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
failed, n = 0, 0

def rpc(method, params=None):
    global n
    n += 1
    srv.stdin.write(json.dumps({"jsonrpc": "2.0", "id": n, "method": method, "params": params or {}}) + "\n")
    srv.stdin.flush()
    return json.loads(srv.stdout.readline())

def call(tool_, **args):
    r = rpc("tools/call", {"name": tool_, "arguments": args})["result"]
    return r["content"][0]["text"], r["isError"]

def ok(cond, msg):
    global failed
    failed += not cond
    print(("PASS " if cond else "FAIL ") + msg)

init = rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "t"}})
ok(init["result"]["serverInfo"]["name"] == "claude-canvas", "initialize")
srv.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); srv.stdin.flush()
names = [t["name"] for t in rpc("tools/list")["result"]["tools"]]
ok(len(names) == 11 and "canvas_widget" in names, "tools/list: %d tools" % len(names))

board = os.path.join(top, "sessions", "mcp111")
text, err = call("canvas_note", markdown="hello from MCP", title="mcp note")
ok(not err and "/sessions/mcp111/feed/" in text, "canvas_note lands on the recorded session's board")
call("canvas_task", action="session", text="MCP session")
call("canvas_task", action="add", text="first")
text, err = call("canvas_task", action="add", text="second")
tasks = json.loads(text)
ok(not err and [t["text"] for t in tasks[0]["tasks"]] == ["first", "second"], "canvas_task add returns the list")
tasks = json.loads(call("canvas_task", action="done", numbers=[1])[0])
ok(tasks[0]["tasks"][0]["done"] and not tasks[0]["tasks"][1]["done"], "canvas_task done by number")
text, err = call("canvas_task", action="done")
ok(err and "numbers" in text, "canvas_task without numbers is a tool error, not a crash")

text, err = call("canvas_widget", spec={"type": "stat", "items": [{"label": "mAP", "value": 51.2}]})
ok(not err and text.endswith(".widget.json"), "canvas_widget writes a card")
text, err = call("canvas_widget", spec={"type": "line", "data": [], "x": "epoch"})
ok(err and '"y"' in text, "canvas_widget reports what is wrong: " + text.splitlines()[0][:70])

text, err = call("canvas_live_add", name="clock", script="echo tick", every="30s", title="Clock")
ok(not err and "tick" in text, "canvas_live_add returns the first output")
text, err = call("canvas_live_add", name="broken", script="echo nope >&2; exit 3")
ok(err and "nope" in text, "canvas_live_add surfaces the failing first run")
status = {s["name"]: s for s in json.loads(call("canvas_live_status")[0])}
ok(status["clock"]["last_run"]["ok"] and status["broken"]["last_run"]["exit"] == 3, "canvas_live_status: ok + exit 3")
call("canvas_live_rm", name="broken")
ok(not os.path.exists(os.path.join(board, "live", "broken.sh")), "canvas_live_rm")
ok(call("canvas_title", title="MCP board")[0].endswith("MCP board"), "canvas_title")
ok(not call("canvas_state", markdown="# Running")[1] and open(os.path.join(board, "state.md")).read().startswith("# Running"), "canvas_state")

# /clear: same process, new session id; the next call must follow it
open(pidfile, "w").write("mcp222\n")
text, _ = call("canvas_note", markdown="after clear")
ok("/sessions/mcp222/" in text, "after /clear the server writes to the new session")
ok(rpc("tools/call", {"name": "nope"}).get("error", {}).get("code") == -32602, "unknown tool is a JSON-RPC error")

srv.stdin.close(); srv.wait(timeout=10)
sys.exit(1 if failed else 0)
