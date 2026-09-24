#!/usr/bin/env node
// Render the Claude Canvas webview HTML for a demo canvas folder, so screenshots
// come from the real renderer rather than a mockup.
//
//   node render-html.js <workspaceDir> <out.html> [dark|light] [widthCss]
//
// The webview normally inherits its colours from VS Code; here we inject the
// Dark Modern / Light Modern token values so a headless browser matches.
const path = require('path'), fs = require('fs');
const EXT = path.join(__dirname, '..', 'extension');
const [workspace, out, mode = 'dark', width = '485'] = process.argv.slice(2);
if (!workspace || !out) {
  console.error('usage: render-html.js <workspaceDir> <out.html> [dark|light] [widthCss]');
  process.exit(1);
}

const stub = {
  Uri: { file: p => ({ fsPath: p, toString: () => 'file://' + p }), joinPath: (u, ...r) => ({ fsPath: path.join(u.fsPath, ...r) }) },
  ViewColumn: { Beside: 2, Active: 1 },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: workspace } }], isTrusted: true,
    getConfiguration: () => ({ get: (k, d) => d }),
    createFileSystemWatcher: () => ({ onDidChange() {}, onDidCreate() {}, onDidDelete() {} }),
    onDidChangeConfiguration: () => ({}),
  },
  window: { registerWebviewViewProvider: () => ({}), createWebviewPanel: () => ({}), showWarningMessage: async () => {}, showTextDocument: async () => {}, showInputBox: async () => {} },
  commands: { registerCommand: () => ({}), executeCommand: async () => {} },
  RelativePattern: function () {},
};
const src = fs.readFileSync(path.join(EXT, 'extension.js'), 'utf8');
const req = r => (r === 'vscode' ? stub : require(r.startsWith('./') ? path.join(EXT, r) : r));
const buildHtml = new Function('require', 'module', 'exports', '__dirname', src + '\n;return buildHtml;')(req, { exports: {} }, {}, EXT);

const TOKENS = {
  dark: `--vscode-foreground:#cccccc;--vscode-sideBar-background:#181818;--vscode-editor-background:#1f1f1f;
--vscode-panel-border:#2b2b2b;--vscode-editorWidget-background:#202020;--vscode-textLink-foreground:#4daafc;
--vscode-textCodeBlock-background:#2a2a2a;--vscode-progressBar-background:#0078d4;--vscode-testing-iconPassed:#3fb950;
--vscode-list-hoverBackground:#2a2d2e;--vscode-toolbar-hoverBackground:#2a2d2e;--vscode-button-secondaryBackground:#313131;
--vscode-button-secondaryForeground:#cccccc;--vscode-input-background:#313131;--vscode-input-foreground:#cccccc;
--vscode-input-border:#3c3c3c;--vscode-focusBorder:#0078d4;`,
  light: `--vscode-foreground:#3b3b3b;--vscode-sideBar-background:#f8f8f8;--vscode-editor-background:#ffffff;
--vscode-panel-border:#e5e5e5;--vscode-editorWidget-background:#ffffff;--vscode-textLink-foreground:#005fb8;
--vscode-textCodeBlock-background:#eeeeee;--vscode-progressBar-background:#005fb8;--vscode-testing-iconPassed:#1a7f37;
--vscode-list-hoverBackground:#f0f0f0;--vscode-toolbar-hoverBackground:#efefef;--vscode-button-secondaryBackground:#e5e5e5;
--vscode-button-secondaryForeground:#3b3b3b;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;
--vscode-input-border:#cecece;--vscode-focusBorder:#005fb8;`,
};
const bg = mode === 'light' ? '#f8f8f8' : '#181818';

// a board as the extension sees one: the sidebar, following the latest conversation
let html = buildHtml({
  kind: 'view', view: { mode: 'follow' }, extUri: stub.Uri.file(EXT), srcs: new Map(),
  webview: { cspSource: "'self'", asWebviewUri: u => 'file://' + u.fsPath },
});
html = html
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '')
  .replace('<details class="tasks" id="tasksBlock">', '<details class="tasks" id="tasksBlock" open>')
  .replace('</head>', `<style>
:root{--vscode-font-family:-apple-system,"Segoe UI",Ubuntu,sans-serif;--vscode-font-size:13px;
--vscode-editor-font-family:"SF Mono",Menlo,monospace;${TOKENS[mode] || TOKENS.dark}}
html,body{width:${width}px;box-sizing:border-box;background:${bg}!important;}
</style></head>`);
fs.writeFileSync(out, html);
console.log(out, html.length, 'bytes');
