# Claude Canvas — VS Code extension

The panel itself. See the [repo README](../README.md) for the Claude Code plugin and the full picture.

A VS Code side panel that Claude Code can write to. Top to bottom:

- **Tasks** — a collapsible block at the very top, backed by `.claude/canvas/tasks.md`. One `##`
  section per session, newest first. Click a row to tick it off; the markdown file is rewritten in
  place, so Claude and you are editing the same list. `@mentions` and `#tags` render as chips.
- **State** — `.claude/canvas/state.md`. What is running, what is done, what is next.
- **Feed** — cards in `.claude/canvas/feed/`, newest first. Images render inline; `.md` renders as markdown.

No IPC, no server: the extension watches the folder and re-renders. Anything that can write a
file can put something on the board.

## Use it from the shell

    .claude/canvas/canvas show out/depth.png "Depth map, frame 412"
    .claude/canvas/canvas note "Training run" <<'MD'
    ```progress
    train: 62 | epoch 31/50
    eval:  100
    ```
    MD
    .claude/canvas/canvas state < /tmp/state.md
    .claude/canvas/canvas clear

    .claude/canvas/canvas task session "2026-09-22 — depth head v5"
    .claude/canvas/canvas task add "Re-render with mixed assets @claude"
    .claude/canvas/canvas task list          # numbered
    .claude/canvas/canvas task done 2 3
    .claude/canvas/canvas task cleardone

`show` symlinks the image by default (`--copy` to copy it), so big renders cost nothing.

## Markdown supported

Headings, paragraphs, lists, task lists (`- [x]`), tables, quotes, rules, links, inline and fenced
code, images (relative paths resolve against the card's own folder), plus a `progress` fenced block:

    ```progress
    label: 62 | optional note on the right
    ```

## Install (from source)

    ./build.sh                                   # writes claude-canvas-<version>.vsix
    code --install-extension claude-canvas-*.vsix
    # then: Developer: Reload Window

## Settings

| Setting | Default | Meaning |
|---|---|---|
| `claudeCanvas.folder` | `.claude/canvas` | Canvas folder, relative to the workspace root |
| `claudeCanvas.newestFirst` | `true` | Newest card at the top |
| `claudeCanvas.maxCards` | `60` | Cards rendered |
| `claudeCanvas.autoReveal` | `always` | Reveal the board when a new card appears |

Commands: **Show Board**, **Open Board in Editor Tab**, **Open tasks.md**, **Start Task Session**,
**Clear Feed**, **Reveal Canvas Folder** — all under `Claude Canvas:`.

## tasks.md shape

    # Tasks                        <- document title, left alone

    ## 2026-09-22 — depth head v5 <- newest session on top
    - [x] Re-render with mixed assets @claude
    - [ ] Eval against the real photos @karol

Sessions are `##` blocks; `canvas task add` always lands in the topmost one. Nested tasks indent by
two spaces. The activity-bar icon carries a badge with the open count.

## Notes

The webview's `localResourceRoots` includes `/`, so a card can show an image from anywhere on this
machine (renders under `data/`, `/tmp`, …) rather than only from inside the workspace.
