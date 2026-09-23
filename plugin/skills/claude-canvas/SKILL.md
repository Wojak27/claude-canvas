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
