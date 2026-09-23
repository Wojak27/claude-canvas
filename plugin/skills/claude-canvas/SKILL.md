---
name: claude-canvas
description: Show the user images, progress and tasks in the VS Code side panel instead of printing file paths. Use whenever the user says "show me" something visual, when a long-running job needs a visible status, when there is a plan worth tracking across a session, or when the user asks what you are working on. Also use when they mention the canvas, the board, or the panel.
---

# Claude Canvas

A VS Code side panel the user can see while you work. You write files, the panel re-renders.
The `canvas` command is on your PATH.

## Show an image

When the user asks to see something — a plot, a render, a screenshot, a frame, a diff image —
put it on the board instead of telling them where it is:

```bash
canvas show out/depth.png "Depth map, frame 412"
```

It is symlinked, so large files cost nothing (`--copy` to copy instead). Never answer a "show me"
with a bare file path when this is available.

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

## When not to use it

Ordinary code answers, explanations and diffs belong in the conversation. The board is for things
that are visual, long-running, or worth keeping in front of the user across a session.
