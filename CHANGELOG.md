# Changelog

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

## 0.4.0
- `canvas open`: a `.open` sentinel file brings the panel up, so anything that can write a file
  can reveal the board — including over Remote-SSH.
- Claude Code plugin: a skill, `canvas` on Claude's PATH, a SessionStart hook that opens the board,
  and a PostToolUse hook that puts any image Claude reads on the feed.

## 0.4.1
- Caption sidecars (`<image>.caption.md`) no longer render as a card of their own on top of the
  image card they belong to.
- README: screenshots and an animation, all generated from the real renderer by `scripts/`.

## 0.5.0
- Live blocks: `live/<name>.sh` is re-run on the interval in its `# every:` header while the board
  is visible, and its stdout is rendered as a pinned block. Updates are swapped in place, so a
  refresh never clears a half-typed task. Runs have a 30 s timeout that kills the whole process
  group, never overlap, and a failure keeps the last good output. Trusted workspaces only;
  `claudeCanvas.liveBlocks` turns them off.
- `canvas live add|run|ls|rm`.

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
