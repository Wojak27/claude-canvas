# Changelog

## 0.8.0
- System monitor (`claudeCanvas.systemMonitor`, or the command Claude Canvas: Toggle System
  Monitor): a strip above Tasks with CPU and GPU use (with sparklines), memory, disk, and, where the
  site provides the tools, storage quotas by size and file count plus the compute allocation (NSC:
  `nscquota`, `projinfo`). Lock warnings are shown verbatim. Updates in place every 3 s while a
  board is visible; quotas every 5 minutes. Meters go amber from 70 % and red from 90 %, and the
  value is always printed beside them.

## 0.7.2
- An icon: an eye whose pupil is a spark. The panel is about seeing what the assistant made, so
  the mark says the same thing. Generated with Qwen-Image-2.1, background cut to alpha.
- The activity-bar glyph is redrawn to match: monochrome SVG, still legible at 16 px.
- The extension now carries a marketplace icon (`extension/media/icon.png`).


## 0.7.1
- Remove tasks from the panel: a × on each row (on hover) removes that task, and a × on a
  session heading removes the session and its tasks after a confirmation. Both check that the line
  still says what the panel showed, so an edit Claude made in the meantime never deletes the wrong row.

## 0.7.0
- MCP server in the plugin (`plugin/mcp/server.py`, declared in `plugin/.mcp.json`): `canvas_show`,
  `canvas_note`, `canvas_state`, `canvas_widget`, `canvas_tasks`, `canvas_task`, `canvas_live_add`,
  `canvas_live_status`, `canvas_live_rm`, `canvas_title`, `canvas_open`. JSON arguments,
  structured reads, validation failures as tool errors. Writes go through `bin/canvas`.
- The SessionStart hook records the session against the Claude Code process in
  `.claude/canvas/.pids/`, which is how the MCP server finds its conversation and follows `/clear`.
  The panel ignores top-level bookkeeping files, so they never count as Shared-board activity.
- The skill prefers the MCP tools and keeps the CLI for scripts and jobs.
- CI: `.github/workflows/test.yml` runs `tests/run.sh` (36 checks) on every push and PR.
- CHANGELOG is newest first.

## 0.6.0
- One board per conversation: `sessions/<id>/` under the canvas folder, picked by
  `CLAUDE_CANVAS_SESSION`, which the SessionStart hook sets through `CLAUDE_ENV_FILE`. The top level
  is the Shared board. A picker follows the latest activity or pins a conversation. Boards are
  named after the first prompt (UserPromptSubmit hook) or `canvas title`.
- Editor tabs: ⧉ opens a conversation in a tab and ⤢ opens a single card in one. Each tab keeps
  its own conversation and is restored after a window reload.
- Widgets: `line`, `bar`, `scatter`, `heatmap`, `stat` and `table` from a JSON spec, inline or
  backed by a CSV/JSON/JSONL file that re-renders when it changes. They have hover readouts,
  legend toggles and a table view, and use a colorblind-validated palette in both themes.
  `canvas widget` validates specs. The format is in `plugin/skills/claude-canvas/WIDGETS.md`.
- Live blocks write `live/<name>.status.json` after every run. `canvas live ls` shows ok/FAILED
  with stderr, and the panel shows the last recorded run until its own first one.
- A half-typed task survives any board re-render. Webview state is merged, no longer
  overwritten by the scroll handler.
- The canvas folder writes its own `.gitignore` and records the workspace root in `.workspace`, so
  the CLI runs live blocks from the same place the extension does. The CLI no longer treats
  `~/.claude` as a project.
- No placeholder `state.md`: it made the Shared board look like the latest activity.

## 0.5.0
- Live blocks: `live/<name>.sh` is re-run on the interval in its `# every:` header while the board
  is visible, and its stdout is rendered as a pinned block. Updates are swapped in place, so a
  refresh never clears a half-typed task. Runs have a 30 s timeout that kills the whole process
  group, never overlap, and a failure keeps the last good output. Trusted workspaces only;
  `claudeCanvas.liveBlocks` turns them off.
- `canvas live add|run|ls|rm`.

## 0.4.1
- Caption sidecars (`<image>.caption.md`) no longer render as a card of their own on top of the
  image card they belong to.
- README: screenshots and an animation, all generated from the real renderer by `scripts/`.

## 0.4.0
- `canvas open`: a `.open` sentinel file brings the panel up, so anything that can write a file
  can reveal the board — including over Remote-SSH.
- Claude Code plugin: a skill, `canvas` on Claude's PATH, a SessionStart hook that opens the board,
  and a PostToolUse hook that puts any image Claude reads on the feed.

## 0.3.1
- Package every `.js` file, and fail the build if a local `require()` target is missing.
  `tasks.js` had been left out of 0.3.0, so the extension threw on load and the view never resolved.

## 0.3.0
- Tasks: a collapsible block at the top of the board, backed by `tasks.md`.
  Click a row to tick it, add rows inline, `@mentions` and `#tags` as chips, open count as a badge.
- A lone `#` heading is treated as the document title, so sessions are always written one level below it.

## 0.1.0
- Board in the activity bar: pinned `state.md` plus a feed of image and markdown cards.
- Zero-dependency markdown renderer, `progress` fenced blocks, theme-aware styling.
- `canvas` CLI for pushing content from a shell.
