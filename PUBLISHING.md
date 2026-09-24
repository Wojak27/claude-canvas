# Publishing

Three channels. The Claude Code plugin and the VS Code extension ship separately: the plugin
teaches Claude to use the board, and the extension draws it.

## Before any release

```bash
./tests/run.sh                                   # 36 checks; CI runs the same on every push
claude plugin validate ./plugin --strict
claude plugin validate . --strict                # the marketplace manifest
```

Bump the version in `extension/package.json`, `plugin/.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json`, and add a `CHANGELOG.md` entry at the top.

## 1. Claude Code community marketplace (`claude-community`)

Third-party plugins are listed in the reviewed community marketplace. Anthropic chooses what goes
into `claude-plugins-official` itself; there is no application for that one.

- Individual authors submit at <https://platform.claude.com/plugins/submit>. On Team/Enterprise
  claude.ai, admins use Admin settings → Directory → Submissions.
- The review runs `claude plugin validate` and an automated safety screen.
- An approved plugin is pinned to a commit SHA in `anthropics/claude-plugins-community`, and CI
  bumps the pin as you push.

What to say about the plugin: it adds three hooks (SessionStart, UserPromptSubmit, PostToolUse on
Read) and a stdio MCP server, and writes only under `<project>/.claude/canvas/`. It makes no
network calls.

## 2. VS Code Marketplace

One-time setup:
1. Create a publisher at <https://marketplace.visualstudio.com/manage>. Its ID becomes the first
   half of the extension ID (`<publisher>.claude-canvas`).
2. Create an Azure DevOps personal access token with the **Marketplace → Manage** scope.
3. Set `"publisher"` in `extension/package.json` to that ID. It is `local` for now. Changing it
   gives the extension a new ID, so uninstall the local build once the published one is in.
4. Add a 128×128 (or 256×256) PNG as `extension/media/icon.png` and set `"icon": "media/icon.png"`
   in `extension/package.json`. The official packager fails if the icon is declared but missing.

Each release:
```bash
cd extension
npx @vscode/vsce package --no-dependencies       # the official packager; checks the manifest
npx @vscode/vsce publish --no-dependencies -p "$VSCE_PAT"
```
Or upload the `.vsix` by hand on the publisher page. `./build.sh` makes a `.vsix` without npm
for local installs. Use the official packager for the stores.

## 3. Open VSX (VSCodium, Cursor, Windsurf, code-server)

One-time setup:
1. Log in at <https://open-vsx.org> with GitHub, sign the Eclipse publisher agreement, and create
   an access token.
2. Create the namespace (the same ID as the VS Code publisher):
   `npx ovsx create-namespace <publisher> -p "$OVSX_PAT"`.

Each release, using the same `.vsix` as above:
```bash
npx ovsx publish claude-canvas-<version>.vsix -p "$OVSX_PAT"
```

## GitHub release

Tag `v<version>`, attach the `.vsix`, and paste the CHANGELOG entry. The README links to the
latest release for people who install by hand.
