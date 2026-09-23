# Contributing

Small codebase, no build step, no dependencies. `extension/extension.js` is the webview and the
host; `markdown.js` is the renderer; `tasks.js` is the `tasks.md` reader/writer.

## Working on the panel

```bash
cd extension
./build.sh                                   # packs the .vsix by hand, no vsce needed
code --install-extension claude-canvas-*.vsix --force
```

Then **Developer: Reload Window**. `build.sh` checks that every local `require()` target actually
made it into the package — that check exists because a missing file once shipped and the view just
spun forever.

## Working on the plugin

`plugin/` is a standard Claude Code plugin: `skills/claude-canvas/SKILL.md` tells Claude when to
use the board, `hooks/hooks.json` wires the automatic parts, `bin/canvas` goes on Claude's PATH.
Hook scripts take the event JSON on stdin and must exit 0 whatever happens — a hook that fails
should never break someone's session.

Test one without a session:

```bash
echo '{"tool_input":{"file_path":"/tmp/x.png"}}' | CLAUDE_PROJECT_DIR=/tmp/proj plugin/scripts/on-read.sh
```

## Screenshots

Every image in the README is rendered by the real extension code, so they cannot drift from what
the panel draws:

```bash
./scripts/screenshots.sh     # needs node, python3 + Pillow, google-chrome, ffmpeg
```

`scripts/demo_scenes.py` builds five cumulative canvas folders (a job starting, running,
finishing); `render-html.js` runs the actual `buildHtml()` with a stubbed VS Code API and injects
theme tokens; `crop.py` snaps crops to the seams between cards.

## Style

Match what's there: plain ES2020, no transpiler, no framework, comments only where the reason
isn't obvious from the code.
