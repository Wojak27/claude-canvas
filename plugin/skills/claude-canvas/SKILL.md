---
name: claude-canvas
description: Show the user images, interactive charts and tables (widgets), progress and tasks in the VS Code side panel instead of printing file paths or rendering throwaway PNGs. Use whenever the user says "show me" something visual or asks to plot, chart or compare numbers, when a long-running job needs a visible status, when there is a plan worth tracking across a session, or when the user asks what you are working on. Also use when they mention the canvas, the board, the panel, or widgets.
---

# Claude Canvas

A VS Code side panel the user can see while you work. You write files, the panel re-renders.
The `canvas` command is on your PATH.

**Every conversation has its own board.** `canvas` writes to this conversation's board
automatically (the plugin sets `CLAUDE_CANVAS_SESSION`); you never touch another conversation's
cards, state or tasks. Name the board once the work has a shape: `canvas title "Depth head v5"`.
Write to the project-wide Shared board only when asked: `CLAUDE_CANVAS_SESSION=shared canvas …`.
The user can follow the latest conversation, pin one, or open any board or card in an editor tab.

## Show an image

When the user asks to see something — a plot, a render, a screenshot, a frame, a diff image —
put it on the board instead of telling them where it is:

```bash
canvas show out/depth.png "Depth map, frame 412"
```

It is symlinked, so large files cost nothing (`--copy` to copy instead). Never answer a "show me"
with a bare file path when this is available.

## Plot data with a widget, not a PNG

When the thing to show is **numbers** — a training curve, a comparison across arms, a results
table — describe it as a widget instead of rendering an image. The board draws it interactive
(hover readouts, legend toggles, a sortable table view), in the user's theme, and re-draws it
when its data file changes:

~~~bash
canvas widget <<'JSON'
{"type": "line", "title": "Validation mAP by arm", "src": "results/train_log.csv",
 "x": "epoch", "y": "val_mAP", "series": "arm", "yPercent": true}
JSON
~~~

Types: `line` (trends), `bar` (compare categories), `scatter` (≤ 3 groups), `heatmap` (a grid),
`stat` (headline numbers with deltas), `table`. Point `src` at the CSV/JSON/JSONL the job writes
rather than inlining a copy, so the widget stays current. `canvas widget` validates the spec and
fails loudly on a missing column or file — read its error and fix the spec. A widget also works
inside any markdown the board shows as a fenced ```` ```widget ```` block, including a live
block's output. The full format, per-type options, and which type fits which data are in
[WIDGETS.md](WIDGETS.md) next to this skill — read it before your first widget of a session.

Pick the form by the data's job: one number is a `stat`, not a one-bar chart; one run that
matters among several is `line` with `"emphasis": "<series>"`; two measures of different scale
are two widgets, never one chart. Keep rendering images for things that are pictures — renders,
frames, attention maps, qualitative grids — and for publication figures the user asked for.

## Keep the state block current

`state.md` is pinned above the feed. Use it for what is running right now, so the user can glance
at the panel instead of asking you:

~~~bash
canvas state <<'MD'
# Training the load head

```progress
Render: 100 | 3 000 frames
Train: 68 | epoch 34/50, 41 min left
```
MD
~~~

Update it when a phase starts and when it finishes. A stale state block is worse than none.

## Live blocks: status that refreshes itself

When the status you would put in `state.md` comes from a command — a job queue, a log tail, a
metrics file, GPU use — register the command instead of pasting its output once. The extension
re-runs it on a timer while the board is visible, so it never goes stale:

~~~bash
canvas live add jobs --every 60s --title "Running jobs" <<'SH'
squeue -u "$USER" -o '%.10i %.30j %.8T %.10M %.10l' | sed 's/^/    /'
SH
~~~

The script's stdout is markdown (indent or fence raw text; `progress` blocks work). It runs from
the workspace root with a 30 s timeout. `add` runs it once and prints the result: check that
output, since that is exactly what the user sees. Pick an interval that matches how fast the
thing changes (a training queue: 1–5 min, not 5 s). `canvas live ls`, `canvas live run <name>`,
`canvas live rm <name>` when the job is over. Read `.claude/canvas/live/<name>.md` to see what the
block currently shows.

## Tasks

The top block is `tasks.md`: one `##` section per session, newest first. Both of you edit it —
the user ticks rows in the panel, so **re-read before you write**, do not assume your last state.

```bash
canvas task session "2026-09-23 — depth head v5"   # once, at the start of a piece of work
canvas task add "Re-render with mixed assets"      # lands in the newest session
canvas task list                                   # numbered, read this before editing
canvas task done 2 3
```

Open a session when the user gives you a multi-step piece of work, add the steps you plan to take,
and tick them as they land. Tag rows with `@name` when it matters who owns one.

## Other

```bash
canvas note "Epoch 34" <<'MD'   # a markdown card: tables, task lists, progress blocks
canvas open                      # bring the panel up
canvas clear                     # drop every card
```

Markdown supports headings, lists, task lists, tables, quotes, code, images, and a `progress`
fenced block where each line is `label: <percent> | optional note`.

## Your own board, read back

- `canvas path` prints this conversation's board folder.
- `canvas live ls` shows each live block's last run: `ok`, or `FAILED exit N -- <stderr>`. Check
  it after registering a block, and when the user says the board looks wrong.
- `live/<name>.status.json` holds the last run's exit code and stderr, whoever ran it.

## When not to use it

Ordinary code answers, explanations and diffs belong in the conversation. The board is for things
that are visual, long-running, or worth keeping in front of the user across a session.
