// Just enough of the VS Code API to activate the extension in plain node and capture board HTML.
const path = require('path');
const cfg = { folder: '.claude/canvas', newestFirst: true, maxCards: 60, autoReveal: 'always', liveBlocks: true, maxConversations: 20 };
const Uri = { file: (p) => ({ fsPath: p, toString: () => 'file://' + p }), joinPath: (u, ...s) => Uri.file(path.join(u.fsPath, ...s)) };
const reg = { views: {}, serializers: {}, commands: {} };
const ev = () => () => ({ dispose() {} });
module.exports = {
  Uri, _reg: reg,
  ViewColumn: { Beside: 2, Active: -1 },
  RelativePattern: function () {},
  workspace: {
    workspaceFolders: [{ uri: Uri.file(process.env.WS) }], isTrusted: true,
    getConfiguration: () => ({ get: (k, d) => (k in cfg ? cfg[k] : d) }),
    onDidGrantWorkspaceTrust: ev(), onDidChangeConfiguration: ev(),
    createFileSystemWatcher: () => ({ onDidChange: ev(), onDidCreate: ev(), onDidDelete: ev(), dispose() {} }),
  },
  window: {
    registerWebviewViewProvider: (id, p) => { reg.views[id] = p; return { dispose() {} }; },
    registerWebviewPanelSerializer: (id, s) => { reg.serializers[id] = s; return { dispose() {} }; },
    createWebviewPanel: () => module.exports._panel(),
    showWarningMessage: async () => undefined, showTextDocument: async () => {}, showInputBox: async () => undefined,
  },
  commands: { registerCommand: (id, f) => { reg.commands[id] = f; return { dispose() {} }; }, executeCommand: async () => {} },
  _host: (kind) => {
    const h = { visible: true, title: '', messages: [], onMsg: null };
    h.webview = { html: '', options: {}, cspSource: 'file:', asWebviewUri: (u) => 'file://' + u.fsPath,
      onDidReceiveMessage: (f) => { h.onMsg = f; return { dispose() {} }; }, postMessage: (m) => { h.messages.push(m); return Promise.resolve(true); } };
    h.onDidChangeVisibility = ev(); h.onDidChangeViewState = ev(); h.onDidDispose = ev(); h.show = () => {};
    return h;
  },
  _panel: () => { const h = module.exports._host('tab'); module.exports._panels.push(h); return h; },
  _panels: [],
};
