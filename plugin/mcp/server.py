#!/usr/bin/env python3
"""Claude Canvas MCP server: typed tools over the same board the `canvas` CLI writes.

Stdio JSON-RPC, standard library only. Every write goes through bin/canvas, so the file format
has one implementation; reads (tasks, live status) parse the board files and return structure.

Which conversation's board: the SessionStart hook records `sessions/<id>` against the Claude Code
process id in .claude/canvas/.pids/<pid>; this server finds it by walking up its own parents, on
every call, so a /clear (new session id, same process) is picked up at once. Falls back to
CLAUDE_CANVAS_SESSION / CLAUDE_CODE_SESSION_ID, then the Shared board.
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CANVAS = os.path.join(os.path.dirname(HERE), "bin", "canvas")
PROTOCOL = "2025-06-18"


def project_dir():
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def canvas_top():
    return os.environ.get("CLAUDE_CANVAS_DIR") or os.path.join(project_dir(), ".claude", "canvas")


def parent_pids(limit=8):
    pids, pid = [], os.getppid()
    while pid > 1 and len(pids) < limit:
        pids.append(pid)
        try:
            with open("/proc/%d/stat" % pid) as f:
                pid = int(f.read().rsplit(")", 1)[1].split()[1])
        except (OSError, ValueError, IndexError):
            break
    return pids


def session_id():
    pid_dir = os.path.join(canvas_top(), ".pids")
    for pid in parent_pids():
        try:
            with open(os.path.join(pid_dir, str(pid))) as f:
                sid = f.read().strip()
            if sid:
                return sid
        except OSError:
            continue
    return os.environ.get("CLAUDE_CANVAS_SESSION") or os.environ.get("CLAUDE_CODE_SESSION_ID") or "shared"


def board_dir():
    sid = re.sub(r"[^A-Za-z0-9_-]", "", session_id()) or "shared"
    return canvas_top() if sid == "shared" else os.path.join(canvas_top(), "sessions", sid)


def run_canvas(args, stdin=None):
    env = dict(os.environ, CLAUDE_CANVAS_DIR=canvas_top(), CLAUDE_CANVAS_SESSION=session_id())
    p = subprocess.run([CANVAS] + args, input=stdin, capture_output=True, text=True, env=env,
                       cwd=project_dir(), timeout=60)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


class ToolError(Exception):
    pass


def ok_or_raise(code, out, err):
    if code != 0:
        raise ToolError(err or out or "canvas exited %d" % code)
    return out


# ---- reads ----------------------------------------------------------------------------------

TASK = re.compile(r"^(\s*)([-*])\s+\[([ xX])\]\s+(.*)$")
HEAD = re.compile(r"^(#{1,6})\s+(.*)$")


def read_tasks():
    path = os.path.join(board_dir(), "tasks.md")
    try:
        lines = open(path).read().split("\n")
    except OSError:
        return []
    sections, cur, n = [], None, 0
    for line in lines:
        h = HEAD.match(line)
        if h and len(h.group(1)) >= 2:
            cur = {"session": h.group(2), "tasks": []}
            sections.append(cur)
            continue
        t = TASK.match(line)
        if t:
            n += 1
            if cur is None:
                cur = {"session": "", "tasks": []}
                sections.append(cur)
            cur["tasks"].append({"n": n, "done": t.group(3).lower() == "x", "text": t.group(4)})
    return sections


def live_status():
    live = os.path.join(board_dir(), "live")
    out = []
    try:
        names = sorted(f[:-3] for f in os.listdir(live) if f.endswith(".sh"))
    except OSError:
        return out
    for name in names:
        head = open(os.path.join(live, name + ".sh")).read().split("\n")[:15]
        get = lambda k: next((m.group(1) for l in head for m in [re.match(r"^#\s*%s\s*:\s*(.+?)\s*$" % k, l)] if m), None)
        item = {"name": name, "title": get("title") or name, "every": get("every") or "60s", "last_run": None}
        try:
            st = json.load(open(os.path.join(live, name + ".status.json")))
            item["last_run"] = {"ok": st["exit"] == 0, "exit": st["exit"], "at": st["at"],
                                "stderr": st.get("stderr", "")[-2000:]}
        except (OSError, ValueError, KeyError):
            pass
        try:
            item["output"] = open(os.path.join(live, name + ".md")).read()[-4000:]
        except OSError:
            pass
        out.append(item)
    return out


# ---- tools ----------------------------------------------------------------------------------

def t_show(a):
    args = ["show"] + (["--copy"] if a.get("copy") else []) + [a["path"]] + ([a["caption"]] if a.get("caption") else [])
    return "Shown: " + ok_or_raise(*run_canvas(args))


def t_note(a):
    return "Card: " + ok_or_raise(*run_canvas(["note"] + ([a["title"]] if a.get("title") else []), a["markdown"]))


def t_state(a):
    ok_or_raise(*run_canvas(["state"], a["markdown"]))
    return "State block replaced."


def t_widget(a):
    spec = a["spec"]
    if isinstance(spec, str):
        try:
            spec = json.loads(spec)
        except ValueError as e:
            raise ToolError("spec is not valid JSON: %s" % e)
    out = ok_or_raise(*run_canvas(["widget"] + ([a["title"]] if a.get("title") else []), json.dumps(spec)))
    return "Widget card: " + out


def t_tasks(a):
    return json.dumps(read_tasks(), indent=1)


def t_task(a):
    action = a["action"]
    if action in ("add", "session"):
        if not a.get("text"):
            raise ToolError('"%s" needs "text"' % action)
        ok_or_raise(*run_canvas(["task", action, a["text"]]))
    elif action in ("done", "undo", "rm"):
        nums = [str(int(n)) for n in a.get("numbers") or []]
        if not nums:
            raise ToolError('"%s" needs "numbers" (from canvas_tasks)' % action)
        ok_or_raise(*run_canvas(["task", action] + nums))
    elif action == "cleardone":
        ok_or_raise(*run_canvas(["task", "cleardone"]))
    else:
        raise ToolError("unknown action %r" % action)
    return json.dumps(read_tasks(), indent=1)


def t_live_add(a):
    args = ["live", "add", a["name"]]
    if a.get("every"):
        args += ["--every", str(a["every"])]
    if a.get("title"):
        args += ["--title", a["title"]]
    code, out, err = run_canvas(args, a["script"])
    if code != 0:
        raise ToolError("registered, but the first run failed; the board keeps showing the last good output.\n" + err)
    return "Registered. First run printed (this is what the board shows):\n" + out


def t_live_status(a):
    return json.dumps(live_status(), indent=1)


def t_live_rm(a):
    ok_or_raise(*run_canvas(["live", "rm", a["name"]]))
    return "Removed live block %s." % a["name"]


def t_title(a):
    return "Board titled: " + ok_or_raise(*run_canvas(["title", a["title"]]))


def t_open(a):
    ok_or_raise(*run_canvas(["open"]))
    return "Asked the panel to show this conversation's board (%s)." % board_dir()


S = lambda **props: {"type": "object", "properties": props}
STR = {"type": "string"}

TOOLS = [
    ("canvas_show", t_show, "Put an image (plot, render, screenshot) on this conversation's board instead of printing its path.",
     dict(S(path=dict(STR, description="Image file"), caption=STR,
            copy={"type": "boolean", "description": "Copy instead of symlink (for files that will be overwritten)"}),
          required=["path"])),
    ("canvas_note", t_note, "Add a markdown card (tables, task lists, ```progress and ```widget blocks work).",
     dict(S(markdown=STR, title=STR), required=["markdown"])),
    ("canvas_state", t_state, "Replace the pinned state block: what is running right now. Update it when a phase starts and ends.",
     dict(S(markdown=STR), required=["markdown"])),
    ("canvas_widget", t_widget,
     "Add an interactive chart/table card for numbers, instead of rendering a PNG. Spec: {type: line|bar|scatter|heatmap|stat|table, "
     "title, data (rows) or src (CSV/JSON/JSONL path, re-renders on change), x, y (column or list), series (long format)} "
     "plus per-type options; see WIDGETS.md beside the claude-canvas skill. Validated: errors name the problem.",
     dict(S(spec={"type": "object", "description": "The widget spec"}, title=STR), required=["spec"])),
    ("canvas_tasks", t_tasks, "Read this conversation's task list, numbered. The user ticks rows too: read before editing.",
     S()),
    ("canvas_task", t_task, "Edit the task list: add (to the newest session), session (start one), done/undo/rm by number, cleardone. Returns the new list.",
     dict(S(action={"type": "string", "enum": ["add", "session", "done", "undo", "rm", "cleardone"]}, text=STR,
            numbers={"type": "array", "items": {"type": "integer"}}), required=["action"])),
    ("canvas_live_add", t_live_add,
     "Register a live block: a bash script whose stdout (markdown) the panel re-runs and shows on an interval, e.g. a job queue. "
     "Runs it once now and returns the output, or the error.",
     dict(S(name=STR, script=dict(STR, description="Bash; runs from the workspace root, 30 s timeout"),
            every=dict(STR, description="e.g. 60s, 5m (min 5s; default 60s)"), title=STR), required=["name", "script"])),
    ("canvas_live_status", t_live_status, "Each live block's interval, last run (ok, exit code, stderr) and current output.", S()),
    ("canvas_live_rm", t_live_rm, "Remove a live block when what it watches is over.", dict(S(name=STR), required=["name"])),
    ("canvas_title", t_title, "Name this conversation's board (shown in the panel's picker).", dict(S(title=STR), required=["title"])),
    ("canvas_open", t_open, "Bring the panel up on this conversation's board.", S()),
]
BY_NAME = {t[0]: t for t in TOOLS}


# ---- JSON-RPC over stdio ----------------------------------------------------------------------

def reply(id_, result=None, error=None):
    msg = {"jsonrpc": "2.0", "id": id_}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def handle(msg):
    method, id_, params = msg.get("method"), msg.get("id"), msg.get("params") or {}
    if id_ is None:
        return  # notification (initialized, cancelled): nothing to answer
    if method == "initialize":
        reply(id_, {"protocolVersion": params.get("protocolVersion") or PROTOCOL,
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "claude-canvas", "version": "0.7.0"}})
    elif method == "ping":
        reply(id_, {})
    elif method == "tools/list":
        reply(id_, {"tools": [{"name": n, "description": d, "inputSchema": s} for n, _, d, s in TOOLS]})
    elif method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        tool = BY_NAME.get(name)
        if not tool:
            reply(id_, error={"code": -32602, "message": "unknown tool %s" % name})
            return
        try:
            text, is_err = tool[1](args), False
        except ToolError as e:
            text, is_err = str(e), True
        except KeyError as e:
            text, is_err = "missing argument %s" % e, True
        except Exception as e:  # never let one bad call take the server down
            text, is_err = "%s: %s" % (type(e).__name__, e), True
        reply(id_, {"content": [{"type": "text", "text": text}], "isError": is_err})
    else:
        reply(id_, error={"code": -32601, "message": "method not found: %s" % method})


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            reply(None, error={"code": -32700, "message": "parse error"})
            continue
        handle(msg)


if __name__ == "__main__":
    main()
